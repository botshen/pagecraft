/**
 * PageCraft Cloud Trial Endpoints:
 *   GET  /api/quota     — read remaining free cloud generations for this install
 *   POST /api/generate  — consume 1 free trial credit and proxy a bounded prompt
 *                         to PRIMARY_LLM_* (DeepSeek / OpenAI-compatible).
 *
 * Security & Unit Economics Guarantees:
 * 1. Requires valid HMAC-SHA256 install signature (`verifyInstallSig`).
 * 2. Validates genuine PageCraft mod prompt prefix (`invalid_prompt_format`) so
 *    `/api/generate` cannot be abused as an open chatbot completion proxy.
 * 3. Atomically reserves per-install quota (`WHERE used_count < FREE_TRIAL_LIMIT`)
 *    AND atomic global daily circuit-breaker (`rate_limits` `global:gen:<today>`)
 *    BEFORE calling upstream LLM, bounding worst-case proxy-rotation spend.
 * 4. Caps `max_tokens: 2000` and enforces `AbortSignal.timeout(26_000)`.
 * 5. Refunds both `install_quotas` and `global:gen:<today>` if upstream LLM fails.
 * 6. Zero behavioral data stored — prompt text is NEVER persisted to D1.
 */

import type { Env } from '../types';
import { checkRateLimit, json } from '../index';
import { verifyInstallSig } from '../lib/auth';
import { resolveLlmConfig } from '../lib/llm-config';

export const FREE_TRIAL_LIMIT = 10;
export const MAX_GEN_PER_IP_PER_DAY = 30;
export const MAX_PROMPT_CHARS = 18_000;
export const MAX_OUTPUT_TOKENS = 2000;
export const UPSTREAM_TIMEOUT_MS = 26_000;
export const GLOBAL_GEN_ACTION = 'generate';

export const PAGECRAFT_PROMPT_PREFIX = 'You generate browser mods for PageCraft';

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function globalGenRateKey(today: string): string {
  return `global:gen:${today}`;
}

export function isGenuinePageCraftPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(PAGECRAFT_PROMPT_PREFIX);
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readInstallUsedCount(env: Env, installId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT used_count FROM install_quotas WHERE install_id = ?`,
  )
    .bind(installId)
    .first<{ used_count: number }>();
  return row?.used_count ?? 0;
}

function buildQuotaObj(used: number) {
  const clampedUsed = Math.max(0, Math.min(FREE_TRIAL_LIMIT, used));
  return {
    used: clampedUsed,
    limit: FREE_TRIAL_LIMIT,
    remaining: Math.max(0, FREE_TRIAL_LIMIT - clampedUsed),
  };
}

async function refundInstallQuota(env: Env, installId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE install_quotas
     SET used_count = MAX(0, used_count - 1),
         updated_at = ?
     WHERE install_id = ?`,
  )
    .bind(Date.now(), installId)
    .run()
    .catch(() => {});
}

async function refundGlobalDailySlot(env: Env, globalKey: string, today: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE rate_limits
     SET count = MAX(0, count - 1)
     WHERE install_id = ? AND action = ? AND date = ?`,
  )
    .bind(globalKey, GLOBAL_GEN_ACTION, today)
    .run()
    .catch(() => {});
}

export async function handleQuota(request: Request, env: Env): Promise<Response> {
  const installId = request.headers.get('X-Install-Id')?.trim() ?? '';
  if (!INSTALL_ID_RE.test(installId)) {
    return json({ ok: false, error: 'missing_or_invalid_install_id' }, 401);
  }
  const auth = await verifyInstallSig(request, env, installId);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  const used = await readInstallUsedCount(env, installId);
  return json({ ok: true, quota: buildQuotaObj(used) });
}

export async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const installId = request.headers.get('X-Install-Id')?.trim() ?? '';
  if (!INSTALL_ID_RE.test(installId)) {
    return json({ ok: false, error: 'missing_or_invalid_install_id' }, 401);
  }
  const auth = await verifyInstallSig(request, env, installId);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  let body: { prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const rawPrompt = typeof body.prompt === 'string' ? body.prompt : '';
  const prompt = rawPrompt.trim();
  if (!prompt) {
    return json({ ok: false, error: 'missing_prompt' }, 400);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ ok: false, error: 'prompt_too_large' }, 413);
  }
  if (!isGenuinePageCraftPrompt(rawPrompt)) {
    return json({ ok: false, error: 'invalid_prompt_format' }, 400);
  }

  const { baseUrl, apiKey, model, dailyGlobalLimit } = await resolveLlmConfig(env);
  if (!baseUrl || !apiKey) {
    return json({ ok: false, error: 'llm_not_configured' }, 503);
  }

  // IP anti-abuse rate limit
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipKey = `ip:${await sha256hex(ip)}`;
  const ipRl = await checkRateLimit(env, ipKey, 'generate', MAX_GEN_PER_IP_PER_DAY);
  if (!ipRl.allowed) {
    const currentUsed = await readInstallUsedCount(env, installId);
    return json(
      { ok: false, error: 'rate_limited', quota: buildQuotaObj(currentUsed) },
      429,
    );
  }

  // Atomic per-install quota reservation (prevents concurrent race past 10)
  const now = Date.now();
  const reserved = await env.DB.prepare(
    `INSERT INTO install_quotas (install_id, used_count, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT (install_id) DO UPDATE
       SET used_count = install_quotas.used_count + 1,
           updated_at = excluded.updated_at
       WHERE install_quotas.used_count < ?
     RETURNING used_count`,
  )
    .bind(installId, now, FREE_TRIAL_LIMIT)
    .first<{ used_count: number }>();

  if (!reserved) {
    return json(
      {
        ok: false,
        error: 'quota_exhausted',
        quota: buildQuotaObj(FREE_TRIAL_LIMIT),
      },
      402,
    );
  }

  // Atomic Global Daily Circuit-Breaker BEFORE calling upstream LLM
  const today = new Date(now).toISOString().slice(0, 10);
  const globalKey = globalGenRateKey(today);
  let globalReserved: { count: number } | null = null;

  if (dailyGlobalLimit > 0) {
    globalReserved = await env.DB.prepare(
      `INSERT INTO rate_limits (install_id, action, date, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (install_id, action, date) DO UPDATE
         SET count = rate_limits.count + 1
         WHERE rate_limits.count < ?
       RETURNING count`,
    )
      .bind(globalKey, GLOBAL_GEN_ACTION, today, dailyGlobalLimit)
      .first<{ count: number }>();
  }

  if (!globalReserved) {
    await refundInstallQuota(env, installId);
    const refundedUsed = Math.max(0, reserved.used_count - 1);
    return json(
      {
        ok: false,
        error: 'daily_capacity_reached',
        message:
          "Today's free cloud trial pool is full. Add your own DeepSeek or OpenAI API key in Settings to continue immediately.",
        quota: buildQuotaObj(refundedUsed),
      },
      503,
    );
  }

  const doFetch = env.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));
  const startedAt = Date.now();

  try {
    const llmResp = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!llmResp.ok) {
      throw new Error(`upstream_http_${llmResp.status}`);
    }

    const data = (await llmResp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const content = data?.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) {
      throw new Error('empty_llm_output');
    }

    const durationMs = Date.now() - startedAt;
    await env.DB.prepare(
      `INSERT INTO llm_calls (id, ts, model, kind, install_id, prompt_tokens, completion_tokens, total_tokens, duration_ms, status)
       VALUES (?, ?, ?, 'pagecraft_gen', ?, ?, ?, ?, ?, 'ok')`,
    )
      .bind(
        crypto.randomUUID(),
        Date.now(),
        model,
        installId,
        data.usage?.prompt_tokens ?? 0,
        data.usage?.completion_tokens ?? 0,
        data.usage?.total_tokens ?? 0,
        durationMs,
      )
      .run()
      .catch(() => {});

    return json({
      ok: true,
      content,
      quota: buildQuotaObj(reserved.used_count),
    });
  } catch (err) {
    // Refund both the per-install slot AND the global daily circuit-breaker slot
    await Promise.all([
      refundInstallQuota(env, installId),
      refundGlobalDailySlot(env, globalKey, today),
    ]);

    const errMsg = err instanceof Error ? err.message.slice(0, 120) : 'upstream_error';
    await env.DB.prepare(
      `INSERT INTO llm_calls (id, ts, model, kind, install_id, duration_ms, status, error)
       VALUES (?, ?, ?, 'pagecraft_gen', ?, ?, 'error', ?)`,
    )
      .bind(crypto.randomUUID(), Date.now(), model, installId, Date.now() - startedAt, errMsg)
      .run()
      .catch(() => {});

    const refundedUsed = Math.max(0, reserved.used_count - 1);
    return json(
      {
        ok: false,
        error: 'upstream_llm_failed',
        quota: buildQuotaObj(refundedUsed),
      },
      502,
    );
  }
}
