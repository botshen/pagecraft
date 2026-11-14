import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getExtensionDetailsUrl,
  isScriptableTabUrl,
  pickLandingTab,
} from '../../lib/shared/browser.ts';

test('isScriptableTabUrl allows normal http/https pages and blocks browser/store URLs', () => {
  assert.equal(isScriptableTabUrl('https://www.zhihu.com/question/1'), true);
  assert.equal(isScriptableTabUrl('http://localhost:3000/dashboard'), true);

  assert.equal(isScriptableTabUrl(undefined), false);
  assert.equal(isScriptableTabUrl(''), false);
  assert.equal(isScriptableTabUrl('chrome://newtab/'), false);
  assert.equal(isScriptableTabUrl('edge://extensions/'), false);
  assert.equal(isScriptableTabUrl('chrome-extension://abc/welcome.html'), false);
  assert.equal(isScriptableTabUrl('https://chromewebstore.google.com/detail/pagecraft/abc'), false);
  assert.equal(isScriptableTabUrl('https://chrome.google.com/webstore/detail/abc'), false);
  assert.equal(isScriptableTabUrl('https://microsoftedge.microsoft.com/addons/detail/abc'), false);
  assert.equal(isScriptableTabUrl('https://addons.mozilla.org/en-US/firefox/'), false);
});

test('getExtensionDetailsUrl picks edge:// for Edge and chrome:// for Chrome', () => {
  const chromeUa =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
  const edgeUa = `${chromeUa} Edg/138.0.0.0`;

  assert.equal(getExtensionDetailsUrl('ext123', chromeUa), 'chrome://extensions/?id=ext123');
  assert.equal(getExtensionDetailsUrl('ext123', edgeUa), 'edge://extensions/?id=ext123');
});

test('pickLandingTab skips the welcome tab, New Tab, and web stores', () => {
  const tabs = [
    { id: 1, url: 'chrome://newtab/' },
    { id: 2, url: 'https://chromewebstore.google.com/detail/pagecraft/xyz' },
    { id: 3, url: 'chrome-extension://id/welcome.html' },
    { id: 4, url: 'https://www.zhihu.com/question/42' },
  ];

  assert.equal(pickLandingTab(tabs, 3)?.id, 4);
  assert.equal(
    pickLandingTab(
      [
        { id: 1, url: 'chrome://newtab/' },
        { id: 3, url: 'chrome-extension://id/welcome.html' },
      ],
      3,
    ),
    undefined,
  );
});
