import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppSettings } from '~/lib/types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '~/lib/shared/constants';
import { readSettings, updateSettings, writeSettings } from '~/lib/shared/settings';
import {
  generateWithBuiltinAi,
  hasLocalBuiltinAiGlobal,
  probeBuiltinAi,
} from '~/lib/shared/builtin-ai';
import { readUserScripts } from '~/lib/userscripts/store';
import { urlMatchesAny } from '~/lib/userscripts/matcher';
import {
  MODS_STORAGE_KEY,
  type ActiveTabInfo,
  type PickedElementContext,
  type UserScript,
  type UserScriptsAvailability,
} from '~/lib/userscripts/types';
import { BrandLogo } from '~/entrypoints/sidepanel/components/BrandLogo';
import { SegmentedControl } from './components/ui/segmented';
import { useTheme } from './hooks/useTheme';
import { I18nContext, useI18nProvider } from './i18n';
import StudioPage from './pages/Studio';
import ModsPage from './pages/Mods';
import SettingsPage from './pages/Settings';
import { Globe } from 'lucide-react';
import { cn } from '~/lib/utils';

type TabKey = 'studio' | 'mods' | 'settings';

function readInitialTab(): TabKey {
  try {
    const s = new URLSearchParams(window.location.search).get('state');
    if (s === 'mods' || s === 'settings' || s === 'studio') return s;
  } catch {
    /* ignore */
  }
  return 'studio';
}

function readStandalonePreviewTab(): ActiveTabInfo {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      return { supported: false };
    }
    const site = new URLSearchParams(window.location.search).get('site');
    if (site && /^[a-z0-9.-]+$/i.test(site)) {
      return {
        supported: true,
        url: `https://${site}/`,
        host: site,
        title: site,
      };
    }
  } catch {
    /* ignore */
  }
  return { supported: false };
}

export default function App() {
  const i18n = useI18nProvider();
  const { lang, setLang, t } = i18n;
  const { theme, setTheme } = useTheme();

  const [tab, setTab] = useState<TabKey>(readInitialTab);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [mods, setMods] = useState<UserScript[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTabInfo>(readStandalonePreviewTab);
  const [availability, setAvailability] = useState<UserScriptsAvailability | null>(null);

  const [picking, setPicking] = useState(false);
  const [pickedElement, setPickedElement] = useState<PickedElementContext | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const availabilityRef = useRef<UserScriptsAvailability | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const showToast = useCallback((msg: string, durationMs = 2600) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), durationMs);
  }, []);

  const loadMods = useCallback(async () => {
    const list = await readUserScripts();
    setMods(list.slice().sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const refreshActiveTab = useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      const info = (await chrome.runtime.sendMessage({
        type: 'GET_ACTIVE_TAB',
      })) as ActiveTabInfo | undefined;
      if (info) {
        setActiveTab(info);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const recheckAvailability = useCallback(async (): Promise<UserScriptsAvailability> => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      const fallback: UserScriptsAvailability = { available: true };
      setAvailability(fallback);
      return fallback;
    }
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'USERSCRIPTS_STATUS',
      })) as UserScriptsAvailability | undefined;
      const next = res ?? { available: false, reason: 'disabled' };
      const wasDisabled = availabilityRef.current?.available === false;
      availabilityRef.current = next;
      setAvailability(next);
      if (wasDisabled && next.available) {
        void chrome.runtime.sendMessage({ type: 'USERSCRIPTS_SYNC' }).catch(() => {});
      }
      return next;
    } catch {
      const fallback: UserScriptsAvailability = { available: false, reason: 'disabled' };
      availabilityRef.current = fallback;
      setAvailability(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    readSettings().then(setSettings).catch(() => {});
    void loadMods();
    void refreshActiveTab();
    void recheckAvailability();

    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      return;
    }

    const onRuntimeMessage = (
      msg: { type?: string; payload?: unknown },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (msg?.type === 'BUILTIN_AI_PROBE') {
        if (!hasLocalBuiltinAiGlobal()) return false;
        probeBuiltinAi({ allowRuntimeForward: false }).then(sendResponse);
        return true;
      }
      if (msg?.type === 'BUILTIN_AI_PROMPT') {
        if (!hasLocalBuiltinAiGlobal()) return false;
        const req = (msg.payload ?? {}) as { systemPrompt?: string; userPrompt?: string };
        generateWithBuiltinAi(req.systemPrompt ?? '', req.userPrompt ?? '', {
          allowRuntimeForward: false,
        })
          .then((content) => sendResponse({ ok: true, content }))
          .catch((e) =>
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        return true;
      }

      if (msg?.type === 'PAGECRAFT_TAB_CHANGED' && msg.payload) {
        const nextTab = msg.payload as ActiveTabInfo;
        setActiveTab((prev) => {
          if (prev.url !== nextTab.url) {
            setPicking(false);
            setPickedElement(null);
          }
          return nextTab;
        });
        if (availabilityRef.current?.available === false) {
          void recheckAvailability();
        }
      } else if (msg?.type === 'PAGECRAFT_ELEMENT_PICKED' && msg.payload) {
        setPicking(false);
        setPickedElement(msg.payload as PickedElementContext);
        setTab('studio');
      } else if (msg?.type === 'PAGECRAFT_PICKER_CANCELLED') {
        setPicking(false);
      } else if (msg?.type === 'PAGECRAFT_USERSCRIPTS_ENABLED') {
        const info = (msg.payload ?? {}) as { applied?: boolean };
        const next: UserScriptsAvailability = { available: true };
        availabilityRef.current = next;
        setAvailability(next);
        const zh = langRef.current === 'zh';
        showToast(
          info.applied
            ? zh
              ? 'JS 引擎已激活并在当前页生效！'
              : 'JS Userscript active on page!'
            : zh
              ? 'JS 油猴引擎已激活！'
              : 'JS Userscript engine enabled!',
        );
      }
      return false;
    };

    const recheckIfNeeded = () => {
      if (document.visibilityState === 'visible' && availabilityRef.current?.available === false) {
        void recheckAvailability();
      }
    };

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.SETTINGS in changes) {
        readSettings().then(setSettings).catch(() => {});
      }
      if (MODS_STORAGE_KEY in changes) {
        void loadMods();
      }
    };

    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    window.addEventListener('focus', recheckIfNeeded);
    document.addEventListener('visibilitychange', recheckIfNeeded);
    return () => {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      chrome.storage?.onChanged?.removeListener(onStorageChanged);
      window.removeEventListener('focus', recheckIfNeeded);
      document.removeEventListener('visibilitychange', recheckIfNeeded);
    };
  }, [loadMods, refreshActiveTab, recheckAvailability, showToast]);

  async function handleStartPicker() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      showToast(t('unsupportedTab'));
      return;
    }
    setPicking(true);
    const res = (await chrome.runtime
      .sendMessage({ type: 'START_ELEMENT_PICKER', payload: { lang } })
      .catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res?.ok) {
      setPicking(false);
      showToast(t('unsupportedTab'));
    }
  }

  async function handleCancelPicker() {
    setPicking(false);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({ type: 'CANCEL_ELEMENT_PICKER' }).catch(() => {});
    }
  }

  async function handleSaveSettings(next: AppSettings) {
    const saved = await writeSettings(next);
    setSettings(saved);
  }

  const handleCompleteTutorial = useCallback(async () => {
    setSettings((prev) => (prev.tutorialDone ? prev : { ...prev, tutorialDone: true }));
    const saved = await updateSettings(() => ({ tutorialDone: true })).catch(() => null);
    if (saved) setSettings(saved);
  }, []);

  const activeSiteCount = activeTab.url
    ? mods.filter((m) => m.enabled && urlMatchesAny(activeTab.url, m.matches)).length
    : 0;

  return (
    <I18nContext.Provider value={i18n}>
      <div className="min-h-screen w-full max-w-[560px] mx-auto flex flex-col bg-background text-foreground">
        {/* Sticky Top Header */}
        <header className="sticky top-0 z-20 bg-background/92 backdrop-blur-md border-b border-border/70 px-4 pt-3 pb-2.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BrandLogo size={28} />
              <span className="font-serif-editorial text-base font-semibold tracking-tight">
                PageCraft
              </span>
            </div>

            {/* Active Site Indicator Pill + 1-Click Language Toggle */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs max-w-[180px] truncate border',
                  activeTab.supported
                    ? 'bg-secondary/70 border-border/80 text-foreground'
                    : 'bg-muted/50 border-border/50 text-muted-foreground',
                )}
                title={activeTab.url || t('unsupportedTab')}
              >
                <Globe
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    activeTab.supported ? 'text-emerald-600' : 'text-muted-foreground',
                  )}
                />
                <span className="truncate">
                  {activeTab.supported
                    ? activeTab.host
                    : lang === 'zh'
                      ? '未打开网页'
                      : 'No webpage'}
                </span>
                {activeSiteCount > 0 && (
                  <span
                    key={activeSiteCount}
                    className="pc-counter-tick ml-0.5 px-1.5 rounded-full bg-primary/12 text-[#8f381e] dark:text-[#f29b80] text-xs font-semibold tabular-nums"
                  >
                    {activeSiteCount}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                title={lang === 'zh' ? 'Switch to English' : '切换为简体中文'}
                className="px-2 py-1 rounded-full text-xs font-medium border border-border/70 bg-secondary/45 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
              >
                {lang === 'zh' ? 'EN' : '中文'}
              </button>
            </div>
          </div>

          <SegmentedControl
            className="w-full [&>.cds-seg-item]:flex-1 [&>.cds-seg-item]:justify-center"
            value={tab}
            onChange={(v: string) => setTab(v as TabKey)}
            items={[
              { id: 'studio', label: t('tabStudio') },
              {
                id: 'mods',
                label: t('tabMods'),
                badge: mods.length > 0 ? mods.length : undefined,
              },
              { id: 'settings', label: t('tabSettings') },
            ]}
          />
        </header>

        {/* Main Scrollable Content */}
        <main className="flex-1 px-4 pt-3.5">
          {tab === 'studio' && (
            <StudioPage
              activeTab={activeTab}
              settings={settings}
              mods={mods}
              availability={availability}
              pickedElement={pickedElement}
              picking={picking}
              onStartPicker={handleStartPicker}
              onCancelPicker={handleCancelPicker}
              onClearPicked={() => setPickedElement(null)}
              onModsChanged={loadMods}
              onRecheckAvailability={recheckAvailability}
              onCompleteTutorial={handleCompleteTutorial}
              onNavigateSettings={() => setTab('settings')}
              onToast={showToast}
              lang={lang}
              t={t}
            />
          )}

          {tab === 'mods' && (
            <ModsPage
              activeTab={activeTab}
              mods={mods}
              availability={availability}
              onModsChanged={loadMods}
              onRecheckAvailability={recheckAvailability}
              onNavigateStudio={() => setTab('studio')}
              onToast={showToast}
              lang={lang}
              t={t}
            />
          )}

          {tab === 'settings' && (
            <SettingsPage
              settings={settings}
              availability={availability}
              onSaveSettings={handleSaveSettings}
              onRecheckAvailability={recheckAvailability}
              theme={theme}
              onSetTheme={setTheme}
              lang={lang}
              onSetLang={setLang}
              onToast={showToast}
              t={t}
            />
          )}
        </main>

        {/* Explicit Action Feedback Toast */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-3 left-4 right-4 z-50 mx-auto max-w-[360px] px-3.5 py-2.5 rounded-xl bg-foreground text-background text-[13px] leading-snug font-medium shadow-lg animate-page-enter text-center"
          >
            {toast}
          </div>
        )}
      </div>
    </I18nContext.Provider>
  );
}
