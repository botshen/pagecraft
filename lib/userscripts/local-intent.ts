/**
 * Zero-Config / Zero-AI Local Deterministic Mod Builder.
 *
 * Allows brand-new users (with zero API key, zero Ollama, and zero Chrome
 * Built-in AI flags) to:
 *  1. Click any annoying ad / popup / sidebar / element on a real website and
 *     hide or restyle it in <10ms locally (`engine: 'css'`, 0 permissions).
 *  2. Trigger common picked-element transformations (hide, hide similar items,
 *     enlarge typography, widen container, dim/blur, highlight, or add a CSV
 *     export button to a table) without hitting a `missing_api_key` wall.
 *  3. Fast-path unambiguous single-purpose "Hide this element" actions even
 *     when a cloud LLM IS configured, saving 3-5 seconds and API tokens while
 *     leaving compound or nuanced requests to the full AI engine.
 */

import { BUILTIN_TEMPLATES } from './templates';
import { hostPatternFromUrl } from './store';
import type { GeneratedUserScript, GenerateUserScriptPayload } from './types';

export function isSafePickedSelector(sel?: string): boolean {
  if (!sel) return false;
  const trimmed = sel.trim();
  if (!trimmed || trimmed.length > 240) return false;
  return !/[{};<>@\\]/.test(trimmed);
}

export function isRootDocumentSelector(sel: string): boolean {
  const normalized = sel.trim().toLowerCase();
  return normalized === 'html' || normalized === 'body' || normalized === ':root';
}

function resolveTargetMatch(targetUrl?: string): { hostPat: string; hostLabel: string } | null {
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) return null;
  const hostPat = hostPatternFromUrl(targetUrl);
  if (!hostPat) return null;
  let hostLabel = targetUrl;
  try {
    hostLabel = new URL(targetUrl).hostname;
  } catch {
    /* ignore */
  }
  return { hostPat, hostLabel };
}

export interface DirectHideModOptions {
  selector: string;
  targetUrl?: string;
  lang?: 'zh' | 'en';
  isSimilarGroup?: boolean;
  similarCount?: number;
}

/**
 * Build a ready-to-save CSS mod that hides the given selector on `targetUrl`'s host.
 * Used both by the 1-click "Instant Hide" button in Studio and by local intent resolution.
 */
export function buildDirectHideMod(opts: DirectHideModOptions): GeneratedUserScript | null {
  const selector = opts.selector?.trim();
  if (!isSafePickedSelector(selector) || isRootDocumentSelector(selector)) {
    return null;
  }
  const match = resolveTargetMatch(opts.targetUrl);
  if (!match) return null;

  const isZh = opts.lang !== 'en';
  const groupSuffixZh =
    opts.isSimilarGroup && opts.similarCount && opts.similarCount > 1
      ? `（共 ${opts.similarCount} 处同类项）`
      : '';
  const groupSuffixEn =
    opts.isSimilarGroup && opts.similarCount && opts.similarCount > 1
      ? ` (${opts.similarCount} similar items)`
      : '';

  return {
    name: isZh
      ? opts.isSimilarGroup
        ? `隐藏同类干扰模块 · ${match.hostLabel}`
        : `隐藏选中模块 · ${match.hostLabel}`
      : opts.isSimilarGroup
        ? `Hide Similar Blocks · ${match.hostLabel}`
        : `Hide Picked Element · ${match.hostLabel}`,
    description: isZh
      ? `自动隐藏 ${selector}${groupSuffixZh}，下次打开该网站依然保持清爽`
      : `Permanently hides ${selector}${groupSuffixEn} on ${match.hostLabel}`,
    engine: 'css',
    matches: [match.hostPat],
    code: '',
    css: `${selector} {\n  display: none !important;\n}`,
    targetSelectors: [selector],
    explanation: isZh
      ? `已为你通过本地免 AI 规则锁定 \`${selector}\`${groupSuffixZh} 并注入高优先级隐藏样式，无需填写任何 API Key。`
      : `Locally generated a zero-AI CSS rule hiding \`${selector}\`${groupSuffixEn}—no API key required.`,
  };
}

const COMPOUND_INTENT_GUARDS =
  /并且|同时|顺便|而且|另外|再把|并把|改成|改为|变成|颜色|背景|字号|字体|导出|按钮|点击|自动|脚本|\band\b|\balso\b|\bthen\b|\bwith\b|\bcolor\b|\bfont\b|\bexport\b|[;；]/i;

const PURE_HIDE_EXACT_SET = new Set([
  '隐藏这个元素',
  'hide this element',
  '隐藏这个干扰区域，让正文区域干净易读',
  'hide this distracting block cleanly',
  '隐藏所有同类元素',
  'hide all similar items',
]);

const PURE_HIDE_ZH_RE =
  /^(?:请|帮我|麻烦)?(?:把|将)?(?:这个|该|此|这块|当前|所有同类|全部同类|同类)?(?:的)?(?:广告|弹窗|横幅|侧栏|侧边栏|元素|区域|模块|区块|浮窗|挂件|卡片|遮罩|推荐|东西|它)?(?:彻底|直接|永久)?(?:隐藏|去掉|移除|删掉|删除|关掉|屏蔽)(?:掉|它|吧|呀|啦)?[!！。.…]*$/i;

const PURE_HIDE_EN_RE =
  /^(?:please\s+)?(?:hide|remove|block|dismiss|delete)\s+(?:this(?:\s+(?:element|ad|banner|popup|modal|sidebar|block|widget|card|section|box))?|all\s+similar(?:\s+(?:items|elements|blocks|cards))?|it)(?:\s+cleanly|\s+completely|\s+permanently)?[!.]*$/i;

function wantsSimilarGroup(intent: string): boolean {
  return /同类|所有这类|全部这类|整组|列表每一项|all\s+similar|similar\s+(?:items|elements|cards|blocks)/i.test(
    intent,
  );
}

function buildTargetedCsvMod(
  tableSelector: string,
  hostPat: string,
  hostLabel: string,
  isZh: boolean,
): GeneratedUserScript {
  const escapedSel = JSON.stringify(tableSelector);
  const btnText = isZh ? '⬇ 导出 CSV' : '⬇ Export CSV';
  const doneText = isZh ? '✓ 已导出 CSV' : '✓ Exported CSV';

  const code = `(() => {
  const TARGET_SEL = ${escapedSel};
  function resolveTables() {
    const matched = Array.from(document.querySelectorAll(TARGET_SEL));
    const tables = [];
    matched.forEach((el) => {
      if (el.tagName === 'TABLE') tables.push(el);
      else el.querySelectorAll('table').forEach((t) => tables.push(t));
    });
    return tables.length > 0 ? tables : Array.from(document.querySelectorAll('table'));
  }

  function attachExportButtons() {
    resolveTables().forEach((table, idx) => {
      if (table.dataset.pcLocalCsvAttached === '1') return;
      if (table.rows.length < 2) return;
      table.dataset.pcLocalCsvAttached = '1';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = ${JSON.stringify(btnText)};
      btn.style.cssText =
        'margin:6px 0;padding:4px 10px;font:500 12px/1.4 system-ui,sans-serif;' +
        'border-radius:6px;border:1px solid rgba(184,82,42,0.4);background:#FAF8F5;' +
        'color:#9E4320;cursor:pointer;display:inline-flex;align-items:center;gap:4px;';

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const csv = Array.from(table.rows)
          .map((row) =>
            Array.from(row.cells)
              .map((cell) => '"' + (cell.innerText || '').replace(/\\r?\\n+/g, ' ').trim().replace(/"/g, '""') + '"')
              .join(',')
          )
          .join('\\n');
        const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (document.title || 'table').slice(0, 32).replace(/[\\\\/:*?"<>|]/g, '_') + '-' + (idx + 1) + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        btn.textContent = ${JSON.stringify(doneText)};
        setTimeout(() => { btn.textContent = ${JSON.stringify(btnText)}; }, 1600);
      });

      if (table.parentNode) {
        table.parentNode.insertBefore(btn, table);
      }
    });
  }

  attachExportButtons();
  const obs = new MutationObserver(() => attachExportButtons());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();`;

  return {
    name: isZh ? `表格一键导出 CSV · ${hostLabel}` : `Export Table to CSV · ${hostLabel}`,
    description: isZh
      ? `在目标表格上方注入「导出 CSV」按钮，支持 UTF-8 BOM 防中文乱码`
      : `Adds a 1-click UTF-8 CSV download button above matching tables`,
    engine: 'js',
    matches: [hostPat],
    code,
    targetSelectors: [tableSelector],
    explanation: isZh
      ? `已通过本地免 AI 模板锁定表格 \`${tableSelector}\` 并生成 CSV 导出按钮脚本（内置 UTF-8 BOM 编码，Excel 打开不乱码）。`
      : `Generated a local zero-AI CSV export script targeting \`${tableSelector}\` with UTF-8 BOM support.`,
  };
}

function tryMatchBuiltinRecipeFallback(
  intent: string,
  hostPat: string,
  isZh: boolean,
): GeneratedUserScript | null {
  // Do not hijack conditional/custom data-processing prompts (e.g. "把状态为逾期的行标红")
  if (/逾期|大于|小于|等于|包含|筛选|过滤|正则|overdue|greater\s+than|less\s+than|where\s+/i.test(intent)) {
    return null;
  }

  let recipeId: string | null = null;
  if (/暗色|夜间模式|暗黑|深色模式|护眼暗色|dark\s*mode|night\s*mode/i.test(intent)) {
    recipeId = 'tpl-smart-dark-mode';
  } else if (/解除复制|允许复制|禁止复制|右键限制|选中限制|unlock\s*copy|enable\s*copy/i.test(intent)) {
    recipeId = 'tpl-unlock-copy';
  } else if (/(?:导出|下载).*(?:csv|表格)|(?:csv|表格).*(?:导出|下载)|export.*csv|table.*csv/i.test(intent)) {
    recipeId = 'tpl-table-csv-export';
  } else if (/视频倍速|倍速播放|画中画|video\s*speed|playback\s*speed/i.test(intent)) {
    recipeId = 'tpl-video-speed-controller';
  } else if (/外链直达|免跳转|直接跳转|redirect|interstitial/i.test(intent)) {
    recipeId = 'tpl-direct-external-links';
  } else if (/代码.*复制|复制代码|copy\s*code/i.test(intent)) {
    recipeId = 'tpl-code-copy-btn';
  } else if (/展开全文|阅读全文|自动展开|read\s*more|auto[- ]?expand/i.test(intent)) {
    recipeId = 'tpl-auto-expand-article';
  } else if (/markdown|复制\s*md|转成\s*md/i.test(intent)) {
    recipeId = 'tpl-markdown-clipper';
  } else if (/密码.*明文|查看密码|显示密码|password\s*peek|reveal\s*password/i.test(intent)) {
    recipeId = 'tpl-password-peek';
  } else if (/宽屏阅读|沉浸阅读|去侧栏宽屏|widescreen\s*reader/i.test(intent)) {
    recipeId = 'tpl-widescreen-reader';
  } else if (/悬浮广告|去广告|屏蔽广告|ad\s*block|floating\s*ad/i.test(intent)) {
    recipeId = 'tpl-floating-ad-shield';
  }

  if (!recipeId) return null;
  const recipe = BUILTIN_TEMPLATES.find((r) => r.id === recipeId);
  if (!recipe) return null;

  const copy = isZh ? recipe.zh : recipe.en;
  return {
    name: copy.name,
    description: copy.description,
    engine: recipe.engine,
    matches: [hostPat],
    code: recipe.engine === 'js' ? recipe.code ?? '' : '',
    css: recipe.engine === 'css' ? recipe.css ?? '' : undefined,
    targetSelectors: [],
    explanation: isZh
      ? `已为你匹配内置免 AI 脚本「${copy.name}」，无需填写 API Key 即可直接在当前网站应用。`
      : `Matched built-in zero-AI recipe "${copy.name}"—ready to apply with no API key required.`,
  };
}

export interface LocalModBuildOptions {
  /**
   * When `false` (default — user HAS an AI engine configured), only pure,
   * unambiguous single-purpose "hide picked element" intents fast-path locally.
   * When `true` (user has NO API key or Built-in AI is unavailable), broader
   * picked-element operations and built-in recipe matches resolve locally so
   * zero-config users still succeed immediately!
   */
  allowExtendedFallback?: boolean;
}

export function tryBuildLocalPickedMod(
  payload: GenerateUserScriptPayload,
  options?: LocalModBuildOptions,
): GeneratedUserScript | null {
  if (payload.previousMod || payload.diagnosticHint) return null;

  const rawIntent = (payload.intent ?? '').trim();
  if (!rawIntent) return null;

  const match = resolveTargetMatch(payload.targetUrl ?? payload.pickedElement?.pageUrl);
  if (!match) return null;

  const isZh = payload.lang !== 'en';
  const allowExtended = Boolean(options?.allowExtendedFallback);
  const picked = payload.pickedElement;
  const primarySel = picked?.selector?.trim() ?? '';
  const hasValidPicked = isSafePickedSelector(primarySel);

  const useSimilar =
    hasValidPicked &&
    wantsSimilarGroup(rawIntent) &&
    isSafePickedSelector(picked?.similarSelector);
  const chosenSel = useSimilar ? picked!.similarSelector!.trim() : primarySel;

  // ── 1. Fast-Path: Unambiguous single-purpose hide on a picked element ──────
  if (hasValidPicked && !isRootDocumentSelector(chosenSel)) {
    const normalizedLower = rawIntent.toLowerCase();
    const isExactChip = PURE_HIDE_EXACT_SET.has(rawIntent) || PURE_HIDE_EXACT_SET.has(normalizedLower);
    const isPureHideRegex =
      !COMPOUND_INTENT_GUARDS.test(rawIntent) &&
      (PURE_HIDE_ZH_RE.test(rawIntent) || PURE_HIDE_EN_RE.test(rawIntent));

    if (isExactChip || isPureHideRegex) {
      return buildDirectHideMod({
        selector: chosenSel,
        targetUrl: payload.targetUrl ?? picked?.pageUrl,
        lang: payload.lang,
        isSimilarGroup: useSimilar,
        similarCount: picked?.similarCount,
      });
    }
  }

  if (!allowExtended) {
    return null;
  }

  // ── 2. Zero-AI Extended Fallback when Picked Element is Locked ─────────────
  if (hasValidPicked) {
    const tagLower = (picked?.tag ?? '').toLowerCase();

    // 2a. Export Table to CSV
    if (
      /csv/i.test(rawIntent) ||
      ((/导出|下载|export|download/i.test(rawIntent)) &&
        (tagLower === 'table' || /表|table/i.test(rawIntent)))
    ) {
      const tableSel = tagLower === 'table' ? chosenSel : 'table';
      return buildTargetedCsvMod(tableSel, match.hostPat, match.hostLabel, isZh);
    }

    // 2b. Hide / Remove (including compound "隐藏侧栏并加宽正文")
    const hasNegatedHide = /不要隐藏|别隐藏|不隐藏|取消隐藏|don'?t\s+hide|do\s+not\s+hide|unhide/i.test(
      rawIntent,
    );
    if (
      !hasNegatedHide &&
      !isRootDocumentSelector(chosenSel) &&
      /隐藏|去掉|移除|删掉|删除|屏蔽|关掉|不想看|去广告|净化|hide|remove|block|dismiss|delete/i.test(
        rawIntent,
      )
    ) {
      const alsoWiden = /加宽|宽屏|拉宽|铺满|拓宽|居中|widen|wider|full[- ]?width/i.test(rawIntent);
      if (!alsoWiden) {
        return buildDirectHideMod({
          selector: chosenSel,
          targetUrl: payload.targetUrl ?? picked?.pageUrl,
          lang: payload.lang,
          isSimilarGroup: useSimilar,
          similarCount: picked?.similarCount,
        });
      }

      const css = [
        `${chosenSel} {\n  display: none !important;\n}`,
        `article, main, [role="main"] {\n  max-width: min(980px, 95vw) !important;\n  margin-left: auto !important;\n  margin-right: auto !important;\n}`,
      ].join('\n\n');

      return {
        name: isZh ? `去干扰并宽屏阅读 · ${match.hostLabel}` : `Hide & Widen Content · ${match.hostLabel}`,
        description: isZh
          ? `隐藏 ${chosenSel} 并自动拓宽主阅读区`
          : `Hides ${chosenSel} and widens the main content column`,
        engine: 'css',
        matches: [match.hostPat],
        code: '',
        css,
        targetSelectors: [chosenSel],
        explanation: isZh
          ? `已通过本地免 AI 规则隐藏 \`${chosenSel}\` 并将主内容区居中拓宽，无需 API Key。`
          : `Locally generated CSS to hide \`${chosenSel}\` and widen the main reading column—no API key needed.`,
      };
    }

    // 2c. Larger Typography / Reading Comfort
    if (
      /字号|字体.*大|放大.*字|大字|行高|行距|阅读字号|font[- ]?size|larger\s+(?:text|font)|bigger\s+(?:text|font)|readability/i.test(
        rawIntent,
      )
    ) {
      const sizeMatch = rawIntent.match(/\b(1[5-9]|2[0-8])\s*px\b/i);
      const px = sizeMatch ? `${sizeMatch[1]}px` : '17.5px';
      const css = `${chosenSel}, ${chosenSel} p, ${chosenSel} li {\n  font-size: ${px} !important;\n  line-height: 1.82 !important;\n}`;
      return {
        name: isZh ? `调大阅读字号 · ${match.hostLabel}` : `Larger Reading Text · ${match.hostLabel}`,
        description: isZh
          ? `将 ${chosenSel} 区域字号调整为舒适的 ${px} 与 1.82 倍行高`
          : `Sets ${chosenSel} text to ${px} with 1.82 line-height`,
        engine: 'css',
        matches: [match.hostPat],
        code: '',
        css,
        targetSelectors: [chosenSel],
        explanation: isZh
          ? `已通过本地免 AI 规则将 \`${chosenSel}\` 正文字号提升至 ${px}（生成后还可拖动下方滑块微调字号与页宽）。`
          : `Locally styled \`${chosenSel}\` to ${px} font size—use the sliders below to fine-tune further.`,
      };
    }

    // 2d. Widen Container
    if (/加宽|宽屏|拉宽|铺满|拓宽|widen|wider|full[- ]?width/i.test(rawIntent)) {
      const css = `${chosenSel} {\n  max-width: min(1040px, 96vw) !important;\n  width: 100% !important;\n  margin-left: auto !important;\n  margin-right: auto !important;\n}`;
      return {
        name: isZh ? `拓宽选中内容区 · ${match.hostLabel}` : `Widen Picked Container · ${match.hostLabel}`,
        description: isZh ? `拓宽 ${chosenSel} 宽度并居中排版` : `Widens and centers ${chosenSel}`,
        engine: 'css',
        matches: [match.hostPat],
        code: '',
        css,
        targetSelectors: [chosenSel],
        explanation: isZh
          ? `已通过本地免 AI 规则将 \`${chosenSel}\` 拓宽至宽屏居中，无需 API Key。`
          : `Locally widened \`${chosenSel}\` with zero AI configuration required.`,
      };
    }

    // 2e. Blur / Dim / Privacy Mask
    if (/模糊|打码|半透明|变淡|弱化|blur|dim|opacity/i.test(rawIntent)) {
      const css = `${chosenSel} {\n  filter: blur(7px) !important;\n  opacity: 0.32 !important;\n  transition: filter 0.18s ease, opacity 0.18s ease !important;\n}\n${chosenSel}:hover {\n  filter: none !important;\n  opacity: 1 !important;\n}`;
      return {
        name: isZh ? `弱化模糊选中区域 · ${match.hostLabel}` : `Blur & Dim Element · ${match.hostLabel}`,
        description: isZh
          ? `默认模糊弱化 ${chosenSel}，鼠标悬停时恢复清晰`
          : `Blurs and dims ${chosenSel} until hovered`,
        engine: 'css',
        matches: [match.hostPat],
        code: '',
        css,
        targetSelectors: [chosenSel],
        explanation: isZh
          ? `已通过本地免 AI 规则对 \`${chosenSel}\` 添加模糊弱化效果，悬停即可查看原内容。`
          : `Locally blurred and dimmed \`${chosenSel}\` (hover to reveal).`,
      };
    }

    // 2f. Highlight / Outline
    if (/高亮|标黄|标红|醒目|框出|highlight|outline/i.test(rawIntent)) {
      const isRed = /红|red/i.test(rawIntent);
      const bg = isRed ? 'rgba(239, 68, 68, 0.14)' : 'rgba(250, 204, 21, 0.22)';
      const border = isRed ? 'rgba(220, 38, 38, 0.7)' : 'rgba(217, 119, 6, 0.7)';
      const css = `${chosenSel} {\n  background-color: ${bg} !important;\n  outline: 2px solid ${border} !important;\n  border-radius: 4px !important;\n}`;
      return {
        name: isZh ? `高亮标记选中元素 · ${match.hostLabel}` : `Highlight Picked Element · ${match.hostLabel}`,
        description: isZh ? `对 ${chosenSel} 进行醒目高亮标记` : `Highlights ${chosenSel} on page`,
        engine: 'css',
        matches: [match.hostPat],
        code: '',
        css,
        targetSelectors: [chosenSel],
        explanation: isZh
          ? `已通过本地免 AI 规则高亮标记 \`${chosenSel}\`。`
          : `Locally highlighted \`${chosenSel}\` with zero AI configuration.`,
      };
    }
  }

  // ── 3. Zero-AI Fallback Without Picked Element: Match Built-in Recipes ─────
  return tryMatchBuiltinRecipeFallback(rawIntent, match.hostPat, isZh);
}
