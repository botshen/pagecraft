/**
 * PageCraft Dual-Engine Execution, Multimodal Vision, Closed-Loop Auto-Heal,
 * & Local Coding Agent (MCP) Handler Subsystem.
 *
 * Engine 1 (`css`): Instant `chrome.scripting.insertCSS` / `removeCSS` across
 * matching tabs + automatic injection on tab navigation. Works on fresh CWS
 * installs with ZERO developer or `Allow User Scripts` toggles!
 *
 * Engine 2 (`js`): MV3 `chrome.userScripts` execution in an isolated
 * `USER_SCRIPT` world + 1-click `.user.js` export for Tampermonkey/ScriptCat.
 */

import type {
  GeneratedUserScript,
  GenerateUserScriptPayload,
  GenerateUserScriptResult,
  MODS_STORAGE_KEY as ModsKeyType,
  ModEngine,
  PageContextResult,
  PickedElementContext,
  SelectorVerifyResult,
  UserScript,
  UserScriptsAvailability,
} from '../../lib/userscripts/types';
import { MODS_STORAGE_KEY } from '../../lib/userscripts/types';
import {
  hostPatternFromUrl,
  isBroadMatch,
  readUserScripts,
  upsertUserScript,
  validateMatches,
} from '../../lib/userscripts/store';
import { urlMatchesAny } from '../../lib/userscripts/matcher';
import { wrapWithGmShimIfNeeded } from '../../lib/userscripts/gm-shim';
import { redactSensitiveText, sanitizePageUrl } from '../../lib/shared/privacy';
import { isLocalLoopbackEndpoint, resolveEndpoints } from '../../lib/shared/ai-endpoints';
import { byokLlmChat } from '../../lib/shared/ai-client';
import { generateWithBuiltinAi } from '../../lib/shared/builtin-ai';
import { tryBuildPlaygroundMod } from '../../lib/userscripts/playground';
import type { AppSettings, AIConfig } from '../../lib/types';
import {
  extractLivePageContext,
  injectElementPickerOverlay,
  probeTargetSelectors,
} from './picker-injected';

void (null as unknown as typeof ModsKeyType);

const BUILTIN_AI_SYSTEM_PROMPT =
  'You are PageCraft, a Chrome MV3 CSS & Userscript mod generator. Return ONLY valid JSON matching the requested schema with no markdown fences.';

/** Probe: true only when `chrome.userScripts` exists and `getScripts()` resolves. */
export async function checkUserScriptsAvailability(): Promise<UserScriptsAvailability> {
  try {
    const api = chrome.userScripts;
    if (!api) return { available: false, reason: 'disabled' };
    await api.getScripts();
    return { available: true };
  } catch {
    return { available: false, reason: 'disabled' };
  }
}

function getUserScriptsApi() {
  try {
    return chrome.userScripts ?? null;
  } catch {
    return null;
  }
}

// ─── Live CSS Engine State (per-tab tracking for instant toggle ON/OFF) ───

/** tabId -> Map<modId, injectedCssText> */
const tabCssRegistry = new Map<number, Map<string, string>>();
const tabCssQueues = new Map<number, Promise<void>>();

export function resetTabCssStateForTests(): void {
  tabCssRegistry.clear();
  tabCssQueues.clear();
}

export function syncCssForTab(tabId: number, tabUrl?: string): Promise<void> {
  const prev = tabCssQueues.get(tabId) ?? Promise.resolve();
  const next = prev.then(
    () => doSyncCssForTab(tabId, tabUrl),
    () => doSyncCssForTab(tabId, tabUrl),
  );
  tabCssQueues.set(
    tabId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function doSyncCssForTab(tabId: number, tabUrl?: string): Promise<void> {
  if (!tabUrl || !/^https?:/.test(tabUrl)) return;
  const stored = await readUserScripts();
  const desiredCssMods = stored.filter(
    (m) =>
      m.enabled &&
      m.engine === 'css' &&
      Boolean(m.css?.trim()) &&
      validateMatches(m.matches, Boolean(m.allowAllUrls)) === null &&
      urlMatchesAny(tabUrl, m.matches),
  );

  let applied = tabCssRegistry.get(tabId);
  if (!applied) {
    applied = new Map<string, string>();
    tabCssRegistry.set(tabId, applied);
  }

  const desiredIds = new Set(desiredCssMods.map((m) => m.id));

  for (const [modId, prevCss] of [...applied.entries()]) {
    const targetMod = desiredCssMods.find((m) => m.id === modId);
    if (!targetMod || targetMod.css !== prevCss) {
      try {
        await chrome.scripting.removeCSS({ target: { tabId }, css: prevCss });
      } catch {
        /* tab may have navigated or closed */
      }
      applied.delete(modId);
    }
  }

  for (const mod of desiredCssMods) {
    const cssText = mod.css!;
    if (applied.get(mod.id) === cssText) continue;
    if (!desiredIds.has(mod.id)) continue;
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, css: cssText });
      applied.set(mod.id, cssText);
    } catch {
      /* restricted page — non-fatal */
    }
  }
}

export async function syncAllOpenTabsCss(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((t): t is chrome.tabs.Tab & { id: number } => typeof t.id === 'number')
        .map((t) => syncCssForTab(t.id, t.url)),
    );
  } catch {
    /* ignore */
  }
}

// ─── Serialized JS + CSS Reconciliation ───────────────────────────────────

let syncInFlight: Promise<void> | null = null;
let syncAgainQueued = false;

export function syncUserScripts(): Promise<void> {
  if (syncInFlight) {
    syncAgainQueued = true;
    return syncInFlight;
  }
  syncInFlight = doSyncAllMods()
    .catch((e) => {
      throw e instanceof Error ? e : new Error(String(e));
    })
    .finally(async () => {
      syncInFlight = null;
      if (syncAgainQueued) {
        syncAgainQueued = false;
        await syncUserScripts();
      }
    });
  return syncInFlight;
}

async function doSyncAllMods(): Promise<void> {
  await syncAllOpenTabsCss();

  const api = getUserScriptsApi();
  if (!api) return;

  try {
    await api.configureWorld({ csp: "script-src 'self'", messaging: false });
  } catch {
    /* older Chrome may not support configureWorld — non-fatal */
  }

  const stored = await readUserScripts();
  const jsMods = stored.filter((s) => s.engine === 'js');
  const registered = await api.getScripts();

  const invalidEnabled = jsMods.filter(
    (s) => s.enabled && validateMatches(s.matches, Boolean(s.allowAllUrls)) !== null,
  );
  const invalidIds = invalidEnabled.map((s) => s.id);

  const desired = new Map(
    jsMods
      .filter((s) => s.enabled && !invalidIds.includes(s.id) && Boolean(s.code.trim()))
      .map((s) => [s.id, s]),
  );
  const existing = new Map(registered.map((r) => [r.id, r]));

  const toUnregister = [
    ...new Set([
      ...registered.filter((r) => !desired.has(r.id)).map((r) => r.id),
      ...invalidIds,
    ]),
  ];
  if (toUnregister.length > 0) {
    await api.unregister({ ids: toUnregister });
  }

  const toRegister: chrome.userScripts.RegisteredUserScript[] = [];
  const toUpdate: chrome.userScripts.RegisteredUserScript[] = [];

  for (const s of desired.values()) {
    const execCode = wrapWithGmShimIfNeeded(s);
    const spec: chrome.userScripts.RegisteredUserScript = {
      id: s.id,
      matches: s.matches,
      js: [{ code: execCode }],
      runAt: (s.runAt ?? 'document_idle') as chrome.extensionTypes.RunAt,
      world: 'USER_SCRIPT',
    };
    const prev = existing.get(s.id);
    const prevCode = prev?.js?.[0] && 'code' in prev.js[0] ? prev.js[0].code : undefined;
    const unchanged =
      prev &&
      prevCode === execCode &&
      JSON.stringify(prev.matches ?? []) === JSON.stringify(s.matches) &&
      prev.runAt === spec.runAt;
    if (unchanged) continue;
    (prev ? toUpdate : toRegister).push(spec);
  }

  if (toUpdate.length > 0) await api.update(toUpdate);
  if (toRegister.length > 0) await api.register(toRegister);

  if (invalidEnabled.length > 0) {
    throw new Error(
      `Unregistered ${invalidEnabled.length} script(s) with invalid @match: ` +
        invalidEnabled.map((s) => s.name || s.id).join(', '),
    );
  }
}

export function initModsRuntime(): void {
  void syncUserScripts().catch((e) => {
    console.warn('[PageCraft] initial mod sync failed:', e);
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && MODS_STORAGE_KEY in changes) {
        void syncUserScripts().catch((e) => {
          console.warn('[PageCraft] mod sync failed:', e);
        });
      }
    });
  } catch {
    /* ignore */
  }

  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const nextUrl = changeInfo.url ?? tab.url;
      if (changeInfo.status === 'loading') {
        tabCssRegistry.delete(tabId);
        if (nextUrl) void syncCssForTab(tabId, nextUrl);
      } else if (Boolean(changeInfo.url) && nextUrl) {
        void syncCssForTab(tabId, nextUrl);
      } else if (changeInfo.status === 'complete' && nextUrl) {
        void syncCssForTab(tabId, nextUrl);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      tabCssRegistry.delete(tabId);
      tabCssQueues.delete(tabId);
    });
  } catch {
    /* ignore */
  }
}

// ─── Live Page Context, Selector Verification & Cropped Vision Capture ────

export async function getActiveTabPageContext(): Promise<PageContextResult> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      return { ok: false, error: 'no_active_tab' };
    }
    if (!/^https?:/.test(tab.url)) {
      return { ok: false, url: tab.url, error: 'unsupported_scheme' };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractLivePageContext,
      world: 'ISOLATED',
    });
    const context = results?.[0]?.result;
    return {
      ok: true,
      url: sanitizePageUrl(tab.url),
      title: tab.title ?? '',
      context: typeof context === 'string' ? context : '',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function verifySelectorsOnActiveTab(
  selectors: string[],
): Promise<SelectorVerifyResult> {
  const clean = (selectors ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (clean.length === 0) {
    return { ok: true, totalHits: 0, details: [] };
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
      return { ok: false, totalHits: 0, details: [] };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: probeTargetSelectors,
      args: [clean],
      world: 'ISOLATED',
    });
    const details = Array.isArray(results?.[0]?.result) ? results[0]!.result : [];
    const totalHits = details.reduce((sum, d) => sum + (d.count ?? 0), 0);
    return { ok: true, totalHits, details };
  } catch {
    return { ok: false, totalHits: 0, details: [] };
  }
}

export interface ScreenshotCaptureDeps {
  captureVisibleTab?: () => Promise<string>;
  createImageBitmapImpl?: (blob: Blob) => Promise<{
    width: number;
    height: number;
    close?: () => void;
  }>;
  createOffscreenCanvas?: (
    width: number,
    height: number,
  ) => {
    getContext: (type: '2d') => {
      drawImage: (
        image: unknown,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => void;
    } | null;
    convertToBlob: (options?: { type?: string; quality?: number }) => Promise<Blob>;
  };
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const header = dataUrl.slice(0, commaIdx);
  const b64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;]+);base64$/i.exec(header);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const mime = blob.type || 'image/jpeg';
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Captures the visible tab and crops around `pickedElement.rect` (with ~32px
 * context padding, scaled down so max side <= 640px) into a compact JPEG/PNG
 * `data:image/...;base64,...` URL. Gracefully returns `undefined` on any error.
 */
export async function captureElementScreenshot(
  pickedElement?: PickedElementContext | null,
  deps: ScreenshotCaptureDeps = {},
): Promise<string | undefined> {
  const rect = pickedElement?.rect;
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    return undefined;
  }

  const captureFn =
    deps.captureVisibleTab ??
    (typeof chrome !== 'undefined' && typeof chrome.tabs?.captureVisibleTab === 'function'
      ? () => chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 78 })
      : undefined);
  if (!captureFn) return undefined;

  try {
    const rawDataUrl = await captureFn();
    if (typeof rawDataUrl !== 'string' || !rawDataUrl.startsWith('data:image/')) {
      return undefined;
    }

    const createBitmap =
      deps.createImageBitmapImpl ??
      (typeof createImageBitmap === 'function'
        ? (b: Blob) => createImageBitmap(b)
        : undefined);
    const makeCanvas =
      deps.createOffscreenCanvas ??
      (typeof OffscreenCanvas !== 'undefined'
        ? (w: number, h: number) =>
            new OffscreenCanvas(w, h) as unknown as ReturnType<
              NonNullable<ScreenshotCaptureDeps['createOffscreenCanvas']>
            >
        : undefined);

    if (!createBitmap || !makeCanvas) {
      return rawDataUrl;
    }

    const srcBlob = dataUrlToBlob(rawDataUrl);
    if (!srcBlob) return rawDataUrl;

    const bitmap = await createBitmap(srcBlob);
    try {
      const dpr = typeof rect.dpr === 'number' && rect.dpr > 0 ? rect.dpr : 1;
      const padCss = 32;
      const rawX = typeof rect.x === 'number' ? rect.x : 0;
      const rawY = typeof rect.y === 'number' ? rect.y : 0;

      const sx = Math.max(0, Math.min(bitmap.width - 1, Math.round((rawX - padCss) * dpr)));
      const sy = Math.max(0, Math.min(bitmap.height - 1, Math.round((rawY - padCss) * dpr)));
      const sw = Math.max(
        1,
        Math.min(bitmap.width - sx, Math.round((rect.width + padCss * 2) * dpr)),
      );
      const sh = Math.max(
        1,
        Math.min(bitmap.height - sy, Math.round((rect.height + padCss * 2) * dpr)),
      );

      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(sw, sh));
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));

      const canvas = makeCanvas(dw, dh);
      const ctx = canvas.getContext('2d');
      if (!ctx) return rawDataUrl;

      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
      const croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
      return await blobToDataUrl(croppedBlob);
    } finally {
      bitmap.close?.();
    }
  } catch {
    return undefined;
  }
}

// ─── MV3 CSP-Safe JS & CSS Structural Validation (Zero eval / new Function) ─

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'throw',
  'delete',
  'void',
  'in',
  'of',
  'instanceof',
  'yield',
  'await',
]);

/**
 * Validates JavaScript structural syntax (balanced `{}`, `()`, `[]`, closed
 * strings, template literals, comments, and regex literals) WITHOUT calling
 * `eval` or `new Function` (which MV3 CSP `script-src 'self'` blocks).
 */
export function validateJsStructureSafely(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) {
    return 'AI 选择了 JS 脚本模式但未生成可执行代码。';
  }

  const stack: string[] = [];
  let canStartRegex = true;
  let lastWord = '';
  let i = 0;
  const n = trimmed.length;

  while (i < n) {
    const ch = trimmed[i]!;
    const next = trimmed[i + 1];

    if (/\s/.test(ch)) {
      if (lastWord) {
        if (REGEX_PRECEDING_KEYWORDS.has(lastWord)) {
          canStartRegex = true;
        }
        lastWord = '';
      }
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && trimmed[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i < n - 1) {
        if (trimmed[i] === '*' && trimmed[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return 'AI 生成的 JS 代码包含未闭合的多行注释（/* ... */）。';
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let closed = false;
      while (i < n) {
        const c = trimmed[i]!;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '\n' || c === '\r') break;
        if (c === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return 'AI 生成的 JS 代码包含未闭合的字符串引号。';
      }
      lastWord = '';
      canStartRegex = false;
      continue;
    }

    if (ch === '`') {
      i++;
      let closed = false;
      while (i < n) {
        const c = trimmed[i]!;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '`') {
          i++;
          closed = true;
          break;
        }
        if (c === '$' && trimmed[i + 1] === '{') {
          stack.push('`');
          stack.push('{');
          i += 2;
          canStartRegex = true;
          lastWord = '';
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return 'AI 生成的 JS 代码包含未闭合的模板字符串（`...`）。';
      }
      if (stack[stack.length - 1] !== '{') {
        lastWord = '';
        canStartRegex = false;
      }
      continue;
    }

    if (ch === '/' && canStartRegex) {
      i++;
      let inCharClass = false;
      let closed = false;
      while (i < n) {
        const c = trimmed[i]!;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '\n' || c === '\r') break;
        if (c === '[') inCharClass = true;
        else if (c === ']') inCharClass = false;
        else if (c === '/' && !inCharClass) {
          i++;
          while (i < n && /[a-z]/i.test(trimmed[i]!)) i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return 'AI 生成的 JS 代码包含未闭合的正则表达式字面量。';
      }
      lastWord = '';
      canStartRegex = false;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(trimmed[i]!)) i++;
      lastWord = trimmed.slice(start, i);
      canStartRegex = REGEX_PRECEDING_KEYWORDS.has(lastWord);
      continue;
    }

    if (/[0-9]/.test(ch)) {
      i++;
      while (i < n && /[0-9a-fA-FxXoObBn_.]/.test(trimmed[i]!)) i++;
      lastWord = '';
      canStartRegex = false;
      continue;
    }

    lastWord = '';

    if (ch === '{' || ch === '(' || ch === '[') {
      stack.push(ch);
      canStartRegex = true;
      i++;
      continue;
    }

    if (ch === '}' || ch === ')' || ch === ']') {
      const expected = ch === '}' ? '{' : ch === ')' ? '(' : '[';
      const top = stack.pop();
      if (top !== expected) {
        return `AI 生成的 JS 代码括号不匹配（意外的 "${ch}"）。`;
      }
      if (ch === '}' && stack[stack.length - 1] === '`') {
        stack.pop();
        i++;
        let closedTpl = false;
        while (i < n) {
          const c = trimmed[i]!;
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === '`') {
            i++;
            closedTpl = true;
            break;
          }
          if (c === '$' && trimmed[i + 1] === '{') {
            stack.push('`');
            stack.push('{');
            i += 2;
            canStartRegex = true;
            closedTpl = true;
            break;
          }
          i++;
        }
        if (!closedTpl) {
          return 'AI 生成的 JS 代码包含未闭合的模板字符串（`...`）。';
        }
        if (stack[stack.length - 1] !== '{') {
          canStartRegex = false;
        }
        continue;
      }
      canStartRegex = false;
      i++;
      continue;
    }

    canStartRegex = '=,:;!&|?+-*~^%<>'.includes(ch);
    i++;
  }

  if (stack.length > 0) {
    return 'AI 生成的 JS 代码被截断或存在未闭合的括号。';
  }
  return null;
}

export function validateCssStructureSafely(css: string): string | null {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')
    .trim();
  if (!stripped) {
    return 'AI 选择了 CSS 模式但未生成有效样式代码。';
  }
  let depth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return 'AI 生成的 CSS 样式大括号不匹配。';
    }
  }
  if (depth !== 0) {
    return 'AI 生成的 CSS 样式被截断或缺少闭合 "}"。';
  }
  return null;
}

// ─── AI Prompt & Dual-Engine Parser ───────────────────────────────────────

export interface LlmChatFn {
  (
    config: AIConfig,
    prompt: string,
    isTest?: boolean,
    imageDataUrl?: string,
  ): Promise<{ content: string; usedVision?: boolean }>;
}

export interface GenerateModRuntimeHooks {
  verifySelectors?: (selectors: string[]) => Promise<SelectorVerifyResult>;
  fetchPageContext?: () => Promise<PageContextResult>;
  captureScreenshot?: (picked: PickedElementContext) => Promise<string | undefined>;
  builtinGenerate?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

export function defaultExtractJsonString(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function buildModPrompt(p: GenerateUserScriptPayload): string {
  const lang = p.lang ?? 'zh';
  const langNote =
    lang === 'zh'
      ? 'Write `name`, `description`, and `explanation` in natural, concise Simplified Chinese (简体中文). Button labels injected into the page should also default to Chinese unless the user asked otherwise.'
      : 'Write `name`, `description`, and `explanation` in crisp English.';

  const matchHint = p.targetUrl ? hostPatternFromUrl(p.targetUrl) : '';
  const safePageTitle = p.pageTitle ? redactSensitiveText(p.pageTitle, 80) : '';
  const safePageContext = p.pageContext
    ? p.pageContext
        .split(/\r?\n/)
        .map((line) => redactSensitiveText(line, 600))
        .filter(Boolean)
        .join('\n')
        .slice(0, 3400)
    : '';
  const safePickedTextPreview = p.pickedElement?.textPreview
    ? redactSensitiveText(p.pickedElement.textPreview, 120)
    : '';

  const pickedSection = p.pickedElement
    ? `## User-Picked Target Element (HIGHEST PRIORITY — anchor selectors here!)
- Primary CSS Selector: \`${p.pickedElement.selector}\` (matches ${p.pickedElement.matchCount} element(s) on live page)
${
  p.pickedElement.similarSelector
    ? `- Repeating List/Item Selector: \`${p.pickedElement.similarSelector}\` (matches ${p.pickedElement.similarCount} sibling items — use this if the user wants to modify/export ALL items in the list!)`
    : ''
}
- Tag: \`<${p.pickedElement.tag}>\` (${p.pickedElement.rect.width}x${p.pickedElement.rect.height}px)
- Key Attributes: ${JSON.stringify(p.pickedElement.attributes)}
- Computed Styles: ${JSON.stringify(p.pickedElement.computedStyles)}
${safePickedTextPreview ? `- Sample Text: "${safePickedTextPreview}"` : ''}
- Live DOM Subtree Snippet:
\`\`\`html
${p.pickedElement.domSnippet}
\`\`\``
    : '';

  const contextSection = safePageContext
    ? `## Live Page Structural Landmarks & Classes
\`\`\`
${safePageContext}
\`\`\``
    : '';

  const refinementSection = p.previousMod
    ? `## Existing Mod Draft to Refine (update this mod according to the user's new instruction)
- Previous Name: ${p.previousMod.name}
- Previous Engine: ${p.previousMod.engine}
- Previous Matches: ${JSON.stringify(p.previousMod.matches)}
${
  p.previousMod.engine === 'css'
    ? `- Previous CSS:\n\`\`\`css\n${p.previousMod.css ?? ''}\n\`\`\``
    : `- Previous JS Code:\n\`\`\`js\n${p.previousMod.code ?? ''}\n\`\`\``
}
${p.diagnosticHint ? `\n- Runtime Diagnostic Warning: ${p.diagnosticHint}` : ''}`
    : p.diagnosticHint
      ? `## Runtime Diagnostic Warning\n${p.diagnosticHint}`
      : '';

  return `You generate browser mods for PageCraft, an expert Chrome webpage modifier & Tampermonkey/Userscript engineer.
Turn the user's request into a clean, reliable, persistent webpage modification.

## User Request
${p.intent.trim()}

## Target Site
- Page URL hint: ${p.targetUrl ? sanitizePageUrl(p.targetUrl) : '(unknown)'}
- Page Title: ${safePageTitle || '(unknown)'}
- Recommended @match pattern: ${matchHint || 'https://example.com/*'}

${pickedSection}

${contextSection}

${refinementSection}

## Engine Selection Rule (CRITICAL!)
Choose \`"engine": "css"\` whenever the user's goal is purely visual or structural styling:
- Hiding/removing ads, sidebars, popups, banners, recommendations, or clutter (\`display: none !important;\`)
- Widening reading columns, changing colors/dark mode, adjusting font sizes, spacing, or sticky headers
Why: \`"css"\` mods apply in 0.1s with \`!important\` and require ZERO browser permissions!

Choose \`"engine": "js"\` ONLY when JavaScript logic is genuinely needed:
- Adding interactive buttons (e.g., Export Table to CSV/Markdown, Copy Code, Scroll/Jump buttons)
- Auto-clicking, form filling, keyboard shortcuts, unlocking copy/contextmenu events, or transforming DOM text/links.

## Hard Engineering Rules
1. If \`"engine": "css"\`:
   - Put pure valid CSS in \`"css"\` (no \`<style>\` tags) and set \`"code": ""\`.
   - Use \`:not(#__pagecraft_picker_host__)\` if writing broad selectors, and add \`!important\` where host page specificity may override.
2. If \`"engine": "js"\`:
   - Plain self-contained ES2020 JavaScript IIFE in \`"code"\` (no \`// ==UserScript==\` header, no external imports, no \`GM_*\` APIs, no \`eval\`, no network \`fetch\`/\`XMLHttpRequest\` exfiltration).
   - Idempotent: guard with a unique \`dataset\` flag or \`window.__pc_...\` flag so re-running never duplicates buttons.
   - SPA-resilient: modern sites (React/Vue/Next) render asynchronously — run immediately AND observe DOM changes via \`MutationObserver\` (debounced or lightweight) when decorating dynamic elements.
   - For CSV exports aimed at Excel, prepend UTF-8 BOM \`'\\uFEFF'\` so Chinese characters never garble.
3. \`"matches"\`: Use narrow site-specific patterns like \`"${matchHint || 'https://example.com/*'}"\`. NEVER output \`<all_urls>\` or \`*://*/*\`.
4. \`"targetSelectors"\`: Array of 1-3 primary CSS selectors your mod targets on the page (e.g. \`["table.order-list"]\`), so PageCraft can verify live DOM hits. Leave \`[]\` only if the mod applies globally to \`html\`/\`body\`/window events.

${langNote}

Return ONLY valid JSON matching this exact schema (no markdown code fences):
{
  "name": "Short mod title",
  "description": "One-sentence summary of what it changes",
  "engine": "css",
  "matches": ["${matchHint || 'https://example.com/*'}"],
  "css": "/* populated when engine is css, else empty string */",
  "code": "/* populated when engine is js, else empty string */",
  "targetSelectors": ["selector1"],
  "explanation": "1-3 concise sentences explaining how it works on this page"
}`;
}

export function parseGeneratedMod(
  raw: string,
  extractJsonString: (s: string) => string = defaultExtractJsonString,
  fallbackMatchUrl?: string,
): GeneratedUserScript | { error: string } {
  const cleaned = extractJsonString(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { error: 'AI 返回了无法解析的 JSON 格式，请重试一次。' };
  }

  const name = String(parsed.name ?? '').trim();
  const description = String(parsed.description ?? '').trim();
  const explanation = String(parsed.explanation ?? '').trim();
  let css = typeof parsed.css === 'string' ? parsed.css.trim() : '';
  let code = typeof parsed.code === 'string' ? parsed.code.trim() : '';

  css = css.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '').trim();

  const headerEnd = code.indexOf('==/UserScript==');
  if (headerEnd !== -1) {
    const rest = code.slice(headerEnd).split('\n');
    code = rest.slice(1).join('\n').trim() || code;
  }

  const engine: ModEngine =
    parsed.engine === 'css' || (css.length > 0 && code.length === 0) ? 'css' : 'js';

  if (!name) {
    return { error: 'AI 返回结果缺少名称（name）。' };
  }
  if (engine === 'css') {
    if (!css) return { error: 'AI 选择了 CSS 模式但未生成有效样式代码。' };
    const cssErr = validateCssStructureSafely(css);
    if (cssErr) return { error: cssErr };
  }
  if (engine === 'js') {
    if (!code) return { error: 'AI 选择了 JS 脚本模式但未生成可执行代码。' };
    const jsErr = validateJsStructureSafely(code);
    if (jsErr) return { error: jsErr };
  }
  if (css.length > 100_000 || code.length > 100_000) {
    return { error: '生成的代码体积超出安全上限。' };
  }

  let matches = Array.isArray(parsed.matches)
    ? parsed.matches.map((m) => String(m).trim()).filter(Boolean)
    : [];
  if (matches.length === 0 && fallbackMatchUrl) {
    const derived = hostPatternFromUrl(fallbackMatchUrl);
    if (derived) matches = [derived];
  }

  const matchError = validateMatches(matches, false);
  if (matchError) {
    if (fallbackMatchUrl) {
      const derived = hostPatternFromUrl(fallbackMatchUrl);
      if (derived && validateMatches([derived], false) === null) {
        matches = [derived];
      } else {
        return { error: `生成的网址匹配规则不合法：${matchError}` };
      }
    } else {
      return { error: `生成的网址匹配规则不合法：${matchError}` };
    }
  }
  if (matches.some((m) => isBroadMatch(m))) {
    if (fallbackMatchUrl && hostPatternFromUrl(fallbackMatchUrl)) {
      matches = [hostPatternFromUrl(fallbackMatchUrl)];
    } else {
      return { error: '出于安全限制，AI 生成的规则默认只作用于当前站点。' };
    }
  }

  const targetSelectors = Array.isArray(parsed.targetSelectors)
    ? parsed.targetSelectors
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0 && s.length <= 160)
        .slice(0, 5)
    : [];

  return {
    name,
    description,
    engine,
    matches,
    code: engine === 'js' ? code : '',
    css: engine === 'css' ? css : undefined,
    targetSelectors,
    explanation,
  };
}

const defaultByokLlmChat: LlmChatFn = (cfg, prompt, isTest, imageDataUrl) =>
  byokLlmChat(cfg, prompt, isTest, fetch, imageDataUrl);

export async function generateUserScript(
  payload: GenerateUserScriptPayload,
  settings: AppSettings,
  llmChat: LlmChatFn = defaultByokLlmChat,
  extractJsonString: (s: string) => string = defaultExtractJsonString,
  runtimeHooks: GenerateModRuntimeHooks = {},
): Promise<GenerateUserScriptResult> {
  if (!payload.intent?.trim()) {
    return {
      ok: false,
      error:
        payload.lang === 'zh'
          ? '请输入你想修改的网页效果描述。'
          : 'Please enter what you want to change.',
    };
  }

  const playgroundScript = tryBuildPlaygroundMod(payload);
  if (playgroundScript) {
    const verifyFn = runtimeHooks.verifySelectors ?? verifySelectorsOnActiveTab;
    const selectorCheck =
      playgroundScript.targetSelectors && playgroundScript.targetSelectors.length > 0
        ? await verifyFn(playgroundScript.targetSelectors)
        : undefined;
    return {
      ok: true,
      script: playgroundScript,
      provider: 'playground',
      ...(selectorCheck?.ok ? { selectorCheck } : {}),
    };
  }

  const verifyFn = runtimeHooks.verifySelectors ?? verifySelectorsOnActiveTab;
  const fetchContextFn = runtimeHooks.fetchPageContext ?? getActiveTabPageContext;
  const captureFn = runtimeHooks.captureScreenshot ?? ((p) => captureElementScreenshot(p));
  const builtinFn = runtimeHooks.builtinGenerate ?? ((sys, usr) => generateWithBuiltinAi(sys, usr));

  const useBuiltin = settings.aiMode === 'builtin';

  if (!useBuiltin) {
    const rawBaseUrl = settings.ai?.baseUrl ?? '';
    const resolved = resolveEndpoints(rawBaseUrl);
    if (resolved.error === 'insecure') {
      return {
        ok: false,
        code: 'network',
        error:
          payload.lang === 'zh'
            ? '远程 AI 接口必须使用 https://（仅本地 localhost / 127.0.0.1 / [::1] 允许使用 http://）。'
            : 'Remote Base URL must use https:// (http:// is only allowed for localhost, 127.0.0.1, or [::1]).',
      };
    }
    if (resolved.error) {
      return {
        ok: false,
        code: 'network',
        error:
          payload.lang === 'zh'
            ? '请在设置中填写有效的 AI 接口地址（Base URL）。'
            : 'Please enter a valid AI Base URL in Settings.',
      };
    }
    if (!isLocalLoopbackEndpoint(resolved.base) && !settings.ai?.apiKey?.trim()) {
      return {
        ok: false,
        code: 'missing_api_key',
        error:
          payload.lang === 'zh'
            ? '请先在「设置」中填写 API Key，或切换为本地 Ollama / LM Studio / Chrome 内置 AI（免 Key 离线可用）。'
            : 'API key is empty. Add your API key in Settings, or switch to Local Ollama / LM Studio / Chrome Built-in AI.',
      };
    }
  }

  let imageDataUrl: string | undefined;
  if (
    !useBuiltin &&
    settings.enableVisionCapture &&
    payload.pickedElement &&
    payload.pickedElement.rect.width > 0 &&
    payload.pickedElement.rect.height > 0
  ) {
    imageDataUrl =
      payload.pickedElement.screenshotDataUrl || (await captureFn(payload.pickedElement));
  }

  const runSinglePass = async (
    passPayload: GenerateUserScriptPayload,
  ): Promise<
    | { ok: true; script: GeneratedUserScript; usedVision: boolean }
    | { ok: false; code: 'builtin_unavailable' | 'network' | 'invalid_output'; error: string }
  > => {
    const prompt = buildModPrompt(passPayload);
    try {
      if (useBuiltin) {
        const rawOut = await builtinFn(BUILTIN_AI_SYSTEM_PROMPT, prompt);
        const parsed = parseGeneratedMod(rawOut, extractJsonString, passPayload.targetUrl);
        if ('error' in parsed) {
          return { ok: false, code: 'invalid_output', error: parsed.error };
        }
        return { ok: true, script: parsed, usedVision: false };
      }

      const res = await llmChat(settings.ai, prompt, false, imageDataUrl);
      const parsed = parseGeneratedMod(res.content, extractJsonString, passPayload.targetUrl);
      if ('error' in parsed) {
        return { ok: false, code: 'invalid_output', error: parsed.error };
      }
      const didUseVision = Boolean(imageDataUrl && (res.usedVision ?? true));
      return { ok: true, script: parsed, usedVision: didUseVision };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        code: useBuiltin ? 'builtin_unavailable' : 'network',
        error: msg,
      };
    }
  };

  const firstPass = await runSinglePass(payload);
  if (!firstPass.ok) {
    return firstPass;
  }

  const provider = useBuiltin ? 'builtin' : 'byok';
  let finalScript = firstPass.script;
  let usedVision = firstPass.usedVision;
  let autoHealed = false;
  let selectorCheck: SelectorVerifyResult | undefined;

  if (finalScript.targetSelectors && finalScript.targetSelectors.length > 0) {
    const initialVerify = await verifyFn(finalScript.targetSelectors);
    if (initialVerify.ok) {
      selectorCheck = initialVerify;
    }

    // Closed-Loop Auto-Verification & 1-Pass Self-Heal when 0 live elements match
    if (
      settings.enableAutoHeal &&
      !payload.previousMod &&
      initialVerify.ok &&
      initialVerify.totalHits === 0
    ) {
      let freshPageContext = payload.pageContext;
      if (!freshPageContext) {
        const liveCtx = await fetchContextFn();
        if (liveCtx.ok && liveCtx.context) {
          freshPageContext = liveCtx.context;
        }
      }

      const failedSelectors = finalScript.targetSelectors.join(', ');
      const healPayload: GenerateUserScriptPayload = {
        ...payload,
        pageContext: freshPageContext || payload.pageContext,
        previousMod: {
          name: finalScript.name,
          description: finalScript.description,
          engine: finalScript.engine,
          matches: finalScript.matches,
          code: finalScript.engine === 'js' ? finalScript.code : undefined,
          css: finalScript.engine === 'css' ? finalScript.css : undefined,
          targetSelectors: finalScript.targetSelectors,
        },
        diagnosticHint: `Auto-Verify: Generated selector(s) [${failedSelectors}] matched 0 elements on the live DOM. Inspect the live DOM landmarks and output corrected selectors that match existing elements.`,
      };

      const secondPass = await runSinglePass(healPayload);
      if (secondPass.ok) {
        finalScript = secondPass.script;
        usedVision = usedVision || secondPass.usedVision;
        autoHealed = true;
        if (finalScript.targetSelectors && finalScript.targetSelectors.length > 0) {
          const healedVerify = await verifyFn(finalScript.targetSelectors);
          if (healedVerify.ok) {
            selectorCheck = healedVerify;
          }
        } else {
          selectorCheck = { ok: true, totalHits: 0, details: [] };
        }
      }
    }
  }

  return {
    ok: true,
    script: finalScript,
    provider,
    usedVision,
    autoHealed,
    ...(selectorCheck ? { selectorCheck } : {}),
  };
}

// ─── Local Coding Agent Bridge (`pagecraft-mcp`) Tool Handlers ────────────

export interface McpBridgeApplyModInput {
  name: string;
  description?: string;
  engine: 'css' | 'js';
  matches?: string[];
  body: string;
  targetSelectors?: string[];
}

export interface McpBridgeHandlers {
  getActivePage: () => Promise<unknown>;
  getPickedElement: () => Promise<unknown>;
  triggerPicker: () => Promise<unknown>;
  verifySelectors: (selectors: string[]) => Promise<unknown>;
  applyMod: (input: McpBridgeApplyModInput) => Promise<unknown>;
  listMods: () => Promise<unknown>;
  toggleMod: (id: string, enabled: boolean) => Promise<unknown>;
}

export interface McpBridgeHandlerDeps {
  getLastPickedElement?: () => PickedElementContext | null | Promise<PickedElementContext | null>;
  startPicker?: (lang?: 'zh' | 'en') => Promise<{ ok: boolean; error?: string }>;
  captureScreenshot?: (picked: PickedElementContext) => Promise<string | undefined>;
  includeVisionScreenshot?: () => boolean | Promise<boolean>;
}

export function buildMcpBridgeHandlers(deps: McpBridgeHandlerDeps = {}): McpBridgeHandlers {
  const captureFn = deps.captureScreenshot ?? ((p) => captureElementScreenshot(p));

  return {
    async getActivePage() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const rawUrl = tab?.url ?? '';
      const supported = Boolean(tab?.id && /^https?:\/\//i.test(rawUrl));
      const ctx = supported ? await getActiveTabPageContext() : { ok: false };
      const allMods = await readUserScripts();
      const activeMods = supported
        ? allMods
            .filter((m) => m.enabled && urlMatchesAny(rawUrl, m.matches))
            .map((m) => ({
              id: m.id,
              name: m.name,
              engine: m.engine,
              matches: m.matches,
              targetSelectors: m.targetSelectors,
            }))
        : [];

      return {
        supported,
        tabId: tab?.id,
        url: rawUrl ? sanitizePageUrl(rawUrl) : undefined,
        title: tab?.title ? redactSensitiveText(tab.title, 100) : undefined,
        domSkeleton: ctx.ok ? ctx.context : undefined,
        activeMods,
      };
    },

    async getPickedElement() {
      const picked = (await deps.getLastPickedElement?.()) ?? null;
      if (!picked) {
        return { pickedElement: null };
      }
      const allowShot = (await deps.includeVisionScreenshot?.()) ?? true;
      if (allowShot && !picked.screenshotDataUrl && picked.rect.width > 0 && picked.rect.height > 0) {
        const shot = await captureFn(picked);
        if (shot) {
          return { pickedElement: { ...picked, screenshotDataUrl: shot } };
        }
      }
      return { pickedElement: picked };
    },

    async triggerPicker() {
      if (deps.startPicker) {
        return deps.startPicker('en');
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        return { ok: false, error: 'Active tab is not a scriptable http/https webpage.' };
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: injectElementPickerOverlay,
        args: ['en'],
        world: 'ISOLATED',
      });
      return { ok: true, url: sanitizePageUrl(tab.url) };
    },

    async verifySelectors(selectors: string[]) {
      return verifySelectorsOnActiveTab(selectors);
    },

    async applyMod(input: McpBridgeApplyModInput) {
      const name = String(input.name ?? '').trim();
      const engine: ModEngine = input.engine === 'js' ? 'js' : 'css';
      const body = String(input.body ?? '').trim();

      if (!name) {
        throw new Error('Mod `name` is required.');
      }
      if (!body) {
        throw new Error('Mod `body` cannot be empty.');
      }
      if (engine === 'css') {
        const err = validateCssStructureSafely(body);
        if (err) throw new Error(err);
      } else {
        const err = validateJsStructureSafely(body);
        if (err) throw new Error(err);
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const tabUrl = tab?.url ?? '';

      let matches = Array.isArray(input.matches)
        ? input.matches.map((m) => String(m).trim()).filter(Boolean)
        : [];
      if (matches.length === 0 && tabUrl) {
        const derived = hostPatternFromUrl(tabUrl);
        if (derived) matches = [derived];
      }
      if (matches.length === 0) {
        throw new Error('No valid `@match` pattern provided and no active http/https tab open.');
      }
      const matchErr = validateMatches(matches, false);
      if (matchErr || matches.some((m) => isBroadMatch(m))) {
        throw new Error(
          `Invalid or overly broad @match pattern (${matchErr ?? 'broad wildcard disallowed'}).`,
        );
      }

      const now = Date.now();
      const existing = (await readUserScripts()).find(
        (m) => m.name === name && JSON.stringify(m.matches) === JSON.stringify(matches),
      );
      const mod: UserScript = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        description: String(input.description ?? '').trim(),
        engine,
        matches,
        code: engine === 'js' ? body : '',
        css: engine === 'css' ? body : undefined,
        targetSelectors: Array.isArray(input.targetSelectors)
          ? input.targetSelectors.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
          : undefined,
        enabled: true,
        source: 'ai',
        runAt: engine === 'css' ? 'document_start' : 'document_idle',
        allowAllUrls: false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await upsertUserScript(mod);
      await syncUserScripts();
      if (engine === 'css' && tab?.id && tabUrl && urlMatchesAny(tabUrl, matches)) {
        await syncCssForTab(tab.id, tabUrl);
      }

      const selectorCheck =
        mod.targetSelectors && mod.targetSelectors.length > 0
          ? await verifySelectorsOnActiveTab(mod.targetSelectors)
          : undefined;

      return {
        ok: true,
        id: mod.id,
        name: mod.name,
        engine: mod.engine,
        matches: mod.matches,
        selectorCheck,
      };
    },

    async listMods() {
      const mods = await readUserScripts();
      return {
        mods: mods.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          engine: m.engine,
          matches: m.matches,
          enabled: m.enabled,
          targetSelectors: m.targetSelectors,
          updatedAt: m.updatedAt,
        })),
      };
    },

    async toggleMod(id: string, enabled: boolean) {
      const mods = await readUserScripts();
      const target = mods.find((m) => m.id === id);
      if (!target) {
        throw new Error(`Mod not found: ${id}`);
      }
      const updated: UserScript = {
        ...target,
        enabled: Boolean(enabled),
        updatedAt: Date.now(),
      };
      await upsertUserScript(updated);
      await syncUserScripts();
      return { ok: true, id: updated.id, name: updated.name, enabled: updated.enabled };
    },
  };
}
