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

## v0.2 — Local-First AI & Recipe Ecosystem (Completed)
- [x] Instant live CSS quick-sliders (font size, reading column width, paper warmth) with ephemeral preview
- [x] Shareable `#PC1:...#` 1-click recipe shortcodes & deep links for instant community import/export
- [x] First-class **100% Offline Local AI** support (**Ollama** on `http://localhost:11434/v1` & **LM Studio** on `http://localhost:1234/v1` with keyless local inference and CORS setup helper)
- [x] Strict HTTPS enforcement for remote BYOK gateways while permitting `http://` exclusively on verified local loopback (`localhost` / `127.0.0.1` / `[::1]`)

## v0.3 — Serverless Micro-Agent Runtime, Vision, Auto-Heal & MCP Bridge (Completed)
- [x] **100% Serverless Zero-Backend Architecture**: Pure client-side MV3 extension with zero proprietary cloud proxies, zero install IDs, and zero background telemetry
- [x] **Chrome Built-in On-Device AI (`Gemini Nano`)**: Zero-config, offline generation via Chrome's `LanguageModel` Prompt API
- [x] **Multimodal Cropped Element Screenshot**: Automatic region capture & `OffscreenCanvas` cropping around picked elements (`max 640px`), with resilient 1-pass text-only fallback on HTTP `400`/`415`/`422`
- [x] **Closed-Loop Auto-Verify & Self-Healing**: MV3 CSP-safe structural syntax checks + automatic live DOM selector verification with 1-pass self-healing refinement when `0` elements match
- [x] **`pagecraft-mcp` Local Coding Agent Bridge**: Loopback `127.0.0.1` WebSocket bridge exposing live DOM picking, selector verification, and instant mod injection as MCP tools for **Claude Code**, **Cursor**, and **Codex**

## v0.4 — Streaming Previews & Community Recipe Hub (Next)
- [ ] **Streaming Mod Preview**: Stream CSS/JS diffs and live ephemeral page previews token-by-token during generation
- [ ] **Per-Site Keyboard Shortcuts & Command Palette**: Trigger saved JS actions (e.g., export table, toggle focus mode) via customizable hotkeys directly on the page
- [ ] **Open Community Recipe Hub**: Git-backed, static-verified catalog of community-contributed `#PC1:...#` & `.user.js` site recipes with 1-click install and zero remote code execution
- [ ] **Firefox MV3 / Gecko Port**: Cross-browser adapter for Firefox Sidebar & `userScripts` APIs
- [ ] **Encrypted Local/Git Gist Sync (Opt-In)**: Bring-your-own end-to-end encrypted backup sync across devices without central accounts
