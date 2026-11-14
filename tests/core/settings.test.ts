import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers.ts';

const { reset } = installChromeMock();

const { readSettings, updateSettings, writeSettings } = await import(
  '../../lib/shared/settings.ts'
);
const { DEFAULT_SETTINGS } = await import('../../lib/shared/constants.ts');

beforeEach(() => {
  reset();
});

test('readSettings returns clean Cloud Trial defaults on fresh install', async () => {
  const s = await readSettings();
  assert.equal(s.aiMode, 'cloud');
  assert.equal(s.cloud.quota?.limit, 10);
  assert.equal(s.cloud.quota?.remaining, 10);
});

test('updateSettings serializes concurrent patches without losing sibling fields', async () => {
  await writeSettings({
    ...DEFAULT_SETTINGS,
    cloud: { installId: 'install_abcdef1234567890', quota: { used: 2, limit: 10, remaining: 8 } },
  });

  let releaseFirst!: () => void;
  const gate = new Promise<void>((r) => {
    releaseFirst = r;
  });

  const p1 = updateSettings(async () => {
    await gate;
    return { aiMode: 'byok' };
  });
  const p2 = updateSettings(() => ({
    ai: { apiKey: 'sk-deepseek-key', model: 'deepseek-chat' },
  }));

  releaseFirst();
  await Promise.all([p1, p2]);

  const final = await readSettings();
  assert.equal(final.aiMode, 'byok');
  assert.equal(final.ai.apiKey, 'sk-deepseek-key');
  assert.equal(final.cloud.installId, 'install_abcdef1234567890');
  assert.equal(final.cloud.quota?.remaining, 8);
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
