import { useState, useEffect, useRef, useCallback } from 'react';
import type { AIMode, AppSettings } from '~/lib/types';
import type { McpBridgeStatus } from '~/lib/mcp/types';
import type { UserScriptsAvailability } from '~/lib/userscripts/types';
import type {
  ApiFailureHint,
  ConnectionCheckResult,
  ModelsResult,
} from '~/lib/shared/ai-error';
import {
  AI_PROVIDER_PRESETS,
  isLocalLoopbackEndpoint,
  LM_STUDIO_DEFAULT_BASE_URL,
  normalizeBaseUrl,
  OLLAMA_DEFAULT_BASE_URL,
  resolveEndpoints,
  type AiProviderPreset,
} from '~/lib/shared/ai-endpoints';
import { probeBuiltinAi, type BuiltinAiStatus } from '~/lib/shared/builtin-ai';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { SegmentedControl } from '../components/ui/segmented';
import {
  Check,
  Copy,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  Eye,
  EyeOff,
  Terminal,
} from 'lucide-react';
import { cn } from '~/lib/utils';
import { recheckOrRecoverJsPermission } from '../utils';
import type { Lang } from '../i18n';
import type { Theme } from '../hooks/useTheme';

interface Props {
  settings: AppSettings;
  availability: UserScriptsAvailability | null;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onRecheckAvailability: () => Promise<UserScriptsAvailability>;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  lang: Lang;
  onSetLang: (l: Lang) => void;
  onToast: (msg: string) => void;
  t: (k: string) => string;
}

const HINT_KEYS: Record<ApiFailureHint, string> = {
  invalidKey: 'hintInvalidKey',
  forbidden: 'hintForbidden',
  notFound: 'hintNotFound',
  rateLimited: 'hintRateLimited',
  serverError: 'hintServerError',
  unreachable: 'hintUnreachable',
};

const OLLAMA_SERVE_CMD = 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve';

function isValidLoopbackWsUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:') return false;
    const h = parsed.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
  } catch {
    return false;
  }
}

const MCP_CLI_SCRIPT_PATH = '/path/to/pagecraft/packages/mcp/src/cli.ts';

function buildMcpConfigJson(wsUrl: string, token: string): string {
  const portMatch = /:(\d+)(?:\/|$)/.exec(wsUrl.trim());
  const port = portMatch?.[1] && portMatch[1] !== '17321' ? portMatch[1] : undefined;
  const env: Record<string, string> = {};
  if (port) env.PAGECRAFT_MCP_PORT = port;
  if (token.trim()) env.PAGECRAFT_MCP_TOKEN = token.trim();

  const serverConfig: Record<string, unknown> = {
    command: 'node',
    args: ['--experimental-strip-types', MCP_CLI_SCRIPT_PATH],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };

  return JSON.stringify({ mcpServers: { pagecraft: serverConfig } }, null, 2);
}

function buildClaudeCodeCliCommand(wsUrl: string, token: string): string {
  const portMatch = /:(\d+)(?:\/|$)/.exec(wsUrl.trim());
  const port = portMatch?.[1] && portMatch[1] !== '17321' ? portMatch[1] : undefined;
  const envFlags: string[] = [];
  if (port) envFlags.push(`-e PAGECRAFT_MCP_PORT=${port}`);
  if (token.trim()) envFlags.push(`-e PAGECRAFT_MCP_TOKEN=${token.trim()}`);
  const envPart = envFlags.length > 0 ? ` ${envFlags.join(' ')}` : '';
  return `claude mcp add pagecraft${envPart} -- node --experimental-strip-types ${MCP_CLI_SCRIPT_PATH}`;
}

function matchesPreset(currentBaseUrl: string, preset: AiProviderPreset): boolean {
  const normalized = normalizeBaseUrl(currentBaseUrl).toLowerCase();
  if (!normalized) return false;
  if (preset.id === 'ollama') {
    return (
      normalized === OLLAMA_DEFAULT_BASE_URL ||
      normalized === 'http://127.0.0.1:11434/v1' ||
      normalized === 'http://[::1]:11434/v1'
    );
  }
  if (preset.id === 'lmstudio') {
    return (
      normalized === LM_STUDIO_DEFAULT_BASE_URL ||
      normalized === 'http://127.0.0.1:1234/v1' ||
      normalized === 'http://[::1]:1234/v1'
    );
  }
  try {
    return normalized.includes(new URL(preset.baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function ProviderMark({ id }: { id: string }) {
  switch (id) {
    case 'ollama':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#161514] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <rect x="4" y="3" width="8" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="6.5" cy="7" r="0.9" fill="currentColor" />
            <circle cx="9.5" cy="7" r="0.9" fill="currentColor" />
          </svg>
        </span>
      );
    case 'lmstudio':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#059669] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <path d="M3.5 11.5V4.5L8 8.5L12.5 4.5V11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case 'deepseek':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#2563EB] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <path d="M3 9.5C4.5 6 8.5 5 12.5 6.8C11.2 10.5 7.2 12 3 9.5Z" fill="currentColor" />
          </svg>
        </span>
      );
    case 'openai':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#10A37F] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="4.3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 3.7V12.3M4.2 5.8L11.8 10.2M11.8 5.8L4.2 10.2" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </span>
      );
    case 'anthropic':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#D97757] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <path d="M6.2 3.8L3.2 12.2H5L6.9 6.6L8.8 12.2H10.5L7.5 3.8H6.2ZM10.4 3.8L12.8 12.2H11.2L8.9 3.8H10.4Z" fill="currentColor" />
          </svg>
        </span>
      );
    case 'openrouter':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#475569] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <path d="M3 8H7.5L11 5M7.5 8L11 11M12.5 5H11M12.5 11H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case 'siliconflow':
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-[#0284C7] text-[#FAF8F5] shrink-0">
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
            <path d="M3.5 6C5.5 4 10.5 4 12.5 6M3.5 10C5.5 8 10.5 8 12.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      );
    default:
      return (
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-secondary text-foreground font-mono text-[9px] font-bold shrink-0">
          /v1
        </span>
      );
  }
}

const ORDERED_PRESET_IDS = [
  'ollama',
  'lmstudio',
  'deepseek',
  'openai',
  'anthropic',
  'openrouter',
  'siliconflow',
];

export default function SettingsPage({
  settings,
  availability,
  onSaveSettings,
  onRecheckAvailability,
  theme,
  onSetTheme,
  lang,
  onSetLang,
  onToast,
  t,
}: Props) {
  const [s, setS] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [keyGuideOpen, setKeyGuideOpen] = useState(false);

  const [builtinStatus, setBuiltinStatus] = useState<BuiltinAiStatus | 'checking'>('checking');
  const [builtinReason, setBuiltinReason] = useState<string | undefined>(undefined);

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [testHint, setTestHint] = useState<ApiFailureHint | null>(null);
  const [testElapsed, setTestElapsed] = useState(0);

  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [copiedOllamaCmd, setCopiedOllamaCmd] = useState(false);
  const [copiedMcpJson, setCopiedMcpJson] = useState(false);
  const [copiedMcpCli, setCopiedMcpCli] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpBridgeStatus | null>(null);
  const [reconnectingMcp, setReconnectingMcp] = useState(false);
  const baseUrlInputRef = useRef<HTMLInputElement | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedEndpoint = resolveEndpoints(s.ai.baseUrl);
  const isLocalAi = isLocalLoopbackEndpoint(s.ai.baseUrl);
  const activePreset = AI_PROVIDER_PRESETS.find((p) => matchesPreset(s.ai.baseUrl, p));
  const mcpUrlValid = isValidLoopbackWsUrl(s.mcpBridgeUrl);
  const mcpConfigJson = buildMcpConfigJson(s.mcpBridgeUrl, s.mcpBridgeToken);
  const mcpCliCmd = buildClaudeCodeCliCommand(s.mcpBridgeUrl, s.mcpBridgeToken);

  const orderedPresets = ORDERED_PRESET_IDS.map((id) =>
    AI_PROVIDER_PRESETS.find((p) => p.id === id),
  ).filter((p): p is AiProviderPreset => Boolean(p));

  const checkBuiltinStatus = useCallback(async () => {
    setBuiltinStatus('checking');
    try {
      const res = await probeBuiltinAi();
      setBuiltinStatus(res.status);
      setBuiltinReason(res.reason);
    } catch {
      setBuiltinStatus('unavailable');
    }
  }, []);

  const refreshMcpStatus = useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      const status = (await chrome.runtime.sendMessage({
        type: 'MCP_BRIDGE_STATUS',
      })) as McpBridgeStatus | undefined;
      if (status) setMcpStatus(status);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setS(settings);
  }, [settings]);

  useEffect(() => {
    void checkBuiltinStatus();
  }, [checkBuiltinStatus]);

  useEffect(() => {
    void refreshMcpStatus();
  }, [refreshMcpStatus, settings.mcpBridgeEnabled, settings.mcpBridgeUrl, settings.mcpBridgeToken]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const onMessage = (msg: { type?: string; payload?: unknown }) => {
      if (msg?.type === 'PAGECRAFT_MCP_STATUS_CHANGED' && msg.payload) {
        setMcpStatus(msg.payload as McpBridgeStatus);
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  async function handleReconnectMcp() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    setReconnectingMcp(true);
    try {
      if (autosaveRef.current) {
        clearTimeout(autosaveRef.current);
        autosaveRef.current = null;
        await onSaveSettings(s);
      }
      const status = (await chrome.runtime.sendMessage({
        type: 'MCP_BRIDGE_RECONNECT',
      })) as McpBridgeStatus | undefined;
      if (status) setMcpStatus(status);
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setReconnectingMcp(false), 350);
    }
  }

  function commitPatch(next: AppSettings) {
    setS(next);
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => {
      void onSaveSettings(next);
    }, 300);
  }

  async function handleTestConn() {
    if (resolvedEndpoint.error === 'insecure') {
      setTestStatus('error');
      setTestError(t('insecureRemoteUrlError'));
      setTestHint(null);
      return;
    }
    if (!isLocalAi && !s.ai.apiKey.trim()) {
      setTestStatus('error');
      setTestError(t('missingRemoteKeyError'));
      setTestHint(null);
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    setTestStatus('testing');
    setTestError('');
    setTestHint(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        payload: s.ai,
      })) as ConnectionCheckResult | undefined;

      if (res?.ok) {
        setTestStatus('ok');
        setTestElapsed(res.elapsedMs ?? 0);
        onToast(
          lang === 'zh'
            ? `连接正常（耗时 ${res.elapsedMs ?? 0} ms）`
            : `Connected (${res.elapsedMs ?? 0} ms)`,
        );
      } else {
        setTestStatus('error');
        setTestError(res?.error ?? 'Connection failed');
        setTestHint(res?.hint ?? null);
      }
    } catch (e) {
      setTestStatus('error');
      setTestError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleFetchModels() {
    if (resolvedEndpoint.error === 'insecure') {
      setTestStatus('error');
      setTestError(t('insecureRemoteUrlError'));
      setTestHint(null);
      return;
    }
    if (!isLocalAi && !s.ai.apiKey.trim()) {
      setTestStatus('error');
      setTestError(t('missingRemoteKeyError'));
      setTestHint(null);
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    setModelsStatus('loading');
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'LIST_MODELS',
        payload: s.ai,
      })) as ModelsResult | undefined;

      if (res?.ok && res.models && res.models.length > 0) {
        const next: AppSettings = {
          ...s,
          ai: { ...s.ai, availableModels: res.models },
        };
        setS(next);
        await onSaveSettings(next);
        setModelsStatus('ok');
        setModelsOpen(true);
      } else {
        setModelsStatus('error');
        if (res && !res.ok) {
          setTestError(res.error ?? 'Failed to fetch models');
          setTestHint(res.hint ?? null);
          setTestStatus('error');
        }
      }
    } catch {
      setModelsStatus('error');
    }
  }

  return (
    <div className="space-y-4 pb-6 pc-enter">
      {/* 1. AI Engine Sheet (flat divide-y, max 2 boxes deep) */}
      <section className="space-y-2">
        <h2 className="text-[13.5px] font-semibold text-foreground">
          {t('settingsEngineTitle')}
        </h2>

        <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          <div className="p-3.5 space-y-2.5">
            <SegmentedControl
              className="w-full"
              value={s.aiMode}
              onChange={(v: string) => commitPatch({ ...s, aiMode: v as AIMode })}
              items={[
                { id: 'byok', label: t('modeByok') },
                { id: 'builtin', label: t('modeBuiltin') },
              ]}
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {s.aiMode === 'builtin' ? t('builtinDesc') : t('byokDesc')}
            </p>
          </div>

          {s.aiMode === 'builtin' ? (
            <div className="px-3.5 py-3 bg-secondary/35 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      builtinStatus === 'available'
                        ? 'bg-emerald-500'
                        : builtinStatus === 'downloadable'
                          ? 'bg-amber-500'
                          : 'bg-muted-foreground/60',
                    )}
                  />
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {builtinStatus === 'checking'
                      ? lang === 'zh'
                        ? '正在检测内置模型…'
                        : 'Checking on-device model…'
                      : builtinStatus === 'available'
                        ? t('builtinStatusAvailable')
                        : builtinStatus === 'downloadable'
                          ? t('builtinStatusDownloadable')
                          : t('builtinStatusUnavailable')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void checkBuiltinStatus()}
                  className="pc-btn inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                >
                  <RefreshCw
                    className={cn('h-3 w-3', builtinStatus === 'checking' && 'animate-spin')}
                  />
                  <span>{lang === 'zh' ? '重检' : 'Re-check'}</span>
                </button>
              </div>

              {builtinStatus !== 'available' && builtinStatus !== 'checking' && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('builtinSetupHint')}
                  {builtinReason ? ` (${builtinReason})` : ''}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Authentic Provider Marks & Monospace Chips */}
              <div className="px-3.5 py-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {orderedPresets.map((p) => {
                    const active = activePreset?.id === p.id;
                    const presetLabel =
                      p.id === 'siliconflow'
                        ? 'SiliconFlow'
                        : p.labelKey
                          ? t(p.labelKey)
                          : p.label;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setTestStatus('idle');
                          setTestError('');
                          commitPatch({
                            ...s,
                            ai: { ...s.ai, baseUrl: p.baseUrl, model: p.model },
                          });
                        }}
                        className={cn(
                          'pc-btn inline-flex items-center gap-1.5 h-7 px-2 rounded-[6px] text-xs font-medium border cursor-pointer',
                          active
                            ? 'bg-[var(--pc-accent-subtle)] text-[var(--pc-accent-ink)] border-primary/40'
                            : 'bg-background hover:bg-secondary text-foreground border-border',
                        )}
                      >
                        <ProviderMark id={p.id} />
                        <span>{presetLabel}</span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      baseUrlInputRef.current?.focus();
                      baseUrlInputRef.current?.select();
                    }}
                    className={cn(
                      'pc-btn inline-flex items-center gap-1.5 h-7 px-2 rounded-[6px] text-xs font-medium border cursor-pointer',
                      !activePreset
                        ? 'bg-[var(--pc-accent-subtle)] text-[var(--pc-accent-ink)] border-primary/40'
                        : 'bg-background hover:bg-secondary text-foreground border-border',
                    )}
                  >
                    <ProviderMark id="custom" />
                    <span>{t('presetCustom')}</span>
                  </button>
                </div>
              </div>

              {/* Local Loopback Ollama CORS Command Bar (flat row, zero triple boxes) */}
              {isLocalAi && (
                <div className="px-3.5 py-2.5 bg-emerald-500/[0.06] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-emerald-800 dark:text-emerald-300">
                      {t('ollamaCorsTitle')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(OLLAMA_SERVE_CMD).catch(() => {});
                        setCopiedOllamaCmd(true);
                        onToast(t('ollamaCorsCopied'));
                        setTimeout(() => setCopiedOllamaCmd(false), 1800);
                      }}
                      className="pc-btn inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer shrink-0"
                    >
                      {copiedOllamaCmd ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{t('ollamaCorsCopy')}</span>
                    </button>
                  </div>
                  <p className="text-muted-foreground leading-snug">{t('ollamaCorsDesc')}</p>
                  <code className="block rounded-[6px] bg-[var(--pc-terminal-bg)] text-[var(--pc-terminal-ink)] px-2.5 py-1.5 font-mono text-[11px] overflow-x-auto select-all">
                    {OLLAMA_SERVE_CMD}
                  </code>
                </div>
              )}

              {/* Endpoint, Key, Model & Test Row */}
              <div className="p-3.5 space-y-2.5">
                <div className="space-y-1">
                  <label htmlFor="pc-base-url" className="text-xs font-medium text-muted-foreground">
                    Base URL
                  </label>
                  <Input
                    ref={baseUrlInputRef}
                    id="pc-base-url"
                    value={s.ai.baseUrl}
                    onChange={(e) => {
                      setTestStatus('idle');
                      setTestError('');
                      commitPatch({ ...s, ai: { ...s.ai, baseUrl: e.target.value } });
                    }}
                    placeholder="https://api.deepseek.com/v1"
                    className="font-mono text-xs tabular-nums"
                  />
                  {resolvedEndpoint.error === 'insecure' && (
                    <p className="text-xs text-destructive leading-snug">
                      {t('insecureRemoteUrlError')}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="pc-api-key" className="text-xs font-medium text-muted-foreground shrink-0 whitespace-nowrap">
                      API Key
                    </label>
                    {isLocalAi ? (
                      <Badge variant="success">{t('apiKeyOptionalBadge')}</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setKeyGuideOpen((o) => !o)}
                        className="pc-focus inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer"
                      >
                        <span>{t('keyGuideToggle')}</span>
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 transition-transform duration-150',
                            keyGuideOpen && 'rotate-180',
                          )}
                        />
                      </button>
                    )}
                  </div>

                  {keyGuideOpen && !isLocalAi && (
                    <ol className="list-decimal list-inside py-1.5 space-y-1 text-xs text-muted-foreground leading-relaxed">
                      <li>{t('keyGuideStep1')}</li>
                      <li>{t('keyGuideStep2')}</li>
                      <li>{t('keyGuideStep3')}</li>
                    </ol>
                  )}

                  <div className="relative">
                    <Input
                      id="pc-api-key"
                      type={showKey ? 'text' : 'password'}
                      value={s.ai.apiKey}
                      onChange={(e) =>
                        commitPatch({ ...s, ai: { ...s.ai, apiKey: e.target.value } })
                      }
                      placeholder={isLocalAi ? t('apiKeyLocalPlaceholder') : 'sk-...'}
                      className="font-mono text-xs pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={
                        showKey
                          ? lang === 'zh'
                            ? '隐藏 API Key'
                            : 'Hide API key'
                          : lang === 'zh'
                            ? '显示 API Key'
                            : 'Show API key'
                      }
                      className="pc-focus absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-[4px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showKey ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1 relative">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="pc-model" className="text-xs font-medium text-muted-foreground">
                      {lang === 'zh' ? '模型 ID' : 'Model'}
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleFetchModels()}
                      className="pc-focus text-xs font-medium text-primary hover:underline cursor-pointer"
                    >
                      {modelsStatus === 'loading'
                        ? lang === 'zh'
                          ? '正在读取…'
                          : 'Loading…'
                        : lang === 'zh'
                          ? '拉取模型列表'
                          : 'Fetch models'}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="pc-model"
                      value={s.ai.model}
                      onChange={(e) =>
                        commitPatch({ ...s, ai: { ...s.ai, model: e.target.value } })
                      }
                      placeholder="deepseek-chat"
                      className="font-mono text-xs"
                    />
                    {s.ai.availableModels && s.ai.availableModels.length > 0 && (
                      <Button
                        size="icon"
                        variant="secondary"
                        type="button"
                        onClick={() => setModelsOpen((o) => !o)}
                        aria-label="Toggle model list"
                        className="shrink-0 h-8 w-8"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  {modelsOpen && s.ai.availableModels && s.ai.availableModels.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-[6px] border border-border bg-card p-1 shadow-sm space-y-0.5">
                      {s.ai.availableModels.slice(0, 80).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            commitPatch({ ...s, ai: { ...s.ai, model: m } });
                            setModelsOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 rounded-[4px] text-xs font-mono hover:bg-secondary truncate cursor-pointer"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-0.5 flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={testStatus === 'testing'}
                    onClick={() => void handleTestConn()}
                    className="tabular-nums"
                  >
                    {testStatus === 'testing' ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : testStatus === 'ok' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : null}
                    <span>
                      {lang === 'zh' ? '测试连通性' : 'Test connection'}
                      {testStatus === 'ok' && testElapsed > 0 ? ` (${testElapsed} ms)` : ''}
                    </span>
                  </Button>
                </div>

                {testStatus === 'error' && testError && (
                  <div className="pt-1 text-xs space-y-1">
                    <div className="flex items-start gap-1.5 text-destructive font-medium">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="break-words">{testError}</span>
                    </div>
                    {testHint && (
                      <p className="text-muted-foreground pl-5 leading-relaxed">
                        {isLocalAi && testHint === 'forbidden'
                          ? t('hintLocalForbidden')
                          : t(HINT_KEYS[testHint])}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 2. Agent Capabilities Sheet (Vision & Auto-Heal) */}
      <section className="space-y-2">
        <h2 className="text-[13.5px] font-semibold text-foreground">
          {t('capabilitiesTitle')}
        </h2>

        <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          <label className="pc-row px-3.5 py-3 flex items-start justify-between gap-3 cursor-pointer">
            <div className="space-y-0.5 min-w-0">
              <div className="text-[13px] font-medium text-foreground">
                {t('visionToggleLabel')}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('visionToggleDesc')}
              </p>
            </div>
            <Switch
              checked={s.enableVisionCapture}
              onCheckedChange={(checked) =>
                commitPatch({ ...s, enableVisionCapture: checked })
              }
            />
          </label>

          <label className="pc-row px-3.5 py-3 flex items-start justify-between gap-3 cursor-pointer">
            <div className="space-y-0.5 min-w-0">
              <div className="text-[13px] font-medium text-foreground">
                {t('autoHealToggleLabel')}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('autoHealToggleDesc')}
              </p>
            </div>
            <Switch
              checked={s.enableAutoHeal}
              onCheckedChange={(checked) => commitPatch({ ...s, enableAutoHeal: checked })}
            />
          </label>
        </div>
      </section>

      {/* 3. Terminal-Grade `pagecraft-mcp` Configuration Card */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13.5px] font-semibold text-foreground truncate">
            {t('mcpTitle')}
          </h2>
          <Badge variant="outline" className="font-mono shrink-0">
            127.0.0.1
          </Badge>
        </div>

        <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          {/* Status & Switch Header */}
          <div className="px-3.5 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    !s.mcpBridgeEnabled
                      ? 'bg-muted-foreground/60'
                      : mcpStatus?.connected
                        ? 'bg-emerald-500'
                        : 'bg-amber-500',
                  )}
                />
                <span className="text-[13px] font-medium text-foreground truncate">
                  {!s.mcpBridgeEnabled
                    ? t('mcpStatusOff')
                    : mcpStatus?.connected
                      ? t('mcpStatusConnected')
                      : t('mcpStatusWaiting')}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {s.mcpBridgeEnabled && (
                  <button
                    type="button"
                    onClick={() => void handleReconnectMcp()}
                    className="pc-btn inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <RefreshCw
                      className={cn('h-3 w-3', reconnectingMcp && 'animate-spin')}
                    />
                    <span>{t('mcpReconnectBtn')}</span>
                  </button>
                )}
                <Switch
                  checked={s.mcpBridgeEnabled}
                  onCheckedChange={(checked) => commitPatch({ ...s, mcpBridgeEnabled: checked })}
                  aria-label={t('mcpEnableLabel')}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">{t('mcpDesc')}</p>

            {s.mcpBridgeEnabled && !mcpStatus?.connected && mcpStatus?.lastError && (
              <p className="text-[11px] font-mono text-muted-foreground leading-snug break-words">
                {mcpStatus.lastError}
              </p>
            )}
          </div>

          {/* Loopback Endpoint & Auth Token */}
          <div className="p-3.5 space-y-2.5">
            <div className="space-y-1">
              <label htmlFor="pc-mcp-url" className="text-xs font-medium text-muted-foreground">
                {t('mcpWsUrlLabel')}
              </label>
              <Input
                id="pc-mcp-url"
                value={s.mcpBridgeUrl}
                onChange={(e) => commitPatch({ ...s, mcpBridgeUrl: e.target.value })}
                placeholder="ws://127.0.0.1:17321"
                className="font-mono text-xs tabular-nums"
              />
              {!mcpUrlValid && (
                <p className="text-xs text-destructive leading-snug">{t('mcpLoopbackWarn')}</p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="pc-mcp-token" className="text-xs font-medium text-muted-foreground">
                {t('mcpTokenLabel')}
              </label>
              <Input
                id="pc-mcp-token"
                type="password"
                value={s.mcpBridgeToken}
                onChange={(e) => commitPatch({ ...s, mcpBridgeToken: e.target.value })}
                placeholder={t('mcpTokenPlaceholder')}
                className="font-mono text-xs"
              />
            </div>
          </div>

          {/* Flush Terminal-Grade Config Pane */}
          <div className="bg-[var(--pc-terminal-bg)] text-[var(--pc-terminal-ink)] min-w-0">
            <div className="px-3.5 py-2 border-b border-[var(--pc-terminal-border)] flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--pc-terminal-muted)]">
                <Terminal className="h-3 w-3 text-[#E06643]" />
                <span>pagecraft-mcp · mcp.json</span>
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(mcpConfigJson).catch(() => {});
                    setCopiedMcpJson(true);
                    onToast(t('mcpCopiedToast'));
                    setTimeout(() => setCopiedMcpJson(false), 1800);
                  }}
                  className="pc-btn inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border border-[var(--pc-terminal-border)] bg-[#211F1D] hover:bg-[#2B2926] text-[11px] font-medium text-[#F2EFE9] cursor-pointer"
                >
                  {copiedMcpJson ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span>{t('mcpCopyConfigBtn')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(mcpCliCmd).catch(() => {});
                    setCopiedMcpCli(true);
                    onToast(t('mcpCopiedToast'));
                    setTimeout(() => setCopiedMcpCli(false), 1800);
                  }}
                  className="pc-btn inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border border-[var(--pc-terminal-border)] bg-[#211F1D] hover:bg-[#2B2926] text-[11px] font-medium text-[#F2EFE9] cursor-pointer"
                >
                  {copiedMcpCli ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Terminal className="h-3 w-3" />
                  )}
                  <span>{t('mcpCopyCliBtn')}</span>
                </button>
              </div>
            </div>

            <pre className="m-0 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-[#F2EFE9] overflow-x-auto select-all">
              {mcpConfigJson}
            </pre>
          </div>
        </div>
      </section>

      {/* 4. Execution Runtime & Appearance */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13.5px] font-semibold text-foreground">{t('runtimeTitle')}</h2>
          <button
            type="button"
            onClick={() =>
              void recheckOrRecoverJsPermission({
                recheck: onRecheckAvailability,
                beforeReload: () =>
                  onToast(
                    lang === 'zh'
                      ? '已检测到授权，正在刷新引擎…'
                      : 'Permission detected. Reloading engine…',
                  ),
              })
            }
            className="pc-focus text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {lang === 'zh' ? '刷新状态' : 'Re-check'}
          </button>
        </div>

        <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          <div className="p-3.5 space-y-2 text-[12.5px]">
            <div className="flex items-center gap-2 text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span>{t('cssEngineReady')}</span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    availability?.available ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                <span className="text-foreground">
                  {availability?.available ? t('jsEngineReady') : t('jsEngineOff')}
                </span>
              </div>
              {!availability?.available && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                      chrome.runtime.sendMessage({ type: 'OPEN_EXTENSION_DETAILS' }).catch(() => {});
                    }
                  }}
                  className="pc-focus inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0 cursor-pointer"
                >
                  <span>{lang === 'zh' ? '开启' : 'Enable'}</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="p-3.5 space-y-2.5">
            <div className="text-xs font-medium text-muted-foreground">
              {t('appearanceTitle')}
            </div>
            <SegmentedControl
              className="w-full"
              value={theme}
              onChange={(v: string) => onSetTheme(v as Theme)}
              items={[
                { id: 'light', label: t('themeLight') },
                { id: 'dark', label: t('themeDark') },
                { id: 'system', label: t('themeSystem') },
              ]}
            />
            <SegmentedControl
              className="w-full"
              value={lang}
              onChange={(v: string) => onSetLang(v as Lang)}
              items={[
                { id: 'zh', label: '简体中文' },
                { id: 'en', label: 'English' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Zero-Backend Privacy Guarantee & Support */}
      <footer className="space-y-1.5 pt-1 text-xs text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p>{t('privacyNote')}</p>
        </div>
        <p className="pl-6">
          <a
            href="https://github.com/botshen/pagecraft"
            target="_blank"
            rel="noopener noreferrer"
            className="pc-focus text-foreground hover:text-primary hover:underline font-medium"
          >
            ★ GitHub
          </a>
          <span className="mx-1.5 opacity-50">·</span>
          {t('supportContactLabel')}
          <a
            href="https://github.com/botshen/pagecraft/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="pc-focus text-foreground hover:text-primary hover:underline"
          >
            GitHub Issues
          </a>
          <span className="mx-1.5 opacity-50">·</span>
          <a
            href="mailto:botzgbj@gmail.com"
            className="pc-focus text-foreground hover:text-primary hover:underline"
          >
            botzgbj@gmail.com
          </a>
        </p>
      </footer>
    </div>
  );
}
