/**
 * Canonical PageCraft Brand Identity Assets for Cloud Worker Pages & Social Previews.
 *
 * Geometry matches `public/icon/128.png` and `BrandLogo.tsx`:
 * - Warm terracotta-vermilion squircle (#C95533 -> #A63C20)
 * - Warm cream (#FAF8F5) rounded webpage frame with solid header bar,
 *   centered layout block, and top-right 4-point craft spark.
 */

export function renderBrandIconSvg(size = 28, gradId = 'pcg', className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128" fill="none" aria-hidden="true"${cls}><defs><linearGradient id="${gradId}" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C95533"/><stop offset="100%" stop-color="#A63C20"/></linearGradient></defs><rect width="128" height="128" rx="28.5" fill="url(#${gradId})"/><path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/><rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/><path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/></svg>`;
}

/** Standalone 128x128 brand mark SVG served at `GET /icon.svg`. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none"><defs><linearGradient id="pcg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#C95533"/><stop offset="100%" stop-color="#A63C20"/></linearGradient></defs><rect width="128" height="128" rx="28.5" fill="url(#pcg)"/><path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/><rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/><path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/></svg>`;

/** URL-safe inline SVG data URI for HTML `<link rel="icon">`. */
export const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)
  .replace(/'/g, '%27')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29')}`;

/**
 * 1200x630 Editorial OpenGraph / Twitter Social Preview Card (`GET /og.svg`).
 */
export const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <defs>
    <linearGradient id="og-brand" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#C95533"/>
      <stop offset="100%" stop-color="#A63C20"/>
    </linearGradient>
    <radialGradient id="og-glow" cx="0.82" cy="0.18" r="0.65">
      <stop offset="0%" stop-color="#C95533" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#FAF8F5" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="#FAF8F5"/>
  <rect width="1200" height="630" fill="url(#og-glow)"/>
  <rect x="32" y="32" width="1136" height="566" rx="28" fill="none" stroke="#E7E2D8" stroke-width="2"/>

  <!-- Left Column: Brand + Editorial Copy -->
  <g transform="translate(82, 86)">
    <g transform="scale(0.5)">
      <rect width="128" height="128" rx="28.5" fill="url(#og-brand)"/>
      <path fill="#FAF8F5" d="M35 31.5h53.8L70 38.5l18.8 6.8 1.1 2.2H32.5V87a2.8 2.8 0 0 0 2.8 2.8h57.4A2.8 2.8 0 0 0 95.5 87V59.6l6.5-15V87a9 9 0 0 1-9 9H35a9 9 0 0 1-9-9V40.5a9 9 0 0 1 9-9Z"/>
      <rect x="44.5" y="66" width="39" height="5.8" rx="1.2" fill="#FAF8F5"/>
      <path fill="#FAF8F5" d="M95 22.2c1.5 9.6 3.5 13.3 16.2 16.3-12.7 3-14.7 6.7-16.2 16.3-1.5-9.6-3.5-13.3-16.2-16.3 12.7-3 14.7-6.7 16.2-16.3Z"/>
    </g>
    <text x="82" y="42" fill="#1C1917" font-family="Georgia, 'Songti SC', serif" font-size="32" font-weight="700">PageCraft</text>
    <rect x="256" y="16" width="218" height="34" rx="17" fill="#EAF5EE" stroke="#BBDCCB"/>
    <text x="365" y="38" text-anchor="middle" fill="#15803D" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="14" font-weight="600">Zero Tracking · Local-First</text>
  </g>

  <text x="82" y="242" fill="#1C1917" font-family="Georgia, 'Songti SC', serif" font-size="52" font-weight="700" letter-spacing="-1">Point &amp; Reshape</text>
  <text x="82" y="306" fill="#1C1917" font-family="Georgia, 'Songti SC', serif" font-size="52" font-weight="700" letter-spacing="-1">Any Webpage.</text>
  <text x="82" y="366" fill="#C95533" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="28" font-weight="600">鼠标指哪改哪 · 一句话永久改造任何网页</text>
  <text x="82" y="420" fill="#57534E" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="20">0.1s Instant CSS · Isolated Userscripts · 1-Click .user.js Export</text>

  <!-- Feature Pills -->
  <g transform="translate(82, 488)">
    <rect x="0" y="0" width="186" height="44" rx="22" fill="#FFFFFF" stroke="#D6CFC2"/>
    <text x="93" y="28" text-anchor="middle" fill="#1C1917" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="15" font-weight="600">10 Built-In Recipes</text>

    <rect x="200" y="0" width="206" height="44" rx="22" fill="#FFFFFF" stroke="#D6CFC2"/>
    <text x="303" y="28" text-anchor="middle" fill="#1C1917" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="15" font-weight="600">10 Free Credits + BYOK</text>

    <rect x="420" y="0" width="236" height="44" rx="22" fill="#1C1917"/>
    <text x="538" y="28" text-anchor="middle" fill="#FAF8F5" font-family="ui-monospace, Menlo, monospace" font-size="15" font-weight="600">pagecraft.shenxin.space</text>
  </g>

  <!-- Right Column: Stylized Studio Preview Card -->
  <g transform="translate(748, 102)">
    <rect x="0" y="0" width="376" height="426" rx="22" fill="#FFFFFF" stroke="#D6CFC2" stroke-width="2"/>
    <rect x="0" y="0" width="376" height="48" rx="22" fill="#F3EFE8"/>
    <rect x="0" y="26" width="376" height="22" fill="#F3EFE8"/>
    <circle cx="26" cy="24" r="5.5" fill="#D6CFC2"/>
    <circle cx="44" cy="24" r="5.5" fill="#D6CFC2"/>
    <circle cx="62" cy="24" r="5.5" fill="#D6CFC2"/>
    <rect x="250" y="12" width="108" height="24" rx="12" fill="#FAECE7" stroke="#E8B4A4"/>
    <text x="304" y="28" text-anchor="middle" fill="#C95533" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="700">PageCraft</text>

    <!-- Picked Target Frame -->
    <rect x="24" y="72" width="328" height="128" rx="14" fill="#FCFAF7" stroke="#C95533" stroke-width="2" stroke-dasharray="6 4"/>
    <rect x="38" y="86" width="184" height="24" rx="6" fill="#C95533"/>
    <text x="130" y="102" text-anchor="middle" fill="#FAF8F5" font-family="ui-monospace, Menlo, monospace" font-size="12" font-weight="600">table.order-grid · 128 tr</text>
    <rect x="38" y="124" width="210" height="12" rx="6" fill="#E7E2D8"/>
    <rect x="38" y="146" width="164" height="12" rx="6" fill="#E7E2D8"/>
    <rect x="236" y="156" width="102" height="28" rx="7" fill="#C95533"/>
    <text x="287" y="174" text-anchor="middle" fill="#FAF8F5" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="600">Export CSV</text>

    <!-- Result Card -->
    <rect x="24" y="222" width="328" height="176" rx="14" fill="#FAF8F5" stroke="#E7E2D8"/>
    <rect x="42" y="242" width="114" height="24" rx="12" fill="#EAF5EE" stroke="#BBDCCB"/>
    <text x="99" y="258" text-anchor="middle" fill="#15803D" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="600">CSS · 0.1s Live</text>
    <rect x="166" y="242" width="118" height="24" rx="12" fill="#FAECE7" stroke="#E8B4A4"/>
    <text x="225" y="258" text-anchor="middle" fill="#C95533" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="600">JS · .user.js</text>

    <text x="42" y="298" fill="#1C1917" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="16" font-weight="700">✓ Matched live target element</text>
    <text x="42" y="324" fill="#78716C" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="13">Instant preview · Tampermonkey compatible</text>

    <rect x="42" y="346" width="292" height="34" rx="9" fill="#C95533"/>
    <text x="188" y="368" text-anchor="middle" fill="#FAF8F5" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13.5" font-weight="700">✓ Applied &amp; Saved Locally</text>
  </g>
</svg>`;
