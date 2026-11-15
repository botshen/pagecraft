/**
 * Shared types and wire protocol contract for the PageCraft Local Agent MCP Bridge.
 *
 * All traffic stays strictly on local loopback (`127.0.0.1` / `localhost` / `[::1]`)
 * between the PageCraft browser extension and the local `pagecraft-mcp` stdio server.
 */

export const DEFAULT_MCP_PORT = 17321;
export const DEFAULT_MCP_WS_URL = 'ws://127.0.0.1:17321';

export interface McpBridgeConfig {
  enabled: boolean;
  wsUrl?: string;
  token?: string;
}

export interface McpBridgeStatus {
  enabled: boolean;
  connected: boolean;
  wsUrl: string;
  lastError?: string;
}

export interface McpApplyModInput {
  name: string;
  description?: string;
  engine: 'css' | 'js';
  matches?: string[];
  body: string;
  targetSelectors?: string[];
}

export interface McpToolHandlers {
  getActivePage: () => Promise<unknown>;
  getPickedElement: () => Promise<unknown>;
  triggerPicker: () => Promise<unknown>;
  verifySelectors: (selectors: string[]) => Promise<unknown>;
  applyMod: (input: McpApplyModInput) => Promise<unknown>;
  listMods: () => Promise<unknown>;
  toggleMod: (id: string, enabled: boolean) => Promise<unknown>;
}

export type BridgeRpcMethod =
  | 'getActivePage'
  | 'getPickedElement'
  | 'triggerPicker'
  | 'verifySelectors'
  | 'applyMod'
  | 'listMods'
  | 'toggleMod';

export interface BridgeHello {
  type: 'hello';
  client: 'pagecraft-extension';
  token?: string;
  version?: string;
}

export interface BridgeHelloAck {
  type: 'hello_ack';
  ok: boolean;
  error?: string;
}

export interface BridgePing {
  type: 'ping';
  ts: number;
}

export interface BridgePong {
  type: 'pong';
  ts: number;
}

export interface BridgeRpcRequest {
  type: 'rpc_request';
  id: string;
  method: BridgeRpcMethod;
  params?: Record<string, unknown>;
}

export interface BridgeRpcError {
  code: string;
  message: string;
}

export interface BridgeRpcResponse {
  type: 'rpc_response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: BridgeRpcError;
}

export type BridgeClientMessage = BridgeHello | BridgePing | BridgePong | BridgeRpcResponse;
export type BridgeServerMessage = BridgeHelloAck | BridgePing | BridgePong | BridgeRpcRequest;
