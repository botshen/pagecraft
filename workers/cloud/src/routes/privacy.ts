import { PRIVACY_PAGE_HTML } from './privacy-page.generated';

const PRIVACY_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

/**
 * Public privacy policy page, served at https://pagecraft.shenxin.space/privacy.
 * Static HTML rendered at build time from PRIVACY.md — safe to cache at edge.
 */
export function handlePrivacy(): Response {
  return new Response(PRIVACY_PAGE_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'Content-Security-Policy': PRIVACY_CSP,
    },
  });
}
