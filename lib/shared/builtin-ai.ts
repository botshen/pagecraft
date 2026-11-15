/**
 * Chrome Built-in On-Device AI (`LanguageModel` / Gemini Nano) adapter.
 *
 * Supports both:
 * 1. Standard Chrome 138+ `globalThis.LanguageModel` (`availability()`, `create({ initialPrompts })`)
 * 2. Legacy Chrome 127-137 `globalThis.ai?.languageModel` (`capabilities()`, `create({ systemPrompt })`)
 *
 * Also supports one-hop `chrome.runtime.sendMessage` forwarding (`BUILTIN_AI_PROBE` /
 * `BUILTIN_AI_PROMPT`) when `LanguageModel` is exposed in an extension document
 * (`sidepanel`) rather than the MV3 Service Worker (or vice versa), with clean
 * dependency injection for deterministic unit testing.
 */

export type BuiltinAiStatus = 'available' | 'downloadable' | 'unavailable';

export interface BuiltinAiProbeResult {
  status: BuiltinAiStatus;
  reason?: string;
}

export interface BuiltinLanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

export interface ModernLanguageModelFactory {
  availability?: (options?: Record<string, unknown>) => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
  create: (options?: Record<string, unknown>) => Promise<BuiltinLanguageModelSession>;
}

export interface BuiltinAiGlobalShape {
  LanguageModel?: ModernLanguageModelFactory;
  ai?: {
    languageModel?: ModernLanguageModelFactory;
  };
}

export interface BuiltinAiDeps {
  /** Override `globalThis` for unit tests. */
  targetGlobal?: BuiltinAiGlobalShape;
  /** Whether to try forwarding over `chrome.runtime.sendMessage` when local global lacks API. */
  allowRuntimeForward?: boolean;
  /** Optional custom message sender for unit tests. */
  sendRuntimeMessage?: (msg: unknown) => Promise<unknown>;
}

interface ResolvedFactory {
  kind: 'modern' | 'legacy';
  factory: ModernLanguageModelFactory;
}

function resolveLocalFactory(target?: BuiltinAiGlobalShape): ResolvedFactory | null {
  const g = (target ?? (globalThis as unknown as BuiltinAiGlobalShape)) || {};
  if (g.LanguageModel && typeof g.LanguageModel.create === 'function') {
    return { kind: 'modern', factory: g.LanguageModel };
  }
  if (g.ai?.languageModel && typeof g.ai.languageModel.create === 'function') {
    return { kind: 'legacy', factory: g.ai.languageModel };
  }
  return null;
}

export function hasLocalBuiltinAiGlobal(target?: BuiltinAiGlobalShape): boolean {
  return resolveLocalFactory(target) !== null;
}

function mapRawAvailability(raw: unknown): BuiltinAiProbeResult {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (normalized === 'available' || normalized === 'readily') {
    return { status: 'available' };
  }
  if (
    normalized === 'downloadable' ||
    normalized === 'downloading' ||
    normalized === 'after-download'
  ) {
    return { status: 'downloadable', reason: normalized };
  }
  if (normalized === 'unavailable' || normalized === 'no') {
    return { status: 'unavailable', reason: normalized };
  }
  return { status: 'unavailable', reason: normalized || 'unknown_status' };
}

function defaultRuntimeSend(msg: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return Promise.resolve(undefined);
  }
  return (chrome.runtime.sendMessage(msg) as Promise<unknown>).catch(() => undefined);
}

/**
 * Probes whether Chrome's Built-in Prompt API (Gemini Nano) is ready on-device.
 */
export async function probeBuiltinAi(deps: BuiltinAiDeps = {}): Promise<BuiltinAiProbeResult> {
  const resolved = resolveLocalFactory(deps.targetGlobal);
  if (resolved) {
    try {
      if (typeof resolved.factory.availability === 'function') {
        const raw = await resolved.factory.availability();
        return mapRawAvailability(raw);
      }
      if (typeof resolved.factory.capabilities === 'function') {
        const caps = await resolved.factory.capabilities();
        return mapRawAvailability(caps?.available);
      }
      // Factory has `.create` without explicit capability probe
      return { status: 'available' };
    } catch (e) {
      return {
        status: 'unavailable',
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const allowForward = deps.allowRuntimeForward ?? true;
  if (allowForward) {
    const send = deps.sendRuntimeMessage ?? defaultRuntimeSend;
    const forwarded = (await send({
      type: 'BUILTIN_AI_PROBE',
      payload: { forwarded: true },
    })) as BuiltinAiProbeResult | undefined;
    if (
      forwarded &&
      (forwarded.status === 'available' ||
        forwarded.status === 'downloadable' ||
        forwarded.status === 'unavailable')
    ) {
      return forwarded;
    }
  }

  return { status: 'unavailable', reason: 'api_not_supported' };
}

/**
 * Generates text using Chrome's Built-in On-Device `LanguageModel` (Gemini Nano),
 * automatically cleaning up the session afterwards.
 */
export async function generateWithBuiltinAi(
  systemPrompt: string,
  userPrompt: string,
  deps: BuiltinAiDeps = {},
): Promise<string> {
  const resolved = resolveLocalFactory(deps.targetGlobal);
  if (resolved) {
    const probe = await probeBuiltinAi({ ...deps, allowRuntimeForward: false });
    if (probe.status === 'unavailable') {
      throw new Error(
        `Chrome Built-in AI is unavailable (${probe.reason ?? 'disabled'}). Enable Prompt API for Gemini Nano in chrome://flags or switch to BYOK / Local Ollama.`,
      );
    }

    let session: BuiltinLanguageModelSession | null = null;
    try {
      const sys = systemPrompt.trim();
      if (resolved.kind === 'modern') {
        try {
          session = await resolved.factory.create(
            sys ? { initialPrompts: [{ role: 'system', content: sys }] } : undefined,
          );
        } catch {
          // Fallback if a transitional build expects `systemPrompt` instead of `initialPrompts`
          session = await resolved.factory.create(sys ? { systemPrompt: sys } : undefined);
        }
      } else {
        session = await resolved.factory.create(sys ? { systemPrompt: sys } : undefined);
      }

      const output = await session.prompt(userPrompt);
      return typeof output === 'string' ? output : String(output ?? '');
    } finally {
      try {
        session?.destroy?.();
      } catch {
        /* ignore session teardown errors */
      }
    }
  }

  const allowForward = deps.allowRuntimeForward ?? true;
  if (allowForward) {
    const send = deps.sendRuntimeMessage ?? defaultRuntimeSend;
    const res = (await send({
      type: 'BUILTIN_AI_PROMPT',
      payload: { systemPrompt, userPrompt, forwarded: true },
    })) as { ok?: boolean; content?: string; error?: string } | undefined;

    if (res?.ok && typeof res.content === 'string') {
      return res.content;
    }
    if (res?.error) {
      throw new Error(res.error);
    }
  }

  throw new Error(
    'Chrome Built-in AI (Gemini Nano) is not available in this browser context. Enable #prompt-api-for-gemini-nano in chrome://flags or use BYOK / Local Ollama.',
  );
}
