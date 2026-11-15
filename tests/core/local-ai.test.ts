import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers.ts';

const { reset } = installChromeMock();

const {
  isLocalLoopbackEndpoint,
  resolveEndpoints,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MODEL,
  LM_STUDIO_DEFAULT_BASE_URL,
  AI_PROVIDER_PRESETS,
} = await import('../../lib/shared/ai-endpoints.ts');
const { endpointBase } = await import('../../lib/shared/endpoint.ts');
const { byokLlmChat, byokListModels, byokTestConnection } = await import(
  '../../lib/shared/ai-client.ts'
);
const { normalizeSettings } = await import('../../lib/shared/settings.ts');
const { DEFAULT_SETTINGS } = await import('../../lib/shared/constants.ts');
const { generateUserScript } = await import('../../entrypoints/background/userscripts.ts');
const { STRINGS } = await import('../../entrypoints/sidepanel/i18n.ts');

function extractJsonString(text: string): string {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

beforeEach(() => {
  reset();
});

test('isLocalLoopbackEndpoint strictly accepts http/https on localhost, 127.0.0.1, and [::1] only', () => {
  // Valid local loopback endpoints (Ollama, LM Studio, local gateways)
  assert.equal(isLocalLoopbackEndpoint(OLLAMA_DEFAULT_BASE_URL), true);
  assert.equal(isLocalLoopbackEndpoint('http://localhost:11434/v1'), true);
  assert.equal(isLocalLoopbackEndpoint('https://localhost:11434/v1'), true);
  assert.equal(isLocalLoopbackEndpoint('  http://LOCALHOST:8080/v1/chat/completions  '), true);
  assert.equal(isLocalLoopbackEndpoint('http://127.0.0.1:1234/v1'), true);
  assert.equal(isLocalLoopbackEndpoint('https://127.0.0.1/v1'), true);
  assert.equal(isLocalLoopbackEndpoint('http://[::1]:11434/v1'), true);
  assert.equal(isLocalLoopbackEndpoint('https://[::1]:1234/v1'), true);

  // Spoofed hostnames, remote hosts, non-http(s) schemes, obfuscated IPs, and credentials must be rejected
  assert.equal(isLocalLoopbackEndpoint(''), false);
  assert.equal(isLocalLoopbackEndpoint('http://evil.com'), false);
  assert.equal(isLocalLoopbackEndpoint('https://evil.com/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://localhost.evil.com/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('https://localhost.evil.com/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://evil.localhost/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://evillocalhost:11434/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://127.0.0.1.evil.com/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://127.0.0.2:11434/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://0.0.0.0:11434/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://2130706433:11434/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://0x7f000001:11434/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://localhost@evil.com/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('http://127.0.0.1:secret@evil.com/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('ws://localhost:11434/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('ftp://127.0.0.1/v1'), false);
  assert.equal(isLocalLoopbackEndpoint('javascript:alert(1)'), false);
});

test('resolveEndpoints and endpointBase allow http:// on loopback while keeping remote hosts strictly https://', () => {
  const ollama = resolveEndpoints('http://localhost:11434/v1/');
  assert.equal(ollama.error, undefined);
  assert.equal(ollama.base, 'http://localhost:11434/v1');
  assert.equal(ollama.chatUrl, 'http://localhost:11434/v1/chat/completions');
  assert.equal(ollama.modelsUrl, 'http://localhost:11434/v1/models');

  const lmStudio = resolveEndpoints('http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(lmStudio.error, undefined);
  assert.equal(lmStudio.base, 'http://127.0.0.1:1234/v1');

  const ipv6Loop = resolveEndpoints('http://[::1]:11434/v1');
  assert.equal(ipv6Loop.error, undefined);
  assert.equal(ipv6Loop.chatUrl, 'http://[::1]:11434/v1/chat/completions');

  const remoteHttps = resolveEndpoints('https://api.deepseek.com/v1');
  assert.equal(remoteHttps.error, undefined);
  assert.equal(remoteHttps.chatUrl, 'https://api.deepseek.com/v1/chat/completions');

  // Remote plaintext HTTP must NEVER be accepted
  const remoteHttp = resolveEndpoints('http://api.deepseek.com/v1');
  assert.equal(remoteHttp.error, 'insecure');
  assert.equal(remoteHttp.chatUrl, '');

  const spoofedHttp = resolveEndpoints('http://localhost.evil.com/v1');
  assert.equal(spoofedHttp.error, 'insecure');
  assert.equal(spoofedHttp.chatUrl, '');

  // Cloud Worker endpointBase mirrors the same HTTPS / loopback rule
  assert.equal(endpointBase('https://pagecraft.shenxin.space/api/quota'), 'https://pagecraft.shenxin.space');
  assert.equal(endpointBase('http://localhost:8787/api/generate'), 'http://localhost:8787');
  assert.equal(endpointBase('http://evil.com/api/generate'), null);
  assert.equal(endpointBase('http://localhost.evil.com'), null);
});

test('byokLlmChat, byokListModels, and byokTestConnection support keyless local loopback and enforce remote key + HTTPS', async () => {
  const seenCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  const mockLocalFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = { ...(init?.headers as Record<string, string>) };
    seenCalls.push({ url, headers });

    if (url.endsWith('/models')) {
      return new Response(
        JSON.stringify({
          data: [{ id: 'qwen2.5-coder:7b' }, { id: 'llama3.2:3b' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  // 1. Keyless local Ollama omits Authorization header completely
  const localConfig = {
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    apiKey: '   ',
    model: OLLAMA_DEFAULT_MODEL,
  };
  const connRes = await byokTestConnection(localConfig, mockLocalFetch);
  assert.equal(connRes.ok, true);
  assert.equal(seenCalls.length, 1);
  assert.equal(seenCalls[0]?.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal('Authorization' in (seenCalls[0]?.headers ?? {}), false);

  // 2. Keyless local model listing works without Authorization header
  const modelsRes = await byokListModels(localConfig, mockLocalFetch);
  assert.equal(modelsRes.ok, true);
  assert.deepEqual(modelsRes.models, ['llama3.2:3b', 'qwen2.5-coder:7b']);
  assert.equal('Authorization' in (seenCalls[1]?.headers ?? {}), false);

  // 3. Local endpoint with an explicit key sends Authorization: Bearer <key>
  await byokLlmChat(
    { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'lm-studio-token', model: 'qwen2.5-coder:7b' },
    'ping',
    true,
    mockLocalFetch,
  );
  assert.equal(seenCalls[2]?.headers.Authorization, 'Bearer lm-studio-token');

  // 4. Remote HTTPS endpoint with empty key is blocked before touching the network
  let networkTouched = false;
  const failFetch: typeof fetch = async () => {
    networkTouched = true;
    throw new Error('should not be called');
  };
  const remoteEmptyKey = await byokTestConnection(
    { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
    failFetch,
  );
  assert.equal(remoteEmptyKey.ok, false);
  assert.equal(remoteEmptyKey.status, 401);
  assert.equal(remoteEmptyKey.hint, 'invalidKey');
  assert.equal(networkTouched, false);

  // 5. Remote plaintext HTTP endpoint is blocked even when an API key is provided
  const remotePlainHttp = await byokTestConnection(
    { baseUrl: 'http://evil.com/v1', apiKey: 'test-remote-key', model: 'gpt-4o-mini' },
    failFetch,
  );
  assert.equal(remotePlainHttp.ok, false);
  assert.equal(remotePlainHttp.hint, 'unreachable');
  assert.equal(networkTouched, false);
});

test('generateUserScript executes keyless BYOK mod generation against local Ollama loopback mock endpoint', async () => {
  let capturedHeaders: Record<string, string> | undefined;
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;

  const mockOllamaFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = { ...(init?.headers as Record<string, string>) };
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Clean News Sidebar',
                description: 'Hides right promotional rail cleanly',
                engine: 'css',
                matches: ['https://news.example.com/*'],
                css: 'aside.promo-rail { display: none !important; }',
                code: '',
                targetSelectors: ['aside.promo-rail'],
                explanation: 'Hides aside.promo-rail via instant CSS injection.',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const localSettings = {
    ...DEFAULT_SETTINGS,
    aiMode: 'byok' as const,
    ai: {
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      apiKey: '', // Keyless local Ollama!
      model: OLLAMA_DEFAULT_MODEL,
    },
  };

  const res = await generateUserScript(
    {
      intent: 'Hide the right promo sidebar',
      targetUrl: 'https://news.example.com/article/42',
      pageTitle: 'Daily Tech News',
      lang: 'en',
    },
    localSettings,
    (cfg, prompt, isTest) => byokLlmChat(cfg, prompt, isTest, mockOllamaFetch),
    extractJsonString,
  );

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.provider, 'byok');
    assert.equal(res.script.engine, 'css');
    assert.equal(res.script.name, 'Clean News Sidebar');
    assert.match(res.script.css ?? '', /aside\.promo-rail/);
  }
  assert.equal(capturedUrl, 'http://localhost:11434/v1/chat/completions');
  assert.equal(capturedBody?.model, 'qwen2.5-coder:7b');
  assert.equal('Authorization' in (capturedHeaders ?? {}), false);

  // Remote BYOK without API key still returns missing_api_key
  const remoteNoKeyRes = await generateUserScript(
    {
      intent: 'Hide sidebar',
      targetUrl: 'https://news.example.com/',
      lang: 'en',
    },
    {
      ...DEFAULT_SETTINGS,
      aiMode: 'byok',
      ai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
    },
    (cfg, prompt, isTest) => byokLlmChat(cfg, prompt, isTest, mockOllamaFetch),
    extractJsonString,
  );
  assert.equal(remoteNoKeyRes.ok, false);
  if (!remoteNoKeyRes.ok) {
    assert.equal(remoteNoKeyRes.code, 'missing_api_key');
  }

  // Remote insecure http:// in BYOK mode is rejected before calling llmChat
  let calledInsecure = false;
  const insecureRes = await generateUserScript(
    {
      intent: 'Hide sidebar',
      targetUrl: 'https://news.example.com/',
      lang: 'en',
    },
    {
      ...DEFAULT_SETTINGS,
      aiMode: 'byok',
      ai: { baseUrl: 'http://evil.com/v1', apiKey: 'test-remote-key', model: 'gpt-4o-mini' },
    },
    async () => {
      calledInsecure = true;
      return { content: '{}' };
    },
    extractJsonString,
  );
  assert.equal(insecureRes.ok, false);
  assert.equal(calledInsecure, false);
});

test('normalizeSettings, provider presets, and bilingual i18n support Ollama, LM Studio, Anthropic, OpenRouter, and cloud->byok migration', () => {
  const inferred = normalizeSettings({
    ai: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5-coder:7b' },
  });
  assert.equal(inferred.aiMode, 'byok');
  assert.equal(inferred.ai.baseUrl, 'http://localhost:11434/v1');

  // Legacy stored cloud mode migrates seamlessly to byok in pure zero-backend client
  const migratedLegacyCloud = normalizeSettings({
    aiMode: 'cloud',
    ai: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5-coder:7b' },
  });
  assert.equal(migratedLegacyCloud.aiMode, 'byok');

  // Explicit builtin mode stays builtin
  const explicitBuiltin = normalizeSettings({
    aiMode: 'builtin',
    ai: { baseUrl: LM_STUDIO_DEFAULT_BASE_URL, apiKey: '', model: 'qwen2.5-coder:7b' },
  });
  assert.equal(explicitBuiltin.aiMode, 'builtin');

  const presetIds = AI_PROVIDER_PRESETS.map((p) => p.id);
  for (const requiredId of ['deepseek', 'siliconflow', 'openai', 'anthropic', 'openrouter', 'ollama', 'lmstudio']) {
    assert.ok(presetIds.includes(requiredId), `missing preset ${requiredId}`);
  }
  assert.equal(isLocalLoopbackEndpoint(LM_STUDIO_DEFAULT_BASE_URL), true);

  // Bilingual i18n keys for Ollama preset and CORS 403 instructions exist in both zh and en
  for (const lang of ['zh', 'en'] as const) {
    assert.ok(STRINGS[lang].presetOllama?.includes('Ollama'));
    assert.ok(STRINGS[lang].presetLmStudio?.includes('LM Studio'));
    assert.ok((STRINGS[lang].ollamaCorsTitle ?? '').length > 0);
    assert.ok((STRINGS[lang].ollamaCorsDesc ?? '').length > 0);
    assert.match(STRINGS[lang].hintLocalForbidden ?? '', /OLLAMA_ORIGINS="chrome-extension:\/\/\*"\s+ollama serve/);
  }
});
