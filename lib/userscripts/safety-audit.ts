/**
 * Deterministic static safety & MV3 compliance auditor for PageCraft mods
 * and community recipe packs.
 *
 * Pure zero-eval string/syntax checks shared between:
 *  - SidePanel import confirmation sheet (`Mods.tsx`)
 *  - CI static pack builder (`scripts/build-recipes.mjs`)
 *  - Unit tests (`tests/core/community-packs.test.ts`)
 */

import type { ModEngine } from './types';
import { isBroadMatch } from './store';

export type SafetyLevel = 'safe_css' | 'clean_local_js' | 'review_warning' | 'blocked';

export type SafetyFindingCode =
  | 'css_unbalanced_syntax'
  | 'css_external_import'
  | 'css_legacy_expression'
  | 'js_dynamic_eval'
  | 'js_remote_script_injection'
  | 'js_network_request'
  | 'js_cookie_access'
  | 'js_gm_xhr_or_require'
  | 'broad_all_urls_match';

export interface SafetyFinding {
  code: SafetyFindingCode;
  severity: 'warn' | 'block';
  messageZh: string;
  messageEn: string;
}

export interface ModSafetyReport {
  level: SafetyLevel;
  findings: SafetyFinding[];
}

function stripCssCommentsAndStrings(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function countDelims(source: string, open: string, close: string): number {
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth < 0) return -1;
    }
  }
  return depth;
}

/**
 * Verify balanced `{}`, `[]`, `()`, non-empty rule blocks, and absence of
 * common attribute-selector hyphen-space typos (e.g. `[class*="app- guide"]`).
 */
export function checkBalancedCssSyntax(css: string): boolean {
  const raw = (css ?? '').trim();
  if (!raw) return false;

  // Reject accidental hyphen-space typos inside quoted attribute selectors like [class*="foo- bar"]
  const attrRe = /\[[^\]\n]*?["']([^"'\n]*)["'][^\]\n]*?\]/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRe.exec(raw)) !== null) {
    if (/[a-z0-9]-\s+[a-z0-9]/i.test(attrMatch[1] ?? '')) {
      return false;
    }
  }

  const stripped = stripCssCommentsAndStrings(raw).trim();
  if (!stripped) return false;

  if (countDelims(stripped, '{', '}') !== 0) return false;
  if (countDelims(stripped, '[', ']') !== 0) return false;
  if (countDelims(stripped, '(', ')') !== 0) return false;

  // Require at least one rule block with actual CSS declarations
  return /\{[\s\S]*?:[\s\S]*?\}/.test(stripped);
}

/** Light comment stripping for static JS inspection (avoids matching words in comments). */
function stripJsComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');
}

/** Inspect a single CSS or JS mod for syntax & MV3 security hazards. */
export function auditModSafety(input: {
  engine: ModEngine;
  body: string;
  matches: string[];
}): ModSafetyReport {
  const findings: SafetyFinding[] = [];
  const body = (input.body ?? '').trim();
  const matches = Array.isArray(input.matches) ? input.matches : [];

  if (matches.some((m) => isBroadMatch(m))) {
    findings.push({
      code: 'broad_all_urls_match',
      severity: 'warn',
      messageZh: '匹配范围包含所有网站（<all_urls> 或 *://*/*），启用前请确认范围符合预期。',
      messageEn: 'Matches all websites (<all_urls> or *://*/*). Confirm this scope is intended.',
    });
  }

  if (input.engine === 'css') {
    if (!checkBalancedCssSyntax(body)) {
      findings.push({
        code: 'css_unbalanced_syntax',
        severity: 'block',
        messageZh: 'CSS 语法括号或选择器未闭合，无法安全应用。',
        messageEn: 'CSS has unbalanced brackets/braces or invalid selector syntax.',
      });
    }
    if (
      /@import\s+(?:url\s*\(\s*)?['"]?(?:https?:)?\/\//i.test(body) ||
      /url\s*\(\s*['"]?(?:https?:)?\/\//i.test(body)
    ) {
      findings.push({
        code: 'css_external_import',
        severity: 'block',
        messageZh: '检测到外部远程 @import 或 url(https://...) 资源拉取，不符合零远程加载规范。',
        messageEn: 'Contains external @import or remote url(https://...) resource fetch.',
      });
    }
    if (/expression\s*\(|javascript\s*:/i.test(body)) {
      findings.push({
        code: 'css_legacy_expression',
        severity: 'block',
        messageZh: '检测到不安全的 CSS expression() 或 javascript: URL。',
        messageEn: 'Contains unsafe CSS expression() or javascript: URI.',
      });
    }
  } else {
    if (!body) {
      findings.push({
        code: 'js_dynamic_eval',
        severity: 'block',
        messageZh: 'JS 脚本内容为空。',
        messageEn: 'JavaScript body is empty.',
      });
    } else {
      const codeNoComments = stripJsComments(body);
      if (
        /\beval\s*\(/.test(codeNoComments) ||
        /\bnew\s+Function\s*\(/.test(codeNoComments) ||
        /\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(codeNoComments)
      ) {
        findings.push({
          code: 'js_dynamic_eval',
          severity: 'block',
          messageZh: '包含 eval / new Function / 字符串定时器等动态代码执行，MV3 严禁导入。',
          messageEn: 'Uses eval / new Function / string-based timer execution (blocked by MV3).',
        });
      }
      if (
        /\bdocument\.write\s*\(/.test(codeNoComments) ||
        /createElement\s*\(\s*['"`]script['"`]\s*\)/i.test(codeNoComments) ||
        /\bchrome\.cookies\b/.test(codeNoComments)
      ) {
        findings.push({
          code: 'js_remote_script_injection',
          severity: 'block',
          messageZh: '尝试动态注入 <script> 标签或读取扩展 Cookie API，已阻止导入。',
          messageEn: 'Attempts dynamic <script> tag injection or privileged cookie API access.',
        });
      }
      if (
        /\bfetch\s*\(/.test(codeNoComments) ||
        /\bXMLHttpRequest\b/.test(codeNoComments) ||
        /\bnavigator\.sendBeacon\b/.test(codeNoComments) ||
        /\bnew\s+WebSocket\b/.test(codeNoComments)
      ) {
        findings.push({
          code: 'js_network_request',
          severity: 'warn',
          messageZh: '脚本包含网络请求 API（fetch / XHR / WebSocket / sendBeacon），导入前请核对代码。',
          messageEn: 'Script calls network APIs (fetch / XHR / WebSocket / sendBeacon). Inspect carefully.',
        });
      }
      if (/\bdocument\.cookie\b/.test(codeNoComments)) {
        findings.push({
          code: 'js_cookie_access',
          severity: 'warn',
          messageZh: '脚本读取或操作了 document.cookie，请注意隐私安全。',
          messageEn: 'Script accesses document.cookie; verify this is expected.',
        });
      }
      if (/\bGM[._]xml[hH]ttpRequest\b/.test(body) || /\/\/\s*@require\b/.test(body)) {
        findings.push({
          code: 'js_gm_xhr_or_require',
          severity: 'warn',
          messageZh: '包含 @require 或 GM_xmlhttpRequest，MV3 环境不会加载远程脚本。',
          messageEn: 'Contains @require or GM_xmlhttpRequest; remote code will not load under MV3.',
        });
      }
    }
  }

  let level: SafetyLevel;
  if (findings.some((f) => f.severity === 'block')) {
    level = 'blocked';
  } else if (findings.some((f) => f.severity === 'warn')) {
    level = 'review_warning';
  } else {
    level = input.engine === 'css' ? 'safe_css' : 'clean_local_js';
  }

  return { level, findings };
}

/** Aggregate safety audit across every rule inside a Community Pack. */
export function auditPackSafety(
  mods: Array<{ engine: ModEngine; body: string; matches: string[] }>,
): ModSafetyReport {
  const deduped = new Map<SafetyFindingCode, SafetyFinding>();
  let hasJs = false;

  for (const mod of mods) {
    if (mod.engine === 'js') hasJs = true;
    const report = auditModSafety(mod);
    for (const f of report.findings) {
      if (!deduped.has(f.code)) {
        deduped.set(f.code, f);
      }
    }
  }

  const findings = Array.from(deduped.values());
  let level: SafetyLevel;
  if (findings.some((f) => f.severity === 'block')) {
    level = 'blocked';
  } else if (findings.some((f) => f.severity === 'warn')) {
    level = 'review_warning';
  } else {
    level = hasJs ? 'clean_local_js' : 'safe_css';
  }

  return { level, findings };
}
