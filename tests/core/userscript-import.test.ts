import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportAsUserScript,
  extractPureStaticCss,
  normalizeTampermonkeyPattern,
  parseUserScriptHeader,
} from '../../lib/userscripts/store.ts';
import { needsGmShim, wrapWithGmShimIfNeeded } from '../../lib/userscripts/gm-shim.ts';

test('parseUserScriptHeader handles CRLF, @name:zh-CN, Tampermonkey @match/@include, and warnings', () => {
  const crlfScript = [
    '/*! MIT License */',
    '// ==UserScript==',
    '// @name         Clean Reader',
    '// @name:zh-CN   纯净阅读助手',
    '// @description:zh-CN 自动隐藏弹窗并记住开关状态',
    '// @match        http*://*.zhihu.com/*',
    '// @include      https://example.com',
    '// @include      /^https?:\\/\\/foo\\.bar\\/.*$/',
    '// @run-at       document-body',
    '// @grant        GM_addStyle',
    '// @grant        GM_setValue',
    '// ==/UserScript==',
    '',
    'GM_addStyle(".Modal { display: none !important; }");',
    'GM_setValue("installed", true);',
  ].join('\r\n');

  const zhMeta = parseUserScriptHeader(crlfScript, 'zh');
  assert.equal(zhMeta.name, '纯净阅读助手');
  assert.equal(zhMeta.description, '自动隐藏弹窗并记住开关状态');
  assert.deepEqual(zhMeta.matches, ['*://*.zhihu.com/*', 'https://example.com/*']);
  assert.equal(zhMeta.runAt, 'document_end');
  assert.deepEqual(zhMeta.grants, ['GM_addStyle', 'GM_setValue']);
  assert.deepEqual(zhMeta.warnings, []);
  // Has two statements (GM_addStyle + GM_setValue), so it stays JS rather than pure CSS
  assert.equal(zhMeta.extractedCss, undefined);

  const enMeta = parseUserScriptHeader(crlfScript, 'en');
  assert.equal(enMeta.name, 'Clean Reader');

  // Detects @require and GM_xmlhttpRequest warnings
  const heavyScript = [
    '// ==UserScript==',
    '// @name    Heavy Script',
    '// @match   https://example.com/*',
    '// @require https://cdn.example.com/jquery.min.js',
    '// @grant   GM_xmlhttpRequest',
    '// ==/UserScript==',
    'GM_xmlhttpRequest({ url: "https://api.example.com" });',
  ].join('\n');

  const heavyMeta = parseUserScriptHeader(heavyScript, 'zh');
  assert.deepEqual(heavyMeta.warnings, ['remote_require', 'cross_origin_xhr']);
});

test('normalizeTampermonkeyPattern converts wildcards and bare origins cleanly', () => {
  assert.equal(normalizeTampermonkeyPattern('http*://*.bilibili.com/*'), '*://*.bilibili.com/*');
  assert.equal(normalizeTampermonkeyPattern('https://news.ycombinator.com'), 'https://news.ycombinator.com/*');
  assert.equal(normalizeTampermonkeyPattern('*'), '<all_urls>');
  assert.equal(normalizeTampermonkeyPattern('/^https?:\\/\\/.*$/'), null);
});

test('extractPureStaticCss upgrades pure GM_addStyle and PageCraft exported CSS to instant CSS', () => {
  const exported = exportAsUserScript({
    id: 'abcd1234-5678',
    name: '去侧栏',
    description: '隐藏右侧栏',
    engine: 'css',
    matches: ['https://*.zhihu.com/*'],
    code: '',
    css: '.RightSideBar { display: none !important; }',
    enabled: true,
    source: 'ai',
    runAt: 'document_start',
    createdAt: 1,
    updatedAt: 1,
  });

  const roundTrip = parseUserScriptHeader(exported, 'zh');
  assert.equal(roundTrip.extractedCss, '.RightSideBar { display: none !important; }');

  const gmStyleScript = `// ==UserScript==
// @name  Pure Style Userscript
// @match https://example.com/*
// @grant GM_addStyle
// ==/UserScript==
(function() {
  'use strict';
  GM_addStyle(\`
    .banner { display: none !important; }
  \`);
})();`;
  const gmParsed = parseUserScriptHeader(gmStyleScript, 'en');
  assert.equal(gmParsed.extractedCss, '.banner { display: none !important; }');

  // Dynamic template interpolation must NOT be treated as static CSS
  assert.equal(extractPureStaticCss('GM_addStyle(`.a { color: ${color}; }`);'), undefined);
});

test('wrapWithGmShimIfNeeded leaves vanilla JS untouched and shims GM_* APIs at runtime', () => {
  const vanilla = '(() => { document.body.dataset.clean = "1"; })();';
  assert.equal(needsGmShim(vanilla), false);
  assert.equal(
    wrapWithGmShimIfNeeded({
      id: 'mod-vanilla-1',
      name: 'Vanilla',
      description: '',
      matches: ['https://example.com/*'],
      code: vanilla,
    }),
    vanilla,
  );

  const gmCode = `
    GM_addStyle('.ad { display: none; }');
    GM_setValue('count', (GM_getValue('count', 0) + 1));
    unsafeWindow.__seenTitle = GM_info.script.name;
  `;
  assert.equal(needsGmShim(gmCode), true);

  const wrapped = wrapWithGmShimIfNeeded({
    id: 'mod-gm-test-123456',
    name: 'Demo GM Script',
    description: 'Test',
    matches: ['https://example.com/*'],
    code: gmCode,
  });

  // Execute wrapped userscript in a minimal mock browser environment
  const appendedStyles: Array<{ textContent: string; attrs: Record<string, string> }> = [];
  const storageMap = new Map<string, string>();
  const mockWindow: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
      get length() {
        return storageMap.size;
      },
      key: (i: number) => [...storageMap.keys()][i] ?? null,
    },
  };
  const mockDocument = {
    readyState: 'complete',
    head: {
      appendChild(el: { textContent: string; attrs: Record<string, string> }) {
        appendedStyles.push(el);
        return el;
      },
    },
    createElement() {
      const attrs: Record<string, string> = {};
      return {
        textContent: '',
        attrs,
        setAttribute(k: string, v: string) {
          attrs[k] = v;
        },
      };
    },
  };

  const fn = new Function('window', 'document', 'navigator', wrapped);
  fn(mockWindow, mockDocument, {});

  assert.equal(appendedStyles.length, 1);
  assert.equal(appendedStyles[0]?.textContent, '.ad { display: none; }');
  assert.equal(mockWindow.__seenTitle, 'Demo GM Script');
  assert.equal(storageMap.get('__pc_gm_mod-gm-test-1234:count'), '1');
});
