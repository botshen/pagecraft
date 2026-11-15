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

  const PARAM_KEYS = ['target', 'url', 'pfurl', 'jump', 'dest', 'redirect', 'to', 'u', 'q', 'gocdn'];
  const REDIRECT_HOST_RE = /^(link\\.|links\\.|c\\.pc\\.qq\\.com$|weixin110\\.qq\\.com$|out\\.reddit\\.com$|l\\.facebook\\.com$)/i;

  function unwrapHref(rawHref) {
    try {
      const u = new URL(rawHref, location.href);
      if (
        u.hostname === location.hostname ||
        REDIRECT_HOST_RE.test(u.hostname) ||
        /link|redirect|sinaurl|jump|\\bgo\\b/i.test(u.pathname)
      ) {
        for (const k of PARAM_KEYS) {
          const val = u.searchParams.get(k);
          if (val && /^https?:\\/\\//i.test(val)) return val;
          if (val && /^https?%3A%2F%2F/i.test(val)) {
            try {
              const decoded = decodeURIComponent(val);
              if (/^https?:\\/\\//i.test(decoded)) return decoded;
            } catch {}
          }
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
  {
    id: 'tpl-floating-ad-shield',
    engine: 'css',
    category: 'clean',
    scope: 'current_site',
    runAt: 'document_start',
    zh: {
      name: '通用悬浮广告与底栏横幅净化',
      description: '自动隐藏常见的广告位（adsbygoogle / ad-slot）、底部 App 下载横幅与右下角悬浮推广挂件',
      tag: '零权限秒开',
    },
    en: {
      name: 'Floating Ad & Sticky Banner Cleaner',
      description: 'Hides common ad slots (adsbygoogle, ad-banner), app-download bars, and floating promo widgets',
      tag: 'Zero-Permission CSS',
    },
    css: `ins.adsbygoogle,
iframe[id^="google_ads"],
iframe[src*="doubleclick.net"],
[id^="div-gpt-ad"],
[class*="ad-banner" i]:not(body):not(html):not(main):not(article),
[class*="ad-slot" i]:not(body):not(html):not(main):not(article),
[class*="ad-wrapper" i]:not(body):not(html):not(main):not(article),
[class*="float-ad" i]:not(body):not(html),
[class*="app-download-bar" i]:not(body):not(html),
[class*="open-in-app" i]:not(body):not(html),
[class*="cookie-banner" i]:not([role="dialog"]) {
  display: none !important;
}`,
  },
  {
    id: 'tpl-crisp-typography',
    engine: 'css',
    category: 'focus',
    scope: 'current_site',
    runAt: 'document_start',
    zh: {
      name: '正文大字号与舒适行距排版',
      description: '将偏小拥挤的网页文章、技术文档正文字号升级为 17px 与 1.8 倍行高，长时间阅读不费眼',
      tag: '舒适排版',
    },
    en: {
      name: 'Comfortable 17px Reading Typography',
      description: 'Upgrades cramped article and documentation paragraphs to 17px font size and 1.8 line-height',
      tag: 'Easy Reading',
    },
    css: `article p,
article li,
main p,
main li,
[role="main"] p,
.markdown-body p,
.markdown-body li,
.post-content p,
.article-content p,
.entry-content p {
  font-size: 17px !important;
  line-height: 1.82 !important;
  letter-spacing: 0.01em !important;
}
article p,
.markdown-body p,
.post-content p,
.article-content p,
.entry-content p {
  margin-bottom: 1.05em !important;
}`,
  },
  {
    id: 'tpl-office-media-dim',
    engine: 'css',
    category: 'focus',
    scope: 'current_site',
    runAt: 'document_start',
    zh: {
      name: '办公纯文字专注模式（悬停显图）',
      description: '将页面配图、视频与封面默认弱化为 8% 低透明度，鼠标悬停时才恢复高清显示，兼顾专注与隐私',
      tag: '办公利器',
    },
    en: {
      name: 'Low-Distraction Media Dimmer (Hover to Reveal)',
      description: 'Dims inline images and videos to 8% opacity until hovered—ideal for focused reading or open offices',
      tag: 'Focus & Privacy',
    },
    css: `article img:not(#__pagecraft_picker_host__),
main img:not(#__pagecraft_picker_host__),
[role="main"] img:not(#__pagecraft_picker_host__),
figure img:not(#__pagecraft_picker_host__),
picture img:not(#__pagecraft_picker_host__),
video:not(#__pagecraft_picker_host__) {
  opacity: 0.08 !important;
  filter: grayscale(70%) !important;
  transition: opacity 0.18s ease, filter 0.18s ease !important;
}
article img:hover,
main img:hover,
[role="main"] img:hover,
figure img:hover,
picture img:hover,
video:hover {
  opacity: 1 !important;
  filter: none !important;
}`,
  },
  {
    id: 'tpl-video-speed-controller',
    engine: 'js',
    category: 'unlock',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: 'HTML5 视频倍速与画中画快捷键',
      description: '任意网站看视频按 ] 加速、[ 减速（最高 16x）、\\ 恢复 1.0x、Shift+P 切换画中画，带倍速浮层提示',
      tag: '看课追剧',
    },
    en: {
      name: 'HTML5 Video Speed & PiP Hotkeys',
      description: 'Press ] faster, [ slower (up to 16x), \\ reset 1.0x, or Shift+P for Picture-in-Picture on any video',
      tag: 'Media Control',
    },
    code: `(() => {
  if (window.__pcVideoSpeedInstalled) return;
  window.__pcVideoSpeedInstalled = true;

  let badge = null;
  let hideTimer = null;

  function pickTargetVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    const playing = videos.find((v) => !v.paused && !v.ended && v.readyState > 1);
    if (playing) return playing;
    return videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  }

  function showOsd(text) {
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText =
        'position:fixed;top:20px;right:20px;z-index:2147483646;padding:6px 12px;border-radius:8px;' +
        'background:rgba(20,19,18,0.86);color:#FAF8F5;font:600 13px/1.3 system-ui,sans-serif;' +
        'pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.28);transition:opacity 0.18s ease;';
      document.body.appendChild(badge);
    }
    badge.textContent = text;
    badge.style.opacity = '1';
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (badge) badge.style.opacity = '0';
    }, 1200);
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
      return;
    }
    const video = pickTargetVideo();
    if (!video) return;

    if (e.key === ']' || e.key === '[') {
      e.preventDefault();
      const delta = e.key === ']' ? 0.25 : -0.25;
      const next = Math.min(16, Math.max(0.25, Math.round((video.playbackRate + delta) * 100) / 100));
      video.playbackRate = next;
      showOsd('▶ ' + next.toFixed(2).replace(/\\.00$/, '.0') + 'x');
    } else if (e.key === '\\\\') {
      e.preventDefault();
      video.playbackRate = 1.0;
      showOsd('▶ 1.0x');
    } else if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
        showOsd('PiP Off');
      } else if (video.requestPictureInPicture) {
        video.requestPictureInPicture().then(() => showOsd('PiP On')).catch(() => {});
      }
    }
  }, true);
})();`,
  },
  {
    id: 'tpl-auto-expand-article',
    engine: 'js',
    category: 'unlock',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '自动展开「阅读全文 / 展开更多」折叠长文',
      description: '自动移除资讯站与技术博客常见的正文高度截断遮罩，并自动点击非跳转型的「展开全文」按钮',
      tag: '免点展开',
    },
    en: {
      name: 'Auto-Expand "Read More" Truncated Articles',
      description: 'Removes article height-truncation masks and clicks safe "Read more / Expand full text" buttons',
      tag: 'Zero Friction',
    },
    code: `(() => {
  if (window.__pcAutoExpandInstalled) return;
  window.__pcAutoExpandInstalled = true;

  const style = document.createElement('style');
  style.textContent =
    '.hide-article-box, .read-more-mask, [class*="readmore-mask" i], [class*="article-mask" i] { display: none !important; }';
  (document.head || document.documentElement).appendChild(style);

  const EXPAND_RE = /^(阅读全文|展开全文|展开阅读全文|继续阅读|展开剩余\\s*\\d*%?|查看全文|read\\s+more|continue\\s+reading|show\\s+full\\s+article)$/i;

  function expandOnce() {
    document.querySelectorAll('#article_content, .article-content, .post-content, [class*="article-body" i]').forEach((box) => {
      const cs = window.getComputedStyle(box);
      if (cs.overflow === 'hidden' && parseInt(cs.maxHeight || cs.height || '0', 10) > 120) {
        box.style.setProperty('max-height', 'none', 'important');
        box.style.setProperty('height', 'auto', 'important');
        box.style.setProperty('overflow', 'visible', 'important');
      }
    });

    document.querySelectorAll('button, [role="button"], span, div').forEach((btn) => {
      if (btn.dataset.pcExpanded === '1') return;
      if (btn.children.length > 2) return;
      const txt = (btn.textContent || '').trim();
      if (!txt || txt.length > 24 || !EXPAND_RE.test(txt)) return;
      btn.dataset.pcExpanded = '1';
      btn.click();
    });
  }

  expandOnce();
  setTimeout(expandOnce, 900);
})();`,
  },
  {
    id: 'tpl-markdown-clipper',
    engine: 'js',
    category: 'extract',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '正文 / 选中内容一键复制为 Markdown',
      description: '在右下角添加轻量「复制 MD」胶囊：选中文字时转换选区，未选中时自动提取文章标题、代码块、列表与链接',
      tag: '笔记剪藏',
    },
    en: {
      name: 'One-Click Copy Article or Selection as Markdown',
      description: 'Adds a compact bottom-right "Copy MD" button to copy your selection or main article as clean Markdown',
      tag: 'Note Clipper',
    },
    code: `(() => {
  if (window.__pcMdClipperInstalled) return;
  window.__pcMdClipperInstalled = true;

  function nodeToMd(node) {
    if (!node) return '';
    if (node.nodeType === 3) return (node.nodeValue || '').replace(/\\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'NAV' || tag === 'FOOTER') return '';
    if (tag === 'BR') return '\\n';
    if (tag === 'HR') return '\\n\\n---\\n\\n';
    if (tag === 'PRE') {
      const code = (node.textContent || '').replace(/\\n+$/, '');
      return '\\n\\n\`\`\`\\n' + code + '\\n\`\`\`\\n\\n';
    }
    if (tag === 'CODE') return '\`' + (node.textContent || '').trim() + '\`';
    if (tag === 'IMG') {
      const src = node.getAttribute('src') || '';
      const alt = (node.getAttribute('alt') || 'image').trim();
      return src ? '![' + alt + '](' + src + ')' : '';
    }
    let inner = '';
    for (const child of node.childNodes) inner += nodeToMd(child);
    if (/^H[1-6]$/.test(tag)) {
      const hashes = '#'.repeat(Number(tag.slice(1)));
      return '\\n\\n' + hashes + ' ' + inner.trim() + '\\n\\n';
    }
    if (tag === 'A') {
      const href = node.href || node.getAttribute('href') || '';
      return href && inner.trim() ? '[' + inner.trim() + '](' + href + ')' : inner;
    }
    if (tag === 'STRONG' || tag === 'B') return inner.trim() ? '**' + inner.trim() + '**' : '';
    if (tag === 'EM' || tag === 'I') return inner.trim() ? '*' + inner.trim() + '*' : '';
    if (tag === 'BLOCKQUOTE') return '\\n\\n> ' + inner.trim().replace(/\\n/g, '\\n> ') + '\\n\\n';
    if (tag === 'LI') return '\\n- ' + inner.trim();
    if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
      return inner.trim() ? '\\n\\n' + inner.trim() + '\\n\\n' : '';
    }
    return inner;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '复制 MD';
  btn.style.cssText =
    'position:fixed;right:16px;bottom:18px;z-index:2147483645;padding:6px 11px;border-radius:999px;' +
    'border:1px solid rgba(0,0,0,0.14);background:rgba(250,248,245,0.95);color:#171614;cursor:pointer;' +
    'font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,0.12);';

  btn.addEventListener('click', () => {
    const sel = window.getSelection();
    let md = '';
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const wrap = document.createElement('div');
      wrap.appendChild(sel.getRangeAt(0).cloneContents());
      md = nodeToMd(wrap);
    } else {
      const root = document.querySelector('article, main, [role="main"], .markdown-body, .post-content, #article_content') || document.body;
      md = '# ' + document.title + '\\n\\n> Source: ' + location.href + '\\n\\n' + nodeToMd(root);
    }
    const cleaned = md.replace(/\\n{3,}/g, '\\n\\n').trim();
    navigator.clipboard.writeText(cleaned).then(() => {
      btn.textContent = '✓ 已复制 MD';
      setTimeout(() => { btn.textContent = '复制 MD'; }, 1600);
    });
  });

  document.body.appendChild(btn);
})();`,
  },
  {
    id: 'tpl-password-peek',
    engine: 'js',
    category: 'unlock',
    scope: 'current_site',
    runAt: 'document_idle',
    zh: {
      name: '密码输入框双击查看明文',
      description: '双击任意密码框（password）即可临时显示明文核对字符，点击别处失焦时自动恢复星号遮挡',
      tag: '防输错小工具',
    },
    en: {
      name: 'Double-Click Password Input to Peek',
      description: 'Double-click any password field to temporarily reveal plain text; masks again automatically on blur',
      tag: 'Form Helper',
    },
    code: `(() => {
  if (window.__pcPasswordPeekInstalled) return;
  window.__pcPasswordPeekInstalled = true;

  document.addEventListener('dblclick', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (el.type === 'password') {
      el.type = 'text';
      el.dataset.pcPeekActive = '1';
    } else if (el.dataset.pcPeekActive === '1') {
      el.type = 'password';
      delete el.dataset.pcPeekActive;
    }
  }, true);

  document.addEventListener('blur', (e) => {
    const el = e.target;
    if (el && el.tagName === 'INPUT' && el.dataset && el.dataset.pcPeekActive === '1') {
      el.type = 'password';
      delete el.dataset.pcPeekActive;
    }
  }, true);
})();`,
  },
  {
    id: 'tpl-csdn-clean',
    engine: 'css',
    category: 'clean',
    scope: 'fixed_site',
    fixedMatches: ['https://*.csdn.net/*'],
    siteHints: ['csdn.net'],
    runAt: 'document_start',
    zh: {
      name: 'CSDN 博客免关注展开与去广告净化',
      description: '自动展开「关注博主即可阅读全文」折叠内容，隐藏左右悬浮工具栏、登录弹窗与推广栏，正文居中宽屏',
      tag: 'CSDN 专属',
    },
    en: {
      name: 'CSDN Clean Reader & Auto-Expand',
      description: 'Unlocks collapsed CSDN articles without following, hides side rails and login popups, and centers posts',
      tag: 'For csdn.net',
    },
    css: `#article_content,
.blog-content-box .article_content {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}
.hide-article-box,
.passport-login-container,
.passport-login-tip-container,
.csdn-side-toolbar,
#toolBarBox,
.left-toolbox,
aside.blog_container_aside,
#rightAside,
.recommend-box,
.recommend-right,
.blog-footer-bottom,
[class*="csdn-advert" i] {
  display: none !important;
}
main,
.main_father main {
  width: min(980px, 95vw) !important;
  max-width: 980px !important;
  float: none !important;
  margin-left: auto !important;
  margin-right: auto !important;
}`,
  },
  {
    id: 'tpl-baidu-clean',
    engine: 'css',
    category: 'clean',
    scope: 'fixed_site',
    fixedMatches: ['https://www.baidu.com/*'],
    siteHints: ['baidu.com'],
    runAt: 'document_start',
    zh: {
      name: '百度搜索去右侧热搜榜与清爽居中',
      description: '隐藏百度搜索结果页右侧百度热搜榜与边栏干扰以及首页底部资讯流，只保留干净搜索框与结果列表',
      tag: '百度专属',
    },
    en: {
      name: 'Baidu Search Clean Results (No Trending Rail)',
      description: 'Hides the right-hand trending hot-search sidebar and homepage feed clutter on Baidu Search',
      tag: 'For baidu.com',
    },
    css: `#content_right,
.cr-offset,
#rs_top_new,
#s_wrap,
#s_main,
.s-bottom-layer-content {
  display: none !important;
}
#container.sam_newgrid #content_left,
#content_left {
  width: min(760px, 92vw) !important;
}`,
  },
  {
    id: 'tpl-weibo-clean',
    engine: 'css',
    category: 'focus',
    scope: 'fixed_site',
    fixedMatches: ['https://*.weibo.com/*'],
    siteHints: ['weibo.com'],
    runAt: 'document_start',
    zh: {
      name: '微博网页版去热搜侧栏专注流',
      description: '隐藏微博右侧热搜榜、话题推荐与会员横幅，适度拓宽主时间线，只看自己关注的人',
      tag: '微博专属',
    },
    en: {
      name: 'Weibo Clean Timeline (Hide Hot Search)',
      description: 'Hides Weibo right-side hot-search rankings and promo modules for a calm timeline',
      tag: 'For weibo.com',
    },
    css: `[class*="RightSide" i],
.WB_main_r,
[aria-label="微博热搜"],
[class*="HotSearch" i],
[class*="vip-banner" i] {
  display: none !important;
}`,
  },
  {
    id: 'tpl-youtube-focus',
    engine: 'css',
    category: 'focus',
    scope: 'fixed_site',
    fixedMatches: ['https://www.youtube.com/*'],
    siteHints: ['youtube.com'],
    runAt: 'document_start',
    zh: {
      name: 'YouTube 专注学习模式（隐藏 Shorts 与推荐流）',
      description: '隐藏 YouTube 首页瀑布流推荐、全站 Shorts 短视频入口与播放页右侧相关推荐，只看主动搜索内容',
      tag: 'YouTube 专属',
    },
    en: {
      name: 'YouTube Study Focus (Hide Shorts & Home Feed)',
      description: 'Hides the algorithmic home grid, Shorts shelves, and watch-page related sidebar for focused learning',
      tag: 'For youtube.com',
    },
    css: `ytd-browse[page-subtype="home"] #primary,
ytd-rich-shelf-renderer[is-shorts],
ytd-reel-shelf-renderer,
a[title="Shorts"],
ytd-mini-guide-entry-renderer[aria-label="Shorts"],
#related,
.ytp-ce-element {
  display: none !important;
}`,
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
