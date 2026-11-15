# Privacy Policy — PageCraft

*Last updated: November 15, 2026*

**PageCraft** ("Live Webpage Customizer & Browser Micro-Agent Runtime" — official website: [https://pagecraft.shenxin.space](https://pagecraft.shenxin.space)) helps you customize webpage layouts, remove popups and distractions, export tables, and generate persistent CSS tweaks or JavaScript userscripts using natural language or your own local coding agents.

PageCraft operates **100% client-side with ZERO PageCraft servers, ZERO user accounts, and ZERO telemetry or feedback pings**.

---

## 1. Zero PageCraft Servers & Zero Background Tracking

PageCraft has **no centralized backend, no cloud database, and no analytics pipeline**. Specifically, PageCraft **does NOT**:

- Operate any PageCraft proxy server, user account system, or cloud trial/telemetry endpoint;
- Send anonymous usage metrics, install IDs, crash reports, or 👍/👎 feedback pings anywhere;
- Record your browsing history, visited URLs, search queries, or tab switches in the background;
- Inject passive tracking scripts onto websites;
- Capture keystrokes, form inputs, passwords, cookies, or clipboard contents;
- Sell, rent, or share any data with advertisers, analytics vendors, or data brokers.

Our official static website and interactive practice sandbox ([https://pagecraft.shenxin.space](https://pagecraft.shenxin.space), hosted via GitHub Pages) ship zero tracking scripts, zero cookies, and decode shared `#PC1:...#` / `?recipe=PC1:...` recipe links purely inside your browser.

---

## 2. Data Stored 100% Locally in Your Browser

All extension state stays locally inside your browser (`chrome.storage.local`) on your device and never leaves your machine unless you explicitly export or share a recipe:

- Your saved CSS modifications and JavaScript userscripts (`pc_mods`);
- Your UI preferences, active compute mode, and capability toggles (such as Multimodal Vision and Auto-Heal);
- Your custom BYOK API endpoint and API key (if you choose Direct BYOK mode) or optional local MCP loopback token.

---

## 3. Four Local & User-Owned Compute Options

PageCraft processes webpage context **only** when you explicitly click **Pick Element**, **Generate**, or **Refine** (or invoke a tool from your own local MCP agent). You control 100% of the compute:

1. **Chrome Built-in AI (Gemini Nano On-Device)**:
   Runs 100% offline inside Chrome's native `LanguageModel` on-device runtime. Zero network requests are made and zero data leaves your browser.
2. **Offline Local AI (Ollama / LM Studio)**:
   Connects directly from your browser to your own local loopback inference server (e.g., `http://localhost:11434` or `http://127.0.0.1:1234`). Zero data leaves your machine.
3. **Direct BYOK (OpenAI / Anthropic / DeepSeek / OpenRouter)**:
   When you configure your own API key, generation requests are sent **directly over `https:` from your browser to your chosen AI provider**. PageCraft never proxies, intercepts, or sees your API key or prompts. Your chosen provider processes requests under its own API privacy policy.
4. **Local Coding Agent Bridge (`pagecraft-mcp` over `127.0.0.1`)**:
   When you explicitly enable the MCP Bridge in Settings, PageCraft connects strictly over local loopback (`ws://127.0.0.1:17321`) to the `pagecraft-mcp` stdio server running on your own computer—allowing local tools like Claude Code, Cursor, or Codex CLI to inspect and customize your active tab without exposing any port to external networks.

---

## 4. Client-Side PII Redaction & Optional Multimodal Context

Before constructing any LLM prompt (even for your own BYOK provider or local model), PageCraft automatically scrubs page context client-side (`lib/shared/privacy.ts`):

- **Automatic Text & URL Scrubbing**: Strips email addresses (`[EMAIL]`), API keys and bearer tokens (`sk-...`, `ghp_...`, `Bearer ...` → `[KEY]`), 8–19 digit identifiers/phone/card numbers (`[NUM]`), and URL query strings/fragments, and never reads password field values.
- **Optional Multimodal Screenshot Context**: Only when you enable Visual Screenshot Context and click **Generate / Refine** on a webpage, PageCraft captures a low-detail viewport snapshot of the active tab (`tabs.captureVisibleTab`) in memory solely for that single prompt request (automatically falling back to text-only if your chosen model does not support images). Screenshots are never persisted to disk or storage.
- **Zero-Network Practice Sandbox**: On `/playground`, built-in instant CSS practice exercises synthesize rules deterministically inside the extension with zero AI or network calls.

---

## 5. Browser Permissions Justification

- `storage`: Saves your webpage mods, UI preferences, and optional BYOK/MCP settings locally in `chrome.storage.local`.
- `sidePanel`: Displays the PageCraft studio alongside the webpage you are customizing.
- `tabs` & `scripting` & `<all_urls>`: Applies your enabled CSS rules to matching websites, runs on-demand selector verification / Closed-Loop Auto-Heal, and launches the Shadow-DOM Element Picker only when you invoke it.
- `userScripts`: Executes your enabled JavaScript userscripts inside Chrome's isolated Manifest V3 `USER_SCRIPT` sandbox (`csp: "script-src 'self'"`, `messaging: false`).

---

## 6. Contact & Data Deletion

Because PageCraft stores zero data on any server, all of your data resides on your own device. You can delete individual mods or clear your API key at any time in the PageCraft Side Panel, and uninstalling PageCraft immediately deletes all local mods, settings, and keys stored in your browser.

For privacy inquiries or support requests, contact [botzgbj@gmail.com](mailto:botzgbj@gmail.com), open an issue on [GitHub Issues](https://github.com/botshen/pagecraft/issues), or visit [https://pagecraft.shenxin.space](https://pagecraft.shenxin.space).
