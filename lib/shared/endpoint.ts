/**
 * Canonical HTTPS / local-loopback URL origin & path normalizer.
 */

import { DEFAULT_SITE_URL } from './constants';
import { isLocalLoopbackEndpoint } from './ai-endpoints';

export function endpointBase(endpoint?: string | null): string | null {
  const raw = (endpoint ?? '').trim() || DEFAULT_SITE_URL;
  const stripped = raw
    .replace(/\/api\/[a-z0-9_-]+\/?$/i, '')
    .replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(stripped);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') {
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  }
  if (url.protocol === 'http:' && isLocalLoopbackEndpoint(stripped)) {
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  }
  return null;
}
