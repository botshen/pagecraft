/*
 * PageCraft store-screenshot harness — mock `window.chrome` for the REAL built side panel.
 *
 * Injected as a classic <script> BEFORE the panel's module bundle (see capture.mjs, route
 * /panel.html). It fakes the subset of chrome.* APIs the side panel uses
 * (runtime.id / sendMessage / onMessage, storage.local get/set/onChanged) and then drives
 * the real React UI through a deterministic scenario selected by `?mock=<scenario>`.
 *
 * When the scenario has finished it sets `window.__pcReady = true` and posts
 * `{ pcReady: true, id }` to the parent frame.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const SCENARIO = params.get('mock') || 'hero';
  const LANG = params.get('lang') === 'en' ? 'en' : 'zh';
  const FRAME_ID = params.get('fid') || SCENARIO;
  const zh = LANG === 'zh';
  const L = (z, e) => (zh ? z : e);

  // ─── Fixture data ─────────────────────────────────────────────────────────

  const DAY = 86400000;
  const NOW = Date.now();

  const SITES = {
    qa: zh
      ? { url: 'https://www.zhihu.com/question/58462217', host: 'www.zhihu.com', title: '如何高效阅读长篇技术文档？ - 知乎' }
      : { url: 'https://community.devhub.io/questions/58462217', host: 'community.devhub.io', title: 'How do you read long technical docs efficiently? - DevHub' },
    admin: zh
      ? { url: 'https://admin.example-erp.com/orders?status=all', host: 'admin.example-erp.com', title: '订单管理 · 运营后台' }
      : { url: 'https://admin.example-erp.com/orders?status=all', host: 'admin.example-erp.com', title: 'Orders · Ops Console' },
    video: zh
      ? { url: 'https://www.bilibili.com/video/BV1xK4y1C7mP', host: 'www.bilibili.com', title: '30 分钟上手 CSS Grid 布局（附实战）' }
      : { url: 'https://www.streamly.tv/watch/BV1xK4y1C7mP', host: 'www.streamly.tv', title: 'CSS Grid in 30 Minutes (with real projects)' },
    none: { url: 'https://example.com/', host: 'example.com', title: 'Example' },
  };

  const SCENARIO_SITE = {
    hero: 'qa',
    table: 'admin',
    recipes: 'qa',
    applied: 'video',
    mods: 'video',
    'settings-cloud': 'qa',
    'settings-byok': 'qa',
  };
  const site = SITES[SCENARIO_SITE[SCENARIO] || 'qa'];

  function mod(partial) {
    return Object.assign(
      {
        description: '',
        code: '',
        enabled: true,
        source: 'ai',
        allowAllUrls: false,
        createdAt: NOW - 3 * DAY,
        updatedAt: NOW - 3 * DAY,
      },
      partial,
      { runAt: partial.engine === 'css' ? 'document_start' : 'document_idle' },
    );
  }

  const qaPattern = zh ? 'https://www.zhihu.com/*' : 'https://community.devhub.io/*';
  const videoPattern = zh ? 'https://www.bilibili.com/*' : 'https://www.streamly.tv/*';

  const SEED_MODS = [
    mod({
      id: 'm-zhihu-clean',
      name: L('知乎纯净宽屏去弹窗', 'Zhihu Clean Centered Reader'),
      description: L('隐藏登录弹窗与右侧推荐栏，正文居中加宽', 'Hide login modal & sidebar, center the answers'),
      engine: 'css',
      matches: ['https://www.zhihu.com/*', 'https://zhuanlan.zhihu.com/*'],
      css: '.Question-sideColumn{display:none!important}',
      source: 'template',
      templateId: 'tpl-zhihu-clean',
      updatedAt: NOW - 5 * DAY,
    }),
    mod({
      id: 'm-orders-csv',
      name: L('订单表 · 导出 CSV 按钮', 'Orders table · Export CSV button'),
      description: L('在订单表右上角加「导出 CSV」，含 UTF-8 BOM', 'Adds an Export CSV button above the orders table'),
      engine: 'js',
      matches: ['https://admin.example-erp.com/orders*'],
      code: '/* export csv */',
      updatedAt: NOW - 2 * DAY,
    }),
    mod({
      id: 'm-docs-unlock',
      name: L('解除网页复制与右键限制', 'Unlock Copy, Select & Right-Click'),
      description: L('恢复文字选择、复制与右键菜单', 'Restore text selection, copy and context menu'),
      engine: 'js',
      matches: ['https://wenku.example.com/*'],
      code: '/* unlock */',
      source: 'template',
      templateId: 'tpl-unlock-copy',
      updatedAt: NOW - 6 * DAY,
    }),
    mod({
      id: 'm-reader-paused',
      name: L('沉浸宽屏护眼阅读', 'Warm Widescreen Reader'),
      description: L('暖白纸感底色 + 正文加宽', 'Warm paper background + wider article'),
      engine: 'css',
      matches: ['https://blog.example.dev/*'],
      css: 'main{max-width:920px}',
      source: 'template',
      templateId: 'tpl-widescreen-reader',
      enabled: false,
      updatedAt: NOW - 9 * DAY,
    }),
  ];

  if (!zh) {
    // EN screenshots run on a non-Zhihu host; make the "active" recipe the widescreen reader.
    SEED_MODS[0] = mod({
      id: 'm-qa-reader',
      name: 'Warm Widescreen Reader',
      description: 'Warm paper background + wider answers',
      engine: 'css',
      matches: [qaPattern],
      css: 'main{max-width:920px}',
      source: 'template',
      templateId: 'tpl-widescreen-reader',
      updatedAt: NOW - 5 * DAY,
    });
    SEED_MODS[3] = mod({
      id: 'm-video-focus',
      name: 'Hide autoplay & comments on video sites',
      description: 'Focus mode for tutorials',
      engine: 'css',
      matches: ['https://www.youtube-like.example/*'],
      css: '#comments{display:none}',
      enabled: false,
      updatedAt: NOW - 9 * DAY,
    });
  }

  // Scenario "mods" shows the video-page rule that was just applied in scene 4.
  if (SCENARIO === 'mods') {
    SEED_MODS.unshift(
      mod({
        id: 'm-video-wide',
        name: L('视频页宽屏：隐藏右侧推荐列表', 'Wide player: hide recommendations'),
        description: L('隐藏右侧推荐与广告位，播放器铺满内容区', 'Hide the right rail & ads, stretch the player'),
        engine: 'css',
        matches: [videoPattern.replace('/*', '/video/*')],
        css: '.right-rail{display:none!important}',
        createdAt: NOW - 60000,
        updatedAt: NOW - 60000,
      }),
    );
  }

  const quotaUsed = ['hero', 'table', 'applied'].includes(SCENARIO) ? 1 : 2;
  const SETTINGS = {
    aiMode: SCENARIO === 'settings-byok' ? 'byok' : 'cloud',
    ai: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: SCENARIO === 'settings-byok' ? 'sk-7f3c9a1e5b2d48f0a6c1e9d7' : '',
      model: 'deepseek-chat',
      availableModels: ['deepseek-chat', 'deepseek-reasoner'],
    },
    cloud: {
      installId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      endpoint: '',
      quota: { used: quotaUsed, limit: 10, remaining: 10 - quotaUsed },
    },
    onboardingDone: true,
    tutorialDone: true,
  };

  const store = {
    pc_settings: SETTINGS,
    pc_mods: SEED_MODS,
    pc_lang: LANG,
  };

  // ─── Picked elements + generated drafts ──────────────────────────────────

  const PICKED = {
    hero: {
      selector: 'div.Question-sideColumn',
      matchCount: 1,
      tag: 'div',
      textPreview: L('相关问题 · 为你推荐 · 热门圆桌', 'Related questions · Recommended for you'),
      attributes: { class: 'Question-sideColumn' },
      rect: { width: 296, height: 820 },
      computedStyles: { display: 'block', width: '296px' },
      domSnippet: '<div class="Question-sideColumn">…</div>',
      pageUrl: site.url,
      pageTitle: site.title,
    },
    table: {
      selector: 'table.order-table',
      matchCount: 1,
      similarSelector: 'table.order-table tbody tr',
      similarCount: 20,
      tag: 'table',
      textPreview: L('订单号 客户 金额 状态 下单时间…', 'Order # Customer Amount Status Date…'),
      attributes: { class: 'order-table' },
      rect: { width: 760, height: 420 },
      computedStyles: { display: 'table' },
      domSnippet: '<table class="order-table">…</table>',
      pageUrl: site.url,
      pageTitle: site.title,
    },
    applied: {
      selector: 'aside.right-rail',
      matchCount: 1,
      tag: 'aside',
      textPreview: L('接下来播放 · 相关推荐 · 广告', 'Up next · Recommended · Sponsored'),
      attributes: { class: 'right-rail' },
      rect: { width: 320, height: 900 },
      computedStyles: { display: 'block' },
      domSnippet: '<aside class="right-rail">…</aside>',
      pageUrl: site.url,
      pageTitle: site.title,
    },
  };

  const INTENTS = {
    hero: L('把右侧推荐栏彻底隐藏，回答正文加宽到 960px', 'Hide this sidebar completely and widen the answers to 960px'),
    table: L('给这个表格右上角加个「导出 CSV」按钮', 'Add an "Export CSV" button above this table'),
    applied: L('隐藏右侧推荐列表，让播放器铺满', 'Hide the recommendations and stretch the player'),
  };

  const TABLE_JS = `(() => {
  const table = document.querySelector('table.order-table');
  if (!table || table.dataset.pcCsv) return;
  table.dataset.pcCsv = '1';

  const btn = document.createElement('button');
  btn.textContent = '${L('导出 CSV', 'Export CSV')}';
  btn.className = 'pc-export-csv';
  btn.onclick = () => {
    const rows = [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.cells].map((c) => '"' + c.innerText.trim().replace(/"/g, '""') + '"').join(','),
    );
    const blob = new Blob(['\\ufeff' + rows.join('\\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'orders-' + new Date().toISOString().slice(0, 10) + '.csv',
    });
    a.click();
  };
  table.parentElement.querySelector('.toolbar')?.append(btn);
})();`;

  const DRAFTS = {
    hero: {
      name: L('隐藏知乎右侧推荐栏并加宽正文', 'Hide sidebar & widen the answers'),
      description: L('隐藏右侧推荐栏，回答区加宽到 960px', 'Hide the right sidebar, widen answers to 960px'),
      engine: 'css',
      matches: [qaPattern],
      code: '',
      css: `/* ${L('隐藏右侧推荐栏', 'Hide right sidebar')} */
.Question-sideColumn { display: none !important; }
/* ${L('回答正文加宽并居中', 'Widen & center answers')} */
.Question-mainColumn {
  width: min(960px, 100%) !important;
  margin: 0 auto !important;
}`,
      targetSelectors: ['.Question-sideColumn', '.Question-mainColumn'],
      explanation: L(
        '隐藏右侧「相关问题 / 为你推荐」侧栏，并把回答正文加宽到 960px 居中显示。纯 CSS，无需任何浏览器开关，随时一键还原。',
        'Hides the "Related / Recommended" sidebar and widens the answer column to a centered 960px. Pure CSS — no browser toggles, undo anytime.',
      ),
    },
    table: {
      name: L('给表格加「导出 CSV」按钮', 'Add an "Export CSV" button'),
      description: L('在订单表右上角插入导出按钮', 'Inserts an export button above the orders table'),
      engine: 'js',
      matches: ['https://admin.example-erp.com/orders*'],
      code: TABLE_JS,
      targetSelectors: ['table.order-table', '.toolbar'],
      explanation: L(
        '在订单表格右上角插入「导出 CSV」按钮，点击即把当前筛选结果（含表头）导出为 UTF-8 CSV，Excel 打开中文不乱码。',
        'Adds an "Export CSV" button above the orders table. One click exports the current rows (with headers) as UTF-8 CSV that opens cleanly in Excel.',
      ),
    },
    applied: {
      name: L('视频页宽屏：隐藏右侧推荐列表', 'Wide player: hide recommendations'),
      description: L('隐藏右侧推荐与广告位，播放器铺满内容区', 'Hide the right rail & ads, stretch the player'),
      engine: 'css',
      matches: [videoPattern.replace('/*', '/video/*')],
      code: '',
      css: `.right-rail, .ad-slot { display: none !important; }
.player-wrap { width: 100% !important; max-width: none !important; }`,
      targetSelectors: ['.right-rail', '.ad-slot', '.player-wrap'],
      explanation: L(
        '隐藏右侧「接下来播放 / 相关推荐」和广告位，播放器与简介区铺满整个内容宽度。',
        'Hides the "Up next / Recommended" rail and sponsored slots so the player and description fill the full width.',
      ),
    },
  };

  const CHECKS = {
    hero: { ok: true, totalHits: 2, details: [{ selector: '.Question-sideColumn', count: 1 }, { selector: '.Question-mainColumn', count: 1 }] },
    table: { ok: true, totalHits: 2, details: [{ selector: 'table.order-table', count: 1 }, { selector: '.toolbar', count: 1 }] },
    applied: { ok: true, totalHits: 3, details: [{ selector: '.right-rail', count: 1 }, { selector: '.ad-slot', count: 1 }, { selector: '.player-wrap', count: 1 }] },
  };

  // ─── chrome.* mock ───────────────────────────────────────────────────────

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const msgListeners = new Set();
  const storageListeners = new Set();

  function storageGet(keys) {
    const out = {};
    if (keys == null) return clone(store);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    for (const k of list) {
      if (k in store) out[k] = clone(store[k]);
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
    }
    return out;
  }

  function storageSet(items) {
    const changes = {};
    for (const [k, v] of Object.entries(items || {})) {
      changes[k] = { oldValue: clone(store[k]), newValue: clone(v) };
      store[k] = clone(v);
    }
    for (const l of storageListeners) {
      try { l(changes, 'local'); } catch (e) { /* ignore */ }
    }
  }

  function withCallback(promise, cb) {
    if (typeof cb === 'function') promise.then((v) => cb(v));
    return promise;
  }

  const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

  function handleMessage(msg) {
    const type = msg && msg.type;
    switch (type) {
      case 'GET_ACTIVE_TAB':
        return Object.assign({ tabId: 101, supported: true }, site);
      case 'USERSCRIPTS_STATUS':
        return { available: true };
      case 'START_ELEMENT_PICKER':
      case 'CANCEL_ELEMENT_PICKER':
      case 'USERSCRIPTS_SYNC':
      case 'SUBMIT_GENERATION_FEEDBACK':
      case 'OPEN_EXTENSION_DETAILS':
        return { ok: true };
      case 'USERSCRIPTS_TEST':
        return { ok: true, reloaded: false };
      case 'FETCH_CLOUD_QUOTA':
        return { ok: true, quota: clone(store.pc_settings.cloud.quota) };
      case 'TEST_CONNECTION':
        return { ok: true, elapsedMs: 412 };
      case 'LIST_MODELS':
        return { ok: true, models: ['deepseek-chat', 'deepseek-reasoner'] };
      case 'GENERATE_USERSCRIPT': {
        const key = DRAFTS[SCENARIO] ? SCENARIO : 'hero';
        const q = store.pc_settings.cloud.quota;
        const used = Math.min(q.limit, q.used + 1);
        const quota = { used, limit: q.limit, remaining: q.limit - used };
        store.pc_settings.cloud.quota = quota;
        return delay(120, {
          ok: true,
          script: clone(DRAFTS[key]),
          provider: 'cloud',
          quota,
          selectorCheck: clone(CHECKS[key]),
        });
      }
      default:
        return { ok: true };
    }
  }

  const evt = (set) => ({
    addListener: (fn) => set.add(fn),
    removeListener: (fn) => set.delete(fn),
    hasListener: (fn) => set.has(fn),
  });

  window.chrome = {
    runtime: {
      id: 'pagecraftstoreharnessmock',
      lastError: undefined,
      getURL: (p) => new URL(p, location.origin).href,
      getManifest: () => ({ name: 'PageCraft', version: '0.1.0', manifest_version: 3 }),
      sendMessage(msg, cb) {
        return withCallback(Promise.resolve(handleMessage(msg)), cb);
      },
      onMessage: evt(msgListeners),
    },
    storage: {
      local: {
        get: (keys, cb) => withCallback(Promise.resolve(storageGet(keys)), cb),
        set: (items, cb) => withCallback(Promise.resolve(storageSet(items)), cb),
        remove: (keys, cb) => {
          for (const k of [].concat(keys)) delete store[k];
          return withCallback(Promise.resolve(), cb);
        },
        onChanged: evt(storageListeners),
      },
      onChanged: evt(storageListeners),
    },
    tabs: {
      query: (q, cb) => withCallback(Promise.resolve([Object.assign({ id: 101, active: true }, site)]), cb),
      create: (o, cb) => withCallback(Promise.resolve({ id: 102 }), cb),
    },
    sidePanel: {},
  };

  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') },
    });
  } catch (e) { /* ignore */ }

  // Deterministic rendering: no animations / transitions, no scrollbars.
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      animation-duration: 1ms !important; animation-delay: 0s !important;
      transition-duration: 1ms !important; transition-delay: 0s !important;
      caret-color: transparent !important;
    }
    html { scrollbar-width: none; }
    ::-webkit-scrollbar { display: none; }
  `;
  document.documentElement.appendChild(style);

  // ─── Scenario driver ─────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 8000) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + fn.toString());
      await sleep(40);
    }
  }

  function findButton(text) {
    return [...document.querySelectorAll('button')].find(
      (b) => b.textContent && b.textContent.replace(/\s+/g, ' ').trim().includes(text),
    );
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function emit(msg) {
    for (const l of msgListeners) l(msg, {}, () => {});
  }

  async function pickAndGenerate(key) {
    await waitFor(() => msgListeners.size > 0);
    emit({ type: 'PAGECRAFT_ELEMENT_PICKED', payload: PICKED[key] });
    const ta = await waitFor(() => document.querySelector('main textarea'));
    await sleep(80);
    setNativeValue(ta, INTENTS[key]);
    await sleep(80);
    const gen = await waitFor(() => {
      const b = findButton(L('生成改造', 'Generate Mod'));
      return b && !b.disabled ? b : null;
    });
    gen.click();
    await waitFor(() => document.querySelector('main h2') && findButton(L('应用并保存', 'Apply & Save')));
  }

  async function run() {
    await waitFor(() => document.querySelector('header') && document.querySelector('main'));
    await sleep(150);

    switch (SCENARIO) {
      case 'hero':
        await pickAndGenerate('hero');
        break;
      case 'table': {
        await pickAndGenerate('table');
        if (zh) {
          // EN copy wraps to more lines; the feedback row would overflow the 642px panel there.
          findButton('应用并保存').click();
          await waitFor(() => findButton('生效了'));
          await sleep(2900); // let the "applied" toast fade so it doesn't cover the card
        }
        break;
      }
      case 'applied': {
        await pickAndGenerate('applied');
        findButton(L('应用并保存', 'Apply & Save')).click();
        await waitFor(() => findButton(L('生效了', 'It worked')));
        break; // keep the "已启用并保存" toast visible on purpose
      }
      case 'recipes':
        await waitFor(() => findButton(L('已启用', 'Active')));
        break;
      case 'mods':
        await waitFor(() => findButton('.user.js'));
        break;
      case 'settings-cloud':
        await waitFor(() => document.querySelector('main section'));
        break;
      case 'settings-byok': {
        await waitFor(() => document.querySelector('input[type="password"]'));
        const btn = findButton(L('测试接口连通性', 'Test Connection'));
        if (btn) btn.click();
        await waitFor(() => findButton('412ms'));
        await sleep(2900); // wait out the toast
        break;
      }
      default:
        break;
    }

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await sleep(250);
    window.__pcReady = true;
    try { parent.postMessage({ pcReady: true, id: FRAME_ID }, '*'); } catch (e) { /* ignore */ }
  }

  function start() {
    run().catch((err) => {
      console.error('[pc-harness]', err);
      window.__pcReady = true;
      window.__pcError = String(err && err.message ? err.message : err);
      try { parent.postMessage({ pcReady: true, id: FRAME_ID, error: window.__pcError }, '*'); } catch (e) { /* ignore */ }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
