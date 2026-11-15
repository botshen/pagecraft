import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installChromeMock } from './helpers.ts';

const { reset } = installChromeMock();

const { requestChatCompletion, byokLlmChat, LlmHttpError } = await import(
  '../../lib/shared/ai-client.ts'
);
const { DEFAULT_SETTINGS } = await import('../../lib/shared/constants.ts');
const {
  captureElementScreenshot,
  validateJsStructureSafely,
  validateCssStructureSafely,
  generateUserScript,
  buildMcpBridgeHandlers,
} = await import('../../entrypoints/background/userscripts.ts');
const { readUserScripts } = await import('../../lib/userscripts/store.ts');

import type { PickedElementContext } from '../../lib/userscripts/types.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

beforeEach(() => {
  reset();
});

test('requestChatCompletion sends OpenAI multimodal image_url and automatically falls back to text-only on HTTP 400/415/422', async () => {
  const sampleImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';

  // 1. Vision-capable model accepts multimodal array and returns usedVision: true
  const visionBodies: Array<Record<string, unknown>> = [];
  const visionFetch: typeof fetch = async (_input, init) => {
    visionBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"name":"Vision Mod"}' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const visionRes = await requestChatCompletion(
    {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-vision-key',
      model: 'gpt-4o-mini',
    },
    'Make this card compact',
    { imageDataUrl: sampleImage, fetchImpl: visionFetch },
  );
  assert.equal(visionRes.usedVision, true);
  assert.equal(visionRes.content, '{"name":"Vision Mod"}');
  assert.equal(visionBodies.length, 1);

  const firstMessages = visionBodies[0]?.messages as Array<{ role: string; content: unknown }>;
  assert.equal(Array.isArray(firstMessages[0]?.content), true);
  assert.deepEqual(firstMessages[0]?.content, [
    { type: 'text', text: 'Make this card compact' },
    { type: 'image_url', image_url: { url: sampleImage, detail: 'low' } },
  ]);

  // 2. Text-only endpoints returning HTTP 400, 415, or 422 trigger 1 automatic plain-string retry!
  for (const rejectStatus of [400, 415, 422]) {
    const attemptBodies: Array<Record<string, unknown>> = [];
    const fallbackFetch: typeof fetch = async (_input, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      attemptBodies.push(parsed);
      const msgs = parsed.messages as Array<{ content: unknown }>;
      if (Array.isArray(msgs[0]?.content)) {
        return new Response(
          JSON.stringify({ error: { message: 'image_url is not supported by text-only model' } }),
          { status: rejectStatus, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: `{"status":${rejectStatus},"fallback":true}` } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const fallbackRes = await byokLlmChat(
      {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-deepseek-text',
        model: 'deepseek-chat',
      },
      'Hide promo card',
      false,
      fallbackFetch,
      sampleImage,
    );

    assert.equal(attemptBodies.length, 2, `status ${rejectStatus} should retry exactly once`);
    const retryMessages = attemptBodies[1]?.messages as Array<{ role: string; content: unknown }>;
    assert.equal(retryMessages[0]?.content, 'Hide promo card');
    assert.equal(fallbackRes.usedVision, false);
    assert.equal(fallbackRes.content, `{"status":${rejectStatus},"fallback":true}`);
  }

  // 3. Auth failure (401) must NOT wastefully retry
  let authCalls = 0;
  await assert.rejects(
    requestChatCompletion(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-bad',
        model: 'gpt-4o-mini',
      },
      'Test',
      {
        imageDataUrl: sampleImage,
        fetchImpl: async () => {
          authCalls++;
          return new Response('Unauthorized', { status: 401 });
        },
      },
    ),
    (err: unknown) => err instanceof LlmHttpError && err.failure.status === 401,
  );
  assert.equal(authCalls, 1);
});

test('captureElementScreenshot crops around pickedElement.rect with 32px padding and scales max side <= 640px', async () => {
  const onePxJpeg = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
  let drawnArgs: number[] = [];
  let createdCanvasSize: { w: number; h: number } | null = null;
  let bitmapClosed = false;

  const picked: PickedElementContext = {
    selector: 'div.hero-banner',
    matchCount: 1,
    tag: 'div',
    attributes: { class: 'hero-banner' },
    rect: { x: 100, y: 200, width: 800, height: 400, dpr: 2 },
    computedStyles: {},
    domSnippet: '<div class="hero-banner">Promo</div>',
    pageUrl: 'https://shop.example.com/',
  };

  const cropped = await captureElementScreenshot(picked, {
    captureVisibleTab: async () => onePxJpeg,
    createImageBitmapImpl: async () => ({
      width: 2880,
      height: 1800,
      close() {
        bitmapClosed = true;
      },
    }),
    createOffscreenCanvas: (w, h) => {
      createdCanvasSize = { w, h };
      return {
        getContext: () => ({
          drawImage: (_img, sx, sy, sw, sh, dx, dy, dw, dh) => {
            drawnArgs = [sx, sy, sw, sh, dx, dy, dw, dh];
          },
        }),
        convertToBlob: async () => new Blob(['cropped-jpeg'], { type: 'image/jpeg' }),
      };
    },
  });

  assert.ok(cropped?.startsWith('data:image/jpeg;base64,'));
  assert.ok(createdCanvasSize);
  const { w, h } = createdCanvasSize as { w: number; h: number };
  assert.equal(Math.max(w, h), 640);
  assert.ok(w <= 640 && h <= 640);
  // (100 - 32) * 2 = 136; (200 - 32) * 2 = 336; (800 + 64) * 2 = 1728; (400 + 64) * 2 = 928
  assert.deepEqual(drawnArgs.slice(0, 4), [136, 336, 1728, 928]);
  assert.equal(bitmapClosed, true);

  // Zero-area element skips capture cleanly
  const emptyRectShot = await captureElementScreenshot(
    { ...picked, rect: { width: 0, height: 120 } },
    {
      captureVisibleTab: async () => {
        throw new Error('should not capture zero-width element');
      },
    },
  );
  assert.equal(emptyRectShot, undefined);
});

test('generateUserScript runs closed-loop live selector verification and 1-pass self-heal on 0 DOM hits', async () => {
  const seenPrompts: string[] = [];
  const verifiedSelectorsLog: string[][] = [];
  let contextFetched = 0;

  const picked: PickedElementContext = {
    selector: 'aside.feed-ad-card',
    matchCount: 1,
    tag: 'aside',
    attributes: { class: 'feed-ad-card' },
    rect: { x: 20, y: 40, width: 300, height: 180, dpr: 1 },
    computedStyles: {},
    domSnippet: '<aside class="feed-ad-card">Sponsored</aside>',
    pageUrl: 'https://forum.example.com/',
  };

  const result = await generateUserScript(
    {
      intent: 'Hide the sponsored sidebar card',
      targetUrl: 'https://forum.example.com/threads',
      pickedElement: picked,
      lang: 'en',
    },
    {
      ...DEFAULT_SETTINGS,
      aiMode: 'byok',
      enableVisionCapture: true,
      enableAutoHeal: true,
      ai: {
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5vl:7b',
      },
    },
    async (_cfg, prompt, _isTest, imageDataUrl) => {
      seenPrompts.push(prompt);
      assert.equal(imageDataUrl, 'data:image/jpeg;base64,FAKESCREENSHOT');

      if (seenPrompts.length === 1) {
        // Hallucinated selector on pass 1 -> 0 live hits!
        return {
          usedVision: true,
          content: JSON.stringify({
            name: 'Hide Sponsored Card',
            description: 'Hides sponsored sidebar card',
            engine: 'css',
            matches: ['https://forum.example.com/*'],
            css: '.non-existent-hallucinated-ad { display: none !important; }',
            code: '',
            targetSelectors: ['.non-existent-hallucinated-ad'],
            explanation: 'Initial attempt.',
          }),
        };
      }

      // Self-healed pass 2 -> matches real DOM landmark!
      return {
        usedVision: true,
        content: JSON.stringify({
          name: 'Hide Sponsored Card',
          description: 'Hides aside.feed-ad-card cleanly',
          engine: 'css',
          matches: ['https://forum.example.com/*'],
          css: 'aside.feed-ad-card { display: none !important; }',
          code: '',
          targetSelectors: ['aside.feed-ad-card'],
          explanation: 'Healed selector against live DOM landmarks.',
        }),
      };
    },
    undefined,
    {
      captureScreenshot: async () => 'data:image/jpeg;base64,FAKESCREENSHOT',
      fetchPageContext: async () => {
        contextFetched++;
        return {
          ok: true,
          context: 'main#thread-list\naside.feed-ad-card "Sponsored"',
        };
      },
      verifySelectors: async (selectors) => {
        verifiedSelectorsLog.push(selectors);
        if (selectors.includes('.non-existent-hallucinated-ad')) {
          return {
            ok: true,
            totalHits: 0,
            details: [{ selector: '.non-existent-hallucinated-ad', count: 0 }],
          };
        }
        return {
          ok: true,
          totalHits: 2,
          details: [{ selector: 'aside.feed-ad-card', count: 2 }],
        };
      },
    },
  );

  assert.equal(seenPrompts.length, 2, 'should run initial pass + 1 auto-heal pass');
  assert.equal(contextFetched, 1, 'should fetch fresh live DOM landmarks before healing');
  assert.match(
    seenPrompts[1] ?? '',
    /Auto-Verify: Generated selector\(s\) \[\.non-existent-hallucinated-ad\] matched 0 elements on the live DOM/,
  );
  assert.match(seenPrompts[1] ?? '', /aside\.feed-ad-card "Sponsored"/);
  assert.equal(verifiedSelectorsLog.length, 2);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.usedVision, true);
    assert.equal(result.autoHealed, true);
    assert.equal(result.script.css, 'aside.feed-ad-card { display: none !important; }');
    assert.equal(result.selectorCheck?.totalHits, 2);
  }
});

test('MV3 CSP-safe syntax validators reject truncated JS/CSS without using eval or new Function', () => {
  // Valid JS with regex containing unbalanced braces/quotes and template expressions
  const validJs = `(() => {
    const re = /[{("']/g;
    const label = \`Rows: \${document.querySelectorAll('tr').length}\`;
    console.log(label.replace(re, ''));
  })();`;
  assert.equal(validateJsStructureSafely(validJs), null);

  // Truncated / unbalanced JS must return an error string
  assert.ok(validateJsStructureSafely('(() => { const x = [1, 2; })()') !== null);
  assert.ok(validateJsStructureSafely('const s = "unterminated;') !== null);
  assert.ok(validateJsStructureSafely('const tpl = `hello ${name;') !== null);

  // Valid & invalid CSS
  assert.equal(validateCssStructureSafely('.ad-banner { content: "{not-a-brace}"; display: none !important; }'), null);
  assert.ok(validateCssStructureSafely('.ad-banner { display: none;') !== null);

  // Guarantee zero eval / new Function in extension runtime code
  const userscriptsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'entrypoints/background/userscripts.ts'),
    'utf8',
  );
  assert.equal(/\bnew\s+Function\s*\(/.test(userscriptsSource), false);
  assert.equal(/(?<![.\w$])eval\s*\(/.test(userscriptsSource), false);
});

test('buildMcpBridgeHandlers exposes all 7 MCP tools and persists/toggles mods cleanly', async () => {
  const chromeAny = chrome as unknown as Record<string, unknown>;
  chromeAny.tabs = {
    async query() {
      return [
        {
          id: 101,
          url: 'https://app.example.com/dashboard?token=secret123',
          title: 'Ops Console - ops@example.com',
        },
      ];
    },
  };
  chromeAny.scripting = {
    async executeScript() {
      return [{ result: 'main#dashboard\ntable.metrics-grid (12 rows)' }];
    },
    async insertCSS() {},
    async removeCSS() {},
  };

  const samplePicked: PickedElementContext = {
    selector: 'table.metrics-grid',
    matchCount: 1,
    tag: 'table',
    attributes: { class: 'metrics-grid' },
    rect: { x: 10, y: 20, width: 500, height: 260, dpr: 1 },
    computedStyles: {},
    domSnippet: '<table class="metrics-grid"></table>',
    pageUrl: 'https://app.example.com/dashboard',
  };

  let pickerStarted = false;
  const handlers = buildMcpBridgeHandlers({
    getLastPickedElement: () => samplePicked,
    startPicker: async () => {
      pickerStarted = true;
      return { ok: true };
    },
    captureScreenshot: async () => 'data:image/jpeg;base64,MCP_CROP',
  });

  // 1. getActivePage redacts PII and strips URL query secrets
  const page = (await handlers.getActivePage()) as {
    supported: boolean;
    url?: string;
    title?: string;
  };
  assert.equal(page.supported, true);
  assert.equal(page.url?.includes('secret123'), false);
  assert.equal(page.title?.includes('ops@example.com'), false);

  // 2. triggerPicker + getPickedElement (with cropped screenshot)
  const trig = (await handlers.triggerPicker()) as { ok: boolean };
  assert.equal(trig.ok, true);
  assert.equal(pickerStarted, true);

  const pickedOut = (await handlers.getPickedElement()) as {
    pickedElement: PickedElementContext | null;
  };
  assert.equal(pickedOut.pickedElement?.selector, 'table.metrics-grid');
  assert.equal(pickedOut.pickedElement?.screenshotDataUrl, 'data:image/jpeg;base64,MCP_CROP');

  // 3. applyMod -> listMods -> toggleMod
  const applied = (await handlers.applyMod({
    name: 'Compact Metrics Grid',
    description: 'Tightens table cell padding',
    engine: 'css',
    body: 'table.metrics-grid td { padding: 4px 8px !important; }',
    targetSelectors: ['table.metrics-grid'],
  })) as { ok: boolean; id: string; matches: string[] };

  assert.equal(applied.ok, true);
  assert.deepEqual(applied.matches, ['https://app.example.com/*']);

  const listed = (await handlers.listMods()) as {
    mods: Array<{ id: string; enabled: boolean }>;
  };
  assert.equal(listed.mods.length, 1);
  assert.equal(listed.mods[0]?.enabled, true);

  const toggled = (await handlers.toggleMod(applied.id, false)) as {
    ok: boolean;
    enabled: boolean;
  };
  assert.equal(toggled.ok, true);
  assert.equal(toggled.enabled, false);
  assert.equal((await readUserScripts())[0]?.enabled, false);
});
