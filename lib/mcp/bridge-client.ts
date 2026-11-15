/**
 * Browser-side Local MCP Bridge Client (`createMcpBridgeClient`).
 *
 * Connects from the PageCraft MV3 background service worker to the local
 * `pagecraft-mcp` WebSocket server strictly over loopback (`127.0.0.1`,
 * `localhost`, or `[::1]`), authenticates with `{ type: 'hello' }`, dispatches
 * incoming tool RPC calls to extension handlers, and maintains keepalive +
 * exponential-backoff auto-reconnect.
 */

import {
  DEFAULT_MCP_WS_URL,
  type BridgeClientMessage,
  type BridgeHello,
  type BridgeRpcRequest,
  type BridgeRpcResponse,
  type McpApplyModInput,
  type McpBridgeConfig,
  type McpBridgeStatus,
  type McpToolHandlers,
} from './types.ts';

const LOOPBACK_WS_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const RAW_LOOPBACK_WS_RE =
  /^ws:\/\/(\[::1\]|127\.0\.0\.1|localhost)(?::(\d{1,5}))?(?:\/[^\s?#\\@]*)?$/i;

const WS_OPEN = 1;
const WS_CONNECTING = 0;

export interface McpBridgeClientOptions {
  /** Interval for application-level keepalive pings in ms (default: 20_000). */
  keepaliveMs?: number;
  /** Initial exponential-backoff reconnect delay in ms (default: 500). */
  baseReconnectMs?: number;
  /** Maximum reconnect backoff cap in ms (default: 15_000). */
  maxReconnectMs?: number;
  /** Handshake timeout waiting for `hello_ack` in ms (default: 5_000). */
  handshakeTimeoutMs?: number;
}

export interface McpBridgeClient {
  /** Apply bridge configuration; connects if enabled on a valid loopback URL, or closes if disabled. */
  configure: (config: McpBridgeConfig) => McpBridgeStatus;
  /** Alias for `configure` for settings listener ergonomics. */
  updateConfig: (config: McpBridgeConfig) => McpBridgeStatus;
  /**
   * Connect (optionally applying new config) and resolve once authenticated (`hello_ack`).
   * Rejects immediately if `wsUrl` is non-loopback, disabled, or rejected by token check.
   */
  connect: (config?: McpBridgeConfig) => Promise<McpBridgeStatus>;
  /** Disable the bridge and close any active socket or pending reconnect timers. */
  disconnect: () => void;
  /** Alias for `disconnect`. */
  close: () => void;
  /** Snapshot current bridge status. */
  getStatus: () => McpBridgeStatus;
  /** Subscribe to status changes; returns an unsubscribe callback. */
  onStatusChange: (listener: (status: McpBridgeStatus) => void) => () => void;
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    const fn = (timer as { unref?: () => void }).unref;
    if (typeof fn === 'function') fn.call(timer);
  }
}

/**
 * Strictly validates that `rawUrl` is a plain loopback `ws://` URL targeting
 * `127.0.0.1`, `localhost`, or `[::1]` with no credentials, query, hash, or host spoofing.
 */
export function isLoopbackWsUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return false;

  const match = RAW_LOOPBACK_WS_RE.exec(trimmed);
  if (!match) return false;

  const rawHost = match[1]?.toLowerCase();
  if (!rawHost || !LOOPBACK_WS_HOSTS.has(rawHost)) return false;

  const rawPort = match[2];
  if (rawPort !== undefined) {
    const portNum = Number(rawPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return false;
    }
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.search || parsed.hash) return false;
    if (!LOOPBACK_WS_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    if (parsed.port) {
      const p = Number(parsed.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function decodeEventData(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return null;
}

function parseApplyModInput(params: Record<string, unknown> | undefined): McpApplyModInput {
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid applyMod params: expected an object');
  }
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) {
    throw new Error('Invalid applyMod params: "name" must be a non-empty string');
  }
  if (params.engine !== 'css' && params.engine !== 'js') {
    throw new Error('Invalid applyMod params: "engine" must be "css" or "js"');
  }
  if (typeof params.body !== 'string' || !params.body.trim()) {
    throw new Error('Invalid applyMod params: "body" must be a non-empty string');
  }

  const input: McpApplyModInput = {
    name,
    engine: params.engine,
    body: params.body,
  };

  if (typeof params.description === 'string') {
    input.description = params.description;
  }
  if (Array.isArray(params.matches)) {
    input.matches = params.matches.filter((m): m is string => typeof m === 'string');
  }
  if (Array.isArray(params.targetSelectors)) {
    input.targetSelectors = params.targetSelectors.filter(
      (s): s is string => typeof s === 'string',
    );
  }
  return input;
}

export function createMcpBridgeClient(
  handlers: McpToolHandlers,
  WebSocketImpl: typeof WebSocket = globalThis.WebSocket,
  options: McpBridgeClientOptions = {},
): McpBridgeClient {
  const keepaliveMs = Math.max(250, options.keepaliveMs ?? 20_000);
  const baseReconnectMs = Math.max(50, options.baseReconnectMs ?? 500);
  const maxReconnectMs = Math.max(baseReconnectMs, options.maxReconnectMs ?? 15_000);
  const handshakeTimeoutMs = Math.max(250, options.handshakeTimeoutMs ?? 5_000);

  let currentConfig: Required<Pick<McpBridgeConfig, 'enabled'>> & {
    wsUrl: string;
    token?: string;
  } = {
    enabled: false,
    wsUrl: DEFAULT_MCP_WS_URL,
  };

  let connected = false;
  let lastError: string | undefined;
  let authRejected = false;
  let reconnectAttempt = 0;
  let socketGeneration = 0;

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPongAt = 0;

  const listeners = new Set<(status: McpBridgeStatus) => void>();
  let pendingConnectWaiters: Array<{
    resolve: (status: McpBridgeStatus) => void;
    reject: (err: Error) => void;
  }> = [];

  function snapshotStatus(): McpBridgeStatus {
    const out: McpBridgeStatus = {
      enabled: currentConfig.enabled,
      connected,
      wsUrl: currentConfig.wsUrl,
    };
    if (lastError) {
      out.lastError = lastError;
    }
    return out;
  }

  function emitStatus(): void {
    const snap = snapshotStatus();
    for (const listener of listeners) {
      try {
        listener(snap);
      } catch {
        /* listener errors must never disrupt bridge state */
      }
    }
  }

  function resolveConnectWaiters(): void {
    if (pendingConnectWaiters.length === 0) return;
    const snap = snapshotStatus();
    const waiters = pendingConnectWaiters;
    pendingConnectWaiters = [];
    for (const w of waiters) {
      w.resolve(snap);
    }
  }

  function rejectConnectWaiters(message: string): void {
    if (pendingConnectWaiters.length === 0) return;
    const err = new Error(message);
    const waiters = pendingConnectWaiters;
    pendingConnectWaiters = [];
    for (const w of waiters) {
      w.reject(err);
    }
  }

  function clearTimers(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    if (handshakeTimer !== null) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function clearSocketTimersOnly(): void {
    if (keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    if (handshakeTimer !== null) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function safeCloseSocket(sock: WebSocket | null, reason = 'Client closed'): void {
    if (!sock) return;
    try {
      if (sock.readyState === WS_OPEN || sock.readyState === WS_CONNECTING) {
        sock.close(1000, reason);
      }
    } catch {
      /* ignore close errors on closing/closed sockets */
    }
  }

  function sendJson(sock: WebSocket, message: BridgeClientMessage): void {
    if (sock.readyState !== WS_OPEN) return;
    sock.send(JSON.stringify(message));
  }

  async function dispatchRpc(sock: WebSocket, gen: number, req: BridgeRpcRequest): Promise<void> {
    const { id, method, params } = req;
    if (typeof id !== 'string' || !id) return;

    let response: BridgeRpcResponse;
    try {
      let result: unknown;
      switch (method) {
        case 'getActivePage': {
          result = await handlers.getActivePage();
          break;
        }
        case 'getPickedElement': {
          result = await handlers.getPickedElement();
          break;
        }
        case 'triggerPicker': {
          result = await handlers.triggerPicker();
          break;
        }
        case 'verifySelectors': {
          const rawSelectors = params?.selectors;
          if (!Array.isArray(rawSelectors)) {
            throw new Error('Invalid verifySelectors params: "selectors" must be an array');
          }
          const selectors = rawSelectors.filter((s): s is string => typeof s === 'string');
          result = await handlers.verifySelectors(selectors);
          break;
        }
        case 'applyMod': {
          const input = parseApplyModInput(params);
          result = await handlers.applyMod(input);
          break;
        }
        case 'listMods': {
          result = await handlers.listMods();
          break;
        }
        case 'toggleMod': {
          const modId = typeof params?.id === 'string' ? params.id.trim() : '';
          const modEnabled = params?.enabled;
          if (!modId || typeof modEnabled !== 'boolean') {
            throw new Error(
              'Invalid toggleMod params: "id" (string) and "enabled" (boolean) are required',
            );
          }
          result = await handlers.toggleMod(modId, modEnabled);
          break;
        }
        default: {
          response = {
            type: 'rpc_response',
            id,
            ok: false,
            error: {
              code: 'METHOD_NOT_FOUND',
              message: `Unknown bridge RPC method: ${String(method)}`,
            },
          };
          if (gen === socketGeneration) {
            sendJson(sock, response);
          }
          return;
        }
      }

      response = {
        type: 'rpc_response',
        id,
        ok: true,
        result,
      };
    } catch (err) {
      response = {
        type: 'rpc_response',
        id,
        ok: false,
        error: {
          code: 'HANDLER_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    if (gen === socketGeneration) {
      sendJson(sock, response);
    }
  }

  function scheduleReconnect(): void {
    if (!currentConfig.enabled || authRejected || reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(maxReconnectMs, baseReconnectMs * Math.pow(2, reconnectAttempt));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (currentConfig.enabled && !authRejected) {
        openSocket();
      }
    }, delay);
    unrefTimer(reconnectTimer);
  }

  function startKeepalive(sock: WebSocket, gen: number): void {
    if (keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
    }
    lastPongAt = Date.now();
    keepaliveTimer = setInterval(() => {
      if (gen !== socketGeneration || sock.readyState !== WS_OPEN) {
        return;
      }
      if (Date.now() - lastPongAt > keepaliveMs * 2.5) {
        lastError = 'MCP bridge keepalive timed out';
        safeCloseSocket(sock, 'Keepalive timeout');
        return;
      }
      sendJson(sock, { type: 'ping', ts: Date.now() });
    }, keepaliveMs);
    unrefTimer(keepaliveTimer);
  }

  function openSocket(): void {
    clearTimers();
    if (!currentConfig.enabled) return;

    if (!isLoopbackWsUrl(currentConfig.wsUrl)) {
      connected = false;
      lastError = `Refused non-loopback WebSocket URL: ${currentConfig.wsUrl}. Only ws://127.0.0.1, ws://localhost, and ws://[::1] are permitted.`;
      emitStatus();
      rejectConnectWaiters(lastError);
      return;
    }

    if (typeof WebSocketImpl !== 'function') {
      connected = false;
      lastError = 'WebSocket implementation is unavailable in this runtime';
      emitStatus();
      rejectConnectWaiters(lastError);
      return;
    }

    const gen = ++socketGeneration;
    let sock: WebSocket;
    try {
      sock = new WebSocketImpl(currentConfig.wsUrl);
    } catch (err) {
      connected = false;
      lastError = err instanceof Error ? err.message : String(err);
      emitStatus();
      rejectConnectWaiters(lastError);
      scheduleReconnect();
      return;
    }

    ws = sock;
    let authenticatedOnSocket = false;

    handshakeTimer = setTimeout(() => {
      if (gen !== socketGeneration || authenticatedOnSocket) return;
      lastError = 'Timed out waiting for MCP server hello_ack';
      safeCloseSocket(sock, 'Handshake timeout');
      rejectConnectWaiters(lastError);
    }, handshakeTimeoutMs);
    unrefTimer(handshakeTimer);

    sock.addEventListener('open', () => {
      if (gen !== socketGeneration) return;
      const hello: BridgeHello = {
        type: 'hello',
        client: 'pagecraft-extension',
        ...(currentConfig.token ? { token: currentConfig.token } : {}),
      };
      sendJson(sock, hello);
    });

    sock.addEventListener('message', (event: MessageEvent) => {
      if (gen !== socketGeneration) return;
      const raw = decodeEventData(event.data);
      if (!raw) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;

      lastPongAt = Date.now();

      if (parsed.type === 'hello_ack') {
        if (handshakeTimer !== null) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        if (parsed.ok === true) {
          authenticatedOnSocket = true;
          connected = true;
          lastError = undefined;
          authRejected = false;
          reconnectAttempt = 0;
          startKeepalive(sock, gen);
          emitStatus();
          resolveConnectWaiters();
        } else {
          authenticatedOnSocket = false;
          connected = false;
          authRejected = true;
          lastError =
            typeof parsed.error === 'string' && parsed.error
              ? parsed.error
              : 'Authentication rejected by local MCP server';
          emitStatus();
          rejectConnectWaiters(lastError);
          safeCloseSocket(sock, 'Authentication failed');
        }
        return;
      }

      if (!authenticatedOnSocket) {
        return;
      }

      if (parsed.type === 'ping') {
        const ts = typeof parsed.ts === 'number' ? parsed.ts : Date.now();
        sendJson(sock, { type: 'pong', ts });
        return;
      }

      if (parsed.type === 'pong') {
        return;
      }

      if (parsed.type === 'rpc_request') {
        void dispatchRpc(sock, gen, parsed as unknown as BridgeRpcRequest);
      }
    });

    sock.addEventListener('error', () => {
      if (gen !== socketGeneration) return;
      if (!lastError) {
        lastError = `Unable to connect to local MCP server at ${currentConfig.wsUrl}`;
      }
    });

    sock.addEventListener('close', (event: CloseEvent) => {
      if (gen !== socketGeneration) return;
      clearSocketTimersOnly();
      ws = null;
      const wasConnected = connected;
      connected = false;

      if (event.code === 4001) {
        authRejected = true;
        lastError = event.reason || 'Unauthorized: token mismatch';
      } else if (!lastError && currentConfig.enabled) {
        lastError = event.reason || `Disconnected from ${currentConfig.wsUrl}`;
      }

      if (!authenticatedOnSocket) {
        rejectConnectWaiters(
          lastError ?? `Failed to connect to local MCP server (${event.code})`,
        );
      }

      if (wasConnected || !authenticatedOnSocket) {
        emitStatus();
      }

      if (currentConfig.enabled && !authRejected) {
        scheduleReconnect();
      }
    });
  }

  function configure(config: McpBridgeConfig): McpBridgeStatus {
    const normalizedUrl = (config.wsUrl ?? '').trim() || DEFAULT_MCP_WS_URL;
    const normalizedToken = config.token?.trim() ? config.token.trim() : undefined;
    const configChanged =
      currentConfig.enabled !== Boolean(config.enabled) ||
      currentConfig.wsUrl !== normalizedUrl ||
      currentConfig.token !== normalizedToken;

    currentConfig = {
      enabled: Boolean(config.enabled),
      wsUrl: normalizedUrl,
      ...(normalizedToken ? { token: normalizedToken } : {}),
    };

    if (!currentConfig.enabled) {
      socketGeneration += 1;
      clearTimers();
      const prev = ws;
      ws = null;
      connected = false;
      authRejected = false;
      reconnectAttempt = 0;
      lastError = undefined;
      safeCloseSocket(prev, 'Bridge disabled');
      rejectConnectWaiters('MCP bridge was disabled');
      emitStatus();
      return snapshotStatus();
    }

    if (!isLoopbackWsUrl(currentConfig.wsUrl)) {
      socketGeneration += 1;
      clearTimers();
      const prev = ws;
      ws = null;
      connected = false;
      authRejected = false;
      reconnectAttempt = 0;
      lastError = `Refused non-loopback WebSocket URL: ${currentConfig.wsUrl}. Only ws://127.0.0.1, ws://localhost, and ws://[::1] are permitted.`;
      safeCloseSocket(prev, 'Invalid URL');
      rejectConnectWaiters(lastError);
      emitStatus();
      return snapshotStatus();
    }

    if (configChanged || !ws) {
      socketGeneration += 1;
      clearTimers();
      const prev = ws;
      ws = null;
      connected = false;
      authRejected = false;
      reconnectAttempt = 0;
      lastError = undefined;
      safeCloseSocket(prev, 'Reconfiguring bridge');
      openSocket();
    }

    return snapshotStatus();
  }

  function connect(config?: McpBridgeConfig): Promise<McpBridgeStatus> {
    if (config) {
      configure(config);
    } else if (!currentConfig.enabled) {
      configure({ ...currentConfig, enabled: true });
    }

    if (!currentConfig.enabled) {
      return Promise.reject(new Error('MCP bridge is disabled'));
    }

    if (!isLoopbackWsUrl(currentConfig.wsUrl)) {
      return Promise.reject(
        new Error(
          lastError ??
            `Refused non-loopback WebSocket URL: ${currentConfig.wsUrl}. Only loopback ws:// addresses are allowed.`,
        ),
      );
    }

    if (connected && ws && ws.readyState === WS_OPEN) {
      return Promise.resolve(snapshotStatus());
    }

    return new Promise<McpBridgeStatus>((resolve, reject) => {
      pendingConnectWaiters.push({ resolve, reject });
      if (!ws && reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        openSocket();
      } else if (!ws) {
        openSocket();
      }
    });
  }

  function disconnect(): void {
    configure({
      ...currentConfig,
      enabled: false,
    });
  }

  return {
    configure,
    updateConfig: configure,
    connect,
    disconnect,
    close: disconnect,
    getStatus: snapshotStatus,
    onStatusChange(listener: (status: McpBridgeStatus) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
