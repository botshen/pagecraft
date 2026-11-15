# Contributing to PageCraft

Welcome, and thank you for your interest in contributing to **PageCraft**! Whether you are sharing a 1-click website CSS/JS recipe, improving the visual Element Picker and Closed-Loop Auto-Heal runtime, extending the `pagecraft-mcp` local coding agent bridge, or fixing a bug, this guide walks you through everything you need to get productive quickly.

---

## Architecture Overview

PageCraft is a **100% client-side, zero-backend, zero-telemetry** live webpage customizer and browser micro-agent runtime built with **WXT + React 19 + TypeScript + Tailwind CSS v4** (Manifest V3), paired with a local stdio-to-loopback MCP bridge (`packages/mcp`) and a pure static website (`site/`, hosted on Cloudflare Pages).

**Zero PageCraft servers, zero accounts, zero telemetry/feedback pings.** Contributors can develop and test using any of PageCraft's **4 local/user-owned compute options**:

1. **Chrome Built-in AI (Gemini Nano on-device)** — zero-config offline `LanguageModel` inside Chrome.
2. **Offline Local AI (Ollama / LM Studio)** — local loopback inference (`OLLAMA_ORIGINS="chrome-extension://*" ollama serve`).
3. **Direct BYOK** — direct browser-to-provider HTTPS (OpenAI, Anthropic, DeepSeek, OpenRouter).
4. **Local Coding Agent Bridge (`pagecraft-mcp` over `127.0.0.1`)** — connects Claude Code, Cursor, or Codex CLI directly to the live browser DOM and Dual-Engine runtime over `ws://127.0.0.1:17321`.

```text
pagecraft/
├── entrypoints/                 # Browser extension entrypoints (WXT)
│   ├── background/              # MV3 service worker: dual-engine CSS/JS sync, Vision, Auto-Heal & MCP hooks
│   ├── sidepanel/               # React 19 studio UI: prompt composer, CSS sliders, recipe gallery, settings
│   ├── welcome/                 # Interactive onboarding & live zero-setup CSS playground
│   └── probe/                   # Lightweight runtime capability probe
├── lib/
│   ├── picker/                  # Shadow-DOM visual Element Picker & resilient CSS selector generator
│   ├── userscripts/             # Core mod runtime & utilities
│   │   ├── templates.ts         # Built-in 1-click website recipe library ("热门同款一键改造")
│   │   ├── css-tweaks.ts        # Instant live CSS property parser & quick sliders
│   │   ├── playground.ts        # Deterministic zero-network CSS sandbox rules for /playground
│   │   ├── share.ts             # #PC1:...# shareable recipe shortcode encoder/decoder
│   │   ├── gm-shim.ts           # Safe, local-only GM_* compatibility prelude (zero @require)
│   │   ├── matcher.ts           # @match pattern parser & URL matcher
│   │   ├── store.ts             # chrome.storage.local persistence & @match validation
│   │   └── types.ts             # Shared mod & generation TypeScript interfaces
│   ├── mcp/                     # Loopback WebSocket bridge contract & extension client (127.0.0.1)
│   └── shared/                  # Client-side PII redaction (privacy.ts), Built-in AI, BYOK/Ollama & locale
├── packages/mcp/                # Standalone @pagecraft/mcp (pagecraft-mcp) stdio server for Claude/Cursor/Codex
├── site/                        # Zero-telemetry static website on Cloudflare Pages (/, /playground/, /privacy/)
├── scripts/
│   ├── build-icons.mjs          # Extension & store icon generator
│   └── build-site.mjs           # Generates site/privacy/index.html from PRIVACY.md & validates static site
└── tests/core/                  # Fast Node native TypeScript unit tests
```

---

## Local Development Setup

### Prerequisites

- **Node.js `>= 22.6.0`** (Node **24 LTS** recommended — unit tests and `packages/mcp` use Node's built-in `--experimental-strip-types` support)
- **pnpm `10+`** (`corepack enable` or `npm install -g pnpm`)
- A Chromium-based browser (**Chrome 120+** / **Edge 120+**; Chrome **138+** provides the streamlined per-extension *Allow User Scripts* toggle and on-device Gemini Nano Prompt API) or Firefox

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

For Firefox development, run `pnpm dev:firefox` (or `pnpm build:firefox`).

---

## Verification Commands

Before opening a pull request, run all four checks from the repository root and confirm zero errors:

```bash
# 1. Regenerate & verify static website (site/privacy/index.html matches PRIVACY.md)
node scripts/build-site.mjs
node scripts/build-site.mjs --check

# 2. TypeScript strict type-checking across extension & libraries
pnpm compile

# 3. Core unit test suite (matcher, privacy redaction, selector builder, shortcodes, gm-shim, MCP, etc.)
pnpm test

# 4. Production Manifest V3 extension build (.output/chrome-mv3)
pnpm build
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

Every contribution to PageCraft must uphold our zero-backend security and privacy guarantees (see [`SECURITY.md`](./SECURITY.md) and [`PRIVACY.md`](./PRIVACY.md)):

- **Zero Servers & Zero Telemetry**: Never introduce remote telemetry, analytics beacons, feedback pings, or centralized backend dependencies.
- **Client-Side PII Redaction**: Any new page-context field sent to an LLM **must** pass through `redactSensitiveText()` / `sanitizePageUrl()` in `lib/shared/privacy.ts` and have corresponding unit tests in `tests/core/`.
- **Strict MV3, CSP & Loopback Boundaries**:
  - Never weaken `content_security_policy` in `wxt.config.ts` or `configureWorld({ csp: "script-src 'self'", messaging: false })` in `entrypoints/background/userscripts.ts`.
  - Do not use `eval()` or `new Function()` inside extension pages or service workers (MV3 CSP `script-src 'self'` forbids dynamic code evaluation).
  - Keep `messaging: false` in the `USER_SCRIPT` world so untrusted userscripts cannot message the privileged extension runtime.
  - Enforce `https:` for all remote BYOK endpoints; `http:` and `ws:` are permitted **strictly** for local loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) for Ollama, LM Studio, and `pagecraft-mcp`.
- **No Secrets or Personal Machine Paths**: Never commit API keys, `.env` files, or machine-specific paths. Official support channels are [GitHub Issues](https://github.com/botshen/pagecraft/issues) and [botzgbj@gmail.com](mailto:botzgbj@gmail.com).

---

## Pull Request Checklist

- [ ] Focused, atomic branch from `main` (e.g., `feat/recipe-hn-reader` or `fix/picker-shadow-dom`)
- [ ] If `PRIVACY.md` or `site/` changed, `node scripts/build-site.mjs --check` passes cleanly
- [ ] `pnpm compile`, `pnpm test`, and `pnpm build` pass with zero errors
- [ ] Unit tests added in `tests/core/` for new logic or edge cases
- [ ] Follows our [Code of Conduct](./CODE_OF_CONDUCT.md)
