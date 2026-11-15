/**
 * Zero-server shareable recipe shortcode & deep-link utilities.
 *
 * Encodes a PageCraft CSS or JS mod into a compact `PC1:<base64url>` token
 * that can be shared as a Xiaohongshu-friendly copy-paste shortcode (`#PC1:...#`)
 * or as a URL query parameter (`?recipe=PC1:...`).
 */

import type { ModEngine, UserScript, UserScriptRunAt } from './types';

export const RECIPE_SHORTCODE_PREFIX = 'PC1:';
export const DEFAULT_RECIPE_SHARE_BASE_URL = 'https://pagecraft.shenxin.space/playground';

interface WireRecipeV1 {
  v: 1;
  n: string;
  d?: string;
  e: ModEngine;
  m: string[];
  b: string;
  r?: UserScriptRunAt;
  ts?: string[];
}

export interface DecodedRecipe {
  name: string;
  description: string;
  engine: ModEngine;
  matches: string[];
  body: string;
  runAt: UserScriptRunAt;
  targetSelectors?: string[];
}

export type ShareableModInput = Pick<
  UserScript,
  'name' | 'description' | 'engine' | 'matches' | 'code' | 'css' | 'runAt' | 'targetSelectors'
>;

const SHORTCODE_TOKEN_RE = /PC1:([A-Za-z0-9_-]{8,})/;
const VALID_RUN_AT = new Set<UserScriptRunAt>(['document_start', 'document_end', 'document_idle']);

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string): Uint8Array {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((token.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a PageCraft mod into a compact `PC1:<base64url>` shortcode.
 */
export function encodeRecipeShortcode(mod: ShareableModInput): string {
  const body = (mod.engine === 'css' ? mod.css ?? mod.code : mod.code).trim();
  const payload: WireRecipeV1 = {
    v: 1,
    n: mod.name.trim(),
    e: mod.engine,
    m: mod.matches.map((m) => m.trim()).filter(Boolean),
    b: body,
  };
  if (mod.description?.trim()) payload.d = mod.description.trim();
  if (mod.runAt) payload.r = mod.runAt;
  if (mod.targetSelectors && mod.targetSelectors.length > 0) {
    payload.ts = mod.targetSelectors.map((s) => s.trim()).filter(Boolean);
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${RECIPE_SHORTCODE_PREFIX}${toBase64Url(jsonBytes)}`;
}

/**
 * Builds a shareable deep-link URL embedding the encoded recipe shortcode.
 */
export function buildRecipeShareUrl(
  mod: ShareableModInput,
  baseUrl = DEFAULT_RECIPE_SHARE_BASE_URL,
): string {
  const code = encodeRecipeShortcode(mod);
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}recipe=${encodeURIComponent(code)}`;
}

/**
 * Formats a social-ready share post (ideal for Xiaohongshu / WeChat / Discord)
 * containing both a human-readable summary and a `#PC1:...#` copy-paste token.
 */
export function formatRecipeSharePost(
  mod: ShareableModInput,
  lang: 'zh' | 'en',
  baseUrl = DEFAULT_RECIPE_SHARE_BASE_URL,
): string {
  const token = encodeRecipeShortcode(mod);
  const url = `${baseUrl}?recipe=${encodeURIComponent(token)}`;
  const matchPreview = mod.matches.slice(0, 2).join(', ');
  if (lang === 'zh') {
    return [
      `✨ PageCraft 网页工坊配方分享：《${mod.name}》`,
      mod.description?.trim() ? `简介：${mod.description.trim()}` : null,
      matchPreview ? `适用站点：${matchPreview}` : null,
      `导入方式：复制整段内容，打开 PageCraft「规则库 → 导入」粘贴即可一键启用 👇`,
      `#${token}#`,
      `链接：${url}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `✨ PageCraft Recipe: "${mod.name}"`,
    mod.description?.trim() ? `About: ${mod.description.trim()}` : null,
    matchPreview ? `Matches: ${matchPreview}` : null,
    `How to use: Copy this message and paste it into PageCraft "Mods → Import" 👇`,
    `#${token}#`,
    `Link: ${url}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Checks whether arbitrary pasted text contains a PageCraft recipe shortcode or link.
 */
export function isShareableRecipeText(raw: string): boolean {
  return decodeRecipeShortcode(raw) !== null;
}

/**
 * Extracts and decodes a `PC1:...` recipe from a raw token, social post, or share URL.
 * Returns `null` if no valid PageCraft recipe payload is found.
 */
export function decodeRecipeShortcode(raw: string): DecodedRecipe | null {
  if (!raw || typeof raw !== 'string') return null;

  let candidate = raw;
  // Handle URL-encoded `?recipe=PC1%3A...` pasted directly from a browser bar
  if (candidate.includes('PC1%3A') || candidate.includes('pc1%3A')) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      /* keep raw */
    }
  }

  const match = SHORTCODE_TOKEN_RE.exec(candidate);
  if (!match?.[1]) return null;

  try {
    const bytes = fromBase64Url(match[1]);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as Partial<WireRecipeV1>;

    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.n !== 'string' ||
      !parsed.n.trim() ||
      (parsed.e !== 'css' && parsed.e !== 'js') ||
      !Array.isArray(parsed.m) ||
      typeof parsed.b !== 'string' ||
      !parsed.b.trim()
    ) {
      return null;
    }

    const matches = parsed.m
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (matches.length === 0) return null;

    const runAt: UserScriptRunAt =
      parsed.r && VALID_RUN_AT.has(parsed.r)
        ? parsed.r
        : parsed.e === 'css'
          ? 'document_start'
          : 'document_idle';

    const targetSelectors = Array.isArray(parsed.ts)
      ? parsed.ts.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : undefined;

    return {
      name: parsed.n.trim(),
      description: typeof parsed.d === 'string' ? parsed.d.trim() : '',
      engine: parsed.e,
      matches,
      body: parsed.b.trim(),
      runAt,
      ...(targetSelectors && targetSelectors.length > 0 ? { targetSelectors } : {}),
    };
  } catch {
    return null;
  }
}

export {
  PACK_SHORTCODE_PREFIX,
  DEFAULT_PACK_HUB_URL,
  encodePackShortcode,
  decodePackShortcode,
  serializePackJson,
  parsePackJson,
  buildPackFromUserScripts,
  instantiatePackMods,
  formatPackSharePost,
  buildGitHubPackSubmissionUrl,
  extractWebHandoffPayload,
  resolveCatalogPack,
  type PackCategory,
  type CommunityPack,
  type CommunityPackMod,
  type LocalizedCatalogPack,
  type WebHandoffPayload,
} from './packs';
