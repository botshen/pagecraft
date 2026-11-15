#!/usr/bin/env node
/**
 * Build & verify the zero-backend static site (`site/`, hosted on Cloudflare Pages).
 *
 * 1. Compiles `PRIVACY.md` -> `site/privacy/index.html` with strict meta CSP,
 *    PageCraft terracotta (#C95533) / warm paper (#FAF8F5) styling, and zero
 *    external dependencies.
 * 2. Validates `site/index.html`, `site/playground/index.html`,
 *    `site/privacy/index.html`, `site/icon.svg`, and `site/og.svg` for structural
 *    integrity, CSP enforcement, required links, and zero broken placeholders.
 *
 * Usage:
 *   node scripts/build-site.mjs           # Write site/privacy/index.html & validate site/
 *   node scripts/build-site.mjs --check   # Verify generated files are in sync & valid (CI)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const PRIVACY_SRC = resolve(ROOT_DIR, 'PRIVACY.md');
const SITE_DIR = resolve(ROOT_DIR, 'site');
const PRIVACY_OUT = resolve(SITE_DIR, 'privacy/index.html');

const CHECK_ONLY = process.argv.includes('--check');

const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 128 128" fill="none" aria-hidden="true"><defs><linearGradient id="pcg-priv" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C95533"/><stop offset="100%" stop-color="#A63C20"/></linearGradient></defs><rect width="128" height="128" rx="28.5" fill="url(#pcg-priv)"/><path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/><rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/><path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/></svg>`;

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(raw) {
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `\u0000TOK_${tokens.length - 1}\u0000`;
  };

  function parseFormatted(segment) {
    let s = segment;
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref =
        href.startsWith('https://') ||
        href.startsWith('http://') ||
        href.startsWith('/') ||
        href.startsWith('./') ||
        href.startsWith('../') ||
        href.startsWith('mailto:')
          ? esc(href)
          : '#';
      const rel = safeHref.startsWith('http') ? ' rel="noopener noreferrer"' : '';
      return stash(`<a href="${safeHref}"${rel}>${parseFormatted(label)}</a>`);
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, bold) => stash(`<strong>${parseFormatted(bold)}</strong>`));
    s = s.replace(/\*([^*\n]+)\*/g, (_, italic) => stash(`<em>${parseFormatted(italic)}</em>`));
    return esc(s);
  }

  // Stash inline code spans first so *, [, ] inside backticks are never parsed as formatting
  const withCodeStashed = raw.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${esc(code)}</code>`));
  let out = parseFormatted(withCodeStashed);
  // Expand nested tokens from outermost to innermost until all tokens are resolved
  while (out.includes('\u0000TOK_')) {
    out = out.replace(/\u0000TOK_(\d+)\u0000/g, (_, idx) => tokens[Number(idx)]);
  }
  return out;
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let listType = null;
  let inCode = false;
  let codeBuf = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      if (inCode) {
        html.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      closeList();
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      closeList();
      html.push('<hr>');
      i += 1;
      continue;
    }

    if (line.startsWith('|') && lines[i + 1] && /^\|[\s\-:|]+\|/.test(lines[i + 1])) {
      closeList();
      const headerCells = line
        .split('|')
        .slice(1, -1)
        .map((c) => `<th>${renderInline(c.trim())}</th>`)
        .join('');
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i]
          .split('|')
          .slice(1, -1)
          .map((c) => `<td>${renderInline(c.trim())}</td>`)
          .join('');
        bodyRows.push(`<tr>${cells}</tr>`);
        i += 1;
      }
      html.push(`<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      let itemText = line.replace(/^[-*]\s+/, '').trim();
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[-*\d]/.test(lines[i + 1])) {
        i += 1;
        itemText += ' ' + lines[i].trim();
      }
      html.push(`<li>${renderInline(itemText)}</li>`);
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      let itemText = line.replace(/^\d+\.\s+/, '').trim();
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[-*\d]/.test(lines[i + 1])) {
        i += 1;
        itemText += ' ' + lines[i].trim();
      }
      html.push(`<li>${renderInline(itemText)}</li>`);
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      closeList();
      html.push(`<blockquote>${renderInline(line.replace(/^>\s*/, ''))}</blockquote>`);
      i += 1;
      continue;
    }

    closeList();
    let para = line.trim();
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|[-*]\s|\d+\.\s|```|\||>)/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      para += ' ' + lines[i].trim();
      i += 1;
    }
    html.push(`<p>${renderInline(para)}</p>`);
  }

  closeList();
  return html.join('\n');
}

function buildPrivacyHtml(markdownSource) {
  const renderedBody = renderMarkdown(markdownSource);
  return `<!DOCTYPE html>
<html lang="en" data-lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'self'; form-action 'self' mailto:">
<title>PageCraft: privacy policy for 100% client-side execution</title>
<meta name="description" content="PageCraft Privacy Policy: 100% client-side execution with zero PageCraft servers, zero accounts, zero telemetry, and local or user-owned AI compute.">
<link rel="canonical" href="https://pagecraft.shenxin.space/privacy/">
<meta property="og:title" content="PageCraft: privacy policy for 100% client-side execution">
<meta property="og:description" content="100% client-side webpage customizer and MCP bridge. Zero PageCraft servers, zero accounts, zero telemetry.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://pagecraft.shenxin.space/privacy/">
<meta property="og:image" content="https://pagecraft.shenxin.space/og.svg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="../icon.svg">
<link rel="stylesheet" href="../fonts/fonts.css">
<style>
:root {
  --bg: #FAF8F5;
  --bg-subtle: #F1ECE4;
  --panel: #FFFFFF;
  --ink: #1C1917;
  --ink-secondary: #3F3B37;
  --mut: #686562;
  --line: rgba(28, 25, 23, 0.11);
  --acc: #C95533;
  --acc-hover: #B24627;
  --acc-soft: rgba(201, 85, 51, 0.10);
  --acc-border: rgba(201, 85, 51, 0.28);
  --emerald: #15803D;
  --emerald-soft: rgba(21, 128, 61, 0.10);
  --code-bg: #F1ECE4;
  --gut: clamp(24px, 5vw, 80px);
  --display: "Epilogue", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --sans: "Epilogue", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1C1917;
    --bg-subtle: #292624;
    --panel: #23201E;
    --ink: #FAF8F5;
    --ink-secondary: #D8D4CE;
    --mut: #9D9B98;
    --line: rgba(250, 248, 245, 0.11);
    --acc: #D96543;
    --acc-hover: #E37453;
    --acc-soft: rgba(217, 101, 67, 0.16);
    --acc-border: rgba(217, 101, 67, 0.34);
    --emerald: #4ADE80;
    --emerald-soft: rgba(74, 222, 128, 0.14);
    --code-bg: #292624;
  }
}
html[data-theme="dark"] {
  --bg: #1C1917;
  --bg-subtle: #292624;
  --panel: #23201E;
  --ink: #FAF8F5;
  --ink-secondary: #D8D4CE;
  --mut: #9D9B98;
  --line: rgba(250, 248, 245, 0.11);
  --acc: #D96543;
  --acc-hover: #E37453;
  --acc-soft: rgba(217, 101, 67, 0.16);
  --acc-border: rgba(217, 101, 67, 0.34);
  --emerald: #4ADE80;
  --emerald-soft: rgba(74, 222, 128, 0.14);
  --code-bg: #292624;
}
html[data-lang="zh"] [data-l="en"] { display: none !important; }
html[data-lang="en"] [data-l="zh"] { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 400 16px/1.65 var(--sans);
  -webkit-font-smoothing: antialiased;
}
.wrap {
  width: min(100% - 2 * var(--gut), 1280px);
  margin-inline: auto;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  height: 72px;
  display: flex;
  align-items: center;
}
.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--display);
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--ink);
  text-decoration: none;
  border: 0;
}
.brand-link:hover { border: 0; }
.brand-link svg { flex-shrink: 0; border-radius: 6px; }
.nav-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 14px;
}
.nav-right a {
  color: var(--ink-secondary);
  text-decoration: none;
  font-weight: 500;
  border: 0;
  transition: color 0.18s ease;
}
.nav-right a:hover { color: var(--acc); border: 0; }
.lang-seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 2px;
  background: var(--panel);
}
.lang-seg button, .theme-btn {
  border: 0;
  background: transparent;
  color: var(--mut);
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 500;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.16s ease, background-color 0.16s ease, color 0.16s ease;
}
.lang-seg button:hover, .theme-btn:hover {
  color: var(--ink);
  transform: translateY(-1px);
}
.lang-seg button:active, .theme-btn:active {
  transform: translateY(1px) scale(0.985);
}
.lang-seg button[aria-pressed="true"] {
  background: var(--bg-subtle);
  color: var(--ink);
}
.theme-btn {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink-secondary);
}
.page-main {
  padding-block: 48px 80px;
}
.doc-shell {
  max-width: 860px;
}
.summary-banner {
  background: var(--panel);
  border: 1px solid var(--acc-border);
  border-radius: 16px;
  padding: 18px 22px;
  margin-bottom: 28px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.summary-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--emerald);
  background: var(--emerald-soft);
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 8px;
}
.summary-text {
  margin: 0;
  font-size: 14.5px;
  color: var(--ink-secondary);
}
article.doc-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 36px 40px;
}
h1 {
  font-family: var(--display);
  font-size: clamp(30px, 4vw, 42px);
  font-weight: 400;
  letter-spacing: -0.035em;
  margin: 0 0 16px;
  line-height: 1.08;
}
h2 {
  font-family: var(--display);
  font-size: 22px;
  font-weight: 500;
  margin: 34px 0 12px;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
h3 {
  font-size: 17px;
  font-weight: 500;
  margin: 24px 0 8px;
}
h4 {
  font-size: 14.5px;
  font-weight: 500;
  margin: 18px 0 6px;
}
p {
  margin: 0 0 14px;
  color: var(--ink-secondary);
}
ul, ol {
  margin: 0 0 16px 1.35em;
  padding: 0;
  color: var(--ink-secondary);
}
li { margin-bottom: 6px; }
strong { color: var(--ink); font-weight: 500; }
code, pre { font-family: var(--mono); }
code {
  background: var(--code-bg);
  color: var(--ink);
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 0.87em;
}
pre {
  background: var(--code-bg);
  padding: 14px 16px;
  border-radius: 12px;
  overflow-x: auto;
  margin: 0 0 16px;
  border: 1px solid var(--line);
}
pre code {
  background: transparent;
  padding: 0;
  font-size: 13px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 18px;
  font-size: 14px;
}
th, td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
th {
  font-weight: 500;
  background: var(--bg-subtle);
  color: var(--ink);
}
a {
  color: var(--acc);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.18s ease, color 0.18s ease;
}
a:hover { border-bottom-color: var(--acc); }
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 28px 0;
}
blockquote {
  border-left: 2px solid var(--acc);
  padding: 4px 14px;
  margin: 0 0 14px;
  color: var(--mut);
}
.site-footer {
  border-top: 1px solid var(--line);
  padding-block: 28px 44px;
  font-size: 14px;
  color: var(--mut);
}
.site-footer__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.foot-links {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
@media (max-width: 640px) {
  .topbar { height: auto; padding-block: 12px; }
  article.doc-card { padding: 24px 20px; }
}
</style>
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a href="../" class="brand-link">
      ${BRAND_ICON_SVG}
      <span>PageCraft</span>
    </a>
    <div class="nav-right">
      <a href="../"><span data-l="zh">← 返回首页</span><span data-l="en">← Home</span></a>
      <a href="../playground/"><span data-l="zh">练习靶场</span><span data-l="en">Live Sandbox</span></a>
      <a href="https://github.com/botshen/pagecraft" rel="noopener noreferrer">GitHub</a>
      <div class="lang-seg" role="group" aria-label="Language">
        <button type="button" data-set-lang="zh" aria-pressed="false">中文</button>
        <button type="button" data-set-lang="en" aria-pressed="true">EN</button>
      </div>
      <button type="button" id="theme-toggle" class="theme-btn" aria-label="Toggle theme">◐</button>
    </div>
  </div>
</header>

<main class="wrap page-main">
  <div class="doc-shell">
    <section class="summary-banner" aria-label="Zero-Backend Privacy Summary">
      <div>
        <div class="summary-pill">
          <span data-l="zh">✓ 100% 纯客户端运行 · 零服务端 · 零账号 · 零遥测上报</span>
          <span data-l="en">✓ 100% Client-Side · Zero PageCraft Servers · Zero Telemetry</span>
        </div>
        <p class="summary-text">
          <span data-l="zh">以下隐私政策由仓库根目录 <code>PRIVACY.md</code> 自动静态编译生成。PageCraft 不设任何官方后端数据库、无需登录账号，所有网页改造规则与自定义配置均保存在你的本地浏览器中。</span>
          <span data-l="en">Generated statically from <code>PRIVACY.md</code> in the open-source repository. PageCraft operates zero backend databases, requires zero accounts, and stores all mods locally in your browser.</span>
        </p>
      </div>
    </section>

    <article class="doc-card">
${renderedBody}
    </article>
  </div>
</main>

<footer class="site-footer">
  <div class="wrap site-footer__inner">
    <span>PageCraft · MIT Open Source</span>
    <div class="foot-links">
      <a href="../"><span data-l="zh">官网首页</span><span data-l="en">Home</span></a>
      <a href="../playground/"><span data-l="zh">练习靶场</span><span data-l="en">Sandbox</span></a>
      <a href="https://github.com/botshen/pagecraft/issues" rel="noopener noreferrer">GitHub Issues</a>
      <a href="mailto:botzgbj@gmail.com">Email support</a>
    </div>
  </div>
</footer>

<script>
(function () {
  var root = document.documentElement;
  function applyLang(lang, persist) {
    var next = lang === 'zh' ? 'zh' : 'en';
    root.setAttribute('data-lang', next);
    root.setAttribute('lang', next === 'zh' ? 'zh-CN' : 'en');
    var btns = document.querySelectorAll('[data-set-lang]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-set-lang') === next ? 'true' : 'false');
    }
    if (persist) {
      try { localStorage.setItem('pc_site_lang', next); } catch (e) {}
    }
  }
  try {
    var params = new URLSearchParams(window.location.search);
    var q = params.get('lang');
    if (q === 'zh' || q === 'en') {
      applyLang(q, false);
    } else {
      var saved = localStorage.getItem('pc_site_lang');
      if (saved === 'zh' || saved === 'en') applyLang(saved, false);
      else if (navigator.language && /^zh/i.test(navigator.language)) applyLang('zh', false);
    }
  } catch (e) {}

  var btns = document.querySelectorAll('[data-set-lang]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      applyLang(this.getAttribute('data-set-lang') || 'en', true);
    });
  }

  try {
    var savedTheme = localStorage.getItem('pc_site_theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      root.setAttribute('data-theme', savedTheme);
    }
  } catch (e) {}

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme');
      var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var nextTheme = (cur ? cur === 'dark' : sysDark) ? 'light' : 'dark';
      root.setAttribute('data-theme', nextTheme);
      try { localStorage.setItem('pc_site_theme', nextTheme); } catch (e) {}
    });
  }
})();
</script>
</body>
</html>
`;
}

function assertValidHtmlFile(filePath, requiredSnippets) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required static site file: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf8');
  if (!/^<!doctype html>/i.test(content)) {
    throw new Error(`${filePath}: must start with <!DOCTYPE html>`);
  }
  if (!content.includes('http-equiv="Content-Security-Policy"')) {
    throw new Error(`${filePath}: must include a strict <meta http-equiv="Content-Security-Policy"> tag`);
  }
  if (!content.includes("default-src 'none'")) {
    throw new Error(`${filePath}: CSP must enforce default-src 'none'`);
  }
  if (!content.includes('</html>')) {
    throw new Error(`${filePath}: missing closing </html> tag`);
  }
  if (/@@TOK|\u0000TOK|\{\{[A-Z0-9_]+\}\}|__PLACEHOLDER__/i.test(content)) {
    throw new Error(`${filePath}: contains unresolved template placeholder`);
  }
  const withoutScripts = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  if (/\bundefined\b|\[object Object\]/.test(withoutScripts)) {
    throw new Error(`${filePath}: contains rendered 'undefined' or '[object Object]' in HTML markup`);
  }
  // Allow local 'self' ES module scripts and local stylesheets; forbid any external CDN scripts/stylesheets
  const externalScripts = content.match(/<script[^>]+src=["']?(?:https?:)?\/\//gi);
  const externalStyles = content.match(/<link[^>]+rel=["']?stylesheet["']?[^>]+href=["']?(?:https?:)?\/\//gi) ||
                         content.match(/<link[^>]+href=["']?(?:https?:)?\/\/[^>]+rel=["']?stylesheet["']?/gi);
  if (externalScripts || externalStyles) {
    throw new Error(`${filePath}: external runtime scripts or stylesheets are forbidden`);
  }
  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      throw new Error(`${filePath}: missing expected content "${snippet}"`);
    }
  }
}

function main() {
  if (!existsSync(PRIVACY_SRC)) {
    throw new Error(`Cannot find ${PRIVACY_SRC}`);
  }

  const privacyMd = readFileSync(PRIVACY_SRC, 'utf8');
  const expectedPrivacyHtml = buildPrivacyHtml(privacyMd);

  if (CHECK_ONLY) {
    if (!existsSync(PRIVACY_OUT)) {
      console.error(`ERROR: ${PRIVACY_OUT} does not exist. Run: node scripts/build-site.mjs`);
      process.exit(1);
    }
    const actualPrivacyHtml = readFileSync(PRIVACY_OUT, 'utf8');
    if (actualPrivacyHtml !== expectedPrivacyHtml) {
      console.error(
        `ERROR: site/privacy/index.html is out of sync with PRIVACY.md. Run: node scripts/build-site.mjs`,
      );
      process.exit(1);
    }
  } else {
    mkdirSync(dirname(PRIVACY_OUT), { recursive: true });
    writeFileSync(PRIVACY_OUT, expectedPrivacyHtml, 'utf8');
    console.log(`Generated ${PRIVACY_OUT} (${expectedPrivacyHtml.length} bytes)`);
  }

  // Validate all static site pages & assets
  assertValidHtmlFile(resolve(SITE_DIR, 'index.html'), [
    '#C95533',
    '#FAF8F5',
    'https://github.com/botshen/pagecraft',
    './playground/',
    './privacy/',
    'mailto:botzgbj@gmail.com',
    'pagecraft-mcp',
    'Gemini Nano',
    'Ollama',
    'chrome.userScripts',
  ]);

  assertValidHtmlFile(resolve(SITE_DIR, 'playground/index.html'), [
    '#pc-demo-banner',
    '#pc-demo-article',
    '#pc-demo-sidebar',
    '#pc-demo-table',
    'PC1:',
    'mailto:botzgbj@gmail.com',
    'https://github.com/botshen/pagecraft',
  ]);

  assertValidHtmlFile(PRIVACY_OUT, [
    '100% client-side',
    'ZERO PageCraft servers',
    'pagecraft-mcp',
    'mailto:botzgbj@gmail.com',
    'https://github.com/botshen/pagecraft/issues',
  ]);

  for (const asset of ['icon.svg', 'og.svg', '.nojekyll', 'robots.txt', 'sitemap.xml']) {
    const assetPath = resolve(SITE_DIR, asset);
    if (!existsSync(assetPath)) {
      throw new Error(`Missing required site asset: ${assetPath}`);
    }
  }

  console.log(`Static site verification passed (${CHECK_ONLY ? 'check mode' : 'build mode'}).`);
}

main();
