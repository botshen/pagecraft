import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectHideMod,
  tryBuildLocalPickedMod,
} from '../../lib/userscripts/local-intent.ts';
import { BUILTIN_TEMPLATES, instantiateTemplate } from '../../lib/userscripts/templates.ts';
import { validateMatches } from '../../lib/userscripts/store.ts';
import { generateUserScript, parseGeneratedMod } from '../../entrypoints/background/userscripts.ts';
import { DEFAULT_SETTINGS } from '../../lib/shared/constants.ts';
import type { PickedElementContext } from '../../lib/userscripts/types.ts';

function makePicked(overrides: Partial<PickedElementContext> = {}): PickedElementContext {
  return {
    selector: 'aside.FloatingAdBanner',
    matchCount: 1,
    tag: 'aside',
    textPreview: 'Sponsored Promo',
    attributes: { class: 'FloatingAdBanner' },
    rect: { width: 300, height: 250 },
    computedStyles: {},
    domSnippet: '<aside class="FloatingAdBanner">Sponsored</aside>',
    pageUrl: 'https://news.example.com/post/123',
    ...overrides,
  };
}

test('zero-AI user (empty API key) hides a picked ad on any real website with 0 LLM calls', async () => {
  let llmCalls = 0;
  const res = await generateUserScript(
    {
      intent: '把这个广告去掉',
      targetUrl: 'https://news.example.com/post/123',
      pickedElement: makePicked(),
      lang: 'zh',
    },
    { ...DEFAULT_SETTINGS, aiMode: 'byok' },
    async () => {
      llmCalls++;
      return { content: '{}' };
    },
    (s) => s,
    {
      verifySelectors: async (sels) => ({
        ok: true,
        totalHits: 1,
        details: sels.map((selector) => ({ selector, count: 1 })),
      }),
    },
  );

  assert.equal(res.ok, true);
  assert.equal(llmCalls, 0);
  if (res.ok) {
    assert.equal(res.provider, 'local');
    assert.equal(res.script.engine, 'css');
    assert.match(res.script.css ?? '', /aside\.FloatingAdBanner\s*\{\s*display:\s*none\s*!important;/);
    assert.equal(res.selectorCheck?.totalHits, 1);
  }
});

test('zero-AI user handles sibling group hide, font size, widen, and table CSV export locally', async () => {
  const similarMod = tryBuildLocalPickedMod(
    {
      intent: '隐藏所有同类元素',
      targetUrl: 'https://portal.example.com/feed',
      pickedElement: makePicked({
        selector: '.feed-item:nth-of-type(2) .ad-card',
        similarSelector: '.feed-item .ad-card',
        similarCount: 5,
      }),
      lang: 'zh',
    },
    { allowExtendedFallback: false },
  );
  assert.ok(similarMod);
  assert.match(similarMod.css ?? '', /\.feed-item \.ad-card/);

  const fontMod = tryBuildLocalPickedMod(
    {
      intent: '调大正文阅读字号',
      targetUrl: 'https://docs.example.com/guide',
      pickedElement: makePicked({ selector: 'article.doc-content', tag: 'article' }),
      lang: 'zh',
    },
    { allowExtendedFallback: true },
  );
  assert.ok(fontMod);
  assert.equal(fontMod.engine, 'css');
  assert.match(fontMod.css ?? '', /font-size:\s*17\.5px\s*!important/);

  const csvRes = await generateUserScript(
    {
      intent: '添加导出 CSV 按钮',
      targetUrl: 'https://erp.example.com/orders',
      pickedElement: makePicked({ selector: 'table.orders-grid', tag: 'table' }),
      lang: 'zh',
    },
    { ...DEFAULT_SETTINGS, aiMode: 'byok' },
    async () => {
      throw new Error('Should not call LLM');
    },
    (s) => s,
    {
      verifySelectors: async () => ({ ok: true, totalHits: 1, details: [{ selector: 'table.orders-grid', count: 1 }] }),
    },
  );
  assert.equal(csvRes.ok, true);
  if (csvRes.ok) {
    assert.equal(csvRes.provider, 'local');
    assert.equal(csvRes.script.engine, 'js');
    assert.match(csvRes.script.code, /\\uFEFF/);
    assert.match(csvRes.script.code, /table\.orders-grid/);
  }
});

test('configured BYOK user fast-paths pure hide in 0ms while routing compound requests to AI', async () => {
  const configuredSettings = {
    ...DEFAULT_SETTINGS,
    aiMode: 'byok' as const,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-live-valid-test-key',
      model: 'gpt-4o-mini',
    },
  };

  let llmCalls = 0;

  // 1. Pure hide -> fast-paths locally with 0 LLM calls
  const fastHide = await generateUserScript(
    {
      intent: 'Hide this banner',
      targetUrl: 'https://blog.example.com/article',
      pickedElement: makePicked({ selector: '#promo-banner' }),
      lang: 'en',
    },
    configuredSettings,
    async () => {
      llmCalls++;
      return { content: '{}' };
    },
    (s) => s,
    { verifySelectors: async () => ({ ok: false, totalHits: 0, details: [] }) },
  );
  assert.equal(fastHide.ok, true);
  assert.equal(llmCalls, 0);

  // 2. Compound creative request -> delegates to configured LLM
  const compoundRes = await generateUserScript(
    {
      intent: '隐藏这个侧栏，并且把标题改成深蓝色、代码块加上圆角阴影',
      targetUrl: 'https://blog.example.com/article',
      pickedElement: makePicked({ selector: 'aside.sidebar' }),
      lang: 'zh',
    },
    configuredSettings,
    async () => {
      llmCalls++;
      return {
        content: JSON.stringify({
          name: '清爽深蓝阅读版',
          description: '隐藏侧栏并美化标题与代码块',
          engine: 'css',
          matches: ['https://blog.example.com/*'],
          css: 'aside.sidebar { display: none !important; } h1 { color: #1e3a8a !important; }',
          code: '',
          targetSelectors: ['aside.sidebar'],
          explanation: '已按复合需求生成样式。',
        }),
      };
    },
    (s) => s,
    { verifySelectors: async () => ({ ok: true, totalHits: 1, details: [{ selector: 'aside.sidebar', count: 1 }] }) },
  );
  assert.equal(compoundRes.ok, true);
  assert.equal(llmCalls, 1);
  if (compoundRes.ok) {
    assert.equal(compoundRes.provider, 'byok');
  }
});

test('zero-AI user matches built-in recipes by natural text and still prompts for AI on custom conditional logic', async () => {
  const darkRes = await generateUserScript(
    {
      intent: '开启护眼暗黑模式',
      targetUrl: 'https://wiki.example.com/page',
      lang: 'zh',
    },
    { ...DEFAULT_SETTINGS, aiMode: 'byok' },
    async () => {
      throw new Error('Should not call LLM');
    },
    (s) => s,
  );
  assert.equal(darkRes.ok, true);
  if (darkRes.ok) {
    assert.equal(darkRes.provider, 'local');
    assert.equal(darkRes.script.engine, 'css');
  }

  const customConditionalRes = await generateUserScript(
    {
      intent: '将表格中状态为「逾期」或金额大于 1000 的行标红高亮',
      targetUrl: 'https://erp.example.com/invoices',
      lang: 'zh',
    },
    { ...DEFAULT_SETTINGS, aiMode: 'byok' },
    async () => ({ content: '{}' }),
    (s) => s,
  );
  assert.equal(customConditionalRes.ok, false);
  if (!customConditionalRes.ok) {
    assert.equal(customConditionalRes.code, 'missing_api_key');
  }
});

test('buildDirectHideMod rejects root html/body selectors and unsafe CSS injection characters', () => {
  assert.equal(buildDirectHideMod({ selector: 'body', targetUrl: 'https://example.com/' }), null);
  assert.equal(buildDirectHideMod({ selector: 'HTML', targetUrl: 'https://example.com/' }), null);
  assert.equal(buildDirectHideMod({ selector: ':root', targetUrl: 'https://example.com/' }), null);
  assert.equal(
    buildDirectHideMod({ selector: '.ad { background: url(x) }', targetUrl: 'https://example.com/' }),
    null,
  );
  assert.equal(buildDirectHideMod({ selector: '.ad', targetUrl: 'chrome://extensions' }), null);
});

test('all expanded BUILTIN_TEMPLATES instantiate cleanly and pass structural CSS/JS & @match validators', () => {
  assert.ok(BUILTIN_TEMPLATES.length >= 20, `expected >= 20 recipes, got ${BUILTIN_TEMPLATES.length}`);
  const seenIds = new Set<string>();

  for (const recipe of BUILTIN_TEMPLATES) {
    assert.equal(seenIds.has(recipe.id), false, `duplicate recipe id: ${recipe.id}`);
    seenIds.add(recipe.id);

    const mod = instantiateTemplate(recipe, 'https://www.example.com/articles/1', 'zh');
    assert.ok(mod, `failed to instantiate ${recipe.id}`);
    assert.equal(validateMatches(mod.matches, false), null, `invalid @match in ${recipe.id}`);

    const validated = parseGeneratedMod(
      JSON.stringify({
        name: mod.name,
        description: mod.description,
        engine: mod.engine,
        matches: mod.matches,
        css: mod.css ?? '',
        code: mod.code ?? '',
        targetSelectors: [],
        explanation: mod.description,
      }),
      (s) => s,
      'https://www.example.com/articles/1',
    );
    assert.equal(
      'error' in validated,
      false,
      `structural validation failed for ${recipe.id}: ${'error' in validated ? validated.error : ''}`,
    );
  }
});
