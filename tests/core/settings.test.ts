import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers.ts';

const { store, reset } = installChromeMock();

const { readSettings, updateSettings, writeSettings, normalizeSettings } = await import(
  '../../lib/shared/settings.ts'
);
const { DEFAULT_SETTINGS, DEFAULT_MCP_BRIDGE_URL } = await import(
  '../../lib/shared/constants.ts'
);
const { STORAGE_KEYS } = await import('../../lib/types.ts');

beforeEach(() => {
  reset();
});

test('readSettings returns pure zero-backend local-first defaults on fresh install', async () => {
  const s = await readSettings();
  assert.equal(s.aiMode, 'byok');
  assert.equal(s.enableVisionCapture, true);
  assert.equal(s.enableAutoHeal, true);
  assert.equal(s.mcpBridgeEnabled, false);
  assert.equal(s.mcpBridgeUrl, DEFAULT_MCP_BRIDGE_URL);
  assert.equal(s.mcpBridgeToken, '');
  assert.equal('cloud' in (s as unknown as Record<string, unknown>), false);
});

test('readSettings seamlessly migrates legacy stored aiMode="cloud" to "byok" without breaking installs', async () => {
  store.set(STORAGE_KEYS.SETTINGS, {
    aiMode: 'cloud',
    ai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-existing', model: 'deepseek-chat' },
    cloud: { installId: 'legacy_install_123', quota: { used: 7, limit: 10, remaining: 3 } },
    onboardingDone: true,
    tutorialDone: true,
  });

  const migrated = await readSettings();
  assert.equal(migrated.aiMode, 'byok');
  assert.equal(migrated.ai.apiKey, 'sk-existing');
  assert.equal(migrated.onboardingDone, true);
  assert.equal(migrated.tutorialDone, true);
  assert.equal(migrated.enableVisionCapture, true);
  assert.equal(migrated.enableAutoHeal, true);
  assert.equal('cloud' in (migrated as unknown as Record<string, unknown>), false);

  assert.equal(normalizeSettings({ aiMode: 'builtin' }).aiMode, 'builtin');
});

test('updateSettings serializes concurrent patches without losing sibling fields', async () => {
  await writeSettings({
    ...DEFAULT_SETTINGS,
    mcpBridgeToken: 'tok_initial_123',
  });

  let releaseFirst!: () => void;
  const gate = new Promise<void>((r) => {
    releaseFirst = r;
  });

  const p1 = updateSettings(async () => {
    await gate;
    return { aiMode: 'builtin', enableVisionCapture: false };
  });
  const p2 = updateSettings(() => ({
    ai: { apiKey: 'sk-deepseek-key', model: 'deepseek-chat' },
    mcpBridgeEnabled: true,
  }));

  releaseFirst();
  await Promise.all([p1, p2]);

  const final = await readSettings();
  assert.equal(final.aiMode, 'builtin');
  assert.equal(final.enableVisionCapture, false);
  assert.equal(final.ai.apiKey, 'sk-deepseek-key');
  assert.equal(final.mcpBridgeEnabled, true);
  assert.equal(final.mcpBridgeToken, 'tok_initial_123');
});

test('failed updateSettings mutator does not wedge the lock queue', async () => {
  await assert.rejects(
    updateSettings(() => {
      throw new Error('boom');
    }),
    /boom/,
  );

  const after = await updateSettings(() => ({ onboardingDone: true }));
  assert.equal(after.onboardingDone, true);
});
