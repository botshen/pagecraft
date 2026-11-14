/**
 * Atomic settings store backed by `chrome.storage.local`.
 *
 * Serializes read-modify-write cycles through an in-process queue (plus Web
 * Locks when available across extension realms) so concurrent updates from the
 * SidePanel and Background worker never clobber each other's fields.
 */

import type { AppSettings, AIConfig, CloudTrialState } from '../../types';
import { DEFAULT_SETTINGS, FREE_TRIAL_LIMIT, STORAGE_KEYS } from './constants';
import { isLocalLoopbackEndpoint } from './ai-endpoints';
import { endpointBase } from './endpoint';

export type SettingsPatch = {
  aiMode?: AppSettings['aiMode'];
  ai?: Partial<AIConfig>;
  cloud?: Partial<CloudTrialState>;
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
  const rawCloud = (
    obj.cloud && typeof obj.cloud === 'object' ? obj.cloud : {}
  ) as Record<string, unknown>;

  const apiKey = typeof rawAi.apiKey === 'string' ? rawAi.apiKey : DEFAULT_SETTINGS.ai.apiKey;
  const baseUrl =
    typeof rawAi.baseUrl === 'string' && rawAi.baseUrl.trim()
      ? rawAi.baseUrl
      : DEFAULT_SETTINGS.ai.baseUrl;
  const aiMode: AppSettings['aiMode'] =
    obj.aiMode === 'byok' || obj.aiMode === 'cloud'
      ? obj.aiMode
      : apiKey.trim().length > 0 || isLocalLoopbackEndpoint(baseUrl)
        ? 'byok'
        : 'cloud';

  const installSecrets: Record<string, string> = {};
  if (rawCloud.installSecrets && typeof rawCloud.installSecrets === 'object') {
    for (const [k, v] of Object.entries(rawCloud.installSecrets as Record<string, unknown>)) {
      const canon = endpointBase(k);
      if (canon && typeof v === 'string' && v) {
        installSecrets[canon] = v;
      }
    }
  }

  const rawQuota = (rawCloud.quota && typeof rawCloud.quota === 'object'
    ? rawCloud.quota
    : null) as Record<string, unknown> | null;
  const limit =
    typeof rawQuota?.limit === 'number' && Number.isFinite(rawQuota.limit) && rawQuota.limit > 0
      ? Math.round(rawQuota.limit)
      : FREE_TRIAL_LIMIT;
  const used =
    typeof rawQuota?.used === 'number' && Number.isFinite(rawQuota.used) && rawQuota.used >= 0
      ? Math.round(rawQuota.used)
      : 0;
  const remaining = Math.max(0, limit - used);

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
    cloud: {
      installId: typeof rawCloud.installId === 'string' ? rawCloud.installId : undefined,
      installSecrets: Object.keys(installSecrets).length > 0 ? installSecrets : undefined,
      endpoint: typeof rawCloud.endpoint === 'string' ? rawCloud.endpoint : '',
      quota: { used, limit, remaining },
    },
    onboardingDone: Boolean(obj.onboardingDone),
    tutorialDone: Boolean(obj.tutorialDone),
  };
}

export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  const mergedSecrets =
    patch.cloud && 'installSecrets' in patch.cloud
      ? patch.cloud.installSecrets
      : current.cloud.installSecrets;

  return normalizeSettings({
    ...current,
    ...patch,
    ai: {
      ...current.ai,
      ...(patch.ai ?? {}),
    },
    cloud: {
      ...current.cloud,
      ...(patch.cloud ?? {}),
      installSecrets: mergedSecrets,
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

export function getOrCreateInstallId(): Promise<{ installId: string; settings: AppSettings }> {
  return updateSettings((current) => {
    if (current.cloud.installId && /^[A-Za-z0-9_-]{16,64}$/.test(current.cloud.installId)) {
      return {};
    }
    const installId = crypto.randomUUID().replace(/-/g, '');
    return { cloud: { installId } };
  }).then((settings) => ({
    installId: settings.cloud.installId!,
    settings,
  }));
}
