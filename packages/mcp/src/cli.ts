#!/usr/bin/env node
/**
 * CLI entrypoint for `pagecraft-mcp` (`@pagecraft/mcp`).
 *
 * Starts:
 * 1. Pure-Node RFC 6455 WebSocket bridge bound strictly to `127.0.0.1`
 *    (default port `17321`, configurable via `PAGECRAFT_MCP_PORT`, optional
 *    shared token via `PAGECRAFT_MCP_TOKEN`).
 * 2. MCP JSON-RPC 2.0 server over `stdio`.
 *
 * IMPORTANT: Diagnostics write EXCLUSIVELY to `process.stderr` — `process.stdout`
 * is reserved strictly for MCP JSON-RPC 2.0 frames.
 */

import { startBridgeWsServer } from './ws-server.ts';
import { createMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './mcp-server.ts';

function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    logStderr(`${MCP_SERVER_NAME} v${MCP_SERVER_VERSION}`);
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    logStderr(
      [
        `${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} — Local Coding Agent MCP Bridge for PageCraft`,
        '',
        'Usage:',
        '  npx -y pagecraft-mcp',
        '  claude mcp add pagecraft -- npx -y pagecraft-mcp',
        '',
        'Environment Variables:',
        '  PAGECRAFT_MCP_PORT   Loopback WebSocket port on 127.0.0.1 (default: 17321)',
        '  PAGECRAFT_MCP_TOKEN  Optional shared token verified on extension handshake',
      ].join('\n'),
    );
    process.exit(0);
  }

  let wsServer: Awaited<ReturnType<typeof startBridgeWsServer>>;
  try {
    wsServer = await startBridgeWsServer({
      onLog: logStderr,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE') {
      logStderr(
        '[pagecraft-mcp] Error: Loopback port is already in use on 127.0.0.1. ' +
          'Another pagecraft-mcp process may already be running, or set PAGECRAFT_MCP_PORT to use a custom port.',
      );
    } else {
      logStderr(
        `[pagecraft-mcp] Failed to start 127.0.0.1 WebSocket server: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(1);
  }

  const mcpServer = createMcpServer(wsServer, {
    input: process.stdin,
    output: process.stdout,
    onLog: logStderr,
  });

  let shuttingDown = false;
  const shutdown = async (exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    mcpServer.stop();
    try {
      await wsServer.close();
    } catch {
      /* ignore close errors on shutdown */
    }
    process.exit(exitCode);
  };

  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
  process.stdin.on('end', () => {
    void shutdown(0);
  });
  process.stdin.on('close', () => {
    void shutdown(0);
  });

  mcpServer.start();
}

void main();
