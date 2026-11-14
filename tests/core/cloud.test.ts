import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers.ts';

const { reset } = installChromeMock();

const { requestCloudGeneration, fetchCloudQuota, sendGenerationFeedback } = await import(
  '../../lib/api/cloud.ts'
);

beforeEach(() => {
  reset();
});

test('requestCloudGeneration auto-registers install secret and updates quota', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/register')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { installId: string };
      return new Response(
        JSON.stringify({ ok: true, installId: body.installId, secret: 'b'.repeat(64) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/generate')) {
      const hdrs = init?.headers as Record<string, string>;
      assert.ok(hdrs['X-Install-Id']);
      assert.ok(hdrs['X-Install-Sig']);
      return new Response(
        JSON.stringify({
          ok: true,
          content: '{"name":"Test"}',
          quota: { used: 1, limit: 10, remaining: 9 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  };

  const res = await requestCloudGeneration('Hide sidebar', fakeFetch);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.quota.remaining, 9);
  }
  assert.equal(calls.length, 2); // register + generate

  // Second call reuses persisted secret without re-registering
  const res2 = await requestCloudGeneration('Widen article', fakeFetch);
  assert.equal(res2.ok, true);
  assert.equal(calls.length, 3);
});

test('requestCloudGeneration surfaces quota_exhausted on HTTP 402', async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/register')) {
      return new Response(
        JSON.stringify({ ok: true, installId: 'inst_1234567890123456', secret: 'c'.repeat(64) }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'quota_exhausted',
        quota: { used: 10, limit: 10, remaining: 0 },
      }),
      { status: 402 },
    );
  };

  const res = await requestCloudGeneration('Add button', fakeFetch);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'quota_exhausted');
    assert.equal(res.quota?.remaining, 0);
  }

  const q = await fetchCloudQuota(async () =>
    new Response(JSON.stringify({ ok: true, quota: { used: 10, limit: 10, remaining: 0 } }), {
      status: 200,
    }),
  );
  assert.equal(q?.remaining, 0);
});

test('default cloud endpoint is the PageCraft domain', async () => {
  const { DEFAULT_CLOUD_ENDPOINT } = await import('../../lib/shared/constants.ts');
  assert.equal(DEFAULT_CLOUD_ENDPOINT, 'https://pagecraft.shenxin.space');
});

test('sendGenerationFeedback sends only coarse enums, signed', async () => {
  let sentBody: Record<string, unknown> | null = null;
  let sentUrl = '';
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/register')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { installId: string };
      return new Response(
        JSON.stringify({ ok: true, installId: body.installId, secret: 'd'.repeat(64) }),
        { status: 200 },
      );
    }
    sentUrl = url;
    const hdrs = init?.headers as Record<string, string>;
    assert.ok(hdrs['X-Install-Sig']);
    sentBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const res = await sendGenerationFeedback(
    {
      verdict: 'down',
      engine: 'js',
      aiSource: 'byok',
      refined: true,
      selector: 'miss',
      // Extra fields must be dropped before leaving the device.
      ...({ url: 'https://secret.example.com/page', code: 'alert(1)' } as object),
    } as Parameters<typeof sendGenerationFeedback>[0],
    fakeFetch,
  );
  assert.equal(res.ok, true);
  assert.ok(sentUrl.endsWith('/api/feedback'));
  assert.deepEqual(sentBody, {
    verdict: 'down',
    engine: 'js',
    aiSource: 'byok',
    refined: true,
    selector: 'miss',
  });
});
