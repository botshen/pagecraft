# `pagecraft-mcp`

Zero-dependency **Model Context Protocol (MCP)** local bridge connecting **Claude Code**, **Cursor**, **Codex CLI**, and **Windsurf** directly to [PageCraft](https://pagecraft.shenxin.space)'s live authenticated browser DOM, Visual Element Picker, and Dual-Engine (`insertCSS` + isolated `chrome.userScripts`) runtime over `127.0.0.1`.

## Why Use PageCraft MCP?

Unlike headless Playwright/Puppeteer browsers that start with an empty profile and hit login walls or 2FA:

- **Live Authenticated Tabs**: Inspect and customize the exact tab you already have open and signed into in Chrome or Edge.
- **Point-and-Click Visual Context**: Click any element with PageCraft's Shadow-DOM Element Picker, then tell your coding agent *"clean up this element"*—it receives the exact CSS selector, sibling list selector, PII-redacted DOM snippet, computed styles, bounding rect, and cropped screenshot.
- **Closed-Loop Selector Verification**: Your coding agent tests candidate CSS selectors (`querySelectorAll` hit counts) on the live DOM *before* applying changes.
- **Instant Dual-Engine Hot Apply**: Hot-inject zero-toggle CSS (`chrome.scripting.insertCSS`) or isolated MV3 userscripts (`chrome.userScripts`) directly into the live tab and persist them in PageCraft.

---

## Prerequisites

1. **Node.js `>= 18.0.0`** (zero external npm runtime dependencies).
2. **PageCraft Browser Extension** loaded in Chrome/Edge ([GitHub](https://github.com/botshen/pagecraft)):
   - Open the **PageCraft SidePanel -> Settings**.
   - Toggle **Local Agent Bridge (MCP)** ON (`ws://127.0.0.1:17321`).

---

## Quick Setup by Coding Agent

### 1. Claude Code

Run in your terminal:

```bash
claude mcp add pagecraft -- npx -y pagecraft-mcp
```

With an optional shared token:

```bash
claude mcp add pagecraft -e PAGECRAFT_MCP_TOKEN=your-local-secret -- npx -y pagecraft-mcp
```

### 2. Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "pagecraft": {
      "command": "npx",
      "args": ["-y", "pagecraft-mcp"]
    }
  }
}
```

### 3. OpenAI Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.pagecraft]
command = "npx"
args = ["-y", "pagecraft-mcp"]
```

### 4. Windsurf (`~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "pagecraft": {
      "command": "npx",
      "args": ["-y", "pagecraft-mcp"]
    }
  }
}
```

---

## Exposed MCP Tools (7)

| Tool | Description |
| :--- | :--- |
| `pagecraft_get_active_page` | Get active browser tab URL, title, live DOM skeleton, and active mods. |
| `pagecraft_get_picked_element` | Get the element selected with PageCraft's visual Element Picker (selector, sibling selector, PII-redacted DOM snippet, computed styles, bounding rect, and optional cropped screenshot). |
| `pagecraft_trigger_picker` | Launch the visual Element Picker overlay in the active browser tab. |
| `pagecraft_verify_selectors` | Test candidate CSS selectors against the live authenticated page (`querySelectorAll` hit counts). |
| `pagecraft_apply_mod` | Hot-inject (`insertCSS` or isolated `chrome.userScripts`) and save a CSS/JS mod to the live page, returning live selector verification results. |
| `pagecraft_list_mods` | List all saved PageCraft mods. |
| `pagecraft_toggle_mod` | Enable or pause a saved mod by ID. |

---

## Security Architecture

- **Loopback-Only Binding**: The WebSocket server binds strictly to `127.0.0.1` (default port `17321`, configurable via `PAGECRAFT_MCP_PORT`) and verifies incoming TCP sockets originate from loopback. The extension client (`lib/mcp/bridge-client.ts`) likewise refuses any non-loopback `wsUrl`.
- **Cross-Site WebSocket Hijacking (CSWSH) Protection**: Any HTTP/WebSocket upgrade carrying a web `Origin` header (`http://...`, `https://...`, `null`, or `file://...`) is rejected immediately with `403 Forbidden`, ensuring malicious websites visited in the browser can never communicate with `127.0.0.1:17321`. Only browser extension origins (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`) or local CLI/test clients without web origins are accepted.
- **Optional Shared-Secret Authentication**: Set `PAGECRAFT_MCP_TOKEN` in both the MCP server environment and PageCraft Settings to enforce constant-time (`crypto.timingSafeEqual`) token verification during the WebSocket handshake.
- **Zero External Dependencies**: Built exclusively on Node's built-in `node:http` and `node:crypto` modules with zero third-party supply-chain surface.

## License

MIT · [GitHub](https://github.com/botshen/pagecraft) · [Website](https://pagecraft.shenxin.space)
