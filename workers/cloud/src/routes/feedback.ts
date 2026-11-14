/**
 * POST /api/feedback — anonymous "did this generated mod work?" vote.
 *
 * Privacy: the vote is folded into a daily aggregate counter
 * (`feedback_daily`). Nothing install-identifying, no prompt, URL, host, or
 * code is ever stored. The install signature is only used to keep scripted
 * vote flooding out; the per-install throttle lives in `rate_limits`, which
 * already holds install-scoped daily counters.
 */

import type { Env } from '../types';
import { checkRateLimit, json } from '../index';
import { verifyInstallSig } from '../lib/auth';

export const MAX_FEEDBACK_PER_INSTALL_PER_DAY = 60;
const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

type Verdict = 'up' | 'down';
type Engine = 'css' | 'js';
type AiSource = 'cloud' | 'byok';
type SelectorState = 'hit' | 'miss' | 'na';

export interface FeedbackBody {
  verdict: Verdict;
  engine: Engine;
  aiSource: AiSource;
  refined: boolean;
  selector: SelectorState;
}

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function parseFeedbackBody(raw: unknown): FeedbackBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const verdict = pick(o.verdict, ['up', 'down'] as const);
  const engine = pick(o.engine, ['css', 'js'] as const);
  const aiSource = pick(o.aiSource, ['cloud', 'byok'] as const);
  const selector = pick(o.selector ?? 'na', ['hit', 'miss', 'na'] as const);
  if (!verdict || !engine || !aiSource || !selector) return null;
  return { verdict, engine, aiSource, refined: o.refined === true, selector };
}

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const installId = request.headers.get('X-Install-Id')?.trim() ?? '';
  if (!INSTALL_ID_RE.test(installId)) {
    return json({ ok: false, error: 'missing_or_invalid_install_id' }, 401);
  }
  const auth = await verifyInstallSig(request, env, installId);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  const body = parseFeedbackBody(raw);
  if (!body) {
    return json({ ok: false, error: 'invalid_feedback' }, 400);
  }

  const rl = await checkRateLimit(env, installId, 'feedback', MAX_FEEDBACK_PER_INSTALL_PER_DAY);
  if (!rl.allowed) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const today = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO feedback_daily (date, verdict, engine, ai_source, refined, selector, count)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (date, verdict, engine, ai_source, refined, selector)
     DO UPDATE SET count = feedback_daily.count + 1`,
  )
    .bind(today, body.verdict, body.engine, body.aiSource, body.refined ? 1 : 0, body.selector)
    .run();

  return json({ ok: true });
}
