import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCssTweak,
  readCssTweaks,
  resetCssTweaks,
} from '../../lib/userscripts/css-tweaks.ts';

test('readCssTweaks extracts existing font-size, max-width, and warmth marker', () => {
  const css = [
    'article { font-size: 18px; max-width: 820px; }',
    '/* pc-tweak:warmth=35 */',
    'html { filter: sepia(0.158) brightness(0.972) !important; }',
    '/* /pc-tweak:warmth */',
  ].join('\n');

  const values = readCssTweaks(css);
  assert.deepEqual(values, {
    fontSize: 18,
    maxWidth: 820,
    warmth: 35,
  });
});

test('applyCssTweak updates existing px declarations in place without duplicating blocks', () => {
  const base = 'main { font-size: 16px; max-width: 760px; color: #222; }';
  const withFont = applyCssTweak(base, 'fontSize', 20);
  assert.match(withFont, /font-size:\s*20px/);
  assert.doesNotMatch(withFont, /pc-tweak:font-size/);

  const withWidth = applyCssTweak(withFont, 'maxWidth', 1000);
  assert.match(withWidth, /max-width:\s*1000px/);
  assert.doesNotMatch(withWidth, /pc-tweak:max-width/);
});

test('applyCssTweak appends marked blocks when properties are absent and warmth=0 removes block', () => {
  const base = '.ad-banner { display: none !important; }';
  const s1 = applyCssTweak(base, 'fontSize', 19, ['.article-body']);
  assert.match(s1, /\.article-body \{ font-size: 19px !important; \}/);

  const s2 = applyCssTweak(s1, 'warmth', 50);
  assert.match(s2, /pc-tweak:warmth=50/);
  assert.equal(readCssTweaks(s2).warmth, 50);

  const s3 = applyCssTweak(s2, 'warmth', 0);
  assert.doesNotMatch(s3, /pc-tweak:warmth/);
  assert.equal(readCssTweaks(s3).warmth, 0);

  const cleaned = resetCssTweaks(s3);
  assert.equal(cleaned.trim(), base);
});
