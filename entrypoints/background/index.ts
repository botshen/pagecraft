/**
 * PageCraft — Zero-Backend Background Service Worker.
 *
 * 100% serverless & local-first: strictly zero behavioral tracking, zero history
 * monitoring, zero accounts, and zero telemetry uploads. Executes user-created
 * CSS/Userscript mods and handles explicit SidePanel & local MCP commands.
 */

import type { AIConfig } from '~/lib/types';
import { readSettings, updateSettings } from '~/lib/shared/settings';
import { byokListModels, byokLlmChat, byokTestConnection } from '~/lib/shared/ai-client';
import {
  generateWithBuiltinAi,
  hasLocalBuiltinAiGlobal,
  probeBuiltinAi,
} from '~/lib/shared/builtin-ai';
import { DEFAULT_PRACTICE_URL } from '~/lib/shared/constants';
import {
  getExtensionDetailsUrl,
  isScriptableTabUrl,
  PENDING_JS_APPLY_KEY,
  type PendingJsApply,
} from '~/lib/shared/browser';
import { readUserScripts, upsertUserScript } from '~/lib/userscripts/store';
import type {
  ActiveTabInfo,
  GenerateUserScriptPayload,
  PickedElementContext,
  UserScript,
} from '~/lib/userscripts/types';
import {
  buildMcpBridgeHandlers,
  captureElementScreenshot,
  checkUserScriptsAvailability,
  defaultExtractJsonString,
  generateUserScript,
  getActiveTabPageContext,
  initModsRuntime,
  syncCssForTab,
  syncUserScripts,
  verifySelectorsOnActiveTab,
} from './userscripts';
import {
  injectElementPickerOverlay,
  removeElementPickerOverlay,
} from './picker-injected';

let lastPickedElement: PickedElementContext | null = null;

function buildActiveTabInfo(tab?: chrome.tabs.Tab): ActiveTabInfo {
  const url = tab?.url ?? '';
  if (!tab?.id || !isScriptableTabUrl(url)) {
    return {
      tabId: tab?.id,
      url: url || undefined,
      title: tab?.title,
      supported: false,
    };
  }
  try {
    const parsed = new URL(url);
    return {
      tabId: tab.id,
      url,
      host: parsed.hostname.replace(/^www\./, ''),
      title: tab.title ?? parsed.hostname,
      supported: true,
    };
  } catch {
    return { tabId: tab.id, url, supported: false };
  }
}

async function queryActiveTabInfo(): Promise<ActiveTabInfo> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return buildActiveTabInfo(tab);
  } catch {
    return { supported: false };
  }
}

async function startElementPickerOnActiveTab(
  lang: 'zh' | 'en' = 'zh',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      return { ok: false, error: 'unsupported_tab' };
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectElementPickerOverlay,
      args: [lang],
      world: 'ISOLATED',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const mcpBridgeHandlers = buildMcpBridgeHandlers({
  getLastPickedElement: () => lastPickedElement,
  startPicker: (lang) => startElementPickerOnActiveTab(lang ?? 'en'),
  captureScreenshot: (picked) => captureElementScreenshot(picked),
  includeVisionScreenshot: async () => (await readSettings()).enableVisionCapture,
});

async function configureSidePanelBehavior(): Promise<void> {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch {
    /* older Chromium without sidePanel API — action fallback handles it */
  }
}

export default defineBackground(() => {
  void configureSidePanelBehavior();
  initModsRuntime();
  void flushPendingJsApply();

  chrome.runtime.onInstalled.addListener((details) => {
    void configureSidePanelBehavior();
    if (details.reason === 'install') {
      readSettings()
        .then((s) => {
          if (!s.onboardingDone) {
            chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
          }
        })
        .catch(() => {});
    }
  });

  // Fallback for browsers where setPanelBehavior isn't supported
  try {
    chrome.action?.onClicked?.addListener((tab) => {
      if (chrome.sidePanel?.open && tab.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
          chrome.tabs.create({ url: chrome.runtime.getURL('/sidepanel.html') });
        });
      }
    });
  } catch {
    /* ignore */
  }

  // Broadcast active tab changes so the open SidePanel stays in sync live
  const broadcastActiveTab = () => {
    queryActiveTabInfo()
      .then((info) => {
        chrome.runtime
          .sendMessage({ type: 'PAGECRAFT_TAB_CHANGED', payload: info })
          .catch(() => {});
      })
      .catch(() => {});
  };

  chrome.tabs.onActivated.addListener(() => broadcastActiveTab());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) {
      broadcastActiveTab();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const { type, payload } = (msg ?? {}) as { type?: string; payload?: unknown };

    if (type === 'PAGECRAFT_ELEMENT_PICKED' && payload) {
      lastPickedElement = payload as PickedElementContext;
      return false;
    }

    if (type === 'GET_ACTIVE_TAB') {
      queryActiveTabInfo().then(sendResponse);
      return true;
    }

    if (type === 'START_ELEMENT_PICKER') {
      const lang = (payload as { lang?: 'zh' | 'en' })?.lang ?? 'zh';
      startElementPickerOnActiveTab(lang).then(sendResponse);
      return true;
    }

    if (type === 'CANCEL_ELEMENT_PICKER') {
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id && tab.url && /^https?:\/\//i.test(tab.url)) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: removeElementPickerOverlay,
              world: 'ISOLATED',
            });
          }
          sendResponse({ ok: true });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    if (type === 'GET_PAGE_CONTEXT') {
      getActiveTabPageContext().then(sendResponse);
      return true;
    }

    if (type === 'BUILTIN_AI_PROBE') {
      const forwarded = Boolean((payload as { forwarded?: boolean } | undefined)?.forwarded);
      if (forwarded && !hasLocalBuiltinAiGlobal()) {
        return false;
      }
      probeBuiltinAi({ allowRuntimeForward: !forwarded }).then(sendResponse);
      return true;
    }

    if (type === 'BUILTIN_AI_PROMPT') {
      const req = (payload ?? {}) as {
        systemPrompt?: string;
        userPrompt?: string;
        forwarded?: boolean;
      };
      if (req.forwarded && !hasLocalBuiltinAiGlobal()) {
        return false;
      }
      generateWithBuiltinAi(req.systemPrompt ?? '', req.userPrompt ?? '', {
        allowRuntimeForward: !req.forwarded,
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

    if (type === 'GENERATE_USERSCRIPT') {
      (async () => {
        try {
          const req = (payload ?? {}) as GenerateUserScriptPayload;
          const settings = await readSettings();
          const activeTab = await queryActiveTabInfo();
          let pageContext = req.pageContext;
          if (!pageContext && activeTab.supported) {
            const ctx = await getActiveTabPageContext();
            if (ctx.ok && ctx.context) pageContext = ctx.context;
          }

          const genRes = await generateUserScript(
            {
              ...req,
              targetUrl: req.targetUrl || activeTab.url,
              pageTitle: req.pageTitle || activeTab.title,
              pageContext,
            },
            settings,
            (cfg, prompt, isTest, imageDataUrl) =>
              byokLlmChat(cfg, prompt, isTest, fetch, imageDataUrl),
            defaultExtractJsonString,
          );

          sendResponse(genRes);
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    if (type === 'VERIFY_SELECTORS') {
      const selectors = (payload as { selectors?: string[] })?.selectors ?? [];
      verifySelectorsOnActiveTab(selectors).then(sendResponse);
      return true;
    }

    if (type === 'USERSCRIPTS_STATUS') {
      checkUserScriptsAvailability().then(sendResponse);
      return true;
    }

    if (type === 'USERSCRIPTS_SYNC') {
      syncUserScripts()
        .then(() => sendResponse({ ok: true }))
        .catch((e) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true;
    }

    if (type === 'USERSCRIPTS_TEST') {
      const scriptId = (payload as { id?: string })?.id ?? '';
      testModOnActiveTab(scriptId)
        .then(sendResponse)
        .catch((e) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true;
    }

    if (type === 'OPEN_EXTENSION_DETAILS') {
      const modId = (payload as { modId?: string } | undefined)?.modId;
      openExtensionDetailsWithWatcher(modId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    if (type === 'OPEN_PRACTICE_TAB') {
      const reqLang = (payload as { lang?: 'zh' | 'en' } | undefined)?.lang;
      const targetUrl =
        reqLang === 'en' ? `${DEFAULT_PRACTICE_URL}?lang=en` : DEFAULT_PRACTICE_URL;
      chrome.tabs
        .create({ url: targetUrl })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    if (type === 'COMPLETE_ONBOARDING') {
      const patch = (payload as { tutorialDone?: boolean } | undefined)?.tutorialDone
        ? { onboardingDone: true, tutorialDone: true }
        : { onboardingDone: true };
      updateSettings(() => patch)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    if (type === 'COMPLETE_TUTORIAL') {
      updateSettings(() => ({ tutorialDone: true }))
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    if (type === 'TEST_CONNECTION') {
      byokTestConnection(payload as AIConfig).then(sendResponse);
      return true;
    }

    if (type === 'LIST_MODELS') {
      byokListModels(payload as AIConfig).then(sendResponse);
      return true;
    }

    return false;
  });
});

let stopJsPermWatcher: (() => void) | null = null;

async function activateJsAndReturn(originTabId?: number, modId?: string): Promise<boolean> {
  await syncUserScripts().catch(() => {});
  let applied = false;
  if (typeof originTabId === 'number') {
    await chrome.tabs.update(originTabId, { active: true }).catch(() => {});
    if (modId) {
      const res = await testModOnTab(modId, originTabId).catch(() => ({ ok: false }));
      applied = Boolean(res?.ok);
    }
  }
  chrome.runtime
    .sendMessage({
      type: 'PAGECRAFT_USERSCRIPTS_ENABLED',
      payload: { modId, applied },
    })
    .catch(() => {});
  return applied;
}

async function openExtensionDetailsWithWatcher(modId?: string): Promise<void> {
  stopJsPermWatcher?.();
  stopJsPermWatcher = null;

  const [originTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const originTabId = originTab?.id && isScriptableTabUrl(originTab.url) ? originTab.id : undefined;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const detailsTab = await chrome.tabs.create({
    url: getExtensionDetailsUrl(chrome.runtime.id, ua),
  });

  const initial = await checkUserScriptsAvailability();
  if (initial.available) {
    await activateJsAndReturn(originTabId, modId);
    return;
  }

  let finished = false;
  const deadline = Date.now() + 90_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    finished = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    chrome.tabs.onRemoved.removeListener(onRemoved);
    if (stopJsPermWatcher === cleanup) {
      stopJsPermWatcher = null;
    }
  };

  const probeAndFinishIfReady = async () => {
    if (finished) return;
    if (Date.now() > deadline) {
      cleanup();
      return;
    }
    const avail = await checkUserScriptsAvailability();
    if (avail.available && !finished) {
      cleanup();
      await activateJsAndReturn(originTabId, modId);
    }
  };

  const onRemoved = (closedTabId: number) => {
    if (closedTabId === detailsTab.id) {
      void probeAndFinishIfReady().finally(cleanup);
    }
  };

  stopJsPermWatcher = cleanup;
  chrome.tabs.onRemoved.addListener(onRemoved);
  timer = setInterval(() => {
    void probeAndFinishIfReady();
  }, 700);
}

async function flushPendingJsApply(): Promise<void> {
  try {
    const raw = await chrome.storage.local.get(PENDING_JS_APPLY_KEY);
    const pending = raw?.[PENDING_JS_APPLY_KEY] as PendingJsApply | undefined;
    if (!pending) return;
    await chrome.storage.local.remove(PENDING_JS_APPLY_KEY);
    if (Date.now() - pending.ts > 2 * 60_000) return;

    const avail = await checkUserScriptsAvailability();
    if (!avail.available) return;
    await activateJsAndReturn(pending.tabId, pending.modId);
  } catch {
    /* ignore */
  }
}

async function testModOnActiveTab(scriptId: string) {
  return testModOnTab(scriptId);
}

async function testModOnTab(scriptId: string, explicitTabId?: number) {
  if (!scriptId) return { ok: false, error: 'missing script id' };
  const scripts = await readUserScripts();
  const script = scripts.find((s: UserScript) => s.id === scriptId);
  if (!script) return { ok: false, error: 'script not found' };

  if (!script.enabled) {
    await upsertUserScript({ ...script, enabled: true, updatedAt: Date.now() });
  }
  await syncUserScripts();

  const tab =
    typeof explicitTabId === 'number'
      ? await chrome.tabs.get(explicitTabId).catch(() => undefined)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  if (!tab?.id || !isScriptableTabUrl(tab.url)) {
    return { ok: false, error: 'no_reloadable_tab' };
  }

  if (script.engine === 'css') {
    await syncCssForTab(tab.id, tab.url);
    return { ok: true, reloaded: false };
  }

  await chrome.tabs.reload(tab.id);
  return { ok: true, reloaded: true };
}
