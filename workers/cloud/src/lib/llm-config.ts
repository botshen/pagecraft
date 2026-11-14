/**
 * Online LLM & Global Cap runtime configuration backed by D1 (`runtime_config`)
 * with AES-256-GCM encryption at rest derived from `SHA-256(env.ADMIN_TOKEN)`.
 *
 * Resolution priority:
 *   1. D1 `runtime_config` overrides (`llm_base_url`, `llm_model`, `llm_api_key_enc`, `daily_global_limit`)
 *   2. Worker environment secrets/vars (`PRIMARY_LLM_BASE_URL`, `PRIMARY_LLM_API_KEY`, `PRIMARY_LLM_MODEL`, `DAILY_GLOBAL_GEN_LIMIT`)
 */

import type { Env } from '../types';

export const DEFAULT_LLM_MODEL = 'deepseek-chat';
export const DEFAULT_DAILY_GLOBAL_LIMIT = 2000;
export const KEY_DAILY_GLOBAL_LIMIT = 'daily_global_limit';

const KEY_BASE_URL = 'llm_base_url';
const KEY_MODEL = 'llm_model';
const KEY_API_KEY_ENC = 'llm_api_key_enc';
const CIPHER_PREFIX = 'v1:';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type LlmConfigSource = 'd1' | 'env' | 'none';
export type DailyCapSource = 'd1' | 'env' | 'default';

export interface ResolvedLlmConfig {
  source: LlmConfigSource;
  baseUrl: string;
  apiKey: string;
  model: string;
  updatedAt: number | null;
  dailyGlobalLimit: number;
  dailyGlobalLimitSource: DailyCapSource;
}

export interface PublicLlmConfigStatus {
  source: LlmConfigSource;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  maskedKey: string;
  updatedAt: number | null;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function deriveAesKey(adminToken: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(adminToken));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt plaintext API key with AES-256-GCM (`v1:<ivHex>:<cipherHex>`). */
export async function encryptApiKey(plainKey: string, adminToken: string): Promise<string> {
  const key = await deriveAesKey(adminToken);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plainKey),
  );
  return `${CIPHER_PREFIX}${toHex(iv)}:${toHex(new Uint8Array(cipherBuf))}`;
}

/** Decrypt stored API key; returns null if malformed or token rotated. */
export async function decryptApiKey(payload: string, adminToken: string): Promise<string | null> {
  if (!payload.startsWith(CIPHER_PREFIX)) return null;
  const rest = payload.slice(CIPHER_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const iv = fromHex(rest.slice(0, sep));
  const cipher = fromHex(rest.slice(sep + 1));
  if (!iv || iv.length !== 12 || !cipher || cipher.length < 16) return null;

  try {
    const key = await deriveAesKey(adminToken);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
      key,
      cipher as Uint8Array<ArrayBuffer>,
    );
    return decoder.decode(plainBuf);
  } catch {
    return null;
  }
}

/**
 * Mask an API key for display in `/admin` (e.g. `sk-****abcd`).
 * Never exposes the full secret, even for short test keys.
 */
export function maskApiKey(rawKey: string): string {
  const key = rawKey.trim();
  if (!key) return '';
  if (key.length <= 4) return '****';
  if (key.length <= 8) return `${key.slice(0, 1)}****${key.slice(-1)}`;
  if (key.length <= 12) return `${key.slice(0, 2)}****${key.slice(-2)}`;
  if (key.startsWith('sk-')) {
    return `sk-****${key.slice(-4)}`;
  }
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

/**
 * Validate an operator-supplied LLM base URL (`http://` or `https://`).
 * Returns normalized URL (without trailing slash) or null if invalid.
 */
export function validateLlmBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = normalizeBaseUrl(raw);
  if (!cleaned || cleaned.length > 512) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return cleaned;
  } catch {
    return null;
  }
}

function parseNonNegInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return n;
}

export function resolveEnvDailyGlobalLimit(env: Env): {
  limit: number;
  source: 'env' | 'default';
} {
  const envVal = Number(env.DAILY_GLOBAL_GEN_LIMIT);
  if (Number.isFinite(envVal) && envVal > 0) {
    return { limit: Math.floor(envVal), source: 'env' };
  }
  return { limit: DEFAULT_DAILY_GLOBAL_LIMIT, source: 'default' };
}

/**
 * Resolve effective LLM configuration AND daily global cap in 1 SQL query:
 * reads `runtime_config` first, falling back cleanly to `env.*`.
 */
export async function resolveLlmConfig(env: Env): Promise<ResolvedLlmConfig> {
  const envBaseUrl = normalizeBaseUrl(env.PRIMARY_LLM_BASE_URL ?? '');
  const envApiKey = (env.PRIMARY_LLM_API_KEY ?? '').trim();
  const envModel = (env.PRIMARY_LLM_MODEL ?? '').trim();

  let d1BaseUrl = '';
  let d1Model = '';
  let d1EncKey = '';
  let d1DailyLimit: number | null = null;
  let latestUpdatedAt: number | null = null;
  let hasD1LlmRow = false;

  try {
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated_at
       FROM runtime_config
       WHERE key IN ('llm_base_url', 'llm_model', 'llm_api_key_enc', 'daily_global_limit')`,
    ).all<{ key: string; value: string; updated_at: number }>();

    for (const row of results ?? []) {
      if (row.key === KEY_DAILY_GLOBAL_LIMIT) {
        d1DailyLimit = parseNonNegInt(row.value);
        continue;
      }
      hasD1LlmRow = true;
      if (typeof row.updated_at === 'number') {
        latestUpdatedAt =
          latestUpdatedAt === null ? row.updated_at : Math.max(latestUpdatedAt, row.updated_at);
      }
      if (row.key === KEY_BASE_URL) d1BaseUrl = normalizeBaseUrl(row.value);
      else if (row.key === KEY_MODEL) d1Model = row.value.trim();
      else if (row.key === KEY_API_KEY_ENC) d1EncKey = row.value.trim();
    }
  } catch {
    // Graceful fallback if migration 0002 has not been applied yet.
  }

  let d1ApiKey = '';
  const adminToken = (env.ADMIN_TOKEN ?? '').trim();
  if (d1EncKey && adminToken) {
    d1ApiKey = ((await decryptApiKey(d1EncKey, adminToken)) ?? '').trim();
  }

  const d1Effective = Boolean(d1BaseUrl || d1Model || d1ApiKey);
  const baseUrl = d1BaseUrl || envBaseUrl;
  const apiKey = d1ApiKey || envApiKey;
  const model = d1Model || envModel || DEFAULT_LLM_MODEL;

  let source: LlmConfigSource = 'none';
  if (d1Effective || (hasD1LlmRow && (baseUrl || apiKey))) {
    source = 'd1';
  } else if (envBaseUrl || envApiKey) {
    source = 'env';
  }

  const envCap = resolveEnvDailyGlobalLimit(env);
  const dailyGlobalLimit = d1DailyLimit !== null ? d1DailyLimit : envCap.limit;
  const dailyGlobalLimitSource: DailyCapSource =
    d1DailyLimit !== null ? 'd1' : envCap.source;

  return {
    source,
    baseUrl,
    apiKey,
    model,
    updatedAt: source === 'd1' ? latestUpdatedAt : null,
    dailyGlobalLimit,
    dailyGlobalLimitSource,
  };
}

/** Public-safe view of active LLM configuration (never includes raw `apiKey`). */
export function toPublicLlmStatus(resolved: ResolvedLlmConfig): PublicLlmConfigStatus {
  return {
    source: resolved.source,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    hasApiKey: Boolean(resolved.apiKey),
    maskedKey: resolved.apiKey ? maskApiKey(resolved.apiKey) : '',
    updatedAt: resolved.updatedAt,
  };
}

/** Save LLM overrides into D1 `runtime_config` (preserving stored key when `apiKey` is blank). */
export async function saveLlmConfigOverride(
  env: Env,
  adminToken: string,
  input: { baseUrl: string; model: string; apiKey?: string },
): Promise<PublicLlmConfigStatus> {
  const now = Date.now();
  const upsertSql = `INSERT INTO runtime_config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE
       SET value = excluded.value,
           updated_at = excluded.updated_at`;

  const stmts = [
    env.DB.prepare(upsertSql).bind(KEY_BASE_URL, input.baseUrl, now),
    env.DB.prepare(upsertSql).bind(KEY_MODEL, input.model, now),
  ];

  const trimmedKey = (input.apiKey ?? '').trim();
  if (trimmedKey) {
    const encrypted = await encryptApiKey(trimmedKey, adminToken);
    stmts.push(env.DB.prepare(upsertSql).bind(KEY_API_KEY_ENC, encrypted, now));
  }

  await env.DB.batch(stmts);
  return toPublicLlmStatus(await resolveLlmConfig(env));
}

/** Delete all D1 LLM overrides so resolution falls back to `env.PRIMARY_LLM_*`. */
export async function clearLlmConfigOverride(env: Env): Promise<PublicLlmConfigStatus> {
  await env.DB.prepare(
    `DELETE FROM runtime_config WHERE key IN ('llm_base_url', 'llm_model', 'llm_api_key_enc')`,
  ).run();
  return toPublicLlmStatus(await resolveLlmConfig(env));
}

/** Save or clear the D1 `daily_global_limit` runtime override. */
export async function saveDailyGlobalLimitOverride(
  env: Env,
  limit: number | null,
): Promise<{ limit: number; source: DailyCapSource }> {
  if (limit === null) {
    await env.DB.prepare(`DELETE FROM runtime_config WHERE key = ?`)
      .bind(KEY_DAILY_GLOBAL_LIMIT)
      .run();
  } else {
    const clamped = Math.max(0, Math.min(10_000_000, Math.floor(limit)));
    await env.DB.prepare(
      `INSERT INTO runtime_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value,
             updated_at = excluded.updated_at`,
    )
      .bind(KEY_DAILY_GLOBAL_LIMIT, String(clamped), Date.now())
      .run();
  }
  const resolved = await resolveLlmConfig(env);
  return {
    limit: resolved.dailyGlobalLimit,
    source: resolved.dailyGlobalLimitSource,
  };
}
