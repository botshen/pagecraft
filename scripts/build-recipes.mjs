#!/usr/bin/env node
/**
 * Compiles `recipes/packs/*.json` into:
 *  1. `lib/userscripts/community-catalog.generated.ts` (offline SidePanel catalog)
 *  2. `site/recipes/catalog.json` (static GitOps public API)
 *  3. `site/recipes/index.html` (bilingual Community Recipe Hub webpage)
 *
 * Also enforces strict MV3 safety & syntax gates (fails on any `warn` or `block`
 * finding so unsafe or broad-permission scripts never reach official packs).
 *
 * Pass `--check` in CI to assert checked-in outputs match `recipes/packs/*.json`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = resolve(ROOT, 'recipes/packs');
const TS_OUT = resolve(ROOT, 'lib/userscripts/community-catalog.generated.ts');
const JSON_OUT = resolve(ROOT, 'site/recipes/catalog.json');
const HTML_OUT = resolve(ROOT, 'site/recipes/index.html');

const PINNED_ORDER = [
  'bilibili-zen',
  'zhihu-pure-reader',
  'xiaohongshu-clean-desk',
  'github-power-dev',
  'youtube-deep-focus',
  'hn-arxiv-research',
  'docs-calm-reader',
  'table-data-ops',
];

const VALID_CATEGORIES = new Set(['video', 'reading', 'dev', 'productivity']);
const VALID_RUN_ATS = new Set(['document_start', 'document_end', 'document_idle']);
const BROAD_PATTERNS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);

function isBroadMatch(pattern) {
  const p = String(pattern || '').trim();
  if (BROAD_PATTERNS.has(p)) return true;
  return /^https?:\/\/\*\/\*/.test(p) || p === '*://*/';
}

function checkBalancedCssSyntax(css) {
  const raw = String(css || '').trim();
  if (!raw) return false;
  const attrRe = /\[[^\]\n]*?["']([^"'\n]*)["'][^\]\n]*?\]/g;
  let m;
  while ((m = attrRe.exec(raw)) !== null) {
    if (/[a-z0-9]-\s+[a-z0-9]/i.test(m[1] || '')) return false;
  }
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .trim();
  if (!stripped) return false;
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ]) {
    let depth = 0;
    for (const ch of stripped) {
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth < 0) return false;
      }
    }
    if (depth !== 0) return false;
  }
  return /\{[\s\S]*?:[\s\S]*?\}/.test(stripped);
}

function stripJsComments(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');
}

function auditOfficialMod(packId, langKey, mod) {
  const ctx = `${packId}.${langKey}.${mod.id}`;
  if (!Array.isArray(mod.matches) || mod.matches.length === 0) {
    throw new Error(`${ctx}: matches must be a non-empty array`);
  }
  for (const pat of mod.matches) {
    if (isBroadMatch(pat)) {
      throw new Error(`${ctx}: official packs must not use broad match pattern "${pat}"`);
    }
    if (!/^(https?|\*):\/\/[^/]+\//.test(pat)) {
      throw new Error(`${ctx}: invalid Chrome match pattern "${pat}"`);
    }
  }
  if (mod.runAt && !VALID_RUN_ATS.has(mod.runAt)) {
    throw new Error(`${ctx}: invalid runAt "${mod.runAt}"`);
  }
  const body = String(mod.body || '').trim();
  if (!body) throw new Error(`${ctx}: body must be non-empty`);

  if (mod.engine === 'css') {
    if (!checkBalancedCssSyntax(body)) {
      throw new Error(`${ctx}: CSS has unbalanced syntax or invalid attribute selector`);
    }
    if (
      /@import\s+(?:url\s*\(\s*)?['"]?(?:https?:)?\/\//i.test(body) ||
      /url\s*\(\s*['"]?(?:https?:)?\/\//i.test(body) ||
      /expression\s*\(|javascript\s*:/i.test(body)
    ) {
      throw new Error(`${ctx}: CSS contains forbidden external resource or legacy expression`);
    }
  } else if (mod.engine === 'js') {
    const clean = stripJsComments(body);
    const forbidden = [
      [/\beval\s*\(/, 'eval()'],
      [/\bnew\s+Function\s*\(/, 'new Function()'],
      [/\b(?:setTimeout|setInterval)\s*\(\s*['"`]/, 'string timer execution'],
      [/\bdocument\.write\s*\(/, 'document.write()'],
      [/createElement\s*\(\s*['"`]script['"`]\s*\)/i, 'dynamic <script> injection'],
      [/\bchrome\.cookies\b/, 'chrome.cookies'],
      [/\bfetch\s*\(/, 'fetch()'],
      [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
      [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
      [/\bnew\s+WebSocket\b/, 'WebSocket'],
      [/\bdocument\.cookie\b/, 'document.cookie'],
      [/\bGM[._]xml[hH]ttpRequest\b/, 'GM_xmlhttpRequest'],
      [/\/\/\s*@require\b/, '@require'],
    ];
    for (const [re, label] of forbidden) {
      if (re.test(clean) || (label === '@require' && re.test(body))) {
        throw new Error(`${ctx}: forbidden JS construct (${label}) in official curated pack`);
      }
    }
  } else {
    throw new Error(`${ctx}: invalid engine "${mod.engine}"`);
  }
}

function toBase64Url(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeWirePack(pack, langKey) {
  const variant = pack[langKey];
  const payload = {
    v: 1,
    id: pack.id,
    n: variant.name.trim(),
    ms: variant.mods.map((mod) => {
      const m = {
        i: mod.id,
        n: mod.name.trim(),
        e: mod.engine,
        m: mod.matches,
        b: mod.body.trim(),
      };
      if (mod.description?.trim()) m.d = mod.description.trim();
      if (mod.runAt) m.r = mod.runAt;
      if (mod.targetSelectors?.length) m.ts = mod.targetSelectors;
      return m;
    }),
    d: variant.description.trim(),
    a: pack.author,
    c: pack.category,
    tg: pack.tags,
    sh: pack.siteHints,
    u: pack.updatedAt,
  };
  return `PCP1:${toBase64Url(JSON.stringify(payload))}`;
}

function loadAndValidatePacks() {
  if (!existsSync(PACKS_DIR)) {
    throw new Error(`Missing recipes directory: ${PACKS_DIR}`);
  }
  const files = readdirSync(PACKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No pack JSON files found in ${PACKS_DIR}`);
  }

  const packs = files.map((file) => {
    const raw = readFileSync(resolve(PACKS_DIR, file), 'utf8');
    const pack = JSON.parse(raw);
    if (!pack.id || typeof pack.id !== 'string' || !/^[a-z0-9-]+$/.test(pack.id)) {
      throw new Error(`${file}: invalid pack id "${pack.id}"`);
    }
    if (`${pack.id}.json` !== file) {
      throw new Error(`${file}: filename must match pack.id "${pack.id}.json"`);
    }
    if (!VALID_CATEGORIES.has(pack.category)) {
      throw new Error(`${file}: invalid category "${pack.category}"`);
    }
    if (!Array.isArray(pack.siteHints) || pack.siteHints.length === 0) {
      throw new Error(`${file}: siteHints must be non-empty`);
    }
    for (const langKey of ['zh', 'en']) {
      const variant = pack[langKey];
      if (!variant?.name || !variant?.description || !Array.isArray(variant.mods) || variant.mods.length === 0) {
        throw new Error(`${file}.${langKey}: missing name, description, or mods`);
      }
      for (const mod of variant.mods) {
        auditOfficialMod(pack.id, langKey, mod);
      }
    }
    if (pack.zh.mods.length !== pack.en.mods.length) {
      throw new Error(`${file}: zh.mods and en.mods length mismatch`);
    }
    for (let i = 0; i < pack.zh.mods.length; i += 1) {
      const zm = pack.zh.mods[i];
      const em = pack.en.mods[i];
      if (
        zm.id !== em.id ||
        zm.engine !== em.engine ||
        JSON.stringify(zm.matches) !== JSON.stringify(em.matches)
      ) {
        throw new Error(`${file}: zh.mods[${i}] and en.mods[${i}] diverge on id/engine/matches`);
      }
    }
    return pack;
  });

  packs.sort((a, b) => {
    const ia = PINNED_ORDER.indexOf(a.id);
    const ib = PINNED_ORDER.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.id.localeCompare(b.id);
  });

  return packs;
}

function buildGeneratedTs(packs) {
  return `/* eslint-disable */
// AUTO-GENERATED BY scripts/build-recipes.mjs from recipes/packs/*.json — DO NOT EDIT MANUALLY.
// Run \`pnpm recipes:build\` after modifying any pack in \`recipes/packs/\`.

import type { LocalizedCatalogPack } from './packs';

export const COMMUNITY_CATALOG_PACKS: LocalizedCatalogPack[] = ${JSON.stringify(packs, null, 2)};
`;
}

function buildPublicCatalogJson(packs) {
  const enriched = packs.map((pack) => {
    const hasJs = pack.zh.mods.some((m) => m.engine === 'js');
    return {
      ...pack,
      safetyLevel: hasJs ? 'clean_local_js' : 'safe_css',
      shortcodeZh: encodeWirePack(pack, 'zh'),
      shortcodeEn: encodeWirePack(pack, 'en'),
    };
  });
  return `${JSON.stringify(
    {
      schema: 'pagecraft-recipe-catalog-v1',
      count: enriched.length,
      packs: enriched,
    },
    null,
    2,
  )}\n`;
}

function buildHubHtml(catalogJsonText) {
  // Escape `<` inside inline JSON so no recipe body can terminate `<script>`
  const safeEmbeddedJson = catalogJsonText.trim().replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'self'; form-action 'self' mailto:" />
<title>PageCraft 社区配方广场 — Community Recipe Hub</title>
<meta name="description" content="PageCraft 社区精选网页改造配方包：B站专注、知乎精读、GitHub 宽屏、YouTube 去 Shorts、论文精读与表格导出。零远程加载，全部源码透明可审计，一键口令或侧栏直装。" />
<link rel="icon" type="image/svg+xml" href="../icon.svg" />
<link rel="stylesheet" href="../fonts/fonts.css" />
<style>
:root {
  --bg: #FAF8F5;
  --bg-subtle: #F1ECE4;
  --surface: #FFFFFF;
  --surface-2: #F6F2EB;
  --ink: #1C1917;
  --ink-secondary: #3F3B37;
  --muted: #686562;
  --primary: #C95533;
  --primary-hover: #B24627;
  --primary-soft: rgba(201, 85, 51, 0.10);
  --primary-border: rgba(201, 85, 51, 0.30);
  --emerald: #15803D;
  --emerald-soft: rgba(21, 128, 61, 0.10);
  --emerald-border: rgba(21, 128, 61, 0.28);
  --border: rgba(28, 25, 23, 0.11);
  --border-strong: rgba(28, 25, 23, 0.20);
  --gut: clamp(20px, 5vw, 72px);
  --display: "Epilogue", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --sans: "Epilogue", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1C1917;
    --bg-subtle: #292624;
    --surface: #23201E;
    --surface-2: #292624;
    --ink: #FAF8F5;
    --ink-secondary: #D8D4CE;
    --muted: #9D9B98;
    --primary: #D96543;
    --primary-hover: #E37453;
    --primary-soft: rgba(217, 101, 67, 0.16);
    --primary-border: rgba(217, 101, 67, 0.36);
    --emerald: #4ADE80;
    --emerald-soft: rgba(74, 222, 128, 0.13);
    --emerald-border: rgba(74, 222, 128, 0.28);
    --border: rgba(250, 248, 245, 0.11);
    --border-strong: rgba(250, 248, 245, 0.22);
  }
}
:root[data-theme="dark"] {
  --bg: #1C1917;
  --bg-subtle: #292624;
  --surface: #23201E;
  --surface-2: #292624;
  --ink: #FAF8F5;
  --ink-secondary: #D8D4CE;
  --muted: #9D9B98;
  --primary: #D96543;
  --primary-hover: #E37453;
  --primary-soft: rgba(217, 101, 67, 0.16);
  --primary-border: rgba(217, 101, 67, 0.36);
  --emerald: #4ADE80;
  --emerald-soft: rgba(74, 222, 128, 0.13);
  --emerald-border: rgba(74, 222, 128, 0.28);
  --border: rgba(250, 248, 245, 0.11);
  --border-strong: rgba(250, 248, 245, 0.22);
}
*, *::before, *::after { box-sizing: border-box; }
html[data-lang="zh"] [data-l="en"] { display: none !important; }
html[data-lang="en"] [data-l="zh"] { display: none !important; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15.5px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.topbar__inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--gut);
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  color: var(--ink);
  font-weight: 700;
  font-size: 16.5px;
  letter-spacing: -0.02em;
}
.brand img { width: 28px; height: 28px; border-radius: 7px; }
.nav-links {
  display: flex;
  align-items: center;
  gap: 18px;
}
.nav-links a {
  text-decoration: none;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  transition: color 0.15s;
}
.nav-links a:hover, .nav-links a.is-active { color: var(--ink); font-weight: 600; }
.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
  font: 500 12.5px/1 var(--sans);
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}
.pill-btn:hover { background: var(--bg-subtle); color: var(--ink); }
.pill-btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #FAF8F5;
}
.pill-btn--primary:hover { background: var(--primary-hover); color: #FAF8F5; }
.lang-toggle {
  display: inline-flex;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  padding: 2px;
}
.lang-toggle button {
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: 500 12px/1 var(--sans);
  cursor: pointer;
}
.lang-toggle button.is-on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px var(--gut) 80px;
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.9fr);
  gap: 24px;
  align-items: end;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--primary);
  margin-bottom: 10px;
}
h1 {
  margin: 0 0 12px;
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1.12;
  letter-spacing: -0.03em;
}
.hero__sub {
  margin: 0;
  color: var(--muted);
  font-size: 15.5px;
  max-width: 58ch;
}
.hero__box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  font-size: 13.5px;
  color: var(--ink-secondary);
}
.hero__box strong { color: var(--ink); display: block; margin-bottom: 6px; }
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 22px;
}
.filter-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filter-pill {
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
  font: 500 13px/1 var(--sans);
  cursor: pointer;
}
.filter-pill.is-active {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--bg);
}
.search-input {
  width: min(320px, 100%);
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink);
  font: 400 13.5px/1 var(--sans);
}
.search-input:focus {
  outline: 2px solid var(--primary-border);
  border-color: var(--primary);
}
.notice-bar {
  display: none;
  margin-bottom: 20px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--emerald-border);
  background: var(--emerald-soft);
  color: var(--ink);
  font-size: 14px;
}
.notice-bar.is-visible { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pack-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.pack-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: border-color 0.18s, box-shadow 0.18s;
}
.pack-card.is-highlighted {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
.pack-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.pack-card__title {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.pack-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.safety-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--emerald-border);
  background: var(--emerald-soft);
  color: var(--emerald);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.pack-card__desc {
  margin: 0;
  font-size: 14px;
  color: var(--ink-secondary);
}
.site-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.site-chip {
  font-family: var(--mono);
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--ink-secondary);
}
.mods-list {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  overflow: hidden;
}
.mod-row {
  padding: 9px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}
.mod-row + .mod-row { border-top: 1px solid var(--border); }
.mod-row__name { font-weight: 600; color: var(--ink); }
.mod-row__desc { font-size: 12px; color: var(--muted); margin-top: 2px; }
.engine-pill {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
  text-transform: uppercase;
  flex: none;
}
details.source-drawer {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  padding: 8px 12px;
}
details.source-drawer summary {
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-secondary);
}
.code-block {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: #1C1917;
  color: #FAF8F5;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
}
.pack-card__actions {
  margin-top: auto;
  padding-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn-install {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 0;
  background: var(--primary);
  color: #FAF8F5;
  font: 600 13px/1 var(--sans);
  cursor: pointer;
  transition: background-color 0.15s;
}
.btn-install:hover { background: var(--primary-hover); }
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink-secondary);
  font: 500 12.5px/1 var(--sans);
  text-decoration: none;
  cursor: pointer;
}
.btn-secondary:hover { background: var(--bg-subtle); color: var(--ink); }
.empty-box {
  grid-column: 1 / -1;
  padding: 48px 20px;
  text-align: center;
  border: 1px dashed var(--border-strong);
  border-radius: 14px;
  color: var(--muted);
}
footer {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px var(--gut) 48px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--muted);
}
footer a { color: var(--muted); text-decoration: none; }
footer a:hover { color: var(--ink); text-decoration: underline; }
@media (max-width: 860px) {
  .hero { grid-template-columns: minmax(0, 1fr); }
  .pack-grid { grid-template-columns: minmax(0, 1fr); }
  .nav-links { display: none; }
}
</style>
<script>
(function () {
  try {
    var qs = new URLSearchParams(window.location.search).get('lang');
    var lang = qs === 'en' ? 'en' : qs === 'zh' ? 'zh' : localStorage.getItem('pc_site_lang');
    if (lang !== 'zh' && lang !== 'en') {
      lang = (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    var t = localStorage.getItem('pc_site_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
</script>
</head>
<body>
<header class="topbar">
  <div class="topbar__inner">
    <a class="brand" href="../">
      <img src="../icon.svg" alt="PageCraft" />
      <span>PageCraft</span>
    </a>
    <nav class="nav-links" aria-label="Main navigation">
      <a href="../"><span data-l="zh">首页</span><span data-l="en">Home</span></a>
      <a href="../recipes/" class="is-active"><span data-l="zh">配方广场</span><span data-l="en">Recipe Hub</span></a>
      <a href="../playground/"><span data-l="zh">交互靶场</span><span data-l="en">Playground</span></a>
      <a href="../privacy/"><span data-l="zh">隐私承诺</span><span data-l="en">Privacy</span></a>
    </nav>
    <div class="nav-actions">
      <div class="lang-toggle" role="group" aria-label="Language">
        <button type="button" id="lang-zh">中文</button>
        <button type="button" id="lang-en">EN</button>
      </div>
      <button type="button" class="pill-btn" id="theme-toggle" title="Toggle theme">◐</button>
      <a class="pill-btn" href="https://github.com/botshen/pagecraft" target="_blank" rel="noopener">★ Star</a>
      <a class="pill-btn pill-btn--primary" href="https://github.com/botshen/pagecraft/issues/new?template=community_pack.yml" target="_blank" rel="noopener">
        <span data-l="zh">+ 投稿配方</span><span data-l="en">+ Submit Pack</span>
      </a>
    </div>
  </div>
</header>

<main class="container">
  <section class="hero">
    <div>
      <div class="eyebrow">
        <span>GitOps Registry</span>
        <span>·</span>
        <span>#PCP1 Protocol</span>
        <span>·</span>
        <span>100% MV3 Safe</span>
      </div>
      <h1>
        <span data-l="zh">社区配方广场</span>
        <span data-l="en">Community Recipe Hub</span>
      </h1>
      <p class="hero__sub">
        <span data-l="zh">一组规则打通整个网站体验：纯本地 CSS 样式与静态审计通过的 DOM 脚本，源码完全透明，绝无后台静默拉取远程代码。</span>
        <span data-l="en">Multi-rule site packs with full source transparency. Pure CSS and statically audited local DOM scripts — zero remote execution, one-click review &amp; install.</span>
      </p>
    </div>
    <aside class="hero__box">
      <strong>
        <span data-l="zh">三步安装任意社区套装</span>
        <span data-l="en">Install any pack in 3 seconds</span>
      </strong>
      <div data-l="zh">1. 点击下方「在侧栏安装 &amp; 复制口令」<br />2. 若已打开 PageCraft 侧边栏，顶部将直接弹出安全审查导入条；或粘贴 <code>#PCP1:...#</code> 到「规则库 → 导入」<br />3. 勾选规则确认源码后立即永久生效</div>
      <div data-l="en">1. Click “Install in SidePanel &amp; Copy Code” below<br />2. Your open PageCraft SidePanel immediately prompts a security review banner — or paste <code>#PCP1:...#</code> into My mods → Import<br />3. Inspect source &amp; confirm to activate</div>
    </aside>
  </section>

  <div class="notice-bar" id="install-notice" role="status">
    <span id="install-notice-text"></span>
    <span style="font-family: var(--mono); font-size: 12px; opacity: 0.85;">#PCP1:...#</span>
  </div>

  <div class="controls">
    <div class="filter-pills" id="category-pills">
      <button type="button" class="filter-pill is-active" data-cat="all"><span data-l="zh">全部套装</span><span data-l="en">All Packs</span></button>
      <button type="button" class="filter-pill" data-cat="video"><span data-l="zh">视频专注</span><span data-l="en">Video Focus</span></button>
      <button type="button" class="filter-pill" data-cat="reading"><span data-l="zh">深度阅读</span><span data-l="en">Deep Reading</span></button>
      <button type="button" class="filter-pill" data-cat="dev"><span data-l="zh">开发者效率</span><span data-l="en">Developer</span></button>
      <button type="button" class="filter-pill" data-cat="productivity"><span data-l="zh">数据与办公</span><span data-l="en">Data &amp; Ops</span></button>
    </div>
    <input
      type="search"
      id="pack-search"
      class="search-input"
      placeholder="搜索站点域名或关键词 (bilibili, github, arxiv…)"
      aria-label="Search community packs"
    />
  </div>

  <div class="pack-grid" id="pack-grid"></div>
</main>

<footer>
  <div>PageCraft — MIT Open Source · 100% Client-Side &amp; Zero Telemetry</div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;">
    <a href="./catalog.json">catalog.json</a>
    <a href="../playground/"><span data-l="zh">练习靶场</span><span data-l="en">Playground</span></a>
    <a href="../privacy/"><span data-l="zh">隐私声明</span><span data-l="en">Privacy</span></a>
    <a href="https://github.com/botshen/pagecraft" target="_blank" rel="noopener">GitHub</a>
  </div>
</footer>

<script id="pc-catalog-data" type="application/json">${safeEmbeddedJson}</script>
<script>
(function () {
  var rawEl = document.getElementById('pc-catalog-data');
  var catalog = JSON.parse(rawEl ? rawEl.textContent : '{"packs":[]}');
  var packs = catalog.packs || [];
  var grid = document.getElementById('pack-grid');
  var searchEl = document.getElementById('pack-search');
  var pillsWrap = document.getElementById('category-pills');
  var noticeEl = document.getElementById('install-notice');
  var noticeText = document.getElementById('install-notice-text');

  var currentCat = 'all';
  var highlightedId = '';
  try {
    var initPack = new URLSearchParams(window.location.search).get('pack');
    if (initPack && !initPack.startsWith('PCP1:')) highlightedId = initPack.toLowerCase();
  } catch (e) {}

  function getLang() {
    return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'zh';
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPacks() {
    var lang = getLang();
    var q = (searchEl.value || '').trim().toLowerCase();
    if (searchEl) {
      searchEl.placeholder = lang === 'zh'
        ? '搜索站点域名或关键词 (bilibili, github, arxiv…)'
        : 'Search site or keyword (youtube, github, arxiv…)';
    }

    var filtered = packs.filter(function (p) {
      if (currentCat !== 'all' && p.category !== currentCat) return false;
      if (!q) return true;
      var v = p[lang];
      var hay = [p.id, v.name, v.description, p.tags.join(' '), p.siteHints.join(' ')]
        .concat(v.mods.map(function (m) { return m.name + ' ' + m.matches.join(' '); }))
        .join('\\n')
        .toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-box">' +
        (lang === 'zh' ? '没有找到匹配的社区配方包，换个关键词或投稿一个新配方吧。' : 'No matching packs found. Try another keyword or submit one!') +
        '</div>';
      return;
    }

    grid.innerHTML = filtered.map(function (pack) {
      var v = pack[lang];
      var shortcode = lang === 'zh' ? pack.shortcodeZh : pack.shortcodeEn;
      var isPureCss = pack.safetyLevel === 'safe_css';
      var safetyTxt = lang === 'zh'
        ? (isPureCss ? '✓ 纯 CSS · 零脚本权限' : '✓ 本地 DOM · 安全审计通过')
        : (isPureCss ? '✓ Pure CSS · Zero JS' : '✓ Clean Local DOM');

      var manifestObj = {
        kind: 'pagecraft-pack',
        version: 1,
        id: pack.id,
        name: v.name,
        description: v.description,
        author: pack.author,
        category: pack.category,
        tags: pack.tags,
        siteHints: pack.siteHints,
        updatedAt: pack.updatedAt,
        mods: v.mods
      };
      var downloadHref = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifestObj, null, 2) + '\\n');

      var modsHtml = v.mods.map(function (m) {
        return '<div class="mod-row">' +
          '<div><div class="mod-row__name">' + escHtml(m.name) + '</div>' +
          '<div class="mod-row__desc">' + escHtml(m.description) + '</div></div>' +
          '<span class="engine-pill">' + escHtml(m.engine) + '</span>' +
          '</div>';
      }).join('');

      var sourceBlocks = v.mods.map(function (m) {
        return '<div style="margin-top:8px;">' +
          '<div style="font:600 11.5px/1.3 var(--mono);color:var(--muted);">' +
          escHtml(m.name) + ' (' + escHtml(m.engine.toUpperCase()) + ') · ' + escHtml(m.matches.join(', ')) +
          '</div><pre class="code-block">' + escHtml(m.body) + '</pre></div>';
      }).join('');

      return '<article class="pack-card' + (highlightedId === pack.id ? ' is-highlighted' : '') + '" id="pack-' + escHtml(pack.id) + '">' +
        '<div class="pack-card__head">' +
          '<div>' +
            '<h2 class="pack-card__title">' + escHtml(v.name) + '</h2>' +
            '<div class="pack-card__meta">' +
              '<span>' + escHtml(pack.author) + '</span>' +
              '<span>·</span>' +
              '<span>' + v.mods.length + (lang === 'zh' ? ' 条规则' : ' rules') + '</span>' +
              '<span>·</span>' +
              '<span>' + escHtml(pack.updatedAt) + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="safety-badge">' + escHtml(safetyTxt) + '</span>' +
        '</div>' +
        '<p class="pack-card__desc">' + escHtml(v.description) + '</p>' +
        '<div class="site-chips">' +
          pack.siteHints.map(function (s) { return '<span class="site-chip">' + escHtml(s) + '</span>'; }).join('') +
        '</div>' +
        '<div class="mods-list">' + modsHtml + '</div>' +
        '<details class="source-drawer"><summary>' +
          (lang === 'zh' ? '审查完整源码 (' + v.mods.length + ' 项规则)' : 'Inspect Full Source (' + v.mods.length + ' rules)') +
        '</summary>' + sourceBlocks + '</details>' +
        '<div class="pack-card__actions">' +
          '<button type="button" class="btn-install" data-install="' + escHtml(pack.id) + '">' +
            (lang === 'zh' ? '在侧栏安装 & 复制口令' : 'Install in SidePanel & Copy Code') +
          '</button>' +
          '<a class="btn-secondary" href="' + downloadHref + '" download="' + escHtml(pack.id) + '.pagecraft-pack.json">' +
            (lang === 'zh' ? '下载 JSON 包' : 'Download .json') +
          '</a>' +
          '<button type="button" class="btn-secondary" data-copy-token="' + escHtml(pack.id) + '">' +
            (lang === 'zh' ? '仅复制 #PCP1# 口令' : 'Copy #PCP1#') +
          '</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function showNotice(msg) {
    noticeText.textContent = msg;
    noticeEl.classList.add('is-visible');
  }

  grid.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!(target instanceof Element)) return;
    var installBtn = target.closest('[data-install]');
    var copyBtn = target.closest('[data-copy-token]');
    var lang = getLang();

    if (installBtn) {
      var id = installBtn.getAttribute('data-install');
      var pack = packs.find(function (p) { return p.id === id; });
      if (!pack) return;
      highlightedId = id;
      var code = '#' + (lang === 'zh' ? pack.shortcodeZh : pack.shortcodeEn) + '#';
      try {
        history.replaceState(null, '', '?pack=' + encodeURIComponent(id) + '&lang=' + lang + '#pack-' + id);
      } catch (e) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).catch(function () {});
      }
      renderPacks();
      showNotice(
        lang === 'zh'
          ? '已触发侧栏识别并复制《' + pack.zh.name + '》口令！打开 Chrome 右侧 PageCraft 侧边栏即可一键审查导入，或直接在「规则库 → 导入」粘贴。'
          : 'SidePanel handoff ready & copied #' + id + ' shortcode! Check your open PageCraft SidePanel to review & import, or paste into My mods → Import.'
      );
      return;
    }

    if (copyBtn) {
      var cid = copyBtn.getAttribute('data-copy-token');
      var cpack = packs.find(function (p) { return p.id === cid; });
      if (!cpack) return;
      var ccode = '#' + (lang === 'zh' ? cpack.shortcodeZh : cpack.shortcodeEn) + '#';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ccode).then(function () {
          showNotice(
            lang === 'zh'
              ? '已复制《' + cpack.zh.name + '》的 #PCP1# 安装口令，请在 PageCraft「规则库 → 导入」中粘贴。'
              : 'Copied #PCP1# pack shortcode for "' + cpack.en.name + '". Paste in PageCraft My mods → Import.'
          );
        }).catch(function () {});
      }
    }
  });

  pillsWrap.addEventListener('click', function (ev) {
    var btn = ev.target instanceof Element ? ev.target.closest('[data-cat]') : null;
    if (!btn) return;
    currentCat = btn.getAttribute('data-cat') || 'all';
    pillsWrap.querySelectorAll('.filter-pill').forEach(function (el) {
      el.classList.toggle('is-active', el === btn);
    });
    renderPacks();
  });

  searchEl.addEventListener('input', renderPacks);

  function setLang(next) {
    document.documentElement.setAttribute('data-lang', next);
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('lang-zh').classList.toggle('is-on', next === 'zh');
    document.getElementById('lang-en').classList.toggle('is-on', next === 'en');
    try { localStorage.setItem('pc_site_lang', next); } catch (e) {}
    renderPacks();
  }

  document.getElementById('lang-zh').addEventListener('click', function () { setLang('zh'); });
  document.getElementById('lang-en').addEventListener('click', function () { setLang('en'); });
  document.getElementById('theme-toggle').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = (cur ? cur === 'dark' : sysDark) ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pc_site_theme', next); } catch (e) {}
  });

  setLang(getLang());
  if (highlightedId) {
    var targetCard = document.getElementById('pack-' + highlightedId);
    if (targetCard && targetCard.scrollIntoView) {
      setTimeout(function () { targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80);
    }
  }
})();
</script>
</body>
</html>
`;
}

function syncFile(path, expected, checkOnly) {
  if (checkOnly) {
    if (!existsSync(path)) {
      throw new Error(`Missing generated file: ${path}. Run: node scripts/build-recipes.mjs`);
    }
    const actual = readFileSync(path, 'utf8');
    if (actual !== expected) {
      throw new Error(`Out-of-sync generated file: ${path}. Run: node scripts/build-recipes.mjs`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, expected, 'utf8');
  console.log(`Generated ${path} (${expected.length} bytes)`);
}

export function buildRecipes({ checkOnly = false } = {}) {
  const packs = loadAndValidatePacks();
  const tsText = buildGeneratedTs(packs);
  const jsonText = buildPublicCatalogJson(packs);
  const htmlText = buildHubHtml(jsonText);

  syncFile(TS_OUT, tsText, checkOnly);
  syncFile(JSON_OUT, jsonText, checkOnly);
  syncFile(HTML_OUT, htmlText, checkOnly);

  return { count: packs.length };
}

const isDirectCli =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectCli) {
  const checkOnly = process.argv.includes('--check');
  const { count } = buildRecipes({ checkOnly });
  if (checkOnly) {
    console.log(`Recipes catalog check passed (${count} packs).`);
  }
}
