/**
 * OpenAI-compatible BYOK & Local Loopback (Ollama / LM Studio) LLM client,
 * with Multimodal Vision (`image_url`) + automatic text-only fallback when an
 * upstream text-only model rejects image inputs with HTTP 400 / 415 / 422.
 *
 * - Remote endpoints MUST use `https://` and provide a non-empty API key.
 * - Local loopback endpoints (`localhost`, `127.0.0.1`, `[::1]`) may use `http://`
 *   and do NOT require an API key (`Authorization` header is omitted when empty,
 *   or sent as `Bearer <key>` when provided).
 */

import type { AIConfig } from '../types';
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

export interface RequestChatCompletionOptions {
  systemPrompt?: string;
  imageDataUrl?: string;
  isTest?: boolean;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletionResult {
  content: string;
  usedVision: boolean;
}

const VISION_REJECT_STATUSES = new Set([400, 415, 422]);

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

function buildTextAttempts(
  model: string,
  messages: Array<Record<string, unknown>>,
  isTest: boolean,
): Array<Record<string, unknown>> {
  const baseBody = { model, messages };
  const cap = isTest ? { max_completion_tokens: 32 } : {};
  const json = { response_format: { type: 'json_object' } };

  const seen = new Set<string>();
  return [
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
}

export async function requestChatCompletion(
  config: AIConfig,
  userPrompt: string,
  options: RequestChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const isTest = Boolean(options.isTest);
  const imageDataUrl = (options.imageDataUrl ?? '').trim();

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

  const model = config.model.trim();
  const sysPrefix: Array<Record<string, unknown>> = options.systemPrompt?.trim()
    ? [{ role: 'system', content: options.systemPrompt.trim() }]
    : [];

  // 1. If a cropped element screenshot is provided, attempt OpenAI multimodal format first.
  //    If the upstream model is text-only and rejects `image_url` with HTTP 400/415/422,
  //    automatically retry ONCE with plain string `content: userPrompt` so generation never fails!
  if (imageDataUrl) {
    const multimodalMessages: Array<Record<string, unknown>> = [
      ...sysPrefix,
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: { url: imageDataUrl, detail: 'low' },
          },
        ],
      },
    ];

    const visionResp = await send({
      model,
      messages: multimodalMessages,
      temperature: 0.25,
      ...(isTest ? { max_completion_tokens: 32 } : {}),
    });

    if (visionResp.ok) {
      const data = (await visionResp.json()) as ChatResponse;
      const content =
        data.choices?.[0]?.message?.content ?? data.content?.[0]?.text ?? '';
      return { content, usedVision: true };
    }

    if (!VISION_REJECT_STATUSES.has(visionResp.status)) {
      const errBody = await visionResp.text().catch(() => '');
      throw new LlmHttpError(
        describeHttpFailure(visionResp.status, visionResp.statusText, errBody),
        endpoint,
      );
    }

    // Drain body cleanly and retry once with plain string `content: userPrompt`
    await visionResp.text().catch(() => '');
    const fallbackResp = await send({
      model,
      messages: [...sysPrefix, { role: 'user', content: userPrompt }],
      temperature: 0.25,
      ...(isTest ? { max_completion_tokens: 32 } : {}),
    });

    if (!fallbackResp.ok) {
      const errBody = await fallbackResp.text().catch(() => '');
      throw new LlmHttpError(
        describeHttpFailure(fallbackResp.status, fallbackResp.statusText, errBody),
        endpoint,
      );
    }

    const fallbackData = (await fallbackResp.json()) as ChatResponse;
    const fallbackContent =
      fallbackData.choices?.[0]?.message?.content ??
      fallbackData.content?.[0]?.text ??
      '';
    return { content: fallbackContent, usedVision: false };
  }

  // 2. Standard text-only flow with response_format compatibility fallback
  const textMessages: Array<Record<string, unknown>> = [
    ...sysPrefix,
    { role: 'user', content: userPrompt },
  ];
  const attempts = buildTextAttempts(model, textMessages, isTest);

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
  return { content, usedVision: false };
}

export async function byokLlmChat(
  config: AIConfig,
  prompt: string,
  isTest = false,
  fetchImpl: typeof fetch = fetch,
  imageDataUrl?: string,
): Promise<ChatCompletionResult> {
  return requestChatCompletion(config, prompt, {
    isTest,
    fetchImpl,
    imageDataUrl,
  });
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
