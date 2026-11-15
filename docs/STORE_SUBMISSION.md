# PageCraft 上架提交清单（Chrome Web Store + Edge 加载项 · 100% 无服务端架构）

> 上架包：`pnpm zip` 生成 `.output/pagecraft-0.1.0-chrome.zip`。Chrome 和 Edge **共用同一个 zip**。
> 上架图：`store-assets/`（由 `store-assets/harness/capture.mjs` 生成）。
> 文案：[CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) · 官网（Cloudflare Pages 静态站）：https://pagecraft.shenxin.space · 隐私政策：https://pagecraft.shenxin.space/privacy · 练习靶场：https://pagecraft.shenxin.space/playground · 联系邮箱：`botzgbj@gmail.com`

## 0. 提交前必须完成（阻塞项）

- [ ] **验证静态官网与隐私政策页在线可访问（Cloudflare Pages）**：确认 `site/` 已部署至 Cloudflare Pages（`pagecraft` 项目），且 `node scripts/build-site.mjs --check` 通过。浏览器无痕打开 `https://pagecraft.shenxin.space/`、`https://pagecraft.shenxin.space/privacy/` 与 `https://pagecraft.shenxin.space/playground/` 均返回 HTTP 200，无外链追踪器。
- [ ] **确认 100% 零服务端、零遥测合规**：PageCraft 不再包含任何云端代理后端、无账号体系、无任何遥测或 👍/👎 反馈上报请求。开箱免配置体验由 **10 款内置一键配方**、**`/playground/` 20 秒免网络练习靶场** 以及 **Chrome 内置 AI（Gemini Nano）** 提供，同时支持 **Ollama / LM Studio 本地离线模型**、**Direct BYOK（OpenAI / Anthropic / DeepSeek / OpenRouter）** 与 **`pagecraft-mcp`（`127.0.0.1` 本地智能体桥接）**。
- [ ] **跑完 [LAUNCH_TEST_PLAN.md](./LAUNCH_TEST_PLAN.md)**，10 个真实网站用例成功率 ≥ 60%。
- [ ] **确认开发者联系邮箱验证**：统一使用 `botzgbj@gmail.com`（已在 `PRIVACY.md`、静态官网 `site/` 与 `CHROME_STORE_LISTING.md` 同步），在 Chrome Web Store 开发者后台 Account 页面确认该联系邮箱已完成验证码校验；仓库反馈地址统一指向 `https://github.com/botshen/pagecraft/issues`。
- [ ] **版本号检查**：首次提交或每次更新前确认 `wxt.config.ts` 与 `package.json` 中的 `version` 已递增。

---

## 1. Chrome Web Store

后台：https://chrome.google.com/webstore/devconsole（首次注册需要一次性支付 $5）

### 1.1 商品详情（Store listing）
| 字段 | 填写内容 |
| :--- | :--- |
| 语言 | 默认：中文（简体）；再添加 English |
| 名称 / 摘要 | 从 `_locales` 自动读取（严格遵守名称 `<= 45` 字符、摘要 `<= 132` 字符规范） |
| 详细说明 | [CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) 第 2.1 节（中文）与第 2.2 节（英文） |
| 类别 | 工作流程与规划（Workflow & Planning），或「开发者工具」 |
| 图标 | 包内 `icon/128.png` 自动读取 |
| 屏幕截图 | `store-assets/zh/screenshot-1..5.png`（英文区：`store-assets/en/screenshot-*.png`），1280×800 |
| 小型宣传图块 | `store-assets/promo-small-440x280.png` |
| 顶部宣传图块 | `store-assets/promo-marquee-1400x560.png`（选填） |
| 官方网站 URL | `https://pagecraft.shenxin.space` |
| 支持邮箱 / 开发者联系邮箱 | `botzgbj@gmail.com` |

### 1.2 隐私权（Privacy practices）
- **单一用途**：复制 [CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) 第 3 节 *Single Purpose Description*
- **权限理由**：`sidePanel`、`storage`、`tabs`、`scripting`、`host_permissions`、`userScripts` 逐条复制第 3 节对应英文说明
- **远程代码（Remote code）**：选 **否（No, I am not using Remote code）**。PageCraft 严格通过官方 MV3 `chrome.userScripts` API（隔离世界 `USER_SCRIPT`，强制 `csp: "script-src 'self'", messaging: false`）执行用户启用的本地脚本，绝不拉取或执行远程 `@require` 外部依赖、`GM_xmlhttpRequest` 跨站代理或任何远程配置脚本；10 款内置方案均在构建期静态打包，用户规则全部保存在本地 `chrome.storage.local`。
- **数据使用（Data usage Checkboxes — 100% 零服务端对齐 `PRIVACY.md`）**：
  - PageCraft **100% 纯客户端本地运行，无任何官方后端服务器、无账号系统、无遥测或反馈请求**。
  - 所有个人身份信息、健康、财务、身份验证信息、个人通讯、位置、网络历史记录、用户活动均 **不收集（全部不勾选）**。
  - 若需声明用户主动发起 BYOK AI 生成时对当前页面结构的处理，参考 [CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) 第 3 节 *Data Usage Disclosure* 说明：仅在用户主动点击生成/微调时，经客户端 PII 脱敏后的页面结构片段在本机处理（Chrome Built-in Gemini Nano / 本地 Ollama / `127.0.0.1` MCP），或由浏览器直连用户自行配置的第三方 BYOK API，绝不经过任何 PageCraft 服务器。
  - ✅ **勾选底部三项合规承诺**：不出售给第三方；不用于与单一用途无关的目的；不用于信用评估或借贷用途。
- **隐私权政策网址**：`https://pagecraft.shenxin.space/privacy`

### 1.3 分发
- 公开范围：建议选 **公开（Public）**
- 地区：所有地区
- 如有 EU DSA 交易商声明：开源非商业项目，选「非交易商（Non-trader）」（联系邮箱填 `botzgbj@gmail.com`）

### 1.4 审核注意与审核员备注（Reviewer Notes — 必填！）
`<all_urls>` 加 `userScripts` 属于重点人工审核权限。务必在后台 **"Additional instructions for reviewers / 给审核员的备注"** 粘贴以下说明：

> **100% Serverless, Zero-Telemetry & MV3 `chrome.userScripts` Compliance**:
> - PageCraft operates **100% client-side with ZERO PageCraft servers, ZERO user accounts, and ZERO telemetry/analytics pings**. All mods and settings stay locally in `chrome.storage.local`.
> - **Zero Remote Code**: PageCraft strictly uses the official Manifest V3 `chrome.userScripts` API in an isolated `USER_SCRIPT` world configured with `csp: "script-src 'self'"` and `messaging: false`. It NEVER fetches, downloads, or evaluates remote code, external `@require` scripts, or remote dynamic configuration. All 10 built-in recipes are bundled statically at build time.
>
> **Instant Zero-Account Reviewer Testing (No API Key Required)**:
> Official static site: `https://pagecraft.shenxin.space` | Sandbox: `https://pagecraft.shenxin.space/playground` | Privacy Policy: `https://pagecraft.shenxin.space/privacy` | Support: `botzgbj@gmail.com`.
> 1. **Test Engine 1 (Instant CSS — zero toggles & zero API keys required)**: Open `https://pagecraft.shenxin.space/playground` → click the PageCraft toolbar icon to open the Side Panel → click "Pick Element" → click the dashed promo banner (`#pc-demo-banner`) or right sidebar (`#pc-demo-sidebar`) → click "Generate Mod" → click "Apply & Save" (applies deterministically in 0.1s via `chrome.scripting.insertCSS`), or click any of the 10 Built-in Recipes in the Side Panel.
> 2. **Test Engine 2 (MV3 JS Userscripts)**: Enable Chrome/Edge's per-extension "Allow User Scripts" toggle on `chrome://extensions` → apply the built-in "One-Click Table to CSV / Excel" recipe on `https://pagecraft.shenxin.space/playground` to mount an Export CSV button onto `#pc-demo-table`.
> 3. **Optional AI Modes**: Supports Chrome Built-in AI (Gemini Nano on-device), local Ollama/LM Studio (`localhost`), Direct BYOK (OpenAI/Anthropic/DeepSeek/OpenRouter), and local `pagecraft-mcp` (`127.0.0.1`).

---

## 2. Microsoft Edge 加载项

后台：https://partner.microsoft.com/dashboard/microsoftedge（免费注册）

| 字段 | 填写内容 |
| :--- | :--- |
| 程序包 | 同一个 `pagecraft-0.1.0-chrome.zip` |
| 可用性 | 公开；市场选全部 |
| 类别 | 生产力（Productivity）或开发人员工具（Developer Tools） |
| 官方网站 URL | `https://pagecraft.shenxin.space` |
| 隐私政策 URL | `https://pagecraft.shenxin.space/privacy` |
| 支持联系方式（邮箱） | `botzgbj@gmail.com` |
| 商店列表语言 | 中文（简体）为主，加 English |
| 说明 | 同 [CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) 第 2.1 / 2.2 节（满足不少于 250 字符要求） |
| 扩展徽标 | `store-assets/edge-logo-300x300.png`（300×300，无透明通道 24-bit RGB） |
| 小型宣传图块 | `store-assets/promo-small-440x280.png` |
| 屏幕截图 | `store-assets/zh/*.png`（英文：`store-assets/en/*.png`，1280×800） |
| 测试说明（Notes for certification） | 直接复制上方 1.4 节英文 **Reviewer Notes** |

**Edge 提交前实测**：
- [ ] 侧边栏正常打开，顶栏品牌图标清晰显示
- [ ] JS 脚本引导页可跳转到 `edge://extensions/?id=` 详情页，开启「允许用户脚本」后 JS 配方立即生效

---

## 3. 发布后维护清单

- 每次修改 `PRIVACY.md` 或 `site/` 后，CI 中的 `node scripts/build-site.mjs --check` 会自动校验静态隐私页是否已同步更新；合并到 `main` 后执行 `pnpm site:deploy`（或通过 Cloudflare Git 自动构建）发布 `site/` 静态资产至 `pagecraft.shenxin.space`。
- 商店审核通过后，把 Chrome Web Store 与 Microsoft Edge Add-ons 官方安装链接同步更新到 `site/index.html`、`README.md` 与 `README.zh-CN.md`。
