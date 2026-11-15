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
  HelpCircle,
  Terminal,
  Cpu,
  PlugZap,
  Sparkles,
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

const MCP_CLI_SCRIPT_PATH = '/path/to/plugin-radar/packages/mcp/src/cli.ts';

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
            ? `连接可用（响应耗时 ${res.elapsedMs ?? 0} ms）`
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
    <div className="pb-6">
      <div className="divide-y divide-border/70 rounded-xl border border-border bg-card overflow-hidden">
        {/* 1. AI Generation Engine (BYOK / Local API vs Chrome Built-in Gemini Nano) */}
        <section className="p-4 space-y-3.5">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-4 w-4 text-primary shrink-0" />
            <h2 className="text-[14px] font-semibold text-foreground">
              {t('settingsEngineTitle')}
            </h2>
          </div>

          <SegmentedControl
            className="w-full [&>.cds-seg-item]:flex-1 [&>.cds-seg-item]:justify-center"
            value={s.aiMode}
            onChange={(v: string) => commitPatch({ ...s, aiMode: v as AIMode })}
            items={[
              { id: 'byok', label: t('modeByok') },
              { id: 'builtin', label: t('modeBuiltin') },
            ]}
          />

          {s.aiMode === 'builtin' ? (
            <div className="space-y-3 pt-1">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {t('builtinDesc')}
              </p>

              <div className="rounded-lg border border-border/80 bg-secondary/45 p-3 space-y-2">
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
                    <span className="text-[13px] font-medium text-foreground">
                      {builtinStatus === 'checking'
                        ? lang === 'zh'
                          ? '正在检测内置模型状态…'
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
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                  >
                    <RefreshCw
                      className={cn('h-3.5 w-3.5', builtinStatus === 'checking' && 'animate-spin')}
                    />
                    <span>{lang === 'zh' ? '重新检测' : 'Re-check'}</span>
                  </button>
                </div>

                {builtinStatus !== 'available' && builtinStatus !== 'checking' && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t('builtinSetupHint')}
                    {builtinReason ? ` (${builtinReason})` : ''}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  {t('byokDesc')}
                </p>
                <button
                  type="button"
                  onClick={() => setKeyGuideOpen((o) => !o)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  <span>{t('keyGuideToggle')}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      keyGuideOpen && 'rotate-180',
                    )}
                  />
                </button>
                {keyGuideOpen && (
                  <ol className="list-decimal list-inside rounded-lg bg-secondary/50 border border-border/70 px-3 py-2.5 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
                    <li>{t('keyGuideStep1')}</li>
                    <li>{t('keyGuideStep2')}</li>
                    <li>{t('keyGuideStep3')}</li>
                  </ol>
                )}
              </div>

              {/* Quick Presets (Cloud BYOK + Local Ollama & LM Studio) */}
              <div className="flex flex-wrap gap-1.5">
                {AI_PROVIDER_PRESETS.map((p) => {
                  const active = activePreset?.id === p.id;
                  const presetLabel = p.labelKey ? t(p.labelKey) : p.label;
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
                        'pc-press px-2.5 py-1 rounded-md text-[13px] font-medium border cursor-pointer',
                        active
                          ? 'bg-primary/12 text-primary border-primary/35'
                          : 'bg-secondary/60 text-foreground border-border/70 hover:bg-secondary',
                      )}
                    >
                      {presetLabel}
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
                    'pc-press px-2.5 py-1 rounded-md text-[13px] font-medium border cursor-pointer',
                    !activePreset
                      ? 'bg-primary/12 text-primary border-primary/35'
                      : 'bg-secondary/60 text-foreground border-border/70 hover:bg-secondary',
                  )}
                >
                  {t('presetCustom')}
                </button>
              </div>

              {isLocalAi && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                    <Terminal className="h-3.5 w-3.5 shrink-0" />
                    <span>{t('ollamaCorsTitle')}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{t('ollamaCorsDesc')}</p>
                  <div className="flex items-center justify-between gap-2 rounded-md bg-background/90 border border-border/70 px-2 py-1.5 font-mono text-[11px] text-foreground">
                    <code className="truncate select-all">{OLLAMA_SERVE_CMD}</code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(OLLAMA_SERVE_CMD).catch(() => {});
                        setCopiedOllamaCmd(true);
                        onToast(t('ollamaCorsCopied'));
                        setTimeout(() => setCopiedOllamaCmd(false), 1800);
                      }}
                      className="inline-flex items-center gap-1 shrink-0 text-primary hover:underline cursor-pointer font-sans font-medium"
                    >
                      {copiedOllamaCmd ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{t('ollamaCorsCopy')}</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label htmlFor="pc-base-url" className="text-[13px] font-medium text-muted-foreground">
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
                    className="font-mono text-xs max-w-none"
                  />
                  {resolvedEndpoint.error === 'insecure' && (
                    <p className="text-xs text-destructive leading-snug">
                      {t('insecureRemoteUrlError')}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="pc-api-key" className="text-[13px] font-medium text-muted-foreground">
                      API Key
                    </label>
                    {isLocalAi && (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                        {t('apiKeyOptionalBadge')}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="pc-api-key"
                      type={showKey ? 'text' : 'password'}
                      value={s.ai.apiKey}
                      onChange={(e) =>
                        commitPatch({ ...s, ai: { ...s.ai, apiKey: e.target.value } })
                      }
                      placeholder={isLocalAi ? t('apiKeyLocalPlaceholder') : 'sk-...'}
                      className="font-mono text-xs max-w-none pr-8"
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
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
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
                  <div className="flex items-center justify-between">
                    <label htmlFor="pc-model" className="text-[13px] font-medium text-muted-foreground">
                      {lang === 'zh' ? '模型名称' : 'Model'}
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleFetchModels()}
                      className="text-[13px] text-primary hover:underline cursor-pointer"
                    >
                      {modelsStatus === 'loading'
                        ? lang === 'zh'
                          ? '正在拉取…'
                          : 'Loading…'
                        : lang === 'zh'
                          ? '拉取可用模型列表'
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
                      className="font-mono text-xs max-w-none"
                    />
                    {s.ai.availableModels && s.ai.availableModels.length > 0 && (
                      <Button
                        size="icon"
                        variant="outline"
                        type="button"
                        onClick={() => setModelsOpen((o) => !o)}
                        aria-label="Toggle model list"
                        className="shrink-0 h-8 w-8 cursor-pointer"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {modelsOpen && s.ai.availableModels && s.ai.availableModels.length > 0 && (
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md space-y-0.5">
                      {s.ai.availableModels.slice(0, 80).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            commitPatch({ ...s, ai: { ...s.ai, model: m } });
                            setModelsOpen(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded text-xs font-mono hover:bg-accent truncate cursor-pointer"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={testStatus === 'testing'}
                  onClick={() => void handleTestConn()}
                  className="pc-press text-[13px] gap-1.5 cursor-pointer"
                >
                  {testStatus === 'testing' ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : testStatus === 'ok' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : null}
                  <span>
                    {lang === 'zh' ? '测试接口连通性' : 'Test Connection'}
                    {testStatus === 'ok' && testElapsed > 0 ? ` (${testElapsed}ms)` : ''}
                  </span>
                </Button>
              </div>

              {testStatus === 'error' && testError && (
                <div className="rounded-lg border border-destructive/35 bg-destructive/8 p-2.5 text-[13px] space-y-1">
                  <div className="flex items-start gap-1.5 text-destructive font-medium">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
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
          )}
        </section>

        {/* 2. Agent Capabilities Toggles (Multimodal Vision + Closed-Loop Auto-Heal) */}
        <section className="p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <h2 className="text-[14px] font-semibold text-foreground">
              {t('capabilitiesTitle')}
            </h2>
          </div>

          <div className="space-y-3">
            <label className="flex items-start justify-between gap-3 cursor-pointer">
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

            <label className="flex items-start justify-between gap-3 cursor-pointer pt-1">
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

        {/* 3. Local Coding Agent Bridge (`pagecraft-mcp`) */}
        <section className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <PlugZap className="h-4 w-4 text-primary shrink-0" />
              <h2 className="text-[14px] font-semibold text-foreground truncate">
                {t('mcpTitle')}
              </h2>
            </div>
            <Switch
              checked={s.mcpBridgeEnabled}
              onCheckedChange={(checked) => commitPatch({ ...s, mcpBridgeEnabled: checked })}
            />
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">{t('mcpDesc')}</p>

          <div className="rounded-lg border border-border/80 bg-secondary/45 p-2.5 space-y-1.5">
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
                <span className="text-xs font-medium text-foreground truncate">
                  {!s.mcpBridgeEnabled
                    ? t('mcpStatusOff')
                    : mcpStatus?.connected
                      ? t('mcpStatusConnected')
                      : t('mcpStatusWaiting')}
                </span>
              </div>
              {s.mcpBridgeEnabled && (
                <button
                  type="button"
                  onClick={() => void handleReconnectMcp()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', reconnectingMcp && 'animate-spin')} />
                  <span>{t('mcpReconnectBtn')}</span>
                </button>
              )}
            </div>
            {s.mcpBridgeEnabled && !mcpStatus?.connected && mcpStatus?.lastError && (
              <p className="text-[11px] text-muted-foreground leading-snug break-words pl-4">
                {mcpStatus.lastError}
              </p>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1">
              <label htmlFor="pc-mcp-url" className="text-[13px] font-medium text-muted-foreground">
                {t('mcpWsUrlLabel')}
              </label>
              <Input
                id="pc-mcp-url"
                value={s.mcpBridgeUrl}
                onChange={(e) => commitPatch({ ...s, mcpBridgeUrl: e.target.value })}
                placeholder="ws://127.0.0.1:17321"
                className="font-mono text-xs max-w-none"
              />
              {!mcpUrlValid && (
                <p className="text-xs text-destructive leading-snug">{t('mcpLoopbackWarn')}</p>
              )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="pc-mcp-token"
                className="text-[13px] font-medium text-muted-foreground"
              >
                {t('mcpTokenLabel')}
              </label>
              <Input
                id="pc-mcp-token"
                type="password"
                value={s.mcpBridgeToken}
                onChange={(e) => commitPatch({ ...s, mcpBridgeToken: e.target.value })}
                placeholder={t('mcpTokenPlaceholder')}
                className="font-mono text-xs max-w-none"
              />
            </div>

            <div className="rounded-lg border border-border/80 bg-secondary/45 p-2.5 space-y-2">
              <pre className="font-mono text-[11px] leading-snug text-foreground overflow-x-auto select-all">
                {mcpConfigJson}
              </pre>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(mcpConfigJson).catch(() => {});
                    setCopiedMcpJson(true);
                    onToast(t('mcpCopiedToast'));
                    setTimeout(() => setCopiedMcpJson(false), 1800);
                  }}
                  className="pc-press text-xs gap-1.5 cursor-pointer"
                >
                  {copiedMcpJson ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{t('mcpCopyConfigBtn')}</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(mcpCliCmd).catch(() => {});
                    setCopiedMcpCli(true);
                    onToast(t('mcpCopiedToast'));
                    setTimeout(() => setCopiedMcpCli(false), 1800);
                  }}
                  className="pc-press text-xs gap-1.5 cursor-pointer"
                >
                  {copiedMcpCli ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Terminal className="h-3.5 w-3.5" />
                  )}
                  <span>{t('mcpCopyCliBtn')}</span>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Execution Engine Health */}
        <section className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-foreground">{t('runtimeTitle')}</h2>
            <button
              type="button"
              onClick={() =>
                void recheckOrRecoverJsPermission({
                  recheck: onRecheckAvailability,
                  beforeReload: () =>
                    onToast(
                      lang === 'zh'
                        ? '检测到授权已开启，正在刷新引擎…'
                        : 'Permission detected! Reloading engine…',
                    ),
                })
              }
              className="text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {lang === 'zh' ? '刷新状态' : 'Re-check'}
            </button>
          </div>

          <div className="space-y-2 text-[13px]">
            <div className="flex items-center gap-2 text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span>{t('cssEngineReady')}</span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
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
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline shrink-0 cursor-pointer"
                >
                  <span>{lang === 'zh' ? '去开启' : 'Enable'}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 5. Appearance & Language */}
        <section className="p-4 space-y-3">
          <h2 className="text-[14px] font-semibold text-foreground">{t('appearanceTitle')}</h2>

          <div className="space-y-2.5">
            <SegmentedControl
              className="w-full [&>.cds-seg-item]:flex-1 [&>.cds-seg-item]:justify-center"
              value={theme}
              onChange={(v: string) => onSetTheme(v as Theme)}
              items={[
                { id: 'light', label: t('themeLight') },
                { id: 'dark', label: t('themeDark') },
                { id: 'system', label: t('themeSystem') },
              ]}
            />
            <SegmentedControl
              className="w-full [&>.cds-seg-item]:flex-1 [&>.cds-seg-item]:justify-center"
              value={lang}
              onChange={(v: string) => onSetLang(v as Lang)}
              items={[
                { id: 'zh', label: '简体中文' },
                { id: 'en', label: 'English' },
              ]}
            />
          </div>
        </section>
      </div>

      {/* Zero-Backend Privacy Guarantee & Support Contact */}
      <div className="space-y-1.5 px-1 pt-4 text-[13px] text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p>{t('privacyNote')}</p>
        </div>
        <p className="pl-6 text-xs">
          {t('supportContactLabel')}
          <a
            href="https://github.com/botshen/plugin-radar/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/85 hover:text-primary hover:underline"
          >
            GitHub Issues
          </a>
          <span className="mx-1.5 opacity-50">·</span>
          <a
            href="mailto:botzgbj@gmail.com"
            className="text-foreground/85 hover:text-primary hover:underline"
          >
            botzgbj@gmail.com
          </a>
        </p>
      </div>
    </div>
  );
}
