# Contributing to PageCraft

Welcome, and thank you for your interest in contributing to **PageCraft**! Whether you are sharing a 1-click website CSS/JS recipe, improving the visual Element Picker, adding AI provider support, or fixing a bug, this guide walks you through everything you need to get productive quickly.

---

## Architecture Overview

PageCraft is a **WXT + React 19 + TypeScript + Tailwind CSS v4** Manifest V3 browser extension paired with an optional, self-hostable Cloudflare Worker backend.

```text
pagecraft/
├── entrypoints/                 # Browser extension entrypoints (WXT)
│   ├── background/              # MV3 service worker: dual-engine CSS/JS sync & on-demand DOM context
│   ├── sidepanel/               # React 19 studio UI: prompt composer, CSS sliders, recipe gallery, settings
│   ├── welcome/                 # Interactive onboarding & live zero-setup CSS playground
│   └── probe/                   # Lightweight runtime capability probe
├── lib/
│   ├── picker/                  # Shadow-DOM visual Element Picker & resilient CSS selector generator
│   ├── userscripts/             # Core mod runtime & utilities
│   │   ├── templates.ts         # Built-in 1-click website recipe library ("热门同款一键改造")
│   │   ├── css-tweaks.ts        # Zero-credit live CSS property parser & quick sliders
│   │   ├── share.ts             # #PC1:...# shareable recipe shortcode encoder/decoder
│   │   ├── gm-shim.ts           # Safe, local-only GM_* compatibility prelude (zero @require)
│   │   ├── matcher.ts           # @match pattern parser & URL matcher
│   │   ├── store.ts             # chrome.storage.local persistence & @match validation
│   │   └── types.ts             # Shared mod & generation TypeScript interfaces
│   ├── shared/                  # Client-side PII redaction (privacy.ts), AI endpoints, locale & settings
│   └── api/                     # HMAC-signed Cloud Trial & coarse feedback client
├── tests/core/                  # Fast Node native TypeScript unit tests
└── workers/cloud/               # Optional Cloudflare Worker + D1 backend (Cloud Trial & landing pages)
```

---

## Local Development Setup

### Prerequisites

- **Node.js `>= 22.6.0`** (Node **24 LTS** recommended — unit tests use Node's built-in `--experimental-strip-types` runner)
- **pnpm `10+`** (`corepack enable` or `npm install -g pnpm`)
- A Chromium-based browser (**Chrome 120+** / **Edge 120+**; Chrome **138+** provides the streamlined per-extension *Allow User Scripts* toggle) or Firefox

### 1. Install Dependencies & Start Dev Mode

```bash
pnpm install
pnpm dev
```

- `pnpm install` automatically runs `wxt prepare` (`postinstall`) to generate `.wxt/` TypeScript definitions.
- `pnpm dev` compiles the extension in watch mode and writes the unpacked Manifest V3 bundle to **`.output/chrome-mv3-dev`**.

### 2. Load `.output/chrome-mv3-dev` in Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** ON in the top-right corner.
3. Click **Load unpacked** and select the `.output/chrome-mv3-dev` folder inside this repository.
4. Click the PageCraft toolbar icon to open the Side Panel studio on any `http://` or `https://` webpage.
5. *(For testing `engine: 'js'` userscripts on Chrome 138+)* Open PageCraft's **Details** page on `chrome://extensions` and toggle **Allow User Scripts** ON.
   > **Tip:** Pure CSS mods (`engine: 'css'`) use `chrome.scripting.insertCSS` and work immediately with **zero** extra toggles!

For Firefox development, run `pnpm dev:firefox` (or `pnpm build:firefox`). To self-host or work on the optional Cloud Trial backend, see [`workers/cloud/README.md`](./workers/cloud/README.md).

---

## Verification Commands

Before opening a pull request, run all three checks from the repository root and confirm zero errors:

```bash
# 1. TypeScript strict type-checking across extension & libraries
pnpm compile

# 2. Core unit test suite (matcher, privacy redaction, selector builder, shortcodes, gm-shim, etc.)
pnpm test

# 3. Production Manifest V3 extension build (.output/chrome-mv3)
pnpm build
```

If your changes touch `workers/cloud/`, also verify the Worker package:

```bash
pnpm --dir workers/cloud install
pnpm --dir workers/cloud typecheck
pnpm --dir workers/cloud test
```

---

## Contributing a Built-In Website Recipe (`lib/userscripts/templates.ts`)

One of the highest-impact ways to contribute to PageCraft is adding a polished 1-click recipe to [`lib/userscripts/templates.ts`](./lib/userscripts/templates.ts)! Built-in recipes appear in the Side Panel gallery—and site-specific recipes automatically surface at the top when a user visits a matching domain.

### Step 1: Choose the Right Engine (`css` vs. `js`)

- **Prefer `engine: 'css'` (`runAt: 'document_start'`) whenever possible!**
  - Use `css` for hiding distracting sidebars/feeds/banners, widening article containers, typography/dark-mode adjustments, and print/focus layouts.
  - **Why:** CSS recipes apply in `<0.1s` with zero flash of unstyled content, toggle ON/OFF live without reloading the tab, and work on brand-new installs without requiring the user to enable `Allow User Scripts`.
- **Use `engine: 'js'` (`runAt: 'document_idle'`) only when runtime DOM logic is required.**
  - Examples: exporting HTML `<table>` data to CSV, injecting interactive "Copy Code" buttons, rewriting redirect links, or observing SPA DOM mutations.
  - Always wrap JS recipes in an idempotent IIFE guarded by a `window.__pc...` flag so re-running never duplicates event listeners or buttons.

### Step 2: Choose Scope (`current_site` vs. `fixed_site`)

- `scope: 'current_site'` — Universal recipes (e.g., Widescreen Reader, Table to CSV, Copy Code Button) that bind their `@match` pattern to whichever host the user is currently viewing when they click Apply.
- `scope: 'fixed_site'` — Site-specific recipes (e.g., Bilibili, Zhihu, Xiaohongshu, GitHub, Hacker News, YouTube, Reddit). Provide:
  - `fixedMatches`: Explicit match patterns such as `['https://*.example.com/*']` (never `<all_urls>`).
  - `siteHints`: Host substrings such as `['example.com']` so PageCraft highlights the recipe automatically when the user opens that site.

### Step 3: Follow Selector Stability & Zero-Remote-Code Rules

1. **Resilient Selectors**:
   - **Avoid** compiler-generated hash classes (`.css-1dbjc4n`, `.sc-9f8a7b`, `.jsx-12345`) that break on the target site's next deploy.
   - **Prefer** semantic HTML landmarks (`main`, `article`, `aside`, `nav`), ARIA attributes (`[role="main"]`, `[role="complementary"]`, `:not([role="dialog"])`), `data-testid` hooks, or stable component class prefixes (`[class*="sidebar" i]:not(main *)`).
   - Always test that modals, login dialogs, and core navigation remain usable!
2. **Zero Remote Code (Strict)**:
   - Every recipe must be **100% self-contained**.
   - **Never** reference external `<script>` URLs, `@import` remote stylesheets, external fonts/icons, `@require` headers, `eval()`, `new Function()`, or outbound `fetch()` calls to third-party servers.
3. **Bilingual Metadata (`zh` & `en`)**:
   - Include concise, user-friendly `name`, `description`, and `tag` strings in both `zh` and `en` so the UI renders natively in both languages.

### Step 4: Add Your Recipe Entry

Add your `TemplateRecipe` object to `BUILTIN_TEMPLATES` in `lib/userscripts/templates.ts`:

```ts
{
  id: 'tpl-hn-modern-reader',
  engine: 'css',
  category: 'clean', // 'clean' | 'extract' | 'focus' | 'unlock'
  scope: 'fixed_site',
  fixedMatches: ['https://news.ycombinator.com/*'],
  siteHints: ['news.ycombinator.com'],
  runAt: 'document_start',
  zh: {
    name: 'Hacker News 舒适阅读排版',
    description: '居中正文宽度、放大字号行距，弱化次要元数据干扰',
    tag: 'HN 专享 · 秒生效',
  },
  en: {
    name: 'Hacker News Clean Typography',
    description: 'Center layout width and improve font size & line spacing for long comment threads',
    tag: 'HN · Instant CSS',
  },
  css: `/* PageCraft: Hacker News Clean Typography */
#hnmain {
  max-width: 860px !important;
  margin: 12px auto !important;
}
.commtext {
  font-size: 15px !important;
  line-height: 1.65 !important;
}`,
}
```

### Step 5: Test Locally & Submit

1. Run `pnpm compile && pnpm test` to verify types, unique template IDs, and `@match` validity.
2. Load `.output/chrome-mv3-dev` (`pnpm dev`), open the target website, apply your recipe from the Side Panel, and verify toggling ON and OFF cleanly restores the page.
3. Open a Pull Request with before/after screenshots!

---

## Privacy & Manifest V3 Security Principles

Every contribution to PageCraft must uphold our security and privacy guarantees (see [`SECURITY.md`](./SECURITY.md) for full details):

- **Zero Background Telemetry**: Never add passive content scripts, analytics SDKs, or background tab URL listeners that collect browsing activity.
- **Client-Side PII Redaction**: Any new page-context field sent to an LLM **must** pass through `redactSensitiveText()` / `sanitizePageUrl()` in `lib/shared/privacy.ts` and have corresponding unit tests in `tests/core/`.
- **Strict MV3 & Sandbox Boundaries**:
  - Never weaken `content_security_policy` in `wxt.config.ts` or `configureWorld({ csp: "script-src 'self'", messaging: false })` in `entrypoints/background/userscripts.ts`.
  - Keep `messaging: false` in the `USER_SCRIPT` world so untrusted userscripts cannot message the privileged extension runtime.
  - Enforce `https:` for all remote AI/API endpoints; `http:` is permitted **strictly** for local loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) for local inference tools like Ollama and LM Studio.
- **No Secrets or Personal Identifiers**: Never commit API keys, `.env` / `.dev.vars` files, real Cloudflare resource IDs, or machine-specific paths.

---

## Pull Request Checklist

- [ ] Focused, atomic branch from `main` (e.g., `feat/recipe-hn-reader` or `fix/picker-shadow-dom`)
- [ ] `pnpm compile`, `pnpm test`, and `pnpm build` pass with zero errors
- [ ] Unit tests added in `tests/core/` for new logic or edge cases
- [ ] Follows our [Code of Conduct](./CODE_OF_CONDUCT.md)
