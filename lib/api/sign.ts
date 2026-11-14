/**
 * Client-side request signing for the PageCraft Cloud API.
 *
 * Every protected call signs (installId + '\n' + ts + '\n' + METHOD + '\n' +
 * pathname) with the install's secret via HMAC-SHA256 and ships the three
 * headers the worker verifies: X-Install-Id, X-Install-Ts, X-Install-Sig.
 *
 * `registerInstall` is the bootstrap: no secret required, returns the secret
 * the caller must persist under `settings.cloud.installSecrets[base]`.
 */

const encoder = new TextEncoder();

async function hmacHex(secretHex: string, message: string): Promise<string> {
  const bytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the signed headers for one request. `url` may be absolute or a path;
 * only its pathname is signed, matching the worker.
 */
export async function signedHeaders(
  installId: string,
  secret: string,
  method: string,
  url: string,
): Promise<Record<string, string>> {
  const path = new URL(url, 'https://placeholder.local').pathname;
  const ts = String(Date.now());
  const sig = await hmacHex(secret, `${installId}\n${ts}\n${method.toUpperCase()}\n${path}`);
  return {
    'X-Install-Id': installId,
    'X-Install-Ts': ts,
    'X-Install-Sig': sig,
  };
}

export type RegisterResult =
  | { ok: true; installId: string; secret: string }
  | { ok: false; error: string };

/**
 * POST /api/register — fetch the signing secret for an installId.
 *
 * Called lazily before the first cloud request, and again whenever a protected request comes
 * back 401 `install_not_registered` (a backend reset, a fresh endpoint, or an
 * install that predates secrets) or `invalid_signature` (a stale persisted
 * secret worth re-checking). Pass `currentSecret` whenever one is known: the
 * worker then treats the call as "confirm or re-issue", which is safe to
 * repeat. Without it, an install that already holds a secret on that backend
 * answers 409 `already_registered` instead of rotating it — that is what
 * stops an unauthenticated caller from hijacking an install id.
 */
export async function registerInstall(
  base: string,
  installId: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (input, init) =>
    fetch(input, init),
  currentSecret?: string,
): Promise<RegisterResult> {
  try {
    const url = `${base}/api/register`;
    const authHeaders = currentSecret
      ? await signedHeaders(installId, currentSecret, 'POST', url)
      : {};
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ installId }),
    });
    const data = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      installId?: string;
      secret?: string;
      error?: string;
    } | null;
    if (!resp.ok || !data?.ok || typeof data.secret !== 'string' || typeof data.installId !== 'string') {
      return { ok: false, error: data?.error ?? `http_${resp.status}` };
    }
    return { ok: true, installId: data.installId, secret: data.secret };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Why a 401 can't be fixed by re-registering.
 *
 * These are client-side faults (clock skew, malformed/missing signature
 * headers): the register call would be signed the same broken way, so
 * retrying only burns the install's register rate-limit budget. Every other
 * 401 — `install_not_registered`, `invalid_signature`, or an unrecognised
 * body (e.g. a proxy's error page) — is worth one refresh attempt.
 */
const UNRECOVERABLE_401 = new Set([
  'timestamp_out_of_window',
  'malformed_timestamp',
  'malformed_signature',
  'missing_signature_headers',
]);

/** Read (without consuming) the `error` code from a 401 response body. */
export async function authErrorCode(resp: Response): Promise<string | null> {
  try {
    const data = (await resp.clone().json()) as { error?: unknown } | null;
    return typeof data?.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

/** Whether a 401 is worth one signed re-register + retry. */
export async function shouldRefreshOn401(resp: Response): Promise<boolean> {
  const code = await authErrorCode(resp);
  return code === null || !UNRECOVERABLE_401.has(code);
}
