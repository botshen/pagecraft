/**
 * Pure, testable CSS-selector & DOM-skeleton utilities for PageCraft's
 * Element Picker.
 *
 * Filters out ephemeral CSS-in-JS hashes (e.g. `css-1abc2de`, `sc-bdnxRM`,
 * `svelte-123abc`) and arbitrary utility classes containing unescaped colons or
 * brackets when building candidate selectors, preferring semantic IDs,
 * `data-testid` / `data-*`, ARIA roles, and clean class names.
 */

const EPHEMERAL_ID_RE =
  /^(?:react-.*|radix-.*|headlessui-.*|:r[0-9a-z]+:|ember\d+|mui-\d+|\d+|[0-9a-f]{12,})$/i;

const HASHED_CLASS_RE =
  /^(?:css-[0-9a-z]{5,}|sc-[a-zA-Z0-9]{5,}|svelte-[0-9a-z]{4,}|jsx-\d+|_[a-zA-Z0-9]{5,}_[a-zA-Z0-9]{4,}|style_[a-zA-Z0-9]+__[a-zA-Z0-9]{4,})$/;

/** Tailwind state/arbitrary tokens or invalid unescaped identifier chars. */
const SIMPLE_CLASS_RE = /^[a-zA-Z_-][a-zA-Z0-9_-]{1,39}$/;

const UTILITY_NOISE_CLASSES = new Set([
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'hidden',
  'relative', 'absolute', 'fixed', 'sticky', 'w-full', 'h-full', 'mx-auto',
  'items-center', 'justify-between', 'justify-center', 'overflow-hidden',
  'pointer-events-none', 'cursor-pointer', 'transition', 'active', 'hover',
  'selected', 'open', 'focus', 'disabled',
]);

export function isStableId(id: string | null | undefined): id is string {
  if (!id) return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(trimmed)) return false;
  return !EPHEMERAL_ID_RE.test(trimmed);
}

export function filterSemanticClasses(rawClassName: string | null | undefined): string[] {
  if (!rawClassName) return [];
  const tokens = rawClassName.split(/\s+/).map((c) => c.trim()).filter(Boolean);
  const semantic: string[] = [];
  for (const c of tokens) {
    if (!SIMPLE_CLASS_RE.test(c)) continue;
    if (HASHED_CLASS_RE.test(c)) continue;
    if (UTILITY_NOISE_CLASSES.has(c)) continue;
    semantic.push(c);
    if (semantic.length >= 2) break;
  }
  return semantic;
}

export interface SelectorNodeLike {
  tagName: string;
  id?: string | null;
  className?: string | null;
  attributes?: Record<string, string | null | undefined>;
  nthOfType?: number | null;
  parent?: SelectorNodeLike | null;
}

const STABLE_DATA_ATTRS = [
  'data-testid',
  'data-test',
  'data-qa',
  'data-id',
  'data-component',
  'data-section',
  'data-role',
];

function escapeAttrValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Build a clean single-node selector segment without ancestor context. */
export function buildNodeSegment(node: SelectorNodeLike, includeNth = true): string {
  const tag = (node.tagName || 'div').toLowerCase();
  if (isStableId(node.id)) {
    return `#${node.id}`;
  }

  const attrs = node.attributes ?? {};
  for (const attr of STABLE_DATA_ATTRS) {
    const val = attrs[attr]?.trim();
    if (val && val.length <= 48 && !/\d{7,}/.test(val)) {
      return `${tag}[${attr}="${escapeAttrValue(val)}"]`;
    }
  }

  const classes = filterSemanticClasses(node.className);
  if (classes.length > 0) {
    const base = `${tag}.${classes.join('.')}`;
    return includeNth && node.nthOfType && node.nthOfType > 1
      ? `${base}:nth-of-type(${node.nthOfType})`
      : base;
  }

  const role = attrs.role?.trim();
  if (role && /^[a-z-]{2,24}$/i.test(role)) {
    const base = `${tag}[role="${role.toLowerCase()}"]`;
    return includeNth && node.nthOfType && node.nthOfType > 1
      ? `${base}:nth-of-type(${node.nthOfType})`
      : base;
  }

  return includeNth && node.nthOfType && node.nthOfType > 1
    ? `${tag}:nth-of-type(${node.nthOfType})`
    : tag;
}

/**
 * Build a concise, human-readable CSS selector path up to 4 levels deep,
 * stopping early as soon as a stable `#id` or `[data-testid]` anchor is hit.
 */
export function buildSelectorFromChain(leaf: SelectorNodeLike, maxDepth = 4): string {
  const segments: string[] = [];
  let cur: SelectorNodeLike | null | undefined = leaf;
  let depth = 0;

  while (cur && depth < maxDepth) {
    const tag = (cur.tagName || '').toLowerCase();
    if (!tag || tag === 'html' || tag === 'body') break;

    const seg = buildNodeSegment(cur, true);
    segments.unshift(seg);

    if (seg.startsWith('#') || seg.includes('[data-testid=')) {
      break;
    }
    cur = cur.parent;
    depth++;
  }

  return segments.join(' > ') || (leaf.tagName || 'div').toLowerCase();
}
