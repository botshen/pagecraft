export type AiMode = 'byok' | 'builtin';

/** Alias preserved for UI/component imports. */
export type AIMode = AiMode;

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels?: string[];
}

export interface AppSettings {
  aiMode: AiMode;
  ai: AIConfig;
  /** Crop picked element screenshot for vision-capable BYOK/local models (with text-only fallback). */
  enableVisionCapture: boolean;
  /** Run 1-pass automatic selector/syntax self-healing when live page verification finds 0 hits. */
  enableAutoHeal: boolean;
  /** Connect to local pagecraft-mcp WebSocket server on 127.0.0.1. */
  mcpBridgeEnabled: boolean;
  mcpBridgeUrl: string;
  mcpBridgeToken: string;
  onboardingDone?: boolean;
  /** True once the user completes or skips the 3-step interactive Studio tutorial. */
  tutorialDone?: boolean;
}

export const STORAGE_KEYS = {
  SETTINGS: 'pc_settings',
} as const;
