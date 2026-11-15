/**
 * Atomic settings store backed by `chrome.storage.local`.
 *
 * Serializes read-modify-write cycles through an in-process queue (plus Web
 * Locks when available across extension realms) so concurrent updates from the
 * SidePanel and Background worker never clobber each other's fields.
 */

import type { AiMode, AppSettings, AIConfig } from '../types';
import { DEFAULT_MCP_BRIDGE_URL, DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';

export type SettingsPatch = {
  aiMode?: AiMode;
  ai?: Partial<AIConfig>;
  enableVisionCapture?: boolean;
  enableAutoHeal?: boolean;
  mcpBridgeEnabled?: boolean;
  mcpBridgeUrl?: string;
  mcpBridgeToken?: string;
  onboardingDone?: boolean;
  tutorialDone?: boolean;
};

let lockChain: Promise<void> = Promise.resolve();

function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const runInQueue = (): Promise<T> => {
    const next = lockChain.then(fn, fn);
    lockChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('pagecraft:settings', () => runInQueue()) as Promise<T>;
  }
  return runInQueue();
}

export function normalizeSettings(raw: unknown): AppSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawAi = (obj.ai && typeof obj.ai === 'object' ? obj.ai : {}) as Record<string, unknown>;

  const apiKey = typeof rawAi.apiKey === 'string' ? rawAi.apiKey : DEFAULT_SETTINGS.ai.apiKey;
  const baseUrl =
    typeof rawAi.baseUrl === 'string' && rawAi.baseUrl.trim()
      ? rawAi.baseUrl
      : DEFAULT_SETTINGS.ai.baseUrl;

  // Seamlessly migrate any legacy `'cloud'` or unknown mode to `'byok'`
  const aiMode: AiMode = obj.aiMode === 'builtin' ? 'builtin' : 'byok';

  return {
    aiMode,
    ai: {
      baseUrl,
      apiKey,
      model:
        typeof rawAi.model === 'string' && rawAi.model.trim()
          ? rawAi.model
          : DEFAULT_SETTINGS.ai.model,
      availableModels: Array.isArray(rawAi.availableModels)
        ? rawAi.availableModels.filter((m): m is string => typeof m === 'string')
        : undefined,
    },
    enableVisionCapture:
      typeof obj.enableVisionCapture === 'boolean'
        ? obj.enableVisionCapture
        : DEFAULT_SETTINGS.enableVisionCapture,
    enableAutoHeal:
      typeof obj.enableAutoHeal === 'boolean'
        ? obj.enableAutoHeal
        : DEFAULT_SETTINGS.enableAutoHeal,
    mcpBridgeEnabled:
      typeof obj.mcpBridgeEnabled === 'boolean'
        ? obj.mcpBridgeEnabled
        : DEFAULT_SETTINGS.mcpBridgeEnabled,
    mcpBridgeUrl:
      typeof obj.mcpBridgeUrl === 'string' && obj.mcpBridgeUrl.trim()
        ? obj.mcpBridgeUrl.trim()
        : DEFAULT_MCP_BRIDGE_URL,
    mcpBridgeToken:
      typeof obj.mcpBridgeToken === 'string'
        ? obj.mcpBridgeToken
        : DEFAULT_SETTINGS.mcpBridgeToken,
    onboardingDone: Boolean(obj.onboardingDone),
    tutorialDone: Boolean(obj.tutorialDone),
  };
}

export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  return normalizeSettings({
    ...current,
    ...patch,
    ai: {
      ...current.ai,
      ...(patch.ai ?? {}),
    },
  });
}

function hasChromeLocal(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function storageGetSettingsRaw(): Promise<unknown> {
  if (hasChromeLocal()) {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return res?.[STORAGE_KEYS.SETTINGS];
  }
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return raw ? JSON.parse(raw) : undefined;
  }
  return undefined;
}

async function storageSetSettingsRaw(next: AppSettings): Promise<void> {
  if (hasChromeLocal()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(next));
  }
}

export async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await storageGetSettingsRaw();
    return normalizeSettings(raw);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export async function writeSettings(settings: AppSettings): Promise<AppSettings> {
  return withSettingsLock(async () => {
    const normalized = normalizeSettings(settings);
    await storageSetSettingsRaw(normalized);
    return normalized;
  });
}

export async function updateSettings(
  mutator: (current: AppSettings) => SettingsPatch | Promise<SettingsPatch>,
): Promise<AppSettings> {
  return withSettingsLock(async () => {
    const raw = await storageGetSettingsRaw();
    const current = normalizeSettings(raw);
    const patch = await mutator(current);
    const next = mergeSettings(current, patch);
    await storageSetSettingsRaw(next);
    return next;
  });
}
