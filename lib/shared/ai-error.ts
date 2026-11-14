// Turning an AI gateway's failure into something a person can act on.
//
// OpenAI-compatible gateways disagree on how to report errors. A New API
// deployment answers `{"error":{"message":"无效的令牌"}}`, OpenAI answers the
// same shape, some proxies answer `{"message": "..."}`, and others return bare
// text or an HTML error page. Surfacing the raw body means the user sees a JSON
// blob and no idea what to change.

export type ApiFailureHint =
  | 'invalidKey'
  | 'forbidden'
  | 'notFound'
  | 'rateLimited'
  | 'serverError'
  | 'unreachable';

export interface ApiFailure {
  /** Best-effort human-readable message, e.g. `无效的令牌` or `HTTP 500`. */
  message: string;
  /** HTTP status, or 0 when the request never reached the gateway. */
  status: number;
  /** What the user should check, derived from the status. */
  hint: ApiFailureHint;
}

/**
 * Pull a readable message out of a non-2xx response body.
 *
 * Handles `{error:{message}}`, `{error:"..."}`, `{message}`, `{msg}`, a bare
 * JSON string, and plain text; falls back to the status line.
 */
export function extractApiErrorMessage(status: number, statusText: string, rawBody: string): string {
  const fallback = statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
  const text = (rawBody ?? '').trim();
  if (!text) return fallback;

  try {
    const json = JSON.parse(text) as unknown;

    if (typeof json === 'string' && json.trim()) return json.trim();

    if (json && typeof json === 'object') {
      const body = json as Record<string, unknown>;
      const err = body.error;

      if (typeof err === 'string' && err.trim()) return err.trim();
      if (err && typeof err === 'object') {
        const errMessage = (err as Record<string, unknown>).message;
        if (typeof errMessage === 'string' && errMessage.trim()) return errMessage.trim();
      }
      for (const key of ['message', 'msg', 'detail'] as const) {
        const value = body[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }

    return fallback;
  } catch {
    // Not JSON: an HTML error page or a plain-text body. Keep it short.
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  }
}

/** Map an HTTP status to the thing the user most likely needs to fix. */
export function hintForStatus(status: number): ApiFailureHint {
  if (status === 401) return 'invalidKey';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'serverError';
  return 'unreachable';
}

/** Describe a thrown fetch error, which has no HTTP status at all. */
export function describeFetchFailure(e: unknown): ApiFailure {
  const raw = e instanceof Error ? e.message : String(e);
  // Chrome reports CORS/DNS/offline all as the same opaque message.
  const isNetwork = /failed to fetch|networkerror|load failed|network request failed/i.test(raw);
  return {
    message: isNetwork ? 'Failed to reach the gateway' : raw,
    status: 0,
    hint: 'unreachable',
  };
}

/** Build a failure from a non-2xx response. */
export function describeHttpFailure(
  status: number,
  statusText: string,
  rawBody: string,
): ApiFailure {
  return {
    message: extractApiErrorMessage(status, statusText, rawBody),
    status,
    hint: hintForStatus(status),
  };
}

// ─── Popup ↔ background message payloads ─────────────────────────────────────
// Both carry the resolved endpoint so the UI can show which URL was actually
// requested — the fastest way to spot a wrong Base URL.

export interface ModelsResult {
  ok: boolean;
  models?: string[];
  error?: string;
  status?: number;
  hint?: ApiFailureHint;
  endpoint?: string;
}

export interface ConnectionCheckResult {
  ok: boolean;
  error?: string;
  status?: number;
  hint?: ApiFailureHint;
  endpoint?: string;
  /** Round-trip time, so a reachable-but-slow gateway is visible. */
  elapsedMs?: number;
}
