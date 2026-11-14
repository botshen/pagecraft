# Security Policy

PageCraft modifies live webpages and executes user-authored CSS rules and JavaScript userscripts inside your browser. Because extension permissions carry elevated trust, our security and privacy model is built around **zero background tracking**, **strict execution-world isolation**, **client-side PII redaction**, and **zero remote code execution**.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `0.1.x` (`main`) | :white_check_mark: Yes |
| `< 0.1.0` | :x: No |

---

## Security & Privacy Architecture

### 1. Zero Background Browsing Telemetry

- PageCraft **never** injects passive analytics scripts or records your browsing history, visited URLs, search queries, form inputs, cookies, passwords, or clipboard contents in the background.
- Page inspection (`entrypoints/background/picker-injected.ts`) runs **only** on explicit user invocation—when you click **Pick Element** or click **Generate / Refine** in the sidepanel studio.
- All saved webpage mods (`pc_mods`), UI settings, and Bring-Your-Own-Key (BYOK) credentials stay locally inside `chrome.storage.local` on your device unless you explicitly export or share a mod.

### 2. Client-Side PII Redaction Before LLM Calls

Whenever you explicitly generate or refine a webpage modification with AI, PageCraft scrubs outbound page context **inside the browser before any network request is made** (`lib/shared/privacy.ts`):

- **`redactSensitiveText()`** strips secret keys and bearer tokens (`sk-...`, `ghp_...`, `Bearer ...` → `[KEY]`), email addresses (`[EMAIL]`), 8–19 digit identifiers/phone/card numbers (`[NUM]`), and URL query strings (`?[REDACTED]`), and caps text previews to short structural labels.
- **`sanitizePageUrl()` & `urlToHostHint()`** strip URL query strings and fragments completely, keep at most three route segments, and mask numeric or UUID-like path segments as `:id`. Password input values are never read.
- **Transparent AI Backends**:
  - **BYOK Mode**: Requests go directly over `https:` from your browser to your configured provider (OpenAI, DeepSeek, OpenRouter, SiliconFlow, etc.) without touching PageCraft servers.
  - **Local Offline AI Mode**: Connects directly to loopback inference servers (`localhost`, `127.0.0.1`, `[::1]`, such as Ollama or LM Studio) so zero data leaves your machine. Non-loopback endpoints strictly enforce `https:`.
  - **Optional Cloud Trial (`workers/cloud/`)**: Forwards redacted structural context to the upstream model to serve the 10-credit trial; prompts, page titles, and DOM snippets are **never** stored in Cloudflare D1.

### 3. Dual-Engine Isolation (`insertCSS` vs. Isolated `chrome.userScripts`)

PageCraft separates pure visual styling from scripted DOM automation so the lowest-privilege engine is used by default (`entrypoints/background/userscripts.ts`):

| Engine | Chrome API | Execution Context & Security Boundary |
| ------ | ---------- | ------------------------------------- |
| **CSS Engine** (`engine: 'css'`) | `chrome.scripting.insertCSS` / `removeCSS` | Pure stylesheet injection scoped to validated `@match` patterns. Executes zero JavaScript, toggles live without page reload, and requires zero `userScripts` permissions to take effect. |
| **JS Engine** (`engine: 'js'`) | `chrome.userScripts.register` (`world: 'USER_SCRIPT'`) | Runs inside Chrome's dedicated Manifest V3 `USER_SCRIPT` isolated world—separate from both the extension's privileged runtime and the host page's `MAIN` JS world unless explicitly bridged. |

For the `USER_SCRIPT` world, PageCraft calls `chrome.userScripts.configureWorld()` with hardened defaults:

```ts
await chrome.userScripts.configureWorld({
  csp: "script-src 'self'",
  messaging: false,
});
```

- **`csp: "script-src 'self'"`**: Blocks `eval()`, `new Function()`, remote `<script src="...">` loading from third-party origins, and dynamic code evaluation inside the userscript execution world.
- **`messaging: false`**: Severs `chrome.runtime.sendMessage` / `chrome.runtime.connect` access from the `USER_SCRIPT` world. Even if a user imports an untrusted `.user.js` script, that script **cannot** send messages to PageCraft's background service worker, read `chrome.storage.local` (such as BYOK API keys), or invoke privileged extension APIs.
- **Strict `@match` Validation**: Overly broad match patterns (`<all_urls>`, `*://*/*`, `http://*/*`, `https://*/*`) are rejected by `validateMatches()` (`lib/userscripts/store.ts`) unless explicitly authorized per script (`allowAllUrls`).

### 4. Zero Remote Code Execution (No `@require` Fetching)

In strict compliance with Chrome Web Store Manifest V3 policies:

- Extension pages enforce `"script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';"` (`wxt.config.ts`).
- Built-in recipes (`lib/userscripts/templates.ts`) are 100% static, bundled at build time, and free of external network dependencies.
- When importing Tampermonkey/Greasemonkey `.user.js` files, PageCraft injects a lightweight, self-contained local compatibility prelude (`lib/userscripts/gm-shim.ts`) **only** when `GM_*` / `GM.*` identifiers are detected:
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

1. **Affected component**: Browser extension (`entrypoints/` or `lib/`), `USER_SCRIPT` sandbox / `gm-shim`, Element Picker (`lib/picker/`), Shareable Shortcode parser (`lib/userscripts/share.ts`), or Cloudflare Worker (`workers/cloud/`).
2. **Browser & version**: e.g., Chrome 138+, Edge, Firefox, and PageCraft version / commit SHA.
3. **Reproduction steps or minimal PoC**: Sample HTML page, `.user.js` payload, `#PC1:...#` shortcode, or HTTP request demonstrating the issue.
4. **Security impact**: e.g., sandbox escape (`USER_SCRIPT` → extension privilege escalation), PII redaction bypass, XSS in extension UI, or Worker quota/auth bypass.

### Disclosure Timeline

- **Initial acknowledgment**: Within **72 hours** of submission.
- **Triage & remediation plan**: Within **7 days** for confirmed vulnerabilities.
- **Coordinated release**: Once a patch is verified and released, we publish the advisory and credit reporters (unless you prefer to remain anonymous).
