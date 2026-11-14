/**
 * Built-in 1-click recipe library ("热门同款一键改造").
 *
 * Half of these recipes use `engine: 'css'` so brand-new Chrome Web Store
 * installs can see live webpage transformations in 0.1s with ZERO developer /
 * Allow-User-Scripts setup. Universal recipes bind their `@match` pattern to
 * the active tab's host when clicked; site-specific recipes target high-traffic
 * platforms out of the box.
 */

import type { ModEngine, UserScript, UserScriptRunAt } from './types';
import { hostPatternFromUrl } from './matcher';

export type TemplateCategory = 'clean' | 'extract' | 'focus' | 'unlock';

export interface TemplateRecipe {
  id: string;
  engine: ModEngine;
  category: TemplateCategory;
  /** 'current_site' binds @match to active tab host; 'fixed_site' uses fixedMatches. */
  scope: 'current_site' | 'fixed_site';
  fixedMatches?: string[];
  /** Host substring hints used to surface site-specific recipes at the top when visiting that site. */
  siteHints?: string[];
  runAt?: UserScriptRunAt;
  zh: {
    name: string;
    description: string;
    tag: string;
  };
  en: {
    name: string;
    description: string;
    tag: string;
  };
  css?: string;
  code?: string;
}

export const BUILTIN_TEMPLATES: TemplateRecipe[] = [
  {
    id: 'tpl-widescreen-reader',
    engine: 'css',
    category: 'clean',
    scope: 'current_site',
    runAt: 'document_start',
    zh: {
      name: '沉浸宽屏护眼阅读',
      description: '收起常见侧边推荐栏与悬浮角标，拓宽正文排版并切换暖白纸感护眼底色',
      tag: '免开关秒生效',
    },
    en: {
      name: 'Warm Widescreen Reader',
      description: 'Hide common sidebars and floating widgets, widen article body, and apply warm paper contrast',
      tag: 'Instant CSS',
    },
    css: `/* PageCraft: Warm Widescreen Reader */
aside:not([role="dialog"]),
[class*="sidebar" i]:not(main *),
[class*="right-rail" i],
[class*="ad-banner" i],
[class*="float-bar" i],
[class*="back-to-top" i] {
  display: none !important;
}
html, body {
  background-color: #f8f5ee !important;
  color: #1f1e1b !important;
}
article, main, [role="main"], .post-content, .article-content, .markdown-body {
  max-width: min(920px, 92vw) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  line-height: 1.78 !important;
  font-size: 16.5px !important;
}`,
  },
  {
    id: 'tpl-smart-dark-mode',
    engine: 'css',
    category: 'clean',
    scope: 'current_site',
    runAt: 'document_start',
    zh: {
      name: '刺眼白底转柔和深色模式',
      description: '为没有夜间模式的内网后台或文档站开启深色滤镜，图片与视频保持原色不反相',
      tag: '免开关秒生效',
    },
    en: {
      name: 'Smart Dark Mode Filter',
      description: 'Convert bright white dashboards and docs to soft dark mode while keeping images & video natural',
      tag: 'Instant CSS',
    },
    css: `/* PageCraft: Smart Dark Mode with Media Preservation */
html {
  filter: invert(0.91) hue-rotate(180deg) !important;
  background-color: #121212 !important;
}
img, video, picture, canvas, iframe, svg image, [style*="background-image"] {
  filter: invert(1) hue-rotate(180deg) !important;
}`,
  },
  {
    id: 'tpl-table-csv-export',
    engine: 'js',
    category: 'extract',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '网页表格一键导出 Excel / CSV',
      description: '自动识别页面内数据表，在表格右上角挂载「导出 CSV」按钮（含 UTF-8 BOM，Excel 打开中文不乱码）',
      tag: '打工人刚需',
    },
    en: {
      name: 'One-Click Table to CSV / Excel',
      description: 'Inject an Export CSV button above every data table with UTF-8 BOM encoding for clean Excel import',
      tag: 'Data Export',
    },
    code: `(() => {
  if (window.__pcTableCsvInstalled) return;
  window.__pcTableCsvInstalled = true;

  function toCsvCell(text) {
    const clean = String(text ?? '').replace(/\\r?\\n|\\r/g, ' ').replace(/\\s+/g, ' ').trim();
    if (/[",\\n]/.test(clean)) return '"' + clean.replace(/"/g, '""') + '"';
    return clean;
  }

  function exportTable(table, index) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const lines = rows
      .map((tr) => Array.from(tr.querySelectorAll('th, td')).map((cell) => toCsvCell(cell.innerText)).join(','))
      .filter((line) => line.length > 0);
    if (lines.length === 0) return;

    const blob = new Blob(['\\uFEFF' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const host = location.hostname.replace(/^www\\./, '');
    a.href = url;
    a.download = host + '-table-' + (index + 1) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function decorateTables() {
    const tables = document.querySelectorAll('table');
    tables.forEach((table, idx) => {
      if (table.dataset.pcCsvReady === '1') return;
      if (table.querySelectorAll('tr').length < 2) return;
      table.dataset.pcCsvReady = '1';

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;justify-content:flex-end;margin:6px 0;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '导出 CSV';
      btn.style.cssText =
        'padding:4px 10px;font-size:12px;line-height:1.4;font-weight:600;color:#fff;background:#c6613f;' +
        'border:none;border-radius:6px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.16);';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportTable(table, idx);
      });
      wrapper.appendChild(btn);
      table.parentNode && table.parentNode.insertBefore(wrapper, table);
    });
  }

  decorateTables();
  const obs = new MutationObserver(() => decorateTables());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();`,
  },
  {
    id: 'tpl-unlock-copy',
    engine: 'js',
    category: 'unlock',
    scope: 'current_site',
    runAt: 'document_start',
    zh: {
      name: '解除网页复制与右键限制',
      description: '恢复文字选中能力并拦截烦人的禁止复制、复制强制追加小尾巴与右键封锁',
      tag: '查资料必备',
    },
    en: {
      name: 'Unlock Copy, Select & Right-Click',
      description: 'Restore text selection and bypass copy blockers, copyright tails, and context-menu locks',
      tag: 'Unlocker',
    },
    code: `(() => {
  if (window.__pcUnlockCopy) return;
  window.__pcUnlockCopy = true;

  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { -webkit-user-select: text !important; user-select: text !important; }';
  (document.head || document.documentElement).appendChild(style);

  const EVENTS = ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'];
  for (const evt of EVENTS) {
    window.addEventListener(evt, (e) => e.stopImmediatePropagation(), true);
  }
})();`,
  },
  {
    id: 'tpl-zhihu-clean',
    engine: 'css',
    category: 'focus',
    scope: 'fixed_site',
    fixedMatches: ['https://*.zhihu.com/*'],
    siteHints: ['zhihu.com'],
    runAt: 'document_start',
    zh: {
      name: '知乎纯净宽屏去弹窗',
      description: '隐藏右侧杂乱栏、App 引导横幅与非必要悬浮框，问题与回答主体居中加宽展示',
      tag: '知乎专享 · 秒生效',
    },
    en: {
      name: 'Zhihu Clean Centered Reader',
      description: 'Hide right-rail clutter and promo banners on Zhihu and widen the main answer column',
      tag: 'Zhihu · Instant CSS',
    },
    css: `/* PageCraft: Zhihu Clean Reader */
.GlobalSideBar,
.Question-sideColumn,
.Pc-card,
.Pc-word,
.AppBanner,
.CornerButtons {
  display: none !important;
}
.Topstory-container,
.Question-main {
  width: min(920px, 94vw) !important;
  max-width: 920px !important;
  justify-content: center !important;
}
.Topstory-mainColumn,
.Question-mainColumn {
  width: 100% !important;
  max-width: 880px !important;
}`,
  },
  {
    id: 'tpl-bilibili-focus',
    engine: 'css',
    category: 'focus',
    scope: 'fixed_site',
    fixedMatches: ['https://*.bilibili.com/*'],
    siteHints: ['bilibili.com'],
    runAt: 'document_start',
    zh: {
      name: 'B站首页防摸鱼（仅留搜索栏）',
      description: '隐藏首页推荐瀑布流与轮播大图，保留顶部搜索栏与动态入口，查学习资料不被带偏',
      tag: 'B站专享 · 秒生效',
    },
    en: {
      name: 'Bilibili Search-Only Focus Feed',
      description: 'Hide homepage recommendation feed and carousels on Bilibili so you search intentionally',
      tag: 'Bilibili · Instant CSS',
    },
    css: `/* PageCraft: Bilibili Search-Only Focus Mode */
.bili-feed4 .bili-feed4-layout,
.feed2 .recommended-container_floor-aside,
.recommended-swipe,
.bili-header__channel {
  display: none !important;
}`,
  },
  {
    id: 'tpl-xiaohongshu-clean',
    engine: 'css',
    category: 'clean',
    scope: 'fixed_site',
    fixedMatches: ['https://*.xiaohongshu.com/*'],
    siteHints: ['xiaohongshu.com'],
    runAt: 'document_start',
    zh: {
      name: '小红书网页版清爽大屏',
      description: '隐藏右下角悬浮引导气泡与下载横幅，优化大屏图文笔记阅读密度',
      tag: '小红书 · 秒生效',
    },
    en: {
      name: 'Xiaohongshu Clean Desktop View',
      description: 'Remove floating app-download prompts and optimize desktop note reading layout',
      tag: 'XHS · Instant CSS',
    },
    css: `/* PageCraft: Xiaohongshu Clean Desktop View */
[class*="floating-btn-sets" i],
[class*="app-guide" i],
[class*="download-app" i],
.reload-Prompt {
  display: none !important;
}`,
  },
  {
    id: 'tpl-code-copy-btn',
    engine: 'js',
    category: 'extract',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '代码块统一加「一键复制」按钮',
      description: '为旧版技术博客、内网 Wiki 的 <pre> 代码块右上角自动补齐复制按钮',
      tag: '开发者效率',
    },
    en: {
      name: 'Add Copy Button to Code Blocks',
      description: 'Attach a clean 1-click Copy button to every <pre> code block on docs and wikis',
      tag: 'Dev Tool',
    },
    code: `(() => {
  if (window.__pcCodeCopyInstalled) return;
  window.__pcCodeCopyInstalled = true;

  function attachCopyButtons() {
    document.querySelectorAll('pre').forEach((pre) => {
      if (pre.dataset.pcCopyReady === '1') return;
      const text = (pre.innerText || '').trim();
      if (text.length < 8) return;
      pre.dataset.pcCopyReady = '1';
      if (getComputedStyle(pre).position === 'static') {
        pre.style.position = 'relative';
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '复制';
      btn.style.cssText =
        'position:absolute;top:8px;right:8px;padding:2px 8px;font-size:11px;border-radius:5px;' +
        'border:1px solid rgba(128,128,128,0.35);background:rgba(30,30,30,0.82);color:#f5f5f5;cursor:pointer;z-index:5;';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pre.innerText);
          btn.textContent = '已复制';
          setTimeout(() => { btn.textContent = '复制'; }, 1400);
        } catch {}
      });
      pre.appendChild(btn);
    });
  }

  attachCopyButtons();
  const obs = new MutationObserver(() => attachCopyButtons());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();`,
  },
  {
    id: 'tpl-direct-external-links',
    engine: 'js',
    category: 'unlock',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '外链直达免二次确认跳转',
      description: '自动识别并改写包含 target= / url= 参数的站外链接中转页，点击直接打开真实目标网站',
      tag: '省时提速',
    },
    en: {
      name: 'Bypass External Link Interstitials',
      description: 'Rewrite redirect wrapper links (?target=... / ?url=...) directly to their destination URL',
      tag: 'Zero Clicks Wasted',
    },
    code: `(() => {
  if (window.__pcDirectLinks) return;
  window.__pcDirectLinks = true;

  const PARAM_KEYS = ['target', 'url', 'pfurl', 'jump', 'dest', 'redirect', 'to'];

  function unwrapHref(rawHref) {
    try {
      const u = new URL(rawHref, location.href);
      if (u.hostname === location.hostname || u.pathname.includes('link') || u.pathname.includes('redirect')) {
        for (const k of PARAM_KEYS) {
          const val = u.searchParams.get(k);
          if (val && /^https?:\\/\\//i.test(val)) return val;
        }
      }
    } catch {}
    return null;
  }

  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const real = unwrapHref(a.getAttribute('href') || a.href);
    if (real) a.href = real;
  }, true);
})();`,
  },
  {
    id: 'tpl-alt-image-zoom',
    engine: 'js',
    category: 'clean',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '按住 Alt 悬停放大预览缩略图',
      description: '浏览商品列表或帖子配图时，按住 Alt 键指向图片即可居中弹出高清大图预览',
      tag: '看图神器',
    },
    en: {
      name: 'Alt + Hover Thumbnail Zoom',
      description: 'Hold Alt while hovering any thumbnail image to preview it full-size in a centered overlay',
      tag: 'Media Utility',
    },
    code: `(() => {
  if (window.__pcAltZoom) return;
  window.__pcAltZoom = true;

  let overlay = null;
  function hide() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  document.addEventListener('mouseover', (e) => {
    if (!e.altKey) return;
    const img = e.target && e.target.tagName === 'IMG' ? e.target : null;
    if (!img || !img.src) return;
    hide();
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.72);display:flex;' +
      'align-items:center;justify-content:center;pointer-events:none;padding:24px;';
    const big = document.createElement('img');
    big.src = img.currentSrc || img.src;
    big.style.cssText = 'max-width:92vw;max-height:90vh;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.45);';
    overlay.appendChild(big);
    document.body.appendChild(overlay);
  });

  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') hide(); });
  document.addEventListener('mouseout', hide);
})();`,
  },
];

/**
 * Instantiate a `TemplateRecipe` into a concrete `UserScript` ready to save & run.
 * Returns `null` when `scope === 'current_site'` and the active tab URL is not an http(s) site.
 */
export function instantiateTemplate(
  recipe: TemplateRecipe,
  activeTabUrl: string | undefined,
  lang: 'zh' | 'en',
): UserScript | null {
  let matches: string[] = [];
  if (recipe.scope === 'fixed_site' && recipe.fixedMatches?.length) {
    matches = [...recipe.fixedMatches];
  } else if (activeTabUrl) {
    const hostPat = hostPatternFromUrl(activeTabUrl);
    if (hostPat) matches = [hostPat];
  }

  if (matches.length === 0) return null;

  const copy = lang === 'zh' ? recipe.zh : recipe.en;
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: copy.name,
    description: copy.description,
    engine: recipe.engine,
    matches,
    code: recipe.engine === 'js' ? recipe.code ?? '' : '',
    css: recipe.engine === 'css' ? recipe.css ?? '' : undefined,
    enabled: true,
    source: 'template',
    templateId: recipe.id,
    runAt: recipe.runAt ?? (recipe.engine === 'css' ? 'document_start' : 'document_idle'),
    allowAllUrls: false,
    createdAt: now,
    updatedAt: now,
  };
}
