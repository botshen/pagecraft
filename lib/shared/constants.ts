import type { AppSettings } from '../types';

export const STORAGE_KEYS = {
  SETTINGS: 'pc_settings',
} as const;

/** Official static website & recipe deep-link host (zero backend, GitHub Pages / static CDN). */
export const DEFAULT_SITE_URL = 'https://pagecraft.shenxin.space';

/** Official interactive 20-second sandbox target page for first-time practice. */
export const DEFAULT_PRACTICE_URL = `${DEFAULT_SITE_URL}/playground`;

/** Default loopback WebSocket endpoint for local `pagecraft-mcp` coding agent bridge. */
export const DEFAULT_MCP_BRIDGE_URL = 'ws://127.0.0.1:17321';

export const DEFAULT_SETTINGS: AppSettings = {
  aiMode: 'byok',
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  enableVisionCapture: true,
  enableAutoHeal: true,
  mcpBridgeEnabled: false,
  mcpBridgeUrl: DEFAULT_MCP_BRIDGE_URL,
  mcpBridgeToken: '',
  onboardingDone: false,
  tutorialDone: false,
};
