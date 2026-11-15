/**
 * Self-contained page-injected functions for `chrome.scripting.executeScript`.
 *
 * IMPORTANT: Every exported function below is serialized via `.toString()` by
 * Chrome and executed inside the target webpage's isolated world. Therefore,
 * NONE of these functions may reference module-scope imports or variables!
 */

import type { PickedElementContext } from '../../lib/userscripts/types';

/**
 * Interactive Shadow-DOM Element Picker injected on user request.
 * Sends `PAGECRAFT_ELEMENT_PICKED` or `PAGECRAFT_PICKER_CANCELLED` to runtime.
 */
export function injectElementPickerOverlay(lang: 'zh' | 'en'): { started: boolean } {
  const HOST_ID = '__pagecraft_picker_host__';
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
  }

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const EPHEMERAL_ID = /^(?:react-.*|radix-.*|headlessui-.*|:r[0-9a-z]+:|ember\d+|mui-\d+|\d+|[0-9a-f]{12,})$/i;
  const HASHED_CLS =
    /^(?:css-[0-9a-z]{5,}|sc-[a-zA-Z0-9]{5,}|svelte-[0-9a-z]{4,}|jsx-\d+|_[a-zA-Z0-9]{5,}_[a-zA-Z0-9]{4,}|style_[a-zA-Z0-9]+__[a-zA-Z0-9]{4,})$/;
  const SIMPLE_CLS = /^[a-zA-Z_-][a-zA-Z0-9_-]{1,39}$/;
  const NOISE_CLS = new Set([
    'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'hidden',
    'relative', 'absolute', 'fixed', 'sticky', 'w-full', 'h-full', 'mx-auto',
    'items-center', 'justify-between', 'justify-center', 'overflow-hidden',
    'pointer-events-none', 'cursor-pointer', 'transition', 'active', 'hover',
    'selected', 'open', 'focus', 'disabled',
  ]);
  const DATA_ATTRS = [
    'data-testid', 'data-test', 'data-qa', 'data-id', 'data-component', 'data-section', 'data-role',
  ];

  function redact(text: string, maxLen: number): string {
    return (text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b(sk-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{10,}|Bearer\s+\S+)\b/g, '[KEY]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
      .replace(/\b\d{8,19}\b/g, '[NUM]')
      .slice(0, maxLen);
  }

  function escAttr(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function cleanClasses(el: Element): string[] {
    const raw = typeof el.className === 'string' ? el.className : '';
    if (!raw) return [];
    const out: string[] = [];
    for (const tok of raw.split(/\s+/)) {
      const c = tok.trim();
      if (!c || !SIMPLE_CLS.test(c) || HASHED_CLS.test(c) || NOISE_CLS.has(c)) continue;
      out.push(c);
      if (out.length >= 2) break;
    }
    return out;
  }

  function nthAmongSameTag(el: Element): number | null {
    const parent = el.parentElement;
    if (!parent) return null;
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (same.length <= 1) return null;
    return same.indexOf(el) + 1;
  }

  function nodeSeg(el: Element, withNth: boolean): string {
    const tag = el.tagName.toLowerCase();
    const id = (el.id || '').trim();
    if (id && id.length <= 64 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) && !EPHEMERAL_ID.test(id)) {
      return '#' + id;
    }
    for (const attr of DATA_ATTRS) {
      const val = el.getAttribute(attr)?.trim();
      if (val && val.length <= 48 && !/\d{7,}/.test(val)) {
        return `${tag}[${attr}="${escAttr(val)}"]`;
      }
    }
    const cls = cleanClasses(el);
    const nth = withNth ? nthAmongSameTag(el) : null;
    if (cls.length > 0) {
      const base = `${tag}.${cls.join('.')}`;
      return nth && nth > 1 ? `${base}:nth-of-type(${nth})` : base;
    }
    const role = el.getAttribute('role')?.trim();
    if (role && /^[a-z-]{2,24}$/i.test(role)) {
      const base = `${tag}[role="${role.toLowerCase()}"]`;
      return nth && nth > 1 ? `${base}:nth-of-type(${nth})` : base;
    }
    return nth && nth > 1 ? `${tag}:nth-of-type(${nth})` : tag;
  }

  function safeCount(sel: string): number {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return 0;
    }
  }

  function computeBestSelector(target: Element): {
    selector: string;
    matchCount: number;
    similarSelector?: string;
    similarCount?: number;
  } {
    const parts: string[] = [];
    let cur: Element | null = target;
    let depth = 0;
    while (cur && depth < 4) {
      const tag = cur.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      const seg = nodeSeg(cur, true);
      parts.unshift(seg);
      const candidate = parts.join(' > ');
      const cnt = safeCount(candidate);
      if (cnt === 1 || seg.startsWith('#') || seg.includes('[data-testid=')) {
        break;
      }
      cur = cur.parentElement;
      depth++;
    }
    const selector = parts.join(' > ') || target.tagName.toLowerCase();
    const matchCount = safeCount(selector);

    const parent = target.parentElement;
    let similarSelector: string | undefined;
    let similarCount: number | undefined;
    if (parent && parent.tagName.toLowerCase() !== 'body') {
      const pSeg = nodeSeg(parent, false);
      const itemSeg = nodeSeg(target, false);
      const sim = `${pSeg} > ${itemSeg}`;
      const simCnt = safeCount(sim);
      if (simCnt >= 2 && sim !== selector) {
        similarSelector = sim;
        similarCount = simCnt;
      }
    }
    return { selector, matchCount, similarSelector, similarCount };
  }

  function serializeSkeleton(el: Element, depth = 0): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') {
      return `<${tag}/>`;
    }
    const attrs: string[] = [];
    const id = (el.id || '').trim();
    if (id && id.length <= 48) attrs.push(`id="${escAttr(id)}"`);
    const cls = typeof el.className === 'string' ? el.className.trim().slice(0, 80) : '';
    if (cls) attrs.push(`class="${escAttr(cls)}"`);
    for (const a of ['role', 'type', 'data-testid', 'data-id', 'aria-label', 'name']) {
      const v = el.getAttribute(a)?.trim();
      if (v) attrs.push(`${a}="${escAttr(redact(v, 40))}"`);
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('javascript:')) {
        attrs.push(`href="${escAttr(href.split('?')[0]?.slice(0, 60) ?? '')}"`);
      }
    }
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;

    if (tag === 'input' || tag === 'textarea' || tag === 'img' || tag === 'hr' || tag === 'br') {
      return open;
    }

    const children = Array.from(el.children);
    if (children.length === 0) {
      const txt = redact((el as HTMLElement).innerText || el.textContent || '', 60);
      return `${open}${txt}</${tag}>`;
    }
    if (depth >= 2) {
      return `${open}<!-- ${children.length} children --></${tag}>`;
    }
    const childHtml = children
      .slice(0, 8)
      .map((c) => serializeSkeleton(c, depth + 1))
      .join('\n' + '  '.repeat(depth + 1));
    const more = children.length > 8 ? `\n${'  '.repeat(depth + 1)}<!-- +${children.length - 8} more -->` : '';
    return `${open}\n${'  '.repeat(depth + 1)}${childHtml}${more}\n${'  '.repeat(depth)}</${tag}>`;
  }

  // Create Shadow DOM overlay
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });

  // Warm-amber sibling outline pool (up to 10 repeating sibling elements in view)
  const MAX_SIBLING_BOXES = 10;
  const siblingBoxes: HTMLDivElement[] = [];
  for (let i = 0; i < MAX_SIBLING_BOXES; i++) {
    const sb = document.createElement('div');
    sb.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:0;height:0;pointer-events:none;display:none;' +
      'border:1.5px dashed rgba(217,119,6,0.82);background:rgba(217,119,6,0.05);border-radius:5px;';
    siblingBoxes.push(sb);
    shadow.appendChild(sb);
  }

  function hideSiblingBoxes() {
    for (let i = 0; i < siblingBoxes.length; i++) {
      siblingBoxes[i]!.style.display = 'none';
    }
  }

  // Terracotta primary target frame
  const box = document.createElement('div');
  const boxTransition = prefersReducedMotion
    ? 'none'
    : 'top 50ms cubic-bezier(0.2,0.8,0.2,1),left 50ms cubic-bezier(0.2,0.8,0.2,1),width 50ms cubic-bezier(0.2,0.8,0.2,1),height 50ms cubic-bezier(0.2,0.8,0.2,1)';
  box.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:0;height:0;pointer-events:none;' +
    'border:2px solid #C95533;background:rgba(201,85,51,0.10);border-radius:6px;' +
    'box-shadow:0 0 0 1px rgba(250,248,245,0.35);' +
    `transition:${boxTransition};`;

  // Crisp Inspector Tooltip (selector + dimensions + warm-amber sibling count)
  const tagPill = document.createElement('div');
  tagPill.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;pointer-events:none;max-width:400px;' +
    'display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;' +
    'background:#161514;color:#F2EFE9;border:1px solid #292725;' +
    'font:500 11.5px/1.3 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;' +
    'font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.28);';

  const pillSelSpan = document.createElement('span');
  pillSelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;color:#F2EFE9;font-weight:600;';

  const pillDimSpan = document.createElement('span');
  pillDimSpan.style.cssText = 'color:#9A958E;flex-shrink:0;font-size:11px;';

  const pillSibSpan = document.createElement('span');
  pillSibSpan.style.cssText =
    'display:none;padding:1px 5px;border-radius:4px;background:rgba(217,119,6,0.18);' +
    'color:#FBBF24;border:1px solid rgba(217,119,6,0.35);font-size:10.5px;flex-shrink:0;';

  tagPill.append(pillSelSpan, pillDimSpan, pillSibSpan);

  // Top Developer-Tool HUD Bar
  const hud = document.createElement('div');
  hud.style.cssText =
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);pointer-events:auto;' +
    'display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;max-width:calc(100vw - 24px);' +
    'background:#161514;color:#F2EFE9;border:1px solid #292725;' +
    'font:500 12.5px/1.35 -apple-system,BlinkMacSystemFont,"Inter","PingFang SC",sans-serif;' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.32);';

  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:2px;background:#E06643;flex-shrink:0;';

  const label = document.createElement('span');
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  label.textContent =
    lang === 'zh'
      ? '指向页面元素并点击锁定目标'
      : 'Hover and click any element to target';

  const kbd = document.createElement('kbd');
  kbd.textContent = 'Esc';
  kbd.style.cssText =
    'padding:1px 5px;border-radius:4px;background:#211F1D;border:1px solid #3B3835;' +
    'color:#9A958E;font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;flex-shrink:0;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = lang === 'zh' ? '取消' : 'Cancel';
  cancelBtn.style.cssText =
    'padding:3px 9px;border-radius:5px;border:1px solid #3B3835;' +
    'background:#211F1D;color:#F2EFE9;font:500 12px/1.25 inherit;cursor:pointer;flex-shrink:0;';

  hud.append(dot, label, kbd, cancelBtn);
  shadow.append(box, tagPill, hud);
  document.documentElement.appendChild(host);

  let hoveredEl: Element | null = null;
  let rafId = 0;

  function cleanup() {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('mousedown', swallowPointer, true);
    window.removeEventListener('mouseup', swallowPointer, true);
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  }

  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
    chrome.runtime.sendMessage({ type: 'PAGECRAFT_PICKER_CANCELLED' }).catch(() => {});
  });

  function swallowPointer(e: MouseEvent) {
    if (e.composedPath().includes(hud)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onMove(e: MouseEvent) {
    if (e.composedPath().includes(hud)) return;
    const x = e.clientX;
    const y = e.clientY;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const el = document.elementFromPoint(x, y);
      if (!el || el === host || el === document.documentElement || el === document.body) {
        hoveredEl = null;
        box.style.width = '0px';
        tagPill.style.top = '-9999px';
        hideSiblingBoxes();
        return;
      }
      hoveredEl = el;
      const rect = el.getBoundingClientRect();
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;

      const info = computeBestSelector(el);
      pillSelSpan.textContent = info.selector;
      pillDimSpan.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

      if (info.similarSelector && info.similarCount && info.similarCount > 1) {
        pillSibSpan.style.display = 'inline-block';
        pillSibSpan.textContent =
          lang === 'zh' ? `同类 ${info.similarCount}` : `${info.similarCount} similar`;

        try {
          const allSibs = document.querySelectorAll(info.similarSelector);
          let idx = 0;
          for (let i = 0; i < allSibs.length && idx < siblingBoxes.length; i++) {
            const sib = allSibs[i]!;
            if (sib === el) continue;
            const sr = sib.getBoundingClientRect();
            if (
              sr.width < 2 ||
              sr.height < 2 ||
              sr.bottom < 0 ||
              sr.top > window.innerHeight ||
              sr.right < 0 ||
              sr.left > window.innerWidth
            ) {
              continue;
            }
            const sb = siblingBoxes[idx]!;
            sb.style.display = 'block';
            sb.style.top = `${sr.top}px`;
            sb.style.left = `${sr.left}px`;
            sb.style.width = `${sr.width}px`;
            sb.style.height = `${sr.height}px`;
            idx++;
          }
          for (let j = idx; j < siblingBoxes.length; j++) {
            siblingBoxes[j]!.style.display = 'none';
          }
        } catch {
          hideSiblingBoxes();
        }
      } else {
        pillSibSpan.style.display = 'none';
        hideSiblingBoxes();
      }

      const pillTop =
        rect.top > 32 ? rect.top - 28 : Math.min(window.innerHeight - 30, rect.bottom + 6);
      const maxLeft = Math.max(8, window.innerWidth - 320);
      tagPill.style.top = `${Math.max(8, pillTop)}px`;
      tagPill.style.left = `${Math.max(8, Math.min(maxLeft, rect.left))}px`;
    });
  }

  function onClick(e: MouseEvent) {
    if (e.composedPath().includes(hud)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = hoveredEl || document.elementFromPoint(e.clientX, e.clientY);
    cleanup();

    if (!target || target === host) {
      chrome.runtime.sendMessage({ type: 'PAGECRAFT_PICKER_CANCELLED' }).catch(() => {});
      return;
    }

    const selInfo = computeBestSelector(target);
    const rect = target.getBoundingClientRect();
    const cs = window.getComputedStyle(target);
    const attrs: Record<string, string> = {};
    for (const name of ['id', 'class', 'role', 'type', 'data-testid', 'data-id', 'aria-label']) {
      const val = target.getAttribute(name);
      if (val) attrs[name] = redact(val, 80);
    }

    const isPassword =
      target.tagName.toLowerCase() === 'input' &&
      (target.getAttribute('type') || '').toLowerCase() === 'password';
    const rawText = isPassword
      ? ''
      : (target as HTMLElement).innerText || target.textContent || '';

    const contextRoot =
      target.parentElement && target.parentElement.tagName.toLowerCase() !== 'body'
        ? target.parentElement
        : target;
    const domSnippet = serializeSkeleton(contextRoot, 0).slice(0, 1800);

    let safeUrl = location.origin + location.pathname;
    try {
      safeUrl = `${location.protocol}//${location.host}${location.pathname.slice(0, 80)}`;
    } catch {
      /* ignore */
    }

    const payload: PickedElementContext = {
      selector: selInfo.selector,
      matchCount: selInfo.matchCount,
      similarSelector: selInfo.similarSelector,
      similarCount: selInfo.similarCount,
      tag: target.tagName.toLowerCase(),
      textPreview: redact(rawText, 120) || undefined,
      attributes: attrs,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        dpr:
          typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1,
      },
      computedStyles: {
        display: cs.display,
        position: cs.position,
        zIndex: cs.zIndex,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
      },
      domSnippet,
      pageUrl: safeUrl,
      pageTitle: redact(document.title || '', 80) || undefined,
    };

    chrome.runtime
      .sendMessage({ type: 'PAGECRAFT_ELEMENT_PICKED', payload })
      .catch(() => {});
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      chrome.runtime.sendMessage({ type: 'PAGECRAFT_PICKER_CANCELLED' }).catch(() => {});
    }
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mousedown', swallowPointer, true);
  window.addEventListener('mouseup', swallowPointer, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);

  return { started: true };
}

/** Tear down the Element Picker overlay if currently active in the tab. */
export function removeElementPickerOverlay(): boolean {
  const el = document.getElementById('__pagecraft_picker_host__');
  if (el) {
    el.remove();
    return true;
  }
  return false;
}

/**
 * Capture a rich, selector-preserving structural snapshot of the current page
 * (landmarks, tables, lists, modals, buttons, semantic classes & IDs — never
 * input values, passwords, cookies, or query tokens).
 */
export function extractLivePageContext(): string {
  const SELECTOR =
    'header,nav,main,aside,article,section,footer,dialog,[role="dialog"],table,form,ul,ol,h1,h2,button,[data-testid]';
  const MAX_ITEMS = 90;

  function redactInline(text: string): string {
    return (text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,})\b/g, '[KEY]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
      .replace(/\b\d{8,19}\b/g, '[NUM]')
      .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1?[REDACTED]')
      .slice(0, 36);
  }

  const lines: string[] = [];
  const nodes = document.querySelectorAll(SELECTOR);
  for (let i = 0; i < nodes.length && lines.length < MAX_ITEMS; i++) {
    const el = nodes[i]!;
    if (el.id === '__pagecraft_picker_host__') continue;
    const tag = el.tagName.toLowerCase();
    let desc = tag;
    if (el.id && el.id.length <= 48) {
      desc += `#${el.id.trim()}`;
    }
    const cls =
      typeof el.className === 'string'
        ? el.className
            .split(/\s+/)
            .map((c) => c.trim())
            .filter((c) => c && c.length <= 36 && !/^(flex|grid|block|hidden|relative)$/.test(c))
            .slice(0, 3)
        : [];
    if (cls.length > 0) {
      desc += `.${cls.join('.')}`;
    }
    const role = el.getAttribute('role');
    if (role && role.length <= 24) desc += `[role="${role}"]`;
    const testId = el.getAttribute('data-testid');
    if (testId && testId.length <= 40) desc += `[data-testid="${testId}"]`;

    if (tag === 'table') {
      desc += ` (${el.querySelectorAll('tr').length} rows)`;
    } else if (tag === 'ul' || tag === 'ol') {
      const cnt = el.children.length;
      if (cnt < 2) continue;
      desc += ` (${cnt} items)`;
    } else if (tag === 'button' || tag === 'h1' || tag === 'h2') {
      const label = redactInline((el as HTMLElement).innerText || '');
      if (label) desc += ` "${label}"`;
    }
    lines.push(desc);
  }
  return lines.join('\n').slice(0, 3400);
}

/** Verify how many live DOM elements match each candidate CSS selector. */
export function probeTargetSelectors(
  selectors: string[],
): Array<{ selector: string; count: number }> {
  const out: Array<{ selector: string; count: number }> = [];
  for (const raw of selectors || []) {
    const sel = (raw || '').trim();
    if (!sel) continue;
    try {
      out.push({ selector: sel, count: document.querySelectorAll(sel).length });
    } catch {
      out.push({ selector: sel, count: 0 });
    }
  }
  return out;
}
