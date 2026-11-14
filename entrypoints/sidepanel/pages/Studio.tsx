import { useState, useMemo, useEffect, useRef } from 'react';
import type { AppSettings, CloudQuota } from '~/lib/types';
import type {
  ActiveTabInfo,
  GeneratedUserScript,
  GenerateUserScriptResult,
  ModEngine,
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
  Sparkles,
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
  ThumbsDown,
  Share2,
  RotateCcw,
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
  onQuotaUpdated: (q: CloudQuota) => void;
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
  feedbackVote: 'up' | 'down' | null;
  selectorCheck: SelectorVerifyResult | null;
  draftProvider: 'cloud' | 'byok' | 'playground';
  draftRefined: boolean;
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
  draftProvider: 'cloud',
  draftRefined: false,
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
  onQuotaUpdated,
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

  // Active draft state (persisted across tab switches via studioSession)
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
  const [draftProvider, setDraftProvider] = useState<'cloud' | 'byok' | 'playground'>(
    studioSession.draftProvider,
  );
  const [draftRefined, setDraftRefined] = useState(studioSession.draftRefined);
  const [feedbackVote, setFeedbackVote] = useState<'up' | 'down' | null>(
    studioSession.feedbackVote,
  );
  const previewCssRef = useRef<{ tabId: number; css: string } | null>(null);

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

  // Auto-prefill a tailored prompt when the user picks an element on the sandbox page
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
        setError(lang === 'zh' ? '后台服务未响应，请重试。' : 'No response from background worker.');
        return;
      }

      if (res.quota) {
        onQuotaUpdated(res.quota);
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
      setDraftRefined(Boolean(opts?.isRefine));
      setFeedbackVote(null);
      if (opts?.isRefine) {
        setRefineText('');
      }
      // If previously saved in this session, clear saved badge until re-applied
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
      onToast(t('coachCelebrationToast'), 3800);
    } else {
      onToast(
        lang === 'zh'
          ? `已启用并保存：${mod.name}`
          : `Applied & saved: ${mod.name}`,
      );
    }
  }

  function handleFeedback(verdict: 'up' | 'down') {
    if (!draft || feedbackVote) return;
    setFeedbackVote(verdict);
    if (draftProvider === 'playground') return;
    const selector: 'hit' | 'miss' | 'na' =
      selectorCheck && selectorCheck.details.length > 0
        ? selectorCheck.totalHits > 0
          ? 'hit'
          : 'miss'
        : 'na';
    // Fire-and-forget: a failed vote must never interrupt the user's flow.
    void safeSendMessage({
      type: 'SUBMIT_GENERATION_FEEDBACK',
      payload: {
        verdict,
        engine: draft.engine,
        aiSource: draftProvider,
        refined: draftRefined,
        selector,
      },
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

      // Non-destructively re-enable existing customized mod
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
            ? `已为当前网站启用：${reenabled.name}`
            : `Enabled on site: ${reenabled.name}`
          : lang === 'zh'
            ? `已保存规则（访问 ${siteHint ?? '目标站点'} 时自动生效）`
            : `Saved (activates automatically on ${siteHint ?? 'target site'})`,
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
      Boolean(
        activeTab.url && urlMatchesAny(activeTab.url, mod.matches),
      );
    if (matchedHere) {
      await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: mod.id } });
    } else {
      await safeSendMessage({ type: 'USERSCRIPTS_SYNC' });
    }
    const siteHint = recipe.siteHints?.[0];
    onToast(
      matchedHere
        ? lang === 'zh'
          ? `已为当前网站启用：${mod.name}`
          : `Enabled on site: ${mod.name}`
        : lang === 'zh'
          ? `已保存规则（访问 ${siteHint ?? '目标站点'} 时自动生效）`
          : `Saved (activates automatically on ${siteHint ?? 'target site'})`,
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
            ? '检测到授权已开启，正在重启引擎并应用…'
            : 'Permission detected! Reloading engine to apply…',
        ),
    });
    if (status === 'reloading') return;
    if (status === 'disabled') {
      onToast(
        lang === 'zh'
          ? '尚未检测到开关开启，请在扩展详情页打开「允许用户脚本」后再试'
          : 'Still disabled — turn ON "Allow User Scripts" on the extension details page first',
      );
      return;
    }
    setNeedsJsPermForId(null);
    if (targetId) {
      await safeSendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: targetId } });
      onToast(lang === 'zh' ? 'JS 引擎已激活并在当前页生效！' : 'JS Userscript active on page!');
    }
  }

  const quotaRemaining = settings.cloud.quota?.remaining ?? 10;
  const quotaLimit = settings.cloud.quota?.limit ?? 10;
  const isLocalAi = isLocalLoopbackEndpoint(settings.ai.baseUrl);
  const usingByok =
    settings.aiMode === 'byok' ||
    ((Boolean(settings.ai.apiKey.trim()) || isLocalAi) && quotaRemaining === 0);

  return (
    <div className="space-y-4 pb-6">
      {/* 0. First-Time 3-Step Interactive Coach Card (auto-hides once 1st mod is applied or skipped) */}
      {showTutorial && (
        <section className="animate-page-enter rounded-xl border border-primary/35 bg-primary/[0.06] px-3.5 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-xs font-semibold text-[#8f381e] dark:text-[#f29b80]">
                {t('coachTitle')}
              </span>
              {activeTab.supported && (
                <div className="inline-flex items-center gap-1 text-[11px] font-medium">
                  {([
                    [1, t('coachStep1Short')],
                    [2, t('coachStep2Short')],
                    [3, t('coachStep3Short')],
                  ] as const).map(([num, label], idx) => {
                    const doneStep = tutorialStep > num;
                    const activeStep = tutorialStep === num;
                    return (
                      <span key={num} className="inline-flex items-center gap-1">
                        {idx > 0 && <span className="text-muted-foreground/60">→</span>}
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded tabular-nums',
                            doneStep
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : activeStep
                                ? 'bg-primary text-white font-semibold'
                                : 'bg-background/70 text-muted-foreground',
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
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
            >
              {t('coachSkip')}
            </button>
          </div>

          {!activeTab.supported ? (
            <div className="space-y-2">
              <p className="text-[13px] text-foreground leading-snug">
                {t('coachUnsupportedDesc')}
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  void safeSendMessage({ type: 'OPEN_PRACTICE_TAB', payload: { lang } })
                }
                className="pc-press text-xs gap-1 cursor-pointer"
              >
                <span>{t('openPracticePage')}</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
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
                  className="text-xs font-medium text-primary hover:underline cursor-pointer"
                >
                  {t('coachTrySandboxLink')}
                </button>
              )}
              {tutorialStep === 2 && !onPlayground && !intent.trim() && (
                <button
                  type="button"
                  onClick={() =>
                    setIntent(
                      lang === 'zh'
                        ? '隐藏这个干扰区域，让页面干净清爽'
                        : 'Hide this distracting block for a clean view',
                    )
                  }
                  className="inline-flex items-center px-2 py-0.5 rounded bg-background border border-border/80 text-xs font-medium text-foreground hover:bg-secondary cursor-pointer"
                >
                  {t('coachQuickHideChip')}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* 1. Primary Proofing Slip Composer (zero nested box-in-box) */}
      <section className="pc-stagger-1 rounded-xl bg-card border border-border shadow-2xs overflow-hidden">
        {/* Proofing Slip Header Bar: Primary Picker Anchor + Aligned Quota */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-secondary/45 border-b border-border/70">
          <Button
            type="button"
            variant={activeTab.supported ? 'primary' : 'secondary'}
            size="sm"
            disabled={!activeTab.supported}
            onClick={picking ? onCancelPicker : onStartPicker}
            className={cn(
              'pc-press gap-1.5 px-3 text-[13px] font-medium cursor-pointer',
              showTutorial &&
                activeTab.supported &&
                tutorialStep === 1 &&
                !picking &&
                'ring-2 ring-primary/45 ring-offset-2 ring-offset-background',
            )}
          >
            <Crosshair className={cn('h-3.5 w-3.5', picking && 'animate-spin')} />
            <span>{picking ? t('pickingActive') : t('pickElement')}</span>
          </Button>

          <button
            type="button"
            onClick={onNavigateSettings}
            className="h-8 inline-flex items-center px-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer tabular-nums"
          >
            {usingByok
              ? `${isLocalAi ? t('localAiActiveLabel') : t('byokActiveLabel')} · ${settings.ai.model || 'API'}`
              : `${t('freeQuotaLabel')} ${quotaRemaining}/${quotaLimit}`}
          </button>
        </div>

        {/* Unsupported Tab Helper Strip (e.g. chrome://newtab or Web Store) */}
        {!activeTab.supported && !showTutorial && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-amber-500/8 border-b border-border/60 text-xs">
            <span className="text-muted-foreground leading-snug">{t('unsupportedBanner')}</span>
            <button
              type="button"
              onClick={() =>
                void safeSendMessage({ type: 'OPEN_PRACTICE_TAB', payload: { lang } })
              }
              className="shrink-0 font-medium text-primary hover:underline cursor-pointer"
            >
              {t('openPracticePage')}
            </button>
          </div>
        )}

        {/* Locked Element Strip */}
        {pickedElement && (
          <div className="flex items-start justify-between gap-2 bg-primary/[0.06] border-b border-border/60 px-3.5 py-2 text-[13px]">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-[#8f381e] dark:text-[#f29b80]">
                  {t('lockedTarget')}
                </span>
                <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-background text-foreground truncate max-w-[220px]">
                  {pickedElement.selector}
                </code>
                {pickedElement.similarCount && pickedElement.similarCount > 1 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {lang === 'zh'
                      ? `· 同类列表 ${pickedElement.similarCount} 项`
                      : `· ${pickedElement.similarCount} list items`}
                  </span>
                )}
              </div>
              {pickedElement.textPreview && (
                <p className="text-[13px] text-muted-foreground truncate">
                  “{pickedElement.textPreview}”
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClearPicked}
              aria-label={t('clearTarget')}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Seamless Proofing Pad (borderless writing surface) */}
        {!draft ? (
          <div>
            {pickedElement && !onPlayground && (
              <div className="flex items-center gap-1.5 flex-wrap px-3.5 pt-2.5">
                {[t('starterHide'), t('starterLargerText'), t('starterExportCsv')].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleStarterChip(chip)}
                    className="pc-press px-2 py-0.5 rounded-full border border-border/80 bg-secondary/55 hover:bg-secondary text-xs text-foreground transition-colors cursor-pointer"
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
              className="block w-full min-h-[78px] px-3.5 pt-3 pb-2 bg-transparent border-0 rounded-none outline-none focus-visible:border-transparent focus-visible:shadow-none text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground resize-none select-text"
            />

            <div className="flex items-center justify-between gap-2 px-3.5 pb-3 pt-1">
              <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                {intent.trim() ? (
                  <button
                    type="button"
                    onClick={() => setIntent('')}
                    className="text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {lang === 'zh' ? '清空输入' : 'Clear'}
                  </button>
                ) : !pickedElement ? (
                  <button
                    type="button"
                    onClick={() =>
                      setIntent(
                        lang === 'zh'
                          ? '把表格里状态为「逾期」或金额大于 1000 的行高亮标红'
                          : 'Highlight table rows where status is Overdue',
                      )
                    }
                    className="px-2 py-1 rounded-md bg-secondary/75 hover:bg-secondary text-xs text-muted-foreground hover:text-foreground transition-colors truncate cursor-pointer"
                  >
                    {lang === 'zh' ? '例：标红逾期数据行' : 'e.g. Highlight rows'}
                  </button>
                ) : null}
              </div>

              <Button
                variant="primary"
                size="sm"
                disabled={generating || !intent.trim()}
                onClick={() => void runGenerate()}
                className={cn(
                  'pc-press gap-1.5 px-3.5 text-[13px] font-medium cursor-pointer shrink-0',
                  showTutorial &&
                    tutorialStep === 2 &&
                    Boolean(intent.trim()) &&
                    !generating &&
                    'ring-2 ring-primary/45 ring-offset-2 ring-offset-background',
                )}
              >
                {generating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('generatingBtn')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{t('generateBtn')}</span>
                    <kbd className="ml-0.5 text-[11px] font-sans opacity-75 tracking-tight">
                      ⌘↵
                    </kbd>
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[13px] px-3.5 py-2.5">
            <span className="text-muted-foreground truncate pr-2">“{intent}”</span>
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
              }}
              className="text-[13px] font-medium text-primary hover:underline shrink-0 cursor-pointer"
            >
              {t('newDraft')}
            </button>
          </div>
        )}
      </section>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-destructive/35 bg-destructive/8 px-3.5 py-2.5 text-[13px] space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-foreground leading-relaxed flex-1">{error}</p>
          </div>
          {(errorCode === 'quota_exhausted' || errorCode === 'missing_api_key') && (
            <Button
              size="sm"
              variant="outline"
              onClick={onNavigateSettings}
              className="pc-press text-[13px] cursor-pointer"
            >
              {lang === 'zh' ? '前往设置填写 API Key' : 'Configure API Key in Settings'}
            </Button>
          )}
        </div>
      )}

      {/* One-time JS Permission Guide Banner */}
      {needsJsPermForId && availability?.available === false && (
        <section className="rounded-xl border border-primary/35 bg-primary/8 p-3.5 space-y-2.5">
          <div className="font-medium text-[14px] text-foreground">{t('jsPermTitle')}</div>
          <ol className="list-decimal list-inside space-y-1 text-[13px] text-muted-foreground leading-relaxed">
            <li>{t('jsPermStep1')}</li>
            <li>{t('jsPermStep2')}</li>
          </ol>
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void safeSendMessage({
                  type: 'OPEN_EXTENSION_DETAILS',
                  payload: { modId: needsJsPermForId ?? undefined },
                });
              }}
              className="pc-press text-[13px] gap-1 cursor-pointer"
            >
              <span>{t('openExtDetails')}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleRetryAfterJsPerm()}
              className="pc-press text-[13px] gap-1 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{t('recheckPerm')}</span>
            </Button>
          </div>
        </section>
      )}

      {/* 2A. Active Generated Draft Card + Multi-turn Refinement */}
      {draft && (
        <section className="animate-page-enter rounded-xl bg-card border border-border p-4 space-y-3.5">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[14px] font-semibold leading-snug text-foreground">
                {draft.name}
              </h2>
              <Badge
                variant={draft.engine === 'css' ? 'secondary' : 'outline'}
                className={cn(
                  'shrink-0 text-xs font-medium',
                  draft.engine === 'css' && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
                )}
              >
                {draft.engine === 'css'
                  ? lang === 'zh'
                    ? 'CSS 免开关秒生效'
                    : 'Instant CSS'
                  : lang === 'zh'
                    ? 'JS 油猴脚本'
                    : 'JS Userscript'}
              </Badge>
            </div>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {draft.explanation || draft.description}
            </p>
          </div>

          {/* Live Selector Hit Check */}
          {selectorCheck && selectorCheck.details.length > 0 && (
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-[13px] flex items-center justify-between gap-2',
                selectorCheck.totalHits > 0
                  ? 'bg-secondary/70 text-foreground'
                  : 'bg-amber-500/10 border border-amber-500/30 text-foreground',
              )}
            >
              {selectorCheck.totalHits > 0 ? (
                <span className="tabular-nums">
                  {lang === 'zh'
                    ? `已在当前页命中 ${selectorCheck.totalHits} 个目标元素`
                    : `Matched ${selectorCheck.totalHits} live element(s) on this page`}
                </span>
              ) : (
                <>
                  <span className="leading-snug">{t('selectorZeroWarn')}</span>
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() =>
                      void runGenerate({
                        customIntent:
                          lang === 'zh'
                            ? '当前选择器在页面上匹配到了 0 个元素，请根据页面最新真实 DOM 结构修正选择器'
                            : 'Previous selectors matched 0 elements on the live page; please recalibrate selectors against the live DOM landmarks',
                        isRefine: true,
                        diagnosticHint: `Selectors ${JSON.stringify(
                          selectorCheck.details.map((d) => d.selector),
                        )} matched 0 elements on the live DOM.`,
                      })
                    }
                    className="shrink-0 font-medium text-primary hover:underline cursor-pointer"
                  >
                    {t('autoCalibrateBtn')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Zero-Credit CSS Quick Sliders (font-size / max-width / warmth) */}
          {draft.engine === 'css' && (() => {
            const tweaks = readCssTweaks(draftBody);
            const fontVal = tweaks.fontSize ?? CSS_TWEAK_LIMITS.fontSize.fallback;
            const widthVal = tweaks.maxWidth ?? CSS_TWEAK_LIMITS.maxWidth.fallback;
            const warmthVal = tweaks.warmth;
            const hasBlocks = /pc-tweak:/.test(draftBody);
            return (
              <div className="rounded-lg bg-secondary/50 px-3 py-2 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground font-medium">
                    {t('cssQuickStepLabel')}
                  </span>
                  {hasBlocks && (
                    <button
                      type="button"
                      onClick={handleResetCssTweaks}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{t('cssResetTweaks')}</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  <label className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-muted-foreground">{t('cssFontSize')}</span>
                    <input
                      type="range"
                      min={CSS_TWEAK_LIMITS.fontSize.min}
                      max={CSS_TWEAK_LIMITS.fontSize.max}
                      step={CSS_TWEAK_LIMITS.fontSize.step}
                      value={fontVal}
                      onChange={(e) => handleTweakCss('fontSize', Number(e.target.value))}
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="w-11 text-right font-mono tabular-nums text-foreground">
                      {tweaks.fontSize !== null ? `${tweaks.fontSize}px` : '—'}
                    </span>
                  </label>

                  <label className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-muted-foreground">{t('cssMaxWidth')}</span>
                    <input
                      type="range"
                      min={CSS_TWEAK_LIMITS.maxWidth.min}
                      max={CSS_TWEAK_LIMITS.maxWidth.max}
                      step={CSS_TWEAK_LIMITS.maxWidth.step}
                      value={widthVal}
                      onChange={(e) => handleTweakCss('maxWidth', Number(e.target.value))}
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="w-11 text-right font-mono tabular-nums text-foreground">
                      {tweaks.maxWidth !== null ? `${tweaks.maxWidth}px` : '—'}
                    </span>
                  </label>

                  <label className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-muted-foreground">{t('cssWarmth')}</span>
                    <input
                      type="range"
                      min={CSS_TWEAK_LIMITS.warmth.min}
                      max={CSS_TWEAK_LIMITS.warmth.max}
                      step={CSS_TWEAK_LIMITS.warmth.step}
                      value={warmthVal}
                      onChange={(e) => handleTweakCss('warmth', Number(e.target.value))}
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="w-11 text-right font-mono tabular-nums text-foreground">
                      {warmthVal}%
                    </span>
                  </label>
                </div>
              </div>
            );
          })()}

          {/* Primary Actions: Apply & Save + Export .user.js + Toggle Code */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleApplyDraft()}
              className={cn(
                'pc-press gap-1.5 px-4 text-[13px] cursor-pointer',
                showTutorial &&
                  tutorialStep === 3 &&
                  !savedModId &&
                  'ring-2 ring-primary/45 ring-offset-2 ring-offset-background',
              )}
            >
              <Check className="h-3.5 w-3.5" />
              <span>{savedModId || appliedOnce ? t('appliedSaved') : t('applyAndSave')}</span>
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleCopyDraftUserscript()}
              className="pc-press gap-1.5 text-[13px] cursor-pointer"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{t('exportUserscript')}</span>
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleShareDraftRecipe()}
              className="pc-press gap-1.5 text-[13px] cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>{t('shareRecipe')}</span>
            </Button>

            <button
              type="button"
              onClick={() => setCodeOpen((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>{codeOpen ? t('hideSource') : t('viewSource')}</span>
            </button>
          </div>

          {/* "Did it work?" — anonymous success signal, asked once the mod is applied */}
          {(savedModId || appliedOnce) && (
            <div className="rounded-lg bg-secondary/55 px-3 py-2 space-y-1">
              {feedbackVote ? (
                <p className="text-[13px] text-foreground leading-relaxed">
                  {feedbackVote === 'up' ? t('feedbackThanksUp') : t('feedbackThanksDown')}
                </p>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-foreground">{t('feedbackAsk')}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleFeedback('up')}
                      className="pc-press inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border/80 bg-background hover:bg-emerald-500/10 text-[13px] text-foreground cursor-pointer"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span>{t('feedbackUp')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback('down')}
                      className="pc-press inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border/80 bg-background hover:bg-destructive/10 text-[13px] text-foreground cursor-pointer"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                      <span>{t('feedbackDown')}</span>
                    </button>
                  </div>
                </div>
              )}
              {!feedbackVote && (
                <p className="text-xs text-muted-foreground">{t('feedbackPrivacyHint')}</p>
              )}
            </div>
          )}

          {/* Editable Source Code & @match Drawer */}
          {codeOpen && (
            <div className="space-y-2.5 pt-2 border-t border-border/60">
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-muted-foreground">
                  {lang === 'zh' ? '生效网址规则（@match，每行一条）' : '@match patterns (one per line)'}
                </label>
                <Textarea
                  rows={2}
                  value={draftMatches}
                  onChange={(e) => setDraftMatches(e.target.value)}
                  className="font-mono text-xs leading-snug"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-muted-foreground">
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

          {/* Continuous Multi-turn Follow-up Refinement */}
          <div className="pt-3 border-t border-border/60 space-y-2">
            <div className="flex items-center gap-2">
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
                className="text-[13px] h-9 max-w-none"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={generating || !refineText.trim()}
                onClick={() => void runGenerate({ customIntent: refineText, isRefine: true })}
                className="pc-press shrink-0 h-9 gap-1 px-3 text-[13px] cursor-pointer"
              >
                {generating ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CornerDownLeft className="h-3.5 w-3.5" />
                )}
                <span>{t('refineBtn')}</span>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* 2B. Curated 1-Click Recipes (Idle state) */}
      {!draft && (
        <section className="pc-stagger-2 space-y-2">
          <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
            <Wand2 className="h-4 w-4 text-primary" />
            <h2 className="text-[14px] font-semibold text-foreground">
              {t('templatesTitle')}
            </h2>
          </div>

          {/* Recipe Category Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
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
                    'pc-press inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 transition-colors cursor-pointer',
                    active
                      ? 'bg-primary text-white border-primary'
                      : 'bg-card hover:bg-secondary/75 text-muted-foreground hover:text-foreground border-border/80',
                  )}
                >
                  <span>{pill.label}</span>
                  {typeof pill.badge === 'number' && pill.badge > 0 && (
                    <span
                      className={cn(
                        'px-1.5 rounded-full text-[11px] font-semibold tabular-nums leading-tight',
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-primary/12 text-[#8f381e] dark:text-[#f29b80]',
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
            <div className="rounded-xl border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
              {t('unsupportedTab')}
            </div>
          ) : (
            <div className="divide-y divide-border/70 rounded-xl border border-border bg-card overflow-hidden">
              {filteredTemplates.map((recipe) => {
                const copy = lang === 'zh' ? recipe.zh : recipe.en;
                const activeMod = findActiveTemplateMod(recipe);
                const isEnabled = Boolean(activeMod?.enabled);
                const isSiteMatched = Boolean(
                  hostLower && recipe.siteHints?.some((h) => hostLower.includes(h)),
                );
                const statusBadge = isSiteMatched
                  ? t('forThisSite')
                  : recipe.engine === 'css'
                    ? copy.tag
                    : null;

                return (
                  <div
                    key={recipe.id}
                    className={cn(
                      'px-3.5 py-[14px] flex items-start justify-between gap-3 transition-colors',
                      isSiteMatched && 'bg-primary/[0.04]',
                    )}
                  >
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[14px] font-medium text-foreground leading-snug">
                          {copy.name}
                        </span>
                        {statusBadge && (
                          <span
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded font-medium',
                              isSiteMatched
                                ? 'bg-primary/10 text-[#8f381e] dark:text-[#f29b80]'
                                : 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
                            )}
                          >
                            {statusBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        {copy.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleToggleTemplate(recipe)}
                      className={cn(
                        'pc-press shrink-0 mt-0.5 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer border',
                        isEnabled
                          ? 'pc-confirm-pop bg-primary/12 text-[#8f381e] dark:text-[#f29b80] border-primary/30'
                          : 'bg-secondary/80 hover:bg-secondary text-foreground border-border/80',
                      )}
                    >
                      {isEnabled ? `✓ ${t('activeNow')}` : t('applyNow')}
                    </button>
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
