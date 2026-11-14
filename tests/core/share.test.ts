import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecipeShareUrl,
  decodeRecipeShortcode,
  encodeRecipeShortcode,
  formatRecipeSharePost,
  isShareableRecipeText,
} from '../../lib/userscripts/share.ts';

const SAMPLE_CSS_MOD = {
  name: '知乎纯净宽屏',
  description: '隐藏右侧推荐栏，正文加宽护眼',
  engine: 'css' as const,
  matches: ['https://*.zhihu.com/*'],
  code: '',
  css: '.Topstory-recommend { max-width: 960px !important; }',
  runAt: 'document_start' as const,
  targetSelectors: ['.Topstory-recommend'],
};

test('encodeRecipeShortcode and decodeRecipeShortcode round-trip Chinese CSS mods', () => {
  const token = encodeRecipeShortcode(SAMPLE_CSS_MOD);
  assert.ok(token.startsWith('PC1:'));

  const decoded = decodeRecipeShortcode(token);
  assert.ok(decoded);
  assert.equal(decoded.name, SAMPLE_CSS_MOD.name);
  assert.equal(decoded.description, SAMPLE_CSS_MOD.description);
  assert.equal(decoded.engine, 'css');
  assert.deepEqual(decoded.matches, SAMPLE_CSS_MOD.matches);
  assert.equal(decoded.body, SAMPLE_CSS_MOD.css);
  assert.deepEqual(decoded.targetSelectors, ['.Topstory-recommend']);
});

test('decodeRecipeShortcode extracts token from Xiaohongshu-style share post and deep-link URL', () => {
  const post = formatRecipeSharePost(SAMPLE_CSS_MOD, 'zh');
  assert.equal(isShareableRecipeText(post), true);

  const fromPost = decodeRecipeShortcode(post);
  assert.ok(fromPost);
  assert.equal(fromPost.name, SAMPLE_CSS_MOD.name);

  const shareUrl = buildRecipeShareUrl(SAMPLE_CSS_MOD);
  assert.match(shareUrl, /\?recipe=PC1%3A/);
  const fromUrl = decodeRecipeShortcode(shareUrl);
  assert.ok(fromUrl);
  assert.equal(fromUrl.body, SAMPLE_CSS_MOD.css);
});

test('decodeRecipeShortcode rejects malformed tokens and regular userscripts', () => {
  assert.equal(decodeRecipeShortcode(''), null);
  assert.equal(decodeRecipeShortcode('PC1:not-valid-base64!!!'), null);
  assert.equal(
    decodeRecipeShortcode('// ==UserScript==\n// @name Test\n// ==/UserScript=='),
    null,
  );
});
