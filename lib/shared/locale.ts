/**
 * Best-practice locale resolution for PageCraft (Chinese vs Overseas users).
 *
 * Priority order:
 * 1. Explicit URL query (`?lang=zh` or `?lang=en`)
 * 2. Explicit user manual choice (`pc_lang_override` — written ONLY when the user
 *    clicks a language switcher, never auto-persisted on startup)
 * 3. Smart environment signals:
 *    - Browser extension UI locale (`chrome.i18n.getUILanguage()`, e.g. `zh-CN`, `zh-TW`)
 *    - Any preferred language in `navigator.languages` / `navigator.language` starting
 *      with `zh` (handles Chinese users/devs whose primary OS/Chrome UI is English
 *      like `['en-US', 'zh-CN']`)
 *    - Greater China system timezone (`Asia/Shanghai`, `Asia/Hong_Kong`, `Asia/Taipei`, etc.)
 * 4. Overseas / international users (non-Chinese languages + non-Chinese timezone) -> `'en'`
 * 5. Fallback when no environment signals exist -> `'zh'`
 */

export type UiLang = 'zh' | 'en';

export const MANUAL_LANG_STORAGE_KEY = 'pc_lang_override';
const LEGACY_AUTO_LANG_KEY = 'pc_lang';

const CHINESE_TIMEZONES = new Set([
  'asia/shanghai',
  'asia/chongqing',
  'asia/harbin',
  'asia/urumqi',
  'asia/kashgar',
  'asia/hong_kong',
  'asia/macau',
  'asia/macao',
  'asia/taipei',
  'prc',
  'roc',
  'hongkong',
]);

export interface LocaleSignals {
  queryLang?: string | null;
  manualOverride?: string | null;
  chromeUiLang?: string | null;
  languages?: readonly string[] | null;
  language?: string | null;
  timeZone?: string | null;
}

function normalizeExplicitLang(val?: string | null): UiLang | null {
  if (!val) return null;
  const v = val.trim().toLowerCase();
  if (v === 'zh' || v.startsWith('zh-') || v.startsWith('zh_')) return 'zh';
  if (v === 'en' || v.startsWith('en-') || v.startsWith('en_')) return 'en';
  return null;
}

function isZhTag(tag?: string | null): boolean {
  if (!tag) return false;
  const t = tag.trim().toLowerCase();
  return t === 'zh' || t.startsWith('zh-') || t.startsWith('zh_');
}

export function resolvePreferredLang(signals: LocaleSignals): UiLang {
  const fromQuery = normalizeExplicitLang(signals.queryLang);
  if (fromQuery) return fromQuery;

  const fromManual = normalizeExplicitLang(signals.manualOverride);
  if (fromManual) return fromManual;

  if (isZhTag(signals.chromeUiLang)) {
    return 'zh';
  }

  const allLangs: string[] = [];
  if (Array.isArray(signals.languages)) {
    for (const l of signals.languages) {
      if (typeof l === 'string' && l.trim()) allLangs.push(l.trim());
    }
  }
  if (typeof signals.language === 'string' && signals.language.trim()) {
    allLangs.push(signals.language.trim());
  }

  if (allLangs.some((l) => isZhTag(l))) {
    return 'zh';
  }

  const tz = (signals.timeZone ?? '').trim().toLowerCase();
  if (tz && CHINESE_TIMEZONES.has(tz)) {
    return 'zh';
  }

  if (allLangs.length > 0 || (signals.chromeUiLang && signals.chromeUiLang.trim())) {
    return 'en';
  }

  return 'zh';
}

export function detectBrowserLang(): UiLang {
  let queryLang: string | null = null;
  let manualOverride: string | null = null;
  let chromeUiLang: string | null = null;
  let languages: readonly string[] | null = null;
  let language: string | null = null;
  let timeZone: string | null = null;

  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      queryLang = new URLSearchParams(window.location.search).get('lang');
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof localStorage !== 'undefined') {
      manualOverride = localStorage.getItem(MANUAL_LANG_STORAGE_KEY);
      // Clean up legacy auto-saved `pc_lang` that previously locked users into 'en'
      localStorage.removeItem(LEGACY_AUTO_LANG_KEY);
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      chromeUiLang = chrome.i18n.getUILanguage();
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof navigator !== 'undefined') {
      languages = navigator.languages;
      language = navigator.language;
    }
  } catch {
    /* ignore */
  }

  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    /* ignore */
  }

  return resolvePreferredLang({
    queryLang,
    manualOverride,
    chromeUiLang,
    languages,
    language,
    timeZone,
  });
}

export function saveManualLangOverride(next: UiLang): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MANUAL_LANG_STORAGE_KEY, next);
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ [MANUAL_LANG_STORAGE_KEY]: next });
      void chrome.storage.local.remove(LEGACY_AUTO_LANG_KEY);
    }
  } catch {
    /* ignore */
  }
}
