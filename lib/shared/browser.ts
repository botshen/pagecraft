/**
 * Pure browser / URL / tab helpers shared across Background, Welcome, and SidePanel.
 */

const BLOCKED_EXTENSION_STORE_HOSTS = new Set([
  'chromewebstore.google.com',
  'microsoftedge.microsoft.com',
  'addons.mozilla.org',
]);

export const PENDING_JS_APPLY_KEY = 'pc_pending_js_apply';

export interface PendingJsApply {
  modId?: string;
  tabId?: number;
  ts: number;
}

/**
 * True only for http(s) webpages where `chrome.scripting` / `chrome.userScripts`
 * are permitted (excludes browser internal pages and extension web stores).
 */
export function isScriptableTabUrl(url?: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_EXTENSION_STORE_HOSTS.has(host)) return false;
    if (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the per-extension details page URL for Chrome, Edge, or other
 * Chromium browsers so the user lands directly on the "Allow User Scripts" toggle.
 */
export function getExtensionDetailsUrl(extensionId: string, userAgent = ''): string {
  const scheme = /\bEdg\//.test(userAgent) ? 'edge' : 'chrome';
  return `${scheme}://extensions/?id=${extensionId}`;
}

/**
 * Pick an existing scriptable webpage tab in the current window to hand the
 * user off to after completing onboarding (never leaving them on a blank New Tab
 * or blocked Web Store page).
 */
export function pickLandingTab<T extends { id?: number; url?: string }>(
  tabs: T[],
  excludeTabId?: number,
): T | undefined {
  return tabs.find(
    (t) => typeof t.id === 'number' && t.id !== excludeTabId && isScriptableTabUrl(t.url),
  );
}
