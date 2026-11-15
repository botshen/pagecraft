/**
 * Multi-rule Community Recipe Pack protocol (`PCP1:<base64url>` & `.pagecraft-pack.json`),
 * web-to-SidePanel handoff URL parser, and GitHub issue submission helpers.
 *
 * Follows Chrome Web Store MV3 best practices:
 * - Zero silent remote JS fetching or background execution
 * - Deterministic rule IDs (`pack:<packId>:<modId>`) for idempotent updates
 * - User-confirmed review before writing into chrome.storage.local
 */

import type { ModEngine, UserScript, UserScriptRunAt } from './types';
import { isBroadMatch, normalizeTampermonkeyPattern, validateMatches } from './store';
import { decodeRecipeShortcode } from './share';

export const PACK_SHORTCODE_PREFIX = 'PCP1:';
export const DEFAULT_PACK_HUB_URL = 'https://pagecraft.shenxin.space/recipes/';
export const GITHUB_REPO_URL = 'https://github.com/botshen/pagecraft';

export type PackCategory = 'video' | 'reading' | 'dev' | 'productivity';

export interface CommunityPackMod {
  id: string;
  name: string;
  description: string;
  engine: ModEngine;
  matches: string[];
  body: string;
  runAt?: UserScriptRunAt;
  targetSelectors?: string[];
  defaultEnabled?: boolean;
}

export interface CommunityPack {
  kind: 'pagecraft-pack';
  version: 1;
  id: string;
  name: string;
  description: string;
  author: string;
  category?: PackCategory;
  tags: string[];
  siteHints: string[];
  mods: CommunityPackMod[];
  updatedAt?: string;
}

export interface LocalizedPackVariant {
  name: string;
  description: string;
  mods: CommunityPackMod[];
}

export interface LocalizedCatalogPack {
  id: string;
  author: string;
  category: PackCategory;
  tags: string[];
  siteHints: string[];
  updatedAt: string;
  zh: LocalizedPackVariant;
  en: LocalizedPackVariant;
}

interface WirePackModV1 {
  i: string;
  n: string;
  d?: string;
  e: ModEngine;
  m: string[];
  b: string;
  r?: UserScriptRunAt;
  ts?: string[];
  en?: boolean;
}

interface WirePackV1 {
  v: 1;
  id: string;
  n: string;
  d?: string;
  a?: string;
  c?: PackCategory;
  tg?: string[];
  sh?: string[];
  u?: string;
  ms: WirePackModV1[];
}

const PACK_TOKEN_RE = /PCP1:([A-Za-z0-9_-]{12,})/;
const VALID_CATEGORIES = new Set<PackCategory>(['video', 'reading', 'dev', 'productivity']);
const VALID_RUN_AT = new Set<UserScriptRunAt>(['document_start', 'document_end', 'document_idle']);
const MAX_PACK_MODS = 25;
const MAX_PACK_BYTES = 350_000;

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

export function slugifyPackId(raw: string, fallback = 'custom-pack'): string {
  const slug = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

export function resolveCatalogPack(
  entry: LocalizedCatalogPack,
  lang: 'zh' | 'en',
): CommunityPack {
  const variant = lang === 'zh' ? entry.zh : entry.en;
  return {
    kind: 'pagecraft-pack',
    version: 1,
    id: entry.id,
    name: variant.name,
    description: variant.description,
    author: entry.author,
    category: entry.category,
    tags: [...entry.tags],
    siteHints: [...entry.siteHints],
    updatedAt: entry.updatedAt,
    mods: variant.mods.map((m) => ({
      ...m,
      matches: [...m.matches],
      ...(m.targetSelectors ? { targetSelectors: [...m.targetSelectors] } : {}),
    })),
  };
}

/** Encode a CommunityPack into a compact `PCP1:<base64url>` shortcode. */
export function encodePackShortcode(pack: CommunityPack): string {
  const payload: WirePackV1 = {
    v: 1,
    id: slugifyPackId(pack.id || pack.name),
    n: pack.name.trim(),
    ms: pack.mods.slice(0, MAX_PACK_MODS).map((mod, idx) => {
      const wireMod: WirePackModV1 = {
        i: slugifyPackId(mod.id || mod.name, `rule-${idx + 1}`),
        n: mod.name.trim(),
        e: mod.engine,
        m: mod.matches.map((p) => p.trim()).filter(Boolean),
        b: mod.body.trim(),
      };
      if (mod.description?.trim()) wireMod.d = mod.description.trim();
      if (mod.runAt) wireMod.r = mod.runAt;
      if (mod.targetSelectors && mod.targetSelectors.length > 0) {
        wireMod.ts = mod.targetSelectors.map((s) => s.trim()).filter(Boolean);
      }
      if (mod.defaultEnabled === false) wireMod.en = false;
      return wireMod;
    }),
  };

  if (pack.description?.trim()) payload.d = pack.description.trim();
  if (pack.author?.trim()) payload.a = pack.author.trim();
  if (pack.category && VALID_CATEGORIES.has(pack.category)) payload.c = pack.category;
  if (pack.tags && pack.tags.length > 0) payload.tg = pack.tags.slice(0, 8);
  if (pack.siteHints && pack.siteHints.length > 0) payload.sh = pack.siteHints.slice(0, 8);
  if (pack.updatedAt) payload.u = pack.updatedAt;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${PACK_SHORTCODE_PREFIX}${toBase64Url(jsonBytes)}`;
}

function validateAndNormalizePackMods(rawMods: unknown[]): CommunityPackMod[] | null {
  if (!Array.isArray(rawMods) || rawMods.length === 0 || rawMods.length > MAX_PACK_MODS) {
    return null;
  }
  const seenIds = new Set<string>();
  const mods: CommunityPackMod[] = [];

  for (let idx = 0; idx < rawMods.length; idx += 1) {
    const item = rawMods[idx] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') return null;

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const engine = item.engine === 'css' || item.engine === 'js' ? item.engine : null;
    const body = typeof item.body === 'string' ? item.body.trim() : '';
    const rawMatches = Array.isArray(item.matches) ? item.matches : [];
    const matches = rawMatches
      .map((m) => normalizeTampermonkeyPattern(String(m)))
      .filter((m): m is string => Boolean(m));

    if (!name || !engine || !body || matches.length === 0) return null;
    const broad = matches.some((m) => isBroadMatch(m));
    if (validateMatches(matches, broad) !== null) return null;

    const baseModId = slugifyPackId(
      typeof item.id === 'string' && item.id.trim() ? item.id : name,
      `rule-${idx + 1}`,
    );
    let modId = baseModId;
    let suffix = 2;
    while (seenIds.has(modId)) {
      modId = `${baseModId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(modId);

    const runAt: UserScriptRunAt =
      typeof item.runAt === 'string' && VALID_RUN_AT.has(item.runAt as UserScriptRunAt)
        ? (item.runAt as UserScriptRunAt)
        : engine === 'css'
          ? 'document_start'
          : 'document_idle';

    const targetSelectors = Array.isArray(item.targetSelectors)
      ? item.targetSelectors.map((s) => String(s).trim()).filter(Boolean)
      : undefined;

    mods.push({
      id: modId,
      name,
      description: typeof item.description === 'string' ? item.description.trim() : '',
      engine,
      matches,
      body,
      runAt,
      ...(targetSelectors && targetSelectors.length > 0 ? { targetSelectors } : {}),
      ...(item.defaultEnabled === false ? { defaultEnabled: false } : {}),
    });
  }

  return mods;
}

/**
 * Decode a `PCP1:<base64url>` shortcode from raw text, a social post, or a share URL.
 */
export function decodePackShortcode(raw: string): CommunityPack | null {
  if (!raw || typeof raw !== 'string' || raw.length > MAX_PACK_BYTES * 2) return null;

  let candidate = raw;
  if (candidate.includes('PCP1%3A') || candidate.includes('pcp1%3A')) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      /* keep raw */
    }
  }

  const match = PACK_TOKEN_RE.exec(candidate);
  if (!match?.[1]) return null;

  try {
    const bytes = fromBase64Url(match[1]);
    if (bytes.byteLength > MAX_PACK_BYTES) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WirePackV1>;
    if (!parsed || parsed.v !== 1 || typeof parsed.n !== 'string' || !parsed.n.trim()) {
      return null;
    }
    if (!Array.isArray(parsed.ms)) return null;

    const normalizedMods = validateAndNormalizePackMods(
      parsed.ms.map((m) => ({
        id: m?.i,
        name: m?.n,
        description: m?.d ?? '',
        engine: m?.e,
        matches: m?.m,
        body: m?.b,
        runAt: m?.r,
        targetSelectors: m?.ts,
        defaultEnabled: m?.en,
      })),
    );
    if (!normalizedMods) return null;

    return {
      kind: 'pagecraft-pack',
      version: 1,
      id: slugifyPackId(parsed.id || parsed.n),
      name: parsed.n.trim(),
      description: typeof parsed.d === 'string' ? parsed.d.trim() : '',
      author: typeof parsed.a === 'string' && parsed.a.trim() ? parsed.a.trim() : '@community',
      ...(parsed.c && VALID_CATEGORIES.has(parsed.c) ? { category: parsed.c } : {}),
      tags: Array.isArray(parsed.tg)
        ? parsed.tg.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : [],
      siteHints: Array.isArray(parsed.sh)
        ? parsed.sh.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
        : [],
      ...(typeof parsed.u === 'string' ? { updatedAt: parsed.u } : {}),
      mods: normalizedMods,
    };
  } catch {
    return null;
  }
}

export function serializePackJson(pack: CommunityPack): string {
  return `${JSON.stringify(
    {
      kind: 'pagecraft-pack',
      version: 1,
      id: slugifyPackId(pack.id || pack.name),
      name: pack.name.trim(),
      description: pack.description.trim(),
      author: pack.author.trim() || '@community',
      ...(pack.category ? { category: pack.category } : {}),
      tags: pack.tags,
      siteHints: pack.siteHints,
      ...(pack.updatedAt ? { updatedAt: pack.updatedAt } : {}),
      mods: pack.mods,
    },
    null,
    2,
  )}\n`;
}

/** Parse a `.pagecraft-pack.json` manifest string into a validated `CommunityPack`. */
export function parsePackJson(raw: string): CommunityPack | null {
  if (!raw || typeof raw !== 'string' || raw.length > MAX_PACK_BYTES * 2) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.kind !== 'pagecraft-pack' ||
      parsed.version !== 1
    ) {
      return null;
    }
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name || !Array.isArray(parsed.mods)) return null;

    const normalizedMods = validateAndNormalizePackMods(parsed.mods);
    if (!normalizedMods) return null;

    const category =
      typeof parsed.category === 'string' && VALID_CATEGORIES.has(parsed.category as PackCategory)
        ? (parsed.category as PackCategory)
        : undefined;

    return {
      kind: 'pagecraft-pack',
      version: 1,
      id: slugifyPackId(typeof parsed.id === 'string' && parsed.id ? parsed.id : name),
      name,
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
      author:
        typeof parsed.author === 'string' && parsed.author.trim()
          ? parsed.author.trim()
          : '@community',
      ...(category ? { category } : {}),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : [],
      siteHints: Array.isArray(parsed.siteHints)
        ? parsed.siteHints.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
        : [],
      ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
      mods: normalizedMods,
    };
  } catch {
    return null;
  }
}

function extractHostHint(pattern: string): string | null {
  const m = /^(?:\*|https?):\/\/([^/*]+)\//.exec(pattern.trim());
  if (m?.[1] && m[1] !== '*') return m[1].replace(/^\*\./, '').toLowerCase();
  const wildSub = /^(?:\*|https?):\/\/\*\.([^/]+)\//.exec(pattern.trim());
  if (wildSub?.[1]) return wildSub[1].toLowerCase();
  return null;
}

/** Bundle selected `UserScript[]` items into a shareable `CommunityPack`. */
export function buildPackFromUserScripts(
  mods: UserScript[],
  meta: {
    id?: string;
    name: string;
    description?: string;
    author?: string;
    category?: PackCategory;
    tags?: string[];
  },
): CommunityPack {
  const packName = meta.name.trim() || 'PageCraft Pack';
  const packId = slugifyPackId(meta.id || packName);
  const siteHintsSet = new Set<string>();
  const usedIds = new Set<string>();

  const packMods: CommunityPackMod[] = mods.slice(0, MAX_PACK_MODS).map((mod, idx) => {
    for (const pat of mod.matches) {
      const hint = extractHostHint(pat);
      if (hint) siteHintsSet.add(hint);
    }
    const baseModId = slugifyPackId(mod.name, `rule-${idx + 1}`);
    let modId = baseModId;
    let suffix = 2;
    while (usedIds.has(modId)) {
      modId = `${baseModId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(modId);

    const body = (mod.engine === 'css' ? mod.css ?? mod.code : mod.code).trim();
    return {
      id: modId,
      name: mod.name.trim(),
      description: mod.description?.trim() ?? '',
      engine: mod.engine,
      matches: [...mod.matches],
      body,
      runAt: mod.runAt,
      ...(mod.targetSelectors && mod.targetSelectors.length > 0
        ? { targetSelectors: [...mod.targetSelectors] }
        : {}),
    };
  });

  return {
    kind: 'pagecraft-pack',
    version: 1,
    id: packId,
    name: packName,
    description: meta.description?.trim() ?? '',
    author: meta.author?.trim() || '@community',
    ...(meta.category ? { category: meta.category } : {}),
    tags: meta.tags ?? [],
    siteHints: Array.from(siteHintsSet).slice(0, 8),
    updatedAt: new Date().toISOString().slice(0, 10),
    mods: packMods,
  };
}

/**
 * Instantiate selected rules of a `CommunityPack` into `UserScript[]` objects with
 * deterministic IDs (`pack:<packId>:<modId>`) so updates overwrite cleanly in place.
 */
export function instantiatePackMods(
  pack: CommunityPack,
  selectedModIds?: Set<string>,
): UserScript[] {
  const now = Date.now();
  const packId = slugifyPackId(pack.id || pack.name);
  const results: UserScript[] = [];

  for (let idx = 0; idx < pack.mods.length; idx += 1) {
    const item = pack.mods[idx];
    if (!item) continue;
    if (selectedModIds && !selectedModIds.has(item.id)) continue;

    const broad = item.matches.some((m) => isBroadMatch(m));
    const runAt: UserScriptRunAt =
      item.runAt ?? (item.engine === 'css' ? 'document_start' : 'document_idle');

    results.push({
      id: `pack:${packId}:${item.id}`,
      name: item.name,
      description: item.description,
      engine: item.engine,
      matches: [...item.matches],
      code: item.engine === 'js' ? item.body : '',
      css: item.engine === 'css' ? item.body : undefined,
      ...(item.targetSelectors && item.targetSelectors.length > 0
        ? { targetSelectors: [...item.targetSelectors] }
        : {}),
      enabled: item.defaultEnabled !== false,
      source: 'community',
      packId,
      packName: pack.name,
      runAt,
      allowAllUrls: broad,
      createdAt: now + idx,
      updatedAt: now + idx,
    });
  }

  return results;
}

/** Format a copy-pasteable share message containing a `#PCP1:...#` pack shortcode. */
export function formatPackSharePost(
  pack: CommunityPack,
  lang: 'zh' | 'en',
  opts?: { hubUrl?: string; isOfficialCatalogId?: boolean },
): string {
  const hubUrl = opts?.hubUrl ?? DEFAULT_PACK_HUB_URL;
  const token = encodePackShortcode(pack);
  const linkParam = opts?.isOfficialCatalogId ? pack.id : token;
  const url = `${hubUrl}?pack=${encodeURIComponent(linkParam)}`;
  const siteList = pack.siteHints.slice(0, 3).join(', ');

  if (lang === 'zh') {
    return [
      `📦 PageCraft 社区配方包分享：《${pack.name}》（含 ${pack.mods.length} 条规则）`,
      pack.description ? `简介：${pack.description}` : null,
      siteList ? `适用站点：${siteList}` : null,
      `导入方式：复制整段口令，打开 PageCraft「规则库 → 导入」粘贴，或直接点击链接 👇`,
      `#${token}#`,
      `直达链接：${url}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `📦 PageCraft Recipe Pack: "${pack.name}" (${pack.mods.length} rules)`,
    pack.description ? `About: ${pack.description}` : null,
    siteList ? `Sites: ${siteList}` : null,
    `How to install: Copy this message and paste in PageCraft "My mods → Import", or open 👇`,
    `#${token}#`,
    `Link: ${url}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Build a pre-filled GitHub Issue submission URL using `.github/ISSUE_TEMPLATE/community_pack.yml`. */
export function buildGitHubPackSubmissionUrl(pack: CommunityPack): string {
  const packJson = serializePackJson(pack);
  const base = `${GITHUB_REPO_URL}/issues/new`;
  const params = new URLSearchParams({
    template: 'community_pack.yml',
    title: `[Community Pack] ${pack.name}`,
    pack_id: pack.id,
    pack_name: pack.name,
    sites: pack.siteHints.join(', ') || '*',
    description: pack.description || pack.name,
    pack_json: packJson,
  });

  const fullUrl = `${base}?${params.toString()}`;
  if (fullUrl.length <= 7200) {
    return fullUrl;
  }

  // Fallback for large packs so GitHub never rejects URI length with HTTP 414
  params.set(
    'pack_json',
    '// Pack JSON exceeds URL length limit. Please paste the downloaded `.pagecraft-pack.json` file contents here.',
  );
  return `${base}?${params.toString()}`;
}

export type WebHandoffPayload =
  | { kind: 'catalog-pack'; packId: string }
  | { kind: 'inline-pack'; pack: CommunityPack }
  | { kind: 'single-recipe'; shortcode: string };

const TRUSTED_WEB_HOSTS = new Set(['pagecraft.shenxin.space', 'localhost', '127.0.0.1']);

/**
 * Inspect `activeTab.url` (zero-permission handoff) to detect shared packs or recipes
 * only on trusted PageCraft origins (`pagecraft.shenxin.space` or localhost dev).
 */
export function extractWebHandoffPayload(tabUrl: string | undefined | null): WebHandoffPayload | null {
  if (!tabUrl || typeof tabUrl !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(tabUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!TRUSTED_WEB_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const packParam = parsed.searchParams.get('pack')?.trim();
  if (packParam) {
    if (packParam.startsWith(PACK_SHORTCODE_PREFIX) || packParam.toUpperCase().startsWith('PCP1:')) {
      const decoded = decodePackShortcode(packParam);
      if (decoded) return { kind: 'inline-pack', pack: decoded };
      return null;
    }
    if (/^[a-z0-9_-]{2,48}$/i.test(packParam)) {
      return { kind: 'catalog-pack', packId: packParam.toLowerCase() };
    }
  }

  const recipeParam = parsed.searchParams.get('recipe')?.trim();
  if (recipeParam && decodeRecipeShortcode(recipeParam)) {
    return { kind: 'single-recipe', shortcode: recipeParam };
  }

  return null;
}
