export type AIMode = 'cloud' | 'byok';

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels?: string[];
}

export interface CloudQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface CloudTrialState {
  /** Random install ID minted locally on first cloud trial call. */
  installId?: string;
  /** Per-backend HMAC signing secrets issued by POST /api/register. */
  installSecrets?: Record<string, string>;
  /** Optional custom Worker endpoint override (defaults to DEFAULT_CLOUD_ENDPOINT). */
  endpoint?: string;
  /** Last known cloud trial quota snapshot for instant UI display. */
  quota?: CloudQuota;
}

export interface AppSettings {
  aiMode: AIMode;
  ai: AIConfig;
  cloud: CloudTrialState;
  onboardingDone?: boolean;
  /** True once the user completes or skips the 3-step interactive Studio tutorial. */
  tutorialDone?: boolean;
}

export const STORAGE_KEYS = {
  SETTINGS: 'pc_settings',
} as const;
