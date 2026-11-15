import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installChromeMock } from './helpers.ts';

const { store, reset } = installChromeMock();

const {
  upsertUserScript,
  deleteUserScript,
  readUserScripts,
  replaceAllUserScripts,
  mergeImportedUserScripts,
  emitUserScriptHeader,
  exportAsUserScript,
  parseUserScriptHeader,
} = await import('../../lib/userscripts/store.ts');

const { wrapWithGmShimIfNeeded } = await import('../../lib/userscripts/gm-shim.ts');
const { BUILTIN_TEMPLATES } = await import('../../lib/userscripts/templates.ts');
const { filterSemanticClasses } = await import('../../lib/picker/selector.ts');
const {
  injectElementPickerOverlay,
  extractLivePageContext,
} = await import('../../entrypoints/background/picker-injected.ts');
const {
  buildModPrompt,
  initModsRuntime,
  resetTabCssStateForTests,
} = await import('../../entrypoints/background/userscripts.ts');

import type { UserScript } from '../../lib/userscripts/types.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeSampleMod(id: string, overrides: Partial<UserScript> = {}): UserScript {
  return {
    id,
    name: `Mod ${id}`,
    description: `Desc ${id}`,
    engine: 'css',
    matches: ['https://*.example.com/*'],
    code: '',
    css: `.item-${id} { display: none !important; }`,
    enabled: true,
    source: 'manual',
    runAt: 'document_start',
    allowAllUrls: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function parseSimpleYaml(filePath: string): Record<string, string> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

beforeEach(() => {
  reset();
  resetTabCssStateForTests();
});

test('upsertUserScript and deleteUserScript serialize concurrent Promise.all writes without data loss', async () => {
  const localAny = chrome.storage.local as unknown as {
    get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
  };
  const origGet = localAny.get.bind(chrome.storage.local);
  const origSet = localAny.set.bind(chrome.storage.local);

  // Inject staggered async latency so unlocked read-modify-write would clobber siblings
  localAny.get = async (keys?: string | string[] | null) => {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6) + 1));
    return origGet(keys);
  };

  localAny.set = async (items: Record<string, unknown>) => {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6) + 1));
    return origSet(items);
  };

  try {
    const mods = Array.from({ length: 12 }, (_, i) => makeSampleMod(`concurrent-${i + 1}`));
    await Promise.all(mods.map((m) => upsertUserScript(m)));

    const afterInsert = await readUserScripts();
    assert.equal(afterInsert.length, 12);
    assert.deepEqual(
      afterInsert.map((m) => m.id).sort(),
      mods.map((m) => m.id).sort(),
    );

    // Concurrent mixed updates + deletions
    await Promise.all([
      deleteUserScript('concurrent-2'),
      deleteUserScript('concurrent-7'),
      upsertUserScript({ ...mods[0]!, enabled: false, name: 'Updated 1' }),
      upsertUserScript(makeSampleMod('concurrent-13')),
    ]);

    const afterMixed = await readUserScripts();
    assert.equal(afterMixed.length, 11);
    assert.equal(afterMixed.find((m) => m.id === 'concurrent-2'), undefined);
    assert.equal(afterMixed.find((m) => m.id === 'concurrent-7'), undefined);
    assert.equal(afterMixed.find((m) => m.id === 'concurrent-1')?.enabled, false);
    assert.equal(afterMixed.find((m) => m.id === 'concurrent-1')?.name, 'Updated 1');
    assert.ok(afterMixed.find((m) => m.id === 'concurrent-13'));
  } finally {
    localAny.get = origGet;
    localAny.set = origSet;
  }
});

test('replaceAllUserScripts and mergeImportedUserScripts atomically normalize and drop invalid entries', async () => {
  await upsertUserScript(makeSampleMod('existing-1'));

  const merged = await mergeImportedUserScripts([
    makeSampleMod('existing-1', { name: 'Overwritten Existing 1' }),
    makeSampleMod('imported-2', { matches: ['https://zhihu.com'] }), // bare origin normalized to /*
    // Invalid broad match without allowAllUrls -> must be rejected
    makeSampleMod('bad-broad', { matches: ['<all_urls>'], allowAllUrls: false }),
    // Invalid scheme -> must be rejected
    makeSampleMod('bad-scheme', { matches: ['javascript:alert(1)'] }),
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.name, 'Overwritten Existing 1');
  assert.deepEqual(merged[1]?.matches, ['https://zhihu.com/*']);

  const replaced = await replaceAllUserScripts([
    makeSampleMod('fresh-only-1'),
    makeSampleMod('fresh-only-1', { name: 'Deduplicated Winner' }),
  ]);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0]?.name, 'Deduplicated Winner');
  assert.equal((await readUserScripts()).length, 1);
});

test('emitUserScriptHeader and exportAsUserScript include official PageCraft viral attribution', () => {
  const mod = makeSampleMod('attr-001', {
    name: '知乎纯净阅读',
    description: '隐藏右侧推荐栏',
  });
  const header = emitUserScriptHeader(mod);
  assert.equal(header.includes('pagecraft.local'), false);
  assert.match(header, /\/\/ @namespace\s+https:\/\/pagecraft\.shenxin\.space\//);
  assert.match(header, /\/\/ @homepageURL\s+https:\/\/pagecraft\.shenxin\.space\b/);
  assert.match(header, /\/\/ @supportURL\s+https:\/\/github\.com\/botshen\/pagecraft\/issues\b/);
  assert.equal(/[a-z0-9._%+-]+@gmail\.com/i.test(header), false);

  const exported = exportAsUserScript(mod);
  const parsed = parseUserScriptHeader(exported, 'zh');
  assert.equal(parsed.name, '知乎纯净阅读');
  assert.equal(parsed.extractedCss, mod.css);
});

test('GM_openInTab blocks javascript:, data:, and non-http(s) URLs while allowing http(s)://', async () => {
  const gmScript = wrapWithGmShimIfNeeded({
    id: 'gm-sec-open-tab-1',
    name: 'Tab Security Check',
    description: '',
    matches: ['https://example.com/*'],
    code: `
      window.__resJs = GM_openInTab('javascript:alert(1)');
      window.__resData = GM_openInTab('data:text/html,<script>alert(1)</script>');
      window.__resFile = GM_openInTab('file:///etc/passwd');
      window.__resEmpty = GM_openInTab('');
      window.__resHttps = GM_openInTab('https://pagecraft.shenxin.space/playground');
      window.__resHttp = GM_openInTab('http://localhost:8787/health');
      window.__resAsyncJsPromise = GM.openInTab('JAVASCRIPT:void(0)');
    `,
  });

  const openedUrls: Array<{ url: string; target: string; features: string }> = [];
  const mockWindow: Record<string, unknown> = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      length: 0,
      key: () => null,
    },
    open(url: string, target: string, features: string) {
      openedUrls.push({ url, target, features });
      return { close() {} };
    },
  };
  const mockDoc = {
    readyState: 'complete',
    head: { appendChild: (el: unknown) => el },
    createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
  };

  const runner = new Function('window', 'document', 'navigator', gmScript);
  runner(mockWindow, mockDoc, {});

  assert.equal(mockWindow.__resJs, null);
  assert.equal(mockWindow.__resData, null);
  assert.equal(mockWindow.__resFile, null);
  assert.equal(mockWindow.__resEmpty, null);
  assert.equal(await (mockWindow.__resAsyncJsPromise as Promise<unknown>), null);

  assert.equal(openedUrls.length, 2);
  assert.equal(openedUrls[0]?.url, 'https://pagecraft.shenxin.space/playground');
  assert.equal(openedUrls[0]?.features, 'noopener,noreferrer');
  assert.equal(openedUrls[1]?.url, 'http://localhost:8787/health');
  assert.ok(mockWindow.__resHttps && typeof (mockWindow.__resHttps as { close: unknown }).close === 'function');
});

test('BUILTIN_TEMPLATES CSS selectors have valid syntax and zero accidental space typos', () => {
  const cssRecipes = BUILTIN_TEMPLATES.filter((t) => t.engine === 'css');
  assert.ok(cssRecipes.length >= 5);

  const xiaohongshu = cssRecipes.find((t) => t.id === 'tpl-xiaohongshu-clean');
  assert.ok(xiaohongshu?.css);
  assert.match(xiaohongshu.css, /\[class\*="app-guide" i\]/);
  assert.equal(xiaohongshu.css.includes('app- guide'), false);

  for (const recipe of cssRecipes) {
    const rawCss = (recipe.css ?? '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    assert.ok(rawCss.length > 0, `${recipe.id} should have CSS rules`);

    // Split top-level rule blocks and validate every selector prelude
    const blocks = rawCss.split('}').map((b) => b.trim()).filter(Boolean);
    assert.ok(blocks.length >= 1, `${recipe.id} must have >=1 rule block`);

    for (const block of blocks) {
      const braceIdx = block.indexOf('{');
      assert.ok(braceIdx > 0, `${recipe.id} rule missing '{': ${block}`);
      const selectorList = block.slice(0, braceIdx).trim();
      const body = block.slice(braceIdx + 1).trim();
      assert.ok(selectorList.length > 0 && body.length > 0);

      // Balanced square brackets and parentheses
      const openBrackets = (selectorList.match(/\[/g) ?? []).length;
      const closeBrackets = (selectorList.match(/\]/g) ?? []).length;
      assert.equal(openBrackets, closeBrackets, `unbalanced [] in ${recipe.id}: ${selectorList}`);

      const openParens = (selectorList.match(/\(/g) ?? []).length;
      const closeParens = (selectorList.match(/\)/g) ?? []).length;
      assert.equal(openParens, closeParens, `unbalanced () in ${recipe.id}: ${selectorList}`);

      // Guard against accidental spaces after hyphens inside [class*="..."] substrings
      assert.equal(
        /\[class\*="[^"]*-\s+[^"]*"/i.test(selectorList),
        false,
        `suspicious hyphen-space typo in ${recipe.id}: ${selectorList}`,
      );
    }
  }
});

test('picker-injected syncs CSS Modules hash regex and scrubs sk-/Bearer tokens in extractLivePageContext', () => {
  // 1. Selector parity for CSS Modules (`style_name__hash`)
  assert.deepEqual(
    filterSemanticClasses('style_cardWrap__9aB3f article-card style_header__12ef'),
    ['article-card'],
  );
  assert.match(
    injectElementPickerOverlay.toString(),
    /style_\[a-zA-Z0-9\]\+__\[a-zA-Z0-9\]\{4,\}/,
  );

  // 2. Execute extractLivePageContext against a mock DOM containing tokens & PII
  const fakeNodes = [
    {
      id: 'hero-title',
      tagName: 'H1',
      className: 'page-heading',
      innerText: 'Key sk-proj_AbCdEf1234567890xyz and alice@corp.example.com',
      getAttribute: () => null,
      children: [],
    },
    {
      id: '',
      tagName: 'BUTTON',
      className: 'copy-auth-btn',
      innerText: 'Auth Bearer eyJhbGciOiJIUzI1NiJ9.payload_123456',
      getAttribute: () => null,
      children: [],
    },
    {
      id: '',
      tagName: 'H2',
      className: 'order-no',
      innerText: 'Order 987654321098',
      getAttribute: () => null,
      children: [],
    },
  ];

  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    querySelectorAll: () => fakeNodes,
  };
  try {
    const snapshot = extractLivePageContext();
    assert.equal(snapshot.includes('sk-proj_'), false);
    assert.equal(snapshot.includes('eyJhbGciOiJIUzI1NiJ9'), false);
    assert.equal(snapshot.includes('alice@corp.example.com'), false);
    assert.equal(snapshot.includes('987654321098'), false);
    assert.match(snapshot, /\[KEY\]/);
    assert.match(snapshot, /\[EMAIL\]/);
    assert.match(snapshot, /\[NUM\]/);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test('buildModPrompt enforces cloud-guard prefix and redacts PII in pageTitle & pageContext', () => {
  const prompt = buildModPrompt({
    intent: '把订单表格加上导出按钮',
    targetUrl: 'https://erp.company.com/orders/99887766?jwt=secret_token',
    pageTitle: 'Inbox - ceo@company.com - sk-live_1234567890abcdef - Ticket 1234567890',
    pageContext: [
      'header#topbar "Welcome admin@company.com"',
      'button.api-token "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9"',
      'table.orders-table (42 rows)',
    ].join('\n'),
    lang: 'zh',
  });

  assert.equal(prompt.startsWith('You generate browser mods for PageCraft'), true);
  assert.equal(prompt.includes('ceo@company.com'), false);
  assert.equal(prompt.includes('admin@company.com'), false);
  assert.equal(prompt.includes('sk-live_1234567890abcdef'), false);
  assert.equal(prompt.includes('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9'), false);
  assert.equal(prompt.includes('1234567890'), false);
  assert.equal(prompt.includes('jwt=secret_token'), false);
  assert.match(prompt, /table\.orders-table \(42 rows\)/);
});

test('tabs.onUpdated syncs path-scoped CSS immediately on SPA changeInfo.url pushState transitions', async () => {
  await upsertUserScript(
    makeSampleMod('bili-video-only', {
      matches: ['https://*.bilibili.com/video/*'],
      css: '.right-container { display: none !important; }',
    }),
  );

  const inserted: Array<{ tabId: number; css: string }> = [];
  const removed: Array<{ tabId: number; css: string }> = [];
  type TabUpdatedCb = (
    tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: chrome.tabs.Tab,
  ) => void;
  const listeners: TabUpdatedCb[] = [];

  const chromeAny = chrome as unknown as Record<string, unknown>;
  chromeAny.scripting = {
    async insertCSS({ target, css }: { target: { tabId: number }; css: string }) {
      inserted.push({ tabId: target.tabId, css });
    },
    async removeCSS({ target, css }: { target: { tabId: number }; css: string }) {
      removed.push({ tabId: target.tabId, css });
    },
  };
  chromeAny.tabs = {
    async query() {
      return [];
    },
    onUpdated: {
      addListener(fn: TabUpdatedCb) {
        listeners.push(fn);
      },
    },
    onRemoved: {
      addListener() {},
    },
  };

  initModsRuntime();
  await new Promise((r) => setTimeout(r, 15));
  const onTabUpdated = listeners[0];
  assert.ok(onTabUpdated, 'tabs.onUpdated listener should register');

  // 1. User starts on Bilibili home feed -> video-scoped CSS should NOT inject
  onTabUpdated(
    77,
    { status: 'complete' },
    { id: 77, url: 'https://www.bilibili.com/' } as chrome.tabs.Tab,
  );
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(inserted.length, 0);

  // 2. SPA pushState navigates to /video/BV1xx (changeInfo.url without status='loading') -> injects!
  onTabUpdated(
    77,
    { url: 'https://www.bilibili.com/video/BV1xx411c7mD' },
    { id: 77, url: 'https://www.bilibili.com/video/BV1xx411c7mD' } as chrome.tabs.Tab,
  );
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.tabId, 77);

  // 3. SPA pushState navigates back to homepage -> removes video-scoped CSS immediately!
  onTabUpdated(
    77,
    { url: 'https://www.bilibili.com/' },
    { id: 77, url: 'https://www.bilibili.com/' } as chrome.tabs.Tab,
  );
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(removed.length, 1);
  assert.equal(removed[0]?.tabId, 77);

  void store;
});

test('locales/{zh_CN,en}.yml strictly satisfy CWS/Edge <=45 name & <=132 desc limits and docs obey brand rules', () => {
  const zh = parseSimpleYaml(path.join(ROOT_DIR, 'locales/zh_CN.yml'));
  const en = parseSimpleYaml(path.join(ROOT_DIR, 'locales/en.yml'));

  assert.equal(zh.appName, 'PageCraft 网页工坊：AI 去弹窗改样式、表格导出与油猴脚本');
  assert.ok(zh.appName.length > 0 && zh.appName.length <= 45, `zh appName length=${zh.appName.length}`);
  assert.ok([...zh.appName].length <= 45);

  assert.ok(zh.appDesc && zh.appDesc.length > 0 && zh.appDesc.length <= 132, `zh appDesc length=${zh.appDesc?.length}`);
  assert.ok([...zh.appDesc].length <= 132);
  assert.equal(zh.appDesc.includes('10 次免费'), false);
  assert.match(zh.appDesc, /MCP/);

  assert.equal(en.appName, 'PageCraft: AI Webpage Customizer & Userscript');
  assert.ok(en.appName.length > 0 && en.appName.length <= 45, `en appName length=${en.appName.length}`);
  assert.ok([...en.appName].length <= 45);

  assert.equal(
    en.appDesc,
    'Click elements to hide popups, customize CSS, or build Tampermonkey scripts. 100% local-first: Built-in AI, BYOK, Ollama & MCP.',
  );
  assert.ok(en.appDesc.length > 0 && en.appDesc.length <= 132, `en appDesc length=${en.appDesc.length}`);
  assert.ok([...en.appDesc].length <= 132);

  // Unused boilerplate asset, orphaned legacy types, and legacy cloud backend must stay deleted
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'public/wxt.svg')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'lib/api')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'workers/cloud/package.json')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'workers/cloud/src')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'types/index.ts')), false);

  for (const ghRel of ['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/PULL_REQUEST_TEMPLATE.md']) {
    const ghContent = fs.readFileSync(path.join(ROOT_DIR, ghRel), 'utf8');
    assert.equal(ghContent.includes('workers/cloud'), false, `${ghRel} must not reference workers/cloud`);
    assert.match(ghContent, /packages\/mcp/, `${ghRel} must reference packages/mcp`);
  }

  // Open-source docs must link to GitHub Issues + official contact email, document Ollama CORS & MCP, and omit workers/cloud
  const readmeFiles = ['README.md', 'README.zh-CN.md'];
  for (const rel of readmeFiles) {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    assert.ok(
      content.includes('botzgbj@gmail.com'),
      `${rel} must include official support contact email botzgbj@gmail.com`,
    );
    assert.match(
      content,
      /https:\/\/github\.com\/botshen\/pagecraft\/issues/,
      `${rel} must link to GitHub Issues`,
    );
    assert.match(
      content,
      /OLLAMA_ORIGINS="chrome-extension:\/\/\*"\s+ollama serve/,
      `${rel} must document Ollama Chrome extension CORS setup`,
    );
    assert.match(
      content,
      /pagecraft-mcp/,
      `${rel} must document pagecraft-mcp local coding agent bridge`,
    );
    assert.match(
      content,
      /npx\s+-y\s+pagecraft-mcp/,
      `${rel} must document zero-install npx -y pagecraft-mcp command`,
    );
    assert.equal(
      content.includes('workers/cloud'),
      false,
      `${rel} must not reference legacy workers/cloud backend`,
    );
  }

  const settingsTsx = fs.readFileSync(
    path.join(ROOT_DIR, 'entrypoints/sidepanel/pages/Settings.tsx'),
    'utf8',
  );
  assert.match(settingsTsx, /MCP_NPX_PACKAGE = 'pagecraft-mcp'/);
  assert.match(settingsTsx, /npx -y \$\{MCP_NPX_PACKAGE\}/);

  const roadmapContent = fs.readFileSync(path.join(ROOT_DIR, 'ROADMAP.md'), 'utf8');
  assert.equal(
    /[a-z0-9._%+-]+@gmail\.com/i.test(roadmapContent),
    false,
    'ROADMAP.md must not contain personal @gmail.com address',
  );
});
