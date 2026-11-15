import { useId, useState, type CSSProperties } from 'react';
import { cn } from '~/lib/utils';

/**
 * Canonical inline SVG string for the PageCraft brand mark:
 * Warm terracotta squircle (#C95533 -> #9E3619) with a warm paper (#FAF8F5)
 * browser/page frame, centered layout block, and top-right 4-point craft spark.
 */
export const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><defs><linearGradient id="pcg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C95533"/><stop offset="100%" stop-color="#9E3619"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#pcg)"/><path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/><rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/><path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/></svg>`;

/**
 * URL-safe inline SVG data URI for static HTML favicons & headers.
 */
export const BRAND_ICON_SVG_DATA_URI = `data:image/svg+xml,${encodeURIComponent(BRAND_ICON_SVG)
  .replace(/'/g, '%27')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29')}`;

/** Alias kept for callers importing `BRAND_LOGO_SVG_DATA_URI`. */
export const BRAND_LOGO_SVG_DATA_URI = BRAND_ICON_SVG_DATA_URI;

/**
 * Resolves the packaged 128x128 brand PNG across extension pages and dev server.
 */
export function resolveBrandIconUrl(): string {
  try {
    if (typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function') {
      return chrome.runtime.getURL('/icon/128.png');
    }
  } catch {
    /* non-extension environment */
  }
  return './icon/128.png';
}

export interface BrandLogoProps {
  /** Pixel width & height of the square brand mark (default: 24). */
  size?: number;
  /** Optional accessible label; empty string marks the icon as decorative. */
  alt?: string;
  /** Render mode: `'auto'` uses `/icon/128.png` with automatic vector SVG fallback. */
  variant?: 'auto' | 'svg';
  className?: string;
  style?: CSSProperties;
}

function BrandLogoVector({
  size,
  alt,
  className,
  style,
}: {
  size: number;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const uid = useId().replace(/:/g, '');
  const gradId = `pc-brand-grad-${uid}`;
  const decorative = alt.length === 0;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      fill="none"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative ? true : undefined}
      className={cn('inline-block shrink-0 select-none', className)}
      style={{ width: size, height: size, ...style }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C95533" />
          <stop offset="100%" stopColor="#9E3619" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill={`url(#${gradId})`} />
      <path
        fill="#FAF8F5"
        d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"
      />
      <rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5" />
      <path
        fill="#FAF8F5"
        d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"
      />
    </svg>
  );
}

export function BrandLogo({
  size = 24,
  alt = '',
  variant = 'auto',
  className,
  style,
}: BrandLogoProps) {
  const [fallbackStage, setFallbackStage] = useState<'primary' | 'root' | 'svg'>('primary');

  if (variant === 'svg' || fallbackStage === 'svg') {
    return <BrandLogoVector size={size} alt={alt} className={className} style={style} />;
  }

  const src = fallbackStage === 'primary' ? resolveBrandIconUrl() : '/icon/128.png';
  const decorative = alt.length === 0;
  const radius = Math.max(4, Math.round(size * 0.22 * 10) / 10);

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      aria-hidden={decorative ? true : undefined}
      draggable={false}
      onError={() => {
        if (fallbackStage === 'primary' && src !== '/icon/128.png') {
          setFallbackStage('root');
        } else {
          setFallbackStage('svg');
        }
      }}
      className={cn('inline-block shrink-0 select-none object-contain', className)}
      style={{
        width: size,
        height: size,
        borderRadius: `${radius}px`,
        ...style,
      }}
    />
  );
}

export default BrandLogo;
