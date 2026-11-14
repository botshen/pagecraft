/**
 * Chrome Extension Match Pattern evaluator & URL pattern builders.
 *
 * Implements https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 * so both the background CSS auto-injector and the SidePanel "Active on this site"
 * filter agree on exact pattern semantics.
 */

function escapeRegex(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegexSource(pattern: string): string {
  return pattern.split('*').map(escapeRegex).join('.*');
}

/** Test whether a concrete http(s) URL matches a single Chrome match pattern. */
export function urlMatchesPattern(url: string, rawPattern: string): boolean {
  const pattern = (rawPattern ?? '').trim();
  if (!pattern) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (pattern === '<all_urls>' || pattern === '*://*/*') {
    return true;
  }

  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!m) return false;

  const [, schemePat, hostPat, pathPat] = m;
  const actualScheme = parsed.protocol.slice(0, -1); // 'http' | 'https'
  if (schemePat !== '*' && schemePat !== actualScheme) {
    return false;
  }

  // Host matching (Chrome match patterns ignore port unless specified in pattern)
  const actualHost = parsed.hostname.toLowerCase();
  const actualHostWithPort = parsed.host.toLowerCase();
  const normHostPat = hostPat!.toLowerCase();
  const compareHost = normHostPat.includes(':') ? actualHostWithPort : actualHost;

  if (normHostPat === '*') {
    // Matches any host
  } else if (normHostPat.startsWith('*.')) {
    const baseDomain = normHostPat.slice(2);
    if (!baseDomain) return false;
    if (compareHost !== baseDomain && !compareHost.endsWith(`.${baseDomain}`)) {
      return false;
    }
  } else if (compareHost !== normHostPat) {
    return false;
  }

  // Path matching in Chrome match patterns compares against pathname + search
  const fullPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
  const pathRe = new RegExp(`^${wildcardToRegexSource(pathPat!)}$`);
  return pathRe.test(fullPath) || pathRe.test(parsed.pathname || '/');
}

export function urlMatchesAny(url: string | undefined | null, patterns: string[]): boolean {
  if (!url || !Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some((p) => urlMatchesPattern(url, p));
}

/**
 * Derive a site-wide Chrome match pattern from a tab URL.
 * Examples:
 * - https://www.zhihu.com/question/123 -> https://*.zhihu.com/*
 * - https://news.ycombinator.com/item?id=1 -> https://news.ycombinator.com/*
 * - http://localhost:3000/app -> http://localhost/*
 */
export function hostPatternFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const hostname = u.hostname.toLowerCase();
    if (!hostname) return '';
    if (hostname.startsWith('www.') && hostname.split('.').length >= 3) {
      return `${u.protocol}//*.${hostname.slice(4)}/*`;
    }
    return `${u.protocol}//${hostname}/*`;
  } catch {
    return '';
  }
}

/** Derive a path-scoped match pattern when finer granularity is desired. */
export function matchFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const dir = u.pathname.split('/').slice(0, -1).join('/');
    const path = dir && dir !== '/' ? `${dir}/*` : '/*';
    return `${u.protocol}//${u.hostname}${path}`;
  } catch {
    return '';
  }
}
