/**
 * Interactive 20-Second Practice Sandbox (`GET /playground` on https://pagecraft.shenxin.space/playground).
 *
 * Designed as the safe, realistic target webpage where newly installed PageCraft
 * users complete their first "Pick -> Generate -> Apply" loop in ~20 seconds:
 * - Contains stable, semantic, clearly marked annoyance targets (`#pc-demo-banner`,
 *   `#pc-demo-sidebar`, `#pc-demo-float`) whose inner nodes have `pointer-events: none`
 *   so the Element Picker frames the whole target cleanly on first hover.
 * - Uses a flexbox stage (`#pc-demo-layout`) so hiding `#pc-demo-sidebar` via CSS
 *   immediately expands `#pc-demo-article` smoothly across the full reading width.
 * - Includes a realistic metrics table (`#pc-demo-table`) with an overdue row so
 *   users can also try row highlighting or the 1-click "Export CSV" recipe here.
 * - 100% self-contained HTML + inline CSS + minimal inline JS, strict CSP, zero trackers.
 */

import { LANDING_CSP, resolveLandingLang, type LandingLang } from './landing';
import { FAVICON_DATA_URI, renderBrandIconSvg } from '../lib/brand';

interface BiText {
  zh: string;
  en: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bi(text: BiText, cls = ''): string {
  const c = cls ? ` class="${cls}"` : '';
  return `<span data-l="zh"${c}>${esc(text.zh)}</span><span data-l="en"${c}>${esc(text.en)}</span>`;
}

function renderPlaygroundHtml(initialLang: LandingLang): string {
  const htmlLang = initialLang === 'en' ? 'en' : 'zh-CN';
  const canonicalUrl =
    initialLang === 'en'
      ? 'https://pagecraft.shenxin.space/playground?lang=en'
      : 'https://pagecraft.shenxin.space/playground';
  const titleText =
    initialLang === 'en'
      ? 'PageCraft 20s Sandbox — Try Reshaping This Page Live'
      : 'PageCraft 20 秒练习靶场 — 亲手试改这个网页';
  const descText =
    initialLang === 'en'
      ? 'Interactive practice webpage for PageCraft. Pick the promo banner or noisy sidebar from the Side Panel and watch CSS modifications apply in 0.1s.'
      : 'PageCraft 交互式练习靶场：在右侧插件侧栏点击「点选元素」，点一下本页的推广横幅或杂乱侧边栏，亲手体验 0.1 秒网页净化与排版改造。';

  const zhPressed = initialLang === 'zh' ? 'true' : 'false';
  const enPressed = initialLang === 'en' ? 'true' : 'false';

  return `<!DOCTYPE html>
<html lang="${htmlLang}" data-lang="${initialLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titleText)}</title>
<meta name="description" content="${esc(descText)}">
<link rel="canonical" href="${canonicalUrl}">
<link rel="alternate" hreflang="zh-CN" href="https://pagecraft.shenxin.space/playground">
<link rel="alternate" hreflang="en" href="https://pagecraft.shenxin.space/playground?lang=en">
<link rel="alternate" hreflang="x-default" href="https://pagecraft.shenxin.space/playground">
<meta property="og:title" content="${esc(titleText)}">
<meta property="og:description" content="${esc(descText)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:image" content="https://pagecraft.shenxin.space/og.svg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titleText)}">
<meta name="twitter:description" content="${esc(descText)}">
<meta name="twitter:image" content="https://pagecraft.shenxin.space/og.svg">
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<style>
:root {
  --bg: #faf8f5;
  --bg-subtle: #f3efe8;
  --surface: #ffffff;
  --surface-2: #fcfaf7;
  --ink: #1c1917;
  --ink-secondary: #44403c;
  --muted: #78716c;
  --primary: #c95533;
  --primary-soft: rgba(201, 85, 51, 0.10);
  --primary-border: rgba(201, 85, 51, 0.32);
  --amber-bg: rgba(217, 119, 6, 0.09);
  --amber-border: rgba(217, 119, 6, 0.38);
  --emerald: #15803d;
  --emerald-soft: rgba(21, 128, 61, 0.10);
  --border: rgba(28, 25, 23, 0.11);
  --border-strong: rgba(28, 25, 23, 0.20);
  --shadow-sm: 0 1px 2px rgba(28, 25, 23, 0.04), 0 4px 14px rgba(28, 25, 23, 0.05);
  --serif: "Newsreader", "Iowan Old Style", "Georgia", "Songti SC", "STSong", "Noto Serif SC", serif;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141312;
    --bg-subtle: #1c1a18;
    --surface: #1e1c1a;
    --surface-2: #252220;
    --ink: #f5f2eb;
    --ink-secondary: #d6d1c7;
    --muted: #a09a90;
    --primary: #e27250;
    --primary-soft: rgba(226, 114, 80, 0.15);
    --primary-border: rgba(226, 114, 80, 0.38);
    --amber-bg: rgba(245, 158, 11, 0.12);
    --amber-border: rgba(245, 158, 11, 0.42);
    --emerald: #4ade80;
    --emerald-soft: rgba(74, 222, 128, 0.13);
    --border: rgba(245, 242, 235, 0.11);
    --border-strong: rgba(245, 242, 235, 0.22);
    --shadow-sm: 0 2px 10px rgba(0, 0, 0, 0.35);
  }
}

:root[data-theme="dark"] {
  --bg: #141312;
  --bg-subtle: #1c1a18;
  --surface: #1e1c1a;
  --surface-2: #252220;
  --ink: #f5f2eb;
  --ink-secondary: #d6d1c7;
  --muted: #a09a90;
  --primary: #e27250;
  --primary-soft: rgba(226, 114, 80, 0.15);
  --primary-border: rgba(226, 114, 80, 0.38);
  --amber-bg: rgba(245, 158, 11, 0.12);
  --amber-border: rgba(245, 158, 11, 0.42);
  --emerald: #4ade80;
  --emerald-soft: rgba(74, 222, 128, 0.13);
  --border: rgba(245, 242, 235, 0.11);
  --border-strong: rgba(245, 242, 235, 0.22);
  --shadow-sm: 0 2px 10px rgba(0, 0, 0, 0.35);
}

*, *::before, *::after { box-sizing: border-box; }
html[data-lang="zh"] [data-l="en"] { display: none !important; }
html[data-lang="en"] [data-l="zh"] { display: none !important; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
}
.topbar-inner {
  max-width: 1060px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 5px rgba(201, 85, 51, 0.22));
}
.brand-title {
  font-family: var(--serif);
  font-size: 18px;
  letter-spacing: -0.01em;
}
.sandbox-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid var(--primary-border);
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px;
  background: var(--surface);
}
.seg button, .icon-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 9px;
  border-radius: 6px;
  cursor: pointer;
}
.seg button[aria-pressed="true"] {
  background: var(--bg-subtle);
  color: var(--ink);
  font-weight: 600;
}
.icon-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-secondary);
  padding: 5px 10px;
  border-radius: 8px;
}

.wrap {
  max-width: 1060px;
  margin: 0 auto;
  padding: 22px 24px 64px;
}

/* Step-by-step coach banner inside the practice page */
#pc-demo-guide {
  background: var(--surface);
  border: 1px solid var(--primary-border);
  border-radius: 14px;
  padding: 14px 18px;
  margin-bottom: 18px;
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.guide-steps {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13.5px;
  color: var(--ink);
}
.step-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.step-num {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.guide-arrow { color: var(--muted); font-size: 13px; }
.guide-free {
  font-size: 12px;
  color: var(--emerald);
  background: var(--emerald-soft);
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 600;
}

/* Target 1: Annoying App/VIP Nag Banner — inner nodes pointer-events:none for clean 1-box picking */
#pc-demo-banner {
  background: var(--amber-bg);
  border: 1.5px dashed var(--amber-border);
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: crosshair;
  transition: transform 0.15s ease;
}
#pc-demo-banner *, #pc-demo-sidebar *, #pc-demo-float * {
  pointer-events: none;
}
.target-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--primary);
  background: var(--surface);
  border: 1px solid var(--primary-border);
  padding: 2px 8px;
  border-radius: 6px;
  margin-bottom: 6px;
}
.nag-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.nag-sub {
  font-size: 13px;
  color: var(--ink-secondary);
}
.fake-cta {
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 9px;
  background: #d97706;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

/* Main 2-column stage: hiding #pc-demo-sidebar naturally expands #pc-demo-article to 100%! */
#pc-demo-layout {
  display: flex;
  align-items: flex-start;
  gap: 22px;
}

#pc-demo-article {
  flex: 1 1 auto;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px 32px;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.article-kicker {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
.article-h1 {
  font-family: var(--serif);
  font-size: 26px;
  line-height: 1.3;
  margin: 0 0 14px;
  color: var(--ink);
}
.article-p {
  margin: 0 0 14px;
  color: var(--ink-secondary);
  font-size: 15px;
}

/* Sample Data Table inside article for CSV export & row highlight testing */
.table-wrap {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.table-head-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.table-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}
.table-hint {
  font-size: 12px;
  color: var(--muted);
}
#pc-demo-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
#pc-demo-table th {
  text-align: left;
  padding: 9px 10px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border-strong);
  font-weight: 600;
  color: var(--ink);
}
#pc-demo-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}
.status-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: var(--bg-subtle);
  color: var(--ink-secondary);
}
tr[data-status="overdue"] .status-pill {
  background: rgba(220, 38, 38, 0.10);
  color: #b91c1c;
}

/* Target 2: Noisy Right Recommendation & Ad Rail */
#pc-demo-sidebar {
  width: 286px;
  flex: 0 0 286px;
  background: var(--surface-2);
  border: 1.5px dashed var(--primary-border);
  border-radius: 14px;
  padding: 16px;
  cursor: crosshair;
}
.noisy-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}
.noisy-card {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.noisy-tag {
  font-size: 11px;
  font-weight: 600;
  color: #d97706;
  margin-bottom: 3px;
}
.noisy-headline {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  line-height: 1.45;
}

/* Target 3: Floating bottom-right promo pill */
#pc-demo-float {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 20;
  background: var(--surface);
  border: 1.5px dashed var(--primary-border);
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: var(--shadow-sm);
  cursor: crosshair;
  max-width: 220px;
}
.float-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}

footer {
  max-width: 1060px;
  margin: 0 auto;
  padding: 20px 24px 40px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--muted);
}
.foot-links {
  display: flex;
  align-items: center;
  gap: 16px;
}
.foot-links a:hover { color: var(--ink); text-decoration: underline; }

@media (max-width: 820px) {
  #pc-demo-layout { flex-direction: column; }
  #pc-demo-sidebar { width: 100%; flex: 1 1 auto; }
}
</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <a href="/" class="brand" aria-label="PageCraft Home">
          <span class="brand-mark">${renderBrandIconSvg(28, 'pcg-pg')}</span>
          <span class="brand-title">PageCraft</span>
        </a>
        <span class="sandbox-pill">${bi({ zh: '20 秒新手靶场', en: '20s Practice Sandbox' })}</span>
      </div>

      <div class="controls">
        <div class="seg" role="group" aria-label="Language">
          <button type="button" data-set-lang="zh" aria-pressed="${zhPressed}">中文</button>
          <button type="button" data-set-lang="en" aria-pressed="${enPressed}">EN</button>
        </div>
        <button type="button" id="theme-toggle" class="icon-btn" aria-label="Toggle theme">◐</button>
      </div>
    </div>
  </header>

  <main class="wrap">
    <!-- 3-Step Visual Coach Strip -->
    <section id="pc-demo-guide" aria-label="Practice instructions">
      <div class="guide-steps">
        <span class="step-chip">
          <span class="step-num">1</span>
          ${bi({ zh: '在右侧插件侧栏点「点选元素」', en: 'Click "Pick Element" in the right Side Panel' })}
        </span>
        <span class="guide-arrow">→</span>
        <span class="step-chip">
          <span class="step-num">2</span>
          ${bi({ zh: '点一下本页虚线框横幅或右侧栏', en: 'Click the dashed banner or right sidebar below' })}
        </span>
        <span class="guide-arrow">→</span>
        <span class="step-chip">
          <span class="step-num">3</span>
          ${bi({ zh: '点「生成改造」并「应用并保存」', en: 'Click "Generate Mod" then "Apply & Save"' })}
        </span>
      </div>
      <span class="guide-free">${bi({ zh: '靶场练习秒出结果 · 不扣免费额度', en: 'Instant sandbox result · 0 quota used' })}</span>
    </section>

    <!-- Practice Target 1: Top Nag Banner -->
    <div id="pc-demo-banner" data-testid="pc-demo-banner" role="region" aria-label="Practice Promo Banner">
      <div>
        <div class="target-badge">${bi({ zh: '🎯 可点选目标 1 · #pc-demo-banner', en: '🎯 Target 1 · #pc-demo-banner' })}</div>
        <div class="nag-title">${bi({
          zh: '下载官方 App 客户端领 VIP 畅读券，解锁全年 128 份深度行业报告！',
          en: 'Download our Mobile App to unlock full articles & claim your VIP pass!',
        })}</div>
        <div class="nag-sub">${bi({
          zh: '未登录网页端仅展示节选内容 · 试试用 PageCraft 点选我并彻底隐藏',
          en: 'Web preview nag banner — try picking this block with PageCraft to hide it permanently',
        })}</div>
      </div>
      <span class="fake-cta">${bi({ zh: '立即打开客户端', en: 'Open in App' })}</span>
    </div>

    <!-- 2-Column Content Stage -->
    <div id="pc-demo-layout">
      <!-- Clean Article Column (expands automatically when sidebar is hidden!) -->
      <article id="pc-demo-article" data-testid="pc-demo-article">
        <div class="article-kicker">${bi({ zh: '效率周刊 · 靶场示例文章', en: 'Weekly Brief · Sample Article' })}</div>
        <h1 class="article-h1">${bi({
          zh: '为什么你每天高频访问的网页，值得按你自己的习惯重塑？',
          en: 'Why the Websites You Use Every Day Should Fit How You Read and Work',
        })}</h1>
        <p class="article-p">${bi({
          zh: '现代网页塞满了客户端导流横幅、猜你喜欢瀑布流与刺眼的留白。当你用右侧 PageCraft 侧栏把上方横幅或右侧杂乱推荐栏隐藏后，这篇正文会自动舒展铺满阅读区——而且规则会保存在本地，下次打开依然干净。',
          en: 'Modern webpages are crowded with app-download prompts, noisy sidebars, and distracting feeds. Once you hide the banner above or the sidebar on the right using PageCraft, this article automatically expands to a calm, full-width reading view—and stays clean every time you return.',
        })}</p>
        <p class="article-p">${bi({
          zh: '学会这三步之后，去知乎、B站、小红书或公司内部后台都是完全一样的操作。想恢复原状？切到侧栏「我的改造」拨一下开关就能瞬间还原。',
          en: 'Once you try these 3 steps here, reshaping Reddit, YouTube, docs, or internal dashboards works the exact same way. Want to undo? Flip the switch in "My Mods" anytime.',
        })}</p>

        <!-- Sample Metrics Table (also works with 1-Click CSV Export & Row Highlight!) -->
        <div class="table-wrap">
          <div class="table-head-bar">
            <span class="table-title">${bi({ zh: '季度渠道回款示例表（#pc-demo-table）', en: 'Sample Channel Metrics (#pc-demo-table)' })}</span>
            <span class="table-hint">${bi({
              zh: '进阶体验：也可试试「网页表格一键导出 Excel / CSV」同款配方',
              en: 'Bonus: try the 1-click "Table to CSV" recipe on this table too',
            })}</span>
          </div>
          <table id="pc-demo-table" class="pc-demo-orders">
            <thead>
              <tr>
                <th>${bi({ zh: '单号', en: 'Order #' })}</th>
                <th>${bi({ zh: '渠道来源', en: 'Channel' })}</th>
                <th>${bi({ zh: '金额', en: 'Amount' })}</th>
                <th>${bi({ zh: '状态', en: 'Status' })}</th>
              </tr>
            </thead>
            <tbody>
              <tr data-status="paid">
                <td>INV-2041</td>
                <td>Organic Search</td>
                <td>¥860</td>
                <td><span class="status-pill">${bi({ zh: '已结清', en: 'Paid' })}</span></td>
              </tr>
              <tr data-status="overdue" class="pc-overdue-row">
                <td>INV-2042</td>
                <td>Paid Social</td>
                <td>¥2,480</td>
                <td><span class="status-pill">${bi({ zh: '逾期', en: 'Overdue' })}</span></td>
              </tr>
              <tr data-status="paid">
                <td>INV-2043</td>
                <td>Direct</td>
                <td>¥640</td>
                <td><span class="status-pill">${bi({ zh: '已结清', en: 'Paid' })}</span></td>
              </tr>
              <tr data-status="paid">
                <td>INV-2044</td>
                <td>Partner Referral</td>
                <td>¥1,920</td>
                <td><span class="status-pill">${bi({ zh: '已结清', en: 'Paid' })}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <!-- Practice Target 2: Noisy Right Sidebar -->
      <aside id="pc-demo-sidebar" data-testid="pc-demo-sidebar" aria-label="Practice Noisy Sidebar">
        <div class="target-badge">${bi({ zh: '🎯 可点选目标 2 · #pc-demo-sidebar', en: '🎯 Target 2 · #pc-demo-sidebar' })}</div>
        <div class="nag-title">${bi({ zh: '全站热搜与为你推荐', en: 'Trending & Sponsored Clutter' })}</div>
        <div class="noisy-list">
          <div class="noisy-card">
            <div class="noisy-tag">${bi({ zh: '热议 · 99+ 弹窗', en: 'Sponsored · Hot' })}</div>
            <div class="noisy-headline">${bi({
              zh: '震惊！90% 的人每天都在重复的低效网页操作…',
              en: '10 Distracting Clickbait Links Stealing Your Focus…',
            })}</div>
          </div>
          <div class="noisy-card">
            <div class="noisy-tag">${bi({ zh: '广告 · 限时秒杀', en: 'Ad · Flash Deal' })}</div>
            <div class="noisy-headline">${bi({
              zh: '训练营 9.9 元体验课最后 2 小时，立即扫码进群',
              en: 'Limited-Time Webinar Pop-up — Claim Seat Now!',
            })}</div>
          </div>
          <div class="noisy-card">
            <div class="noisy-tag">${bi({ zh: '猜你喜欢', en: 'Recommended Feed' })}</div>
            <div class="noisy-headline">${bi({
              zh: '隐藏我之后，左侧文章会自动加宽铺满整个阅读区！',
              en: 'Hide this sidebar and watch the article expand full-width!',
            })}</div>
          </div>
        </div>
      </aside>
    </div>
  </main>

  <!-- Practice Target 3: Floating Corner Widget -->
  <div id="pc-demo-float" data-testid="pc-demo-float" role="complementary" aria-label="Practice Floating Promo">
    <div class="target-badge">${bi({ zh: '🎯 目标 3 · 悬浮角标', en: '🎯 Target 3 · Floating Widget' })}</div>
    <div class="float-title">${bi({ zh: '🧧 扫码领 18 元新人礼包', en: '🎁 Spin Wheel & App Coupon' })}</div>
  </div>

  <footer>
    <span>PageCraft · ${bi({ zh: '零后台浏览记录监控', en: 'Zero background tracking' })}</span>
    <div class="foot-links">
      <a href="/">${bi({ zh: '返回官网', en: 'Home' })}</a>
      <a href="/privacy">${bi({ zh: '隐私政策', en: 'Privacy Policy' })}</a>
      <a href="https://github.com/botshen/plugin-radar" rel="noopener noreferrer">GitHub</a>
      <a href="mailto:botzgbj@gmail.com">botzgbj@gmail.com</a>
    </div>
  </footer>

<script>
(function () {
  var root = document.documentElement;
  function applyLang(lang, persist) {
    var next = lang === 'en' ? 'en' : 'zh';
    root.setAttribute('data-lang', next);
    root.setAttribute('lang', next === 'en' ? 'en' : 'zh-CN');
    var btns = document.querySelectorAll('[data-set-lang]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-set-lang') === next ? 'true' : 'false');
    }
    if (persist) {
      try { localStorage.setItem('pc_site_lang', next); } catch (e) {}
    }
  }

  try {
    var params = new URLSearchParams(window.location.search);
    if (!params.get('lang')) {
      var savedLang = localStorage.getItem('pc_site_lang');
      if (savedLang === 'zh' || savedLang === 'en') applyLang(savedLang, false);
    }
  } catch (e) {}

  var langBtns = document.querySelectorAll('[data-set-lang]');
  for (var i = 0; i < langBtns.length; i++) {
    langBtns[i].addEventListener('click', function () {
      applyLang(this.getAttribute('data-set-lang') || 'zh', true);
    });
  }

  try {
    var savedTheme = localStorage.getItem('pc_site_theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      root.setAttribute('data-theme', savedTheme);
    }
  } catch (e) {}

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme');
      var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = cur ? cur === 'dark' : sysDark;
      var nextTheme = isDark ? 'light' : 'dark';
      root.setAttribute('data-theme', nextTheme);
      try { localStorage.setItem('pc_site_theme', nextTheme); } catch (e) {}
    });
  }
})();
</script>
</body>
</html>
`;
}

const PLAYGROUND_ZH = renderPlaygroundHtml('zh');
const PLAYGROUND_EN = renderPlaygroundHtml('en');

export function handlePlayground(request?: Request): Response {
  const lang = resolveLandingLang(request);
  const body = lang === 'en' ? PLAYGROUND_EN : PLAYGROUND_ZH;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': LANDING_CSP,
      Vary: 'Accept-Language',
    },
  });
}
