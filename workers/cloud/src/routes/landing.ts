/**
 * Official PageCraft Bilingual Landing Page (`GET /` on https://pagecraft.shenxin.space/).
 *
 * 100% self-contained HTML + inline CSS + minimal inline JS:
 * - Zero external runtime dependencies, fonts, CDN scripts, or trackers
 * - Strict Content-Security-Policy header
 * - Warm editorial visual palette (#faf8f5 paper, #1c1917 ink, #c95533 terracotta)
 * - Automatic prefers-color-scheme dark mode + manual light/dark toggle
 * - Default zh-CN with instant 中文 / EN switch (?lang=en or Accept-Language: en* without zh)
 */

import { FAVICON_DATA_URI, renderBrandIconSvg } from '../lib/brand';

export type LandingLang = 'zh' | 'en';

export const LANDING_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

interface BilingualText {
  zh: string;
  en: string;
}

interface RecipeShowcaseItem {
  id: string;
  engine: 'css' | 'js';
  category: 'clean' | 'extract' | 'focus' | 'unlock';
  scopeLabel: BilingualText;
  name: BilingualText;
  description: BilingualText;
  tag: BilingualText;
}

/**
 * Exact 10 built-in 1-click recipes mirrored from `lib/userscripts/templates.ts`.
 */
const BUILTIN_RECIPES: readonly RecipeShowcaseItem[] = [
  {
    id: 'tpl-widescreen-reader',
    engine: 'css',
    category: 'clean',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '沉浸宽屏护眼阅读', en: 'Warm Widescreen Reader' },
    description: {
      zh: '收起常见侧边推荐栏与悬浮角标，拓宽正文排版并切换暖白纸感护眼底色',
      en: 'Hide common sidebars and floating widgets, widen article body, and apply warm paper contrast',
    },
    tag: { zh: '免开关秒生效', en: 'Instant CSS' },
  },
  {
    id: 'tpl-smart-dark-mode',
    engine: 'css',
    category: 'clean',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '刺眼白底转柔和深色模式', en: 'Smart Dark Mode Filter' },
    description: {
      zh: '为没有夜间模式的内网后台或文档站开启深色滤镜，图片与视频保持原色不反相',
      en: 'Convert bright white dashboards and docs to soft dark mode while keeping images & video natural',
    },
    tag: { zh: '免开关秒生效', en: 'Instant CSS' },
  },
  {
    id: 'tpl-table-csv-export',
    engine: 'js',
    category: 'extract',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '网页表格一键导出 Excel / CSV', en: 'One-Click Table to CSV / Excel' },
    description: {
      zh: '自动识别页面内数据表，在表格右上角挂载「导出 CSV」按钮（含 UTF-8 BOM，Excel 打开中文不乱码）',
      en: 'Inject an Export CSV button above every data table with UTF-8 BOM encoding for clean Excel import',
    },
    tag: { zh: '打工人刚需', en: 'Data Export' },
  },
  {
    id: 'tpl-unlock-copy',
    engine: 'js',
    category: 'unlock',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '解除网页复制与右键限制', en: 'Unlock Copy, Select & Right-Click' },
    description: {
      zh: '恢复文字选中能力并拦截烦人的禁止复制、复制强制追加小尾巴与右键封锁',
      en: 'Restore text selection and bypass copy blockers, copyright tails, and context-menu locks',
    },
    tag: { zh: '查资料必备', en: 'Unlocker' },
  },
  {
    id: 'tpl-zhihu-clean',
    engine: 'css',
    category: 'focus',
    scopeLabel: { zh: 'zhihu.com', en: 'zhihu.com' },
    name: { zh: '知乎纯净宽屏去弹窗', en: 'Zhihu Clean Centered Reader' },
    description: {
      zh: '隐藏右侧杂乱栏、App 引导横幅与非必要悬浮框，问题与回答主体居中加宽展示',
      en: 'Hide right-rail clutter and promo banners on Zhihu and widen the main answer column',
    },
    tag: { zh: '知乎专享 · 秒生效', en: 'Zhihu · Instant CSS' },
  },
  {
    id: 'tpl-bilibili-focus',
    engine: 'css',
    category: 'focus',
    scopeLabel: { zh: 'bilibili.com', en: 'bilibili.com' },
    name: { zh: 'B站首页防摸鱼（仅留搜索栏）', en: 'Bilibili Search-Only Focus Feed' },
    description: {
      zh: '隐藏首页推荐瀑布流与轮播大图，保留顶部搜索栏与动态入口，查学习资料不被带偏',
      en: 'Hide homepage recommendation feed and carousels on Bilibili so you search intentionally',
    },
    tag: { zh: 'B站专享 · 秒生效', en: 'Bilibili · Instant CSS' },
  },
  {
    id: 'tpl-xiaohongshu-clean',
    engine: 'css',
    category: 'clean',
    scopeLabel: { zh: 'xiaohongshu.com', en: 'xiaohongshu.com' },
    name: { zh: '小红书网页版清爽大屏', en: 'Xiaohongshu Clean Desktop View' },
    description: {
      zh: '隐藏右下角悬浮引导气泡与下载横幅，优化大屏图文笔记阅读密度',
      en: 'Remove floating app-download prompts and optimize desktop note reading layout',
    },
    tag: { zh: '小红书 · 秒生效', en: 'XHS · Instant CSS' },
  },
  {
    id: 'tpl-code-copy-btn',
    engine: 'js',
    category: 'extract',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '代码块统一加「一键复制」按钮', en: 'Add Copy Button to Code Blocks' },
    description: {
      zh: '为旧版技术博客、内网 Wiki 的 <pre> 代码块右上角自动补齐复制按钮',
      en: 'Attach a clean 1-click Copy button to every <pre> code block on docs and wikis',
    },
    tag: { zh: '开发者效率', en: 'Dev Tool' },
  },
  {
    id: 'tpl-direct-external-links',
    engine: 'js',
    category: 'unlock',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '外链直达免二次确认跳转', en: 'Bypass External Link Interstitials' },
    description: {
      zh: '自动识别并改写包含 target= / url= 参数的站外链接中转页，点击直接打开真实目标网站',
      en: 'Rewrite redirect wrapper links (?target=... / ?url=...) directly to their destination URL',
    },
    tag: { zh: '省时提速', en: 'Zero Clicks Wasted' },
  },
  {
    id: 'tpl-alt-image-zoom',
    engine: 'js',
    category: 'clean',
    scopeLabel: { zh: '任意网站通用', en: 'Any Website' },
    name: { zh: '按住 Alt 悬停放大预览缩略图', en: 'Alt + Hover Thumbnail Zoom' },
    description: {
      zh: '浏览商品列表或帖子配图时，按住 Alt 键指向图片即可居中弹出高清大图预览',
      en: 'Hold Alt while hovering any thumbnail image to preview it full-size in a centered overlay',
    },
    tag: { zh: '看图神器', en: 'Media Utility' },
  },
];

function escHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function biSpan(text: BilingualText, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  return `<span data-l="zh"${cls}>${escHtml(text.zh)}</span><span data-l="en"${cls}>${escHtml(text.en)}</span>`;
}

const GREATER_CHINA_COUNTRIES = new Set(['CN', 'HK', 'MO', 'TW']);

export function resolveLandingLang(request?: Request): LandingLang {
  if (!request) return 'zh';
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('lang') ?? '').trim().toLowerCase();
    if (q === 'en' || q.startsWith('en-')) return 'en';
    if (q === 'zh' || q.startsWith('zh-')) return 'zh';
  } catch {
    // Fall back to Accept-Language / country check
  }

  const accept = (request.headers.get('Accept-Language') ?? '').trim().toLowerCase();
  if (/\bzh(?:-[a-z]+)?\b/.test(accept)) {
    return 'zh';
  }

  const cfCountry = (
    (request as Request & { cf?: { country?: string } }).cf?.country ?? ''
  ).toUpperCase();
  if (cfCountry && GREATER_CHINA_COUNTRIES.has(cfCountry)) {
    return 'zh';
  }

  if (accept.length > 0) {
    return 'en';
  }
  return 'zh';
}

function renderRecipesHtml(): string {
  return BUILTIN_RECIPES.map((r) => {
    const engineLabel =
      r.engine === 'css'
        ? { zh: 'CSS · 0.1s', en: 'CSS · 0.1s' }
        : { zh: 'JS · 沙箱脚本', en: 'JS · Userscript' };
    const engineClass = r.engine === 'css' ? 'badge-css' : 'badge-js';
    return `<article class="recipe-card" data-engine="${r.engine}" data-category="${r.category}">
      <div class="recipe-top">
        <span class="engine-pill ${engineClass}">${biSpan(engineLabel)}</span>
        <span class="recipe-tag">${biSpan(r.tag)}</span>
      </div>
      <h3 class="recipe-title">${biSpan(r.name)}</h3>
      <p class="recipe-desc">${biSpan(r.description)}</p>
      <div class="recipe-foot">
        <span class="recipe-scope">${biSpan(r.scopeLabel)}</span>
        <span class="recipe-ready">${biSpan({ zh: '点一下立即生效', en: '1-Click Ready' })}</span>
      </div>
    </article>`;
  }).join('\n');
}

interface FaqItem {
  q: BilingualText;
  a: BilingualText;
}

const LANDING_FAQS: readonly FaqItem[] = [
  {
    q: {
      zh: '使用 PageCraft 需要懂前端代码或打开 F12 开发者工具吗？',
      en: 'Do I need coding experience or F12 DevTools to use PageCraft?',
    },
    a: {
      zh: '完全不需要。点击「点选元素」后把鼠标指向网页上想隐藏或修改的区域，再用大白话描述效果（例如“隐藏右侧推荐栏并调宽正文”或“给这个表格加个导出 Excel/CSV 按钮”），PageCraft 会自动生成选择器并实时验证命中元素。',
      en: 'Not at all. Click "Pick Element", point at any block or table on the webpage, and describe what you want in plain words. PageCraft captures resilient selectors and verifies live matches automatically.',
    },
  },
  {
    q: {
      zh: '为什么纯视觉排版修改可以免开任何开关 0.1 秒立即生效？',
      en: 'Why do visual CSS tweaks apply in 0.1s with zero developer toggles?',
    },
    a: {
      zh: 'PageCraft 采用 CSS + JS 双引擎架构：去弹窗、隐藏干扰栏、宽屏护眼等纯样式规则通过原生 insertCSS 注入，安装后无需开启任何额外开关即可 0.1 秒实时生效与还原；仅当需要挂载交互按钮或自动化脚本时才使用官方隔离的 userScripts 引擎。',
      en: 'PageCraft splits styling from scripting: visual tweaks run via Chrome native insertCSS in 0.1s with zero browser toggles required, while interactive DOM scripts execute safely inside the official MV3 isolated userScripts world.',
    },
  },
  {
    q: {
      zh: '生成的脚本可以导出到 Tampermonkey / 脚本猫，或者用我自己的 API Key 吗？',
      en: 'Can I export mods to Tampermonkey / ScriptCat or use my own API key?',
    },
    a: {
      zh: '可以，零平台锁定。所有规则均可一键导出为标准 .user.js 文件在 Tampermonkey 或脚本猫中运行；新安装赠送 10 次免费云端生成额度，随时可在设置中填入自己的 DeepSeek、硅基流动、OpenAI 或 OpenRouter API Key 浏览器直连无限使用。',
      en: 'Yes, with zero lock-in. Every mod exports cleanly as a standard .user.js file for Tampermonkey or ScriptCat. New installs include 10 free cloud generations, and you can connect your own DeepSeek, SiliconFlow, OpenAI, or OpenRouter API key anytime.',
    },
  },
  {
    q: {
      zh: 'PageCraft 会收集我的浏览记录或网页隐私内容吗？',
      en: 'Does PageCraft track my browsing history or store webpage content?',
    },
    a: {
      zh: '绝不记录浏览历史、搜索词或后台页面数据。仅在云端试用模式下点击「生成」或「微调」时，客户端会先对邮箱、长数字编号、API 密钥（sk-... / Bearer）、URL 参数与密码框执行本地自动脱敏，且服务器数据库绝不存储你的提示词或网页片段。',
      en: 'Never. PageCraft records zero background browsing history. Only when you click Generate or Refine in Cloud Trial mode does it send client-side redacted structural context, and prompts or webpage snippets are never stored in our database.',
    },
  },
];

function renderFaqHtml(): string {
  return LANDING_FAQS.map(
    (item, idx) => `<details class="faq-item"${idx === 0 ? ' open' : ''}>
      <summary class="faq-q">${biSpan(item.q)}</summary>
      <p class="faq-a">${biSpan(item.a)}</p>
    </details>`,
  ).join('\n');
}

function renderStructuredDataJson(lang: LandingLang, canonicalUrl: string, descText: string): string {
  const isEn = lang === 'en';
  const payload = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'PageCraft',
        applicationCategory: 'BrowserApplication',
        operatingSystem: 'Chrome, Microsoft Edge, Chromium',
        url: canonicalUrl,
        image: 'https://pagecraft.shenxin.space/og.svg',
        description: descText,
        inLanguage: isEn ? 'en' : 'zh-CN',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        featureList: isEn
          ? [
              'Shadow-DOM visual element picker',
              '0.1s zero-toggle live CSS restyling',
              'Isolated MV3 JavaScript userscript studio',
              '1-click Tampermonkey & ScriptCat .user.js export',
              '10 built-in webpage cleanup & table CSV export recipes',
              'Zero background tracking with local-first storage & BYOK',
            ]
          : [
              'Shadow DOM 可视化网页元素点选器',
              'CSS 免开关 0.1 秒实时样式净化与宽屏排版',
              'MV3 隔离沙箱油猴脚本生成与执行',
              '一键导出标准 Tampermonkey / 脚本猫 .user.js 脚本',
              '内置 10 款高频网站净化与网页表格导出 Excel/CSV 配方',
              '零后台隐私监控，支持本地存储与自带 DeepSeek/OpenAI Key',
            ],
        publisher: {
          '@type': 'Organization',
          name: 'PageCraft',
          url: 'https://pagecraft.shenxin.space/',
          email: 'botzgbj@gmail.com',
        },
      },
      {
        '@type': 'FAQPage',
        inLanguage: isEn ? 'en' : 'zh-CN',
        mainEntity: LANDING_FAQS.map((f) => ({
          '@type': 'Question',
          name: isEn ? f.q.en : f.q.zh,
          acceptedAnswer: {
            '@type': 'Answer',
            text: isEn ? f.a.en : f.a.zh,
          },
        })),
      },
    ],
  };
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function renderLandingHtml(initialLang: LandingLang): string {
  const htmlLangAttr = initialLang === 'en' ? 'en' : 'zh-CN';
  const canonicalUrl =
    initialLang === 'en'
      ? 'https://pagecraft.shenxin.space/?lang=en'
      : 'https://pagecraft.shenxin.space/';
  const titleText =
    initialLang === 'en'
      ? 'PageCraft — AI Webpage Tweaker & Userscript Studio'
      : 'PageCraft — AI 网页改造与油猴脚本助手';
  const descText =
    initialLang === 'en'
      ? 'Point at any webpage element and modify layouts, strip clutter, export tables to CSV, or generate Tampermonkey-compatible userscripts in plain words. Zero background tracking.'
      : '不用按 F12 翻代码，鼠标指哪改哪，一句话永久改造任何网页。支持 CSS 0.1s 实时生效、网页表格一键导出 Excel/CSV 与 Tampermonkey/脚本猫 .user.js 导出，零后台隐私监控。';

  const zhPressed = initialLang === 'zh' ? 'true' : 'false';
  const enPressed = initialLang === 'en' ? 'true' : 'false';
  const ldJson = renderStructuredDataJson(initialLang, canonicalUrl, descText);

  return `<!DOCTYPE html>
<html lang="${htmlLangAttr}" data-lang="${initialLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(titleText)}</title>
<meta name="description" content="${escHtml(descText)}">
<link rel="canonical" href="${canonicalUrl}">
<link rel="alternate" hreflang="zh-CN" href="https://pagecraft.shenxin.space/">
<link rel="alternate" hreflang="en" href="https://pagecraft.shenxin.space/?lang=en">
<link rel="alternate" hreflang="x-default" href="https://pagecraft.shenxin.space/">
<meta property="og:site_name" content="PageCraft">
<meta property="og:title" content="${escHtml(titleText)}">
<meta property="og:description" content="${escHtml(descText)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:locale" content="${initialLang === 'en' ? 'en_US' : 'zh_CN'}">
<meta property="og:locale:alternate" content="${initialLang === 'en' ? 'zh_CN' : 'en_US'}">
<meta property="og:image" content="https://pagecraft.shenxin.space/og.svg">
<meta property="og:image:type" content="image/svg+xml">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escHtml(titleText)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(titleText)}">
<meta name="twitter:description" content="${escHtml(descText)}">
<meta name="twitter:image" content="https://pagecraft.shenxin.space/og.svg">
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<script type="application/ld+json">${ldJson}</script>
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
  --primary-hover: #b04324;
  --primary-soft: rgba(201, 85, 51, 0.10);
  --primary-border: rgba(201, 85, 51, 0.28);
  --emerald: #15803d;
  --emerald-soft: rgba(21, 128, 61, 0.10);
  --emerald-border: rgba(21, 128, 61, 0.24);
  --border: rgba(28, 25, 23, 0.10);
  --border-strong: rgba(28, 25, 23, 0.18);
  --shadow-sm: 0 1px 2px rgba(28, 25, 23, 0.04), 0 3px 10px rgba(28, 25, 23, 0.05);
  --shadow-lg: 0 8px 24px -4px rgba(28, 25, 23, 0.08), 0 20px 48px -8px rgba(28, 25, 23, 0.07);
  --nav-bg: rgba(250, 248, 245, 0.88);
  --serif: "Newsreader", "Iowan Old Style", "Georgia", "Songti SC", "STSong", "Noto Serif SC", serif;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #131211;
    --bg-subtle: #1a1816;
    --surface: #1e1c1a;
    --surface-2: #252220;
    --ink: #f5f2ed;
    --ink-secondary: #d6d3cd;
    --muted: #a8a29e;
    --primary: #e06d4b;
    --primary-hover: #eb8060;
    --primary-soft: rgba(224, 109, 75, 0.15);
    --primary-border: rgba(224, 109, 75, 0.34);
    --emerald: #4ade80;
    --emerald-soft: rgba(74, 222, 128, 0.13);
    --emerald-border: rgba(74, 222, 128, 0.28);
    --border: rgba(255, 255, 255, 0.09);
    --border-strong: rgba(255, 255, 255, 0.18);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.28);
    --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.45), 0 24px 60px rgba(0, 0, 0, 0.4);
    --nav-bg: rgba(19, 18, 17, 0.88);
  }
}

html[data-theme="dark"] {
  --bg: #131211;
  --bg-subtle: #1a1816;
  --surface: #1e1c1a;
  --surface-2: #252220;
  --ink: #f5f2ed;
  --ink-secondary: #d6d3cd;
  --muted: #a8a29e;
  --primary: #e06d4b;
  --primary-hover: #eb8060;
  --primary-soft: rgba(224, 109, 75, 0.15);
  --primary-border: rgba(224, 109, 75, 0.34);
  --emerald: #4ade80;
  --emerald-soft: rgba(74, 222, 128, 0.13);
  --emerald-border: rgba(74, 222, 128, 0.28);
  --border: rgba(255, 255, 255, 0.09);
  --border-strong: rgba(255, 255, 255, 0.18);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.28);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.45), 0 24px 60px rgba(0, 0, 0, 0.4);
  --nav-bg: rgba(19, 18, 17, 0.88);
}

html[data-lang="zh"] [data-l="en"] { display: none !important; }
html[data-lang="en"] [data-l="zh"] { display: none !important; }

*, *::before, *::after { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  background-color: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  transition: background-color 180ms ease, color 180ms ease;
}

a { color: inherit; text-decoration: none; }

.container {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ─── Nav ───────────────────────────────────────────────────────────── */
.site-nav {
  position: sticky;
  top: 0;
  z-index: 40;
  background: var(--nav-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.nav-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 2px 6px rgba(201, 85, 51, 0.28));
  flex-shrink: 0;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 24px;
  font-size: 14px;
  color: var(--ink-secondary);
}

.nav-links a:hover {
  color: var(--primary);
}

.nav-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lang-switch {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 999px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}

.lang-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.lang-btn[aria-pressed="true"] {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.theme-btn {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.theme-btn:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}

/* ─── Hero ──────────────────────────────────────────────────────────── */
.hero {
  padding: 64px 0 56px;
}

.hero-header {
  max-width: 820px;
  margin: 0 auto 40px;
  text-align: center;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  border-radius: 999px;
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 20px;
}

.eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
}

.hero-title {
  font-family: var(--serif);
  font-size: clamp(30px, 4.6vw, 48px);
  line-height: 1.18;
  letter-spacing: -0.025em;
  font-weight: 600;
  margin: 0 0 18px;
  color: var(--ink);
}

.hero-sub {
  font-size: clamp(16px, 2vw, 18.5px);
  line-height: 1.65;
  color: var(--ink-secondary);
  max-width: 700px;
  margin: 0 auto 28px;
}

.store-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.store-badge {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  padding: 11px 18px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-sm);
  text-align: left;
  transition: transform 150ms ease, border-color 150ms ease;
}

.store-badge.primary-store {
  background: var(--ink);
  color: var(--bg);
  border-color: var(--ink);
}

.store-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.store-name {
  font-size: 14.5px;
  font-weight: 600;
}

.store-soon {
  font-size: 11.5px;
  opacity: 0.82;
  margin-top: 2px;
}

.store-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid var(--primary-border);
}

.store-badge.primary-store .store-pill {
  background: rgba(201, 85, 51, 0.24);
  color: #ffb49e;
  border-color: rgba(255, 180, 158, 0.35);
}

.store-note {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}

/* ─── Browser + SidePanel Pure CSS Mockup ───────────────────────────── */
.studio-frame {
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  margin-top: 36px;
}

.browser-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}

.window-dots {
  display: flex;
  gap: 6px;
}

.window-dots span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-strong);
}

.address-bar {
  flex: 1;
  max-width: 460px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 12px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
  white-space: nowrap;
}

.ext-pin {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
  padding: 3px 9px;
  border-radius: 999px;
}

.studio-split {
  display: grid;
  grid-template-columns: 1.32fr 1fr;
  min-height: 410px;
}

.webpage-pane {
  padding: 22px;
  background: var(--surface-2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mock-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mock-page-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--ink);
}

.mock-hidden-pill {
  font-size: 11.5px;
  color: var(--emerald);
  background: var(--emerald-soft);
  border: 1px solid var(--emerald-border);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}

.picker-target-box {
  position: relative;
  border: 2px solid var(--primary);
  border-radius: 12px;
  background: var(--surface);
  padding: 16px;
  box-shadow: 0 0 0 4px var(--primary-soft);
}

.picker-hud-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--primary);
  color: #faf8f5;
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 6px;
  margin-bottom: 12px;
}

.mock-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 8px;
}

.mock-table-caption {
  font-size: 12.5px;
  color: var(--muted);
  font-weight: 500;
}

.mock-injected-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 7px;
  background: var(--primary);
  color: #faf8f5;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(201, 85, 51, 0.26);
}

.mock-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.mock-table th,
.mock-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.mock-table th {
  color: var(--muted);
  font-weight: 600;
  font-size: 11.5px;
  background: var(--bg-subtle);
}

.mock-table tr:last-child td {
  border-bottom: 0;
}

.mock-page-foot {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 6px;
}

/* Right pane: SidePanel Studio */
.sidepanel-pane {
  padding: 16px 18px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sp-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--serif);
  font-weight: 600;
  font-size: 15px;
}

.sp-host-pill {
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--ink-secondary);
}

.sp-seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--bg-subtle);
  padding: 2px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
  text-align: center;
}

.sp-seg span {
  padding: 4px 6px;
  border-radius: 999px;
  color: var(--muted);
}

.sp-seg span.active {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
}

.sp-locked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
  font-size: 12px;
  color: var(--primary);
  font-weight: 600;
}

.sp-locked code {
  font-family: var(--mono);
  font-size: 11.5px;
}

.sp-prompt-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--ink);
  line-height: 1.5;
}

.sp-result-card {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 11px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  box-shadow: var(--shadow-sm);
}

.sp-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.sp-result-title {
  font-size: 13.5px;
  font-weight: 600;
}

.sp-badges {
  display: inline-flex;
  gap: 5px;
  flex-wrap: wrap;
}

.engine-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.badge-css {
  background: var(--emerald-soft);
  color: var(--emerald);
  border: 1px solid var(--emerald-border);
}

.badge-js {
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid var(--primary-border);
}

.sp-hit-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--emerald-soft);
  border: 1px solid var(--emerald-border);
  color: var(--emerald);
  font-size: 12px;
  font-weight: 600;
}

.sp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-btn-primary {
  flex: 1;
  text-align: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--primary);
  color: #faf8f5;
  font-size: 12px;
  font-weight: 600;
}

.sp-btn-outline {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  color: var(--ink-secondary);
  font-size: 12px;
  font-weight: 500;
}

/* ─── Generic Sections ──────────────────────────────────────────────── */
.section {
  padding: 68px 0;
  border-top: 1px solid var(--border);
}

.section-head {
  max-width: 680px;
  margin-bottom: 38px;
}

.section-kicker {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--primary);
  margin-bottom: 8px;
}

.section-title {
  font-family: var(--serif);
  font-size: clamp(24px, 3.2vw, 34px);
  line-height: 1.24;
  letter-spacing: -0.02em;
  margin: 0 0 10px;
  font-weight: 600;
}

.section-sub {
  margin: 0;
  color: var(--ink-secondary);
  font-size: 16px;
}

/* ─── How It Works (3 Steps) ────────────────────────────────────────── */
.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.step-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
  color: var(--primary);
  font-family: var(--serif);
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 14px;
}

.step-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
}

.step-desc {
  margin: 0;
  color: var(--ink-secondary);
  font-size: 14.5px;
  line-height: 1.62;
}

/* ─── Core Highlights (6 Cards) ─────────────────────────────────────── */
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.feature-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 160ms ease, transform 160ms ease;
}

.feature-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
}

.feature-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.feature-title {
  margin: 2px 0 0;
  font-size: 16.5px;
  font-weight: 600;
  line-height: 1.35;
}

.feature-desc {
  margin: 0;
  color: var(--ink-secondary);
  font-size: 14px;
  line-height: 1.62;
}

/* ─── 10 Built-in Recipes Showcase ──────────────────────────────────── */
.recipe-header-bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.recipe-header-bar .section-head {
  margin-bottom: 0;
}

.recipe-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  background: var(--bg-subtle);
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--border);
}

.recipe-tab {
  border: 0;
  background: transparent;
  color: var(--ink-secondary);
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 13px;
  border-radius: 9px;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.recipe-tab[aria-selected="true"] {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.recipes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.recipe-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
}

.recipe-card[hidden] {
  display: none !important;
}

.recipe-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.recipe-tag {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

.recipe-title {
  margin: 2px 0 0;
  font-size: 16px;
  font-weight: 600;
}

.recipe-desc {
  margin: 0;
  font-size: 13.8px;
  color: var(--ink-secondary);
  line-height: 1.58;
  flex: 1;
}

.recipe-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px dashed var(--border);
  font-size: 12px;
  color: var(--muted);
}

.recipe-scope {
  font-family: var(--mono);
  font-size: 11.5px;
}

.recipe-ready {
  color: var(--primary);
  font-weight: 600;
}

/* ─── FAQ Accordion ─────────────────────────────────────────────────── */
.faq-list {
  display: grid;
  gap: 12px;
  max-width: 860px;
}

.faq-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
}

.faq-q {
  cursor: pointer;
  font-weight: 600;
  font-size: 15.5px;
  color: var(--ink);
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.faq-q::-webkit-details-marker {
  display: none;
}

.faq-q::after {
  content: "+";
  font-size: 18px;
  font-weight: 500;
  color: var(--primary);
  flex-shrink: 0;
}

.faq-item[open] .faq-q::after {
  content: "−";
}

.faq-a {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  font-size: 14.5px;
  line-height: 1.66;
  color: var(--ink-secondary);
}

/* ─── Privacy Banner & Footer ───────────────────────────────────────── */
.trust-band {
  margin-top: 48px;
  padding: 24px 28px;
  border-radius: 14px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.trust-band h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.trust-band p {
  margin: 0;
  font-size: 14px;
  color: var(--ink-secondary);
}

.trust-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--primary);
  white-space: nowrap;
}

.trust-link:hover {
  border-color: var(--primary);
}

.site-footer {
  border-top: 1px solid var(--border);
  padding: 36px 0 48px;
  color: var(--muted);
  font-size: 13.5px;
}

.footer-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.footer-links {
  display: flex;
  align-items: center;
  gap: 22px;
  flex-wrap: wrap;
}

.footer-links a {
  color: var(--ink-secondary);
  font-weight: 500;
}

.footer-links a:hover {
  color: var(--primary);
  text-decoration: underline;
}

@media (max-width: 920px) {
  .studio-split {
    grid-template-columns: 1fr;
  }
  .webpage-pane {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .steps-grid,
  .features-grid {
    grid-template-columns: 1fr;
  }
  .recipes-grid {
    grid-template-columns: 1fr;
  }
  .nav-links {
    display: none;
  }
}
</style>
</head>
<body>

<header class="site-nav">
  <div class="nav-inner">
    <a href="#" class="brand-link" aria-label="PageCraft">
      <span class="brand-mark" aria-hidden="true">
        ${renderBrandIconSvg(30, 'pcg-nav')}
      </span>
      <span>PageCraft</span>
    </a>

    <nav class="nav-links" aria-label="Primary">
      <a href="#how-it-works">${biSpan({ zh: '工作原理', en: 'How It Works' })}</a>
      <a href="#features">${biSpan({ zh: '核心亮点', en: 'Features' })}</a>
      <a href="#recipes">${biSpan({ zh: '10 款内置配方', en: '10 Recipes' })}</a>
      <a href="#faq">${biSpan({ zh: '常见问题', en: 'FAQ' })}</a>
      <a href="/privacy">${biSpan({ zh: '隐私政策', en: 'Privacy' })}</a>
    </nav>

    <div class="nav-controls">
      <div class="lang-switch" role="group" aria-label="Language switch">
        <button type="button" id="lang-zh" class="lang-btn" data-set-lang="zh" aria-pressed="${zhPressed}">中文</button>
        <button type="button" id="lang-en" class="lang-btn" data-set-lang="en" aria-pressed="${enPressed}">EN</button>
      </div>
      <button type="button" id="theme-toggle" class="theme-btn" aria-label="Toggle color theme" title="Toggle light / dark theme">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
      </button>
    </div>
  </div>
</header>

<main>
  <!-- Hero -->
  <section class="hero">
    <div class="container">
      <div class="hero-header">
        <div class="eyebrow">
          <span class="eyebrow-dot"></span>
          ${biSpan({
            zh: 'AI 网页改造与油猴脚本工坊 · 零后台隐私监控',
            en: 'AI Webpage Tweaker & Userscript Studio · Zero Background Tracking',
          })}
        </div>

        <h1 class="hero-title">
          ${biSpan({
            zh: '不用按 F12 翻代码，鼠标指哪改哪，一句话永久改造任何网页',
            en: 'No F12 DevTools Hunting — Point at Any Element and Reshape Any Webpage in Plain Words',
          })}
        </h1>

        <p class="hero-sub">
          ${biSpan({
            zh: '驻留在浏览器侧边栏的可视化网页定制工坊。去广告干扰、改暖白宽屏阅读、给网页表格焊上「一键导出 CSV」按钮——开箱送 10 次免费云端生成额度，更支持自带 API Key 无限畅用。',
            en: 'A Manifest V3 Side Panel studio combining a Shadow-DOM Element Picker, 0.1s live CSS restyling, and isolated JS userscripts — with 10 free cloud generations out of the box plus unlimited BYOK.',
          })}
        </p>

        <div class="store-row">
          <div class="store-badge primary-store" role="status">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="4"/>
              <line x1="21.17" y1="8" x2="12" y2="8"/>
              <line x1="3.95" y1="6.06" x2="8.54" y2="14"/>
              <line x1="10.88" y1="21.94" x2="15.46" y2="14"/>
            </svg>
            <div class="store-meta">
              <span class="store-name">Chrome Web Store</span>
              <span class="store-soon">${biSpan({ zh: 'MV3 官方侧边栏扩展', en: 'MV3 Side Panel Extension' })}</span>
            </div>
            <span class="store-pill">${biSpan({ zh: '即将上线', en: 'Coming Soon' })}</span>
          </div>

          <div class="store-badge" role="status">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z"/>
              <path d="M8 14.5c1.2 1.6 3.1 2.5 5.2 2.5 2.8 0 4.8-1.5 4.8-3.6 0-2-1.8-3.4-4.5-3.4-2.5 0-4.5 1.4-4.5 3.3"/>
            </svg>
            <div class="store-meta">
              <span class="store-name">${biSpan({ zh: 'Microsoft Edge 加载项', en: 'Microsoft Edge Add-ons' })}</span>
              <span class="store-soon">${biSpan({ zh: 'Chromium 内核全兼容', en: 'Full Chromium Support' })}</span>
            </div>
            <span class="store-pill">${biSpan({ zh: '即将上线', en: 'Coming Soon' })}</span>
          </div>
        </div>

        <p class="store-note">
          ${biSpan({
            zh: '即将上线 / Coming Soon — 支持本地安装或商店搜索 PageCraft',
            en: 'Coming Soon — Supports local unpacked install or searching "PageCraft" in Chrome & Edge stores',
          })}
        </p>
      </div>

      <!-- Illustrative Side-by-Side Browser + SidePanel Mockup -->
      <div class="studio-frame" aria-label="PageCraft Browser and SidePanel Interactive Preview">
        <div class="browser-chrome">
          <div class="window-dots" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div class="address-bar">
            <span>https://ops.example.com/finance/settlements</span>
            <span>🔒</span>
          </div>
          <div class="ext-pin">
            ${renderBrandIconSvg(16, 'pcg-pin')}
            <span>PageCraft</span>
          </div>
        </div>

        <div class="studio-split">
          <!-- Left: Simulated Live Webpage with Element Picker Highlight -->
          <div class="webpage-pane">
            <div class="mock-page-head">
              <span class="mock-page-title">${biSpan({ zh: '月度结算明细台账', en: 'Monthly Settlement Ledger' })}</span>
              <span class="mock-hidden-pill">${biSpan({ zh: '✓ 右侧推广栏已自动隐藏 (CSS 0.1s)', en: '✓ Right promo rail hidden (CSS 0.1s)' })}</span>
            </div>

            <div class="picker-target-box">
              <div class="picker-hud-label">
                <span>🎯</span>
                <span>table.settlement-grid · 128 tr</span>
              </div>

              <div class="mock-table-toolbar">
                <span class="mock-table-caption">${biSpan({ zh: '共 128 条记录 · 实时挂载导出按钮', en: '128 rows · Live Export button mounted' })}</span>
                <span class="mock-injected-btn">
                  <span>⬇</span>
                  ${biSpan({ zh: '导出 CSV (UTF-8)', en: 'Export CSV (UTF-8)' })}
                </span>
              </div>

              <table class="mock-table">
                <thead>
                  <tr>
                    <th>${biSpan({ zh: '单据编号', en: 'Order ID' })}</th>
                    <th>${biSpan({ zh: '合作方', en: 'Partner' })}</th>
                    <th>${biSpan({ zh: '结算金额', en: 'Amount' })}</th>
                    <th>${biSpan({ zh: '状态', en: 'Status' })}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>#STL-2048</code></td>
                    <td>${biSpan({ zh: '星河云科', en: 'Nova Cloud' })}</td>
                    <td>¥ 42,800.00</td>
                    <td>${biSpan({ zh: '已核销', en: 'Cleared' })}</td>
                  </tr>
                  <tr>
                    <td><code>#STL-2049</code></td>
                    <td>${biSpan({ zh: '远山智造', en: 'Peak Works' })}</td>
                    <td>¥ 19,560.00</td>
                    <td>${biSpan({ zh: '待导出', en: 'Pending' })}</td>
                  </tr>
                  <tr>
                    <td><code>#STL-2050</code></td>
                    <td>${biSpan({ zh: '青禾数媒', en: 'Reed Media' })}</td>
                    <td>¥ 68,120.00</td>
                    <td>${biSpan({ zh: '已核销', en: 'Cleared' })}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mock-page-foot">
              <span>${biSpan({ zh: 'Shadow DOM 隔离点选层 · 不污染原网页样式', en: 'Shadow-DOM isolated picker · Zero style leakage' })}</span>
              <span>@match https://ops.example.com/*</span>
            </div>
          </div>

          <!-- Right: PageCraft SidePanel Studio -->
          <div class="sidepanel-pane">
            <div class="sp-top">
              <span class="sp-brand">${renderBrandIconSvg(18, 'pcg-sp')}<span>PageCraft</span></span>
              <span class="sp-host-pill">ops.example.com · 1</span>
            </div>

            <div class="sp-seg" aria-hidden="true">
              <span class="active">${biSpan({ zh: '工坊', en: 'Studio' })}</span>
              <span>${biSpan({ zh: '我的改造 3', en: 'My Mods 3' })}</span>
              <span>${biSpan({ zh: '设置', en: 'Settings' })}</span>
            </div>

            <div class="sp-locked">
              <span>${biSpan({ zh: '🎯 已锁定目标', en: '🎯 Locked target' })}</span>
              <code>table.settlement-grid</code>
            </div>

            <div class="sp-prompt-card">
              ${biSpan({
                zh: '“隐藏右侧杂乱推广栏，并给这个表格右上角加一个导出 Excel / CSV 按钮，中文不要乱码”',
                en: '“Hide the right promo rail and add an Export CSV / Excel button with UTF-8 BOM above this table”',
              })}
            </div>

            <div class="sp-result-card">
              <div class="sp-result-head">
                <span class="sp-result-title">${biSpan({ zh: '结算表一键导出 CSV + 纯净宽屏', en: 'Ledger CSV Export & Clean Layout' })}</span>
                <div class="sp-badges">
                  <span class="engine-pill badge-css">${biSpan({ zh: 'CSS 免开关秒生效', en: 'Instant CSS' })}</span>
                  <span class="engine-pill badge-js">${biSpan({ zh: 'JS 油猴脚本', en: 'JS Userscript' })}</span>
                </div>
              </div>

              <div class="sp-hit-banner">
                <span>✓</span>
                <span>${biSpan({
                  zh: '已在当前页命中目标元素（table.settlement-grid）',
                  en: 'Matched live target element on this page (table.settlement-grid)',
                })}</span>
              </div>

              <div class="sp-actions">
                <span class="sp-btn-primary">${biSpan({ zh: '✓ 已应用到网页', en: '✓ Applied to Page' })}</span>
                <span class="sp-btn-outline">${biSpan({ zh: '复制 .user.js', en: 'Copy .user.js' })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- How It Works (3 Steps) -->
  <section id="how-it-works" class="section">
    <div class="container">
      <div class="section-head">
        <div class="section-kicker">${biSpan({ zh: '三步完成改造', en: 'How It Works' })}</div>
        <h2 class="section-title">${biSpan({ zh: '从看到不顺眼，到永久顺手，只需三步', en: 'From Annoying Layout to Permanent Upgrade in 3 Steps' })}</h2>
        <p class="section-sub">${biSpan({
          zh: '告别在 F12 控制台里翻找混淆类名，也告别网页版 AI 瞎猜选择器跑不通的尴尬。',
          en: 'Stop digging through minified DOM trees or pasting broken selectors guessed by chat tabs.',
        })}</p>
      </div>

      <div class="steps-grid">
        <div class="step-card">
          <div class="step-num">1</div>
          <h3 class="step-title">${biSpan({ zh: '① 点选网页元素', en: '① Pick Any Webpage Element' })}</h3>
          <p class="step-desc">${biSpan({
            zh: '开启 Shadow DOM 可视化点选器，鼠标指向任意弹窗、侧栏或数据表即可高亮锁定，自动提取稳定 CSS 选择器、同类列表选择器与脱敏局部 DOM 骨架。',
            en: 'Click any popup, sidebar, or table on the live page. PageCraft captures resilient CSS selectors, repeating row patterns, and PII-redacted DOM skeletons automatically.',
          })}</p>
        </div>

        <div class="step-card">
          <div class="step-num">2</div>
          <h3 class="step-title">${biSpan({ zh: '② 用大白话描述效果', en: '② Describe the Effect in Plain Words' })}</h3>
          <p class="step-desc">${biSpan({
            zh: '直接输入你想怎么改——「隐藏右侧推荐并调宽正文」或「给表格加个导出 CSV 按钮」。生成后自动检测当前页选择器命中数，还支持连续对话追问微调。',
            en: 'Say what you want in everyday language. PageCraft verifies live selector hits against the active tab and supports multi-turn conversational refinement.',
          })}</p>
        </div>

        <div class="step-card">
          <div class="step-num">3</div>
          <h3 class="step-title">${biSpan({ zh: '③ CSS 秒生效 / JS 沙箱持久运行', en: '③ Instant CSS / Persistent JS Sandbox' })}</h3>
          <p class="step-desc">${biSpan({
            zh: '纯视觉排版改造走原生 CSS 通道，免开任何开关 0.1 秒实时生效与还原；交互增强脚本在官方 userScripts 隔离沙箱内持久运行，下次访问自动生效。',
            en: 'Visual tweaks apply in 0.1s via native insertCSS with zero toggles; interactive scripts run safely inside Chrome MV3 userScripts on every visit.',
          })}</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Core Highlights (6 Cards) -->
  <section id="features" class="section">
    <div class="container">
      <div class="section-head">
        <div class="section-kicker">${biSpan({ zh: '核心能力', en: 'Core Highlights' })}</div>
        <h2 class="section-title">${biSpan({ zh: '兼具新手零门槛体验与极客级扩展自由度', en: 'Zero-Setup Simplicity Meets Full Userscript Power' })}</h2>
        <p class="section-sub">${biSpan({
          zh: '专为高频办公后台、技术文档与内容社区打造的现代浏览器改造工坊。',
          en: 'Engineered for internal dashboards, documentation portals, and high-traffic web apps.',
        })}</p>
      </div>

      <div class="features-grid">
        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>
            </svg>
          </div>
          <h3 class="feature-title">${biSpan({ zh: 'Shadow DOM 精准点选', en: 'Shadow-DOM Precision Picker' })}</h3>
          <p class="feature-desc">${biSpan({
            zh: '隔离式点选浮层绝不污染原网页样式，自动校验目标选择器在当前真实页面的命中节点数，遇到偏移可一键「自动校准选择器」。',
            en: 'Style-isolated hover reticle captures stable selectors on complex SPAs, probes live match counts, and recalibrates with one click.',
          })}</p>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <h3 class="feature-title">${biSpan({ zh: 'CSS + JS 双引擎分级（纯样式免开关 0.1s 生效）', en: 'CSS + JS Dual Engine (0.1s Zero-Toggle CSS)' })}</h3>
          <p class="feature-desc">${biSpan({
            zh: '去广告位、宽屏阅读、深色护眼走 insertCSS 引擎，无需开启任何开发者开关，装上第 1 秒即可 0.1s 生效与关闭还原；复杂自动化走 userScripts 沙箱。',
            en: 'Restyling runs via insertCSS in 0.1s with zero developer toggles required; custom buttons and DOM automations execute in MV3 isolated userScripts.',
          })}</p>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
            </svg>
          </div>
          <h3 class="feature-title">${biSpan({ zh: '内置 10 款高频一键同款配方', en: '10 Built-In 1-Click Recipes' })}</h3>
          <p class="feature-desc">${biSpan({
            zh: '预置沉浸宽屏护眼阅读、网页表格一键导出 CSV、解除复制限制、知乎/B站/小红书清爽净化等 10 款高频同款，无需写提示词点一下即用。',
            en: 'Ships with 10 instant recipes for widescreen reading, smart dark mode, table-to-CSV export, copy unlocking, and distraction-free feeds.',
          })}</p>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
          </div>
          <h3 class="feature-title">${biSpan({ zh: '100% 兼容 Tampermonkey 与脚本猫 .user.js 导入导出', en: '100% Tampermonkey & ScriptCat .user.js Import / Export' })}</h3>
          <p class="feature-desc">${biSpan({
            zh: '所有 CSS 与 JS 改造规则均可一键复制导出为标准 // ==UserScript== (.user.js) 格式，也支持直接粘贴导入现成油猴脚本集中管理。',
            en: 'Export any CSS or JS mod as a standard // ==UserScript== (.user.js) file in one click, or paste-import existing userscripts effortlessly.',
          })}</p>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
          </div>
          <h3 class="feature-title">${biSpan({ zh: '开箱送 10 次免费云端额度 + 自带 Key 无限用', en: '10 Free Cloud Credits + Unlimited BYOK' })}</h3>
          <p class="feature-desc">${biSpan({
            zh: '新安装免注册即赠 10 次云端 AI 生成额度；随时支持填入 DeepSeek、硅基流动（SiliconFlow）、OpenAI 或 OpenRouter 自带 API Key 浏览器直连无限使用。',
            en: 'Start immediately with 10 zero-setup cloud AI credits, or connect your own DeepSeek, SiliconFlow, OpenAI, or OpenRouter API key locally for unlimited generations.',
          })}</p>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>
            </svg>
          </div>
          <h3 class="feature-title">${biSpan({ zh: '零后台监控隐私承诺', en: 'Zero Background Telemetry Guarantee' })}</h3>
          <p class="feature-desc">${biSpan({
            zh: '绝不记录浏览历史、搜索词或剪贴板数据；规则与自带密钥严格保存在本地浏览器。可选「生效了吗？」反馈仅统计匿名计数，不含网址或代码。',
            en: 'Never logs browsing history, search queries, or clipboard data. Saved mods and BYOK keys stay in local storage; optional 👍/👎 feedback records anonymous daily counts only.',
          })}</p>
        </article>
      </div>
    </div>
  </section>

  <!-- Built-in 10 Recipes Showcase -->
  <section id="recipes" class="section">
    <div class="container">
      <div class="recipe-header-bar">
        <div class="section-head">
          <div class="section-kicker">${biSpan({ zh: '开箱即用', en: 'Built-In Library' })}</div>
          <h2 class="section-title">${biSpan({ zh: '预置 10 款高频同款配方，点一下立即启用', en: '10 Built-In 1-Click Recipes, Ready Out of the Box' })}</h2>
          <p class="section-sub">${biSpan({
            zh: '半数采用免开关 CSS 实时引擎，装上第 1 秒即可改造任意网页。',
            en: 'Half run on our zero-toggle Instant CSS engine so your very first click transforms the page in 0.1s.',
          })}</p>
        </div>

        <div class="recipe-tabs" role="tablist" aria-label="Filter built-in recipes">
          <button type="button" class="recipe-tab" role="tab" data-filter="all" aria-selected="true">
            ${biSpan({ zh: '全部 (10)', en: 'All (10)' })}
          </button>
          <button type="button" class="recipe-tab" role="tab" data-filter="css" aria-selected="false">
            ${biSpan({ zh: 'CSS 秒生效 (5)', en: 'Instant CSS (5)' })}
          </button>
          <button type="button" class="recipe-tab" role="tab" data-filter="js" aria-selected="false">
            ${biSpan({ zh: 'JS 交互增强 (5)', en: 'JS Userscripts (5)' })}
          </button>
        </div>
      </div>

      <div id="recipes-grid" class="recipes-grid">
        ${renderRecipesHtml()}
      </div>

      <div class="trust-band">
        <div>
          <h3>${biSpan({ zh: '透明、克制的隐私边界', en: 'Transparent, Local-First Privacy by Design' })}</h3>
          <p>${biSpan({
            zh: 'PageCraft 无远程代码动态下发，所有样式与脚本均由你主动创建、导入并保存在本地设备。',
            en: 'No remote code execution. Every CSS rule and userscript lives locally on your device under your explicit control.',
          })}</p>
        </div>
        <a href="/privacy" class="trust-link">
          ${biSpan({ zh: '阅读完整隐私政策 →', en: 'Read Privacy Policy →' })}
        </a>
      </div>
    </div>
  </section>

  <!-- Frequently Asked Questions (aligned with FAQPage JSON-LD) -->
  <section id="faq" class="section">
    <div class="container">
      <div class="section-head">
        <div class="section-kicker">${biSpan({ zh: '常见问题', en: 'FAQ' })}</div>
        <h2 class="section-title">${biSpan({ zh: '关于网页改造、隐私与自带密钥的常见解答', en: 'Frequently Asked Questions' })}</h2>
      </div>
      <div class="faq-list">
        ${renderFaqHtml()}
      </div>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="container footer-inner">
    <div>
      <strong>PageCraft</strong> · ${biSpan({
        zh: 'AI 网页改造与油猴脚本助手',
        en: 'AI Webpage Tweaker & Userscript Studio',
      })}
    </div>

    <div class="footer-links">
      <a href="/playground">${biSpan({ zh: '练习靶场', en: 'Live Sandbox' })}</a>
      <a href="/privacy">${biSpan({ zh: '隐私政策', en: 'Privacy Policy' })}</a>
      <a href="https://github.com/botshen/plugin-radar" rel="noopener noreferrer">GitHub</a>
      <a href="mailto:botzgbj@gmail.com">botzgbj@gmail.com</a>
    </div>
  </div>
</footer>

<script>
(function () {
  var root = document.documentElement;
  var titles = {
    zh: 'PageCraft — AI 网页改造与油猴脚本助手',
    en: 'PageCraft — AI Webpage Tweaker & Userscript Studio'
  };

  function applyLang(lang, persist) {
    var next = lang === 'en' ? 'en' : 'zh';
    root.setAttribute('data-lang', next);
    root.setAttribute('lang', next === 'en' ? 'en' : 'zh-CN');
    document.title = titles[next];
    var zhBtn = document.getElementById('lang-zh');
    var enBtn = document.getElementById('lang-en');
    if (zhBtn) zhBtn.setAttribute('aria-pressed', next === 'zh' ? 'true' : 'false');
    if (enBtn) enBtn.setAttribute('aria-pressed', next === 'en' ? 'true' : 'false');
    if (persist) {
      try { localStorage.setItem('pc_site_lang', next); } catch (e) {}
      try {
        var u = new URL(window.location.href);
        if (next === 'en') u.searchParams.set('lang', 'en');
        else u.searchParams.delete('lang');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) {}
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

  var tabs = document.querySelectorAll('.recipe-tab');
  var cards = document.querySelectorAll('.recipe-card');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      var filter = this.getAttribute('data-filter') || 'all';
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].setAttribute('aria-selected', tabs[j] === this ? 'true' : 'false');
      }
      for (var k = 0; k < cards.length; k++) {
        var eng = cards[k].getAttribute('data-engine');
        if (filter === 'all' || eng === filter) {
          cards[k].removeAttribute('hidden');
        } else {
          cards[k].setAttribute('hidden', '');
        }
      }
    });
  }
})();
</script>
</body>
</html>
`;
}

const HTML_ZH = renderLandingHtml('zh');
const HTML_EN = renderLandingHtml('en');

export function handleLanding(request?: Request): Response {
  const lang = resolveLandingLang(request);
  const body = lang === 'en' ? HTML_EN : HTML_ZH;
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
