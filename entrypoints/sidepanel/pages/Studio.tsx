import { useState, useMemo, useEffect, useRef } from 'react';
import type { AppSettings } from '~/lib/types';
import type { McpBridgeStatus } from '~/lib/mcp/types';
import type {
  ActiveTabInfo,
  GeneratedUserScript,
  GenerateUserScriptResult,
  ModEngine,
  ModGenerationProvider,
  PickedElementContext,
  SelectorVerifyResult,
  UserScript,
  UserScriptsAvailability,
} from '~/lib/userscripts/types';
import {
  exportAsUserScript,
  hostPatternFromUrl,
  upsertUserScript,
} from '~/lib/userscripts/store';
import { urlMatchesAny } from '~/lib/userscripts/matcher';
import { isLocalLoopbackEndpoint } from '~/lib/shared/ai-endpoints';
import { defaultPlaygroundIntent, isPlaygroundUrl } from '~/lib/userscripts/playground';
import {
  BUILTIN_TEMPLATES,
  instantiateTemplate,
  type TemplateRecipe,
} from '~/lib/userscripts/templates';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import {
  applyCssTweak,
  CSS_TWEAK_LIMITS,
  readCssTweaks,
  resetCssTweaks,
  type CssTweakKind,
} from '~/lib/userscripts/css-tweaks';
import { formatRecipeSharePost } from '~/lib/userscripts/share';
import {
  Crosshair,
  Check,
  Copy,
  Code2,
  X,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Wand2,
  CornerDownLeft,
  ThumbsUp,
  Share2,
  RotateCcw,
  Eye,
  PlugZap,
  ArrowRight,
} from 'lucide-react';
import { cn } from '~/lib/utils';
import { recheckOrRecoverJsPermission } from '../utils';
import type { Lang } from '../i18n';

interface Props {
  activeTab: ActiveTabInfo;
  settings: AppSettings;
  mods: UserScript[];
  availability: UserScriptsAvailability | null;
  pickedElement: PickedElementContext | null;
  picking: boolean;
  onStartPicker: () => void;
  onCancelPicker: () => void;
  onClearPicked: () => void;
  onModsChanged: () => Promise<void>;
  onRecheckAvailability: () => Promise<UserScriptsAvailability>;
  onCompleteTutorial: () => Promise<void>;
  onNavigateSettings: () => void;
  onToast: (msg: string, durationMs?: number) => void;
  lang: Lang;
  t: (k: string) => string;
}

type GenerateResponseWithVerify = GenerateUserScriptResult & {
  selectorCheck?: SelectorVerifyResult;
};

type RecipeFilterKey = 'all' | 'site' | 'clean' | 'reading' | 'tools';

const RECIPE_CLEAN_IDS = new Set([
  'tpl-zhihu-clean',
  'tpl-bilibili-focus',
  'tpl-xiaohongshu-clean',
  'tpl-widescreen-reader',
]);

const RECIPE_READING_IDS = new Set([
  'tpl-widescreen-reader',
  'tpl-smart-dark-mode',
  'tpl-zhihu-clean',
  'tpl-xiaohongshu-clean',
]);

const RECIPE_TOOLS_IDS = new Set([
  'tpl-table-csv-export',
  'tpl-unlock-copy',
  'tpl-code-copy-btn',
  'tpl-direct-external-links',
  'tpl-alt-image-zoom',
]);

interface StudioSessionState {
  intent: string;
  draft: GeneratedUserScript | null;
  draftBody: string;
  draftMatches: string;
  refineText: string;
  codeOpen: boolean;
  appliedOnce: boolean;
  savedModId: string | null;
  feedbackVote: 'up' | null;
  selectorCheck: SelectorVerifyResult | null;
  draftProvider: ModGenerationProvider;
  draftRefined: boolean;
  draftUsedVision: boolean;
  draftAutoHealed: boolean;
}

const studioSession: StudioSessionState = {
  intent: '',
  draft: null,
  draftBody: '',
  draftMatches: '',
  refineText: '',
  codeOpen: false,
  appliedOnce: false,
  savedModId: null,
  feedbackVote: null,
  selectorCheck: null,
  draftProvider: 'byok',
  draftRefined: false,
  draftUsedVision: false,
  draftAutoHealed: false,
};

function safeSendMessage<T = unknown>(msg: unknown): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return Promise.resolve(undefined);
  }
  return (chrome.runtime.sendMessage(msg) as Promise<T>).catch(() => undefined);
}

export default function StudioPage({
  activeTab,
  settings,
  mods,
  availability,
  pickedElement,
  picking,
  onStartPicker,
  onCancelPicker,
  onClearPicked,
  onModsChanged,
  onRecheckAvailability,
  onCompleteTutorial,
  onNavigateSettings,
  onToast,
  lang,
  t,
}: Props) {
  const [intent, setIntent] = useState(studioSession.intent);
  const [refineText, setRefineText] = useState(studioSession.refineText);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [recipeFilter, setRecipeFilter] = useState<RecipeFilterKey>('all');

  const [draft, setDraft] = useState<GeneratedUserScript | null>(studioSession.draft);
  const [savedModId, setSavedModId] = useState<string | null>(studioSession.savedModId);
  const [appliedOnce, setAppliedOnce] = useState<boolean>(studioSession.appliedOnce);
  const [selectorCheck, setSelectorCheck] = useState<SelectorVerifyResult | null>(
    studioSession.selectorCheck,
  );
  const [codeOpen, setCodeOpen] = useState(studioSession.codeOpen);
  const [draftBody, setDraftBody] = useState(studioSession.draftBody);
  const [draftMatches, setDraftMatches] = useState(studioSession.draftMatches);
  const [needsJsPermForId, setNeedsJsPermForId] = useState<string | null>(null);
  const [draftProvider, setDraftProvider] = useState<ModGenerationProvider>(
    studioSession.draftProvider,
  );
  const [draftRefined, setDraftRefined] = useState(studioSession.draftRefined);
  const [draftUsedVision, setDraftUsedVision] = useState(studioSession.draftUsedVision);
  const [draftAutoHealed, setDraftAutoHealed] = useState(studioSession.draftAutoHealed);
  const [feedbackVote, setFeedbackVote] = useState<'up' | null>(studioSession.feedbackVote);
  const [mcpStatus, setMcpStatus] = useState<McpBridgeStatus | null>(null);
  const previewCssRef = useRef<{ tabId: number; css: string } | null>(null);

  useEffect(() => {
    void safeSendMessage<McpBridgeStatus>({ type: 'MCP_BRIDGE_STATUS' }).then((res) => {
      if (res) setMcpStatus(res);
    });
  }, [settings.mcpBridgeEnabled, settings.mcpBridgeUrl, settings.mcpBridgeToken]);

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

  useEffect(() => {
    studioSession.intent = intent;
    studioSession.draft = draft;
    studioSession.draftBody = draftBody;
    studioSession.draftMatches = draftMatches;
    studioSession.refineText = refineText;
    studioSession.codeOpen = codeOpen;
    studioSession.appliedOnce = appliedOnce;
    studioSession.savedModId = savedModId;
    studioSession.feedbackVote = feedbackVote;
    studioSession.selectorCheck = selectorCheck;
    studioSession.draftProvider = draftProvider;
    studioSession.draftRefined = draftRefined;
    studioSession.draftUsedVision = draftUsedVision;
    studioSession.draftAutoHealed = draftAutoHealed;
  }, [
    intent,
    draft,
    draftBody,
    draftMatches,
    refineText,
    codeOpen,
    appliedOnce,
    savedModId,
    feedbackVote,
    selectorCheck,
    draftProvider,
    draftRefined,
    draftUsedVision,
    draftAutoHealed,
  ]);

  async function clearEphemeralCssPreview() {
    const prev = previewCssRef.current;
    if (!prev) return;
    previewCssRef.current = null;
    if (typeof chrome !== 'undefined' && chrome.scripting?.removeCSS) {
      await chrome.scripting
        .removeCSS({ target: { tabId: prev.tabId }, css: prev.css })
        .catch(() => {});
    }
  }

  const showTutorial = !settings.tutorialDone && mods.length === 0;
  const onPlayground = isPlaygroundUrl(activeTab.url);
  const tutorialStep: 1 | 2 | 3 = draft ? 3 : pickedElement ? 2 : 1;

  useEffect(() => {
    if (!showTutorial || !onPlayground || !pickedElement || draft) return;
    setIntent((prev) =>
      prev.trim() ? prev : defaultPlaygroundIntent(pickedElement.selector, lang),
    );
  }, [showTutorial, onPlayground, pickedElement, draft, lang]);

  function findActiveTemplateMod(recipe: TemplateRecipe): UserScript | undefined {
    return mods.find((m) => {
      if (m.templateId !== recipe.id) return false;
      if (recipe.scope === 'fixed_site') return true;
      return activeTab.url ? urlMatchesAny(activeTab.url, m.matches) : false;
    });
  }

  const hostLower = (activeTab.host ?? '').toLowerCase();

  const sortedTemplates = useMemo(() => {
    return BUILTIN_TEMPLATES.slice().sort((a, b) => {
      const aMatch = hostLower && a.siteHints?.some((h) => hostLower.includes(h)) ? 1 : 0;
      const bMatch = hostLower && b.siteHints?.some((h) => hostLower.includes(h)) ? 1 : 0;
      if (bMatch !== aMatch) return bMatch - aMatch;
      const aUniversal = a.scope === 'current_site' ? 1 : 0;
      const bUniversal = b.scope === 'current_site' ? 1 : 0;
      return bUniversal - aUniversal;
    });
  }, [hostLower]);

  const siteMatchedTemplates = useMemo(() => {
    if (!activeTab.supported) return [];
    return sortedTemplates.filter((r) => {
      const hintMatch = Boolean(hostLower && r.siteHints?.some((h) => hostLower.includes(h)));
      const enabledHere = Boolean(
        mods.find((m) => {
          if (!m.enabled || m.templateId !== r.id) return false;
          if (r.scope === 'fixed_site') return hintMatch;
          return activeTab.url ? urlMatchesAny(activeTab.url, m.matches) : false;
        }),
      );
      return hintMatch || enabledHere;
    });
  }, [activeTab.supported, activeTab.url, hostLower, mods, sortedTemplates]);

  const filteredTemplates = useMemo(() => {
    if (recipeFilter === 'all') return sortedTemplates;
    if (recipeFilter === 'site') {
      if (siteMatchedTemplates.length > 0) return siteMatchedTemplates;
      if (!activeTab.supported) return [];
      return sortedTemplates.filter((r) => r.scope === 'current_site');
    }
    if (recipeFilter === 'clean') {
      return sortedTemplates.filter((r) => RECIPE_CLEAN_IDS.has(r.id));
    }
    if (recipeFilter === 'reading') {
      return sortedTemplates.filter((r) => RECIPE_READING_IDS.has(r.id));
    }
    return sortedTemplates.filter((r) => RECIPE_TOOLS_IDS.has(r.id));
  }, [recipeFilter, sortedTemplates, siteMatchedTemplates, activeTab.supported]);

  async function runGenerate(opts?: {
    customIntent?: string;
    isRefine?: boolean;
    diagnosticHint?: string;
  }) {
    const promptText = (opts?.customIntent ?? intent).trim();
    if (!promptText || generating) return;

    setGenerating(true);
    setError(null);
    setErrorCode(undefined);

    try {
      const currentMatches = draftMatches
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await safeSendMessage<GenerateResponseWithVerify>({
        type: 'GENERATE_USERSCRIPT',
        payload: {
          intent: promptText,
          targetUrl: activeTab.url,
          pageTitle: activeTab.title,
          pickedElement,
          previousMod:
            opts?.isRefine && draft
              ? {
                  name: draft.name,
                  description: draft.description,
                  engine: draft.engine,
                  matches: currentMatches.length > 0 ? currentMatches : draft.matches,
                  code: draft.engine === 'js' ? draftBody : undefined,
                  css: draft.engine === 'css' ? draftBody : undefined,
                  targetSelectors: draft.targetSelectors,
                }
              : null,
          diagnosticHint: opts?.diagnosticHint,
          lang,
        },
      });

      if (!res) {
        setError(lang === 'zh' ? '后台服务未响应，请重试。' : 'Background worker did not respond.');
        return;
      }

      if (!res.ok) {
        setError(res.error);
        setErrorCode(res.code);
        return;
      }

      await clearEphemeralCssPreview();
      setDraft(res.script);
      setDraftBody(res.script.engine === 'css' ? res.script.css ?? '' : res.script.code);
      setDraftMatches(res.script.matches.join('\n'));
      setSelectorCheck(res.selectorCheck ?? null);
      setDraftProvider(res.provider);
      setDraftUsedVision(Boolean(res.usedVision));
      setDraftAutoHealed(Boolean(res.autoHealed));
      setDraftRefined(Boolean(opts?.isRefine));
      setFeedbackVote(null);
      if (opts?.isRefine) {
        setRefineText('');
      }
      setSavedModId(null);
      setAppliedOnce(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleApplyDraft() {
    if (!draft) return;
    await clearEphemeralCssPreview();
    const matches = draftMatches
      .split('\n')
      .map((m) => m.trim())
      .filter(Boolean);
    const finalMatches =
      matches.length > 0
        ? matches
        : activeTab.url && hostPatternFromUrl(activeTab.url)
          ? [hostPatternFromUrl(activeTab.url)]
          : ['https://example.com/*'];

    const now = Date.now();
    const id = savedModId ?? crypto.randomUUID();
    const mod: UserScript = {
      id,
      name: draft.name,
      description: draft.description,
      engine: draft.engine as ModEngine,
      matches: finalMatches,
      code: draft.engine === 'js' ? draftBody : '',
      css: draft.engine === 'css' ? draftBody : undefined,
      targetSelectors: draft.targetSelectors,
      enabled: true,
      source: 'ai',
      runAt: draft.engine === 'css' ? 'document_start' : 'document_idle',
      allowAllUrls: false,
      createdAt: now,
      updatedAt: now,
    };

    const wasInTutorial = !settings.tutorialDone && mods.length === 0;
    await upsertUserScript(mod);
    setSavedModId(id);
    setAppliedOnce(true);
    await onModsChanged();
    if (!settings.tutorialDone) {
      void onCompleteTutorial();
    }

    if (mod.engine === 'js') {
      const avail = await onRecheckAvailability();
      if (!avail.available) {
        setNeedsJsPermForId(id);
        return;
      }
    }

    setNeedsJsPermForId(null);
    await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id } });
    if (wasInTutorial) {
      onToast(t('coachCelebrationToast'), 3600);
    } else {
      onToast(
        lang === 'zh'
          ? `已应用并保存：${mod.name}`
          : `Applied and saved: ${mod.name}`,
      );
    }
  }

  function handleLocalWorked() {
    if (!draft) return;
    setFeedbackVote('up');
  }

  function handleLocalAutoCalibrate() {
    if (!draft || generating) return;
    onToast(t('feedbackCalibrating'));
    const selectorSummary =
      selectorCheck && selectorCheck.details.length > 0
        ? selectorCheck.details.map((d) => `${d.selector} (${d.count} hits)`).join(', ')
        : (draft.targetSelectors ?? []).join(', ');
    void runGenerate({
      customIntent:
        lang === 'zh'
          ? '刚才生成的改造在页面上未明显生效，请结合最新真实页面 DOM 结构修正选择器或提高样式优先级'
          : 'The previous mod did not visibly take effect on the live page; recalibrate selectors and specificity against live DOM landmarks',
      isRefine: true,
      diagnosticHint: selectorSummary
        ? `User reported visual no-op on live page. Current target selectors: [${selectorSummary}].`
        : 'User reported visual no-op on live page; inspect live DOM landmarks for accurate selectors.',
    });
  }

  function handleStarterChip(chipText: string) {
    setIntent((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chipText;
      if (trimmed.includes(chipText)) return prev;
      const sep = lang === 'zh' ? '，' : '; ';
      return `${trimmed}${sep}${chipText}`;
    });
  }

  const tweakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tweakTimerRef.current) clearTimeout(tweakTimerRef.current);
    };
  }, []);

  async function applyLiveCssPreview(nextCss: string) {
    if (savedModId) {
      const existing = mods.find((m) => m.id === savedModId);
      if (existing) {
        await upsertUserScript({
          ...existing,
          css: nextCss,
          enabled: true,
          updatedAt: Date.now(),
        });
        await onModsChanged();
        await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: savedModId } });
      }
      return;
    }

    if (
      activeTab.supported &&
      typeof activeTab.tabId === 'number' &&
      typeof chrome !== 'undefined' &&
      chrome.scripting?.insertCSS
    ) {
      const tabId = activeTab.tabId;
      await clearEphemeralCssPreview();
      try {
        await chrome.scripting.insertCSS({ target: { tabId }, css: nextCss });
        previewCssRef.current = { tabId, css: nextCss };
      } catch {
        /* ignore restricted frame */
      }
    }
  }

  function scheduleCssCommit(nextCss: string) {
    setDraftBody(nextCss);
    setDraft((prev) => (prev ? { ...prev, css: nextCss } : prev));
    if (tweakTimerRef.current) clearTimeout(tweakTimerRef.current);
    tweakTimerRef.current = setTimeout(() => {
      void applyLiveCssPreview(nextCss);
    }, 80);
  }

  function handleTweakCss(kind: CssTweakKind, value: number) {
    if (!draft || draft.engine !== 'css') return;
    const nextCss = applyCssTweak(draftBody, kind, value, draft.targetSelectors);
    if (nextCss === draftBody) return;
    scheduleCssCommit(nextCss);
  }

  function handleResetCssTweaks() {
    if (!draft || draft.engine !== 'css') return;
    const nextCss = resetCssTweaks(draftBody);
    if (nextCss === draftBody) return;
    scheduleCssCommit(nextCss);
  }

  function buildDraftModSnapshot(): UserScript | null {
    if (!draft) return null;
    return {
      id: savedModId ?? 'draft0000',
      name: draft.name,
      description: draft.description,
      engine: draft.engine,
      matches: draftMatches
        .split('\n')
        .map((m) => m.trim())
        .filter(Boolean),
      code: draft.engine === 'js' ? draftBody : '',
      css: draft.engine === 'css' ? draftBody : undefined,
      targetSelectors: draft.targetSelectors,
      enabled: true,
      source: 'ai',
      runAt: draft.engine === 'css' ? 'document_start' : 'document_idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async function handleCopyDraftUserscript() {
    const tempMod = buildDraftModSnapshot();
    if (!tempMod) return;
    await navigator.clipboard.writeText(exportAsUserScript(tempMod));
    onToast(t('copiedUserscript'));
  }

  async function handleShareDraftRecipe() {
    const tempMod = buildDraftModSnapshot();
    if (!tempMod) return;
    await navigator.clipboard.writeText(formatRecipeSharePost(tempMod, lang));
    onToast(t('copiedShareRecipe'));
  }

  async function handleToggleTemplate(recipe: TemplateRecipe) {
    const existing = findActiveTemplateMod(recipe);
    if (existing) {
      if (existing.enabled) {
        await upsertUserScript({
          ...existing,
          enabled: false,
          updatedAt: Date.now(),
        });
        await safeSendMessage({ type: 'USERSCRIPTS_SYNC' });
        await onModsChanged();
        onToast(
          lang === 'zh'
            ? `已关闭：${existing.name}`
            : `Disabled: ${existing.name}`,
        );
        return;
      }

      const reenabled: UserScript = {
        ...existing,
        enabled: true,
        updatedAt: Date.now(),
      };
      await upsertUserScript(reenabled);
      await onModsChanged();
      if (!settings.tutorialDone) {
        void onCompleteTutorial();
      }

      if (reenabled.engine === 'js') {
        const avail = await onRecheckAvailability();
        if (!avail.available) {
          setNeedsJsPermForId(reenabled.id);
          return;
        }
      }

      setNeedsJsPermForId(null);
      const matchesHere = Boolean(
        activeTab.url && urlMatchesAny(activeTab.url, reenabled.matches),
      );
      if (matchesHere) {
        await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: reenabled.id } });
      } else {
        await safeSendMessage({ type: 'USERSCRIPTS_SYNC' });
      }
      const siteHint = recipe.siteHints?.[0];
      onToast(
        matchesHere
          ? lang === 'zh'
            ? `已在当前站启用：${reenabled.name}`
            : `Enabled on site: ${reenabled.name}`
          : lang === 'zh'
            ? `已保存规则（访问 ${siteHint ?? '目标站点'} 自动生效）`
            : `Saved (activates on ${siteHint ?? 'target site'})`,
      );
      return;
    }

    if (recipe.scope === 'current_site' && !activeTab.supported) {
      setError(t('unsupportedTab'));
      return;
    }

    const mod = instantiateTemplate(recipe, activeTab.url, lang);
    if (!mod) {
      setError(t('unsupportedTab'));
      return;
    }

    await upsertUserScript(mod);
    await onModsChanged();
    if (!settings.tutorialDone) {
      void onCompleteTutorial();
    }

    if (mod.engine === 'js') {
      const avail = await onRecheckAvailability();
      if (!avail.available) {
        setNeedsJsPermForId(mod.id);
        return;
      }
    }

    setNeedsJsPermForId(null);
    const matchedHere =
      recipe.scope === 'current_site' ||
      Boolean(activeTab.url && urlMatchesAny(activeTab.url, mod.matches));
    if (matchedHere) {
      await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: mod.id } });
    } else {
      await safeSendMessage({ type: 'USERSCRIPTS_SYNC' });
    }
    const siteHint = recipe.siteHints?.[0];
    onToast(
      matchedHere
        ? lang === 'zh'
          ? `已在当前站启用：${mod.name}`
          : `Enabled on site: ${mod.name}`
        : lang === 'zh'
          ? `已保存规则（访问 ${siteHint ?? '目标站点'} 自动生效）`
          : `Saved (activates on ${siteHint ?? 'target site'})`,
    );
  }

  async function handleRetryAfterJsPerm() {
    const targetId = needsJsPermForId;
    const status = await recheckOrRecoverJsPermission({
      recheck: onRecheckAvailability,
      modId: targetId ?? undefined,
      tabId: activeTab.tabId,
      beforeReload: () =>
        onToast(
          lang === 'zh'
            ? '已检测到授权，正在重启引擎并应用…'
            : 'Permission detected. Reloading engine…',
        ),
    });
    if (status === 'reloading') return;
    if (status === 'disabled') {
      onToast(
        lang === 'zh'
          ? '尚未检测到开关开启，请先在扩展详情页打开「允许用户脚本」'
          : 'Toggle still off — enable "Allow User Scripts" on extension details first',
      );
      return;
    }
    setNeedsJsPermForId(null);
    if (targetId) {
      await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: targetId } });
      onToast(lang === 'zh' ? 'JS 引擎已激活并在当前页生效' : 'JS userscript active on page');
    }
  }

  const isLocalAi = isLocalLoopbackEndpoint(settings.ai.baseUrl);
  const isBuiltin = settings.aiMode === 'builtin';
  const enginePillText = isBuiltin
    ? t('builtinActiveLabel')
    : `${isLocalAi ? t('localAiActiveLabel') : t('byokActiveLabel')} · ${settings.ai.model || 'API'}`;

  return (
    <div className="space-y-3.5 pb-6 pc-enter">
      {/* 0. First-Time 3-Step Coach Card (strict max 2 boxes deep via divide-y) */}
      {showTutorial && (
        <section className="rounded-[10px] border border-primary/35 bg-card divide-y divide-border overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[var(--pc-accent-subtle)] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-xs font-semibold text-[var(--pc-accent-ink)]">
                {t('coachTitle')}
              </span>
              {activeTab.supported && (
                <div className="inline-flex items-center gap-1 text-[11px] font-medium">
                  {(
                    [
                      [1, t('coachStep1Short')],
                      [2, t('coachStep2Short')],
                      [3, t('coachStep3Short')],
                    ] as const
                  ).map(([num, label], idx) => {
                    const doneStep = tutorialStep > num;
                    const activeStep = tutorialStep === num;
                    return (
                      <span key={num} className="inline-flex items-center gap-1">
                        {idx > 0 && <span className="text-muted-foreground/70">→</span>}
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded-[4px] tabular-nums',
                            doneStep
                              ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'
                              : activeStep
                                ? 'bg-primary text-[#FAF8F5] font-semibold'
                                : 'bg-card text-muted-foreground border border-border',
                          )}
                        >
                          {doneStep ? '✓' : num} {label}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void onCompleteTutorial()}
              className="pc-focus text-xs text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
            >
              {t('coachSkip')}
            </button>
          </div>

          <div className="px-3.5 py-2.5 space-y-2">
            {!activeTab.supported ? (
              <>
                <p className="text-[13px] text-foreground leading-snug">
                  {t('coachUnsupportedDesc')}
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void safeSendMessage({ type: 'OPEN_PRACTICE_TAB', payload: { lang } })
                  }
                >
                  <span>{t('openPracticePage')}</span>
                </Button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-foreground leading-snug">
                  {tutorialStep === 1
                    ? onPlayground
                      ? t('coachStep1Playground')
                      : t('coachStep1AnySite')
                    : tutorialStep === 2
                      ? onPlayground
                        ? t('coachStep2Playground')
                        : t('coachStep2AnySite')
                      : t('coachStep3')}
                </p>
                {tutorialStep === 1 && !onPlayground && (
                  <button
                    type="button"
                    onClick={() =>
                      void safeSendMessage({ type: 'OPEN_PRACTICE_TAB', payload: { lang } })
                    }
                    className="pc-focus text-xs font-medium text-primary hover:underline cursor-pointer"
                  >
                    {t('coachTrySandboxLink')}
                  </button>
                )}
                {tutorialStep === 2 && !onPlayground && !intent.trim() && (
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      setIntent(
                        lang === 'zh'
                          ? '隐藏这个干扰区域，让正文区域干净易读'
                          : 'Hide this distracting block cleanly',
                      )
                    }
                  >
                    {t('coachQuickHideChip')}
                  </Button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* 1. Unified Live-Target & Prompt Composer Card (flat divide-y, max 2 boxes deep) */}
      <section className="rounded-[10px] bg-card border border-border divide-y divide-border overflow-hidden">
        {/* Header Rail: Element Picker Trigger + MCP Pill + Engine Link */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-secondary/40">
          <Button
            type="button"
            variant={activeTab.supported ? 'primary' : 'secondary'}
            size="sm"
            disabled={!activeTab.supported}
            onClick={picking ? onCancelPicker : onStartPicker}
            className={cn(
              'px-2.5 text-[12.5px]',
              showTutorial &&
                activeTab.supported &&
                tutorialStep === 1 &&
                !picking &&
                'ring-2 ring-primary/40 ring-offset-1 ring-offset-background',
            )}
          >
            <Crosshair className={cn('h-3.5 w-3.5', picking && 'animate-spin')} />
            <span>{picking ? t('pickingActive') : t('pickElement')}</span>
          </Button>

          <div className="flex items-center gap-1.5 min-w-0">
            {settings.mcpBridgeEnabled && (
              <button
                type="button"
                onClick={onNavigateSettings}
                title={mcpStatus?.lastError || settings.mcpBridgeUrl}
                className={cn(
                  'pc-btn inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border text-[11px] font-medium cursor-pointer shrink-0',
                  mcpStatus?.connected
                    ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-600/25'
                    : 'bg-amber-500/12 text-amber-900 dark:text-amber-300 border-amber-600/25',
                )}
              >
                <PlugZap className="h-3 w-3" />
                <span>{mcpStatus?.connected ? t('mcpActiveBadge') : t('mcpPendingBadge')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onNavigateSettings}
              title={enginePillText}
              className="pc-focus h-7 inline-flex items-center px-1.5 rounded-[5px] font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer tabular-nums truncate max-w-[125px] sm:max-w-[180px]"
            >
              {enginePillText}
            </button>
          </div>
        </div>

        {/* Unsupported Tab Notice */}
        {!activeTab.supported && !showTutorial && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-amber-500/[0.08] text-xs">
            <span className="text-muted-foreground leading-snug">{t('unsupportedBanner')}</span>
            <button
              type="button"
              onClick={() =>
                void safeSendMessage({ type: 'OPEN_PRACTICE_TAB', payload: { lang } })
              }
              className="pc-focus shrink-0 font-medium text-primary hover:underline cursor-pointer"
            >
              {t('openPracticePage')}
            </button>
          </div>
        )}

        {/* Picked-Selector Inspector Strip */}
        {pickedElement && (
          <div className="flex items-start justify-between gap-2 bg-[var(--pc-accent-subtle)] px-3.5 py-2 text-xs">
            <div className="min-w-0 space-y-1 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-[var(--pc-accent-ink)]">
                  {t('lockedTarget')}
                </span>
                <code className="font-mono text-[11.5px] px-1.5 py-0.5 rounded-[4px] bg-card border border-border text-foreground truncate max-w-[190px] sm:max-w-[240px]">
                  {pickedElement.selector}
                </code>
                {pickedElement.rect && pickedElement.rect.width > 0 && (
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {pickedElement.rect.width}×{pickedElement.rect.height}
                  </span>
                )}
                {pickedElement.similarCount && pickedElement.similarCount > 1 && (
                  <span className="px-1.5 py-0.5 rounded-[4px] bg-amber-500/12 text-amber-900 dark:text-amber-300 border border-amber-600/25 text-[11px] font-medium tabular-nums">
                    {lang === 'zh'
                      ? `同类 ${pickedElement.similarCount} 项`
                      : `${pickedElement.similarCount} siblings`}
                  </span>
                )}
              </div>
              {pickedElement.textPreview && (
                <p className="text-xs text-muted-foreground truncate">
                  “{pickedElement.textPreview}”
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClearPicked}
              aria-label={t('clearTarget')}
              className="pc-btn p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-card cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Prompt Composer Surface */}
        {!draft ? (
          <div>
            {pickedElement && !onPlayground && (
              <div className="flex items-center gap-1.5 flex-wrap px-3.5 pt-2.5">
                {[t('starterHide'), t('starterLargerText'), t('starterExportCsv')].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleStarterChip(chip)}
                    className="pc-btn px-2 py-0.5 rounded-[5px] border border-border bg-secondary/70 hover:bg-secondary text-xs text-foreground cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <Textarea
              rows={3}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void runGenerate();
                }
              }}
              placeholder={
                pickedElement ? t('composerPickedPlaceholder') : t('composerPlaceholder')
              }
              className="block w-full min-h-[82px] px-3.5 pt-2.5 pb-2 bg-transparent border-0 rounded-none outline-none focus-visible:border-transparent focus-visible:ring-0 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground resize-none"
            />

            <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-1">
              <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                {intent.trim() ? (
                  <button
                    type="button"
                    onClick={() => setIntent('')}
                    className="pc-focus text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {lang === 'zh' ? '清空输入' : 'Clear'}
                  </button>
                ) : !pickedElement ? (
                  <button
                    type="button"
                    onClick={() =>
                      setIntent(
                        lang === 'zh'
                          ? '将表格中状态为「逾期」或金额大于 1000 的行标红高亮'
                          : 'Highlight table rows where status is Overdue',
                      )
                    }
                    className="pc-btn px-2 py-1 rounded-[5px] bg-secondary/70 hover:bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground truncate cursor-pointer"
                  >
                    {lang === 'zh' ? '示例：标红逾期行' : 'Try: Highlight rows'}
                  </button>
                ) : null}
              </div>

              <Button
                variant="primary"
                size="sm"
                disabled={generating || !intent.trim()}
                onClick={() => void runGenerate()}
                className={cn(
                  'px-3 text-[13px] shrink-0',
                  showTutorial &&
                    tutorialStep === 2 &&
                    Boolean(intent.trim()) &&
                    !generating &&
                    'ring-2 ring-primary/40 ring-offset-1 ring-offset-background',
                )}
              >
                {generating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('generatingBtn')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('generateBtn')}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                    <kbd className="hidden sm:inline ml-0.5 text-[11px] font-mono opacity-80">
                      ⌘↵
                    </kbd>
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-[13px] px-3.5 py-2.5">
            <span className="text-muted-foreground truncate">“{intent}”</span>
            <button
              type="button"
              onClick={() => {
                void clearEphemeralCssPreview();
                setDraft(null);
                setSavedModId(null);
                setAppliedOnce(false);
                setSelectorCheck(null);
                setError(null);
                setFeedbackVote(null);
                setDraftUsedVision(false);
                setDraftAutoHealed(false);
              }}
              className="pc-focus text-xs font-medium text-primary hover:underline shrink-0 cursor-pointer"
            >
              {t('newDraft')}
            </button>
          </div>
        )}
      </section>

      {/* Error Banner */}
      {error && (
        <div className="rounded-[10px] border border-destructive/35 bg-destructive/8 px-3.5 py-2.5 text-[13px] space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-foreground leading-relaxed flex-1">{error}</p>
          </div>
          {(errorCode === 'missing_api_key' || errorCode === 'builtin_unavailable') && (
            <Button size="sm" variant="secondary" onClick={onNavigateSettings}>
              {lang === 'zh' ? '前往设置配置引擎' : 'Configure AI engine'}
            </Button>
          )}
        </div>
      )}

      {/* One-time JS Permission Guide Banner */}
      {needsJsPermForId && availability?.available === false && (
        <section className="rounded-[10px] border border-primary/35 bg-card p-3.5 space-y-2.5">
          <div className="font-semibold text-[13.5px] text-foreground">{t('jsPermTitle')}</div>
          <ol className="list-decimal list-inside space-y-1 text-[12.5px] text-muted-foreground leading-relaxed">
            <li>{t('jsPermStep1')}</li>
            <li>{t('jsPermStep2')}</li>
          </ol>
          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void safeSendMessage({
                  type: 'OPEN_EXTENSION_DETAILS',
                  payload: { modId: needsJsPermForId ?? undefined },
                });
              }}
            >
              <span>{t('openExtDetails')}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleRetryAfterJsPerm()}
            >
              <Check className="h-3.5 w-3.5" />
              <span>{t('recheckPerm')}</span>
            </Button>
          </div>
        </section>
      )}

      {/* 2A. Flat-Divided Draft Card (strict max 2 boxes deep via divide-y) */}
      {draft && (
        <section className="pc-enter rounded-[10px] bg-card border border-border divide-y divide-border overflow-hidden">
          {/* Header + Status Pills + Summary */}
          <div className="px-3.5 py-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[14px] font-semibold leading-snug text-foreground">
                {draft.name}
              </h2>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                {draftUsedVision && (
                  <Badge variant="success" className="gap-1">
                    <Eye className="h-3 w-3" />
                    <span>{t('visionBadge')}</span>
                  </Badge>
                )}
                {draftAutoHealed && (
                  <Badge variant="warning">{t('autoHealedBadge')}</Badge>
                )}
                <Badge
                  variant={draft.engine === 'css' ? 'default' : 'secondary'}
                  className="font-mono uppercase"
                >
                  {draft.engine}
                </Badge>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {draft.explanation || draft.description}
            </p>
          </div>

          {/* Live Selector Hit Strip */}
          {selectorCheck && selectorCheck.details.length > 0 && (
            <div
              className={cn(
                'px-3.5 py-2 text-xs flex items-center justify-between gap-2',
                selectorCheck.totalHits > 0
                  ? 'bg-secondary/40 text-foreground'
                  : 'bg-amber-500/[0.08] text-foreground',
              )}
            >
              {selectorCheck.totalHits > 0 ? (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>
                    {lang === 'zh'
                      ? `当前页面已匹配 ${selectorCheck.totalHits} 个目标节点`
                      : `Matched ${selectorCheck.totalHits} live element(s) on this page`}
                  </span>
                </span>
              ) : (
                <>
                  <span className="leading-snug text-amber-900 dark:text-amber-300">
                    {t('selectorZeroWarn')}
                  </span>
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() =>
                      void runGenerate({
                        customIntent:
                          lang === 'zh'
                            ? '当前选择器在页面上匹配到了 0 个元素，请根据页面最新真实 DOM 结构修正选择器'
                            : 'Previous selectors matched 0 elements on the live page; recalibrate selectors against live DOM landmarks',
                        isRefine: true,
                        diagnosticHint: `Selectors ${JSON.stringify(
                          selectorCheck.details.map((d) => d.selector),
                        )} matched 0 elements on the live DOM.`,
                      })
                    }
                    className="pc-focus shrink-0 font-medium text-primary hover:underline cursor-pointer"
                  >
                    {t('autoCalibrateBtn')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Precision CSS Quick Sliders (Font, Width, Warmth) */}
          {draft.engine === 'css' &&
            (() => {
              const tweaks = readCssTweaks(draftBody);
              const fontVal = tweaks.fontSize ?? CSS_TWEAK_LIMITS.fontSize.fallback;
              const widthVal = tweaks.maxWidth ?? CSS_TWEAK_LIMITS.maxWidth.fallback;
              const warmthVal = tweaks.warmth;
              const hasBlocks = /pc-tweak:/.test(draftBody);
              return (
                <div className="px-3.5 py-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground font-medium">
                      {t('cssQuickStepLabel')}
                    </span>
                    {hasBlocks && (
                      <button
                        type="button"
                        onClick={handleResetCssTweaks}
                        className="pc-focus inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>{t('cssResetTweaks')}</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5">
                      <span className="w-11 shrink-0 text-muted-foreground">
                        {t('cssFontSize')}
                      </span>
                      <input
                        type="range"
                        min={CSS_TWEAK_LIMITS.fontSize.min}
                        max={CSS_TWEAK_LIMITS.fontSize.max}
                        step={CSS_TWEAK_LIMITS.fontSize.step}
                        value={fontVal}
                        onChange={(e) => handleTweakCss('fontSize', Number(e.target.value))}
                        className="pc-range flex-1"
                      />
                      <span className="w-12 text-right font-mono tabular-nums text-foreground">
                        {tweaks.fontSize !== null ? `${tweaks.fontSize}px` : '—'}
                      </span>
                    </label>

                    <label className="flex items-center gap-2.5">
                      <span className="w-11 shrink-0 text-muted-foreground">
                        {t('cssMaxWidth')}
                      </span>
                      <input
                        type="range"
                        min={CSS_TWEAK_LIMITS.maxWidth.min}
                        max={CSS_TWEAK_LIMITS.maxWidth.max}
                        step={CSS_TWEAK_LIMITS.maxWidth.step}
                        value={widthVal}
                        onChange={(e) => handleTweakCss('maxWidth', Number(e.target.value))}
                        className="pc-range flex-1"
                      />
                      <span className="w-12 text-right font-mono tabular-nums text-foreground">
                        {tweaks.maxWidth !== null ? `${tweaks.maxWidth}px` : '—'}
                      </span>
                    </label>

                    <label className="flex items-center gap-2.5">
                      <span className="w-11 shrink-0 text-muted-foreground">
                        {t('cssWarmth')}
                      </span>
                      <input
                        type="range"
                        min={CSS_TWEAK_LIMITS.warmth.min}
                        max={CSS_TWEAK_LIMITS.warmth.max}
                        step={CSS_TWEAK_LIMITS.warmth.step}
                        value={warmthVal}
                        onChange={(e) => handleTweakCss('warmth', Number(e.target.value))}
                        className="pc-range flex-1"
                      />
                      <span className="w-12 text-right font-mono tabular-nums text-foreground">
                        {warmthVal}%
                      </span>
                    </label>
                  </div>
                </div>
              );
            })()}

          {/* Primary Actions Rail */}
          <div className="px-3.5 py-2.5 flex items-center gap-1.5 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleApplyDraft()}
              className={cn(
                'px-3.5',
                showTutorial &&
                  tutorialStep === 3 &&
                  !savedModId &&
                  'ring-2 ring-primary/40 ring-offset-1 ring-offset-background',
              )}
            >
              <Check className="h-3.5 w-3.5" />
              <span>{savedModId || appliedOnce ? t('appliedSaved') : t('applyAndSave')}</span>
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleCopyDraftUserscript()}
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{t('exportUserscript')}</span>
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleShareDraftRecipe()}
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>{t('shareRecipe')}</span>
            </Button>

            <button
              type="button"
              onClick={() => setCodeOpen((v) => !v)}
              className="pc-focus ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer py-1"
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>{codeOpen ? t('hideSource') : t('viewSource')}</span>
            </button>
          </div>

          {/* Local Live Verification Row */}
          {(savedModId || appliedOnce) && (
            <div className="px-3.5 py-2.5 bg-secondary/35">
              {feedbackVote ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('feedbackThanksUp')}
                </p>
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-medium text-foreground">{t('feedbackAsk')}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="xs" variant="secondary" onClick={handleLocalWorked}>
                      <ThumbsUp className="h-3 w-3" />
                      <span>{t('feedbackUp')}</span>
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={generating}
                      onClick={handleLocalAutoCalibrate}
                      className="text-[var(--pc-accent-ink)] border-primary/30"
                    >
                      <Wand2 className="h-3 w-3" />
                      <span>{t('feedbackDown')}</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Editable Source Drawer */}
          {codeOpen && (
            <div className="px-3.5 py-3 space-y-2.5 bg-secondary/20">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {lang === 'zh' ? '@match 规则（每行一条）' : '@match patterns (one per line)'}
                </label>
                <Textarea
                  rows={2}
                  value={draftMatches}
                  onChange={(e) => setDraftMatches(e.target.value)}
                  className="font-mono text-xs leading-snug"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {draft.engine === 'css' ? 'CSS' : 'JavaScript'}
                </label>
                <Textarea
                  rows={8}
                  value={draftBody}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setDraftBody(nextVal);
                    setDraft((prev) =>
                      prev
                        ? prev.engine === 'css'
                          ? { ...prev, css: nextVal }
                          : { ...prev, code: nextVal }
                        : prev,
                    );
                  }}
                  className="font-mono text-xs leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* Follow-up Multi-turn Refinement Row */}
          <div className="px-3.5 py-2.5 flex items-center gap-2">
            <Input
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  refineText.trim()
                ) {
                  e.preventDefault();
                  void runGenerate({ customIntent: refineText, isRefine: true });
                }
              }}
              placeholder={t('refinePlaceholder')}
              className="h-8 text-[12.5px]"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={generating || !refineText.trim()}
              onClick={() => void runGenerate({ customIntent: refineText, isRefine: true })}
              className="h-8 px-2.5 shrink-0"
            >
              {generating ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="h-3.5 w-3.5" />
              )}
              <span>{t('refineBtn')}</span>
            </Button>
          </div>
        </section>
      )}

      {/* 2B. Scannable 1-Click Recipe List (Idle state) */}
      {!draft && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13.5px] font-semibold text-foreground">
              {t('templatesTitle')}
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {filteredTemplates.length}
            </span>
          </div>

          {/* 6px-radius Filter Chips (wraps cleanly at 320px, zero horizontal overflow) */}
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                { id: 'all', label: t('recipeFilterAll') },
                {
                  id: 'site',
                  label: t('recipeFilterThisSite'),
                  badge: siteMatchedTemplates.length > 0 ? siteMatchedTemplates.length : undefined,
                },
                { id: 'clean', label: t('recipeFilterClean') },
                { id: 'reading', label: t('recipeFilterReading') },
                { id: 'tools', label: t('recipeFilterTools') },
              ] as Array<{ id: RecipeFilterKey; label: string; badge?: number }>
            ).map((pill) => {
              const active = recipeFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setRecipeFilter(pill.id)}
                  className={cn(
                    'pc-btn inline-flex items-center gap-1 h-7 px-2.5 rounded-[6px] text-xs font-medium border cursor-pointer',
                    active
                      ? 'bg-primary text-[#FAF8F5] border-transparent'
                      : 'bg-card hover:bg-secondary text-muted-foreground hover:text-foreground border-border',
                  )}
                >
                  <span>{pill.label}</span>
                  {typeof pill.badge === 'number' && pill.badge > 0 && (
                    <span
                      className={cn(
                        'px-1 rounded-[4px] text-[11px] font-semibold tabular-nums leading-tight',
                        active
                          ? 'bg-white/20 text-[#FAF8F5]'
                          : 'bg-[var(--pc-accent-subtle)] text-[var(--pc-accent-ink)]',
                      )}
                    >
                      {pill.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="rounded-[10px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
              {t('unsupportedTab')}
            </div>
          ) : (
            <div className="divide-y divide-border rounded-[10px] border border-border bg-card overflow-hidden">
              {filteredTemplates.map((recipe) => {
                const copy = lang === 'zh' ? recipe.zh : recipe.en;
                const activeMod = findActiveTemplateMod(recipe);
                const isEnabled = Boolean(activeMod?.enabled);
                const isSiteMatched = Boolean(
                  hostLower && recipe.siteHints?.some((h) => hostLower.includes(h)),
                );

                return (
                  <div
                    key={recipe.id}
                    className={cn(
                      'pc-row px-3.5 py-3 flex items-start justify-between gap-3',
                      isSiteMatched && 'bg-[var(--pc-accent-subtle)]/40',
                    )}
                  >
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13.5px] font-medium text-foreground leading-snug">
                          {copy.name}
                        </span>
                        <Badge variant="secondary" className="font-mono uppercase px-1.5 py-0">
                          {recipe.engine}
                        </Badge>
                        {isSiteMatched && (
                          <Badge variant="default" className="px-1.5 py-0">
                            {t('forThisSite')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                        {copy.description}
                      </p>
                    </div>

                    <Button
                      type="button"
                      size="xs"
                      variant={isEnabled ? 'primary' : 'secondary'}
                      onClick={() => void handleToggleTemplate(recipe)}
                      className="mt-0.5 shrink-0"
                    >
                      {isEnabled ? `✓ ${t('activeNow')}` : t('applyNow')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
