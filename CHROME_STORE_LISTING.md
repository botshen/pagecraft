# Chrome Web Store & Edge Add-ons Listing — PageCraft

## 0. Store Metadata & Official Links

- **Official Website URL**: `https://pagecraft.shenxin.space`
- **Privacy Policy URL**: `https://pagecraft.shenxin.space/privacy`
- **Interactive Practice Sandbox**: `https://pagecraft.shenxin.space/playground`
- **GitHub Repository & Issues**: `https://github.com/botshen/pagecraft/issues`
- **Support / Developer Contact Email**: `botzgbj@gmail.com`

---

## 1. Store Title & Short Description (Bilingual ASO)

> **CWS / Edge Length Rules**: Name `<= 45` chars, Summary `<= 132` chars. Keep formatting crisp with zero keyword stuffing.

### 简体中文 (`zh_CN` — Default)
- **名称（`<= 45` 字符）**：`PageCraft 网页工坊：AI 去弹窗改样式、表格导出与油猴脚本`
- **简短描述（`<= 132` 字符）**：`鼠标点选任意网页元素，一句话去弹窗干扰、改护眼宽屏排版、给后台表格加导出 Excel/CSV 按钮，自动生成自定义 CSS 或用户脚本。100% 本地无服务端，支持 Chrome 内置 AI、Ollama、BYOK 与 MCP。`

### English (`en`)
- **Name (`<= 45` chars)**: `PageCraft: AI Webpage Customizer & Userscript`
- **Summary (`<= 132` chars)**: `Click any page element to remove popups, customize CSS, export tables to CSV, or generate userscripts. 100% local & zero tracking.`

---

## 2. Detailed Store Description (详情页文案)

### 2.1 中文详情页文案 (`zh_CN`)

**不用翻 F12 找代码，鼠标指哪改哪，用一句大白话把任何不顺眼的网页改成你顺手的样子。100% 纯本地客户端运行，零服务端、零账号、零遥测上报。**

PageCraft 网页工坊是一个开源、常驻在浏览器侧边栏的 **实时网页定制与浏览器微智能体运行环境（Live Webpage Customizer & Browser Micro-Agent Runtime）**。无论是去除页面弹窗与推荐栏干扰、把刺眼的白底后台改成护眼宽屏深色排版，还是给没有导出功能的业务系统表格焊上一个「一键导出 Excel / CSV」按钮，只需点选元素、说出需求即可持久生效。

#### 核心亮点
1. **可视化点选 + 多模态视觉理解 + 闭环自愈（免按 F12）**
   鼠标悬停点击网页上的任意弹窗、侧边栏、卡片列表或数据表格，自动提取稳定 CSS 选择器与客户端脱敏后的 DOM 骨架；支持可选视口截图上下文（Multimodal Vision）与生成后实时选择器命中校验——若 0 命中自动触发闭环自愈校准（Auto-Heal）。
2. **CSS + JS 双引擎：新手免开关 0.1 秒生效**
   - **视觉与排版改造（去弹窗干扰 / 宽屏阅读 / 护眼深色 / 调字号行高）**：走原生 `insertCSS` 样式通道，**无需开启任何开发者开关，0.1 秒实时生效并支持动态路由（SPA）自动跟随，随时一键关闭还原**。
   - **交互与效率脚本（网页表格导出 Excel/CSV / 解除复制限制 / 代码块一键复制）**：基于官方 MV3 `chrome.userScripts` 隔离沙箱（`csp: "script-src 'self'"`, `messaging: false`）安全持久运行。
3. **4 种完全由你掌控的本地 / 自有算力选择**
   - **Chrome 内置 AI（Gemini Nano 端侧模型）**：零配置、离线端侧推理，数据不出浏览器。
   - **本地离线大模型（Ollama / LM Studio）**：直连本机 `localhost` 推理服务，内网与敏感后台安心可用。
   - **自有密钥直连（Direct BYOK）**：支持填入 OpenAI、Anthropic、DeepSeek 或 OpenRouter API Key，从浏览器加密直连服务商。
   - **本地编程智能体桥接（`pagecraft-mcp`）**：通过 `127.0.0.1` 本地回环桥接 Claude Code、Cursor 或 Codex，让本地 Agent 直接操控真实已登录网页与双引擎沙箱。
4. **内置 10 款高频网站一键净化方案 + 20 秒免配置练习靶场**
   开箱自带「沉浸宽屏护眼阅读」「刺眼白底转柔和深色」「网页表格一键导出 Excel/CSV（含 UTF-8 BOM 防中文乱码）」「解除复制与右键限制」「知乎纯净宽屏去弹窗」「B站首页防摸鱼仅留搜索栏」「小红书清爽大屏」等 10 款现成方案，无需配置 AI 即可一键启用。
5. **标准 `.user.js` 用户脚本互通 + `#PC1:...#` 无服务端分享码**
   所有 CSS 或 JS 改造均可一键复制或下载为标准 `// ==UserScript==`（`.user.js`）文件，支持粘贴导入现成脚本、生成 `#PC1:...#` 纯客户端口令分享，以及 JSON 规则库一键备份与跨设备恢复。
6. **100% 无服务端架构与零后台监控承诺**
   PageCraft **不设任何官方后端服务器、无需注册登录、无任何遥测或反馈打点**；绝不记录浏览历史、搜索词或剪贴板数据。所有保存的规则与密钥仅存储在你的本地浏览器（`chrome.storage.local`），发送给 AI 模型的结构上下文均经过客户端 PII 自动脱敏（抹除邮箱、API 密钥、长数字编号、URL 参数与密码框）。

#### 官网与联系支持
- **官方网站**：https://pagecraft.shenxin.space
- **交互练习靶场**：https://pagecraft.shenxin.space/playground
- **隐私政策**：https://pagecraft.shenxin.space/privacy
- **开源仓库与反馈**：https://github.com/botshen/pagecraft/issues
- **支持邮箱**：botzgbj@gmail.com

### 2.2 English Detailed Description (`en`)

**Customize any webpage without hunting through DevTools (`F12`). Point at any page element, describe what you want in plain words, and make the upgrade permanent — 100% client-side with zero PageCraft servers, zero accounts, and zero telemetry.**

PageCraft is an open-source **Live Webpage Customizer & Browser Micro-Agent Runtime** living in your browser Side Panel. Strip distracting popups and sidebars, widen cramped reading columns, restyle bright dashboards into warm dark mode, or attach a one-click "Export Table to Excel / CSV" button to internal admin portals—just point, ask, and save.

#### Highlights
1. **Visual Element Picker + Multimodal Vision + Closed-Loop Auto-Heal**
   Hover and click any banner, repeating card list, or data table to capture resilient CSS selectors and client-side PII-redacted DOM structure. Optional multimodal viewport context and live DOM selector verification automatically self-heal 0-hit selectors so rules work on the first try.
2. **Dual-Engine (`CSS` + `JS`) MV3 Runtime**
   - **Instant CSS Customizations**: Remove clutter, widen columns, and restyle typography in **0.1s with zero developer toggles**, staying synced across SPA route changes and toggling ON/OFF live without reloading.
   - **Isolated MV3 JS Userscripts**: Interactive enhancements (Excel/CSV table export, copy/right-click unlockers, custom buttons) run safely inside Chrome's official MV3 `chrome.userScripts` isolated world (`csp: "script-src 'self'"`, `messaging: false`).
3. **4 Local & User-Owned Compute Options**
   - **Chrome Built-in AI (Gemini Nano on-device)**: Zero-config, 100% offline in-browser inference.
   - **Offline Local AI (Ollama / LM Studio)**: Connect directly to `localhost` so zero data leaves your machine.
   - **Direct BYOK**: Connect your own OpenAI, Anthropic, DeepSeek, or OpenRouter API key directly over HTTPS from your browser.
   - **Local Coding Agent Bridge (`pagecraft-mcp`)**: Connect Claude Code, Cursor, or Codex CLI over `127.0.0.1` to inspect live DOM landmarks and apply CSS/JS mods directly.
4. **10 Built-in One-Click Recipes + Zero-Config Practice Sandbox**
   Ships with Warm Widescreen Reader, Smart Dark Mode Filter, One-Click Table to CSV/Excel (UTF-8 BOM), Unlock Copy & Right-Click, Code Block Copy Button, Bypass Redirect Interstitials, Alt+Hover Image Zoom, and clean-reading presets—ready immediately without configuring any AI key.
5. **Standard `.user.js` Interoperability & Zero-Server `#PC1:...#` Sharing**
   Export any CSS or JS mod as a standard `// ==UserScript==` (`.user.js`) file in one click, paste-import existing userscripts, share compact `#PC1:...#` client-decoded shortcodes, and back up or restore your library as JSON.
6. **100% Serverless & Zero Telemetry Guarantee**
   PageCraft operates zero backend servers, requires zero accounts, and sends zero analytics or feedback pings. All mods and keys remain in `chrome.storage.local`, and outbound page landmarks and DOM snippets are scrubbed client-side for emails, API tokens, long numeric IDs, URL query strings, and password inputs.

#### Official Links & Support
- **Official Website**: https://pagecraft.shenxin.space
- **Interactive Sandbox**: https://pagecraft.shenxin.space/playground
- **Privacy Policy**: https://pagecraft.shenxin.space/privacy
- **GitHub Repository & Issues**: https://github.com/botshen/pagecraft/issues
- **Support Email**: botzgbj@gmail.com

---

## 3. Chrome Web Store & Edge Privacy / Permission Justifications (审核后台填写项)

- **Official Website**: `https://pagecraft.shenxin.space`
- **Privacy Policy URL**: `https://pagecraft.shenxin.space/privacy`
- **Developer Contact / Support Email**: `botzgbj@gmail.com`
- **Single Purpose Description**:
  > User-directed webpage layout customizer and MV3 userscript runtime: PageCraft lets users customize the appearance and functionality of websites they choose using local CSS rules and isolated JavaScript userscripts authored or enabled via the Side Panel.
- **`sidePanel`**:
  > Displays the persistent PageCraft customization studio next to the active webpage while the user selects page elements, previews CSS changes, and manages saved rules.
- **`storage`**:
  > Persists the user's saved CSS customizations, userscripts, UI preferences, and optional BYOK/MCP settings locally in `chrome.storage.local`.
- **`tabs`**:
  > Reads the active tab URL to scope newly generated `@match` patterns to the current site, listens for tab/SPA URL updates (`tabs.onUpdated`) strictly to apply or remove matching user-enabled CSS rules, and supports user-initiated viewport context capture when Multimodal Vision is enabled.
- **`scripting` + `host_permissions (<all_urls>)`**:
  > Persistent user-saved CSS/JS rules must apply automatically on any user-chosen website upon page load without clicking the toolbar icon (`activeTab` expires on navigation). Also injects the on-demand Shadow-DOM Element Picker and live selector hit verification strictly when initiated by the user. Zero background tracking scripts are injected.
- **`userScripts`**:
  > Registers and executes user-enabled JavaScript userscripts strictly inside Chrome's official MV3 `chrome.userScripts` isolated `USER_SCRIPT` world (`csp: "script-src 'self'", messaging: false`), gated behind the browser's per-extension "Allow User Scripts" toggle.
- **Remote Code**:
  > **No** remote code is fetched or executed. PageCraft uses the official MV3 `chrome.userScripts` API (`USER_SCRIPT` world with `csp: "script-src 'self'", messaging: false`), never downloads or evaluates remote `@require` scripts or remote configuration code, bundles all 10 built-in recipes statically at build time, and stores all user rules locally in `chrome.storage.local`.
- **Data Usage Disclosure**:
  > PageCraft operates **100% client-side with ZERO PageCraft servers, ZERO accounts, and ZERO telemetry or feedback pings**. Leave all personal/history/activity boxes unchecked; if disclosing user-initiated AI processing under **Website Content**, include: *"PageCraft operates zero backend servers and collects zero data. Only when the user explicitly clicks Generate or Refine, client-side PII-redacted page landmarks and the picked element's structural DOM snippet (plus an optional in-memory viewport snapshot if enabled) are processed locally on-device (Chrome Built-in Gemini Nano, local Ollama/LM Studio, or local 127.0.0.1 MCP bridge) or sent directly over HTTPS from the user's browser to the third-party BYOK API provider configured by the user."*
