import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitHubPackSubmissionUrl,
  buildPackFromUserScripts,
  decodePackShortcode,
  encodePackShortcode,
  extractWebHandoffPayload,
  formatPackSharePost,
  instantiatePackMods,
  parsePackJson,
  resolveCatalogPack,
  serializePackJson,
  type CommunityPack,
} from '../../lib/userscripts/packs.ts';
import { auditModSafety, auditPackSafety } from '../../lib/userscripts/safety-audit.ts';
import { COMMUNITY_CATALOG_PACKS } from '../../lib/userscripts/community-catalog.generated.ts';
import {
  mergeImportedUserScripts,
  readUserScripts,
  validateMatches,
} from '../../lib/userscripts/store.ts';
import { encodeRecipeShortcode } from '../../lib/userscripts/share.ts';
import { installChromeMock } from './helpers.ts';

const SAMPLE_PACK: CommunityPack = {
  kind: 'pagecraft-pack',
  version: 1,
  id: 'sample-bili-zen',
  name: 'B站极简测试套装',
  description: '屏蔽首页推广并注入倍速热键',
  author: '@tester',
  category: 'video',
  tags: ['bilibili', 'focus'],
  siteHints: ['bilibili.com'],
  updatedAt: '2026-11-15',
  mods: [
    {
      id: 'hide-banner',
      name: '隐藏首页推广',
      description: 'CSS 瞬间隐藏广告块',
      engine: 'css',
      matches: ['https://*.bilibili.com/*'],
      body: '.ad-report { display: none !important; }',
      runAt: 'document_start',
    },
    {
      id: 'speed-keys',
      name: '倍速微调热键',
      description: '纯本地 DOM 按键监听',
      engine: 'js',
      matches: ['https://www.bilibili.com/video/*'],
      body: '(() => { window.__pcTest = true; })();',
      runAt: 'document_idle',
    },
  ],
};

test('encodePackShortcode and decodePackShortcode round-trip multi-rule bilingual packs', () => {
  const token = encodePackShortcode(SAMPLE_PACK);
  assert.ok(token.startsWith('PCP1:'));

  const decoded = decodePackShortcode(token);
  assert.ok(decoded);
  assert.equal(decoded.id, SAMPLE_PACK.id);
  assert.equal(decoded.name, SAMPLE_PACK.name);
  assert.equal(decoded.author, SAMPLE_PACK.author);
  assert.equal(decoded.mods.length, 2);
  assert.equal(decoded.mods[0]?.engine, 'css');
  assert.equal(decoded.mods[1]?.engine, 'js');

  const post = formatPackSharePost(SAMPLE_PACK, 'zh');
  assert.ok(post.includes('#PCP1:'));
  const fromPost = decodePackShortcode(post);
  assert.ok(fromPost);
  assert.equal(fromPost.mods.length, 2);

  const encodedParam = encodeURIComponent(token);
  const fromQuery = decodePackShortcode(`https://pagecraft.shenxin.space/recipes/?pack=${encodedParam}`);
  assert.ok(fromQuery);
  assert.equal(fromQuery.id, SAMPLE_PACK.id);
});

test('serializePackJson and parsePackJson validate schema and reject invalid manifests', () => {
  const jsonText = serializePackJson(SAMPLE_PACK);
  const parsed = parsePackJson(jsonText);
  assert.ok(parsed);
  assert.equal(parsed.id, SAMPLE_PACK.id);
  assert.equal(parsed.mods.length, 2);

  assert.equal(parsePackJson('{}'), null);
  assert.equal(
    parsePackJson(JSON.stringify({ kind: 'pagecraft-pack', version: 2, name: 'x', mods: [] })),
    null,
  );
  assert.equal(
    parsePackJson(JSON.stringify({ kind: 'pagecraft-pack', version: 1, name: 'x', mods: [] })),
    null,
  );
});

test('auditModSafety and auditPackSafety distinguish safe CSS, clean local JS, warnings, and blocked code', () => {
  const cssReport = auditModSafety({
    engine: 'css',
    body: '.promo { display: none !important; }',
    matches: ['https://example.com/*'],
  });
  assert.equal(cssReport.level, 'safe_css');
  assert.equal(cssReport.findings.length, 0);

  const cleanJsReport = auditModSafety({
    engine: 'js',
    body: '(() => { document.querySelectorAll("a").length; })();',
    matches: ['https://example.com/*'],
  });
  assert.equal(cleanJsReport.level, 'clean_local_js');
  assert.equal(cleanJsReport.findings.length, 0);

  const warnReport = auditModSafety({
    engine: 'js',
    body: 'fetch("https://api.example.com").then(() => console.log(document.cookie));',
    matches: ['<all_urls>'],
  });
  assert.equal(warnReport.level, 'review_warning');
  const warnCodes = new Set(warnReport.findings.map((f) => f.code));
  assert.ok(warnCodes.has('js_network_request'));
  assert.ok(warnCodes.has('js_cookie_access'));
  assert.ok(warnCodes.has('broad_all_urls_match'));

  const blockedEval = auditModSafety({
    engine: 'js',
    body: 'eval("alert(1)");',
    matches: ['https://example.com/*'],
  });
  assert.equal(blockedEval.level, 'blocked');

  const blockedCssImport = auditModSafety({
    engine: 'css',
    body: '@import url("https://evil.example.com/x.css"); body { color: red; }',
    matches: ['https://example.com/*'],
  });
  assert.equal(blockedCssImport.level, 'blocked');

  const brokenCss = auditModSafety({
    engine: 'css',
    body: '[class*="app- guide"] { display: none; ',
    matches: ['https://example.com/*'],
  });
  assert.equal(brokenCss.level, 'blocked');

  const packReport = auditPackSafety([
    { engine: 'css', body: 'a { color: red; }', matches: ['https://example.com/*'] },
    { engine: 'js', body: '(() => {})();', matches: ['https://example.com/*'] },
  ]);
  assert.equal(packReport.level, 'clean_local_js');
});

test('all curated official packs in COMMUNITY_CATALOG_PACKS pass strict schema and MV3 safety gates', () => {
  assert.ok(COMMUNITY_CATALOG_PACKS.length >= 8);
  const seenIds = new Set<string>();

  for (const entry of COMMUNITY_CATALOG_PACKS) {
    assert.ok(!seenIds.has(entry.id), `Duplicate catalog pack ID: ${entry.id}`);
    seenIds.add(entry.id);

    for (const lang of ['zh', 'en'] as const) {
      const resolved = resolveCatalogPack(entry, lang);
      assert.ok(resolved.name.length > 0);
      assert.ok(resolved.description.length > 0);
      assert.ok(resolved.mods.length > 0);

      for (const m of resolved.mods) {
        assert.equal(
          validateMatches(m.matches, false),
          null,
          `${entry.id}.${lang}.${m.id} must have valid scoped @match`,
        );
      }

      const safety = auditPackSafety(resolved.mods);
      assert.ok(
        safety.level === 'safe_css' || safety.level === 'clean_local_js',
        `${entry.id}.${lang} must pass with zero warnings/blocks, got ${safety.level}`,
      );
    }
  }
});

test('instantiatePackMods and mergeImportedUserScripts update rules idempotently without duplication', async () => {
  const mock = installChromeMock();
  mock.reset();

  const modsV1 = instantiatePackMods(SAMPLE_PACK);
  assert.equal(modsV1.length, 2);
  assert.equal(modsV1[0]?.id, 'pack:sample-bili-zen:hide-banner');
  assert.equal(modsV1[0]?.source, 'community');
  assert.equal(modsV1[0]?.packId, 'sample-bili-zen');

  await mergeImportedUserScripts(modsV1);
  assert.equal((await readUserScripts()).length, 2);

  // Re-import updated version of pack -> must overwrite in place, count remains 2
  const updatedPack: CommunityPack = {
    ...SAMPLE_PACK,
    mods: [
      { ...SAMPLE_PACK.mods[0]!, body: '.ad-report, .ad-floor { display: none !important; }' },
      SAMPLE_PACK.mods[1]!,
    ],
  };
  await mergeImportedUserScripts(instantiatePackMods(updatedPack));
  const stored = await readUserScripts();
  assert.equal(stored.length, 2);
  assert.ok(stored[0]?.css?.includes('.ad-floor'));

  // Partial selection imports only chosen mod
  const partial = instantiatePackMods(SAMPLE_PACK, new Set(['speed-keys']));
  assert.equal(partial.length, 1);
  assert.equal(partial[0]?.id, 'pack:sample-bili-zen:speed-keys');

  // Round-trip buildPackFromUserScripts
  const bundled = buildPackFromUserScripts(stored, {
    name: 'Bundled Pack',
    author: '@dev',
  });
  assert.equal(bundled.mods.length, 2);
  assert.ok(bundled.siteHints.includes('bilibili.com'));
});

test('extractWebHandoffPayload restricts handoff strictly to trusted PageCraft origins', () => {
  const catalogHit = extractWebHandoffPayload('https://pagecraft.shenxin.space/recipes/?pack=bilibili-zen');
  assert.deepEqual(catalogHit, { kind: 'catalog-pack', packId: 'bilibili-zen' });

  const token = encodePackShortcode(SAMPLE_PACK);
  const inlineHit = extractWebHandoffPayload(
    `https://pagecraft.shenxin.space/recipes/?pack=${encodeURIComponent(token)}`,
  );
  assert.ok(inlineHit && inlineHit.kind === 'inline-pack');
  assert.equal(inlineHit.pack.id, SAMPLE_PACK.id);

  const singleShortcode = encodeRecipeShortcode({
    name: 'Quick CSS',
    description: 'Clean',
    engine: 'css',
    matches: ['https://example.com/*'],
    code: '',
    css: 'body { margin: 0; }',
    runAt: 'document_start',
  });
  const singleHit = extractWebHandoffPayload(
    `https://pagecraft.shenxin.space/playground/?recipe=${encodeURIComponent(singleShortcode)}`,
  );
  assert.ok(singleHit && singleHit.kind === 'single-recipe');

  // Untrusted origins MUST return null
  assert.equal(
    extractWebHandoffPayload('https://evil.example.com/recipes/?pack=bilibili-zen'),
    null,
  );
  assert.equal(
    extractWebHandoffPayload(`https://evil.example.com/?pack=${encodeURIComponent(token)}`),
    null,
  );
  assert.equal(extractWebHandoffPayload('chrome://extensions'), null);
});

test('buildGitHubPackSubmissionUrl generates pre-filled community_pack.yml link within URI length limits', () => {
  const normalUrl = buildGitHubPackSubmissionUrl(SAMPLE_PACK);
  assert.ok(normalUrl.startsWith('https://github.com/botshen/pagecraft/issues/new?'));
  assert.ok(normalUrl.includes('template=community_pack.yml'));
  assert.ok(normalUrl.includes('pack_id=sample-bili-zen'));
  assert.ok(normalUrl.length <= 7500);

  // Oversized pack gracefully omits giant JSON in query so GitHub doesn't HTTP 414
  const hugePack: CommunityPack = {
    ...SAMPLE_PACK,
    mods: [
      {
        ...SAMPLE_PACK.mods[0]!,
        body: `.x { color: red; } /* ${'a'.repeat(12000)} */`,
      },
    ],
  };
  const fallbackUrl = buildGitHubPackSubmissionUrl(hugePack);
  assert.ok(fallbackUrl.length <= 7500);
  const packJsonParam = new URL(fallbackUrl).searchParams.get('pack_json') ?? '';
  assert.ok(packJsonParam.includes('exceeds URL length limit'));
});
