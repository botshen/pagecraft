import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MCP_WS_URL,
  createMcpBridgeClient,
  isLoopbackWsUrl,
  type McpApplyModInput,
  type McpToolHandlers,
} from '../../lib/mcp/index.ts';
import {
  PAGECRAFT_MCP_TOOLS,
  createMcpServer,
  isAllowedBridgeOrigin,
  startBridgeWsServer,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
} from '../../packages/mcp/src/index.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI_PATH = path.join(ROOT_DIR, 'packages/mcp/src/cli.ts');

function createMockHandlers() {
  const savedMods: Array<{
    id: string;
    name: string;
    description: string;
    engine: 'css' | 'js';
    matches: string[];
    body: string;
    targetSelectors: string[];
    enabled: boolean;
  }> = [
    {
      id: 'mod-existing-1',
      name: 'Hide Promo Banner',
      description: 'Removes sticky top promo bar',
      engine: 'css',
      matches: ['https://*.example.com/*'],
      body: '.promo-banner { display: none !important; }',
      targetSelectors: ['.promo-banner'],
      enabled: true,
    },
  ];

  let pickerTriggeredCount = 0;
  // Create a 128 KB synthetic base64 PNG data URL to exercise >64KB extended WS frames too
  const largeBase64Chunk = Buffer.alloc(96 * 1024, 0xab).toString('base64');
  const sampleScreenshotUrl = `data:image/png;base64,${largeBase64Chunk}`;

  const handlers: McpToolHandlers = {
    async getActivePage() {
      return {
        url: 'https://app.example.com/dashboard',
        title: 'Example Authenticated Dashboard',
        domSkeleton: '<main id="app"><aside class="ad-rail"></aside><section class="feed"></section></main>',
        activeMods: savedMods.filter((m) => m.enabled).map((m) => ({ id: m.id, name: m.name })),
      };
    },
    async getPickedElement() {
      return {
        pickedElement: {
          selector: 'aside.ad-rail',
          matchCount: 1,
          similarSelector: 'aside[class*="rail"]',
          similarCount: 2,
          tag: 'aside',
          rect: { width: 320, height: 640 },
          computedStyles: { display: 'block', position: 'sticky' },
          domSnippet: '<aside class="ad-rail">[REDACTED]</aside>',
          pageUrl: 'https://app.example.com/dashboard',
          screenshotDataUrl: sampleScreenshotUrl,
        },
      };
    },
    async triggerPicker() {
      pickerTriggeredCount += 1;
      return { launched: true, count: pickerTriggeredCount };
    },
    async verifySelectors(selectors: string[]) {
      const counts: Record<string, number> = {
        'aside.ad-rail': 1,
        '.promo-banner': 2,
        '.feed-card': 8,
      };
      const results = selectors.map((selector) => ({
        selector,
        count: counts[selector] ?? 0,
      }));
      return {
        totalHits: results.reduce((sum, r) => sum + r.count, 0),
        results,
      };
    },
    async applyMod(input: McpApplyModInput) {
      const created = {
        id: `mod-${savedMods.length + 1}`,
        name: input.name,
        description: input.description ?? '',
        engine: input.engine,
        matches: input.matches ?? ['https://app.example.com/*'],
        body: input.body,
        targetSelectors: input.targetSelectors ?? [],
        enabled: true,
      };
      savedMods.push(created);
      return {
        applied: true,
        mod: created,
        selectorVerification: (input.targetSelectors ?? []).map((selector) => ({
          selector,
          count: selector === 'aside.ad-rail' ? 1 : 0,
        })),
      };
    },
    async listMods() {
      return { mods: savedMods };
    },
    async toggleMod(id: string, enabled: boolean) {
      const target = savedMods.find((m) => m.id === id);
      if (!target) {
        throw new Error(`Mod not found: ${id}`);
      }
      target.enabled = enabled;
      return { id: target.id, enabled: target.enabled };
    },
  };

  return { handlers, savedMods, getPickerCount: () => pickerTriggeredCount };
}

function sendUpgradeWithOrigin(
  port: number,
  origin?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key,
    };
    if (origin !== undefined) {
      headers.Origin = origin;
    }

    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      headers,
    });

    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ statusCode: res.statusCode ?? 101, headers: res.headers });
    });

    req.on('response', (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode ?? 0, headers: res.headers });
    });

    req.on('error', reject);
    req.end();
  });
}

function buildMaskedClientFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const maskKey = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i]! ^ maskKey[i & 3]!;
  }

  const first = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  if (payload.length < 126) {
    const head = Buffer.from([first, 0x80 | payload.length]);
    return Buffer.concat([head, maskKey, masked]);
  }
  if (payload.length < 65536) {
    const head = Buffer.allocUnsafe(4);
    head[0] = first;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(payload.length, 2);
    return Buffer.concat([head, maskKey, masked]);
  }
  const head = Buffer.allocUnsafe(10);
  head[0] = first;
  head[1] = 0x80 | 127;
  head.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([head, maskKey, masked]);
}

test('isLoopbackWsUrl & createMcpBridgeClient strictly enforce loopback ws:// URLs', async () => {
  assert.equal(DEFAULT_MCP_WS_URL, 'ws://127.0.0.1:17321');
  assert.equal(isLoopbackWsUrl('ws://127.0.0.1:17321'), true);
  assert.equal(isLoopbackWsUrl('ws://localhost:17321'), true);
  assert.equal(isLoopbackWsUrl('ws://[::1]:17321'), true);
  assert.equal(isLoopbackWsUrl('ws://127.0.0.1:54321/bridge'), true);

  // Reject remote, non-ws, spoofed, wildcard, or credentialed URLs
  assert.equal(isLoopbackWsUrl('ws://evil.example:17321'), false);
  assert.equal(isLoopbackWsUrl('wss://evil.example:17321'), false);
  assert.equal(isLoopbackWsUrl('ws://127.0.0.1.evil.example:17321'), false);
  assert.equal(isLoopbackWsUrl('ws://localhost.evil.example:17321'), false);
  assert.equal(isLoopbackWsUrl('ws://localhost@evil.example:17321'), false);
  assert.equal(isLoopbackWsUrl('ws://0.0.0.0:17321'), false);
  assert.equal(isLoopbackWsUrl('ws://192.168.1.10:17321'), false);
  assert.equal(isLoopbackWsUrl('http://127.0.0.1:17321'), false);
  assert.equal(isLoopbackWsUrl('ws://127.0.0.1:0'), false);

  const { handlers } = createMockHandlers();
  const client = createMcpBridgeClient(handlers, globalThis.WebSocket);

  await assert.rejects(
    () => client.connect({ enabled: true, wsUrl: 'ws://evil.example:17321' }),
    /Refused non-loopback WebSocket URL/i,
  );

  const status = client.getStatus();
  assert.equal(status.connected, false);
  assert.match(status.lastError ?? '', /Refused non-loopback WebSocket URL/i);
  client.disconnect();
});

test('ws-server rejects web Origins with HTTP 403 and accepts extension or CLI Origins', async () => {
  assert.equal(isAllowedBridgeOrigin('https://evil.example'), false);
  assert.equal(isAllowedBridgeOrigin('http://localhost:3000'), false);
  assert.equal(isAllowedBridgeOrigin('null'), false);
  assert.equal(isAllowedBridgeOrigin('file://'), false);
  assert.equal(isAllowedBridgeOrigin('chrome-extension://abcdefghijklmnop'), true);
  assert.equal(isAllowedBridgeOrigin('moz-extension://12345678-1234-1234-1234-123456789abc'), true);
  assert.equal(isAllowedBridgeOrigin(undefined), true);

  const wsServer = await startBridgeWsServer({ port: 0 });
  try {
    const evilHttps = await sendUpgradeWithOrigin(wsServer.port, 'https://evil.example');
    assert.equal(evilHttps.statusCode, 403);

    const evilHttp = await sendUpgradeWithOrigin(wsServer.port, 'http://127.0.0.1:8080');
    assert.equal(evilHttp.statusCode, 403);

    const sandboxedNull = await sendUpgradeWithOrigin(wsServer.port, 'null');
    assert.equal(sandboxedNull.statusCode, 403);

    // Regular HTTP GET with evil Origin is also rejected with 403
    const httpRes = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: wsServer.port,
          method: 'GET',
          headers: { Origin: 'https://evil.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(httpRes, 403);

    // Browser extension Origin succeeds with 101 Switching Protocols
    const extUpgrade = await sendUpgradeWithOrigin(
      wsServer.port,
      'chrome-extension://mpjpagecrafttestextensionid',
    );
    assert.equal(extUpgrade.statusCode, 101);
  } finally {
    await wsServer.close();
  }
});

test('end-to-end MCP bridge over 127.0.0.1:0 + Node 24 WebSocket + stdio JSON-RPC', async () => {
  const wsServer = await startBridgeWsServer({ port: 0 });
  const inputStream = new PassThrough();
  const outputStream = new PassThrough();
  const mcpServer = createMcpServer(wsServer, {
    input: inputStream,
    output: outputStream,
  });
  mcpServer.start();

  const pendingLines: string[] = [];
  const lineWaiters: Array<(line: string) => void> = [];
  let outRemainder = '';

  outputStream.setEncoding('utf8');
  outputStream.on('data', (chunk: string) => {
    outRemainder += chunk;
    let idx = outRemainder.indexOf('\n');
    while (idx !== -1) {
      const line = outRemainder.slice(0, idx).trim();
      outRemainder = outRemainder.slice(idx + 1);
      if (line) {
        const waiter = lineWaiters.shift();
        if (waiter) waiter(line);
        else pendingLines.push(line);
      }
      idx = outRemainder.indexOf('\n');
    }
  });

  function readNextJsonRpc(): Promise<JsonRpcResponse> {
    if (pendingLines.length > 0) {
      return Promise.resolve(JSON.parse(pendingLines.shift()!) as JsonRpcResponse);
    }
    return new Promise((resolve) => {
      lineWaiters.push((line) => resolve(JSON.parse(line) as JsonRpcResponse));
    });
  }

  function sendJsonRpc(message: Record<string, unknown>): void {
    inputStream.write(`${JSON.stringify(message)}\n`);
  }

  const { handlers, savedMods, getPickerCount } = createMockHandlers();
  const bridgeClient = createMcpBridgeClient(handlers, globalThis.WebSocket, {
    keepaliveMs: 1_000,
    baseReconnectMs: 100,
  });

  try {
    // 1. MCP initialize + notifications/initialized + ping + tools/list
    sendJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'claude-code-test', version: '1.0.0' },
      },
    });
    const initRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    assert.equal(initRes.id, 1);
    assert.deepEqual((initRes.result as { serverInfo: { name: string } }).serverInfo.name, 'pagecraft-mcp');

    // Notification produces NO response
    sendJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });

    sendJsonRpc({ jsonrpc: '2.0', id: 2, method: 'ping' });
    const pingRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    assert.equal(pingRes.id, 2);
    assert.deepEqual(pingRes.result, {});

    sendJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const listRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const listedTools = (listRes.result as { tools: typeof PAGECRAFT_MCP_TOOLS }).tools;
    assert.equal(listedTools.length, 7);
    assert.deepEqual(
      listedTools.map((t) => t.name),
      [
        'pagecraft_get_active_page',
        'pagecraft_get_picked_element',
        'pagecraft_trigger_picker',
        'pagecraft_verify_selectors',
        'pagecraft_apply_mod',
        'pagecraft_list_mods',
        'pagecraft_toggle_mod',
      ],
    );

    // 2. Calling a tool BEFORE extension connects returns actionable isError: true guidance
    sendJsonRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'pagecraft_get_active_page', arguments: {} },
    });
    const disconnectedRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const disconnectedBody = disconnectedRes.result as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    assert.equal(disconnectedBody.isError, true);
    assert.match(disconnectedBody.content[0]?.text ?? '', /Local Agent Bridge \(MCP\)/);
    assert.match(disconnectedBody.content[0]?.text ?? '', /SidePanel/);

    // 3. Connect extension bridge client using Node 24's global WebSocket
    const connectedStatus = await bridgeClient.connect({
      enabled: true,
      wsUrl: wsServer.wsUrl,
    });
    assert.equal(connectedStatus.connected, true);
    assert.equal(wsServer.isExtensionConnected(), true);

    // Verify server->client RFC 6455 Ping frame keeps connection healthy
    assert.equal(wsServer.sendPingFrame(Buffer.from('healthcheck')), true);

    // 4. Call pagecraft_get_picked_element (exercises nested pickedElement.screenshotDataUrl >100KB frame + base64 placeholder stripping + MCP image block)
    sendJsonRpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'pagecraft_get_picked_element', arguments: {} },
    });
    const pickedRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const pickedResult = pickedRes.result as {
      isError?: boolean;
      content: Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
    };
    assert.equal(pickedResult.isError, undefined);
    assert.equal(pickedResult.content.length, 2);
    assert.equal(pickedResult.content[0]!.text!.includes('data:image/png;base64,'), false);
    const pickedJson = JSON.parse(pickedResult.content[0]!.text!) as {
      pickedElement: {
        selector: string;
        similarSelector: string;
        screenshotDataUrl: string;
      };
    };
    assert.equal(pickedJson.pickedElement.selector, 'aside.ad-rail');
    assert.equal(pickedJson.pickedElement.similarSelector, 'aside[class*="rail"]');
    assert.equal(pickedJson.pickedElement.screenshotDataUrl, '[attached as MCP image]');
    assert.equal(pickedResult.content[1]!.type, 'image');
    assert.equal(pickedResult.content[1]!.mimeType, 'image/png');
    assert.ok((pickedResult.content[1]!.data?.length ?? 0) > 100_000);

    // 5. Call pagecraft_verify_selectors
    sendJsonRpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'pagecraft_verify_selectors',
        arguments: { selectors: ['aside.ad-rail', '.nonexistent-widget'] },
      },
    });
    const verifyRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const verifyPayload = JSON.parse(
      (verifyRes.result as { content: Array<{ text: string }> }).content[0]!.text,
    ) as { totalHits: number; results: Array<{ selector: string; count: number }> };
    assert.equal(verifyPayload.totalHits, 1);
    assert.deepEqual(verifyPayload.results, [
      { selector: 'aside.ad-rail', count: 1 },
      { selector: '.nonexistent-widget', count: 0 },
    ]);

    // 6. Call pagecraft_apply_mod
    sendJsonRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'pagecraft_apply_mod',
        arguments: {
          name: 'Clean Dashboard Ad Rail',
          description: 'Hides right-hand ad rail and expands feed',
          engine: 'css',
          body: 'aside.ad-rail { display: none !important; }',
          targetSelectors: ['aside.ad-rail'],
        },
      },
    });
    const applyRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const applyPayload = JSON.parse(
      (applyRes.result as { content: Array<{ text: string }> }).content[0]!.text,
    ) as { applied: boolean; mod: { id: string; name: string } };
    assert.equal(applyPayload.applied, true);
    assert.equal(applyPayload.mod.name, 'Clean Dashboard Ad Rail');
    assert.equal(savedMods.length, 2);

    // 7. Call pagecraft_get_active_page, pagecraft_trigger_picker, pagecraft_list_mods, pagecraft_toggle_mod
    sendJsonRpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'pagecraft_get_active_page', arguments: {} },
    });
    const pageRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const pagePayload = JSON.parse(
      (pageRes.result as { content: Array<{ text: string }> }).content[0]!.text,
    ) as { url: string; activeMods: unknown[] };
    assert.equal(pagePayload.url, 'https://app.example.com/dashboard');
    assert.equal(pagePayload.activeMods.length, 2);

    sendJsonRpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'pagecraft_trigger_picker', arguments: {} },
    });
    await readNextJsonRpc();
    assert.equal(getPickerCount(), 1);

    sendJsonRpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'pagecraft_toggle_mod',
        arguments: { id: applyPayload.mod.id, enabled: false },
      },
    });
    const toggleRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const togglePayload = JSON.parse(
      (toggleRes.result as { content: Array<{ text: string }> }).content[0]!.text,
    ) as { id: string; enabled: boolean };
    assert.equal(togglePayload.enabled, false);

    sendJsonRpc({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'pagecraft_list_mods', arguments: {} },
    });
    const listModsRes = (await readNextJsonRpc()) as JsonRpcSuccessResponse;
    const listModsPayload = JSON.parse(
      (listModsRes.result as { content: Array<{ text: string }> }).content[0]!.text,
    ) as { mods: Array<{ id: string; enabled: boolean }> };
    assert.equal(listModsPayload.mods.length, 2);
    assert.equal(listModsPayload.mods[1]?.enabled, false);

    // 8. Cleanly disabling bridge closes connection immediately
    bridgeClient.configure({ enabled: false });
    assert.equal(bridgeClient.getStatus().connected, false);
  } finally {
    bridgeClient.disconnect();
    mcpServer.stop();
    await wsServer.close();
  }
});

test('PAGECRAFT_MCP_TOKEN rejects mismatched or missing tokens and accepts matching token', async () => {
  const wsServer = await startBridgeWsServer({
    port: 0,
    token: 'pc-shared-secret-2026',
  });
  const { handlers } = createMockHandlers();
  const client = createMcpBridgeClient(handlers, globalThis.WebSocket);

  try {
    // Missing token -> rejected
    await assert.rejects(
      () => client.connect({ enabled: true, wsUrl: wsServer.wsUrl }),
      /Unauthorized|invalid or missing PAGECRAFT_MCP_TOKEN/i,
    );
    assert.equal(client.getStatus().connected, false);
    assert.equal(wsServer.isExtensionConnected(), false);

    // Wrong token -> rejected
    await assert.rejects(
      () => client.connect({ enabled: true, wsUrl: wsServer.wsUrl, token: 'wrong-token' }),
      /Unauthorized|invalid or missing PAGECRAFT_MCP_TOKEN/i,
    );
    assert.equal(client.getStatus().connected, false);
    assert.equal(wsServer.isExtensionConnected(), false);

    // Matching token -> accepted & RPC succeeds
    const okStatus = await client.connect({
      enabled: true,
      wsUrl: wsServer.wsUrl,
      token: 'pc-shared-secret-2026',
    });
    assert.equal(okStatus.connected, true);
    assert.equal(wsServer.isExtensionConnected(), true);

    const activePage = (await wsServer.callExtension('getActivePage')) as { url: string };
    assert.equal(activePage.url, 'https://app.example.com/dashboard');
  } finally {
    client.disconnect();
    await wsServer.close();
  }
});

test('RFC 6455 fragmented masked frames, interleaved Ping/Pong, and RPC timeout work cleanly', async () => {
  const wsServer = await startBridgeWsServer({
    port: 0,
    requestTimeoutMs: 120,
  });

  const rawSocket = net.connect(wsServer.port, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      rawSocket.once('connect', resolve);
      rawSocket.once('error', reject);
    });

    const key = crypto.randomBytes(16).toString('base64');
    rawSocket.write(
      `GET / HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${wsServer.port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Origin: chrome-extension://pagecraftextid\r\n\r\n`,
    );

    const receivedFrames: Array<{ opcode: number; payload: Buffer }> = [];
    const frameWaiters: Array<() => void> = [];
    let sockBuf = Buffer.alloc(0);
    let upgraded = false;

    rawSocket.on('data', (chunk: Buffer) => {
      sockBuf = Buffer.concat([sockBuf, chunk]);
      if (!upgraded) {
        const idx = sockBuf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const headerStr = sockBuf.subarray(0, idx).toString('utf8');
        assert.match(headerStr, /^HTTP\/1\.1 101 /);
        sockBuf = Buffer.from(sockBuf.subarray(idx + 4));
        upgraded = true;
      }

      while (sockBuf.length >= 2) {
        const b0 = sockBuf[0]!;
        const b1 = sockBuf[1]!;
        const opcode = b0 & 0x0f;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (sockBuf.length < 4) return;
          len = sockBuf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (sockBuf.length < 10) return;
          len = Number(sockBuf.readBigUInt64BE(2));
          offset = 10;
        }
        if (sockBuf.length < offset + len) return;
        const payload = Buffer.from(sockBuf.subarray(offset, offset + len));
        sockBuf = Buffer.from(sockBuf.subarray(offset + len));
        receivedFrames.push({ opcode, payload });
        const notify = frameWaiters.shift();
        if (notify) notify();
      }
    });

    const waitNextFrame = async () => {
      if (receivedFrames.length > 0) return receivedFrames.shift()!;
      await new Promise<void>((resolve) => frameWaiters.push(resolve));
      return receivedFrames.shift()!;
    };

    // Send hello split across 2 fragmented frames + an interleaved Ping control frame!
    const helloJson = JSON.stringify({ type: 'hello', client: 'pagecraft-extension' });
    const part1 = Buffer.from(helloJson.slice(0, 15), 'utf8');
    const part2 = Buffer.from(helloJson.slice(15), 'utf8');

    rawSocket.write(buildMaskedClientFrame(0x1, part1, false)); // FIN=0 text start
    rawSocket.write(buildMaskedClientFrame(0x9, Buffer.from('ping-mid-frag'), true)); // Interleaved Ping
    rawSocket.write(buildMaskedClientFrame(0x0, part2, true)); // FIN=1 continuation

    const firstReply = await waitNextFrame();
    assert.equal(firstReply.opcode, 0x0a); // Pong for interleaved ping
    assert.equal(firstReply.payload.toString('utf8'), 'ping-mid-frag');

    const secondReply = await waitNextFrame();
    assert.equal(secondReply.opcode, 0x1); // hello_ack
    assert.deepEqual(JSON.parse(secondReply.payload.toString('utf8')), {
      type: 'hello_ack',
      ok: true,
    });

    assert.equal(wsServer.isExtensionConnected(), true);

    // Verify RPC timeout when client intentionally does not answer rpc_request
    const rpcPromise = wsServer.callExtension('getActivePage', undefined, 80);
    const reqFrame = await waitNextFrame();
    assert.equal(reqFrame.opcode, 0x1);
    await assert.rejects(() => rpcPromise, /Timed out after 80ms/);
  } finally {
    rawSocket.destroy();
    await wsServer.close();
  }
});

test('cli.ts runs with zero external dependencies and keeps stdout strictly pure JSON-RPC', async () => {
  // Find an available ephemeral port first so we know CLI can bind without colliding with 17321
  const freePort = await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      const p = addr.port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });

  const child = spawn(process.execPath, ['--experimental-strip-types', CLI_PATH], {
    env: {
      ...process.env,
      PAGECRAFT_MCP_PORT: String(freePort),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutText = '';
  let stderrText = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrText += chunk;
  });

  try {
    const firstStdoutLine = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI timed out; stderr=${stderrText}`)), 5000);
      child.stdout.on('data', (chunk: string) => {
        stdoutText += chunk;
        const nl = stdoutText.indexOf('\n');
        if (nl !== -1) {
          clearTimeout(timer);
          resolve(stdoutText.slice(0, nl));
        }
      });
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cli-test', version: '1.0' } },
      })}\n`,
    );

    const line = await firstStdoutLine;
    const parsed = JSON.parse(line) as JsonRpcSuccessResponse;
    assert.equal(parsed.jsonrpc, '2.0');
    assert.equal(parsed.id, 42);
    assert.match(stderrText, /Listening strictly on ws:\/\/127\.0\.0\.1:/);
  } finally {
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  }
});

test('bridge-client auto-reconnects when ws-server restarts and mcp-server supports Content-Length framing', async () => {
  let wsServer = await startBridgeWsServer({ port: 0 });
  const port = wsServer.port;
  const { handlers } = createMockHandlers();
  const client = createMcpBridgeClient(handlers, globalThis.WebSocket, {
    baseReconnectMs: 60,
    maxReconnectMs: 250,
    keepaliveMs: 500,
  });

  try {
    await client.connect({ enabled: true, wsUrl: `ws://127.0.0.1:${port}` });
    assert.equal(client.getStatus().connected, true);

    // Shut down server and wait for client disconnect detection
    await wsServer.close();
    await new Promise<void>((resolve) => {
      if (!client.getStatus().connected) {
        resolve();
        return;
      }
      const unsub = client.onStatusChange((s) => {
        if (!s.connected) {
          unsub();
          resolve();
        }
      });
    });
    assert.equal(client.getStatus().connected, false);

    // Restart server on the same port and verify automatic exponential-backoff reconnect
    wsServer = await startBridgeWsServer({ port });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Auto-reconnect timed out')), 3000);
      if (client.getStatus().connected && wsServer.isExtensionConnected()) {
        clearTimeout(timer);
        resolve();
        return;
      }
      const unsub = client.onStatusChange((s) => {
        if (s.connected) {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
    assert.equal(client.getStatus().connected, true);
    assert.equal(wsServer.isExtensionConnected(), true);

    // Verify manual client.reconnect() cleanly replaces socket and re-authenticates
    const reconnectingSnap = client.reconnect();
    assert.equal(reconnectingSnap.enabled, true);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Manual reconnect timed out')), 3000);
      if (client.getStatus().connected && wsServer.isExtensionConnected()) {
        clearTimeout(timer);
        resolve();
        return;
      }
      const unsub = client.onStatusChange((s) => {
        if (s.connected) {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
    assert.equal(client.getStatus().connected, true);

    // Also test Content-Length framing on mcp-server
    const input = new PassThrough();
    const output = new PassThrough();
    const mcp = createMcpServer(wsServer, { input, output });
    mcp.start();

    const outPromise = new Promise<string>((resolve) => {
      let acc = '';
      output.setEncoding('utf8');
      output.on('data', (chunk: string) => {
        acc += chunk;
        const headerEnd = acc.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const lenMatch = /Content-Length:\s*(\d+)/i.exec(acc.slice(0, headerEnd));
          const len = Number(lenMatch?.[1] ?? 0);
          const body = acc.slice(headerEnd + 4);
          if (Buffer.byteLength(body, 'utf8') >= len) {
            resolve(body);
          }
        }
      });
    });

    const reqBody = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' });
    input.write(`Content-Length: ${Buffer.byteLength(reqBody, 'utf8')}\r\n\r\n${reqBody}`);
    const rawReply = await outPromise;
    assert.deepEqual(JSON.parse(rawReply), { jsonrpc: '2.0', id: 99, result: {} });
    mcp.stop();
  } finally {
    client.disconnect();
    await wsServer.close();
  }
});

test('compiled packages/mcp/dist/cli.js matches npm package.json bin and executes cleanly', async () => {
  const fs = await import('node:fs');
  const pkgJsonPath = path.join(ROOT_DIR, 'packages/mcp/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
    name: string;
    version: string;
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
  };

  assert.equal(pkg.name, 'pagecraft-mcp');
  assert.equal(pkg.bin?.['pagecraft-mcp'], 'dist/cli.js');
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);

  const distCliPath = path.join(ROOT_DIR, 'packages/mcp/dist/cli.js');
  assert.equal(fs.existsSync(distCliPath), true, 'packages/mcp/dist/cli.js must exist after mcp:build');

  const stderrOut = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [distCliPath, '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stderr.trim());
      else reject(new Error(`dist/cli.js exited with code ${code}: ${stderr}`));
    });
  });

  assert.equal(stderrOut, `pagecraft-mcp v${pkg.version}`);
});
