import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';
import { maskApiKey } from '../src/lib/llm-config';
import { computeAdminSessionValue } from '../src/routes/admin';
import { INSTALL, makeHarness, req, seedSecret, signedReq } from './helpers/env';

const ADMIN_TOKEN = 'super-secret-admin-token-2026';

function bearerReq(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  return req(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(opts.headers ?? {}),
    },
  });
}

test('GET / and /index.html serve the bilingual PageCraft landing page via worker.fetch', async () => {
  const { env } = makeHarness();

  const zhRes = await worker.fetch(req('/'), env);
  assert.equal(zhRes.status, 200);
  assert.match(zhRes.headers.get('Content-Type') ?? '', /text\/html/i);
  assert.ok(zhRes.headers.get('Content-Security-Policy'));
  const zhHtml = await zhRes.text();
  assert.match(zhHtml, /<!DOCTYPE html>/i);
  assert.match(zhHtml, /PageCraft/);

  const enRes = await worker.fetch(req('/index.html?lang=en'), env);
  assert.equal(enRes.status, 200);
  const enHtml = await enRes.text();
  assert.match(enHtml, /data-lang="en"/);

  const headRes = await worker.fetch(req('/', { method: 'HEAD' }), env);
  assert.equal(headRes.status, 200);
  assert.equal(await headRes.text(), '');
});

test('/admin returns 503 with setup instructions when ADMIN_TOKEN is unset or < 16 chars', async () => {
  const { env } = makeHarness();
  delete env.ADMIN_TOKEN;

  const pageRes = await worker.fetch(req('/admin'), env);
  assert.equal(pageRes.status, 503);
  assert.equal(pageRes.headers.get('Cache-Control'), 'no-store');
  assert.equal(pageRes.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(pageRes.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(await pageRes.text(), /ADMIN_TOKEN/);

  const apiRes = await worker.fetch(req('/admin/api/overview'), env);
  assert.equal(apiRes.status, 503);
  const apiBody = (await apiRes.json()) as { ok: boolean; error: string; message: string };
  assert.equal(apiBody.ok, false);
  assert.equal(apiBody.error, 'admin_not_configured');
  assert.match(apiBody.message, /ADMIN_TOKEN/);

  // Short token (< 16 chars) is also rejected with 503
  env.ADMIN_TOKEN = 'too-short-123';
  const shortRes = await worker.fetch(bearerReq('/admin/api/overview'), env);
  assert.equal(shortRes.status, 503);
});

test('unauthenticated /admin renders login HTML; unauthenticated /admin/api/* returns 401 without CORS', async () => {
  const { env } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;

  const loginPage = await worker.fetch(req('/admin'), env);
  assert.equal(loginPage.status, 200);
  assert.equal(loginPage.headers.get('Cache-Control'), 'no-store');
  assert.equal(loginPage.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(loginPage.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(loginPage.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);
  const html = await loginPage.text();
  assert.match(html, /action="\/admin\/login"/);
  assert.match(html, /PageCraft Cloud/);

  for (const [method, path] of [
    ['GET', '/admin/api/overview'],
    ['POST', '/admin/api/llm-config'],
    ['POST', '/admin/api/llm-test'],
    ['GET', '/admin/api/llm-balance'],
  ] as const) {
    const r = await worker.fetch(req(path, { method }), env);
    assert.equal(r.status, 401, `${method} ${path} must reject unauthenticated with 401`);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
    const body = (await r.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, 'unauthorized');
  }

  // OPTIONS on /admin* must never emit wildcard CORS headers
  const optRes = await worker.fetch(req('/admin/api/overview', { method: 'OPTIONS' }), env);
  assert.equal(optRes.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(optRes.headers.get('X-Frame-Options'), 'DENY');
});

test('POST /admin/login issues pc_admin HMAC cookie, rate-limits failures at 15/day per IP, and logout clears session', async () => {
  const { env } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;

  // 15 wrong attempts from attacker IP return 401; 16th returns 429
  for (let i = 1; i <= 15; i++) {
    const bad = await worker.fetch(
      req('/admin/login', {
        method: 'POST',
        body: { token: `wrong-attempt-${i}` },
        headers: { 'cf-connecting-ip': '203.0.113.99' },
      }),
      env,
    );
    assert.equal(bad.status, 401, `failure #${i} should be 401`);
  }

  const lockedOut = await worker.fetch(
    req('/admin/login', {
      method: 'POST',
      body: { token: 'wrong-attempt-16' },
      headers: { 'cf-connecting-ip': '203.0.113.99' },
    }),
    env,
  );
  assert.equal(lockedOut.status, 429, '16th failure from same IP must be 429 rate_limited');

  // Even supplying the right token from the locked-out IP is blocked for the day
  const blockedRight = await worker.fetch(
    req('/admin/login', {
      method: 'POST',
      body: { token: ADMIN_TOKEN },
      headers: { 'cf-connecting-ip': '203.0.113.99' },
    }),
    env,
  );
  assert.equal(blockedRight.status, 429);

  // Legitimate operator from another IP logs in cleanly and gets pc_admin cookie
  const loginRes = await worker.fetch(
    req('/admin/login', {
      method: 'POST',
      body: { token: ADMIN_TOKEN },
      headers: { 'cf-connecting-ip': '198.51.100.7' },
    }),
    env,
  );
  assert.equal(loginRes.status, 200);
  const setCookie = loginRes.headers.get('Set-Cookie') ?? '';
  const expectedHmac = await computeAdminSessionValue(ADMIN_TOKEN);
  assert.match(setCookie, new RegExp(`^pc_admin=${expectedHmac};`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/admin/);
  assert.ok(!setCookie.includes(ADMIN_TOKEN), 'cookie must never contain raw ADMIN_TOKEN');

  // Authenticated GET /admin via cookie renders dashboard HTML
  const dashRes = await worker.fetch(
    req('/admin', { headers: { Cookie: `pc_admin=${expectedHmac}` } }),
    env,
  );
  assert.equal(dashRes.status, 200);
  const dashHtml = await dashRes.text();
  assert.match(dashHtml, /LLM 密钥与模型在线配置/);
  assert.match(dashHtml, /SiliconFlow/);
  assert.match(dashHtml, /OpenRouter/);

  // Tampered cookie is rejected
  const tampered = await worker.fetch(
    req('/admin/api/overview', {
      headers: { Cookie: `pc_admin=${'0'.repeat(64)}` },
    }),
    env,
  );
  assert.equal(tampered.status, 401);

  // Logout clears cookie
  const logoutRes = await worker.fetch(
    req('/admin/logout', {
      method: 'POST',
      headers: { Cookie: `pc_admin=${expectedHmac}`, Accept: 'application/json' },
    }),
    env,
  );
  assert.equal(logoutRes.status, 200);
  assert.match(logoutRes.headers.get('Set-Cookie') ?? '', /^pc_admin=;.*Max-Age=0/);
});

test('saving D1 LLM key encrypts at rest, never leaks raw key, and powers /api/generate when env key is empty', async () => {
  const { env, d1 } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;
  env.PRIMARY_LLM_BASE_URL = '';
  env.PRIMARY_LLM_API_KEY = '';
  env.PRIMARY_LLM_MODEL = '';

  await seedSecret(d1, INSTALL);

  const outboundAuth: Array<{ url: string; auth: string | null; model: string }> = [];
  env.fetchImpl = async (url: string, init: RequestInit) => {
    const hdrs = new Headers(init.headers);
    const parsedBody = init.body ? (JSON.parse(String(init.body)) as { model?: string }) : {};
    outboundAuth.push({
      url,
      auth: hdrs.get('Authorization'),
      model: parsedBody.model ?? '',
    });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Hide Banner',
                engine: 'css',
                css: '.banner { display: none !important; }',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  // Before configuring D1 override, /api/generate returns 503 llm_not_configured
  const beforeGen = await worker.fetch(
    await signedReq('/api/generate', {
      method: 'POST',
      installId: INSTALL,
      body: { prompt: 'You generate browser mods for PageCraft.\nHide promo banner' },
    }),
    env,
  );
  assert.equal(beforeGen.status, 503);

  // Reject non-http(s) baseUrl
  const badUrlRes = await worker.fetch(
    bearerReq('/admin/api/llm-config', {
      method: 'POST',
      body: { baseUrl: 'ftp://invalid.example/v1', model: 'deepseek-chat', apiKey: 'sk-live-secret-9876' },
    }),
    env,
  );
  assert.equal(badUrlRes.status, 400);

  // Save valid D1 override via /admin/api/llm-config
  const rawSecret = 'sk-deepseek-prod-secret-9876';
  const saveRes = await worker.fetch(
    bearerReq('/admin/api/llm-config', {
      method: 'POST',
      body: {
        baseUrl: 'https://api.deepseek.com/v1/',
        model: 'deepseek-chat',
        apiKey: rawSecret,
      },
    }),
    env,
  );
  assert.equal(saveRes.status, 200);
  const saveText = await saveRes.text();
  assert.ok(!saveText.includes(rawSecret), 'save response must never leak raw apiKey');
  const saveJson = JSON.parse(saveText) as {
    ok: boolean;
    llmConfig: {
      source: string;
      baseUrl: string;
      model: string;
      hasApiKey: boolean;
      maskedKey: string;
    };
  };
  assert.equal(saveJson.ok, true);
  assert.equal(saveJson.llmConfig.source, 'd1');
  assert.equal(saveJson.llmConfig.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(saveJson.llmConfig.model, 'deepseek-chat');
  assert.equal(saveJson.llmConfig.hasApiKey, true);
  assert.equal(saveJson.llmConfig.maskedKey, 'sk-****9876');

  // Verify D1 stores AES-GCM ciphertext (`v1:...`), never plaintext
  const storedRow = await d1
    .prepare(`SELECT value FROM runtime_config WHERE key = 'llm_api_key_enc'`)
    .first<{ value: string }>();
  assert.ok(storedRow?.value.startsWith('v1:'), 'D1 key must be AES-GCM encrypted');
  assert.ok(!storedRow!.value.includes(rawSecret), 'ciphertext must not contain raw secret');

  // Now /api/generate succeeds immediately using the decrypted D1 key!
  const afterGen = await worker.fetch(
    await signedReq('/api/generate', {
      method: 'POST',
      installId: INSTALL,
      body: { prompt: 'You generate browser mods for PageCraft.\nHide promo banner' },
    }),
    env,
  );
  assert.equal(afterGen.status, 200);
  assert.equal(outboundAuth.length, 1);
  assert.equal(outboundAuth[0]!.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(outboundAuth[0]!.auth, `Bearer ${rawSecret}`);
  assert.equal(outboundAuth[0]!.model, 'deepseek-chat');

  // Updating model with blank apiKey preserves existing stored D1 key
  const updateModelRes = await worker.fetch(
    bearerReq('/admin/api/llm-config', {
      method: 'POST',
      body: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', apiKey: '' },
    }),
    env,
  );
  assert.equal(updateModelRes.status, 200);

  const gen2 = await worker.fetch(
    await signedReq('/api/generate', {
      method: 'POST',
      installId: INSTALL,
      body: { prompt: 'You generate browser mods for PageCraft.\nRefine layout' },
    }),
    env,
  );
  assert.equal(gen2.status, 200);
  assert.equal(outboundAuth[1]!.auth, `Bearer ${rawSecret}`);
  assert.equal(outboundAuth[1]!.model, 'deepseek-reasoner');

  // Clearing override deletes D1 rows and reverts to 'none' (since env is empty)
  const clearRes = await worker.fetch(
    bearerReq('/admin/api/llm-config', {
      method: 'POST',
      body: { clearOverride: true },
    }),
    env,
  );
  assert.equal(clearRes.status, 200);
  const clearJson = (await clearRes.json()) as { llmConfig: { source: string; hasApiKey: boolean } };
  assert.equal(clearJson.llmConfig.source, 'none');
  assert.equal(clearJson.llmConfig.hasApiKey, false);
});

test('maskApiKey never leaks raw secret across all key lengths', () => {
  assert.equal(maskApiKey(''), '');
  for (const secret of ['abc', 'abcd', 'test-key', '123456789012', 'sk-1234567890abcdef', 'or-v1-abcdef1234567890']) {
    const masked = maskApiKey(secret);
    assert.notEqual(masked, secret, `masked must not equal raw secret (${secret})`);
    assert.ok(!masked.includes(secret), `masked must not contain raw secret (${secret})`);
    assert.match(masked, /\*\*\*\*/);
  }
  assert.equal(maskApiKey('sk-1234567890abcd'), 'sk-****abcd');
});

test('llm-test and llm-balance use fetchImpl and resolve DeepSeek origin cleanly', async () => {
  const { env } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;
  env.PRIMARY_LLM_BASE_URL = 'https://api.openai.com/v1';
  env.PRIMARY_LLM_API_KEY = 'sk-openai-key-1111';
  env.PRIMARY_LLM_MODEL = 'gpt-4o-mini';

  const seenCalls: Array<{ url: string; method: string; auth: string | null }> = [];
  env.fetchImpl = async (url: string, init: RequestInit) => {
    const hdrs = new Headers(init.headers);
    seenCalls.push({
      url,
      method: init.method ?? 'GET',
      auth: hdrs.get('Authorization'),
    });
    if (url.endsWith('/user/balance')) {
      return new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '128.50',
              granted_balance: '28.50',
              topped_up_balance: '100.00',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  // Non-DeepSeek provider returns supported: false without making outbound balance call
  const openAiBal = await worker.fetch(bearerReq('/admin/api/llm-balance'), env);
  assert.equal(openAiBal.status, 200);
  const openAiBalJson = (await openAiBal.json()) as { ok: boolean; supported: boolean };
  assert.equal(openAiBalJson.ok, true);
  assert.equal(openAiBalJson.supported, false);
  assert.equal(seenCalls.length, 0);

  // llm-test against active config
  const testActive = await worker.fetch(
    bearerReq('/admin/api/llm-test', { method: 'POST', body: {} }),
    env,
  );
  assert.equal(testActive.status, 200);
  const testActiveJson = (await testActive.json()) as {
    ok: boolean;
    latencyMs: number;
    model: string;
  };
  assert.equal(testActiveJson.ok, true);
  assert.equal(testActiveJson.model, 'gpt-4o-mini');
  assert.equal(typeof testActiveJson.latencyMs, 'number');
  assert.equal(seenCalls[0]!.url, 'https://api.openai.com/v1/chat/completions');

  // Save DeepSeek config with /v1 suffix and verify llm-balance hits origin `/user/balance`
  await worker.fetch(
    bearerReq('/admin/api/llm-config', {
      method: 'POST',
      body: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-deepseek-balance-2222',
      },
    }),
    env,
  );

  const dsBal = await worker.fetch(bearerReq('/admin/api/llm-balance'), env);
  assert.equal(dsBal.status, 200);
  const dsBalJson = (await dsBal.json()) as {
    ok: boolean;
    supported: boolean;
    balanceInfos?: Array<{ currency: string; totalBalance: string }>;
  };
  assert.equal(dsBalJson.ok, true);
  assert.equal(dsBalJson.supported, true);
  assert.equal(dsBalJson.balanceInfos?.[0]?.currency, 'CNY');
  assert.equal(dsBalJson.balanceInfos?.[0]?.totalBalance, '128.50');
  assert.equal(seenCalls[1]!.url, 'https://api.deepseek.com/user/balance');
  assert.equal(seenCalls[1]!.auth, 'Bearer sk-deepseek-balance-2222');
});

test('GET /admin/api/overview aggregates installs, generations, feedback, and llmConfig within SQL query budget', async () => {
  const { env, d1 } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;
  env.PRIMARY_LLM_API_KEY = 'sk-overview-secret-5555';

  const now = Date.now();
  const oldTs = now - 60 * 86_400_000; // outside 28d window
  const recentTs = now - 2 * 86_400_000;
  const today = new Date(now).toISOString().slice(0, 10);

  // Seed 3 installs: 1 old, 2 recent; 2 generated at least once; 1 exhausted (10/10)
  await d1
    .prepare(`INSERT INTO install_secrets (install_id, secret, created_at) VALUES (?, ?, ?)`)
    .bind('inst-old-0000000001', 'a'.repeat(64), oldTs)
    .run();
  await d1
    .prepare(`INSERT INTO install_secrets (install_id, secret, created_at) VALUES (?, ?, ?)`)
    .bind('inst-new-0000000002', 'b'.repeat(64), recentTs)
    .run();
  await d1
    .prepare(`INSERT INTO install_secrets (install_id, secret, created_at) VALUES (?, ?, ?)`)
    .bind('inst-new-0000000003', 'c'.repeat(64), now)
    .run();

  await d1
    .prepare(`INSERT INTO install_quotas (install_id, used_count, updated_at) VALUES (?, ?, ?)`)
    .bind('inst-old-0000000001', 10, now)
    .run();
  await d1
    .prepare(`INSERT INTO install_quotas (install_id, used_count, updated_at) VALUES (?, ?, ?)`)
    .bind('inst-new-0000000002', 3, now)
    .run();

  // Seed llm_calls (2 ok, 1 error in window)
  await d1
    .prepare(
      `INSERT INTO llm_calls (id, ts, model, kind, install_id, prompt_tokens, completion_tokens, total_tokens, duration_ms, status)
       VALUES (?, ?, 'deepseek-chat', 'pagecraft_gen', 'inst-new-0000000002', 200, 50, 250, 800, 'ok')`,
    )
    .bind('call-1', recentTs)
    .run();
  await d1
    .prepare(
      `INSERT INTO llm_calls (id, ts, model, kind, install_id, prompt_tokens, completion_tokens, total_tokens, duration_ms, status)
       VALUES (?, ?, 'deepseek-chat', 'pagecraft_gen', 'inst-new-0000000002', 300, 100, 400, 1200, 'ok')`,
    )
    .bind('call-2', now)
    .run();
  await d1
    .prepare(
      `INSERT INTO llm_calls (id, ts, model, kind, install_id, prompt_tokens, completion_tokens, total_tokens, duration_ms, status, error)
       VALUES (?, ?, 'deepseek-chat', 'pagecraft_gen', 'inst-new-0000000003', 0, 0, 0, 450, 'error', 'upstream_http_502')`,
    )
    .bind('call-3', now)
    .run();

  // Seed feedback_daily
  await d1
    .prepare(
      `INSERT INTO feedback_daily (date, verdict, engine, ai_source, refined, selector, count)
       VALUES (?, 'up', 'css', 'cloud', 0, 'hit', 7)`,
    )
    .bind(today)
    .run();
  await d1
    .prepare(
      `INSERT INTO feedback_daily (date, verdict, engine, ai_source, refined, selector, count)
       VALUES (?, 'down', 'css', 'cloud', 0, 'hit', 2)`,
    )
    .bind(today)
    .run();
  await d1
    .prepare(
      `INSERT INTO feedback_daily (date, verdict, engine, ai_source, refined, selector, count)
       VALUES (?, 'up', 'js', 'byok', 1, 'na', 4)`,
    )
    .bind(today)
    .run();

  d1.resetQueryCount();
  const res = await worker.fetch(bearerReq('/admin/api/overview?days=28'), env);
  const queriesUsed = d1.queryCount;

  assert.equal(res.status, 200);
  assert.ok(queriesUsed <= 10, `expected <= 10 SQL queries, got ${queriesUsed}`);

  const rawText = await res.text();
  assert.ok(!rawText.includes('sk-overview-secret-5555'), 'overview must never leak raw env API key');

  const body = JSON.parse(rawText) as {
    ok: boolean;
    days: number;
    installs: {
      total: number;
      newInWindow: number;
      generatedAtLeastOnce: number;
      exhaustedQuota: number;
    };
    generations: {
      calls: number;
      ok: number;
      errors: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      avgDurationMs: number;
      daily: Array<{ date: string; calls: number }>;
      recent: Array<{ id: string; status: string }>;
    };
    feedback: {
      up: number;
      down: number;
      total: number;
      buckets: Array<{ engine: string; aiSource: string; up: number; down: number }>;
      daily: Array<{ date: string; up: number; down: number }>;
    };
    llmConfig: {
      source: string;
      baseUrl: string;
      model: string;
      hasApiKey: boolean;
      maskedKey: string;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.days, 28);
  assert.deepEqual(body.installs, {
    total: 3,
    newInWindow: 2,
    generatedAtLeastOnce: 2,
    exhaustedQuota: 1,
  });

  assert.equal(body.generations.calls, 3);
  assert.equal(body.generations.ok, 2);
  assert.equal(body.generations.errors, 1);
  assert.equal(body.generations.promptTokens, 500);
  assert.equal(body.generations.completionTokens, 150);
  assert.equal(body.generations.totalTokens, 650);
  assert.equal(body.generations.avgDurationMs, 1000);
  assert.equal(body.generations.recent.length, 3);
  assert.ok(body.generations.daily.length >= 28);

  assert.equal(body.feedback.up, 11);
  assert.equal(body.feedback.down, 2);
  assert.equal(body.feedback.total, 13);
  assert.equal(body.feedback.buckets.length, 2);

  assert.equal(body.llmConfig.source, 'env');
  assert.equal(body.llmConfig.hasApiKey, true);
  assert.equal(body.llmConfig.maskedKey, 'sk-****5555');
});

test('CSRF Origin check blocks cross-origin POST /admin/* while allowing same-origin POST', async () => {
  const { env } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;

  // Cross-origin POST is rejected with 403 even with valid Bearer token
  const evilOriginRes = await worker.fetch(
    bearerReq('/admin/api/daily-limit', {
      method: 'POST',
      headers: { Origin: 'https://evil-attacker.example' },
      body: { dailyGlobalLimit: 999999 },
    }),
    env,
  );
  assert.equal(evilOriginRes.status, 403);
  const evilBody = (await evilOriginRes.json()) as { ok: boolean; error: string };
  assert.equal(evilBody.ok, false);
  assert.equal(evilBody.error, 'csrf_origin_mismatch');

  // Cross-origin POST on /admin/login is also rejected with 403
  const evilLogin = await worker.fetch(
    req('/admin/login', {
      method: 'POST',
      headers: { Origin: 'null' },
      body: { token: ADMIN_TOKEN },
    }),
    env,
  );
  assert.equal(evilLogin.status, 403);

  // Same-origin POST (`https://worker.test`) succeeds
  const sameOriginRes = await worker.fetch(
    bearerReq('/admin/api/daily-limit', {
      method: 'POST',
      headers: { Origin: 'https://worker.test' },
      body: { dailyGlobalLimit: 2500 },
    }),
    env,
  );
  assert.equal(sameOriginRes.status, 200);
});

test('POST /admin/api/daily-limit updates runtime daily_global_limit live and exposes todayGlobalCalls in overview', async () => {
  const { env, d1 } = makeHarness();
  env.ADMIN_TOKEN = ADMIN_TOKEN;
  await seedSecret(d1, INSTALL);

  // Default limit is 2000
  const ov0 = await (await worker.fetch(bearerReq('/admin/api/overview'), env)).json() as {
    dailyGlobalLimit: number;
    todayGlobalCalls: number;
    dailyGlobalCap: { source: string; limit: number; usedToday: number };
  };
  assert.equal(ov0.dailyGlobalLimit, 2000);
  assert.equal(ov0.todayGlobalCalls, 0);
  assert.equal(ov0.dailyGlobalCap.source, 'default');

  // Adjust dailyGlobalLimit to 1 via /admin/api/daily-limit
  const saveCap = await worker.fetch(
    bearerReq('/admin/api/daily-limit', {
      method: 'POST',
      body: { dailyGlobalLimit: 1 },
    }),
    env,
  );
  assert.equal(saveCap.status, 200);

  // 1st generation succeeds; 2nd hits 503 daily_capacity_reached
  const g1 = await worker.fetch(
    await signedReq('/api/generate', {
      method: 'POST',
      installId: INSTALL,
      body: { prompt: 'You generate browser mods for PageCraft.\nFirst tweak' },
    }),
    env,
  );
  assert.equal(g1.status, 200);

  const g2 = await worker.fetch(
    await signedReq('/api/generate', {
      method: 'POST',
      installId: INSTALL,
      body: { prompt: 'You generate browser mods for PageCraft.\nSecond tweak' },
    }),
    env,
  );
  assert.equal(g2.status, 503);
  const g2Json = (await g2.json()) as { error: string };
  assert.equal(g2Json.error, 'daily_capacity_reached');

  // Overview reflects usedToday = 1, limit = 1, source = 'd1'
  const ov1 = await (await worker.fetch(bearerReq('/admin/api/overview'), env)).json() as {
    dailyGlobalLimit: number;
    todayGlobalCalls: number;
    dailyGlobalCap: { source: string; limit: number; usedToday: number; remaining: number };
  };
  assert.equal(ov1.dailyGlobalLimit, 1);
  assert.equal(ov1.todayGlobalCalls, 1);
  assert.equal(ov1.dailyGlobalCap.source, 'd1');
  assert.equal(ov1.dailyGlobalCap.remaining, 0);

  // Resetting override restores default 2000 and unblocks generation immediately
  const resetCap = await worker.fetch(
    bearerReq('/admin/api/daily-limit', {
      method: 'POST',
      body: { clearOverride: true },
    }),
    env,
  );
  assert.equal(resetCap.status, 200);
  const resetJson = (await resetCap.json()) as { dailyGlobalLimit: number; dailyGlobalCap: { source: string } };
  assert.equal(resetJson.dailyGlobalLimit, 2000);
  assert.equal(resetJson.dailyGlobalCap.source, 'default');
});
