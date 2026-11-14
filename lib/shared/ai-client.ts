/**
 * OpenAI-compatible BYOK & Local Loopback (Ollama / LM Studio) LLM client.
 *
 * - Remote endpoints MUST use `https://` and provide a non-empty API key.
 * - Local loopback endpoints (`localhost`, `127.0.0.1`, `[::1]`) may use `http://`
 *   and do NOT require an API key (`Authorization` header is omitted when empty,
 *   or sent as `Bearer <key>` when provided).
 */

import type { AIConfig } from '../../types';
import { isLocalLoopbackEndpoint, resolveEndpoints, type ResolvedEndpoints } from './ai-endpoints';
import {
  describeFetchFailure,
  describeHttpFailure,
  type ApiFailure,
  type ConnectionCheckResult,
  type ModelsResult,
} from './ai-error';

interface ChatResponse {
  choices?: Array<{ message?: { role?: string; content?: string } }>;
  content?: Array<{ type?: string; text?: string }>;
}

export class LlmHttpError extends Error {
  readonly failure: ApiFailure;
  readonly endpoint: string;

  constructor(failure: ApiFailure, endpoint: string) {
    super(failure.message);
    this.name = 'LlmHttpError';
    this.failure = failure;
    this.endpoint = endpoint;
  }
}

function describeResolveError(err: NonNullable<ResolvedEndpoints['error']>): ApiFailure {
  if (err === 'empty') {
    return { message: 'Base URL is empty', status: 0, hint: 'notFound' };
  }
  if (err === 'insecure') {
    return {
      message:
        'Remote Base URL must use https:// (http:// is only allowed for localhost, 127.0.0.1, or [::1])',
      status: 0,
      hint: 'unreachable',
    };
  }
  return { message: 'Base URL is not a valid URL', status: 0, hint: 'notFound' };
}

export async function byokLlmChat(
  config: AIConfig,
  prompt: string,
  isTest = false,
  fetchImpl: typeof fetch = fetch,
): Promise<{ content: string }> {
  const { base, chatUrl: endpoint, error: resolveError } = resolveEndpoints(config.baseUrl);
  if (resolveError) {
    throw new LlmHttpError(describeResolveError(resolveError), '');
  }

  const apiKey = (config.apiKey ?? '').trim();
  const isLocal = isLocalLoopbackEndpoint(base);
  if (!apiKey && !isLocal) {
    throw new LlmHttpError(
      {
        message: 'API key is required for remote endpoints',
        status: 401,
        hint: 'invalidKey',
      },
      endpoint,
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const send = (body: Record<string, unknown>) =>
    fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

  const baseBody = {
    model: config.model.trim(),
    messages: [{ role: 'user', content: prompt }],
  };
  const cap = isTest ? { max_completion_tokens: 32 } : {};
  const json = { response_format: { type: 'json_object' } };

  const seen = new Set<string>();
  const attempts = [
    { ...baseBody, temperature: 0.25, ...json, ...cap },
    { ...baseBody, ...json, ...cap },
    { ...baseBody, ...json },
    { ...baseBody },
  ].filter((body) => {
    const key = JSON.stringify(body);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let resp: Response | null = null;
  for (const body of attempts) {
    resp = await send(body);
    if (resp.status !== 400) break;
  }
  if (!resp) throw new Error('No request was attempted');

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new LlmHttpError(describeHttpFailure(resp.status, resp.statusText, body), endpoint);
  }

  const data = (await resp.json()) as ChatResponse;
  const content =
    data.choices?.[0]?.message?.content ??
    data.content?.[0]?.text ??
    '';
  return { content };
}

export async function byokListModels(
  config: AIConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelsResult> {
  const { base, modelsUrl, error: resolveError } = resolveEndpoints(config.baseUrl);
  if (resolveError) {
    const failure = describeResolveError(resolveError);
    return {
      ok: false,
      error: failure.message,
      hint: failure.hint,
    };
  }

  const apiKey = (config.apiKey ?? '').trim();
  if (!apiKey && !isLocalLoopbackEndpoint(base)) {
    return {
      ok: false,
      error: 'API key is required for remote endpoints',
      status: 401,
      hint: 'invalidKey',
      endpoint: modelsUrl,
    };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const resp = await fetchImpl(modelsUrl, { method: 'GET', headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const failure = describeHttpFailure(resp.status, resp.statusText, body);
      return {
        ok: false,
        error: failure.message,
        status: failure.status,
        hint: failure.hint,
        endpoint: modelsUrl,
      };
    }

    const data = (await resp.json()) as {
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const raw: Array<{ id?: string; name?: string }> = data.data ?? data.models ?? [];
    const models = raw
      .map((m) => m?.id ?? m?.name)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort((a, b) => a.localeCompare(b));

    return { ok: true, models, endpoint: modelsUrl };
  } catch (e) {
    const failure = describeFetchFailure(e);
    return {
      ok: false,
      error: failure.message,
      status: failure.status,
      hint: failure.hint,
      endpoint: modelsUrl,
    };
  }
}

export async function byokTestConnection(
  config: AIConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionCheckResult> {
  const { chatUrl } = resolveEndpoints(config.baseUrl);
  const startedAt = Date.now();
  try {
    await byokLlmChat(config, 'Return JSON: {"ok": true}', true, fetchImpl);
    return { ok: true, endpoint: chatUrl, elapsedMs: Date.now() - startedAt };
  } catch (e) {
    if (e instanceof LlmHttpError) {
      return {
        ok: false,
        error: e.failure.message,
        status: e.failure.status,
        hint: e.failure.hint,
        endpoint: e.endpoint || chatUrl,
        elapsedMs: Date.now() - startedAt,
      };
    }
    const failure = describeFetchFailure(e);
    return {
      ok: false,
      error: failure.message,
      status: failure.status,
      hint: failure.hint,
      endpoint: chatUrl,
      elapsedMs: Date.now() - startedAt,
    };
  }
}
