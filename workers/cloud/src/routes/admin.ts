/**
 * PageCraft Cloud — Operator Console & Online LLM Config (`/admin`, `/admin/*`).
 *
 * Security guarantees:
 * 1. Gated by `env.ADMIN_TOKEN` (minimum 16 chars; 503 if unset/too short).
 * 2. Supports `Authorization: Bearer <ADMIN_TOKEN>` and `HttpOnly; Secure; SameSite=Strict; Path=/admin`
 *    session cookie `pc_admin = hex(HMAC-SHA256(ADMIN_TOKEN, "pagecraft-admin-v1"))` with constant-time compare.
 * 3. CSRF `Origin` host verification on every `POST /admin/*` request when `Origin` is present.
 * 4. `POST /admin/login` throttles failed login attempts per hashed IP (`max 15/day`).
 * 5. Every `/admin*` response sets `Cache-Control: no-store`, `X-Frame-Options: DENY`,
 *    strict `Content-Security-Policy`, and NEVER emits wildcard CORS headers.
 */

import type { Env } from '../types';
import { checkRateLimit } from '../index';
import { FREE_TRIAL_LIMIT, GLOBAL_GEN_ACTION, globalGenRateKey } from './generate';
import {
  clearLlmConfigOverride,
  resolveLlmConfig,
  saveDailyGlobalLimitOverride,
  saveLlmConfigOverride,
  toPublicLlmStatus,
  validateLlmBaseUrl,
} from '../lib/llm-config';
import { ADMIN_LOGIN_HTML, ADMIN_PAGE_HTML } from '../admin/page';

export const MIN_ADMIN_TOKEN_LENGTH = 16;
export const MAX_LOGIN_FAILURES_PER_IP_PER_DAY = 15;
export const ADMIN_COOKIE_NAME = 'pc_admin';

const SESSION_HMAC_MESSAGE = 'pagecraft-admin-v1';
const DAY_MS = 86_400_000;

const HTML_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const API_CSP = "default-src 'none'; frame-ancestors 'none'";

const encoder = new TextEncoder();

// ─── Response Helpers (Zero CORS, Strict Security Headers) ──────────────────

function adminHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers(extra);
  h.set('Cache-Control', 'no-store');
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  if (!h.has('Content-Security-Policy')) {
    h.set('Content-Security-Policy', API_CSP);
  }
  return h;
}

function adminJson(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: adminHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      ...(extraHeaders ?? {}),
    }),
  });
}

function adminHtml(html: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(html, {
    status,
    headers: adminHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': HTML_CSP,
      ...(extraHeaders ?? {}),
    }),
  });
}

function adminRedirect(to: string, setCookie?: string): Response {
  const extra: Record<string, string> = { Location: to };
  if (setCookie) extra['Set-Cookie'] = setCookie;
  return new Response(null, { status: 303, headers: adminHeaders(extra) });
}

// ─── Crypto & Session Helpers ───────────────────────────────────────────────

function toHex(buf: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * Constant-time string equality check via fixed-length SHA-256 digests so
 * neither string length nor prefix match leaks via timing.
 */
async function tokensEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const xa = new Uint8Array(ha);
  const xb = new Uint8Array(hb);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < xa.length; i++) {
    diff |= xa[i]! ^ xb[i]!;
  }
  return diff === 0;
}

export async function computeAdminSessionValue(adminToken: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(adminToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(SESSION_HMAC_MESSAGE));
  return toHex(sig);
}

function buildSessionCookie(value: string): string {
  return `${ADMIN_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=604800`;
}

function buildClearCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie') ?? '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

async function isAuthenticated(request: Request, adminToken: string): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && (await tokensEqual(match[1]!.trim(), adminToken))) {
      return true;
    }
  }
  const cookieVal = readCookie(request, ADMIN_COOKIE_NAME);
  if (!cookieVal) return false;
  const expected = await computeAdminSessionValue(adminToken);
  return tokensEqual(cookieVal, expected);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSameOriginPost(request: Request, requestUrl: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === requestUrl.host;
  } catch {
    return false;
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function handleAdmin(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: adminHeaders() });
    }

    const token = (env.ADMIN_TOKEN ?? '').trim();
    if (token.length < MIN_ADMIN_TOKEN_LENGTH) {
      const msg =
        token.length === 0
          ? 'ADMIN_TOKEN 未配置。请先执行 `wrangler secret put ADMIN_TOKEN`（至少 16 位字符）以启用 /admin 运营控制台。'
          : 'ADMIN_TOKEN 长度不足（至少需要 16 位字符）。请通过 `wrangler secret put ADMIN_TOKEN` 更新密钥。';
      if (url.pathname.startsWith('/admin/api')) {
        return adminJson({ ok: false, error: 'admin_not_configured', message: msg }, 503);
      }
      return new Response(msg, {
        status: 503,
        headers: adminHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }

    // Defense-in-depth CSRF Origin check on all POST /admin* endpoints
    if (request.method === 'POST' && !isSameOriginPost(request, url)) {
      return adminJson(
        {
          ok: false,
          error: 'csrf_origin_mismatch',
          message: 'Cross-origin POST rejected',
        },
        403,
      );
    }

    const path = url.pathname;

    if (path === '/admin/login' && request.method === 'POST') {
      return await handleLogin(request, env, token);
    }

    if (path === '/admin/logout' && request.method === 'POST') {
      const clear = buildClearCookie();
      const wantsJson =
        (request.headers.get('Accept') ?? '').includes('application/json') ||
        (request.headers.get('Content-Type') ?? '').includes('application/json');
      if (wantsJson) {
        return adminJson({ ok: true }, 200, { 'Set-Cookie': clear });
      }
      return adminRedirect('/admin', clear);
    }

    if (!(await isAuthenticated(request, token))) {
      if (request.method === 'GET' && (path === '/admin' || path === '/admin/')) {
        return adminHtml(ADMIN_LOGIN_HTML, 200);
      }
      return adminJson({ ok: false, error: 'unauthorized' }, 401);
    }

    if ((path === '/admin' || path === '/admin/') && request.method === 'GET') {
      return adminHtml(ADMIN_PAGE_HTML, 200);
    }

    if (path.startsWith('/admin/api/')) {
      return await handleAdminApi(request, url, env, token);
    }

    return adminJson({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    console.error('admin_unhandled', err);
    return adminJson({ ok: false, error: 'internal' }, 500);
  }
}

// ─── Login Handler (with Hashed-IP Failure Rate Limit) ──────────────────────

async function handleLogin(request: Request, env: Env, adminToken: string): Promise<Response> {
  const contentType = request.headers.get('Content-Type') ?? '';
  const wantsJson = contentType.includes('application/json');

  const rawIp =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const ipKey = `ip:${await sha256Hex(rawIp)}`;
  const today = new Date().toISOString().slice(0, 10);

  const priorFail = await env.DB.prepare(
    `SELECT count FROM rate_limits WHERE install_id = ? AND action = 'admin_login_fail' AND date = ?`,
  )
    .bind(ipKey, today)
    .first<{ count: number }>();

  if ((priorFail?.count ?? 0) >= MAX_LOGIN_FAILURES_PER_IP_PER_DAY) {
    await checkRateLimit(env, ipKey, 'admin_login_fail', MAX_LOGIN_FAILURES_PER_IP_PER_DAY);
    return renderLoginFailure(wantsJson, 429, 'rate_limited', '今日登录失败次数过多（上限 15 次），请明日再试。');
  }

  let given = '';
  try {
    if (wantsJson) {
      const body = (await request.json()) as { token?: unknown };
      given = typeof body.token === 'string' ? body.token.trim() : '';
    } else {
      const form = await request.formData();
      const val = form.get('token');
      given = typeof val === 'string' ? val.trim() : '';
    }
  } catch {
    given = '';
  }

  if (!(await tokensEqual(given, adminToken))) {
    const rl = await checkRateLimit(
      env,
      ipKey,
      'admin_login_fail',
      MAX_LOGIN_FAILURES_PER_IP_PER_DAY,
    );
    if (!rl.allowed) {
      return renderLoginFailure(wantsJson, 429, 'rate_limited', '今日登录失败次数过多（上限 15 次），请明日再试。');
    }
    return renderLoginFailure(wantsJson, 401, 'invalid_token', '管理员令牌无效，请核对后重试。');
  }

  const cookieHeader = buildSessionCookie(await computeAdminSessionValue(adminToken));
  if (wantsJson) {
    return adminJson({ ok: true }, 200, { 'Set-Cookie': cookieHeader });
  }
  return adminRedirect('/admin', cookieHeader);
}

function renderLoginFailure(
  wantsJson: boolean,
  status: number,
  errorCode: string,
  humanMessage: string,
): Response {
  if (wantsJson) {
    return adminJson({ ok: false, error: errorCode, message: humanMessage }, status);
  }
  const html = ADMIN_LOGIN_HTML.replace(
    '<!--ERR-->',
    `<p class="err">${escapeHtml(humanMessage)}</p>`,
  );
  return adminHtml(html, status);
}

// ─── Admin JSON API Router ──────────────────────────────────────────────────

async function handleAdminApi(
  request: Request,
  url: URL,
  env: Env,
  adminToken: string,
): Promise<Response> {
  const sub = url.pathname.slice('/admin/api'.length);

  if (request.method === 'GET') {
    if (sub === '/overview') return apiOverview(url, env);
    if (sub === '/llm-balance') return apiLlmBalance(env);
    return adminJson({ ok: false, error: 'not_found' }, 404);
  }

  if (request.method === 'POST') {
    if (sub === '/llm-config') return apiSaveLlmConfig(request, env, adminToken);
    if (sub === '/daily-limit') return apiSaveDailyLimit(request, env);
    if (sub === '/llm-test') return apiTestLlmConfig(request, env);
    return adminJson({ ok: false, error: 'not_found' }, 404);
  }

  return adminJson({ ok: false, error: 'method_not_allowed' }, 405);
}

// ─── GET /admin/api/overview ────────────────────────────────────────────────

function clampDays(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return 28;
  return Math.min(365, Math.max(1, n));
}

function buildDateRange(sinceDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${sinceDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime() && dates.length <= 370) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Consolidated operator overview in 8 SQL queries (well under the 10-query budget).
 */
async function apiOverview(url: URL, env: Env): Promise<Response> {
  const days = clampDays(url.searchParams.get('days'));
  const now = Date.now();
  const sinceMs = now - days * DAY_MS;
  const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);
  const todayDate = new Date(now).toISOString().slice(0, 10);
  const todayGlobalKey = globalGenRateKey(todayDate);

  const [
    installRow,
    genSummaryRow,
    genDailyRows,
    recentCallRows,
    fbBucketRows,
    fbDailyRows,
    resolvedLlm,
    globalCapRow,
  ] = await Promise.all([
    // 1. Installs funnel
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM install_secrets) AS total,
         (SELECT COUNT(*) FROM install_secrets WHERE created_at >= ?) AS new_in_window,
         (SELECT COUNT(*) FROM install_quotas WHERE used_count > 0) AS generated_at_least_once,
         (SELECT COUNT(*) FROM install_quotas WHERE used_count >= ?) AS exhausted_quota`,
    )
      .bind(sinceMs, FREE_TRIAL_LIMIT)
      .first<{
        total: number;
        new_in_window: number;
        generated_at_least_once: number;
        exhausted_quota: number;
      }>(),

    // 2. Cloud generations summary
    env.DB.prepare(
      `SELECT
         COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok,
         COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
         COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(total_tokens), 0) AS total_tokens,
         COALESCE(CAST(ROUND(AVG(CASE WHEN status = 'ok' THEN duration_ms END)) AS INTEGER), 0) AS avg_duration_ms
       FROM llm_calls
       WHERE ts >= ?`,
    )
      .bind(sinceMs)
      .first<{
        calls: number;
        ok: number;
        errors: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        avg_duration_ms: number;
      }>(),

    // 3. Cloud generations daily rollup
    env.DB.prepare(
      `SELECT
         strftime('%Y-%m-%d', CAST(ts / 1000 AS INTEGER), 'unixepoch') AS date,
         COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok,
         COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
         COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM llm_calls
       WHERE ts >= ?
       GROUP BY date
       ORDER BY date ASC`,
    )
      .bind(sinceMs)
      .all<{
        date: string;
        calls: number;
        ok: number;
        errors: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }>(),

    // 4. Recent 30 llm_calls
    env.DB.prepare(
      `SELECT
         id, ts, model, kind, install_id,
         prompt_tokens, completion_tokens, total_tokens,
         duration_ms, status, error
       FROM llm_calls
       ORDER BY ts DESC
       LIMIT 30`,
    ).all<{
      id: string;
      ts: number;
      model: string;
      kind: string;
      install_id: string | null;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      duration_ms: number;
      status: string;
      error: string | null;
    }>(),

    // 5. Feedback buckets breakdown (also yields exact up/down window totals)
    env.DB.prepare(
      `SELECT
         engine, ai_source, refined, selector,
         COALESCE(SUM(CASE WHEN verdict = 'up' THEN count ELSE 0 END), 0) AS up,
         COALESCE(SUM(CASE WHEN verdict = 'down' THEN count ELSE 0 END), 0) AS down
       FROM feedback_daily
       WHERE date >= ?
       GROUP BY engine, ai_source, refined, selector
       ORDER BY (up + down) DESC, engine ASC, ai_source ASC`,
    )
      .bind(sinceDate)
      .all<{
        engine: 'css' | 'js';
        ai_source: 'cloud' | 'byok';
        refined: number;
        selector: 'hit' | 'miss' | 'na';
        up: number;
        down: number;
      }>(),

    // 6. Feedback daily rollup
    env.DB.prepare(
      `SELECT
         date,
         COALESCE(SUM(CASE WHEN verdict = 'up' THEN count ELSE 0 END), 0) AS up,
         COALESCE(SUM(CASE WHEN verdict = 'down' THEN count ELSE 0 END), 0) AS down
       FROM feedback_daily
       WHERE date >= ?
       GROUP BY date
       ORDER BY date ASC`,
    )
      .bind(sinceDate)
      .all<{ date: string; up: number; down: number }>(),

    // 7. Active LLM config + daily_global_limit resolution (1 SQL query)
    resolveLlmConfig(env),

    // 8. Today's global circuit-breaker usage (1 SQL query)
    env.DB.prepare(
      `SELECT count FROM rate_limits WHERE install_id = ? AND action = ? AND date = ?`,
    )
      .bind(todayGlobalKey, GLOBAL_GEN_ACTION, todayDate)
      .first<{ count: number }>(),
  ]);

  const dateAxis = buildDateRange(sinceDate, todayDate);

  const genByDate = new Map(
    (genDailyRows.results ?? []).map((r) => [r.date, r]),
  );
  const genDaily = dateAxis.map((date) => {
    const r = genByDate.get(date);
    return {
      date,
      calls: Number(r?.calls ?? 0),
      ok: Number(r?.ok ?? 0),
      errors: Number(r?.errors ?? 0),
      promptTokens: Number(r?.prompt_tokens ?? 0),
      completionTokens: Number(r?.completion_tokens ?? 0),
      totalTokens: Number(r?.total_tokens ?? 0),
    };
  });

  const fbByDate = new Map(
    (fbDailyRows.results ?? []).map((r) => [r.date, r]),
  );
  const fbDaily = dateAxis.map((date) => {
    const r = fbByDate.get(date);
    return {
      date,
      up: Number(r?.up ?? 0),
      down: Number(r?.down ?? 0),
    };
  });

  const buckets = (fbBucketRows.results ?? []).map((r) => {
    const up = Number(r.up ?? 0);
    const down = Number(r.down ?? 0);
    return {
      engine: r.engine,
      aiSource: r.ai_source,
      refined: Boolean(r.refined),
      selector: r.selector,
      up,
      down,
      total: up + down,
    };
  });

  const fbUp = buckets.reduce((acc, b) => acc + b.up, 0);
  const fbDown = buckets.reduce((acc, b) => acc + b.down, 0);

  const todayGlobalCalls = Number(globalCapRow?.count ?? 0);
  const dailyGlobalLimit = resolvedLlm.dailyGlobalLimit;

  return adminJson({
    ok: true,
    days,
    sinceDate,
    freeTrialLimit: FREE_TRIAL_LIMIT,
    dailyGlobalLimit,
    todayGlobalCalls,
    dailyGlobalCap: {
      date: todayDate,
      usedToday: todayGlobalCalls,
      limit: dailyGlobalLimit,
      remaining: Math.max(0, dailyGlobalLimit - todayGlobalCalls),
      source: resolvedLlm.dailyGlobalLimitSource,
    },
    installs: {
      total: Number(installRow?.total ?? 0),
      newInWindow: Number(installRow?.new_in_window ?? 0),
      generatedAtLeastOnce: Number(installRow?.generated_at_least_once ?? 0),
      exhaustedQuota: Number(installRow?.exhausted_quota ?? 0),
    },
    generations: {
      calls: Number(genSummaryRow?.calls ?? 0),
      ok: Number(genSummaryRow?.ok ?? 0),
      errors: Number(genSummaryRow?.errors ?? 0),
      promptTokens: Number(genSummaryRow?.prompt_tokens ?? 0),
      completionTokens: Number(genSummaryRow?.completion_tokens ?? 0),
      totalTokens: Number(genSummaryRow?.total_tokens ?? 0),
      avgDurationMs: Number(genSummaryRow?.avg_duration_ms ?? 0),
      daily: genDaily,
      recent: (recentCallRows.results ?? []).map((r) => ({
        id: r.id,
        ts: Number(r.ts),
        model: r.model,
        kind: r.kind,
        installId: r.install_id,
        promptTokens: Number(r.prompt_tokens ?? 0),
        completionTokens: Number(r.completion_tokens ?? 0),
        totalTokens: Number(r.total_tokens ?? 0),
        durationMs: Number(r.duration_ms ?? 0),
        status: r.status,
        error: r.error ?? null,
      })),
    },
    feedback: {
      up: fbUp,
      down: fbDown,
      total: fbUp + fbDown,
      buckets,
      daily: fbDaily,
    },
    llmConfig: toPublicLlmStatus(resolvedLlm),
  });
}

// ─── POST /admin/api/daily-limit ────────────────────────────────────────────

function parseLimitInput(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n >= 0 && n <= 10_000_000 ? n : null;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
  }
  return null;
}

async function apiSaveDailyLimit(request: Request, env: Env): Promise<Response> {
  let body: { dailyGlobalLimit?: unknown; limit?: unknown; clearOverride?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminJson({ ok: false, error: 'invalid_json' }, 400);
  }

  let saved: { limit: number; source: 'd1' | 'env' | 'default' };
  if (body.clearOverride === true) {
    saved = await saveDailyGlobalLimitOverride(env, null);
  } else {
    const parsed = parseLimitInput(body.dailyGlobalLimit ?? body.limit);
    if (parsed === null) {
      return adminJson(
        {
          ok: false,
          error: 'invalid_daily_limit',
          message: '每日全站调用上限必须是 0 到 10,000,000 之间的整数',
        },
        400,
      );
    }
    saved = await saveDailyGlobalLimitOverride(env, parsed);
  }

  const todayDate = new Date().toISOString().slice(0, 10);
  const todayGlobalKey = globalGenRateKey(todayDate);
  const row = await env.DB.prepare(
    `SELECT count FROM rate_limits WHERE install_id = ? AND action = ? AND date = ?`,
  )
    .bind(todayGlobalKey, GLOBAL_GEN_ACTION, todayDate)
    .first<{ count: number }>();
  const usedToday = Number(row?.count ?? 0);

  return adminJson({
    ok: true,
    dailyGlobalLimit: saved.limit,
    todayGlobalCalls: usedToday,
    dailyGlobalCap: {
      date: todayDate,
      usedToday,
      limit: saved.limit,
      remaining: Math.max(0, saved.limit - usedToday),
      source: saved.source,
    },
  });
}

// ─── POST /admin/api/llm-config ─────────────────────────────────────────────

async function apiSaveLlmConfig(
  request: Request,
  env: Env,
  adminToken: string,
): Promise<Response> {
  let body: {
    baseUrl?: unknown;
    model?: unknown;
    apiKey?: unknown;
    dailyGlobalLimit?: unknown;
    clearOverride?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminJson({ ok: false, error: 'invalid_json' }, 400);
  }

  if (body.clearOverride === true) {
    const llmConfig = await clearLlmConfigOverride(env);
    return adminJson({ ok: true, llmConfig });
  }

  const baseUrl = validateLlmBaseUrl(body.baseUrl);
  if (!baseUrl) {
    return adminJson(
      {
        ok: false,
        error: 'invalid_base_url',
        message: 'Base URL 必须是以 http:// 或 https:// 开头的有效地址',
      },
      400,
    );
  }

  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!model || model.length > 128) {
    return adminJson(
      { ok: false, error: 'invalid_model', message: '模型名称不能为空且不超过 128 字符' },
      400,
    );
  }

  if (body.dailyGlobalLimit !== undefined) {
    const parsedCap = parseLimitInput(body.dailyGlobalLimit);
    if (parsedCap === null) {
      return adminJson(
        {
          ok: false,
          error: 'invalid_daily_limit',
          message: '每日全站调用上限必须是 0 到 10,000,000 之间的整数',
        },
        400,
      );
    }
    await saveDailyGlobalLimitOverride(env, parsedCap);
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const llmConfig = await saveLlmConfigOverride(env, adminToken, {
    baseUrl,
    model,
    apiKey: apiKey || undefined,
  });

  return adminJson({ ok: true, llmConfig });
}

// ─── POST /admin/api/llm-test ───────────────────────────────────────────────

async function apiTestLlmConfig(request: Request, env: Env): Promise<Response> {
  let body: { baseUrl?: unknown; model?: unknown; apiKey?: unknown } = {};
  const rawText = await request.text();
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText) as typeof body;
    } catch {
      return adminJson({ ok: false, latencyMs: 0, model: '', error: 'invalid_json' }, 400);
    }
  }

  const active = await resolveLlmConfig(env);

  let baseUrl = active.baseUrl;
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    const validated = validateLlmBaseUrl(body.baseUrl);
    if (!validated) {
      return adminJson({ ok: false, latencyMs: 0, model: active.model, error: 'invalid_base_url' }, 400);
    }
    baseUrl = validated;
  }

  const model =
    typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : active.model;
  const apiKey =
    typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : active.apiKey;

  if (!baseUrl || !apiKey) {
    return adminJson({ ok: false, latencyMs: 0, model, error: 'llm_not_configured' });
  }

  const doFetch = env.fetchImpl ?? ((u: string, init: RequestInit) => fetch(u, init));
  const startedAt = Date.now();

  try {
    const resp = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 160).trim();
      return adminJson({
        ok: false,
        latencyMs,
        model,
        error: `upstream_http_${resp.status}${detail ? `: ${detail}` : ''}`,
      });
    }

    await resp.json().catch(() => ({}));
    return adminJson({ ok: true, latencyMs, model });
  } catch (err) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return adminJson({
      ok: false,
      latencyMs,
      model,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── GET /admin/api/llm-balance ─────────────────────────────────────────────

async function apiLlmBalance(env: Env): Promise<Response> {
  const active = await resolveLlmConfig(env);
  if (!active.baseUrl || !active.apiKey) {
    return adminJson({ ok: true, supported: false, reason: 'llm_not_configured' });
  }

  let parsed: URL;
  try {
    parsed = new URL(active.baseUrl);
  } catch {
    return adminJson({ ok: false, supported: false, error: 'invalid_base_url' });
  }

  if (!/(^|\.)deepseek\.com$/i.test(parsed.hostname)) {
    return adminJson({
      ok: true,
      supported: false,
      provider: parsed.hostname,
    });
  }

  const doFetch = env.fetchImpl ?? ((u: string, init: RequestInit) => fetch(u, init));
  try {
    const resp = await doFetch(`${parsed.origin}/user/balance`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${active.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return adminJson({
        ok: false,
        supported: true,
        error: `upstream_http_${resp.status}`,
      });
    }

    const data = (await resp.json()) as {
      is_available?: boolean;
      balance_infos?: Array<{
        currency?: string;
        total_balance?: string;
        granted_balance?: string;
        topped_up_balance?: string;
      }>;
    };

    const balanceInfos = (data.balance_infos ?? []).map((b) => ({
      currency: b.currency ?? 'CNY',
      totalBalance: b.total_balance ?? '0.00',
      grantedBalance: b.granted_balance ?? '0.00',
      toppedUpBalance: b.topped_up_balance ?? '0.00',
    }));

    return adminJson({
      ok: true,
      supported: true,
      isAvailable: data.is_available ?? true,
      balanceInfos,
    });
  } catch (err) {
    return adminJson({
      ok: false,
      supported: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
