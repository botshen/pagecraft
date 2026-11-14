import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSensitiveText,
  urlToHostHint,
  sanitizePageUrl,
} from '../../lib/shared/privacy.ts';

test('redactSensitiveText masks API keys, emails, long numbers, and query strings', () => {
  const raw =
    'Contact alice@corp.example.com or 1380013800099 with Bearer sk-secret1234567890 at https://app.example.com/orders?token=xyz';
  const clean = redactSensitiveText(raw, 250);
  assert.equal(clean.includes('alice@corp.example.com'), false);
  assert.equal(clean.includes('sk-secret1234567890'), false);
  assert.equal(clean.includes('token=xyz'), false);
  assert.match(clean, /\[EMAIL\]/);
  assert.match(clean, /\[NUM\]/);
});

test('urlToHostHint strips path, query, and hash', () => {
  assert.equal(
    urlToHostHint('https://www.zhihu.com/question/12345?utm_source=x#top'),
    'https://www.zhihu.com',
  );
  assert.equal(urlToHostHint('chrome://extensions'), '');
});

test('sanitizePageUrl replaces numeric/UUID segments and drops query strings', () => {
  assert.equal(
    sanitizePageUrl('https://seller.example.com/orders/987654321?secret=1#hash'),
    'https://seller.example.com/orders/:id',
  );
});
