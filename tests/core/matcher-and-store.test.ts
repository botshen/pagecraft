import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers.ts';

const { reset } = installChromeMock();

const {
  urlMatchesPattern,
  urlMatchesAny,
  hostPatternFromUrl,
} = await import('../../lib/userscripts/matcher.ts');

const {
  upsertUserScript,
  readUserScripts,
  parseUserScriptHeader,
  exportAsUserScript,
  validateMatches,
} = await import('../../lib/userscripts/store.ts');

const {
  BUILTIN_TEMPLATES,
  instantiateTemplate,
} = await import('../../lib/userscripts/templates.ts');

const { parseGeneratedMod, buildModPrompt } = await import(
  '../../entrypoints/background/userscripts.ts'
);

beforeEach(() => {
  reset();
});

test('urlMatchesPattern handles subdomain wildcards, schemes, and paths accurately', () => {
  assert.equal(urlMatchesPattern('https://www.zhihu.com/question/123', 'https://*.zhihu.com/*'), true);
  assert.equal(urlMatchesPattern('https://zhihu.com/', 'https://*.zhihu.com/*'), true);
  assert.equal(urlMatchesPattern('http://zhihu.com/', 'https://*.zhihu.com/*'), false);
  assert.equal(urlMatchesPattern('https://evilzhihu.com/', 'https://*.zhihu.com/*'), false);
  assert.equal(urlMatchesAny('https://space.bilibili.com/42', ['https://*.bilibili.com/*']), true);
});

test('hostPatternFromUrl normalizes www subdomains to *.domain/*', () => {
  assert.equal(hostPatternFromUrl('https://www.xiaohongshu.com/explore/123'), 'https://*.xiaohongshu.com/*');
  assert.equal(hostPatternFromUrl('https://linux.do/t/topic/99'), 'https://linux.do/*');
  assert.equal(hostPatternFromUrl('chrome://extensions'), '');
});

test('exportAsUserScript exports both CSS and JS mods as valid Tampermonkey .user.js scripts', () => {
  const cssExport = exportAsUserScript({
    id: 'css123456',
    name: 'Clean Sidebar',
    description: 'Hide right sidebar',
    engine: 'css',
    matches: ['https://*.zhihu.com/*'],
    code: '',
    css: '.GlobalSideBar { display: none !important; }',
    enabled: true,
    source: 'ai',
    runAt: 'document_start',
    createdAt: 1,
    updatedAt: 1,
  });

  assert.match(cssExport, /\/\/ ==UserScript==/);
  assert.match(cssExport, /\/\/ @match\s+https:\/\/\*\.zhihu\.com\/\*/);
  assert.match(cssExport, /\/\/ @run-at\s+document-start/);
  assert.match(cssExport, /document\.createElement\('style'\)/);
  assert.match(cssExport, /\.GlobalSideBar \{ display: none !important; \}/);

  const reparsed = parseUserScriptHeader(cssExport);
  assert.equal(reparsed.name, 'Clean Sidebar');
  assert.deepEqual(reparsed.matches, ['https://*.zhihu.com/*']);
  assert.equal(reparsed.runAt, 'document_start');
});

test('BUILTIN_TEMPLATES all instantiate with valid @match and non-empty body', async () => {
  assert.ok(BUILTIN_TEMPLATES.length >= 10);
  for (const tpl of BUILTIN_TEMPLATES) {
    const mod = instantiateTemplate(tpl, 'https://www.example.com/dashboard', 'zh');
    assert.ok(mod, `template ${tpl.id} should instantiate`);
    assert.equal(validateMatches(mod.matches, false), null, `template ${tpl.id} matches valid`);
    if (mod.engine === 'css') {
      assert.ok((mod.css ?? '').trim().length > 10);
    } else {
      assert.ok(mod.code.trim().length > 10);
    }
    await upsertUserScript(mod);
  }
  const all = await readUserScripts();
  assert.equal(all.length, BUILTIN_TEMPLATES.length);
});

test('parseGeneratedMod validates CSS & JS mods and strips accidental wrappers', () => {
  const extract = (s: string) => s;
  const cssMod = parseGeneratedMod(
    JSON.stringify({
      name: '隐藏侧边栏',
      description: '清爽阅读',
      engine: 'css',
      matches: ['<all_urls>'], // broad match should narrow to fallbackMatchUrl
      css: '<style>.ad { display: none !important; }</style>',
      code: '',
      targetSelectors: ['.ad'],
      explanation: '已隐藏广告栏',
    }),
    extract,
    'https://www.zhihu.com/question/1',
  );
  assert.ok(!('error' in cssMod));
  assert.equal(cssMod.engine, 'css');
  assert.equal(cssMod.css, '.ad { display: none !important; }');
  assert.deepEqual(cssMod.matches, ['https://*.zhihu.com/*']);

  const prompt = buildModPrompt({
    intent: '导出表格为 CSV',
    targetUrl: 'https://admin.shop.com/orders?token=secret',
    pickedElement: {
      selector: 'table.orders-grid',
      matchCount: 1,
      similarSelector: 'table.orders-grid > tbody > tr',
      similarCount: 25,
      tag: 'table',
      attributes: { class: 'orders-grid' },
      rect: { width: 800, height: 420 },
      computedStyles: { display: 'table' },
      domSnippet: '<table class="orders-grid"><tr><td>Row</td></tr></table>',
      pageUrl: 'https://admin.shop.com/orders',
    },
    lang: 'zh',
  });
  assert.match(prompt, /table\.orders-grid/);
  assert.equal(prompt.includes('token=secret'), false);
});
