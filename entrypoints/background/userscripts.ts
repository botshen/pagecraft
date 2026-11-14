/**
 * PageCraft Dual-Engine Execution & AI Mod Generation Subsystem.
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
  PageContextResult,
  SelectorVerifyResult,
  UserScript,
  UserScriptsAvailability,
} from '../../lib/userscripts/types';
import { MODS_STORAGE_KEY } from '../../lib/userscripts/types';
import {
  hostPatternFromUrl,
  isBroadMatch,
  readUserScripts,
  validateMatches,
} from '../../lib/userscripts/store';
import { urlMatchesAny } from '../../lib/userscripts/matcher';
import { wrapWithGmShimIfNeeded } from '../../lib/userscripts/gm-shim';
import { redactSensitiveText, sanitizePageUrl } from '../../lib/shared/privacy';
import { isLocalLoopbackEndpoint, resolveEndpoints } from '../../lib/shared/ai-endpoints';
import { requestCloudGeneration } from '../../lib/api/cloud';
import { tryBuildPlaygroundMod } from '../../lib/userscripts/playground';
import type { AppSettings, AIConfig } from '../../types';
import { extractLivePageContext, probeTargetSelectors } from './picker-injected';

void (null as unknown as typeof ModsKeyType);

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

  // Remove CSS mods that were turned off, deleted, or changed
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

  // Inject newly enabled or updated CSS mods
  for (const mod of desiredCssMods) {
    const cssText = mod.css!;
    if (applied.get(mod.id) === cssText) continue;
    if (!desiredIds.has(mod.id)) continue;
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, css: cssText });
      applied.set(mod.id, cssText);
    } catch {
      /* restricted page (e.g. Chrome Web Store) — non-fatal */
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
  // Always sync CSS mods first — they never require `chrome.userScripts`!
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
        // Fresh navigation wiped previous document styles; clear tab registry so CSS re-injects cleanly
        tabCssRegistry.delete(tabId);
        if (nextUrl) void syncCssForTab(tabId, nextUrl);
      } else if (Boolean(changeInfo.url) && nextUrl) {
        // SPA pushState / replaceState navigation: immediately sync path-scoped CSS rules
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

// ─── Live Page Context & Selector Verification ────────────────────────────

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

// ─── AI Prompt & Dual-Engine Parser ───────────────────────────────────────

export interface LlmChatFn {
  (config: AIConfig, prompt: string, isTest?: boolean): Promise<{ content: string }>;
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
  extractJsonString: (s: string) => string,
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

  // Strip accidental <style> wrappers on CSS
  css = css.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '').trim();

  // Strip accidental ==UserScript== header on JS
  const headerEnd = code.indexOf('==/UserScript==');
  if (headerEnd !== -1) {
    const rest = code.slice(headerEnd).split('\n');
    code = rest.slice(1).join('\n').trim() || code;
  }

  const engine =
    parsed.engine === 'css' || (css.length > 0 && code.length === 0) ? 'css' : 'js';

  if (!name) {
    return { error: 'AI 返回结果缺少名称（name）。' };
  }
  if (engine === 'css' && !css) {
    return { error: 'AI 选择了 CSS 模式但未生成有效样式代码。' };
  }
  if (engine === 'js' && !code) {
    return { error: 'AI 选择了 JS 脚本模式但未生成可执行代码。' };
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

export async function generateUserScript(
  payload: GenerateUserScriptPayload,
  settings: AppSettings,
  llmChat: LlmChatFn,
  extractJsonString: (s: string) => string,
): Promise<GenerateUserScriptResult> {
  if (!payload.intent?.trim()) {
    return {
      ok: false,
      error: payload.lang === 'zh' ? '请输入你想修改的网页效果描述。' : 'Please enter what you want to change.',
    };
  }

  // Zero-credit instant sandbox generation on https://pagecraft.shenxin.space/playground
  const playgroundScript = tryBuildPlaygroundMod(payload);
  if (playgroundScript) {
    return {
      ok: true,
      script: playgroundScript,
      provider: 'playground',
    };
  }

  const prompt = buildModPrompt(payload);
  const rawBaseUrl = settings.ai?.baseUrl ?? '';
  const isLocalAi = isLocalLoopbackEndpoint(rawBaseUrl);
  const useByok =
    settings.aiMode === 'byok' ||
    ((Boolean(settings.ai?.apiKey?.trim()) || isLocalAi) && settings.cloud.quota?.remaining === 0);

  if (useByok) {
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
            ? '当前处于「自带 Key / 本地 AI」模式，请先在设置中填写 API Key（或选择本地 Ollama 预设），也可切回免费云端额度。'
            : 'API key is empty. Add your API key in Settings, choose the local Ollama preset, or switch to Free Cloud Trial.',
      };
    }
    try {
      const res = await llmChat(settings.ai, prompt);
      const parsed = parseGeneratedMod(res.content, extractJsonString, payload.targetUrl);
      if ('error' in parsed) {
        return { ok: false, code: 'invalid_output', error: parsed.error };
      }
      return { ok: true, script: parsed, provider: 'byok' };
    } catch (e) {
      return {
        ok: false,
        code: 'network',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // Cloud Trial mode (10 free generations per install)
  const cloudRes = await requestCloudGeneration(prompt);
  if (!cloudRes.ok) {
    if (cloudRes.code === 'quota_exhausted') {
      return {
        ok: false,
        code: 'quota_exhausted',
        quota: cloudRes.quota,
        error:
          payload.lang === 'zh'
            ? '10 次免费云端体验额度已用完。前往「设置」填入你自己的 DeepSeek / 硅基流动 / OpenAI Key 即可无限免费使用！'
            : 'Your 10 free cloud generations are used up. Add your own DeepSeek or OpenAI API key in Settings for unlimited use.',
      };
    }
    return {
      ok: false,
      code: 'network',
      quota: cloudRes.quota,
      error:
        payload.lang === 'zh'
          ? `云端 AI 服务暂不可用（${cloudRes.error}）。你也可以在「设置」填写自己的 DeepSeek API Key 直接生成。`
          : `Cloud AI unavailable (${cloudRes.error}). You can also configure your own API key in Settings.`,
    };
  }

  const parsed = parseGeneratedMod(cloudRes.content, extractJsonString, payload.targetUrl);
  if ('error' in parsed) {
    return {
      ok: false,
      code: 'invalid_output',
      quota: cloudRes.quota,
      error: parsed.error,
    };
  }

  return {
    ok: true,
    script: parsed,
    provider: 'cloud',
    quota: cloudRes.quota,
  };
}
