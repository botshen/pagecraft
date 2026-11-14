# PageCraft Roadmap

## v0.1 — Core Studio & Dual-Engine Runtime (Completed)
- [x] Persistent Chrome & Edge MV3 Side Panel workspace (`entrypoints/sidepanel/`)
- [x] Shadow-DOM isolated live Element Picker (`injectElementPickerOverlay`) with smart CSS selector & sibling list detection
- [x] Dual-Engine Runtime:
  - [x] `CSS` Engine (`chrome.scripting.insertCSS` / `removeCSS`) — instant live toggle with zero extra permissions and SPA `pushState` navigation sync
  - [x] `JS` Engine (`chrome.userScripts` isolated `USER_SCRIPT` world) + guided 1-click permission helper
- [x] Live target-selector hit verification & 1-click selector auto-calibration
- [x] Multi-turn conversational mod refinement
- [x] 10 built-in 1-click recipes (Warm Reader, Smart Dark Mode, Table-to-CSV UTF-8 BOM, Copy Unlocker, Zhihu / Bilibili / Xiaohongshu clean modes, Code Copy Button, Direct Link Unwrapper, Alt+Hover Zoom)
- [x] Full `.user.js` export & import interoperability with Tampermonkey & ScriptCat
- [x] Client-side PII redaction (`[EMAIL]`, `[KEY]`, `[NUM]`, sanitized URLs) before any LLM request
- [x] Zero-telemetry Cloudflare Worker (`10` atomic free cloud generations per install + interactive 0-credit `/playground` sandbox + `/admin` operator console)

## v0.2 — Open-Source Release & Local-First AI (Completed)
- [x] Zero-credit visual CSS quick-sliders (font size, reading column width, paper warmth) with live preview
- [x] Shareable `#PC1:...#` 1-click recipe shortcodes & deep links for instant community import/export
- [x] First-class **100% Offline Local AI** support (**Ollama** preset on `http://localhost:11434/v1` & **LM Studio** loopback support with keyless local inference and CORS setup helper)
- [x] Strict HTTPS enforcement for remote BYOK gateways while permitting `http://` exclusively on verified local loopback (`localhost` / `127.0.0.1` / `[::1]`)
- [x] Open-source MIT release with GitHub Actions CI, self-hostable `workers/cloud` D1 guide, contributor templates, and security policy

## v0.3 — Resilient AI & Multimodal Context (Next)
- [ ] **Auto-Healing Selectors**: Detect silent site redesigns when previously working mods drop to `0` DOM matches and offer 1-click background selector repair against the updated DOM tree
- [ ] **Multimodal Visual Context (Opt-In)**: Optional cropped element screenshot context for vision-capable local/cloud models (e.g., Qwen2.5-VL, GPT-4o, Claude) to nail complex flexbox/grid visual restyling
- [ ] **Streaming Mod Preview**: Stream CSS/JS diffs and live ephemeral page previews token-by-token during generation
- [ ] **Per-Site Keyboard Shortcuts & Command Palette**: Trigger saved JS actions (e.g., export table, toggle focus mode) via customizable hotkeys directly on the page

## v0.4 — Community Recipe Hub & Ecosystem (Future)
- [ ] **Open Community Recipe Hub**: Git-backed, static-verified catalog of community-contributed `#PC1:...#` & `.user.js` site recipes with 1-click install and zero remote code execution
- [ ] **Firefox MV3 / Gecko Port**: Cross-browser adapter for Firefox Sidebar & `userScripts` APIs
- [ ] **Encrypted Local/Git Gist Sync (Opt-In)**: Bring-your-own end-to-end encrypted backup sync across devices without central accounts
