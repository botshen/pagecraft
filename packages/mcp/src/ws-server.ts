/**
 * Zero-dependency RFC 6455 WebSocket server bound strictly to `127.0.0.1`.
 *
 * Security invariants:
 * 1. Binds strictly to `127.0.0.1` and verifies `socket.remoteAddress` is loopback.
 * 2. Rejects any HTTP/WebSocket request carrying an `http://`, `https://`, `null`,
 *    or untrusted `Origin` header with `403 Forbidden` so arbitrary webpages visited
 *    in the user's browser can NEVER talk to the local MCP bridge (CSWSH defense).
 *    Only `chrome-extension://`, `moz-extension://`, `safari-web-extension://`, or
 *    empty `Origin` (Node/CLI test clients) are permitted.
 * 3. Enforces optional `PAGECRAFT_MCP_TOKEN` shared-secret verification in constant
 *    time (`crypto.timingSafeEqual`) during the initial `{ type: 'hello' }` handshake.
 * 4. Supports masked & fragmented client frames up to 4 MB (for screenshot data URLs),
 *    RFC 6455 ping/pong/close control frames, and deterministic RPC timeouts.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_MCP_PORT,
  type BridgeClientMessage,
  type BridgeRpcMethod,
  type BridgeRpcResponse,
  type BridgeServerMessage,
} from './types.ts';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_HELLO_TIMEOUT_MS = 5_000;
const DEFAULT_PING_INTERVAL_MS = 25_000;

const EXTENSION_ORIGIN_RE =
  /^(?:chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9_-]+$/i;

export class BridgeNotConnectedError extends Error {
  readonly code = 'BRIDGE_NOT_CONNECTED';

  constructor(wsUrl: string) {
    super(
      `PageCraft browser extension is not connected to ${wsUrl}. Open the PageCraft SidePanel -> Settings and enable "Local Agent Bridge (MCP)".`,
    );
    this.name = 'BridgeNotConnectedError';
  }
}

export interface BridgeWsServerOptions {
  /** TCP port on `127.0.0.1` (0 for ephemeral port; defaults to `PAGECRAFT_MCP_PORT` or 17321). */
  port?: number;
  /** Optional shared authentication token (defaults to `process.env.PAGECRAFT_MCP_TOKEN`). */
  token?: string;
  /** Maximum frame / reassembled message size in bytes (default: 4 MB). */
  maxPayloadBytes?: number;
  /** Default RPC request timeout in ms (default: 15_000). */
  requestTimeoutMs?: number;
  /** Initial `hello` handshake timeout in ms (default: 5_000). */
  helloTimeoutMs?: number;
  /** Server-to-client WS ping interval in ms (default: 25_000). */
  pingIntervalMs?: number;
  /** Diagnostic logger (must NEVER write to stdout in stdio MCP mode). */
  onLog?: (message: string) => void;
}

export interface BridgeWsServer {
  /** Bound port on `127.0.0.1`. */
  readonly port: number;
  /** Canonical loopback WebSocket URL (`ws://127.0.0.1:<port>`). */
  readonly wsUrl: string;
  /** True when an authenticated PageCraft extension client is actively connected. */
  isExtensionConnected: () => boolean;
  /** Invoke an RPC handler inside the connected PageCraft browser extension. */
  callExtension: (
    method: BridgeRpcMethod,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<unknown>;
  /** Send an RFC 6455 Ping control frame to the active client (useful for health checks/tests). */
  sendPingFrame: (payload?: Buffer) => boolean;
  /** Shut down all client connections, pending RPC calls, and the `127.0.0.1` HTTP server. */
  close: () => Promise<void>;
}

/**
 * Returns true strictly for loopback remote socket addresses.
 */
export function isLoopbackSocketAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

/**
 * Returns true ONLY for browser extension origins (`chrome-extension://`, `moz-extension://`,
 * `safari-web-extension://`) or missing/empty `Origin` (Node/CLI clients).
 * Explicitly rejects `http://`, `https://`, `null`, `file://`, and all web origins.
 */
export function isAllowedBridgeOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin.trim() === '') {
    return true;
  }
  return EXTENSION_ORIGIN_RE.test(origin.trim());
}

/**
 * Constant-time token comparison via SHA-256 digests so token length is never leaked.
 */
export function timingSafeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || !provided) return false;
  const hashA = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Encodes a server-to-client (unmasked) RFC 6455 WebSocket frame.
 */
export function encodeWsFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const firstByte = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  const length = payload.length;

  if (length < 126) {
    const header = Buffer.allocUnsafe(2);
    header[0] = firstByte;
    header[1] = length;
    return Buffer.concat([header, payload], 2 + length);
  }

  if (length < 65536) {
    const header = Buffer.allocUnsafe(4);
    header[0] = firstByte;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload], 4 + length);
  }

  const header = Buffer.allocUnsafe(10);
  header[0] = firstByte;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload], 10 + length);
}

function encodeClosePayload(code: number, reason = ''): Buffer {
  const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 123);
  const buf = Buffer.allocUnsafe(2 + reasonBytes.length);
  buf.writeUInt16BE(code, 0);
  reasonBytes.copy(buf, 2);
  return buf;
}

function writeHttpRejection(socket: Duplex, statusCode: number, statusText: string, body: string): void {
  const bodyBuf = Buffer.from(body, 'utf8');
  const head =
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    'Connection: close\r\n' +
    'Cache-Control: no-store\r\n' +
    `Content-Length: ${bodyBuf.length}\r\n` +
    '\r\n';
  try {
    socket.write(head);
    socket.end(bodyBuf);
  } catch {
    socket.destroy();
  }
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  clientId: string;
}

interface ClientConnection {
  id: string;
  socket: Duplex;
  authenticated: boolean;
  closed: boolean;
  closeSent: boolean;
  recvBuffer: Buffer;
  fragmentOpcode: number | null;
  fragments: Buffer[];
  fragmentBytes: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
  lastSeenAt: number;
}

export function resolveConfiguredPort(explicitPort?: number): number {
  if (explicitPort !== undefined) {
    if (!Number.isInteger(explicitPort) || explicitPort < 0 || explicitPort > 65535) {
      throw new Error(`Invalid port: ${explicitPort}`);
    }
    return explicitPort;
  }
  const envRaw = process.env.PAGECRAFT_MCP_PORT?.trim();
  if (!envRaw) return DEFAULT_MCP_PORT;
  const parsed = Number(envRaw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid PAGECRAFT_MCP_PORT="${envRaw}": expected integer 0..65535`);
  }
  return parsed;
}

export async function startBridgeWsServer(
  options: BridgeWsServerOptions = {},
): Promise<BridgeWsServer> {
  const requestedPort = resolveConfiguredPort(options.port);
  const expectedToken =
    options.token !== undefined
      ? options.token.trim() || undefined
      : process.env.PAGECRAFT_MCP_TOKEN?.trim() || undefined;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const defaultTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const log = options.onLog ?? (() => {});

  const allClients = new Set<ClientConnection>();
  let activeClient: ClientConnection | null = null;
  const pendingRequests = new Map<string, PendingRpc>();
  let boundPort = requestedPort;
  let serverClosed = false;

  function sendFrame(client: ClientConnection, opcode: number, payload: Buffer): boolean {
    if (client.closed || !client.socket.writable) return false;
    try {
      client.socket.write(encodeWsFrame(opcode, payload, true));
      return true;
    } catch {
      return false;
    }
  }

  function sendServerMessage(client: ClientConnection, message: BridgeServerMessage): boolean {
    const data = Buffer.from(JSON.stringify(message), 'utf8');
    return sendFrame(client, 0x1, data);
  }

  function rejectPendingForClient(clientId: string, reason: string): void {
    for (const [reqId, pending] of pendingRequests.entries()) {
      if (pending.clientId === clientId) {
        clearTimeout(pending.timer);
        pendingRequests.delete(reqId);
        pending.reject(new Error(reason));
      }
    }
  }

  function closeClient(client: ClientConnection, code = 1000, reason = ''): void {
    if (client.closed) return;
    if (client.helloTimer !== null) {
      clearTimeout(client.helloTimer);
      client.helloTimer = null;
    }
    if (!client.closeSent && client.socket.writable) {
      client.closeSent = true;
      try {
        client.socket.write(encodeWsFrame(0x8, encodeClosePayload(code, reason), true));
      } catch {
        /* ignore write failure during teardown */
      }
    }
    client.closed = true;
    client.authenticated = false;
    allClients.delete(client);
    if (activeClient === client) {
      activeClient = null;
    }
    rejectPendingForClient(
      client.id,
      reason || 'PageCraft browser extension disconnected from local MCP bridge',
    );
    try {
      client.socket.end();
    } catch {
      client.socket.destroy();
    }
  }

  function handleClientJsonMessage(client: ClientConnection, text: string): void {
    let parsed: BridgeClientMessage;
    try {
      parsed = JSON.parse(text) as BridgeClientMessage;
    } catch {
      closeClient(client, 1007, 'Invalid JSON payload');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      closeClient(client, 1002, 'Invalid bridge message');
      return;
    }

    client.lastSeenAt = Date.now();

    if (!client.authenticated) {
      if (parsed.type !== 'hello' || parsed.client !== 'pagecraft-extension') {
        sendServerMessage(client, {
          type: 'hello_ack',
          ok: false,
          error: 'Expected initial { type: "hello", client: "pagecraft-extension" } handshake',
        });
        closeClient(client, 4001, 'Invalid hello handshake');
        return;
      }

      if (expectedToken && !timingSafeTokenEqual(parsed.token, expectedToken)) {
        log('[pagecraft-mcp] Rejected extension connection due to invalid PAGECRAFT_MCP_TOKEN');
        sendServerMessage(client, {
          type: 'hello_ack',
          ok: false,
          error: 'Unauthorized: invalid or missing PAGECRAFT_MCP_TOKEN',
        });
        closeClient(client, 4001, 'Unauthorized: token mismatch');
        return;
      }

      if (client.helloTimer !== null) {
        clearTimeout(client.helloTimer);
        client.helloTimer = null;
      }

      if (activeClient && activeClient !== client) {
        closeClient(activeClient, 1000, 'Superseded by newer PageCraft connection');
      }

      client.authenticated = true;
      activeClient = client;
      sendServerMessage(client, { type: 'hello_ack', ok: true });
      log('[pagecraft-mcp] PageCraft browser extension connected');
      return;
    }

    if (parsed.type === 'ping') {
      const ts = typeof parsed.ts === 'number' ? parsed.ts : Date.now();
      sendServerMessage(client, { type: 'pong', ts });
      return;
    }

    if (parsed.type === 'pong') {
      return;
    }

    if (parsed.type === 'rpc_response') {
      const res = parsed as BridgeRpcResponse;
      const pending = pendingRequests.get(res.id);
      if (!pending || pending.clientId !== client.id) return;
      clearTimeout(pending.timer);
      pendingRequests.delete(res.id);
      if (res.ok) {
        pending.resolve(res.result);
      } else {
        pending.reject(
          new Error(res.error?.message || `Extension handler returned error (${res.error?.code ?? 'UNKNOWN'})`),
        );
      }
    }
  }

  function processFrames(client: ClientConnection): void {
    while (!client.closed && client.recvBuffer.length >= 2) {
      const b0 = client.recvBuffer[0]!;
      const b1 = client.recvBuffer[1]!;

      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (rsv !== 0) {
        closeClient(client, 1002, 'RSV bits must be 0');
        return;
      }

      // RFC 6455 Section 5.1: All client-to-server frames MUST be masked.
      if (!masked) {
        closeClient(client, 1002, 'Client frames must be masked');
        return;
      }

      if (payloadLen === 126) {
        if (client.recvBuffer.length < offset + 2) return;
        payloadLen = client.recvBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (client.recvBuffer.length < offset + 8) return;
        const bigLen = client.recvBuffer.readBigUInt64BE(offset);
        if ((bigLen & (1n << 63n)) !== 0n) {
          closeClient(client, 1002, 'Invalid 64-bit frame length');
          return;
        }
        if (bigLen > BigInt(maxPayloadBytes)) {
          closeClient(client, 1009, `Frame exceeds ${maxPayloadBytes} byte limit`);
          return;
        }
        payloadLen = Number(bigLen);
        offset += 8;
      }

      if (payloadLen > maxPayloadBytes) {
        closeClient(client, 1009, `Frame exceeds ${maxPayloadBytes} byte limit`);
        return;
      }

      const isControl = (opcode & 0x08) !== 0;
      if (isControl && (!fin || payloadLen > 125)) {
        closeClient(client, 1002, 'Invalid control frame');
        return;
      }

      const totalFrameBytes = offset + 4 + payloadLen;
      if (client.recvBuffer.length < totalFrameBytes) {
        return;
      }

      const maskKey = client.recvBuffer.subarray(offset, offset + 4);
      const maskedStart = offset + 4;
      const payload = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = client.recvBuffer[maskedStart + i]! ^ maskKey[i & 3]!;
      }

      client.recvBuffer =
        client.recvBuffer.length === totalFrameBytes
          ? Buffer.alloc(0)
          : Buffer.from(client.recvBuffer.subarray(totalFrameBytes));

      client.lastSeenAt = Date.now();

      if (opcode === 0x8) {
        // Close frame
        let echoCode = 1000;
        if (payload.length >= 2) {
          const receivedCode = payload.readUInt16BE(0);
          if (receivedCode >= 1000 && receivedCode <= 4999) {
            echoCode = receivedCode;
          }
        }
        closeClient(client, echoCode, 'Peer closed');
        return;
      }

      if (opcode === 0x9) {
        // Ping -> immediate Pong with identical payload
        sendFrame(client, 0x0a, payload);
        continue;
      }

      if (opcode === 0x0a) {
        // Pong
        continue;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        if (client.fragmentOpcode !== null) {
          closeClient(client, 1002, 'Unexpected new data frame during fragmentation');
          return;
        }
        if (fin) {
          if (opcode === 0x1) {
            handleClientJsonMessage(client, payload.toString('utf8'));
          } else {
            closeClient(client, 1003, 'Binary messages are not supported');
            return;
          }
        } else {
          client.fragmentOpcode = opcode;
          client.fragments = [payload];
          client.fragmentBytes = payload.length;
        }
        continue;
      }

      if (opcode === 0x0) {
        if (client.fragmentOpcode === null) {
          closeClient(client, 1002, 'Unexpected continuation frame');
          return;
        }
        if (client.fragmentBytes + payload.length > maxPayloadBytes) {
          closeClient(client, 1009, `Fragmented message exceeds ${maxPayloadBytes} byte limit`);
          return;
        }
        client.fragments.push(payload);
        client.fragmentBytes += payload.length;
        if (fin) {
          const reassembled = Buffer.concat(client.fragments, client.fragmentBytes);
          const completedOpcode = client.fragmentOpcode;
          client.fragmentOpcode = null;
          client.fragments = [];
          client.fragmentBytes = 0;
          if (completedOpcode === 0x1) {
            handleClientJsonMessage(client, reassembled.toString('utf8'));
          } else {
            closeClient(client, 1003, 'Binary messages are not supported');
            return;
          }
        }
        continue;
      }

      closeClient(client, 1002, `Unsupported WebSocket opcode: ${opcode}`);
      return;
    }
  }

  const httpServer = http.createServer((req, res) => {
    if (!isLoopbackSocketAddress(req.socket.remoteAddress)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Forbidden: non-loopback address\n');
      req.socket.destroy();
      return;
    }
    if (!isAllowedBridgeOrigin(req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Forbidden: untrusted Origin\n');
      return;
    }
    res.writeHead(426, {
      'Content-Type': 'text/plain; charset=utf-8',
      Upgrade: 'websocket',
      'Cache-Control': 'no-store',
    });
    res.end('Upgrade Required: connect via WebSocket (pagecraft-mcp)\n');
  });

  httpServer.on('connection', (socket) => {
    if (!isLoopbackSocketAddress(socket.remoteAddress)) {
      socket.destroy();
    }
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (serverClosed) {
      socket.destroy();
      return;
    }

    if (!isLoopbackSocketAddress(req.socket.remoteAddress)) {
      log(`[pagecraft-mcp] Blocked non-loopback upgrade from ${req.socket.remoteAddress ?? 'unknown'}`);
      writeHttpRejection(socket, 403, 'Forbidden', 'Forbidden: loopback connections only\n');
      return;
    }

    const originHeader = req.headers.origin;
    if (!isAllowedBridgeOrigin(originHeader)) {
      log(`[pagecraft-mcp] Blocked WebSocket upgrade from untrusted Origin: ${originHeader}`);
      writeHttpRejection(socket, 403, 'Forbidden', 'Forbidden: web page Origins are not permitted\n');
      return;
    }

    const upgradeHeader = req.headers.upgrade;
    const wsKey = req.headers['sec-websocket-key'];
    const wsVersion = req.headers['sec-websocket-version'];

    if (
      typeof upgradeHeader !== 'string' ||
      upgradeHeader.toLowerCase() !== 'websocket' ||
      typeof wsKey !== 'string' ||
      !wsKey.trim() ||
      wsVersion !== '13'
    ) {
      writeHttpRejection(socket, 400, 'Bad Request', 'Bad Request: invalid WebSocket upgrade headers\n');
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(wsKey.trim() + WS_GUID)
      .digest('base64');

    const responseHeaders =
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n';

    if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') {
      socket.setNoDelay(true);
    }

    try {
      socket.write(responseHeaders);
    } catch {
      socket.destroy();
      return;
    }

    const client: ClientConnection = {
      id: crypto.randomUUID(),
      socket,
      authenticated: false,
      closed: false,
      closeSent: false,
      recvBuffer: Buffer.alloc(0),
      fragmentOpcode: null,
      fragments: [],
      fragmentBytes: 0,
      helloTimer: null,
      lastSeenAt: Date.now(),
    };

    allClients.add(client);

    client.helloTimer = setTimeout(() => {
      if (!client.authenticated && !client.closed) {
        sendServerMessage(client, {
          type: 'hello_ack',
          ok: false,
          error: 'Authentication timeout waiting for hello handshake',
        });
        closeClient(client, 4001, 'Handshake timeout');
      }
    }, helloTimeoutMs);
    client.helloTimer.unref();

    socket.on('data', (chunk: Buffer) => {
      if (client.closed) return;
      client.recvBuffer =
        client.recvBuffer.length === 0 ? chunk : Buffer.concat([client.recvBuffer, chunk]);
      processFrames(client);
    });

    socket.on('error', () => {
      closeClient(client, 1006, 'Socket error');
    });

    socket.on('close', () => {
      if (!client.closed) {
        client.closeSent = true;
        closeClient(client, 1006, 'Connection closed');
      }
    });

    socket.on('end', () => {
      if (!client.closed) {
        closeClient(client, 1000, 'Stream ended');
      }
    });

    if (head && head.length > 0) {
      client.recvBuffer = Buffer.from(head);
      processFrames(client);
    }
  });

  const pingInterval = setInterval(() => {
    if (activeClient && !activeClient.closed && activeClient.authenticated) {
      sendFrame(activeClient, 0x9, Buffer.from('pc', 'utf8'));
    }
  }, pingIntervalMs);
  pingInterval.unref();

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      const addr = httpServer.address() as AddressInfo | null;
      if (addr && typeof addr === 'object') {
        boundPort = addr.port;
      }
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(requestedPort, '127.0.0.1');
  });

  const wsUrl = `ws://127.0.0.1:${boundPort}`;
  log(`[pagecraft-mcp] Listening strictly on ${wsUrl}`);

  return {
    get port() {
      return boundPort;
    },
    get wsUrl() {
      return wsUrl;
    },
    isExtensionConnected(): boolean {
      return Boolean(
        activeClient &&
          !activeClient.closed &&
          activeClient.authenticated &&
          activeClient.socket.writable,
      );
    },
    callExtension(
      method: BridgeRpcMethod,
      params?: Record<string, unknown>,
      timeoutMs = defaultTimeoutMs,
    ): Promise<unknown> {
      const client = activeClient;
      if (!client || client.closed || !client.authenticated || !client.socket.writable) {
        return Promise.reject(new BridgeNotConnectedError(wsUrl));
      }

      const id = crypto.randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for PageCraft extension (${method})`));
        }, timeoutMs);
        timer.unref();

        pendingRequests.set(id, {
          resolve,
          reject,
          timer,
          clientId: client.id,
        });

        const sent = sendServerMessage(client, {
          type: 'rpc_request',
          id,
          method,
          ...(params ? { params } : {}),
        });

        if (!sent) {
          clearTimeout(timer);
          pendingRequests.delete(id);
          reject(new BridgeNotConnectedError(wsUrl));
        }
      });
    },
    sendPingFrame(payload: Buffer = Buffer.from('ping', 'utf8')): boolean {
      if (!activeClient || activeClient.closed) return false;
      return sendFrame(activeClient, 0x9, payload);
    },
    async close(): Promise<void> {
      if (serverClosed) return;
      serverClosed = true;
      clearInterval(pingInterval);

      for (const [id, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timer);
        pendingRequests.delete(id);
        pending.reject(new Error('MCP WebSocket server closed'));
      }

      for (const client of [...allClients]) {
        closeClient(client, 1001, 'Server shutting down');
      }

      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
