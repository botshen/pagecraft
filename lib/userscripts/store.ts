/**
 * Persistence and Tampermonkey/ScriptCat `.user.js` interop for PageCraft mods.
 *
 * Supports both `engine: 'css'` (instant CSS injection, zero browser toggles)
 * and `engine: 'js'` (MV3 `chrome.userScripts`), and exports either one as a
 * standard `.user.js` file that runs natively in Tampermonkey or ScriptCat.
 */

import {
  LEGACY_USERSCRIPTS_STORAGE_KEY,
  MODS_STORAGE_KEY,
  type ModEngine,
  type UserScript,
  type UserScriptRunAt,
} from './types';
import { hostPatternFromUrl, matchFromUrl } from './matcher';

export { hostPatternFromUrl, matchFromUrl };

let modsLockChain: Promise<void> = Promise.resolve();

export function withModsLock<T>(fn: () => Promise<T>): Promise<T> {
  const runInQueue = (): Promise<T> => {
    const next = modsLockChain.then(fn, fn);
    modsLockChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('pagecraft:mods', () => runInQueue()) as Promise<T>;
  }
  return runInQueue();
}

export function normalizeMod(raw: Record<string, unknown>): UserScript | null {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : '';
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
  if (!id || !name) return null;

  const css = typeof raw.css === 'string' ? raw.css : undefined;
  const code = typeof raw.code === 'string' ? raw.code : '';
  const engine: ModEngine =
    raw.engine === 'css' || (css && !code.trim()) ? 'css' : 'js';

  const matches = Array.isArray(raw.matches)
    ? raw.matches.map((m) => String(m).trim()).filter(Boolean)
    : [];

  const runAtRaw = typeof raw.runAt === 'string' ? raw.runAt : '';
  const runAt: UserScriptRunAt =
    runAtRaw === 'document_start' || runAtRaw === 'document_end' || runAtRaw === 'document_idle'
      ? runAtRaw
      : engine === 'css'
        ? 'document_start'
        : 'document_idle';

  const source =
    raw.source === 'ai' ||
    raw.source === 'template' ||
    raw.source === 'manual' ||
    raw.source === 'community'
      ? raw.source
      : 'manual';

  const packId =
    typeof raw.packId === 'string' && raw.packId.trim() ? raw.packId.trim() : undefined;
  const packName =
    typeof raw.packName === 'string' && raw.packName.trim() ? raw.packName.trim() : undefined;

  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    engine,
    matches,
    code,
    css: engine === 'css' ? css ?? '' : css,
    targetSelectors: Array.isArray(raw.targetSelectors)
      ? raw.targetSelectors.map((s) => String(s).trim()).filter(Boolean)
      : undefined,
    enabled: Boolean(raw.enabled),
    source,
    templateId: typeof raw.templateId === 'string' ? raw.templateId : undefined,
    ...(packId ? { packId } : {}),
    ...(packName ? { packName } : {}),
    runAt,
    allowAllUrls: Boolean(raw.allowAllUrls),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function hasChromeLocal(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function readUserScripts(): Promise<UserScript[]> {
  try {
    let rawList: unknown[] = [];
    if (hasChromeLocal()) {
      const res = await chrome.storage.local.get([
        MODS_STORAGE_KEY,
        LEGACY_USERSCRIPTS_STORAGE_KEY,
      ]);
      rawList = Array.isArray(res?.[MODS_STORAGE_KEY])
        ? res[MODS_STORAGE_KEY]
        : Array.isArray(res?.[LEGACY_USERSCRIPTS_STORAGE_KEY])
          ? res[LEGACY_USERSCRIPTS_STORAGE_KEY]
          : [];
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(MODS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      rawList = Array.isArray(parsed) ? parsed : [];
    }
    const normalized: UserScript[] = [];
    for (const item of rawList) {
      if (item && typeof item === 'object') {
        const mod = normalizeMod(item as Record<string, unknown>);
        if (mod) normalized.push(mod);
      }
    }
    return normalized;
  } catch {
    return [];
  }
}

export async function writeUserScripts(scripts: UserScript[]): Promise<void> {
  if (hasChromeLocal()) {
    await chrome.storage.local.set({ [MODS_STORAGE_KEY]: scripts });
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MODS_STORAGE_KEY, JSON.stringify(scripts));
  }
}

function sanitizeUserScriptBatch(scripts: UserScript[]): UserScript[] {
  if (!Array.isArray(scripts)) return [];
  const byId = new Map<string, number>();
  const valid: UserScript[] = [];

  for (const item of scripts) {
    if (!item || typeof item !== 'object') continue;
    const mod = normalizeMod(item as unknown as Record<string, unknown>);
    if (!mod) continue;
    const normalizedMatches = mod.matches
      .map((m) => normalizeTampermonkeyPattern(m) ?? m.trim())
      .filter(Boolean);
    if (validateMatches(normalizedMatches, Boolean(mod.allowAllUrls)) !== null) continue;
    if ((mod.css?.length ?? 0) > 500_000 || mod.code.length > 500_000) continue;

    const clean: UserScript = {
      ...mod,
      matches: normalizedMatches,
    };
    const prevIdx = byId.get(clean.id);
    if (prevIdx !== undefined) {
      valid[prevIdx] = clean;
    } else {
      byId.set(clean.id, valid.length);
      valid.push(clean);
    }
  }
  return valid;
}

export async function upsertUserScript(script: UserScript): Promise<UserScript[]> {
  return withModsLock(async () => {
    const list = await readUserScripts();
    const idx = list.findIndex((s) => s.id === script.id);
    if (idx >= 0) list[idx] = script;
    else list.push(script);
    await writeUserScripts(list);
    return list;
  });
}

export async function deleteUserScript(id: string): Promise<UserScript[]> {
  return withModsLock(async () => {
    const list = (await readUserScripts()).filter((s) => s.id !== id);
    await writeUserScripts(list);
    return list;
  });
}

export async function replaceAllUserScripts(scripts: UserScript[]): Promise<UserScript[]> {
  return withModsLock(async () => {
    const next = sanitizeUserScriptBatch(scripts);
    await writeUserScripts(next);
    return next;
  });
}

export async function mergeImportedUserScripts(scripts: UserScript[]): Promise<UserScript[]> {
  return withModsLock(async () => {
    const current = await readUserScripts();
    const incoming = sanitizeUserScriptBatch(scripts);
    if (incoming.length === 0) return current;

    const byId = new Map<string, number>();
    const merged = [...current];
    merged.forEach((s, idx) => byId.set(s.id, idx));

    for (const mod of incoming) {
      const existingIdx = byId.get(mod.id);
      if (existingIdx !== undefined) {
        merged[existingIdx] = mod;
      } else {
        byId.set(mod.id, merged.length);
        merged.push(mod);
      }
    }
    await writeUserScripts(merged);
    return merged;
  });
}

// ─── Match-pattern validation ─────────────────────────────────────────────

const BROAD_PATTERNS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);

export function isBroadMatch(pattern: string): boolean {
  const p = pattern.trim();
  if (BROAD_PATTERNS.has(p)) return true;
  return /^https?:\/\/\*\/\*/.test(p) || p === '*://*/';
}

export function validateMatches(matches: string[], allowAllUrls: boolean): string | null {
  const cleaned = matches.map((m) => m.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'At least one @match pattern is required.';
  for (const m of cleaned) {
    if (isBroadMatch(m) && !allowAllUrls) {
      return `Match "${m}" would run on every site — enable "run on all sites" to allow it.`;
    }
    if (!/^(https?|\*):\/\/[^/]+\//.test(m) && m !== '<all_urls>') {
      return `"${m}" is not a valid match pattern (expected e.g. https://*.example.com/*).`;
    }
  }
  return null;
}

// ─── ==UserScript== header parse / emit ───────────────────────────────────

const HEADER_RE = /^[\t ]*\/\/[\t ]*==UserScript==[\t ]*$/;
const HEADER_END_RE = /^[\t ]*\/\/[\t ]*==\/UserScript==[\t ]*$/;
const META_RE = /^[\t ]*\/\/[\t ]*@([a-zA-Z0-9:_-]+)[\t ]+(.*)$/;

const RUN_ATS: UserScriptRunAt[] = ['document_start', 'document_end', 'document_idle'];

export type UserScriptImportWarning = 'remote_require' | 'cross_origin_xhr';

export interface ParsedUserScriptMeta {
  name?: string;
  description?: string;
  matches: string[];
  runAt?: UserScriptRunAt;
  grants: string[];
  requires: string[];
  /** Non-empty when the script is purely static CSS (PageCraft CSS export or single static GM_addStyle). */
  extractedCss?: string;
  warnings: UserScriptImportWarning[];
  body: string;
}

/**
 * Normalize common Tampermonkey `@match` / `@include` patterns into valid Chrome
 * match patterns. Regex `@include /^.../` rules are skipped safely (`null`).
 */
export function normalizeTampermonkeyPattern(raw: string): string | null {
  const p = raw.trim();
  if (!p) return null;
  if (p.startsWith('/') && p.endsWith('/') && p.length > 2) return null;
  if (p === '*' || p === 'http*://*' || p === 'http*://*/*') return '<all_urls>';

  let normalized = p.replace(/^http\*:\/\//i, '*://');
  // Bare origin without path slash, e.g. "https://example.com" -> "https://example.com/*"
  if (/^(?:https?|\*):\/\/[^/]+$/i.test(normalized)) {
    normalized = `${normalized}/*`;
  }
  if (normalized === '<all_urls>' || /^(?:https?|\*):\/\/[^/]+\//.test(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * Detect when a `.user.js` body is purely a static CSS injection (either PageCraft's
 * own exported CSS wrapper or a standalone `GM_addStyle("...")` / ``GM_addStyle(`...`)``)
 * so it can run via the instant 0.1s CSS engine without requiring JS permissions.
 */
export function extractPureStaticCss(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  // 1. PageCraft's own exported CSS wrapper (`exportAsUserScript`)
  const pcMatch = trimmed.match(
    /^\(\(\)\s*=>\s*\{\s*const ID = "pagecraft-style-[^"]+";[\s\S]*?style\.textContent = ("(?:\\.|[^"\\])*");\s*\(document\.head \|\| document\.documentElement\)\.appendChild\(style\);\s*\}\)\(\);?$/,
  );
  if (pcMatch?.[1]) {
    try {
      const parsed: unknown = JSON.parse(pcMatch[1]);
      if (typeof parsed === 'string' && parsed.trim()) return parsed;
    } catch {
      /* ignore */
    }
  }

  // 2. Single static GM_addStyle(`...`) or GM_addStyle("...") ( optionally inside an IIFE )
  const unwrapped = trimmed
    .replace(/^(?:\(\s*function\s*\(\)\s*\{|\(\(\)\s*=>\s*\{)\s*(?:['"]use strict['"];?\s*)?/, '')
    .replace(/\s*\}\s*\)\s*\(\s*\)\s*;?$/, '')
    .replace(/^(?:['"]use strict['"];?\s*)/, '')
    .trim();

  const tplMatch = unwrapped.match(/^(?:GM_addStyle|GM\.addStyle)\(\s*`([\s\S]*)`\s*\)\s*;?$/);
  if (tplMatch && tplMatch[1] !== undefined && !tplMatch[1].includes('${') && !tplMatch[1].includes('`')) {
    const css = tplMatch[1].trim();
    if (css) return css;
  }

  const jsonMatch = unwrapped.match(/^(?:GM_addStyle|GM\.addStyle)\(\s*("(?:\\.|[^"\\])*")\s*\)\s*;?$/);
  if (jsonMatch?.[1]) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[1]);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

/** Parse a pasted or uploaded Tampermonkey / ScriptCat `.user.js` script into metadata + body. */
export function parseUserScriptHeader(
  source: string,
  preferLang: 'zh' | 'en' = 'zh',
): ParsedUserScriptMeta {
  const normalizedSrc = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalizedSrc.split('\n');
  const meta: ParsedUserScriptMeta = {
    matches: [],
    grants: [],
    requires: [],
    warnings: [],
    body: normalizedSrc.trim(),
  };

  const startIdx = lines.findIndex((l) => HEADER_RE.test(l));
  if (startIdx === -1 || startIdx > 40) {
    meta.extractedCss = extractPureStaticCss(meta.body);
    return meta;
  }

  let end = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (HEADER_END_RE.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    meta.extractedCss = extractPureStaticCss(meta.body);
    return meta;
  }

  let nameDefault: string | undefined;
  let nameZh: string | undefined;
  let nameEn: string | undefined;
  let descDefault: string | undefined;
  let descZh: string | undefined;
  let descEn: string | undefined;
  const seenMatches = new Set<string>();

  for (let i = startIdx + 1; i < end; i++) {
    const m = META_RE.exec(lines[i] ?? '');
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (!value) continue;

    if (key === 'name') {
      if (!nameDefault) nameDefault = value;
    } else if (key === 'name:zh-cn' || key === 'name:zh') {
      if (!nameZh) nameZh = value;
    } else if (key === 'name:en') {
      if (!nameEn) nameEn = value;
    } else if (key === 'description') {
      if (!descDefault) descDefault = value;
    } else if (key === 'description:zh-cn' || key === 'description:zh') {
      if (!descZh) descZh = value;
    } else if (key === 'description:en') {
      if (!descEn) descEn = value;
    } else if (key === 'match' || key === 'include') {
      const pattern = normalizeTampermonkeyPattern(value);
      if (pattern && !seenMatches.has(pattern)) {
        seenMatches.add(pattern);
        meta.matches.push(pattern);
      }
    } else if (key === 'run-at') {
      const normalized = value.toLowerCase().replace(/-/g, '_');
      if ((RUN_ATS as string[]).includes(normalized)) {
        meta.runAt = normalized as UserScriptRunAt;
      } else if (normalized === 'document_body') {
        meta.runAt = 'document_end';
      } else if (normalized === 'context_menu') {
        meta.runAt = 'document_idle';
      }
    } else if (key === 'grant') {
      if (value !== 'none' && !meta.grants.includes(value)) {
        meta.grants.push(value);
      }
    } else if (key === 'require') {
      meta.requires.push(value);
    }
  }

  meta.name =
    preferLang === 'zh'
      ? nameZh || nameDefault || nameEn
      : nameEn || nameDefault || nameZh;
  meta.description =
    preferLang === 'zh'
      ? descZh || descDefault || descEn
      : descEn || descDefault || descZh;

  meta.body = lines.slice(end + 1).join('\n').trim();

  if (meta.requires.length > 0) {
    meta.warnings.push('remote_require');
  }
  if (
    meta.grants.some((g) => /^GM[._]xmlhttpRequest$/i.test(g)) ||
    /\bGM[._]xml[hH]ttpRequest\b/.test(meta.body)
  ) {
    meta.warnings.push('cross_origin_xhr');
  }

  if (meta.warnings.length === 0) {
    meta.extractedCss = extractPureStaticCss(meta.body);
  }

  return meta;
}

/** Emit a ==UserScript== header block. */
export function emitUserScriptHeader(script: UserScript): string {
  const runAt = script.engine === 'css' ? 'document-start' : (script.runAt ?? 'document_idle').replace(/_/g, '-');
  const lines = [
    '// ==UserScript==',
    `// @name        ${script.name}`,
    '// @namespace   https://pagecraft.shenxin.space/',
    '// @version     1.0.0',
    `// @description ${script.description || script.name}`,
    '// @homepageURL https://pagecraft.shenxin.space',
    '// @supportURL  https://github.com/botshen/pagecraft/issues',
    ...script.matches.map((m) => `// @match       ${m}`),
    `// @run-at      ${runAt}`,
    '// @grant       none',
    '// ==/UserScript==',
    '',
  ];
  return lines.join('\n');
}

/**
 * Export ANY PageCraft mod (either `js` or `css` engine) as a complete,
 * standalone `.user.js` file ready to paste into Tampermonkey or ScriptCat.
 */
export function exportAsUserScript(script: UserScript): string {
  const header = emitUserScriptHeader(script);
  if (script.engine === 'css') {
    const styleId = `pagecraft-style-${script.id.slice(0, 8)}`;
    const cssLiteral = JSON.stringify(script.css ?? '');
    const wrapper = `(() => {
  const ID = ${JSON.stringify(styleId)};
  if (document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = ${cssLiteral};
  (document.head || document.documentElement).appendChild(style);
})();`;
    return `${header}${wrapper}\n`;
  }
  return `${header}${script.code}\n`;
}
