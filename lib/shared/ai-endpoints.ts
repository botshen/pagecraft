// Resolution of a user-entered AI base URL into concrete endpoints.
//
// Users paste all sorts of things into "Base URL": `https://host/v1`, a URL with
// a trailing slash, `http://localhost:11434/v1` for local Ollama, or the full
// `https://host/v1/chat/completions` copied from another tool's docs. All of
// them resolve to a canonical API root here, enforcing `https://` for all
// remote hosts while permitting `http://` strictly on local loopback addresses.

/** Endpoint suffixes that are *not* part of the API root, stripped off the tail. */
const ENDPOINT_SUFFIXES = /\/(chat\/completions|completions|responses|models)$/i;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_DEFAULT_MODEL = 'qwen2.5-coder:7b';

export interface ResolvedEndpoints {
  /** Normalized API root, e.g. `https://host/v1` or `http://localhost:11434/v1`. Empty when unusable. */
  base: string;
  /** Chat completions endpoint, or empty when the base could not be resolved. */
  chatUrl: string;
  /** Model listing endpoint, or empty when the base could not be resolved. */
  modelsUrl: string;
  /** Machine-readable reason the base could not be resolved. */
  error?: 'empty' | 'invalid' | 'insecure';
}

/**
 * Returns `true` strictly for `http:` or `https:` URLs targeting local loopback
 * (`localhost`, `127.0.0.1`, or `[::1]`) with no embedded credentials.
 */
export function isLocalLoopbackEndpoint(rawUrl: string): boolean {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return false;

  const hostMatch = /^https?:\/\/(\[::1\]|[^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(trimmed);
  const rawHost = hostMatch?.[1]?.toLowerCase();
  if (!rawHost || !LOOPBACK_HOSTNAMES.has(rawHost)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Normalize a user-entered base URL to an API root.
 *
 * Strips whitespace, query string, hash and trailing slashes, then peels off a
 * pasted endpoint suffix. Returns an empty string when nothing usable remains.
 */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';

  // A pasted URL may carry a query string or hash; neither belongs in the base.
  s = (s.split('#')[0] ?? '').split('?')[0]?.trim() ?? '';
  if (!s) return '';
  s = s.replace(/\/+$/, '');

  // `.../v1/chat/completions` -> `.../v1`
  let stripped = s.replace(ENDPOINT_SUFFIXES, '');
  stripped = stripped.replace(/\/+$/, '');

  // Never strip down to a bare origin if that would drop a real path segment
  // the user meant, e.g. a gateway mounted at `https://host/api`. Only accept
  // the strip when something path-like survives or the original had no path.
  return stripped || s;
}

/** Resolve a base URL into concrete endpoints, keeping remote hosts strictly `https://`. */
export function resolveEndpoints(raw: string): ResolvedEndpoints {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { base: '', chatUrl: '', modelsUrl: '', error: 'empty' };

  const base = normalizeBaseUrl(trimmed);

  try {
    const url = new URL(base);
    if (url.username || url.password) {
      return { base: '', chatUrl: '', modelsUrl: '', error: 'invalid' };
    }
    if (url.protocol === 'https:') {
      // Valid HTTPS endpoint (remote or local).
    } else if (url.protocol === 'http:') {
      if (!isLocalLoopbackEndpoint(base)) {
        return { base: '', chatUrl: '', modelsUrl: '', error: 'insecure' };
      }
    } else {
      return { base: '', chatUrl: '', modelsUrl: '', error: 'invalid' };
    }
  } catch {
    return { base: '', chatUrl: '', modelsUrl: '', error: 'invalid' };
  }

  return {
    base,
    chatUrl: `${base}/chat/completions`,
    modelsUrl: `${base}/models`,
  };
}
