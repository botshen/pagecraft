/**
 * Zero-credit, deterministic instant CSS generator for the official
 * `https://pagecraft.shenxin.space/playground` 20-second onboarding sandbox.
 *
 * Ensures first-time users can practice "Pick -> Generate -> Apply" in ~0.2s:
 * - Consumes 0 of the user's 10 free cloud AI trial generations
 * - Works 100% reliably offline/before cloud LLM keys are configured
 * - Falls through (`null`) if the user explicitly asks for interactive JS logic
 *   (e.g. CSV export button, copy button) so real AI generation handles those.
 */

import type {
  GeneratedUserScript,
  GenerateUserScriptPayload,
} from './types';

export const PLAYGROUND_MATCH_PATTERN = 'https://pagecraft.shenxin.space/playground*';

const JS_INTENT_RE =
  /(?:\bcsv\b|\bexcel\b|\bexport\b|\bbutton\b|\bcopy\b|\bshortcut\b|导出|复制|按钮|快捷键|自动点击|脚本)/i;

const OVERDUE_ROW_RE = /(?:逾期|overdue|标红|highlight\s+(?:table\s+)?rows?)/i;

export function isPlaygroundUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.hostname.toLowerCase() !== 'pagecraft.shenxin.space') return false;
    return parsed.pathname === '/playground' || parsed.pathname.startsWith('/playground/');
  } catch {
    return false;
  }
}

export function defaultPlaygroundIntent(
  pickedSelector: string | undefined,
  lang: 'zh' | 'en',
): string {
  const sel = (pickedSelector ?? '').toLowerCase();
  const zh = lang === 'zh';
  if (sel.includes('pc-demo-banner')) {
    return zh
      ? '隐藏这个顶部推广横幅，让阅读区干净清爽'
      : 'Hide this top promo banner for a clean reading view';
  }
  if (sel.includes('pc-demo-sidebar')) {
    return zh
      ? '隐藏右侧杂乱推荐栏，并让正文自动加宽铺满'
      : 'Hide this noisy right sidebar and widen the article';
  }
  if (sel.includes('pc-demo-float')) {
    return zh ? '隐藏右下角悬浮领券角标' : 'Hide this floating corner promo widget';
  }
  if (sel.includes('pc-demo-table') || sel.includes('overdue') || /\btr\b/.test(sel)) {
    return zh
      ? '把表格里状态为「逾期」的数据行高亮标红'
      : 'Highlight table rows where status is Overdue';
  }
  return zh
    ? '隐藏这个干扰区域，并把正文加宽居中'
    : 'Hide this distracting block and widen the article';
}

function isSafeCssSelector(sel: string): boolean {
  return (
    sel.length > 0 &&
    sel.length <= 120 &&
    !/[{};<>@\\]/.test(sel)
  );
}

export function tryBuildPlaygroundMod(
  payload: GenerateUserScriptPayload,
): GeneratedUserScript | null {
  if (!isPlaygroundUrl(payload.targetUrl)) return null;
  if (payload.previousMod && payload.previousMod.engine === 'js') return null;

  const intent = (payload.intent ?? '').trim();
  if (!intent) return null;

  // Let genuine interactive JS requests fall through to AI generation.
  if (JS_INTENT_RE.test(intent)) return null;

  const zh = (payload.lang ?? 'zh') === 'zh';
  const pickedSel = payload.pickedElement?.selector?.trim() ?? '';

  // 1. Sample table overdue row highlight
  if (
    OVERDUE_ROW_RE.test(intent) &&
    !/隐藏|移除|删除|\bhide\b|\bremove\b/i.test(intent)
  ) {
    const sel = '#pc-demo-table tr[data-status="overdue"]';
    return {
      name: zh ? '靶场练习：高亮逾期数据行' : 'Sandbox: Highlight Overdue Rows',
      description: zh
        ? '将示例表格中状态为「逾期」的行柔和标红醒目提示'
        : 'Highlights overdue rows in the sample metrics table',
      engine: 'css',
      matches: [PLAYGROUND_MATCH_PATTERN],
      code: '',
      css: `/* ${zh ? '高亮状态为逾期的表格行' : 'Highlight overdue table rows'} */\n${sel} td {\n  background: rgba(220, 38, 38, 0.10) !important;\n  color: #b91c1c !important;\n  font-weight: 600 !important;\n}`,
      targetSelectors: [sel],
      explanation: zh
        ? '已定位示例表中的逾期数据行并着色高亮。纯 CSS 样式注入，无需开启任何额外开关，点击「应用并保存」即可实时生效。'
        : 'Targets overdue rows in the sample table with a soft red highlight. Pure CSS—click "Apply & Save" to see it live.',
    };
  }

  // 2. Visual cleanup / layout / typography reshaping on the sandbox page
  const hideSet = new Set<string>();
  const prevCss = payload.previousMod?.css ?? '';
  for (const known of ['#pc-demo-banner', '#pc-demo-sidebar', '#pc-demo-float']) {
    if (prevCss.includes(known)) hideSet.add(known);
  }

  if (pickedSel.includes('pc-demo-banner')) hideSet.add('#pc-demo-banner');
  else if (pickedSel.includes('pc-demo-sidebar')) hideSet.add('#pc-demo-sidebar');
  else if (pickedSel.includes('pc-demo-float')) hideSet.add('#pc-demo-float');
  else if (
    pickedSel &&
    isSafeCssSelector(pickedSel) &&
    !pickedSel.includes('pc-demo-article') &&
    !pickedSel.includes('pc-demo-layout')
  ) {
    hideSet.add(pickedSel);
  }

  if (/(?:横幅|顶部|弹窗|客户端|banner|nag|promo)/i.test(intent)) {
    hideSet.add('#pc-demo-banner');
  }
  if (/(?:侧栏|侧边|右侧|推荐|热搜|sidebar|right|rail)/i.test(intent)) {
    hideSet.add('#pc-demo-sidebar');
  }
  if (/(?:悬浮|角标|红包|右下|float|corner|widget)/i.test(intent)) {
    hideSet.add('#pc-demo-float');
  }

  if (
    hideSet.size === 0 &&
    /(?:隐藏|去掉|移除|清理|干净|净化|\bhide\b|\bremove\b|\bclean\b)/i.test(intent)
  ) {
    hideSet.add('#pc-demo-banner');
    hideSet.add('#pc-demo-sidebar');
    hideSet.add('#pc-demo-float');
  }

  const wantWiden =
    hideSet.has('#pc-demo-sidebar') ||
    /(?:加宽|居中|宽屏|铺满|\bwiden\b|\bwide\b|\bcenter\b)/i.test(intent);
  const wantWarm = /(?:护眼|暖白|暖色|纸底|纸感|\bwarm\b|\bpaper\b)/i.test(intent);
  const wantLargerFont = /(?:字号|放大|大字|\bfont\b|\blarger\b)/i.test(intent);

  // Default fallback on playground if user typed a generic visual tweak without matching above
  if (hideSet.size === 0 && !wantWiden && !wantWarm && !wantLargerFont) {
    hideSet.add('#pc-demo-banner');
    hideSet.add('#pc-demo-sidebar');
  }

  const cssBlocks: string[] = [];
  const targetSelectors: string[] = [];

  if (hideSet.size > 0) {
    const list = [...hideSet];
    targetSelectors.push(...list.slice(0, 3));
    cssBlocks.push(
      `/* ${zh ? '隐藏选中的干扰模块' : 'Hide distracting target blocks'} */\n${list.join(',\n')} {\n  display: none !important;\n}`,
    );
  }

  if (wantWiden) {
    if (!targetSelectors.includes('#pc-demo-article')) {
      targetSelectors.push('#pc-demo-article');
    }
    cssBlocks.push(
      `/* ${zh ? '正文舒展加宽' : 'Expand article column smoothly'} */\n#pc-demo-article {\n  max-width: 100% !important;\n}`,
    );
  }

  if (wantWarm) {
    cssBlocks.push(
      `/* ${zh ? '柔和暖白纸感护眼底色' : 'Warm paper reading background'} */\nbody {\n  background: #f5efe2 !important;\n}\n#pc-demo-article {\n  background: #fbf8f0 !important;\n}`,
    );
  }

  if (wantLargerFont) {
    cssBlocks.push(
      `/* ${zh ? '舒适阅读字号与行距' : 'Comfortable reading typography'} */\n#pc-demo-article .article-p {\n  font-size: 16.5px !important;\n  line-height: 1.8 !important;\n}`,
    );
  }

  const bothBannerAndSidebar =
    hideSet.has('#pc-demo-banner') && hideSet.has('#pc-demo-sidebar');
  const name = bothBannerAndSidebar
    ? zh
      ? '靶场净化：去横幅与侧栏并加宽正文'
      : 'Sandbox Clean Reader: Hide Banner & Sidebar'
    : hideSet.has('#pc-demo-banner')
      ? zh
        ? '靶场净化：隐藏顶部推广横幅'
        : 'Sandbox: Hide Top Promo Banner'
      : hideSet.has('#pc-demo-sidebar')
        ? zh
          ? '靶场净化：隐藏右侧推荐栏并加宽正文'
          : 'Sandbox: Hide Right Sidebar & Widen Article'
        : zh
          ? '靶场网页净化与排版优化'
          : 'Sandbox Layout Cleanup';

  return {
    name,
    description: zh
      ? '隐藏干扰区块并舒展正文排版（靶场练习 · 不扣免费额度）'
      : 'Hides target clutter and expands the article (Sandbox · 0 quota used)',
    engine: 'css',
    matches: [PLAYGROUND_MATCH_PATTERN],
    code: '',
    css: cssBlocks.join('\n\n'),
    targetSelectors: targetSelectors.slice(0, 4),
    explanation: zh
      ? '已生成纯 CSS 净化样式（靶场练习不消耗 10 次免费云端额度）。点击下方「应用并保存」，左侧靶场页面将在 0.1 秒内实时变干净！'
      : 'Generated pure CSS rules (sandbox practice uses 0 of your 10 free cloud credits). Click "Apply & Save" below to reshape the page in 0.1s!',
  };
}
