import type { AppSettings } from '../../types';

export const STORAGE_KEYS = {
  SETTINGS: 'pc_settings',
} as const;

export const FREE_TRIAL_LIMIT = 10;

/** Default PageCraft Cloud Worker (free-trial AI proxy + anonymous 👍/👎 counters; no browsing data). */
export const DEFAULT_CLOUD_ENDPOINT = 'https://pagecraft.shenxin.space';

/** Official interactive 20-second sandbox target page for first-time practice. */
export const DEFAULT_PRACTICE_URL = `${DEFAULT_CLOUD_ENDPOINT}/playground`;

export const DEFAULT_SETTINGS: AppSettings = {
  aiMode: 'cloud',
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  cloud: {
    endpoint: '',
    quota: {
      used: 0,
      limit: FREE_TRIAL_LIMIT,
      remaining: FREE_TRIAL_LIMIT,
    },
  },
  onboardingDone: false,
  tutorialDone: false,
};
