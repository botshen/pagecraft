/**
 * POST /api/register — issue (or read back) an install's signing secret.
 *
 * The install generates a random installId locally and calls this once; the
 * server returns a 64-hex secret the client then uses to HMAC-sign every
 * subsequent protected request.
 *
 * Two branches:
 *   - first claim (no row): the caller mints a fresh secret — this is also how
 *     a pre-secret install, or an install on a newly configured backend, gets
 *     one. Rate-limited per source IP (hashed).
 *   - already registered: the caller must prove it holds the current secret by
 *     signing the request. It then reads that secret back (idempotent, safe to
 *     repeat) — never a rotation, so an unauthenticated caller who guesses an
 *     installId cannot invalidate the real client's credential.
 *
 * The quota guards NEW installs only: 409/401 attempts don't consume it, so a
 * client that is legitimately stuck (wrong secret, another NAT tenant) can
 * retry without exhausting the shared-IP budget and locking out everyone else
 * behind the same NAT.
 *
 * Body: { installId }
 * Returns: { ok, installId, secret }
 */

import type { Env } from '../types';
import { checkRateLimit, json } from '../index';
import { verifyInstallSig } from '../lib/auth';

const MAX_REGISTER_PER_IP_PER_DAY = 10;
const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { installId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const installId = typeof body.installId === 'string' ? body.installId.trim() : '';
  if (!INSTALL_ID_RE.test(installId)) {
    return json({ ok: false, error: 'missing_or_invalid_install_id' }, 400);
  }

  const secret = randomSecret();
  const now = Date.now();

  // First-claim insert: a brand-new install claims its secret here.
  // ON CONFLICT DO NOTHING keeps the first writer — a loser never overwrites
  // an existing credential.
  const inserted = await env.DB.prepare(
    `INSERT INTO install_secrets (install_id, secret, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT (install_id) DO NOTHING`,
  )
    .bind(installId, secret, now)
    .run();

  if ((inserted.meta.changes ?? 0) === 0) {
    // Proven ownership → read the secret back. Anything else is a 409 with the
    // precise reason embedded (clients use it to tell "no secret yet" from
    // "wrong/expired signature" without leaking the secret itself).
    const auth = await verifyInstallSig(request, env, installId);
    if (!auth.ok) {
      return json({ ok: false, error: 'already_registered', reason: auth.error }, 409);
    }
    return json({ ok: true, installId, secret: auth.secret });
  }

  // Rate limit by source IP, not by the caller-supplied installId — the whole
  // point is that an attacker shouldn't be able to spam-install. Checked after
  // the claim so rejected requests (409) never burn the shared-NAT budget; an
  // over-quota claim is rolled back so no state is created.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipKey = `ip:${await sha256hex(ip)}`;
  const rl = await checkRateLimit(env, ipKey, 'register', MAX_REGISTER_PER_IP_PER_DAY);
  if (!rl.allowed) {
    await env.DB.prepare(
      `DELETE FROM install_secrets WHERE install_id = ? AND secret = ?`,
    )
      .bind(installId, secret)
      .run();
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  return json({ ok: true, installId, secret });
}
