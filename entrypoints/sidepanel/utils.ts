import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PENDING_JS_APPLY_KEY, type PendingJsApply } from '~/lib/shared/browser';
import type { UserScriptsAvailability } from '~/lib/userscripts/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Probe `chrome.userScripts` inside a freshly created extension iframe so we can
 * tell "toggle still OFF" apart from "toggle turned ON, running SW needs reload".
 */
export function probeUserScriptsInFreshFrame(timeoutMs = 1500): Promise<boolean> {
  if (
    typeof document === 'undefined' ||
    typeof chrome === 'undefined' ||
    !chrome.runtime?.getURL
  ) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    let settled = false;

    const cleanup = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
      resolve(result);
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'PAGECRAFT_USERSCRIPTS_PROBE') {
        cleanup(Boolean(e.data.available));
      }
    };

    const timer = setTimeout(() => cleanup(false), timeoutMs);
    window.addEventListener('message', onMessage);
    iframe.src = chrome.runtime.getURL('/probe.html');
    document.body.appendChild(iframe);
  });
}

export async function recheckOrRecoverJsPermission(opts: {
  recheck: () => Promise<UserScriptsAvailability>;
  modId?: string;
  tabId?: number;
  beforeReload?: () => void;
}): Promise<'available' | 'reloading' | 'disabled'> {
  const avail = await opts.recheck();
  if (avail.available) return 'available';

  const freshReady = await probeUserScriptsInFreshFrame();
  if (!freshReady) return 'disabled';

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const pending: PendingJsApply = {
      modId: opts.modId,
      tabId: opts.tabId,
      ts: Date.now(),
    };
    await chrome.storage.local.set({ [PENDING_JS_APPLY_KEY]: pending }).catch(() => {});
  }
  opts.beforeReload?.();
  if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
    setTimeout(() => chrome.runtime.reload(), 350);
    return 'reloading';
  }
  return 'disabled';
}
