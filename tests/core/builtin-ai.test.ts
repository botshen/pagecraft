import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers.ts';

const { store, reset } = installChromeMock();

const {
  probeBuiltinAi,
  generateWithBuiltinAi,
  hasLocalBuiltinAiGlobal,
} = await import('../../lib/shared/builtin-ai.ts');
const { readSettings, normalizeSettings } = await import('../../lib/shared/settings.ts');
const { DEFAULT_SETTINGS } = await import('../../lib/shared/constants.ts');
const { STORAGE_KEYS } = await import('../../lib/types.ts');
const { generateUserScript } = await import('../../entrypoints/background/userscripts.ts');

beforeEach(() => {
  reset();
});

test('probeBuiltinAi maps modern LanguageModel, legacy ai.languageModel, and runtime forwarding accurately', async () => {
  // 1. Modern Chrome LanguageModel.availability()
  assert.deepEqual(
    await probeBuiltinAi({
      targetGlobal: {
        LanguageModel: {
          availability: async () => 'available',
          create: async () => ({ prompt: async () => '' }),
        },
      },
      allowRuntimeForward: false,
    }),
    { status: 'available' },
  );

  assert.deepEqual(
    await probeBuiltinAi({
      targetGlobal: {
        LanguageModel: {
          availability: async () => 'downloadable',
          create: async () => ({ prompt: async () => '' }),
        },
      },
      allowRuntimeForward: false,
    }),
    { status: 'downloadable', reason: 'downloadable' },
  );

  assert.deepEqual(
    await probeBuiltinAi({
      targetGlobal: {
        LanguageModel: {
          availability: async () => 'unavailable',
          create: async () => ({ prompt: async () => '' }),
        },
      },
      allowRuntimeForward: false,
    }),
    { status: 'unavailable', reason: 'unavailable' },
  );

  // 2. Legacy Chrome globalThis.ai.languageModel.capabilities()
  assert.equal(
    hasLocalBuiltinAiGlobal({
      ai: {
        languageModel: {
          capabilities: async () => ({ available: 'readily' }),
          create: async () => ({ prompt: async () => '' }),
        },
      },
    }),
    true,
  );
  assert.deepEqual(
    await probeBuiltinAi({
      targetGlobal: {
        ai: {
          languageModel: {
            capabilities: async () => ({ available: 'readily' }),
            create: async () => ({ prompt: async () => '' }),
          },
        },
      },
      allowRuntimeForward: false,
    }),
    { status: 'available' },
  );

  assert.deepEqual(
    await probeBuiltinAi({
      targetGlobal: {
        ai: {
          languageModel: {
            capabilities: async () => ({ available: 'after-download' }),
            create: async () => ({ prompt: async () => '' }),
          },
        },
      },
      allowRuntimeForward: false,
    }),
    { status: 'downloadable', reason: 'after-download' },
  );

  // 3. Runtime message forwarding when SW lacks global LanguageModel but SidePanel has it
  const forwardedProbe = await probeBuiltinAi({
    targetGlobal: {},
    allowRuntimeForward: true,
    sendRuntimeMessage: async (msg) => {
      assert.deepEqual(msg, {
        type: 'BUILTIN_AI_PROBE',
        payload: { forwarded: true },
      });
      return { status: 'available' };
    },
  });
  assert.deepEqual(forwardedProbe, { status: 'available' });

  // 4. Clean unavailable fallback when neither local global nor forwarded peer has API
  const missingProbe = await probeBuiltinAi({
    targetGlobal: {},
    allowRuntimeForward: false,
  });
  assert.equal(missingProbe.status, 'unavailable');
});

test('generateWithBuiltinAi runs modern & legacy sessions, destroys sessions cleanly, and supports BUILTIN_AI_PROMPT forwarding', async () => {
  let seenCreateOpts: Record<string, unknown> | undefined;
  let seenPrompt = '';
  let destroyed = false;

  const outModern = await generateWithBuiltinAi(
    'Return strict JSON only.',
    'Hide the floating newsletter modal',
    {
      targetGlobal: {
        LanguageModel: {
          availability: async () => 'available',
          create: async (opts) => {
            seenCreateOpts = opts;
            return {
              prompt: async (input) => {
                seenPrompt = input;
                return '{"name":"Hide Modal"}';
              },
              destroy: () => {
                destroyed = true;
              },
            };
          },
        },
      },
      allowRuntimeForward: false,
    },
  );

  assert.equal(outModern, '{"name":"Hide Modal"}');
  assert.equal(seenPrompt, 'Hide the floating newsletter modal');
  assert.deepEqual(seenCreateOpts, {
    initialPrompts: [{ role: 'system', content: 'Return strict JSON only.' }],
  });
  assert.equal(destroyed, true);

  // Legacy ai.languageModel passes `{ systemPrompt }` and still calls destroy() on failure
  let legacyDestroyed = false;
  let legacyCreateOpts: Record<string, unknown> | undefined;
  await assert.rejects(
    generateWithBuiltinAi('System instructions', 'Broken prompt', {
      targetGlobal: {
        ai: {
          languageModel: {
            capabilities: async () => ({ available: 'readily' }),
            create: async (opts) => {
              legacyCreateOpts = opts;
              return {
                prompt: async () => {
                  throw new Error('nano_context_overflow');
                },
                destroy: () => {
                  legacyDestroyed = true;
                },
              };
            },
          },
        },
      },
      allowRuntimeForward: false,
    }),
    /nano_context_overflow/,
  );
  assert.deepEqual(legacyCreateOpts, { systemPrompt: 'System instructions' });
  assert.equal(legacyDestroyed, true);

  // Forwarding via BUILTIN_AI_PROMPT
  const forwardedOut = await generateWithBuiltinAi('Sys', 'Usr', {
    targetGlobal: {},
    allowRuntimeForward: true,
    sendRuntimeMessage: async (msg) => {
      const m = msg as { type: string; payload: { systemPrompt: string; userPrompt: string; forwarded: boolean } };
      assert.equal(m.type, 'BUILTIN_AI_PROMPT');
      assert.equal(m.payload.systemPrompt, 'Sys');
      assert.equal(m.payload.userPrompt, 'Usr');
      assert.equal(m.payload.forwarded, true);
      return { ok: true, content: '{"name":"Forwarded Nano Mod"}' };
    },
  });
  assert.equal(forwardedOut, '{"name":"Forwarded Nano Mod"}');
});

test('generateUserScript executes offline in builtin mode with 0 HTTP calls and migrates legacy cloud settings', async () => {
  // Verify legacy stored `'cloud'` mode migrates cleanly to `'byok'`
  store.set(STORAGE_KEYS.SETTINGS, { aiMode: 'cloud' });
  const migrated = await readSettings();
  assert.equal(migrated.aiMode, 'byok');
  assert.equal(normalizeSettings({ aiMode: 'cloud' }).aiMode, 'byok');

  let httpChatCalled = false;
  let nanoSystemPrompt = '';
  let nanoUserPrompt = '';

  const res = await generateUserScript(
    {
      intent: 'Hide the sticky cookie banner',
      targetUrl: 'https://blog.example.com/post/1',
      pageTitle: 'Engineering Blog',
      lang: 'en',
    },
    {
      ...DEFAULT_SETTINGS,
      aiMode: 'builtin',
      ai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }, // even with empty BYOK key!
    },
    async () => {
      httpChatCalled = true;
      return { content: '{}' };
    },
    undefined,
    {
      builtinGenerate: async (sys, usr) => {
        nanoSystemPrompt = sys;
        nanoUserPrompt = usr;
        return JSON.stringify({
          name: 'Hide Cookie Banner',
          description: 'Hides sticky cookie notice with instant CSS',
          engine: 'css',
          matches: ['https://blog.example.com/*'],
          css: '#cookie-banner { display: none !important; }',
          code: '',
          targetSelectors: ['#cookie-banner'],
          explanation: 'Hides #cookie-banner immediately.',
        });
      },
      verifySelectors: async (selectors) => ({
        ok: true,
        totalHits: 1,
        details: selectors.map((s) => ({ selector: s, count: 1 })),
      }),
    },
  );

  assert.equal(httpChatCalled, false);
  assert.ok(nanoSystemPrompt.includes('valid JSON'));
  assert.ok(nanoUserPrompt.includes('Hide the sticky cookie banner'));
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.provider, 'builtin');
    assert.equal(res.usedVision, false);
    assert.equal(res.autoHealed, false);
    assert.equal(res.script.name, 'Hide Cookie Banner');
  }

  // Unavailable builtin AI surfaces code === 'builtin_unavailable'
  const unavailRes = await generateUserScript(
    {
      intent: 'Hide banner',
      targetUrl: 'https://blog.example.com/',
      lang: 'en',
    },
    { ...DEFAULT_SETTINGS, aiMode: 'builtin' },
    undefined,
    undefined,
    {
      builtinGenerate: async () => {
        throw new Error('Gemini Nano unavailable');
      },
    },
  );
  assert.equal(unavailRes.ok, false);
  if (!unavailRes.ok) {
    assert.equal(unavailRes.code, 'builtin_unavailable');
  }
});
