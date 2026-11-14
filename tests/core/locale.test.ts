import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreferredLang } from '../../lib/shared/locale.ts';

test('resolvePreferredLang defaults Chinese users (even with English Chrome UI) to zh', () => {
  // 1. Standard Chinese browser
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'zh-CN',
      languages: ['zh-CN', 'zh'],
      language: 'zh-CN',
      timeZone: 'Asia/Shanghai',
    }),
    'zh',
  );

  // 2. Chinese user / developer with English primary UI + zh-CN secondary in navigator.languages
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'en-US',
      languages: ['en-US', 'en', 'zh-CN'],
      language: 'en-US',
      timeZone: 'America/Los_Angeles',
    }),
    'zh',
  );

  // 3. Chinese user with strictly English Chrome languages (`['en-US']`) in China/HK/TW timezone
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'en-US',
      languages: ['en-US'],
      language: 'en-US',
      timeZone: 'Asia/Shanghai',
    }),
    'zh',
  );
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'en-GB',
      languages: ['en-GB'],
      language: 'en-GB',
      timeZone: 'Asia/Taipei',
    }),
    'zh',
  );
});

test('resolvePreferredLang defaults overseas non-Chinese users to en', () => {
  // US user
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'en-US',
      languages: ['en-US', 'en'],
      language: 'en-US',
      timeZone: 'America/New_York',
    }),
    'en',
  );

  // German / Japanese overseas users
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'de',
      languages: ['de-DE', 'de', 'en-US'],
      language: 'de-DE',
      timeZone: 'Europe/Berlin',
    }),
    'en',
  );
  assert.equal(
    resolvePreferredLang({
      chromeUiLang: 'ja',
      languages: ['ja-JP', 'ja'],
      language: 'ja-JP',
      timeZone: 'Asia/Tokyo',
    }),
    'en',
  );
});

test('resolvePreferredLang respects explicit ?lang= query and manual user override', () => {
  assert.equal(
    resolvePreferredLang({
      queryLang: 'en',
      manualOverride: 'zh',
      chromeUiLang: 'zh-CN',
      languages: ['zh-CN'],
      timeZone: 'Asia/Shanghai',
    }),
    'en',
  );

  assert.equal(
    resolvePreferredLang({
      manualOverride: 'en',
      chromeUiLang: 'zh-CN',
      languages: ['zh-CN'],
      timeZone: 'Asia/Shanghai',
    }),
    'en',
  );

  assert.equal(
    resolvePreferredLang({
      manualOverride: 'zh',
      chromeUiLang: 'en-US',
      languages: ['en-US'],
      timeZone: 'America/New_York',
    }),
    'zh',
  );
});
