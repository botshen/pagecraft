// Resolution of a user-entered AI base URL into concrete endpoints, plus
// curated provider & local-loopback presets.
//
// Users paste all sorts of things into "Base URL": `https://host/v1`, a URL with
// a trailing slash, `http://localhost:11434/v1` for local Ollama, `http://localhost:1234/v1`
// for LM Studio, or the full `https://host/v1/chat/completions` copied from docs.
// All resolve to a canonical API root here, enforcing `https://` for all remote
// hosts while permitting `http://` strictly on local loopback addresses.

/** Endpoint suffixes that are *not* part of the API root, stripped off the tail. */
const ENDPOINT_SUFFIXES = /\/(chat\/completions|completions|messages|responses|models)$/i;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_DEFAULT_MODEL = 'qwen2.5-coder:7b';

export const LM_STUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';
export const LM_STUDIO_DEFAULT_MODEL = 'qwen2.5-coder-7b-instruct';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-latest';

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'deepseek/deepseek-chat';

export interface AiProviderPreset {
  id: string;
  label: string;
  labelKey?: string;
  baseUrl: string;
  model: string;
  local?: boolean;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
    model: ANTHROPIC_DEFAULT_MODEL,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: OPENROUTER_DEFAULT_BASE_URL,
    model: OPENROUTER_DEFAULT_MODEL,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    labelKey: 'presetOllama',
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    model: OLLAMA_DEFAULT_MODEL,
    local: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    labelKey: 'presetLmStudio',
    baseUrl: LM_STUDIO_DEFAULT_BASE_URL,
    model: LM_STUDIO_DEFAULT_MODEL,
    local: true,
  },
] as const;

export interface ResolvedEndpoints {
  /** Normalized API root, e.g. `https://host/v1` or `http://localhost:11434/v1`. Empty when unusable. */
  base: string;
  /** Chat completions endpoint, or empty when the base could not be resolved. */
  chatUrl: string;
  /** Model listing endpoint, or empty when the base could not be resolved. */
  modelsUrl: string;
  /** Machine-readable reason the base could not be resolved. */
  error?: 'empty' | 'invalid' | 'insecure';
}

/**
 * Returns `true` strictly for `http:` or `https:` URLs targeting local loopback
 * (`localhost`, `127.0.0.1`, or `[::1]`) with no embedded credentials.
 */
export function isLocalLoopbackEndpoint(rawUrl: string): boolean {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return false;

  const hostMatch = /^https?:\/\/(\[::1\]|[^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(trimmed);
  const rawHost = hostMatch?.[1]?.toLowerCase();
  if (!rawHost || !LOOPBACK_HOSTNAMES.has(rawHost)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Normalize a user-entered base URL to an API root.
 *
 * Strips whitespace, query string, hash and trailing slashes, then peels off a
 * pasted endpoint suffix. Returns an empty string when nothing usable remains.
 */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';

  // A pasted URL may carry a query string or hash; neither belongs in the base.
  s = (s.split('#')[0] ?? '').split('?')[0]?.trim() ?? '';
  if (!s) return '';
  s = s.replace(/\/+$/, '');

  // `.../v1/chat/completions` -> `.../v1`
  let stripped = s.replace(ENDPOINT_SUFFIXES, '');
  stripped = stripped.replace(/\/+$/, '');

  // Never strip down to a bare origin if that would drop a real path segment
  // the user meant, e.g. a gateway mounted at `https://host/api`.
  return stripped || s;
}

/** Resolve a base URL into concrete endpoints, keeping remote hosts strictly `https://`. */
export function resolveEndpoints(raw: string): ResolvedEndpoints {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { base: '', chatUrl: '', modelsUrl: '', error: 'empty' };

  const base = normalizeBaseUrl(trimmed);

  try {
    const url = new URL(base);
    if (url.username || url.password) {
      return { base: '', chatUrl: '', modelsUrl: '', error: 'invalid' };
    }
    if (url.protocol === 'https:') {
      // Valid HTTPS endpoint (remote or local).
    } else if (url.protocol === 'http:') {
      if (!isLocalLoopbackEndpoint(base)) {
        return { base: '', chatUrl: '', modelsUrl: '', error: 'insecure' };
      }
    } else {
      return { base: '', chatUrl: '', modelsUrl: '', error: 'invalid' };
    }
  } catch {
    return { base: '', chatUrl: '', modelsUrl: '', error: 'invalid' };
  }

  return {
    base,
    chatUrl: `${base}/chat/completions`,
    modelsUrl: `${base}/models`,
  };
}
