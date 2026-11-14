/**
 * Lightweight, local-only Tampermonkey / Greasemonkey (`GM_*` & `GM.*`) compatibility
 * prelude for imported `.user.js` scripts running in PageCraft's `USER_SCRIPT` world.
 *
 * Security & Chrome Web Store MV3 compliance:
 * - Strictly ZERO remote code fetching (`@require` is never downloaded or evaluated)
 * - Strictly ZERO cross-origin proxy (`GM_xmlhttpRequest` is not shimmed; same-origin
 *   requests or CORS-enabled endpoints work via standard `fetch`)
 * - Injected ONLY when a user's script actually references `GM_*`, `GM.*`, or `unsafeWindow`,
 *   keeping PageCraft's own AI-generated and template scripts untouched.
 */

import type { UserScript } from './types';

const GM_IDENTIFIER_RE = /\b(?:GM_[a-zA-Z0-9_]+|GM\.[a-zA-Z0-9_]+|unsafeWindow)\b/;

export function needsGmShim(code: string): boolean {
  return GM_IDENTIFIER_RE.test(code);
}

export function wrapWithGmShimIfNeeded(
  script: Pick<UserScript, 'id' | 'name' | 'description' | 'matches' | 'code'>,
): string {
  if (!needsGmShim(script.code)) {
    return script.code;
  }

  const metaJson = JSON.stringify({
    id: script.id.slice(0, 16),
    name: script.name,
    description: script.description || '',
    matches: script.matches,
  });

  // Self-contained ES2020 prelude executed inside the isolated USER_SCRIPT world.
  return `(() => {
  const __pcMeta = ${metaJson};
  const __pcPrefix = '__pc_gm_' + __pcMeta.id + ':';
  const __pcMem = new Map();

  const unsafeWindow = window;
  const GM_info = {
    scriptHandler: 'PageCraft',
    version: '0.1.0',
    script: {
      name: __pcMeta.name,
      description: __pcMeta.description,
      version: '1.0.0',
      matches: __pcMeta.matches,
    },
  };

  function GM_addStyle(css) {
    const style = document.createElement('style');
    style.setAttribute('data-pc-gm', __pcMeta.id);
    style.textContent = String(css ?? '');
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function GM_addElement(a, b, c) {
    const hasParent = typeof a !== 'string' && a && typeof a.appendChild === 'function';
    const parent = hasParent ? a : document.head || document.documentElement;
    const tag = String(hasParent ? b : a || 'div');
    const attrs = (hasParent ? c : b) || {};
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === 'textContent' || k === 'innerHTML' || k === 'value' || k === 'checked') {
        el[k] = v;
      } else {
        el.setAttribute(k, String(v));
      }
    }
    parent.appendChild(el);
    return el;
  }

  function GM_getValue(key, defaultValue) {
    const full = __pcPrefix + String(key);
    try {
      const raw = window.localStorage.getItem(full);
      if (raw !== null) return JSON.parse(raw);
    } catch {}
    return __pcMem.has(full) ? __pcMem.get(full) : defaultValue;
  }

  function GM_setValue(key, value) {
    const full = __pcPrefix + String(key);
    const serialized = JSON.stringify(value === undefined ? null : value);
    __pcMem.set(full, value);
    try {
      window.localStorage.setItem(full, serialized);
    } catch {}
  }

  function GM_deleteValue(key) {
    const full = __pcPrefix + String(key);
    __pcMem.delete(full);
    try {
      window.localStorage.removeItem(full);
    } catch {}
  }

  function GM_listValues() {
    const keys = new Set();
    for (const k of __pcMem.keys()) {
      if (k.startsWith(__pcPrefix)) keys.add(k.slice(__pcPrefix.length));
    }
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(__pcPrefix)) keys.add(k.slice(__pcPrefix.length));
      }
    } catch {}
    return [...keys];
  }

  function GM_setClipboard(data) {
    const text = String(data ?? '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {}
  }

  function GM_openInTab(url) {
    const raw = String(url ?? '').trim();
    if (!/^https?:\\/\\//i.test(raw)) return null;
    const win = window.open(raw, '_blank', 'noopener,noreferrer');
    return { close: () => win && win.close(), closed: !win };
  }

  function GM_log(...args) {
    console.log('[PageCraft:' + __pcMeta.name + ']', ...args);
  }

  function GM_notification(detailsOrText, titleArg) {
    const text =
      typeof detailsOrText === 'string'
        ? detailsOrText
        : String((detailsOrText && detailsOrText.text) || '');
    const title =
      typeof detailsOrText === 'object' && detailsOrText && detailsOrText.title
        ? String(detailsOrText.title)
        : titleArg
          ? String(titleArg)
          : __pcMeta.name;
    if (!text) return;
    const toast = document.createElement('div');
    toast.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483646;max-width:320px;padding:10px 14px;' +
      'border-radius:10px;background:#1c1917;color:#faf8f5;font:500 13px/1.45 -apple-system,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.25);cursor:pointer;';
    toast.textContent = title ? title + ' · ' + text : text;
    toast.onclick = () => {
      if (typeof detailsOrText === 'object' && detailsOrText && typeof detailsOrText.onclick === 'function') {
        try { detailsOrText.onclick(); } catch {}
      }
      toast.remove();
    };
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  let __pcMenuSeq = 0;
  const __pcMenuItems = new Map();
  let __pcMenuHost = null;

  function __pcRenderMenu() {
    if (__pcMenuItems.size === 0) {
      if (__pcMenuHost) { __pcMenuHost.remove(); __pcMenuHost = null; }
      return;
    }
    if (!__pcMenuHost) {
      __pcMenuHost = document.createElement('div');
      __pcMenuHost.id = '__pc_gm_menu_' + __pcMeta.id;
      __pcMenuHost.style.cssText =
        'position:fixed;right:14px;bottom:14px;z-index:2147483645;font:500 12px/1.3 -apple-system,sans-serif;';
      (document.body || document.documentElement).appendChild(__pcMenuHost);
    }
    __pcMenuHost.textContent = '';
    const details = document.createElement('details');
    details.style.cssText =
      'background:#1c1917;color:#faf8f5;border-radius:10px;padding:6px 10px;box-shadow:0 6px 20px rgba(0,0,0,0.22);';
    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;user-select:none;list-style:none;font-weight:600;';
    summary.textContent = '⚙ ' + __pcMeta.name;
    details.appendChild(summary);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.14);';
    for (const [, item] of __pcMenuItems) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.caption;
      btn.style.cssText =
        'text-align:left;border:0;border-radius:6px;padding:5px 8px;background:rgba(255,255,255,0.08);color:#fff;font-size:12px;cursor:pointer;';
      btn.onclick = (ev) => {
        details.open = false;
        try { item.fn(ev); } catch (err) { console.error(err); }
      };
      list.appendChild(btn);
    }
    details.appendChild(list);
    __pcMenuHost.appendChild(details);
  }

  function GM_registerMenuCommand(caption, fn) {
    const id = ++__pcMenuSeq;
    if (typeof fn === 'function') {
      __pcMenuItems.set(id, { caption: String(caption || 'Action'), fn });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', __pcRenderMenu, { once: true });
      } else {
        __pcRenderMenu();
      }
    }
    return id;
  }

  function GM_unregisterMenuCommand(id) {
    __pcMenuItems.delete(id);
    __pcRenderMenu();
  }

  const GM = {
    info: GM_info,
    addStyle: async (css) => GM_addStyle(css),
    addElement: async (a, b, c) => GM_addElement(a, b, c),
    getValue: async (k, d) => GM_getValue(k, d),
    setValue: async (k, v) => GM_setValue(k, v),
    deleteValue: async (k) => GM_deleteValue(k),
    listValues: async () => GM_listValues(),
    setClipboard: async (d) => GM_setClipboard(d),
    openInTab: async (u) => GM_openInTab(u),
    notification: async (d, t) => GM_notification(d, t),
    registerMenuCommand: async (c, f) => GM_registerMenuCommand(c, f),
    unregisterMenuCommand: async (id) => GM_unregisterMenuCommand(id),
  };

${script.code}
})();`;
}
