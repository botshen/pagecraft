import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';
import { MAX_FEEDBACK_PER_INSTALL_PER_DAY } from '../src/routes/feedback';
import { makeHarness, req, seedSecret, signedReq, INSTALL } from './helpers/env';

const vote = {
  verdict: 'up',
  engine: 'css',
  aiSource: 'cloud',
  refined: false,
  selector: 'hit',
};

test('feedback requires a valid install signature', async () => {
  const { env } = makeHarness();
  const r = await worker.fetch(
    req('/api/feedback', { method: 'POST', installId: INSTALL, body: vote }),
    env,
  );
  assert.equal(r.status, 401);
});

test('feedback is folded into anonymous daily aggregates (no install id stored)', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL);

  for (const body of [vote, vote, { ...vote, verdict: 'down', selector: 'miss' }]) {
    const r = await worker.fetch(
      await signedReq('/api/feedback', { method: 'POST', installId: INSTALL, body }),
      env,
    );
    assert.equal(r.status, 200);
  }

  const rows = d1.db
    .prepare(`SELECT verdict, engine, ai_source, refined, selector, count FROM feedback_daily ORDER BY verdict DESC`)
    .all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[0] },
    { verdict: 'up', engine: 'css', ai_source: 'cloud', refined: 0, selector: 'hit', count: 2 },
  );
  assert.equal(rows[1].verdict, 'down');
  assert.equal(rows[1].count, 1);

  const cols = (d1.db.prepare(`PRAGMA table_info(feedback_daily)`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  assert.ok(!cols.includes('install_id'), 'feedback_daily must never carry install identity');
});

test('malformed feedback is rejected', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL);
  for (const body of [{}, { ...vote, verdict: 'meh' }, { ...vote, engine: 'wasm' }, { ...vote, aiSource: 'x' }]) {
    const r = await worker.fetch(
      await signedReq('/api/feedback', { method: 'POST', installId: INSTALL, body }),
      env,
    );
    assert.equal(r.status, 400);
  }
});

test('feedback is throttled per install per day', async () => {
  const { env, d1 } = makeHarness();
  await seedSecret(d1, INSTALL);
  let last = 0;
  for (let i = 0; i < MAX_FEEDBACK_PER_INSTALL_PER_DAY + 1; i++) {
    const r = await worker.fetch(
      await signedReq('/api/feedback', { method: 'POST', installId: INSTALL, body: vote }),
      env,
    );
    last = r.status;
  }
  assert.equal(last, 429);
  const row = d1.db.prepare(`SELECT SUM(count) AS n FROM feedback_daily`).get() as { n: number };
  assert.equal(row.n, MAX_FEEDBACK_PER_INSTALL_PER_DAY);
});
