import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';
import { makeHarness, req, seedSecret, signedReq, INSTALL, TEST_SECRET } from './helpers/env';

const ctx = {
  waitUntil: (p: Promise<unknown>) => p.catch(() => {}),
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function register(
  env: Parameters<typeof worker.fetch>[1],
  body: unknown,
  request?: Request,
) {
  return worker.fetch(request ?? req('/api/register', { method: 'POST', body }), env, ctx);
}

test('registered install cannot be re-claimed without a signature', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL);

  const response = await register(env, { installId: INSTALL });
  const body = (await response.json()) as { ok: boolean; error: string; reason?: string };

  assert.equal(response.status, 409);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'already_registered');
  // The precise reason travels along (debuggable without leaking the secret).
  assert.equal(body.reason, 'missing_signature_headers');
});

test('a signature under a different secret is rejected, never rotated', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL, TEST_SECRET);

  const response = await register(
    env,
    { installId: INSTALL },
    await signedReq('/api/register', {
      method: 'POST',
      installId: INSTALL,
      secret: 'b'.repeat(64),
      body: { installId: INSTALL },
    }),
  );
  const body = (await response.json()) as { ok: boolean; error: string; reason?: string };

  assert.equal(response.status, 409);
  assert.equal(body.reason, 'invalid_signature');

  // The real secret is untouched.
  const row = await d1
    .prepare(`SELECT secret FROM install_secrets WHERE install_id = ?`)
    .bind(INSTALL)
    .first<{ secret: string }>();
  assert.equal(row?.secret, TEST_SECRET);
});

test('registered install can re-register idempotently with the current signature', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL);

  const response = await register(
    env,
    { installId: INSTALL },
    await signedReq('/api/register', {
      method: 'POST',
      installId: INSTALL,
      secret: TEST_SECRET,
      body: { installId: INSTALL },
    }),
  );
  const body = (await response.json()) as { ok?: boolean; secret?: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.secret ?? '', /^[0-9a-f]{64}$/);
  assert.equal(body.secret, TEST_SECRET, 'read back, never rotated');
});

// ─── Quota: only NEW installs count ────────────────────────────────────────

const freshId = (i: number) => `install-${String(i).padStart(4, '0')}-${'z'.repeat(20)}`;

test('rejected re-register attempts never consume the per-IP quota', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL);

  // A stuck client retries far past the limit…
  for (let i = 0; i < 15; i++) {
    assert.equal((await register(env, { installId: INSTALL })).status, 409);
  }
  // …yet a fresh install from the same IP still gets its budget.
  for (let i = 0; i < 10; i++) {
    assert.equal((await register(env, { installId: freshId(i) })).status, 200);
  }
  assert.equal((await register(env, { installId: freshId(99) })).status, 429);
});

test('an over-quota claim is rolled back — no half-created install', async () => {
  const { env, d1 } = makeHarness();

  for (let i = 0; i < 10; i++) {
    assert.equal((await register(env, { installId: freshId(i) })).status, 200);
  }
  const blocked = freshId(11);
  assert.equal((await register(env, { installId: blocked })).status, 429);

  const row = await d1
    .prepare(`SELECT secret FROM install_secrets WHERE install_id = ?`)
    .bind(blocked)
    .first<{ secret: string }>();
  assert.equal(row, null, 'the rate-limited claim left no row behind');
});
