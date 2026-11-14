/**
 * PageCraft Cloud — Operator Web Console (`/admin`).
 *
 * Self-contained HTML/CSS/JS served under strict `Content-Security-Policy`:
 *   default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
 *   connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'
 *
 * Palette matches PageCraft's warm editorial aesthetic:
 *   Background `#faf8f5` · Ink `#1c1917` · Terracotta accent `#c95533`
 *
 * Security: All API strings are rendered via `textContent` / DOM nodes; `innerHTML`
 * is never used with untrusted or external strings.
 */

import { FAVICON_DATA_URI, renderBrandIconSvg } from '../lib/brand';

const SHARED_CSS = `
:root {
  --bg: #faf8f5;
  --bg-elev: #ffffff;
  --bg-soft: #f3efe8;
  --ink: #1c1917;
  --ink-2: #57534e;
  --mut: #78716c;
  --line: #e7e2d8;
  --line-strong: #d6cfc2;
  --acc: #c95533;
  --acc-hover: #b24627;
  --acc-soft: rgba(201, 85, 51, 0.10);
  --acc-ink: #ffffff;
  --ok: #1f7a4c;
  --ok-soft: rgba(31, 122, 76, 0.11);
  --warn: #b45309;
  --warn-soft: rgba(180, 83, 9, 0.12);
  --bad: #b91c1c;
  --bad-soft: rgba(185, 28, 28, 0.10);
  --shadow: 0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px rgba(28, 25, 23, 0.04);
  --mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  --serif: ui-serif, "New York", Georgia, "Songti SC", serif;
  --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background:
    radial-gradient(960px 420px at 88% -8%, rgba(201, 85, 51, 0.08), transparent 68%),
    radial-gradient(760px 360px at 8% -12%, rgba(217, 119, 87, 0.06), transparent 65%),
    var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
code, .mono { font-family: var(--mono); }
button, input, select { font-family: inherit; }
`;

export const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · PageCraft 运营控制台</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<style>
${SHARED_CSS}
body {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.login-shell {
  width: min(400px, 100%);
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 32px 28px 28px;
  box-shadow: var(--shadow);
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 6px rgba(201, 85, 51, 0.24));
}
.brand-meta { display: flex; flex-direction: column; }
.brand-title { font-weight: 700; font-size: 15px; color: var(--ink); }
.brand-sub { font-size: 12px; color: var(--mut); }
h1 {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 6px;
  letter-spacing: -0.01em;
}
p.desc {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--ink-2);
}
form { display: grid; gap: 12px; }
label { font-size: 12px; font-weight: 600; color: var(--ink-2); }
input[type="password"] {
  width: 100%;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input[type="password"]:focus {
  border-color: var(--acc);
  box-shadow: 0 0 0 3px var(--acc-soft);
  background: #fff;
}
button.primary {
  margin-top: 4px;
  padding: 10px 16px;
  border: 0;
  border-radius: 9px;
  background: var(--acc);
  color: var(--acc-ink);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
button.primary:hover { background: var(--acc-hover); }
.err {
  margin: 0 0 12px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 13px;
  border: 1px solid rgba(185, 28, 28, 0.2);
}
.foot {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--mut);
}
</style>
</head>
<body>
<div class="login-shell">
  <div class="brand-row">
    <span class="brand-mark">${renderBrandIconSvg(34, 'pcg-login')}</span>
    <div class="brand-meta">
      <span class="brand-title">PageCraft Cloud</span>
      <span class="brand-sub">pagecraft.shenxin.space · 运营后台</span>
    </div>
  </div>
  <h1>管理员验证</h1>
  <p class="desc">输入 <code>ADMIN_TOKEN</code> 登录控制台，在线管理 LLM 密钥、全站每日成本熔断上限并查看匿名聚合指标。</p>
  <!--ERR-->
  <form method="post" action="/admin/login">
    <div>
      <label for="token-input">管理员令牌 (ADMIN_TOKEN)</label>
      <input id="token-input" type="password" name="token" placeholder="至少 16 位管理员密钥" autocomplete="current-password" required autofocus>
    </div>
    <button class="primary" type="submit">进入控制台</button>
  </form>
  <div class="foot">零行为遥测架构 · 仅统计匿名配额、Token 账本与 👍/👎 日聚合</div>
</div>
</body>
</html>`;

export const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PageCraft Cloud · 运营控制台</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<style>
${SHARED_CSS}
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(250, 248, 245, 0.90);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.topbar-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: auto;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 5px rgba(201, 85, 51, 0.22));
}
.brand h1 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.01em;
}
.privacy-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-soft);
  color: var(--ink-2);
  border: 1px solid var(--line);
}
.seg {
  display: inline-flex;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 2px;
}
.seg button {
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 11px;
  border-radius: 6px;
  cursor: pointer;
}
.seg button.active {
  background: var(--bg-elev);
  color: var(--acc);
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.08);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg-elev);
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s;
}
.btn:hover:not(:disabled) { border-color: var(--ink-2); background: #fff; }
.btn:disabled { opacity: 0.52; cursor: not-allowed; }
.btn.primary {
  background: var(--acc);
  border-color: var(--acc);
  color: var(--acc-ink);
}
.btn.primary:hover:not(:disabled) {
  background: var(--acc-hover);
  border-color: var(--acc-hover);
}
.btn.ghost-danger {
  color: var(--bad);
  border-color: rgba(185, 28, 28, 0.28);
}
.btn.ghost-danger:hover:not(:disabled) {
  background: var(--bad-soft);
  border-color: var(--bad);
}

main {
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 20px 64px;
  display: grid;
  gap: 20px;
}
.card {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: var(--shadow);
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.card-title {
  margin: 0;
  font-size: 15.5px;
  font-weight: 700;
  color: var(--ink);
}
.card-sub {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--mut);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.badge.d1 { background: var(--acc-soft); color: var(--acc); }
.badge.env { background: var(--ok-soft); color: var(--ok); }
.badge.none { background: var(--warn-soft); color: var(--warn); }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.badge.err { background: var(--bad-soft); color: var(--bad); }

.llm-meta-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--line);
  margin-bottom: 14px;
}
.llm-meta-left, .llm-meta-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12.5px;
}
.balance-val {
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.presets {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.presets .label {
  font-size: 12px;
  color: var(--mut);
  margin-right: 2px;
}
.preset-chip, .cap-chip {
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink-2);
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.13s;
}
.preset-chip:hover, .cap-chip:hover {
  border-color: var(--acc);
  color: var(--acc);
  background: var(--acc-soft);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 820px) {
  .form-grid {
    grid-template-columns: 1.3fr 0.9fr 1.3fr;
  }
}
.field { display: flex; flex-direction: column; gap: 5px; }
.field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.field input {
  width: 100%;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font-size: 13px;
  outline: none;
}
.field input:focus {
  border-color: var(--acc);
  background: #fff;
  box-shadow: 0 0 0 3px var(--acc-soft);
}
.key-wrap {
  display: flex;
  gap: 6px;
}
.key-wrap input { flex: 1; }

.llm-actions {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.status-msg {
  font-size: 12.5px;
  margin-left: 4px;
}
.status-msg.ok { color: var(--ok); font-weight: 600; }
.status-msg.err { color: var(--bad); font-weight: 600; }
.status-msg.mut { color: var(--mut); }

.cap-panel {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed var(--line-strong);
  display: grid;
  gap: 12px;
}
.cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.cap-progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--bg-soft);
  overflow: hidden;
  border: 1px solid var(--line);
}
.cap-progress-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  background: var(--ok);
  transition: width 0.2s ease, background 0.2s ease;
}
.cap-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cap-controls input {
  width: 136px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font-size: 13px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 12px;
}
.kpi {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 15px 16px;
  box-shadow: var(--shadow);
}
.kpi .k-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--mut);
}
.kpi .k-val {
  margin-top: 6px;
  font-size: 25px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.kpi .k-val.accent { color: var(--acc); }
.kpi .k-sub {
  margin-top: 5px;
  font-size: 12px;
  color: var(--ink-2);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 860px) {
  .two-col {
    grid-template-columns: 1fr 1fr;
  }
}

.bars-box {
  height: 150px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  padding: 12px 4px 4px;
  border-bottom: 1px solid var(--line);
}
.bar-col {
  flex: 1;
  min-width: 4px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 1px;
  position: relative;
}
.bar-seg {
  width: 100%;
  border-radius: 3px 3px 0 0;
  min-height: 0;
  transition: height 0.2s;
}
.bar-seg.gen-ok { background: var(--acc); }
.bar-seg.gen-err { background: var(--bad); }
.bar-seg.fb-up { background: var(--ok); }
.bar-seg.fb-down { background: #d97757; opacity: 0.75; }
.bars-axis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--mut);
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.legend {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--mut);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}

.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th, td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
th {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mut);
  background: var(--bg);
  white-space: nowrap;
}
tbody tr:hover { background: rgba(201, 85, 51, 0.035); }
.tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--bg-soft);
  color: var(--ink-2);
}
.rate-bar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rate-track {
  width: 68px;
  height: 6px;
  background: var(--bg-soft);
  border-radius: 999px;
  overflow: hidden;
}
.rate-fill {
  height: 100%;
  background: var(--ok);
  border-radius: 999px;
}
.empty-row {
  text-align: center;
  padding: 24px 12px;
  color: var(--mut);
  font-size: 13px;
}
.err-banner {
  display: none;
  padding: 11px 15px;
  border-radius: 10px;
  background: var(--bad-soft);
  color: var(--bad);
  border: 1px solid rgba(185, 28, 28, 0.22);
  font-size: 13px;
}
.err-banner.show { display: block; }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <span class="brand-mark">${renderBrandIconSvg(30, 'pcg-admin')}</span>
      <h1>PageCraft Cloud · 运营控制台</h1>
      <span class="privacy-pill">零隐私遥测 · 仅聚合计数</span>
    </div>
    <div class="seg" id="days-seg" role="group" aria-label="时间窗口">
      <button type="button" data-days="7">近 7 天</button>
      <button type="button" data-days="28" class="active">近 28 天</button>
      <button type="button" data-days="90">近 90 天</button>
    </div>
    <button type="button" class="btn" id="btn-refresh">刷新数据</button>
    <button type="button" class="btn" id="btn-logout">退出登录</button>
  </div>
</header>

<main>
  <div id="global-err" class="err-banner"></div>

  <!-- (a) Online LLM Key & Global Daily Cost Circuit-Breaker Card -->
  <section class="card" aria-labelledby="llm-card-title">
    <div class="card-head">
      <div>
        <h2 class="card-title" id="llm-card-title">LLM 密钥与模型在线配置</h2>
        <p class="card-sub">保存后立即对免费云端试用接口 (<code>/api/generate</code>) 生效，API Key 使用 AES-256-GCM 加密存储于 D1。</p>
      </div>
      <span id="llm-source-badge" class="badge none">加载中…</span>
    </div>

    <div class="llm-meta-bar">
      <div class="llm-meta-left">
        <span>当前密钥：<strong class="mono" id="llm-masked-key">—</strong></span>
        <span id="llm-updated-at" style="color:var(--mut)"></span>
      </div>
      <div class="llm-meta-right">
        <span>DeepSeek 账户余额：<span class="balance-val" id="llm-balance-text">查询中…</span></span>
        <button type="button" class="btn" id="btn-balance" style="padding:4px 9px;font-size:12px">刷新余额</button>
      </div>
    </div>

    <div class="presets">
      <span class="label">快速填充预设：</span>
      <button type="button" class="preset-chip" data-base="https://api.deepseek.com/v1" data-model="deepseek-chat">DeepSeek 官方</button>
      <button type="button" class="preset-chip" data-base="https://api.siliconflow.cn/v1" data-model="deepseek-ai/DeepSeek-V3">SiliconFlow 硅基流动</button>
      <button type="button" class="preset-chip" data-base="https://api.openai.com/v1" data-model="gpt-4o-mini">OpenAI</button>
      <button type="button" class="preset-chip" data-base="https://openrouter.ai/api/v1" data-model="deepseek/deepseek-chat">OpenRouter</button>
    </div>

    <div class="form-grid">
      <div class="field">
        <label for="inp-base-url">接口地址 (Base URL)</label>
        <input id="inp-base-url" type="url" class="mono" placeholder="https://api.deepseek.com/v1" spellcheck="false">
      </div>
      <div class="field">
        <label for="inp-model">模型名称 (Model)</label>
        <input id="inp-model" type="text" class="mono" placeholder="deepseek-chat" spellcheck="false">
      </div>
      <div class="field">
        <label for="inp-api-key">API Key（留空则保留已保存密钥）</label>
        <div class="key-wrap">
          <input id="inp-api-key" type="password" class="mono" placeholder="sk-..." autocomplete="off" spellcheck="false">
          <button type="button" class="btn" id="btn-toggle-key">显示</button>
        </div>
      </div>
    </div>

    <div class="llm-actions">
      <button type="button" class="btn primary" id="btn-save-llm">保存并立即生效</button>
      <button type="button" class="btn" id="btn-test-llm">测试连通性</button>
      <button type="button" class="btn ghost-danger" id="btn-clear-llm" style="display:none">清除网页覆盖（恢复环境变量）</button>
      <span id="llm-action-status" class="status-msg mut"></span>
    </div>

    <!-- Global Daily Generation Circuit-Breaker (daily_global_limit) -->
    <div class="cap-panel" aria-labelledby="cap-title">
      <div class="cap-row">
        <div>
          <strong id="cap-title" style="font-size:13.5px">全站每日熔断上限 (daily_global_limit)</strong>
          <span id="cap-summary-text" class="mono" style="margin-left:10px;font-size:12.5px;color:var(--ink-2)">今日已用 — / — 次</span>
        </div>
        <span id="cap-source-badge" class="badge env">默认 2,000/天</span>
      </div>
      <div class="cap-progress-track">
        <div id="cap-progress-fill" class="cap-progress-fill"></div>
      </div>
      <div class="cap-controls">
        <label for="inp-daily-limit" style="font-size:12px;font-weight:600;color:var(--ink-2)">单日最大调用数：</label>
        <input id="inp-daily-limit" type="number" min="0" max="10000000" step="100" class="mono" placeholder="2000">
        <button type="button" class="cap-chip" data-cap="500">500</button>
        <button type="button" class="cap-chip" data-cap="2000">2,000</button>
        <button type="button" class="cap-chip" data-cap="5000">5,000</button>
        <button type="button" class="cap-chip" data-cap="10000">10,000</button>
        <button type="button" class="btn primary" id="btn-save-cap">保存上限</button>
        <button type="button" class="btn" id="btn-reset-cap" style="display:none">恢复默认</button>
        <span id="cap-status-msg" class="status-msg mut"></span>
      </div>
    </div>
  </section>

  <!-- (b) KPI Cards -->
  <section class="kpi-grid" aria-label="核心运营指标">
    <div class="kpi">
      <div class="k-label">累计注册安装</div>
      <div class="k-val" id="kpi-installs">—</div>
      <div class="k-sub" id="kpi-installs-sub">窗口内新增 —</div>
    </div>
    <div class="kpi">
      <div class="k-label">云端试用激活率</div>
      <div class="k-val accent" id="kpi-activation">—</div>
      <div class="k-sub" id="kpi-activation-sub">生成 ≥1 次安装数 —</div>
    </div>
    <div class="kpi">
      <div class="k-label">免费额度耗尽安装</div>
      <div class="k-val" id="kpi-exhausted">—</div>
      <div class="k-sub" id="kpi-exhausted-sub">已用满 10 次试用上限</div>
    </div>
    <div class="kpi">
      <div class="k-label">今日全站熔断水位</div>
      <div class="k-val" id="kpi-daily-cap">—</div>
      <div class="k-sub" id="kpi-daily-cap-sub">上限 — 次/天</div>
    </div>
    <div class="kpi">
      <div class="k-label">云端生成成功率</div>
      <div class="k-val" id="kpi-gen-ok">—</div>
      <div class="k-sub" id="kpi-gen-sub">成功 — / 总调用 —</div>
    </div>
    <div class="kpi">
      <div class="k-label">Token 消耗与延迟</div>
      <div class="k-val" id="kpi-tokens">—</div>
      <div class="k-sub" id="kpi-latency-sub">平均耗时 — ms</div>
    </div>
    <div class="kpi">
      <div class="k-label">👍 生成好评率</div>
      <div class="k-val" id="kpi-fb-rate">—</div>
      <div class="k-sub" id="kpi-fb-sub">👍 — · 👎 —</div>
    </div>
  </section>

  <!-- Daily Charts -->
  <section class="two-col">
    <div class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title">每日云端生成量</h2>
          <p class="card-sub">按 UTC 日期统计成功与失败调用次数</p>
        </div>
        <div class="legend">
          <span><i class="dot" style="background:var(--acc)"></i>成功</span>
          <span><i class="dot" style="background:var(--bad)"></i>失败</span>
        </div>
      </div>
      <div class="bars-box" id="chart-gen-bars"></div>
      <div class="bars-axis">
        <span id="chart-gen-start">—</span>
        <span id="chart-gen-peak">峰值 0</span>
        <span id="chart-gen-end">—</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title">每日效果反馈 (👍 / 👎)</h2>
          <p class="card-sub">用户对生成样式/脚本的匿名投票趋势</p>
        </div>
        <div class="legend">
          <span><i class="dot" style="background:var(--ok)"></i>👍 有效</span>
          <span><i class="dot" style="background:#d97757"></i>👎 待改进</span>
        </div>
      </div>
      <div class="bars-box" id="chart-fb-bars"></div>
      <div class="bars-axis">
        <span id="chart-fb-start">—</span>
        <span id="chart-fb-peak">峰值 0</span>
        <span id="chart-fb-end">—</span>
      </div>
    </div>
  </section>

  <!-- (c) Feedback Breakdown Table -->
  <section class="card">
    <div class="card-head">
      <div>
        <h2 class="card-title">反馈细分维度拆解 (feedback_daily)</h2>
        <p class="card-sub">按引擎 (CSS/JS)、AI 来源 (Cloud/BYOK)、是否二次精修与选择器命中状态聚合</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>引擎</th>
            <th>AI 来源</th>
            <th>二次精修</th>
            <th>选择器状态</th>
            <th>👍 好评</th>
            <th>👎 差评</th>
            <th>总票数</th>
            <th>好评率</th>
          </tr>
        </thead>
        <tbody id="tbody-feedback"></tbody>
      </table>
    </div>
  </section>

  <!-- (d) Recent llm_calls Table -->
  <section class="card">
    <div class="card-head">
      <div>
        <h2 class="card-title">最近 30 次云端生成账本 (llm_calls)</h2>
        <p class="card-sub">仅记录模型、Token 用量、耗时与状态码，绝不存储用户 Prompt 或网页域名</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>状态</th>
            <th>模型</th>
            <th>匿名安装摘要</th>
            <th>输入 / 输出 / 总 Tokens</th>
            <th>耗时</th>
            <th>错误信息</th>
          </tr>
        </thead>
        <tbody id="tbody-llm-calls"></tbody>
      </table>
    </div>
  </section>
</main>

<script>
(function () {
  var currentDays = 28;
  var $ = function (id) { return document.getElementById(id); };

  function fmtInt(n) {
    var v = Number(n || 0);
    return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '0';
  }
  function fmtCompact(n) {
    var v = Number(n || 0);
    if (!Number.isFinite(v)) return '0';
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
    return v.toLocaleString('zh-CN');
  }
  function fmtPct(num, den) {
    if (!den || den <= 0) return '—';
    return ((num / den) * 100).toFixed(1) + '%';
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    var pad = function (x) { return String(x).padStart(2, '0'); };
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function tdText(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function setStatus(msg, kind) {
    var el = $('llm-action-status');
    el.className = 'status-msg ' + (kind || 'mut');
    el.textContent = msg || '';
  }
  function setCapStatus(msg, kind) {
    var el = $('cap-status-msg');
    el.className = 'status-msg ' + (kind || 'mut');
    el.textContent = msg || '';
  }
  function setGlobalError(msg) {
    var box = $('global-err');
    if (!msg) {
      box.className = 'err-banner';
      box.textContent = '';
    } else {
      box.className = 'err-banner show';
      box.textContent = msg;
    }
  }

  async function apiJson(path, opts) {
    var res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    if (res.status === 401) {
      location.reload();
      throw new Error('会话已过期，正在重新登录');
    }
    var data = await res.json();
    if (!res.ok && (!data || data.ok === undefined)) {
      throw new Error('HTTP ' + res.status);
    }
    return { status: res.status, data: data };
  }

  function renderLlmConfig(cfg, populateInputs) {
    if (!cfg) return;
    var badge = $('llm-source-badge');
    if (cfg.source === 'd1') {
      badge.className = 'badge d1';
      badge.textContent = 'D1 网页在线配置生效中';
      $('btn-clear-llm').style.display = 'inline-flex';
    } else if (cfg.source === 'env') {
      badge.className = 'badge env';
      badge.textContent = '环境变量默认生效';
      $('btn-clear-llm').style.display = 'none';
    } else {
      badge.className = 'badge none';
      badge.textContent = '未配置 LLM 密钥';
      $('btn-clear-llm').style.display = 'none';
    }

    $('llm-masked-key').textContent = cfg.hasApiKey ? (cfg.maskedKey || '已设置') : '未设置';
    $('llm-updated-at').textContent = cfg.updatedAt ? ('更新于 ' + fmtTime(cfg.updatedAt)) : '';

    if (populateInputs) {
      $('inp-base-url').value = cfg.baseUrl || 'https://api.deepseek.com/v1';
      $('inp-model').value = cfg.model || 'deepseek-chat';
      $('inp-api-key').value = '';
    }
  }

  function renderDailyCap(cap, populateInput) {
    if (!cap) return;
    var used = Number(cap.usedToday || 0);
    var limit = Number(cap.limit || 0);
    var rem = Math.max(0, limit - used);
    var pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

    $('cap-summary-text').textContent =
      '今日已用 ' + fmtInt(used) + ' / ' + fmtInt(limit) + ' 次（剩余 ' + fmtInt(rem) + ' 次）';

    var fill = $('cap-progress-fill');
    fill.style.width = pct + '%';
    fill.style.background = pct >= 90 ? 'var(--bad)' : (pct >= 70 ? 'var(--warn)' : 'var(--ok)');

    var badge = $('cap-source-badge');
    if (cap.source === 'd1') {
      badge.className = 'badge d1';
      badge.textContent = 'D1 在线覆盖 (' + fmtInt(limit) + '/天)';
      $('btn-reset-cap').style.display = 'inline-flex';
    } else if (cap.source === 'env') {
      badge.className = 'badge env';
      badge.textContent = '环境变量 (' + fmtInt(limit) + '/天)';
      $('btn-reset-cap').style.display = 'none';
    } else {
      badge.className = 'badge env';
      badge.textContent = '默认保护 (' + fmtInt(limit) + '/天)';
      $('btn-reset-cap').style.display = 'none';
    }

    $('kpi-daily-cap').textContent = fmtInt(used) + ' / ' + fmtInt(limit);
    $('kpi-daily-cap-sub').textContent = '今日剩余 ' + fmtInt(rem) + ' 次（' + pct + '%）';

    if (populateInput) {
      $('inp-daily-limit').value = String(limit);
    }
  }

  async function loadBalance() {
    var out = $('llm-balance-text');
    out.textContent = '查询中…';
    try {
      var r = await apiJson('/admin/api/llm-balance');
      var d = r.data || {};
      if (!d.supported) {
        out.textContent = d.reason === 'llm_not_configured' ? '待配置密钥' : '当前服务商不支持余额接口';
        return;
      }
      if (!d.ok) {
        out.textContent = '查询失败 (' + (d.error || '未知错误') + ')';
        return;
      }
      var list = d.balanceInfos || [];
      if (!list.length) {
        out.textContent = d.isAvailable === false ? '余额不足' : '¥0.00';
        return;
      }
      var parts = list.map(function (b) {
        var sym = b.currency === 'USD' ? '$' : (b.currency === 'CNY' ? '¥' : (b.currency + ' '));
        return sym + b.totalBalance;
      });
      out.textContent = parts.join(' / ');
    } catch (e) {
      out.textContent = '查询异常';
    }
  }

  function renderStackedBars(containerId, startId, peakId, endId, items, keyA, clsA, keyB, clsB) {
    var box = $(containerId);
    clearNode(box);
    if (!items || !items.length) {
      $(startId).textContent = '—';
      $(endId).textContent = '—';
      $(peakId).textContent = '暂无数据';
      return;
    }
    var maxTotal = 0;
    for (var i = 0; i < items.length; i++) {
      var tot = Number(items[i][keyA] || 0) + Number(items[i][keyB] || 0);
      if (tot > maxTotal) maxTotal = tot;
    }
    $(startId).textContent = items[0].date;
    $(endId).textContent = items[items.length - 1].date;
    $(peakId).textContent = '单日峰值 ' + fmtInt(maxTotal);

    var denom = maxTotal > 0 ? maxTotal : 1;
    items.forEach(function (item) {
      var a = Number(item[keyA] || 0);
      var b = Number(item[keyB] || 0);
      var col = document.createElement('div');
      col.className = 'bar-col';
      col.title = item.date + '：' + a + ' / ' + b;

      if (b > 0) {
        var segB = document.createElement('div');
        segB.className = 'bar-seg ' + clsB;
        segB.style.height = Math.max(3, Math.round((b / denom) * 100)) + '%';
        col.appendChild(segB);
      }
      if (a > 0) {
        var segA = document.createElement('div');
        segA.className = 'bar-seg ' + clsA;
        segA.style.height = Math.max(3, Math.round((a / denom) * 100)) + '%';
        col.appendChild(segA);
      }
      if (a === 0 && b === 0) {
        var zero = document.createElement('div');
        zero.className = 'bar-seg';
        zero.style.height = '2px';
        zero.style.background = 'var(--line)';
        col.appendChild(zero);
      }
      box.appendChild(col);
    });
  }

  function renderFeedbackTable(buckets) {
    var tbody = $('tbody-feedback');
    clearNode(tbody);
    if (!buckets || !buckets.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'empty-row';
      td.textContent = '所选时间窗口内暂无用户 👍/👎 反馈记录';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    buckets.forEach(function (b) {
      var tr = document.createElement('tr');
      var engTd = document.createElement('td');
      var engTag = document.createElement('span');
      engTag.className = 'tag mono';
      engTag.textContent = String(b.engine || '').toUpperCase();
      engTd.appendChild(engTag);
      tr.appendChild(engTd);

      tr.appendChild(tdText(b.aiSource === 'cloud' ? 'Cloud 试用' : 'BYOK 自有密钥'));
      tr.appendChild(tdText(b.refined ? '已精修' : '首轮生成'));
      tr.appendChild(tdText(b.selector === 'hit' ? '命中元素' : (b.selector === 'miss' ? '未命中' : '全局 (N/A)')));
      tr.appendChild(tdText(fmtInt(b.up)));
      tr.appendChild(tdText(fmtInt(b.down)));
      tr.appendChild(tdText(fmtInt(b.total)));

      var rateTd = document.createElement('td');
      var wrap = document.createElement('div');
      wrap.className = 'rate-bar';
      var track = document.createElement('div');
      track.className = 'rate-track';
      var fill = document.createElement('div');
      fill.className = 'rate-fill';
      var pctNum = b.total > 0 ? Math.round((b.up / b.total) * 100) : 0;
      fill.style.width = pctNum + '%';
      track.appendChild(fill);
      var label = document.createElement('span');
      label.textContent = fmtPct(b.up, b.total);
      wrap.appendChild(track);
      wrap.appendChild(label);
      rateTd.appendChild(wrap);
      tr.appendChild(rateTd);

      tbody.appendChild(tr);
    });
  }

  function renderLlmCallsTable(calls) {
    var tbody = $('tbody-llm-calls');
    clearNode(tbody);
    if (!calls || !calls.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty-row';
      td.textContent = '暂无云端 LLM 调用记录';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    calls.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(tdText(fmtTime(c.ts), 'mono'));

      var stTd = document.createElement('td');
      var stBadge = document.createElement('span');
      stBadge.className = 'badge ' + (c.status === 'ok' ? 'ok' : 'err');
      stBadge.textContent = c.status === 'ok' ? '成功' : '失败';
      stTd.appendChild(stBadge);
      tr.appendChild(stTd);

      tr.appendChild(tdText(c.model || '—', 'mono'));
      tr.appendChild(tdText(c.installId ? String(c.installId).slice(0, 12) + '…' : '—', 'mono'));
      tr.appendChild(tdText(fmtInt(c.promptTokens) + ' / ' + fmtInt(c.completionTokens) + ' / ' + fmtInt(c.totalTokens), 'mono'));
      tr.appendChild(tdText(fmtInt(c.durationMs) + ' ms', 'mono'));
      tr.appendChild(tdText(c.error || '—'));
      tbody.appendChild(tr);
    });
  }

  async function loadOverview(populateInputs) {
    setGlobalError('');
    try {
      var r = await apiJson('/admin/api/overview?days=' + encodeURIComponent(currentDays));
      var d = r.data;
      if (!d || !d.ok) {
        setGlobalError((d && d.error) ? ('加载失败：' + d.error) : '加载概览数据失败');
        return;
      }

      renderLlmConfig(d.llmConfig, populateInputs);
      renderDailyCap(d.dailyGlobalCap, populateInputs);

      var inst = d.installs || {};
      var gen = d.generations || {};
      var fb = d.feedback || {};

      $('kpi-installs').textContent = fmtInt(inst.total);
      $('kpi-installs-sub').textContent = '近 ' + currentDays + ' 天新增 +' + fmtInt(inst.newInWindow);

      $('kpi-activation').textContent = fmtPct(inst.generatedAtLeastOnce, inst.total);
      $('kpi-activation-sub').textContent = fmtInt(inst.generatedAtLeastOnce) + ' 个安装已生成 ≥1 次';

      $('kpi-exhausted').textContent = fmtInt(inst.exhaustedQuota);
      $('kpi-exhausted-sub').textContent = '已用满 ' + fmtInt(d.freeTrialLimit || 10) + ' 次免费额度';

      $('kpi-gen-ok').textContent = fmtPct(gen.ok, gen.calls);
      $('kpi-gen-sub').textContent = '成功 ' + fmtInt(gen.ok) + ' / 总调用 ' + fmtInt(gen.calls) + '（失败 ' + fmtInt(gen.errors) + '）';

      $('kpi-tokens').textContent = fmtCompact(gen.totalTokens);
      $('kpi-latency-sub').textContent = '入 ' + fmtCompact(gen.promptTokens) + ' · 出 ' + fmtCompact(gen.completionTokens) + ' · 均耗 ' + fmtInt(gen.avgDurationMs) + 'ms';

      $('kpi-fb-rate').textContent = fmtPct(fb.up, fb.total);
      $('kpi-fb-sub').textContent = '👍 ' + fmtInt(fb.up) + ' · 👎 ' + fmtInt(fb.down) + '（共 ' + fmtInt(fb.total) + ' 票）';

      renderStackedBars('chart-gen-bars', 'chart-gen-start', 'chart-gen-peak', 'chart-gen-end', gen.daily || [], 'ok', 'gen-ok', 'errors', 'gen-err');
      renderStackedBars('chart-fb-bars', 'chart-fb-start', 'chart-fb-peak', 'chart-fb-end', fb.daily || [], 'up', 'fb-up', 'down', 'fb-down');

      renderFeedbackTable(fb.buckets || []);
      renderLlmCallsTable(gen.recent || []);
    } catch (e) {
      setGlobalError('请求失败：' + (e && e.message ? e.message : String(e)));
    }
  }

  // Preset chips
  document.querySelectorAll('.preset-chip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $('inp-base-url').value = btn.getAttribute('data-base') || '';
      $('inp-model').value = btn.getAttribute('data-model') || '';
      setStatus('已填入预设地址与模型，请填写 API Key 后点击「保存并立即生效」', 'mut');
    });
  });

  // Cap quick-fill chips
  document.querySelectorAll('.cap-chip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $('inp-daily-limit').value = btn.getAttribute('data-cap') || '2000';
      setCapStatus('已填入 ' + $('inp-daily-limit').value + '，点击「保存上限」立即生效', 'mut');
    });
  });

  // Save daily global limit
  $('btn-save-cap').addEventListener('click', async function () {
    var raw = $('inp-daily-limit').value.trim();
    if (!/^\\d+$/.test(raw)) {
      setCapStatus('请输入有效的非负整数', 'err');
      return;
    }
    $('btn-save-cap').disabled = true;
    setCapStatus('正在保存每日熔断上限…', 'mut');
    try {
      var r = await apiJson('/admin/api/daily-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyGlobalLimit: Number(raw) })
      });
      if (!r.data || !r.data.ok) {
        setCapStatus('保存失败：' + ((r.data && (r.data.message || r.data.error)) || '未知错误'), 'err');
        return;
      }
      renderDailyCap(r.data.dailyGlobalCap, true);
      setCapStatus('每日熔断上限已更新并立即生效！', 'ok');
    } catch (e) {
      setCapStatus('保存异常：' + (e.message || String(e)), 'err');
    } finally {
      $('btn-save-cap').disabled = false;
    }
  });

  // Reset daily global limit override
  $('btn-reset-cap').addEventListener('click', async function () {
    $('btn-reset-cap').disabled = true;
    setCapStatus('正在恢复默认上限…', 'mut');
    try {
      var r = await apiJson('/admin/api/daily-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearOverride: true })
      });
      if (r.data && r.data.ok) {
        renderDailyCap(r.data.dailyGlobalCap, true);
        setCapStatus('已恢复默认上限', 'ok');
      } else {
        setCapStatus('恢复失败', 'err');
      }
    } catch (e) {
      setCapStatus('操作异常：' + (e.message || String(e)), 'err');
    } finally {
      $('btn-reset-cap').disabled = false;
    }
  });

  // Show / hide API key
  $('btn-toggle-key').addEventListener('click', function () {
    var inp = $('inp-api-key');
    var showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    $('btn-toggle-key').textContent = showing ? '显示' : '隐藏';
  });

  // Save LLM config
  $('btn-save-llm').addEventListener('click', async function () {
    var baseUrl = $('inp-base-url').value.trim();
    var model = $('inp-model').value.trim();
    var apiKey = $('inp-api-key').value.trim();
    if (!baseUrl || !model) {
      setStatus('请填写完整的 Base URL 和模型名称', 'err');
      return;
    }
    $('btn-save-llm').disabled = true;
    setStatus('正在加密保存至 D1…', 'mut');
    try {
      var r = await apiJson('/admin/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl, model: model, apiKey: apiKey })
      });
      if (!r.data || !r.data.ok) {
        setStatus('保存失败：' + ((r.data && (r.data.message || r.data.error)) || '未知错误'), 'err');
        return;
      }
      renderLlmConfig(r.data.llmConfig, true);
      setStatus('已保存并立即生效！', 'ok');
      loadBalance();
    } catch (e) {
      setStatus('保存异常：' + (e.message || String(e)), 'err');
    } finally {
      $('btn-save-llm').disabled = false;
    }
  });

  // Clear override
  $('btn-clear-llm').addEventListener('click', async function () {
    if (!confirm('确认清除网页端保存的 LLM 覆盖配置，恢复使用 Worker 环境变量默认值吗？')) return;
    $('btn-clear-llm').disabled = true;
    setStatus('正在清除覆盖配置…', 'mut');
    try {
      var r = await apiJson('/admin/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearOverride: true })
      });
      if (r.data && r.data.ok) {
        renderLlmConfig(r.data.llmConfig, true);
        setStatus('已恢复环境变量默认配置', 'ok');
        loadBalance();
      } else {
        setStatus('清除失败', 'err');
      }
    } catch (e) {
      setStatus('操作失败：' + (e.message || String(e)), 'err');
    } finally {
      $('btn-clear-llm').disabled = false;
    }
  });

  // Test connectivity
  $('btn-test-llm').addEventListener('click', async function () {
    var baseUrl = $('inp-base-url').value.trim();
    var model = $('inp-model').value.trim();
    var apiKey = $('inp-api-key').value.trim();
    $('btn-test-llm').disabled = true;
    setStatus('正在发起连通性测试…', 'mut');
    try {
      var r = await apiJson('/admin/api/llm-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl, model: model, apiKey: apiKey })
      });
      var d = r.data || {};
      if (d.ok) {
        setStatus('连通正常 (' + d.model + ' · ' + d.latencyMs + 'ms)', 'ok');
      } else {
        setStatus('连通失败：' + (d.error || '未知错误'), 'err');
      }
    } catch (e) {
      setStatus('测试异常：' + (e.message || String(e)), 'err');
    } finally {
      $('btn-test-llm').disabled = false;
    }
  });

  // Balance refresh
  $('btn-balance').addEventListener('click', function () {
    loadBalance();
  });

  // Days switcher
  $('days-seg').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-days]');
    if (!btn) return;
    var next = Number(btn.getAttribute('data-days') || 28);
    if (next === currentDays) return;
    currentDays = next;
    document.querySelectorAll('#days-seg button').forEach(function (b) {
      b.classList.toggle('active', Number(b.getAttribute('data-days')) === currentDays);
    });
    loadOverview(false);
  });

  // Manual refresh
  $('btn-refresh').addEventListener('click', function () {
    loadOverview(false);
    loadBalance();
  });

  // Logout
  $('btn-logout').addEventListener('click', function () {
    fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () {
      location.href = '/admin';
    });
  });

  loadOverview(true);
  loadBalance();
})();
</script>
</body>
</html>`;
