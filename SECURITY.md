# Security Policy

PageCraft modifies live webpages and executes user-authored CSS rules and JavaScript userscripts inside your browser. Because extension permissions carry elevated trust, our security and privacy model is built around **100% client-side execution (zero PageCraft servers)**, **zero telemetry**, **strict execution-world isolation**, **client-side PII redaction**, and **zero remote code execution**.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `0.1.x` / `0.2.x` (`main`) | :white_check_mark: Yes |
| `< 0.1.0` | :x: No |

---

## Security & Privacy Architecture

### 1. 100% Client-Side, Zero PageCraft Servers & Zero Telemetry

- PageCraft operates **100% client-side with ZERO PageCraft servers, ZERO user accounts, and ZERO telemetry or feedback pings**.
- PageCraft **never** injects passive analytics scripts or records your browsing history, visited URLs, search queries, form inputs, cookies, passwords, or clipboard contents in the background.
- Page inspection (`entrypoints/background/picker-injected.ts`) and Closed-Loop Auto-Heal selector checks run **only** on explicit user or local-MCP invocation.
- All saved webpage mods (`pc_mods`), UI preferences, and optional BYOK/MCP credentials stay locally inside `chrome.storage.local` on your device unless you explicitly export a `.user.js` / JSON backup or copy a `#PC1:...#` shareable shortcode.
- The official website and 20-second practice sandbox (`site/`, deployed to GitHub Pages) are pure static HTML/CSS/SVG with strict `<meta http-equiv="Content-Security-Policy">` policies, zero third-party requests, and client-only `?recipe=PC1:...` decoding.

### 2. Four Local & User-Owned Compute Options

PageCraft has no backend proxy; every AI or agent capability runs on compute you own and control:

| Compute Mode | Transport Boundary | Security Guarantees |
| ------------ | ------------------ | ------------------- |
| **1. Chrome Built-in AI (Gemini Nano)** | In-browser `LanguageModel` API | Runs 100% on-device inside Chrome. Zero network traffic and zero API keys required. |
| **2. Offline Local AI (Ollama / LM Studio)** | Loopback `http://localhost` / `127.0.0.1` / `[::1]` | Connects directly to your local inference runtime so zero data leaves your machine. Plaintext `http:` is blocked for all non-loopback hosts. |
| **3. Direct BYOK (OpenAI / Anthropic / DeepSeek / OpenRouter)** | Direct browser → provider `https:` | Enforces `https:` for all remote endpoints. Keys live solely in `chrome.storage.local` and never transit any PageCraft infrastructure. |
| **4. Local Coding Agent Bridge (`pagecraft-mcp`)** | Loopback WebSocket `ws://127.0.0.1:17321` | Disabled by default. Binds strictly to `127.0.0.1` (never `0.0.0.0`), supports optional shared bearer token authentication, and enforces all `@match` and Dual-Engine sandbox rules. |

### 3. Client-Side PII Redaction & Multimodal Guardrails

Whenever you explicitly generate or refine a webpage modification, PageCraft scrubs outbound page context **inside the browser before any prompt leaves the extension** (`lib/shared/privacy.ts`):

- **`redactSensitiveText()`** strips secret keys and bearer tokens (`sk-...`, `ghp_...`, `Bearer ...` → `[KEY]`), email addresses (`[EMAIL]`), 8–19 digit identifiers/phone/card numbers (`[NUM]`), and URL query strings (`?[REDACTED]`), and caps text previews to concise structural labels.
- **`sanitizePageUrl()` & `urlToHostHint()`** strip URL query strings and fragments completely, keep at most three route segments, and mask numeric or UUID-like path segments as `:id`. Password input values are never read.
- **Scoped Multimodal Screenshot Capture**: When Visual Screenshot Context is enabled, viewport snapshots are captured in-memory solely on explicit user Generate/Refine action, never written to storage, and automatically downgraded to text-only on HTTP `400/415/422` responses from text-only endpoints.

### 4. Dual-Engine Isolation (`insertCSS` vs. Isolated `chrome.userScripts`)

PageCraft separates pure visual styling from scripted DOM automation so the lowest-privilege engine is used by default (`entrypoints/background/userscripts.ts`):

| Engine | Chrome API | Execution Context & Security Boundary |
| ------ | ---------- | ------------------------------------- |
| **CSS Engine** (`engine: 'css'`) | `chrome.scripting.insertCSS` / `removeCSS` | Pure stylesheet injection scoped to validated `@match` patterns. Executes zero JavaScript, toggles live without page reload, and requires zero `userScripts` permissions to take effect. |
| **JS Engine** (`engine: 'js'`) | `chrome.userScripts.register` (`world: 'USER_SCRIPT'`) | Runs inside Chrome's dedicated Manifest V3 `USER_SCRIPT` isolated world—separate from both the extension's privileged runtime and the host page's `MAIN` JS world. |

For the `USER_SCRIPT` world, PageCraft calls `chrome.userScripts.configureWorld()` with hardened defaults:

```ts
await chrome.userScripts.configureWorld({
  csp: "script-src 'self'",
  messaging: false,
});
```

- **`csp: "script-src 'self'"`**: Blocks `eval()`, `new Function()`, remote `<script src="...">` loading from third-party origins, and dynamic code evaluation inside the userscript execution world (including during Closed-Loop Auto-Heal validation, which uses safe structural checks without `eval`/`new Function`).
- **`messaging: false`**: Severs `chrome.runtime.sendMessage` / `chrome.runtime.connect` access from the `USER_SCRIPT` world. Even if a user imports an untrusted `.user.js` script, that script **cannot** message PageCraft's background service worker, read `chrome.storage.local` (such as BYOK API keys or MCP tokens), or invoke privileged extension APIs.
- **Strict `@match` Validation**: Overly broad match patterns (`<all_urls>`, `*://*/*`, `http://*/*`, `https://*/*`) are rejected by `validateMatches()` (`lib/userscripts/store.ts`) unless explicitly authorized per script (`allowAllUrls`).

### 5. Zero Remote Code Execution (No `@require` Fetching)

In strict compliance with Chrome Web Store and Microsoft Edge Manifest V3 policies:

- Extension pages enforce `"script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';"` (`wxt.config.ts`).
- Built-in recipes (`lib/userscripts/templates.ts`) are 100% static, bundled at build time, and free of external network dependencies.
- When importing `.user.js` files, PageCraft injects a lightweight, self-contained local compatibility prelude (`lib/userscripts/gm-shim.ts`) **only** when `GM_*` / `GM.*` identifiers are detected:
  - **No `@require` execution**: Remote `@require` directives are **never** downloaded or evaluated.
  - **No cross-origin background proxy**: `GM_xmlhttpRequest` is intentionally omitted so userscripts cannot bypass browser Same-Origin Policy / CORS via privileged background fetches.
  - **Origin-scoped `GM_getValue` / `GM_setValue`**: Backed by origin-local storage namespaced per script ID rather than cross-site extension storage.

---

## Reporting a Vulnerability

Please **do not** report undisclosed security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, report vulnerabilities privately through **GitHub Security Advisories** or by email:

- **GitHub Security Advisories**: [https://github.com/botshen/plugin-radar/security/advisories/new](https://github.com/botshen/plugin-radar/security/advisories/new)
- **Security Contact Email**: [botzgbj@gmail.com](mailto:botzgbj@gmail.com)

### What to Include

To help us triage and reproduce quickly, please include:

1. **Affected component**: Browser extension (`entrypoints/` or `lib/`), `USER_SCRIPT` sandbox / `gm-shim`, Element Picker (`lib/picker/`), Shareable Shortcode parser (`lib/userscripts/share.ts`), Local MCP Bridge (`packages/mcp/` or `lib/mcp/`), or Static Site (`site/`).
2. **Browser / Node version**: e.g., Chrome 138+, Edge, Firefox, Node 24 LTS, and PageCraft version / commit SHA.
3. **Reproduction steps or minimal PoC**: Sample HTML page, `.user.js` payload, `#PC1:...#` shortcode, or local WebSocket frame demonstrating the issue.
4. **Security impact**: e.g., sandbox escape (`USER_SCRIPT` → extension privilege escalation), PII redaction bypass, non-loopback MCP exposure, or XSS in extension/static UI.

### Disclosure Timeline

- **Initial acknowledgment**: Within **72 hours** of submission.
- **Triage & remediation plan**: Within **7 days** for confirmed vulnerabilities.
- **Coordinated release**: Once a patch is verified and released, we publish the advisory and credit reporters (unless you prefer to remain anonymous).
