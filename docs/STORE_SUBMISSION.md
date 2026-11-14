# PageCraft 上架提交清单（Chrome Web Store + Edge 加载项）

> 上架包：`pnpm zip` 生成 `.output/pagecraft-0.1.0-chrome.zip`。Chrome 和 Edge **用同一个 zip**。
> 上架图：`store-assets/`（由 `store-assets/harness/capture.mjs` 生成）。
> 文案：[CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) · 官网：https://pagecraft.shenxin.space · 隐私政策：https://pagecraft.shenxin.space/privacy · 联系邮箱：`botzgbj@gmail.com`

## 0. 提交前必须完成（阻塞项）

- [ ] **部署云端 Worker 与开启管理后台**：执行数据库迁移与部署（`cd workers/cloud && pnpm d1:migrate:remote && pnpm deploy`），并设置管理后台口令 `npx wrangler secret put ADMIN_TOKEN`（至少 16 位字符）。
- [ ] **配置云端 LLM Key、全局日限额熔断与验证连通性**：打开浏览器访问 Web 管理后台 `https://pagecraft.shenxin.space/admin`（使用 `ADMIN_TOKEN` 登录），在线填入 DeepSeek API Key（加密存入 D1，实时覆盖 `PRIMARY_LLM_API_KEY`）、确认全站每日云端调用熔断上限（`daily_global_limit`，默认 2000 次/天防刷保底）、点击**测试连接**并确认 **DeepSeek 余额**充足。不设置 Key 的话，新用户的免费 10 次生成会返回 `llm_not_configured`，审核员实测会失败。
- [ ] **跑完 [LAUNCH_TEST_PLAN.md](./LAUNCH_TEST_PLAN.md)**，成功率 ≥ 60%。
- [ ] **确认开发者联系邮箱验证**：统一使用 `botzgbj@gmail.com`（已在 `PRIVACY.md`、官网 `https://pagecraft.shenxin.space`、隐私页 `https://pagecraft.shenxin.space/privacy` 与扩展设置页同步），在 Chrome Web Store 开发者后台 Account 页面确认该联系邮箱已完成验证码校验。
- [ ] **版本号检查**：首次提交用 `0.1.0`。以后每次重新提交都要先改 `wxt.config.ts` 和 `package.json` 里的 `version`。

---

## 1. Chrome Web Store

后台：https://chrome.google.com/webstore/devconsole（首次注册需要一次性支付 \$5）

### 1.1 商品详情（Store listing）
| 字段 | 填写内容 |
| :--- | :--- |
| 语言 | 默认：中文（简体）；再添加 English |
| 名称 / 摘要 | 从 `_locales` 自动读取（`zh_CN`：`34/45` 与 `125/132` 字符；`en`：`45/45` 与 `132/132` 字符），无需手填 |
| 详细说明 | [CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) 第 2.1 节（中文）与第 2.2 节（英文） |
| 类别 | 工作流程与规划（Workflow & Planning），或"开发者工具" |
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
- **数据使用（Data usage Checkboxes — 必须与抓包行为及 `PRIVACY.md` 100% 对齐）**：
  - ✅ **必须勾选「网站内容（Website Content）」**：审核员会实测抓包检查 `/api/generate` 请求体！仅在免费云端体验模式下且用户**主动点击「生成改造 / 继续微调」**时，扩展才会把用户的文字指令、脱敏后的当前站点域名路径提示、客户端脱敏后的页面标题（`pageTitle`）、页面结构地标摘要（标题/按钮/容器选择器）以及所选元素的局部 DOM 结构片段发往 `https://pagecraft.shenxin.space/api/generate` 实时生成规则。所有文本在浏览器端已自动抹除邮箱、`sk-...`/`Bearer` 密钥、长数字编号、URL 查询参数与密码框内容，且服务端数据库绝不存储任何 Prompt 或页面片段。在「自带 API Key（BYOK）」模式或日常浏览自动加载已存本地规则时，**零请求发往我们的服务器**。
  - ❌ **其余全部不勾选**（个人身份信息、健康、财务、身份验证信息、个人通讯、位置、网络历史记录、用户活动）：均不收集（用户自带的 API Key 仅保存在本地 `chrome.storage.local`；可选的 👍/👎 反馈仅按日聚合匿名计数，不含网址、Prompt 或用户标识，详见 [PRIVACY.md](../PRIVACY.md)）。
  - ✅ **勾选底部三项合规承诺**：不出售给第三方；不用于与单一用途无关的目的；不用于信用评估或借贷用途。
- **隐私权政策网址**：`https://pagecraft.shenxin.space/privacy`

### 1.3 分发
- 公开范围：建议选 **公开（Public）**。若先小范围验证，可选"不公开（Unlisted）"，凭链接安装
- 地区：所有地区
- 如有 EU DSA 交易商声明：个人开发者、不收费，选"非交易商（Non-trader）"（联系邮箱填 `botzgbj@gmail.com`）

### 1.4 审核注意与审核员备注（Reviewer Notes — 必填！）
- `<all_urls>` 加 `userScripts` 属于高关注度权限，首次人工审核通常需 2–5 个工作日。务必在后台 **"Additional instructions for reviewers / 给审核员的备注"** 粘贴以下完整说明（明确声明 MV3 `chrome.userScripts` 零远程代码合规性与测试路径）：
  > **Zero Remote Code & MV3 `chrome.userScripts` Compliance**: PageCraft strictly uses the official Manifest V3 `chrome.userScripts` API in an isolated `USER_SCRIPT` world configured with `csp: "script-src 'self'"` and `messaging: false`. It NEVER fetches, downloads, or evaluates remote code, external `@require` scripts, or remote dynamic configuration. All 10 built-in recipes are bundled statically at build time, and all user-authored or user-imported CSS/JS modifications are stored locally in `chrome.storage.local`.
  >
  > **Out-of-the-Box Testing (No Account Needed)**: Every fresh install includes 10 free cloud AI generations plus a zero-credit interactive sandbox (`https://pagecraft.shenxin.space/playground`). Official website: `https://pagecraft.shenxin.space` | Privacy policy: `https://pagecraft.shenxin.space/privacy` | Support: `botzgbj@gmail.com`.
  > - **Test Engine 1 (Instant CSS — zero toggles required)**: Open any webpage → click the PageCraft toolbar icon to open the Side Panel → click "Pick element" → click any sidebar or banner → type "hide this" → click "Generate Mod" → click "Apply & Save" (applies immediately via `chrome.scripting.insertCSS`).
  > - **Test Engine 2 (MV3 JS Userscripts)**: Interactive DOM tools (e.g., the built-in "One-Click Table to CSV / Excel" recipe) require enabling Chrome/Edge's per-extension "Allow User Scripts" toggle, which the Side Panel guides the user to enable in one click.

---

## 2. Microsoft Edge 加载项

后台：https://partner.microsoft.com/dashboard/microsoftedge（免费注册）

| 字段 | 填写内容 |
| :--- | :--- |
| 程序包 | 同一个 `pagecraft-0.1.0-chrome.zip` |
| 可用性 | 公开；市场选全部，或至少包含中国 |
| 类别 | 生产力（Productivity） |
| 官方网站 URL | `https://pagecraft.shenxin.space` |
| 隐私政策 URL | `https://pagecraft.shenxin.space/privacy` |
| 支持联系方式（邮箱） | `botzgbj@gmail.com` |
| 商店列表语言 | 中文（简体）为主，加 English |
| 说明 | 同 [CHROME_STORE_LISTING.md](../CHROME_STORE_LISTING.md) 第 2.1 / 2.2 节（Edge 要求说明不少于 250 字符） |
| 扩展徽标 | `store-assets/edge-logo-300x300.png`（300×300，无透明通道 24-bit RGB） |
| 小型宣传图块 | `store-assets/promo-small-440x280.png` |
| 屏幕截图 | `store-assets/zh/*.png`（英文：`store-assets/en/*.png`，1280×800，最多 10 张） |
| 测试说明（Notes for certification） | 直接复制上方 1.4 节英文 **Reviewer Notes**（含 MV3 `chrome.userScripts` 零远程代码说明与实测步骤） |

**Edge 提交前实测**（Edge 基于 Chromium 138+，`sidePanel` 和 `userScripts` 均原生支持）：
- [ ] 侧边栏能正常打开，顶栏品牌图标清晰显示
- [ ] JS 脚本引导页能直接跳转到 `edge://extensions/?id=` 详情页（代码自动识别 Edge 并使用 `edge://` 协议，开启后自动切回原标签页），开启后 JS 配方（如"网页表格一键导出 Excel / CSV"）立即生效

---

## 3. 上架后运营与监控

- **Web 运营管理后台（推荐）**：浏览器打开 `https://pagecraft.shenxin.space/admin`（由 `ADMIN_TOKEN` 鉴权保护）：
  - **在线管理 LLM Key、余额与全站日熔断阈值**：随时在网页端设置或更换 DeepSeek / 硅基流动 / OpenAI / OpenRouter API Key 与模型（AES-GCM 加密存储于 D1，实时覆盖 `PRIMARY_LLM_API_KEY`，无需重发 Worker），在线查看与调整全站每日免费生成上限（`daily_global_limit`），一键测试连通性并查看 **DeepSeek 账户实时余额**。
  - **历史运营指标看板**：支持 `7天 / 28天 / 90天` 切换查看新增安装量、激活率、免费额度耗尽人数、云端生成成功率、Token 消耗与平均耗时、最近调用记录，以及匿名 👍/👎 满意度与分引擎/选择器命中率拆解。
- **终端命令行看板**：也可随时执行 `cd workers/cloud && pnpm stats 7` 在终端快速拉取近 7 天汇总指标。
- 审核通过后，把 Chrome / Edge 官方商店安装链接同步补充到 [README.md](../README.md)、[README.zh-CN.md](../README.zh-CN.md) 与官网落地页。
