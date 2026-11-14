/**
 * Privacy & PII scrubbing helpers for PageCraft.
 *
 * PageCraft collects ZERO background browsing history or telemetry. When the
 * user explicitly invokes AI page modification or picks an element, these
 * helpers strip emails, phone numbers, API tokens, and query strings from any
 * DOM label/text preview before sending the prompt to the AI model.
 */

/** Mask PII (emails, phone numbers, secret keys, long digits, URL queries) from text samples. */
export function redactSensitiveText(text: string, maxLen = 160): string {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(sk-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{10,}|Bearer\s+\S+)\b/g, '[KEY]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/\b\d{8,19}\b/g, '[NUM]')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1?[REDACTED]')
    .slice(0, maxLen);
}

/** Strip a raw URL to a bare scheme+host hint (never includes query/hash/tokens). */
export function urlToHostHint(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** Strip query/hash from a URL while keeping up to 2 path segments for route context. */
export function sanitizePageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const segments = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 3)
      .map((seg) => {
        if (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d{5,}$/.test(seg)) return ':id';
        return seg.slice(0, 32);
      });
    return segments.length > 0
      ? `${u.protocol}//${u.host}/${segments.join('/')}`
      : `${u.protocol}//${u.host}/`;
  } catch {
    return '';
  }
}
