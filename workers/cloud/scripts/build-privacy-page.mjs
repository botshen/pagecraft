/**
 * Compile PRIVACY.md → src/routes/privacy-page.generated.ts
 *
 * Renders the markdown once at build time so the worker ships a static HTML
 * string with zero runtime markdown parsing. Supports the subset of markdown
 * PRIVACY.md actually uses: #..####, lists (-, ordered), fenced code, `code`,
 * **bold**, *italic*, [text](url), tables, ---, paragraphs.
 *
 * Run: `node scripts/build-privacy-page.mjs` (wired into `predeploy`/`predev`).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../../PRIVACY.md');
const OUT = resolve(__dirname, '../src/routes/privacy-page.generated.ts');

const md = readFileSync(SRC, 'utf8');

const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 128 128" fill="none" aria-hidden="true"><defs><linearGradient id="pcg-priv" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C95533"/><stop offset="100%" stop-color="#A63C20"/></linearGradient></defs><rect width="128" height="128" rx="28.5" fill="url(#pcg-priv)"/><path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/><rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/><path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/></svg>`;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none"><defs><linearGradient id="pcg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C95533"/><stop offset="100%" stop-color="#A63C20"/></linearGradient></defs><rect width="128" height="128" rx="28.5" fill="url(#pcg)"/><path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/><rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/><path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/></svg>`;

const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)
  .replace(/'/g, '%27')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29')}`;

// ---------- escaping ----------
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- inline markdown ----------
function inline(s) {
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `@@TOK${tokens.length - 1}@@`;
  };
  s = s.replace(/<\/?(strong|em|code|b|i)>/g, (m) => stash(m));
  s = s.replace(/`([^`]+)`/g, (_, c) => stash(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    const url =
      u.startsWith('http') || u.startsWith('/') || u.startsWith('mailto:') ? esc(u) : '#';
    return stash(`<a href="${url}">${inline(t)}</a>`);
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => stash(`<strong>${inline(t)}</strong>`));
  s = s.replace(/\*([^*\n]+)\*/g, (_, t) => stash(`<em>${inline(t)}</em>`));
  s = esc(s);
  s = s.replace(/@@TOK(\d+)@@/g, (_, n) => tokens[Number(n)]);
  return s;
}

// ---------- block parser ----------
function render(md) {
  const lines = md.split('\n');
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
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      closeList();
      html.push('<hr/>');
      i++;
      continue;
    }

    if (line.startsWith('|') && lines[i + 1]?.match(/^\|[\s\-:|]+\|/)) {
      closeList();
      const header = line.split('|').slice(1, -1).map((c) => `<th>${inline(c.trim())}</th>`).join('');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(
          '<tr>' +
            lines[i].split('|').slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join('') +
            '</tr>',
        );
        i++;
      }
      html.push(`<table><thead><tr>${header}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      i++;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^>\s*/, ''))}</blockquote>`);
      i++;
      continue;
    }

    closeList();
    let para = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{|[-*]\s|\d+\.\s|```|\||>)/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      para += ' ' + lines[i];
      i++;
    }
    html.push(`<p>${inline(para)}</p>`);
  }
  closeList();
  return html.join('\n');
}

const body = render(md);

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PageCraft — Privacy Policy</title>
<meta name="description" content="PageCraft Privacy Policy: Zero background tracking, local-first storage, client-side PII redaction, and transparent BYOK / Cloud Trial boundaries.">
<link rel="canonical" href="https://pagecraft.shenxin.space/privacy">
<meta property="og:title" content="PageCraft — Privacy Policy">
<meta property="og:description" content="Zero background tracking, local-first storage, and client-side PII redaction.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://pagecraft.shenxin.space/privacy">
<meta property="og:image" content="https://pagecraft.shenxin.space/og.svg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<style>
:root {
  --bg: #faf8f5; --ink: #1c1917; --mut: #78716c; --line: #e7e2da;
  --acc: #c95533; --panel: #ffffff; --code-bg: #f1ede7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141312; --ink: #ece8e1; --mut: #a19b93; --line: #2b2825;
    --panel: #1d1b19; --code-bg: #262320;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
.brand {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-family: ui-serif, "SF Serif", Georgia, serif; font-size: 13px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--mut); margin-bottom: 32px;
}
.brand-badge {
  display: inline-flex; align-items: center; gap: 8px; border-bottom: 0 !important;
}
.brand-badge svg {
  flex-shrink: 0; filter: drop-shadow(0 2px 5px rgba(201, 85, 51, 0.22));
}
.brand strong { color: var(--acc); font-weight: 600; }
h1 { font-family: ui-serif, "SF Serif", Georgia, serif; font-size: 34px; font-weight: 600;
  letter-spacing: -0.01em; margin: 0 0 16px; line-height: 1.2; }
h2 { font-size: 20px; font-weight: 600; margin: 40px 0 12px; letter-spacing: -0.01em; }
h3 { font-size: 16px; font-weight: 600; margin: 28px 0 10px; }
h4 { font-size: 14px; font-weight: 600; margin: 20px 0 8px; }
p { margin: 0 0 14px; color: var(--ink); }
p + p { margin-top: -6px; }
ul, ol { margin: 0 0 14px 1.4em; padding: 0; }
li { margin-bottom: 4px; }
li > ul, li > ol { margin-top: 4px; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
code {
  background: var(--code-bg); padding: 2px 5px; border-radius: 4px;
  font-size: 0.88em;
}
pre {
  background: var(--code-bg); padding: 14px 16px; border-radius: 8px;
  overflow-x: auto; margin: 0 0 16px; border: 1px solid var(--line);
}
pre code { background: transparent; padding: 0; font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px; }
th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; background: var(--panel); }
a { color: var(--acc); text-decoration: none; border-bottom: 1px solid transparent; }
a:hover { border-bottom-color: var(--acc); }
hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
blockquote { border-left: 3px solid var(--acc); padding: 4px 14px; margin: 0 0 14px; color: var(--mut); }
strong { font-weight: 600; }
em { font-style: italic; }
.updated { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line);
  font-size: 13px; color: var(--mut); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <a href="/" class="brand-badge">${BRAND_ICON_SVG}<strong>PageCraft</strong></a>
    <span>· Privacy Policy ·</span>
    <a href="/">← Official Home</a>
  </div>
  ${body}
</div>
</body>
</html>
`;

const tsSource = `// Generated by scripts/build-privacy-page.mjs — do not edit.
// Rebuild: node scripts/build-privacy-page.mjs
export const PRIVACY_PAGE_HTML = ${JSON.stringify(page)};
`;

writeFileSync(OUT, tsSource);
console.log(`wrote ${OUT} (${page.length} bytes)`);
