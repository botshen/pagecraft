import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPlaygroundIntent,
  isPlaygroundUrl,
  PLAYGROUND_MATCH_PATTERN,
  tryBuildPlaygroundMod,
} from '../../lib/userscripts/playground.ts';
import { generateUserScript } from '../../entrypoints/background/userscripts.ts';
import { DEFAULT_SETTINGS } from '../../lib/shared/constants.ts';

test('isPlaygroundUrl matches /playground on official site, *.github.io, localhost, and 127.0.0.1 while rejecting third-party hosts', () => {
  assert.equal(isPlaygroundUrl('https://pagecraft.shenxin.space/playground'), true);
  assert.equal(isPlaygroundUrl('https://pagecraft.shenxin.space/playground?lang=en'), true);
  assert.equal(isPlaygroundUrl('https://pagecraft.shenxin.space/playground/'), true);
  assert.equal(isPlaygroundUrl('https://botshen.github.io/playground'), true);
  assert.equal(isPlaygroundUrl('https://botshen.github.io/plugin-radar/playground?lang=zh'), true);
  assert.equal(isPlaygroundUrl('http://localhost:4173/playground'), true);
  assert.equal(isPlaygroundUrl('http://127.0.0.1:8080/playground/'), true);

  assert.equal(isPlaygroundUrl('https://pagecraft.shenxin.space/'), false);
  assert.equal(isPlaygroundUrl('https://botshen.github.io/plugin-radar/'), false);
  assert.equal(isPlaygroundUrl('https://evilgithub.io/playground'), false);
  assert.equal(isPlaygroundUrl('https://www.zhihu.com/playground'), false);
  assert.equal(isPlaygroundUrl('chrome://newtab'), false);
  assert.equal(isPlaygroundUrl(undefined), false);
});

test('defaultPlaygroundIntent tailors starter prompt to picked sandbox target', () => {
  assert.ok(defaultPlaygroundIntent('#pc-demo-banner', 'zh').includes('推广横幅'));
  assert.ok(defaultPlaygroundIntent('#pc-demo-sidebar', 'zh').includes('推荐栏'));
  assert.ok(defaultPlaygroundIntent('#pc-demo-sidebar', 'en').includes('sidebar'));
  assert.ok(defaultPlaygroundIntent('#pc-demo-table', 'zh').includes('逾期'));
});

test('tryBuildPlaygroundMod builds instant CSS for sandbox targets across supported hosts and passes JS requests through', () => {
  const sidebarMod = tryBuildPlaygroundMod({
    intent: '隐藏右侧杂乱推荐栏，并让正文自动加宽铺满',
    targetUrl: 'https://pagecraft.shenxin.space/playground',
    pickedElement: {
      selector: '#pc-demo-sidebar',
      matchCount: 1,
      tag: 'aside',
      attributes: { id: 'pc-demo-sidebar' },
      rect: { width: 286, height: 420 },
      computedStyles: {},
      domSnippet: '<aside id="pc-demo-sidebar"></aside>',
      pageUrl: 'https://pagecraft.shenxin.space/playground',
    },
    lang: 'zh',
  });

  assert.ok(sidebarMod);
  assert.equal(sidebarMod.engine, 'css');
  assert.deepEqual(sidebarMod.matches, [PLAYGROUND_MATCH_PATTERN]);
  assert.ok(sidebarMod.css?.includes('#pc-demo-sidebar'));
  assert.ok(sidebarMod.css?.includes('display: none !important'));
  assert.ok(sidebarMod.css?.includes('#pc-demo-article'));
  assert.ok(sidebarMod.targetSelectors?.includes('#pc-demo-sidebar'));

  // GitHub Pages subpath sandbox resolves exact subpath match pattern
  const ghPagesMod = tryBuildPlaygroundMod({
    intent: 'Hide the top promotional banner',
    targetUrl: 'https://botshen.github.io/plugin-radar/playground?lang=en',
    lang: 'en',
  });
  assert.ok(ghPagesMod);
  assert.deepEqual(ghPagesMod.matches, ['https://botshen.github.io/plugin-radar/playground*']);

  // Follow-up refinement preserves previous hidden target and adds banner + warm paper
  const refined = tryBuildPlaygroundMod({
    intent: '把顶部横幅也隐藏，并换成暖白护眼纸底',
    targetUrl: 'https://pagecraft.shenxin.space/playground',
    previousMod: {
      name: sidebarMod.name,
      description: sidebarMod.description,
      engine: 'css',
      matches: sidebarMod.matches,
      css: sidebarMod.css,
    },
    lang: 'zh',
  });
  assert.ok(refined);
  assert.ok(refined.css?.includes('#pc-demo-sidebar'));
  assert.ok(refined.css?.includes('#pc-demo-banner'));
  assert.ok(refined.css?.includes('#fbf8f0'));

  // Overdue row highlight
  const overdueMod = tryBuildPlaygroundMod({
    intent: '把表格里状态为「逾期」或金额大于 1000 的行高亮标红',
    targetUrl: 'https://localhost:4173/playground',
    lang: 'zh',
  });
  assert.ok(overdueMod);
  assert.equal(overdueMod.engine, 'css');
  assert.ok(overdueMod.css?.includes('tr[data-status="overdue"]'));

  // Interactive JS requests must return null so real AI generation handles them
  const jsRequest = tryBuildPlaygroundMod({
    intent: '给这个表格右上角加个导出 CSV 按钮',
    targetUrl: 'https://pagecraft.shenxin.space/playground',
    lang: 'zh',
  });
  assert.equal(jsRequest, null);
});

test('generateUserScript uses 0 LLM calls on /playground visual tasks', async () => {
  let llmCalls = 0;
  const res = await generateUserScript(
    {
      intent: '隐藏顶部推广横幅',
      targetUrl: 'https://pagecraft.shenxin.space/playground',
      lang: 'zh',
    },
    { ...DEFAULT_SETTINGS, aiMode: 'byok' },
    async () => {
      llmCalls++;
      return { content: '{}' };
    },
    (s) => s,
  );

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.provider, 'playground');
    assert.equal(res.script.engine, 'css');
  }
  assert.equal(llmCalls, 0);
});
