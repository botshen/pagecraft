/**
 * Client-side signed client for the PageCraft Cloud Trial API.
 *
 * Uses per-install HMAC-SHA256 signing (`lib/api/sign.ts`) to consume the
 * new-user 10 free AI generation credits without requiring an API key on day 1,
 * while never transmitting browsing history or background telemetry.
 */

import type { CloudQuota } from '../../types';
import { FREE_TRIAL_LIMIT } from '../shared/constants';
import { endpointBase } from '../shared/endpoint';
import { getOrCreateInstallId, readSettings, updateSettings } from '../shared/settings';
import { registerInstall, shouldRefreshOn401, signedHeaders } from './sign';

export type CloudGenerateResponse =
  | { ok: true; content: string; quota: CloudQuota }
  | {
      ok: false;
      error: string;
      code?: 'quota_exhausted' | 'rate_limited' | 'network' | 'auth_failed';
      quota?: CloudQuota;
    };

async function ensureSecret(
  base: string,
  installId: string,
  fetchImpl: typeof fetch,
  forceRefresh = false,
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const current = await readSettings();
  const existing = current.cloud.installSecrets?.[base];
  if (existing && !forceRefresh) {
    return { ok: true, secret: existing };
  }

  const reg = await registerInstall(base, installId, fetchImpl, existing);
  if (!reg.ok) {
    return { ok: false, error: reg.error };
  }

  await updateSettings((s) => ({
    cloud: {
      installId,
      installSecrets: {
        ...(s.cloud.installSecrets ?? {}),
        [base]: reg.secret,
      },
    },
  }));
  return { ok: true, secret: reg.secret };
}

function normalizeQuota(raw: unknown): CloudQuota | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const q = raw as Record<string, unknown>;
  if (typeof q.used !== 'number' || typeof q.limit !== 'number') return undefined;
  const limit = Math.max(1, Math.round(q.limit));
  const used = Math.max(0, Math.round(q.used));
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export async function fetchCloudQuota(
  fetchImpl: typeof fetch = fetch,
): Promise<CloudQuota | null> {
  const { installId, settings } = await getOrCreateInstallId();
  const base = endpointBase(settings.cloud.endpoint);
  if (!base) return null;

  const cred = await ensureSecret(base, installId, fetchImpl, false);
  if (!cred.ok) return null;

  const url = `${base}/api/quota`;
  const send = async (secret: string) => {
    const auth = await signedHeaders(installId, secret, 'GET', url);
    return fetchImpl(url, { method: 'GET', headers: { ...auth } });
  };

  try {
    let resp = await send(cred.secret);
    if (resp.status === 401 && (await shouldRefreshOn401(resp))) {
      const refreshed = await ensureSecret(base, installId, fetchImpl, true);
      if (refreshed.ok) resp = await send(refreshed.secret);
    }
    if (!resp.ok) return null;
    const data = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      quota?: unknown;
    } | null;
    const quota = normalizeQuota(data?.quota);
    if (!quota) return null;
    await updateSettings(() => ({ cloud: { quota } }));
    return quota;
  } catch {
    return null;
  }
}

export async function requestCloudGeneration(
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudGenerateResponse> {
  const { installId, settings } = await getOrCreateInstallId();
  const base = endpointBase(settings.cloud.endpoint);
  if (!base) {
    return { ok: false, error: 'Invalid cloud endpoint URL', code: 'network' };
  }

  const cred = await ensureSecret(base, installId, fetchImpl, false);
  if (!cred.ok) {
    return { ok: false, error: `Cloud registration failed (${cred.error})`, code: 'auth_failed' };
  }

  const url = `${base}/api/generate`;
  const send = async (secret: string) => {
    const auth = await signedHeaders(installId, secret, 'POST', url);
    return fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth,
      },
      body: JSON.stringify({ prompt }),
    });
  };

  try {
    let resp = await send(cred.secret);
    if (resp.status === 401 && (await shouldRefreshOn401(resp))) {
      const refreshed = await ensureSecret(base, installId, fetchImpl, true);
      if (refreshed.ok) {
        resp = await send(refreshed.secret);
      }
    }

    const data = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      content?: string;
      error?: string;
      quota?: unknown;
    } | null;

    const quota = normalizeQuota(data?.quota);
    if (quota) {
      await updateSettings(() => ({ cloud: { quota } }));
    }

    if (resp.status === 402 || data?.error === 'quota_exhausted') {
      const exhaustedQuota = quota ?? {
        used: FREE_TRIAL_LIMIT,
        limit: FREE_TRIAL_LIMIT,
        remaining: 0,
      };
      await updateSettings(() => ({ cloud: { quota: exhaustedQuota } }));
      return {
        ok: false,
        error: 'quota_exhausted',
        code: 'quota_exhausted',
        quota: exhaustedQuota,
      };
    }

    if (resp.status === 429) {
      return {
        ok: false,
        error: data?.error ?? 'rate_limited',
        code: 'rate_limited',
        quota,
      };
    }

    if (!resp.ok || !data?.ok || typeof data.content !== 'string') {
      return {
        ok: false,
        error: data?.error ?? `Cloud AI error (HTTP ${resp.status})`,
        quota,
      };
    }

    return {
      ok: true,
      content: data.content,
      quota: quota ?? {
        used: 1,
        limit: FREE_TRIAL_LIMIT,
        remaining: FREE_TRIAL_LIMIT - 1,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Network error',
      code: 'network',
    };
  }
}

export interface GenerationFeedback {
  verdict: 'up' | 'down';
  engine: 'css' | 'js';
  aiSource: 'cloud' | 'byok';
  /** Whether the mod came out of a follow-up refinement turn. */
  refined: boolean;
  /** Live selector hit-check outcome at generation time. */
  selector: 'hit' | 'miss' | 'na';
}

/**
 * POST /api/feedback — anonymous "did it work?" vote, sent only when the user
 * explicitly clicks 👍/👎. Carries coarse enums only (never prompt, URL, host,
 * or code); the server folds it into daily aggregate counters.
 */
export async function sendGenerationFeedback(
  feedback: GenerationFeedback,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  const payload: GenerationFeedback = {
    verdict: feedback.verdict === 'down' ? 'down' : 'up',
    engine: feedback.engine === 'js' ? 'js' : 'css',
    aiSource: feedback.aiSource === 'byok' ? 'byok' : 'cloud',
    refined: feedback.refined === true,
    selector:
      feedback.selector === 'hit' || feedback.selector === 'miss' ? feedback.selector : 'na',
  };

  const { installId, settings } = await getOrCreateInstallId();
  const base = endpointBase(settings.cloud.endpoint);
  if (!base) return { ok: false, error: 'invalid_endpoint' };

  const cred = await ensureSecret(base, installId, fetchImpl, false);
  if (!cred.ok) return { ok: false, error: cred.error };

  const url = `${base}/api/feedback`;
  const send = async (secret: string) => {
    const auth = await signedHeaders(installId, secret, 'POST', url);
    return fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(payload),
    });
  };

  try {
    let resp = await send(cred.secret);
    if (resp.status === 401 && (await shouldRefreshOn401(resp))) {
      const refreshed = await ensureSecret(base, installId, fetchImpl, true);
      if (refreshed.ok) resp = await send(refreshed.secret);
    }
    return resp.ok ? { ok: true } : { ok: false, error: `http_${resp.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}
