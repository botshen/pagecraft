/**
 * HMAC signature verification for install-scoped requests.
 *
 * Wire format: three headers alongside X-Install-Id
 *   X-Install-Ts   unix ms at send time (±5 min window)
 *   X-Install-Sig  hex(HMAC-SHA256(secret, installId + '\n' + ts + '\n' + METHOD + '\n' + path))
 *
 * `path` is url.pathname only — never the query string — so a signed
 * signature survives a client reordering query params. Method + path bind
 * the signature to one endpoint, so a /api/quota signature can't be replayed
 * against /api/generate.
 */

import type { Env } from '../types';

const TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

const encoder = new TextEncoder();

async function hmacHex(secretHex: string, message: string): Promise<string> {
  const secretBytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < secretBytes.length; i++) {
    secretBytes[i] = parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish hex compare — strings are equal-length hex. */
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type AuthResult =
  | { ok: true; secret: string; createdAt: number }
  | { ok: false; error: string; status: number };

/**
 * Verify the request's install signature. Call AFTER the X-Install-Id header
 * has been extracted and format-checked by the route.
 */
export async function verifyInstallSig(
  request: Request,
  env: Env,
  installId: string,
): Promise<AuthResult> {
  const tsHeader = request.headers.get('X-Install-Ts')?.trim() ?? '';
  const sigHeader = request.headers.get('X-Install-Sig')?.trim().toLowerCase() ?? '';

  if (!tsHeader || !sigHeader) {
    return { ok: false, error: 'missing_signature_headers', status: 401 };
  }
  if (!HEX_64_RE.test(sigHeader)) {
    return { ok: false, error: 'malformed_signature', status: 401 };
  }
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) {
    return { ok: false, error: 'malformed_timestamp', status: 401 };
  }
  if (Math.abs(Date.now() - ts) > TIMESTAMP_SKEW_MS) {
    return { ok: false, error: 'timestamp_out_of_window', status: 401 };
  }

  const row = await env.DB.prepare(
    `SELECT secret, created_at FROM install_secrets WHERE install_id = ?`,
  )
    .bind(installId)
    .first<{ secret: string; created_at: number }>();
  if (!row) {
    // An install with no registered secret is either pre-upgrade (client will
    // retry after calling /api/register) or fabricated — same rejection.
    return { ok: false, error: 'install_not_registered', status: 401 };
  }

  const url = new URL(request.url);
  const message = `${installId}\n${tsHeader}\n${request.method}\n${url.pathname}`;
  const expected = await hmacHex(row.secret, message);
  if (!hexEqual(expected, sigHeader)) {
    return { ok: false, error: 'invalid_signature', status: 401 };
  }

  // Touch last_used opportunistically — failure is non-fatal.
  ctx_touch(env, installId);
  // The verified secret travels with the result so callers that need it
  // (register's idempotent read-back) don't re-read the same row.
  return { ok: true, secret: row.secret, createdAt: row.created_at };
}

function ctx_touch(env: Env, installId: string) {
  // Fire-and-forget; a missed touch only affects the last_used column.
  void env.DB.prepare(
    `UPDATE install_secrets SET last_used = ? WHERE install_id = ?`,
  )
    .bind(Date.now(), installId)
    .run()
    .catch(() => {});
}
