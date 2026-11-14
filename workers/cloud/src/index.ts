/**
 * PageCraft — Cloud Trial Proxy Worker (Zero Behavioral Telemetry).
 *
 * Endpoints:
 *   GET  /              — official bilingual PageCraft landing page
 *   GET  /playground    — 20-second interactive hands-on practice webpage
 *   GET  /privacy       — public privacy policy page
 *   GET  /icon.svg      — vector PageCraft brand icon
 *   GET  /og.svg        — 1200x630 editorial OpenGraph social card
 *   GET  /robots.txt    — search crawler policy + sitemap pointer
 *   GET  /sitemap.xml   — canonical XML sitemap
 *   POST /api/register  — issue per-install HMAC signing secret
 *   GET  /api/quota     — read remaining free cloud AI generations (max 10)
 *   POST /api/generate  — proxy bounded prompt to PRIMARY_LLM_* within trial quota
 *   POST /api/feedback  — anonymous 👍/👎 on a generated mod (daily aggregates only)
 *   GET  /api/health    — liveness check
 *   *    /admin*        — operator console & online LLM configuration (ADMIN_TOKEN gated)
 */

import type { Env } from './types';
import { handleRegister } from './routes/register';
import { handleGenerate, handleQuota } from './routes/generate';
import { handlePrivacy } from './routes/privacy';
import { handleFeedback } from './routes/feedback';
import { handleAdmin } from './routes/admin';
import { handleLanding } from './routes/landing';
import { handlePlayground } from './routes/playground';
import { ICON_SVG, OG_SVG } from './lib/brand';

const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: https://pagecraft.shenxin.space/sitemap.xml
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://pagecraft.shenxin.space/</loc>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="https://pagecraft.shenxin.space/"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://pagecraft.shenxin.space/?lang=en"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://pagecraft.shenxin.space/"/>
    <lastmod>2026-11-14</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://pagecraft.shenxin.space/?lang=en</loc>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="https://pagecraft.shenxin.space/"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://pagecraft.shenxin.space/?lang=en"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://pagecraft.shenxin.space/"/>
    <lastmod>2026-11-14</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://pagecraft.shenxin.space/playground</loc>
    <lastmod>2026-11-14</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://pagecraft.shenxin.space/privacy</loc>
    <lastmod>2026-11-14</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>
`;

function respondGetOrHead(method: string, res: Response): Response {
  return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/admin' || path.startsWith('/admin/')) {
      return await handleAdmin(request, url, env);
    }

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const isGetOrHead = method === 'GET' || method === 'HEAD';

    try {
      if ((path === '/' || path === '/index.html') && isGetOrHead) {
        return respondGetOrHead(method, handleLanding(request));
      }
      if ((path === '/playground' || path === '/playground/') && isGetOrHead) {
        return respondGetOrHead(method, handlePlayground(request));
      }
      if ((path === '/privacy' || path === '/privacy/') && isGetOrHead) {
        return respondGetOrHead(method, handlePrivacy());
      }
      if (path === '/icon.svg' && isGetOrHead) {
        return respondGetOrHead(
          method,
          new Response(ICON_SVG, {
            status: 200,
            headers: {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'public, max-age=86400',
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
            },
          }),
        );
      }
      if (path === '/og.svg' && isGetOrHead) {
        return respondGetOrHead(
          method,
          new Response(OG_SVG, {
            status: 200,
            headers: {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'public, max-age=86400',
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
            },
          }),
        );
      }
      if (path === '/robots.txt' && isGetOrHead) {
        return respondGetOrHead(
          method,
          new Response(ROBOTS_TXT, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
            },
          }),
        );
      }
      if (path === '/sitemap.xml' && isGetOrHead) {
        return respondGetOrHead(
          method,
          new Response(SITEMAP_XML, {
            status: 200,
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
            },
          }),
        );
      }
      if (path === '/api/health') {
        return json({ ok: true, service: 'pagecraft-cloud', ts: Date.now() });
      }
      if (path === '/api/register' && method === 'POST') {
        return await handleRegister(request, env);
      }
      if (path === '/api/quota' && method === 'GET') {
        return await handleQuota(request, env);
      }
      if (path === '/api/generate' && method === 'POST') {
        return await handleGenerate(request, env);
      }
      if (path === '/api/feedback' && method === 'POST') {
        return await handleFeedback(request, env);
      }

      return json({ ok: false, error: 'not_found' }, 404);
    } catch (e) {
      console.error('unhandled', e);
      return json({ ok: false, error: 'internal' }, 500);
    }
  },
};

export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Install-Id, X-Install-Ts, X-Install-Sig',
    'Access-Control-Max-Age': '86400',
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/** Rate-limit check + increment against D1 (`rate_limits` table). */
export async function checkRateLimit(
  env: Env,
  installId: string,
  action: string,
  limit: number,
): Promise<{ allowed: boolean; count: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (install_id, action, date, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (install_id, action, date) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(installId, action, today)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, count };
}
