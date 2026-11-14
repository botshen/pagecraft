#!/usr/bin/env node
/**
 * Operator dashboard in the terminal: `pnpm stats [days]` (default 28).
 *
 * Reads only aggregate tables from the remote D1 via wrangler — there is no
 * public stats endpoint, so nothing here is exposed to the internet.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const WRANGLER = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.bin/wrangler');

const days = Math.max(1, Number(process.argv[2]) || 28);
const sinceMs = Date.now() - days * 86_400_000;
const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);

function query(sql) {
  const out = execFileSync(
    WRANGLER,
    ['d1', 'execute', 'pagecraft-cloud', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? [];
}

const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');

console.log(`\nPageCraft Cloud — last ${days} days (since ${sinceDate})\n`);

const [installs] = query(
  `SELECT
     (SELECT COUNT(*) FROM install_secrets WHERE created_at >= ${sinceMs}) AS new_installs,
     (SELECT COUNT(*) FROM install_secrets) AS total_installs,
     (SELECT COUNT(*) FROM install_quotas WHERE used_count > 0) AS installs_generated,
     (SELECT COUNT(*) FROM install_quotas WHERE used_count >= 10) AS installs_exhausted`,
);
console.log('Installs (cloud-registered)');
console.table([installs]);

const [llm] = query(
  `SELECT COUNT(*) AS calls,
          SUM(status = 'ok') AS ok,
          SUM(status = 'error') AS errors,
          SUM(total_tokens) AS tokens,
          CAST(AVG(CASE WHEN status = 'ok' THEN duration_ms END) AS INTEGER) AS avg_ms
     FROM llm_calls WHERE ts >= ${sinceMs}`,
);
console.log('Cloud generations');
console.table([{ ...llm, ok_rate: pct(llm.ok ?? 0, llm.calls ?? 0) }]);

const fb = query(
  `SELECT engine, ai_source, refined, selector,
          SUM(CASE WHEN verdict = 'up' THEN count ELSE 0 END) AS up,
          SUM(CASE WHEN verdict = 'down' THEN count ELSE 0 END) AS down
     FROM feedback_daily WHERE date >= '${sinceDate}'
     GROUP BY engine, ai_source, refined, selector
     ORDER BY up + down DESC`,
);
const totUp = fb.reduce((s, r) => s + r.up, 0);
const totDown = fb.reduce((s, r) => s + r.down, 0);
console.log(`"Did it work?" feedback — 👍 ${totUp} / 👎 ${totDown} (👍 rate ${pct(totUp, totUp + totDown)})`);
console.table(fb.map((r) => ({ ...r, up_rate: pct(r.up, r.up + r.down) })));

const daily = query(
  `SELECT date,
          SUM(CASE WHEN verdict = 'up' THEN count ELSE 0 END) AS up,
          SUM(CASE WHEN verdict = 'down' THEN count ELSE 0 END) AS down
     FROM feedback_daily WHERE date >= '${sinceDate}'
     GROUP BY date ORDER BY date`,
);
if (daily.length) {
  console.log('Feedback by day');
  console.table(daily);
}
