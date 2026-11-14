/**
 * Zero-credit CSS quick-tweak helpers for PageCraft Studio.
 *
 * Allows adjusting font size, reading column width, and background warmth
 * directly on any CSS mod without consuming AI generation credits.
 */

export type CssTweakKind = 'fontSize' | 'maxWidth' | 'warmth';

export interface CssTweakValues {
  fontSize: number | null;
  maxWidth: number | null;
  warmth: number;
}

export const CSS_TWEAK_LIMITS = {
  fontSize: { min: 12, max: 32, step: 1, fallback: 16 },
  maxWidth: { min: 560, max: 1600, step: 20, fallback: 900 },
  warmth: { min: 0, max: 100, step: 5, fallback: 0 },
} as const;

const FONT_SIZE_PX_RE = /\b(font-size\s*:\s*)(\d+(?:\.\d+)?)(px\b)/i;
const FONT_SIZE_PX_GLOBAL_RE = /\b(font-size\s*:\s*)(\d+(?:\.\d+)?)(px\b)/gi;
const MAX_WIDTH_PX_RE = /\b(max-width\s*:\s*)(\d+(?:\.\d+)?)(px\b)/i;
const MAX_WIDTH_PX_GLOBAL_RE = /\b(max-width\s*:\s*)(\d+(?:\.\d+)?)(px\b)/gi;
const WARMTH_MARKER_RE = /\/\*\s*pc-tweak:warmth=(\d+)\s*\*\//i;

const TWEAK_BLOCK_PATTERNS: Record<CssTweakKind, RegExp> = {
  fontSize: /\n*\/\*\s*pc-tweak:font-size\s*\*\/[\s\S]*?\/\*\s*\/pc-tweak:font-size\s*\*\//gi,
  maxWidth: /\n*\/\*\s*pc-tweak:max-width\s*\*\/[\s\S]*?\/\*\s*\/pc-tweak:max-width\s*\*\//gi,
  warmth: /\n*\/\*\s*pc-tweak:warmth=\d+\s*\*\/[\s\S]*?\/\*\s*\/pc-tweak:warmth\s*\*\//gi,
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function appendTweakBlock(css: string, block: string): string {
  const trimmed = css.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/**
 * Extracts current font-size, max-width, and warmth values from a CSS stylesheet.
 */
export function readCssTweaks(css: string): CssTweakValues {
  const fontMatch = FONT_SIZE_PX_RE.exec(css);
  const widthMatch = MAX_WIDTH_PX_RE.exec(css);
  const warmthMatch = WARMTH_MARKER_RE.exec(css);

  const fontSize = fontMatch?.[2]
    ? clampNumber(
        parseFloat(fontMatch[2]),
        CSS_TWEAK_LIMITS.fontSize.min,
        CSS_TWEAK_LIMITS.fontSize.max,
      )
    : null;

  const maxWidth = widthMatch?.[2]
    ? clampNumber(
        parseFloat(widthMatch[2]),
        CSS_TWEAK_LIMITS.maxWidth.min,
        CSS_TWEAK_LIMITS.maxWidth.max,
      )
    : null;

  const warmth = warmthMatch?.[1]
    ? clampNumber(
        parseInt(warmthMatch[1], 10),
        CSS_TWEAK_LIMITS.warmth.min,
        CSS_TWEAK_LIMITS.warmth.max,
      )
    : 0;

  return { fontSize, maxWidth, warmth };
}

/**
 * Applies a slider tweak (fontSize, maxWidth, or warmth) to a CSS stylesheet.
 * Updates existing px declarations in place when present, or appends a marked
 * tweak block so any CSS mod can be fine-tuned without AI calls.
 */
export function applyCssTweak(
  css: string,
  kind: CssTweakKind,
  value: number,
  targetSelectors?: string[],
): string {
  if (kind === 'warmth') {
    const pct = clampNumber(value, CSS_TWEAK_LIMITS.warmth.min, CSS_TWEAK_LIMITS.warmth.max);
    const stripped = css.replace(TWEAK_BLOCK_PATTERNS.warmth, '').trimEnd();
    if (pct <= 0) {
      return stripped ? `${stripped}\n` : '';
    }
    const sepia = (pct * 0.0045).toFixed(3);
    const brightness = (1 - pct * 0.0008).toFixed(3);
    const block = [
      `/* pc-tweak:warmth=${pct} */`,
      `html { filter: sepia(${sepia}) brightness(${brightness}) !important; }`,
      `/* /pc-tweak:warmth */`,
    ].join('\n');
    return appendTweakBlock(stripped, block);
  }

  if (kind === 'fontSize') {
    const px = clampNumber(value, CSS_TWEAK_LIMITS.fontSize.min, CSS_TWEAK_LIMITS.fontSize.max);
    if (FONT_SIZE_PX_RE.test(css)) {
      return css.replace(FONT_SIZE_PX_GLOBAL_RE, (_full, prefix: string, _num: string, unit: string) => {
        return `${prefix}${px}${unit}`;
      });
    }
    const scope = targetSelectors?.find((s) => s.trim().length > 0)?.trim() || 'article, main, p';
    const stripped = css.replace(TWEAK_BLOCK_PATTERNS.fontSize, '').trimEnd();
    const block = [
      `/* pc-tweak:font-size */`,
      `${scope} { font-size: ${px}px !important; }`,
      `/* /pc-tweak:font-size */`,
    ].join('\n');
    return appendTweakBlock(stripped, block);
  }

  const px = clampNumber(value, CSS_TWEAK_LIMITS.maxWidth.min, CSS_TWEAK_LIMITS.maxWidth.max);
  if (MAX_WIDTH_PX_RE.test(css)) {
    return css.replace(MAX_WIDTH_PX_GLOBAL_RE, (_full, prefix: string, _num: string, unit: string) => {
      return `${prefix}${px}${unit}`;
    });
  }
  const scope =
    targetSelectors?.find((s) => s.trim().length > 0)?.trim() || 'main, article, .container, #main';
  const stripped = css.replace(TWEAK_BLOCK_PATTERNS.maxWidth, '').trimEnd();
  const block = [
    `/* pc-tweak:max-width */`,
    `${scope} { max-width: ${px}px !important; margin-inline: auto !important; }`,
    `/* /pc-tweak:max-width */`,
  ].join('\n');
  return appendTweakBlock(stripped, block);
}

/**
 * Removes all appended `pc-tweak:*` helper blocks from a CSS stylesheet.
 */
export function resetCssTweaks(css: string): string {
  const cleaned = css
    .replace(TWEAK_BLOCK_PATTERNS.fontSize, '')
    .replace(TWEAK_BLOCK_PATTERNS.maxWidth, '')
    .replace(TWEAK_BLOCK_PATTERNS.warmth, '')
    .trimEnd();
  return cleaned ? `${cleaned}\n` : '';
}
