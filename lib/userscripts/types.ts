/**
 * Types for PageCraft's Dual-Engine Mod Manager (CSS + JS Userscripts).
 *
 * - `engine: 'css'` runs via `chrome.scripting.insertCSS` / `removeCSS`:
 *   works out-of-the-box with ZERO browser developer/userscript toggles!
 * - `engine: 'js'` runs via MV3 `chrome.userScripts` in an isolated
 *   `USER_SCRIPT` world (and exports cleanly to Tampermonkey / ScriptCat).
 */

import type { CloudQuota } from '../../types';

export const MODS_STORAGE_KEY = 'pc_mods';
export const LEGACY_USERSCRIPTS_STORAGE_KEY = 'pr_userscripts';

export type ModEngine = 'css' | 'js';

export type UserScriptSource = 'ai' | 'template' | 'manual';

export type UserScriptRunAt =
  | 'document_start'
  | 'document_end'
  | 'document_idle';

export interface UserScript {
  id: string;
  name: string;
  description: string;
  engine: ModEngine;
  /** Chrome match patterns, e.g. "https://*.zhihu.com/*". */
  matches: string[];
  /** Runnable JS body when engine === 'js' (never includes ==UserScript== block). */
  code: string;
  /** Pure CSS stylesheet body when engine === 'css'. */
  css?: string;
  /** Primary CSS selectors targeted by this mod for live hit verification. */
  targetSelectors?: string[];
  enabled: boolean;
  source: UserScriptSource;
  templateId?: string;
  runAt: UserScriptRunAt;
  /** User explicitly opted into a broad <all_urls>-style match. */
  allowAllUrls?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Result of the availability probe for `chrome.userScripts`. */
export interface UserScriptsAvailability {
  available: boolean;
  reason?: 'unsupported' | 'disabled';
}

/** Context captured when the user clicks an element with the live Element Picker. */
export interface PickedElementContext {
  selector: string;
  matchCount: number;
  /** Selector matching sibling list/table items when inside a repeating container. */
  similarSelector?: string;
  similarCount?: number;
  tag: string;
  textPreview?: string;
  attributes: Record<string, string>;
  rect: { width: number; height: number };
  computedStyles: Record<string, string>;
  /** Compact, PII-redacted HTML skeleton of the element + immediate surroundings. */
  domSnippet: string;
  pageUrl: string;
  pageTitle?: string;
}

export interface ActiveTabInfo {
  tabId?: number;
  url?: string;
  host?: string;
  title?: string;
  supported: boolean;
}

export interface PreviousModDraft {
  name: string;
  description: string;
  engine: ModEngine;
  matches: string[];
  code?: string;
  css?: string;
  targetSelectors?: string[];
}

export interface GenerateUserScriptPayload {
  intent: string;
  targetUrl?: string;
  pageTitle?: string;
  pageContext?: string;
  pickedElement?: PickedElementContext | null;
  /** Present when refining an existing draft in multi-turn chat or self-healing selectors. */
  previousMod?: PreviousModDraft | null;
  /** Optional runtime diagnostic (e.g. "Selector .foo matched 0 elements on live page"). */
  diagnosticHint?: string;
  lang?: 'zh' | 'en';
}

export interface GeneratedUserScript {
  name: string;
  description: string;
  engine: ModEngine;
  matches: string[];
  code: string;
  css?: string;
  targetSelectors?: string[];
  explanation: string;
}

export type GenerateUserScriptResult =
  | {
      ok: true;
      script: GeneratedUserScript;
      provider: 'cloud' | 'byok' | 'playground';
      quota?: CloudQuota;
    }
  | {
      ok: false;
      error: string;
      code?: 'quota_exhausted' | 'missing_api_key' | 'network' | 'invalid_output';
      quota?: CloudQuota;
    };

export interface PageContextResult {
  ok: boolean;
  url?: string;
  title?: string;
  context?: string;
  error?: string;
}

export interface SelectorVerifyResult {
  ok: boolean;
  totalHits: number;
  details: Array<{ selector: string; count: number }>;
}
