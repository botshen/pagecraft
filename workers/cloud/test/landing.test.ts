import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';
import type { Env } from '../src/types';
import { handleLanding, LANDING_CSP } from '../src/routes/landing';

const EXPECTED_ZH_RECIPES = [
  '沉浸宽屏护眼阅读',
  '刺眼白底转柔和深色模式',
  '网页表格一键导出 Excel / CSV',
  '解除网页复制与右键限制',
  '知乎纯净宽屏去弹窗',
  'B站首页防摸鱼（仅留搜索栏）',
  '小红书网页版清爽大屏',
  '代码块统一加「一键复制」按钮',
  '外链直达免二次确认跳转',
  '按住 Alt 悬停放大预览缩略图',
];

const EXPECTED_EN_RECIPES = [
  'Warm Widescreen Reader',
  'Smart Dark Mode Filter',
  'One-Click Table to CSV / Excel',
  'Unlock Copy, Select &amp; Right-Click',
  'Zhihu Clean Centered Reader',
  'Bilibili Search-Only Focus Feed',
  'Xiaohongshu Clean Desktop View',
  'Add Copy Button to Code Blocks',
  'Bypass External Link Interstitials',
  'Alt + Hover Thumbnail Zoom',
];

test('handleLanding defaults to zh-CN with status 200, HTML doctype, and strict CSP', async () => {
  const res = handleLanding();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(
    res.headers.get('Content-Security-Policy'),
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  );
  assert.equal(res.headers.get('Content-Security-Policy'), LANDING_CSP);

  const html = await res.text();
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.ok(html.includes('<html lang="zh-CN" data-lang="zh">'));
  assert.ok(html.includes('<title>PageCraft — AI 网页改造与油猴脚本助手</title>'));
  assert.ok(html.includes('id="lang-zh" class="lang-btn" data-set-lang="zh" aria-pressed="true"'));
  assert.ok(html.includes('id="lang-en" class="lang-btn" data-set-lang="en" aria-pressed="false"'));
});

test('handleLanding supports ?lang=en and Accept-Language negotiation', async () => {
  const enQueryRes = handleLanding(new Request('https://pagecraft.shenxin.space/?lang=en'));
  assert.equal(enQueryRes.status, 200);
  const enHtml = await enQueryRes.text();
  assert.ok(enHtml.includes('<html lang="en" data-lang="en">'));
  assert.ok(enHtml.includes('<title>PageCraft — AI Webpage Tweaker &amp; Userscript Studio</title>'));
  assert.ok(enHtml.includes('id="lang-en" class="lang-btn" data-set-lang="en" aria-pressed="true"'));

  const enHeaderRes = handleLanding(
    new Request('https://pagecraft.shenxin.space/', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    }),
  );
  const enHeaderHtml = await enHeaderRes.text();
  assert.ok(enHeaderHtml.includes('<html lang="en" data-lang="en">'));

  // Accept-Language starting with en but containing zh stays zh-CN per spec
  const mixedHeaderRes = handleLanding(
    new Request('https://pagecraft.shenxin.space/', {
      headers: { 'Accept-Language': 'en-US,zh-CN;q=0.8' },
    }),
  );
  const mixedHtml = await mixedHeaderRes.text();
  assert.ok(mixedHtml.includes('<html lang="zh-CN" data-lang="zh">'));

  // Explicit ?lang=zh overrides English Accept-Language
  const explicitZhRes = handleLanding(
    new Request('https://pagecraft.shenxin.space/?lang=zh', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    }),
  );
  const explicitZhHtml = await explicitZhRes.text();
  assert.ok(explicitZhHtml.includes('<html lang="zh-CN" data-lang="zh">'));
});

test('landing page includes branding, palette, mockup, 6 highlights, and all 10 built-in recipes', async () => {
  const html = await handleLanding(new Request('https://pagecraft.shenxin.space/')).text();

  // Brand, palette & dark mode
  assert.ok(html.includes('PageCraft'));
  assert.ok(html.includes('#faf8f5'));
  assert.ok(html.includes('#1c1917'));
  assert.ok(html.includes('#c95533'));
  assert.ok(html.includes('prefers-color-scheme: dark'));
  assert.ok(html.includes('id="theme-toggle"'));

  // Hero copy, store badges & live mockup elements
  assert.ok(html.includes('不用按 F12 翻代码，鼠标指哪改哪，一句话永久改造任何网页'));
  assert.ok(html.includes('Chrome Web Store'));
  assert.ok(html.includes('Microsoft Edge 加载项'));
  assert.ok(html.includes('即将上线'));
  assert.ok(html.includes('Coming Soon'));
  assert.ok(html.includes('已在当前页命中目标元素'));

  // 3 steps & 6 core highlights
  assert.ok(html.includes('点选网页元素'));
  assert.ok(html.includes('用大白话描述效果'));
  assert.ok(html.includes('CSS 秒生效 / JS 沙箱持久运行'));
  assert.ok(html.includes('Shadow DOM 精准点选'));
  assert.ok(html.includes('Tampermonkey'));
  assert.ok(html.includes('DeepSeek'));
  assert.ok(html.includes('零后台监控隐私承诺'));

  // All 10 exact built-in recipes (zh & en)
  for (const name of EXPECTED_ZH_RECIPES) {
    assert.ok(html.includes(name), `missing zh recipe: ${name}`);
  }
  for (const name of EXPECTED_EN_RECIPES) {
    assert.ok(html.includes(name), `missing en recipe: ${name}`);
  }
});

test('landing page links /privacy, GitHub repo, and official contact email with zero legacy domain leaks', async () => {
  for (const url of ['https://pagecraft.shenxin.space/', 'https://pagecraft.shenxin.space/?lang=en']) {
    const html = await handleLanding(new Request(url)).text();

    assert.ok(html.includes('href="/privacy"'), 'must link to /privacy');
    assert.ok(html.includes('mailto:botzgbj@gmail.com'), 'must include mailto:botzgbj@gmail.com');
    assert.ok(html.includes('botzgbj@gmail.com'), 'must display botzgbj@gmail.com');
    assert.ok(html.includes('https://github.com/botshen/plugin-radar'), 'must link to GitHub repo');

    assert.equal(/radar\.shenxin\.space/i.test(html), false, 'must not contain radar.shenxin.space');
    assert.equal(/<script[^>]+src=/i.test(html), false, 'must not load external scripts');
    assert.equal(/<link[^>]+rel="stylesheet"/i.test(html), false, 'must not load external stylesheets');
  }
});

test('landing page includes canonical, hreflang, OpenGraph/Twitter tags, brand SVG mark, and valid SoftwareApplication + FAQPage JSON-LD', async () => {
  const zhHtml = await handleLanding(new Request('https://pagecraft.shenxin.space/')).text();
  const enHtml = await handleLanding(new Request('https://pagecraft.shenxin.space/?lang=en')).text();

  // Canonical + hreflang alternates
  assert.ok(zhHtml.includes('<link rel="canonical" href="https://pagecraft.shenxin.space/">'));
  assert.ok(enHtml.includes('<link rel="canonical" href="https://pagecraft.shenxin.space/?lang=en">'));

  for (const html of [zhHtml, enHtml]) {
    assert.ok(html.includes('<link rel="alternate" hreflang="zh-CN" href="https://pagecraft.shenxin.space/">'));
    assert.ok(html.includes('<link rel="alternate" hreflang="en" href="https://pagecraft.shenxin.space/?lang=en">'));
    assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="https://pagecraft.shenxin.space/">'));
    assert.ok(html.includes('property="og:image" content="https://pagecraft.shenxin.space/og.svg"'));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    assert.ok(html.includes('#C95533'), 'must include terracotta brand SVG gradient start');
    assert.ok(html.includes('#A63C20'), 'must include terracotta brand SVG gradient end');
    assert.equal(html.includes('✦'), false, 'old placeholder ✦ character must be gone');

    // Parse & verify application/ld+json structured data
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ldMatch, 'must embed application/ld+json script');
    const parsed = JSON.parse(ldMatch![1]!) as {
      '@context': string;
      '@graph': Array<{ '@type': string; mainEntity?: unknown[] }>;
    };
    assert.equal(parsed['@context'], 'https://schema.org');
    const types = parsed['@graph'].map((n) => n['@type']);
    assert.ok(types.includes('SoftwareApplication'), 'JSON-LD must include SoftwareApplication');
    assert.ok(types.includes('FAQPage'), 'JSON-LD must include FAQPage');
    const faqNode = parsed['@graph'].find((n) => n['@type'] === 'FAQPage');
    assert.ok((faqNode?.mainEntity?.length ?? 0) >= 4, 'FAQPage must include >= 4 Q&As');
  }
});

test('/robots.txt, /sitemap.xml, /icon.svg, /og.svg, and /privacy serve valid store-compliant assets', async () => {
  const dummyEnv = {} as Env;

  // 1. /robots.txt
  const robotsRes = await worker.fetch(new Request('https://pagecraft.shenxin.space/robots.txt'), dummyEnv);
  assert.equal(robotsRes.status, 200);
  assert.match(robotsRes.headers.get('Content-Type') ?? '', /text\/plain/);
  const robotsTxt = await robotsRes.text();
  assert.ok(robotsTxt.includes('Allow: /'));
  assert.ok(robotsTxt.includes('Disallow: /admin'));
  assert.ok(robotsTxt.includes('Sitemap: https://pagecraft.shenxin.space/sitemap.xml'));

  // 2. /sitemap.xml
  const sitemapRes = await worker.fetch(new Request('https://pagecraft.shenxin.space/sitemap.xml'), dummyEnv);
  assert.equal(sitemapRes.status, 200);
  assert.match(sitemapRes.headers.get('Content-Type') ?? '', /application\/xml/);
  const sitemapXml = await sitemapRes.text();
  for (const loc of [
    '<loc>https://pagecraft.shenxin.space/</loc>',
    '<loc>https://pagecraft.shenxin.space/?lang=en</loc>',
    '<loc>https://pagecraft.shenxin.space/playground</loc>',
    '<loc>https://pagecraft.shenxin.space/privacy</loc>',
  ]) {
    assert.ok(sitemapXml.includes(loc), `sitemap missing ${loc}`);
  }

  // 3. /icon.svg & /og.svg
  const iconRes = await worker.fetch(new Request('https://pagecraft.shenxin.space/icon.svg'), dummyEnv);
  assert.equal(iconRes.status, 200);
  assert.match(iconRes.headers.get('Content-Type') ?? '', /image\/svg\+xml/);
  const iconSvg = await iconRes.text();
  assert.ok(iconSvg.includes('#C95533') && iconSvg.includes('#FAF8F5'));

  const ogRes = await worker.fetch(new Request('https://pagecraft.shenxin.space/og.svg'), dummyEnv);
  assert.equal(ogRes.status, 200);
  assert.match(ogRes.headers.get('Content-Type') ?? '', /image\/svg\+xml/);
  const ogSvg = await ogRes.text();
  assert.ok(ogSvg.includes('width="1200"') && ogSvg.includes('height="630"'));
  assert.equal(/github|repository/i.test(ogSvg), false);

  // 4. /privacy aligns 100% with outbound payload disclosure & official contact + GitHub Issues
  const privRes = await worker.fetch(new Request('https://pagecraft.shenxin.space/privacy'), dummyEnv);
  assert.equal(privRes.status, 200);
  const privHtml = await privRes.text();
  assert.ok(privHtml.includes('redacted page title'));
  assert.ok(privHtml.includes('structural page landmarks'));
  assert.ok(privHtml.includes('Bearer'));
  assert.ok(privHtml.includes('botzgbj@gmail.com'));
  assert.ok(privHtml.includes('https://github.com/botshen/plugin-radar/issues'));
  assert.ok(privHtml.includes('#C95533'), 'privacy page must render PageCraft brand SVG badge');
});
