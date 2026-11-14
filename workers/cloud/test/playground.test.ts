import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlayground } from '../src/routes/playground';
import { LANDING_CSP } from '../src/routes/landing';
import worker from '../src/index';
import type { Env } from '../src/types';

test('handlePlayground serves zh-CN by default with strict CSP and target selectors', async () => {
  const res = handlePlayground();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Content-Security-Policy'), LANDING_CSP);

  const html = await res.text();
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.ok(html.includes('<html lang="zh-CN" data-lang="zh">'));
  assert.ok(html.includes('id="pc-demo-guide"'));
  assert.ok(html.includes('id="pc-demo-banner"'));
  assert.ok(html.includes('id="pc-demo-sidebar"'));
  assert.ok(html.includes('id="pc-demo-article"'));
  assert.ok(html.includes('id="pc-demo-table"'));
  assert.ok(html.includes('id="pc-demo-float"'));
  assert.ok(html.includes('data-status="overdue"'));
  assert.ok(html.includes('#C95533'), 'playground must include PageCraft brand SVG');
  assert.equal(html.includes('✦'), false, 'old ✦ placeholder must be replaced');
});

test('handlePlayground supports ?lang=en, HEAD requests via worker, and official contact + GitHub links', async () => {
  const enRes = handlePlayground(new Request('https://pagecraft.shenxin.space/playground?lang=en'));
  assert.equal(enRes.status, 200);
  const enHtml = await enRes.text();
  assert.ok(enHtml.includes('<html lang="en" data-lang="en">'));
  assert.ok(enHtml.includes('href="/privacy"'));
  assert.ok(enHtml.includes('mailto:botzgbj@gmail.com'));
  assert.ok(enHtml.includes('https://github.com/botshen/plugin-radar'));
  assert.equal(/<script[^>]+src=/i.test(enHtml), false);

  const headRes = await worker.fetch(
    new Request('https://pagecraft.shenxin.space/playground', { method: 'HEAD' }),
    {} as Env,
  );
  assert.equal(headRes.status, 200);
  assert.equal(await headRes.text(), '');
});
