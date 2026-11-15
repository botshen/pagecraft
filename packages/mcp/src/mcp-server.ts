/**
 * Standard Model Context Protocol (MCP) JSON-RPC 2.0 server over `stdio`.
 *
 * Implements:
 * - `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`
 * - Standard MCP newline-delimited JSON-RPC 2.0 framing (plus transparent support
 *   for `Content-Length` framing when sent by legacy/LSP-style MCP hosts)
 * - 7 live browser customization & inspection tools backed by PageCraft's
 *   `127.0.0.1` WebSocket bridge
 */

import type { Readable, Writable } from 'node:stream';
import { BridgeNotConnectedError, type BridgeWsServer } from './ws-server.ts';
import type { McpApplyModInput } from '../../../lib/mcp/types.ts';

export const MCP_SERVER_NAME = 'pagecraft-mcp';
export const MCP_SERVER_VERSION = '0.2.0';
export const DEFAULT_MCP_PROTOCOL_VERSION = '2024-11-05';

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export type McpToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface McpCallToolResult {
  content: McpToolContentBlock[];
  isError?: boolean;
}

export const PAGECRAFT_MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'pagecraft_get_active_page',
    description:
      'Get the active browser tab URL, title, live DOM skeleton, and currently active PageCraft mods.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'pagecraft_get_picked_element',
    description:
      "Get the element selected by the user with PageCraft's visual Element Picker, including its primary CSS selector, sibling list selector, PII-redacted DOM snippet, computed styles, bounding rect, and optional cropped screenshot.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'pagecraft_trigger_picker',
    description:
      'Launch the visual Element Picker overlay in the active browser tab so the user can point-and-click an element to inspect or customize.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'pagecraft_verify_selectors',
    description:
      'Test candidate CSS selectors against the live authenticated webpage via querySelectorAll and return real-time element hit counts before committing a mod.',
    inputSchema: {
      type: 'object',
      properties: {
        selectors: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Array of candidate CSS selectors to probe on the active browser tab.',
        },
      },
      required: ['selectors'],
      additionalProperties: false,
    },
  },
  {
    name: 'pagecraft_apply_mod',
    description:
      'Hot-inject (instant chrome.scripting.insertCSS or isolated MV3 chrome.userScripts) and save a CSS/JS mod to the live webpage, returning the saved mod and live selector verification results.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short human-readable title for the PageCraft mod.',
        },
        description: {
          type: 'string',
          description: 'Optional description explaining what this mod customizes.',
        },
        engine: {
          type: 'string',
          enum: ['css', 'js'],
          description:
            "Execution engine: 'css' (instant stylesheet injection, preferred for layout/hiding/theming) or 'js' (isolated USER_SCRIPT world for DOM scripting).",
        },
        matches: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional Chrome match patterns (e.g. ["https://*.github.com/*"]). Defaults to the active tab host when omitted.',
        },
        body: {
          type: 'string',
          description:
            "Raw CSS stylesheet when engine is 'css', or executable JS body (without ==UserScript== metadata block) when engine is 'js'.",
        },
        targetSelectors: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional primary CSS selectors targeted by this mod for immediate live hit verification.',
        },
      },
      required: ['name', 'engine', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'pagecraft_list_mods',
    description:
      'List all saved PageCraft CSS and JS mods in the browser extension, including IDs, match patterns, engines, and enabled states.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'pagecraft_toggle_mod',
    description: 'Enable or pause a saved PageCraft mod by ID with immediate effect on open tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique ID of the saved PageCraft mod.',
        },
        enabled: {
          type: 'boolean',
          description: 'True to enable and inject the mod; false to pause and remove it.',
        },
      },
      required: ['id', 'enabled'],
      additionalProperties: false,
    },
  },
];

const DATA_IMAGE_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;
const IMAGE_FIELD_KEYS = ['screenshotDataUrl', 'imageDataUrl', 'screenshot'] as const;
const ATTACHED_IMAGE_PLACEHOLDER = '[attached as MCP image]';

function extractAndStripOptionalImage(result: unknown): {
  sanitizedResult: unknown;
  imageBlock: McpToolContentBlock | null;
} {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { sanitizedResult: result, imageBlock: null };
  }

  const record = result as Record<string, unknown>;

  for (const key of IMAGE_FIELD_KEYS) {
    const cand = record[key];
    if (typeof cand !== 'string') continue;
    const match = DATA_IMAGE_URL_RE.exec(cand.trim());
    if (match && match[1] && match[2]) {
      return {
        sanitizedResult: {
          ...record,
          [key]: ATTACHED_IMAGE_PLACEHOLDER,
        },
        imageBlock: {
          type: 'image',
          mimeType: match[1].toLowerCase(),
          data: match[2].replace(/\s+/g, ''),
        },
      };
    }
  }

  const nestedPicked = record.pickedElement;
  if (nestedPicked && typeof nestedPicked === 'object' && !Array.isArray(nestedPicked)) {
    const pickedRecord = nestedPicked as Record<string, unknown>;
    for (const key of IMAGE_FIELD_KEYS) {
      const cand = pickedRecord[key];
      if (typeof cand !== 'string') continue;
      const match = DATA_IMAGE_URL_RE.exec(cand.trim());
      if (match && match[1] && match[2]) {
        return {
          sanitizedResult: {
            ...record,
            pickedElement: {
              ...pickedRecord,
              [key]: ATTACHED_IMAGE_PLACEHOLDER,
            },
          },
          imageBlock: {
            type: 'image',
            mimeType: match[1].toLowerCase(),
            data: match[2].replace(/\s+/g, ''),
          },
        };
      }
    }
  }

  return { sanitizedResult: result, imageBlock: null };
}

function formatDisconnectedGuidance(wsUrl: string): string {
  return [
    `PageCraft browser extension is not connected to the local MCP bridge (${wsUrl}).`,
    '',
    'To connect PageCraft:',
    '1. Open Chrome or Edge with the PageCraft extension installed.',
    '2. Open the PageCraft SidePanel -> Settings.',
    `3. Enable "Local Agent Bridge (MCP)" and verify the WebSocket URL is ${wsUrl} (plus matching token if PAGECRAFT_MCP_TOKEN is configured).`,
  ].join('\n');
}

function makeToolError(text: string): McpCallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

function makeToolSuccess(result: unknown): McpCallToolResult {
  const { sanitizedResult, imageBlock } = extractAndStripOptionalImage(result);
  const serialized =
    typeof sanitizedResult === 'string'
      ? sanitizedResult
      : JSON.stringify(sanitizedResult ?? null, null, 2);
  const content: McpToolContentBlock[] = [{ type: 'text', text: serialized }];
  if (imageBlock) {
    content.push(imageBlock);
  }
  return { content };
}

export interface McpServerOptions {
  input?: Readable;
  output?: Writable;
  onLog?: (message: string) => void;
}

export interface McpServer {
  /** Process a parsed JSON-RPC 2.0 request/notification directly and return response (or null for notifications). */
  handleMessage: (rawMessage: unknown) => Promise<JsonRpcResponse | null>;
  /** Attach stdio stream listeners to read JSON-RPC messages and write responses. */
  start: () => void;
  /** Detach stdio stream listeners cleanly. */
  stop: () => void;
}

export function createMcpServer(
  bridge: Pick<BridgeWsServer, 'wsUrl' | 'isExtensionConnected' | 'callExtension'>,
  options: McpServerOptions = {},
): McpServer {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const log = options.onLog ?? (() => {});

  let started = false;
  let useContentLengthFraming = false;
  let recvBuffer: Buffer = Buffer.alloc(0);

  async function executeToolCall(
    toolName: string,
    rawArgs: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    if (!bridge.isExtensionConnected()) {
      return makeToolError(formatDisconnectedGuidance(bridge.wsUrl));
    }

    try {
      switch (toolName) {
        case 'pagecraft_get_active_page': {
          const res = await bridge.callExtension('getActivePage');
          return makeToolSuccess(res);
        }

        case 'pagecraft_get_picked_element': {
          const res = await bridge.callExtension('getPickedElement');
          return makeToolSuccess(res);
        }

        case 'pagecraft_trigger_picker': {
          const res = await bridge.callExtension('triggerPicker');
          return makeToolSuccess(res);
        }

        case 'pagecraft_verify_selectors': {
          const rawSelectors = rawArgs.selectors;
          if (!Array.isArray(rawSelectors) || rawSelectors.length === 0) {
            return makeToolError(
              'Invalid arguments for pagecraft_verify_selectors: "selectors" must be a non-empty array of CSS selector strings.',
            );
          }
          const selectors = rawSelectors
            .filter((item): item is string => typeof item === 'string')
            .map((s) => s.trim())
            .filter(Boolean);
          if (selectors.length === 0) {
            return makeToolError(
              'Invalid arguments for pagecraft_verify_selectors: provide at least one non-empty CSS selector.',
            );
          }
          const res = await bridge.callExtension('verifySelectors', { selectors });
          return makeToolSuccess(res);
        }

        case 'pagecraft_apply_mod': {
          const name = typeof rawArgs.name === 'string' ? rawArgs.name.trim() : '';
          const engine = rawArgs.engine;
          const body = typeof rawArgs.body === 'string' ? rawArgs.body : '';

          if (!name) {
            return makeToolError('Invalid arguments for pagecraft_apply_mod: "name" is required.');
          }
          if (engine !== 'css' && engine !== 'js') {
            return makeToolError(
              'Invalid arguments for pagecraft_apply_mod: "engine" must be "css" or "js".',
            );
          }
          if (!body.trim()) {
            return makeToolError(
              'Invalid arguments for pagecraft_apply_mod: "body" must be non-empty CSS or JS code.',
            );
          }

          const modInput: McpApplyModInput = {
            name,
            engine,
            body,
          };
          if (typeof rawArgs.description === 'string') {
            modInput.description = rawArgs.description;
          }
          if (Array.isArray(rawArgs.matches)) {
            modInput.matches = rawArgs.matches.filter((m): m is string => typeof m === 'string');
          }
          if (Array.isArray(rawArgs.targetSelectors)) {
            modInput.targetSelectors = rawArgs.targetSelectors.filter(
              (s): s is string => typeof s === 'string',
            );
          }

          const res = await bridge.callExtension(
            'applyMod',
            modInput as unknown as Record<string, unknown>,
          );
          return makeToolSuccess(res);
        }

        case 'pagecraft_list_mods': {
          const res = await bridge.callExtension('listMods');
          return makeToolSuccess(res);
        }

        case 'pagecraft_toggle_mod': {
          const id = typeof rawArgs.id === 'string' ? rawArgs.id.trim() : '';
          const enabled = rawArgs.enabled;
          if (!id || typeof enabled !== 'boolean') {
            return makeToolError(
              'Invalid arguments for pagecraft_toggle_mod: "id" (non-empty string) and "enabled" (boolean) are required.',
            );
          }
          const res = await bridge.callExtension('toggleMod', { id, enabled });
          return makeToolSuccess(res);
        }

        default: {
          return makeToolError(`Unknown tool: ${toolName}`);
        }
      }
    } catch (err) {
      if (err instanceof BridgeNotConnectedError) {
        return makeToolError(formatDisconnectedGuidance(bridge.wsUrl));
      }
      const msg = err instanceof Error ? err.message : String(err);
      return makeToolError(`PageCraft tool execution failed: ${msg}`);
    }
  }

  async function handleMessage(rawMessage: unknown): Promise<JsonRpcResponse | null> {
    if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

    const msg = rawMessage as Record<string, unknown>;
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== undefined;
    const id: JsonRpcId =
      typeof msg.id === 'string' || typeof msg.id === 'number' || msg.id === null
        ? msg.id
        : null;
    const method = msg.method;

    if (msg.jsonrpc !== '2.0' || typeof method !== 'string' || !method) {
      if (!hasId) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      };
    }

    // Notifications (no `id`) never emit a response per JSON-RPC 2.0 & MCP spec
    if (!hasId) {
      return null;
    }

    const params =
      msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)
        ? (msg.params as Record<string, unknown>)
        : {};

    switch (method) {
      case 'initialize': {
        const requestedVersion =
          typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
          ? requestedVersion
          : DEFAULT_MCP_PROTOCOL_VERSION;

        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: negotiatedVersion,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: MCP_SERVER_NAME,
              version: MCP_SERVER_VERSION,
            },
            instructions:
              'Connects coding agents directly to PageCraft in your live browser over 127.0.0.1. Inspect live authenticated DOM & picked elements, verify CSS selectors before committing, and hot-apply CSS or isolated JS mods.',
          },
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: PAGECRAFT_MCP_TOOLS,
          },
        };
      }

      case 'tools/call': {
        const toolName = typeof params.name === 'string' ? params.name : '';
        const knownTool = PAGECRAFT_MCP_TOOLS.some((t) => t.name === toolName);
        if (!knownTool) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Unknown MCP tool: "${toolName}"`,
            },
          };
        }

        const rawArgs =
          params.arguments &&
          typeof params.arguments === 'object' &&
          !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};

        const toolResult = await executeToolCall(toolName, rawArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: toolResult,
        };
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: { resources: [] },
        };
      }

      case 'prompts/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: { prompts: [] },
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }
    }
  }

  function writeOutput(payload: JsonRpcResponse | JsonRpcResponse[]): void {
    const serialized = JSON.stringify(payload);
    if (useContentLengthFraming) {
      const byteLength = Buffer.byteLength(serialized, 'utf8');
      output.write(`Content-Length: ${byteLength}\r\n\r\n${serialized}`);
    } else {
      output.write(`${serialized}\n`);
    }
  }

  async function dispatchRawJsonText(rawText: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      writeOutput({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        writeOutput({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request' },
        });
        return;
      }
      const responses = (await Promise.all(parsed.map((item) => handleMessage(item)))).filter(
        (res): res is JsonRpcResponse => res !== null,
      );
      if (responses.length > 0) {
        writeOutput(responses);
      }
      return;
    }

    const response = await handleMessage(parsed);
    if (response !== null) {
      writeOutput(response);
    }
  }

  function drainInputBuffer(): void {
    while (recvBuffer.length > 0) {
      // Trim leading CR/LF whitespace between frames
      let trimIdx = 0;
      while (
        trimIdx < recvBuffer.length &&
        (recvBuffer[trimIdx] === 0x0d || recvBuffer[trimIdx] === 0x0a)
      ) {
        trimIdx += 1;
      }
      if (trimIdx > 0) {
        recvBuffer = Buffer.from(recvBuffer.subarray(trimIdx));
      }
      if (recvBuffer.length === 0) return;

      // Check for optional Content-Length header framing
      const headerProbe = recvBuffer
        .subarray(0, Math.min(recvBuffer.length, 32))
        .toString('ascii');
      if (/^content-length:/i.test(headerProbe)) {
        const headerEnd = recvBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return; // Wait for complete header block
        }
        const headerText = recvBuffer.subarray(0, headerEnd).toString('ascii');
        const lenMatch = /content-length:\s*(\d+)/i.exec(headerText);
        if (!lenMatch || !lenMatch[1]) {
          log('[pagecraft-mcp] Malformed Content-Length header on stdin');
          recvBuffer = Buffer.from(recvBuffer.subarray(headerEnd + 4));
          continue;
        }
        const bodyBytes = Number(lenMatch[1]);
        const bodyStart = headerEnd + 4;
        if (recvBuffer.length < bodyStart + bodyBytes) {
          return; // Wait for complete body
        }
        useContentLengthFraming = true;
        const bodyText = recvBuffer.subarray(bodyStart, bodyStart + bodyBytes).toString('utf8');
        recvBuffer = Buffer.from(recvBuffer.subarray(bodyStart + bodyBytes));
        void dispatchRawJsonText(bodyText);
        continue;
      }

      // Standard MCP newline-delimited JSON framing
      const newlineIdx = recvBuffer.indexOf(0x0a);
      if (newlineIdx === -1) {
        return; // Wait for trailing newline
      }
      const lineText = recvBuffer.subarray(0, newlineIdx).toString('utf8').trim();
      recvBuffer = Buffer.from(recvBuffer.subarray(newlineIdx + 1));
      if (!lineText) continue;
      useContentLengthFraming = false;
      void dispatchRawJsonText(lineText);
    }
  }

  const onData = (chunk: Buffer | string) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    recvBuffer = recvBuffer.length === 0 ? buf : Buffer.concat([recvBuffer, buf]);
    drainInputBuffer();
  };

  return {
    handleMessage,
    start(): void {
      if (started) return;
      started = true;
      input.on('data', onData);
      if (typeof input.resume === 'function') {
        input.resume();
      }
    },
    stop(): void {
      if (!started) return;
      started = false;
      input.off('data', onData);
    },
  };
}
