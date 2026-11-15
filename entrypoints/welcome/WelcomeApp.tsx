import { useState, useEffect, useRef } from 'react';
import {
  Puzzle,
  Pin,
  Check,
  ArrowRight,
  Download,
  Crosshair,
  PanelRightOpen,
  Globe,
} from 'lucide-react';
import { BrandLogo } from '~/entrypoints/sidepanel/components/BrandLogo';
import { Button } from '../sidepanel/components/ui/button';
import { Badge } from '../sidepanel/components/ui/badge';
import { Switch } from '../sidepanel/components/ui/switch';
import { useTheme } from '../sidepanel/hooks/useTheme';
import { DEFAULT_PRACTICE_URL } from '~/lib/shared/constants';
import { pickLandingTab } from '~/lib/shared/browser';
import {
  detectBrowserLang,
  MANUAL_LANG_STORAGE_KEY,
  saveManualLangOverride,
} from '~/lib/shared/locale';
import { cn } from '~/lib/utils';

export default function WelcomeApp() {
  useTheme();
  const [lang, setLang] = useState<'zh' | 'en'>(detectBrowserLang);
  const [done, setDone] = useState(false);
  const [isPinned, setIsPinned] = useState<boolean | null>(null);
  const currentTabRef = useRef<{ id?: number; windowId?: number } | null>(null);

  // Live interactive preview toggles
  const [cleanAd, setCleanAd] = useState(true);
  const [warmPaper, setWarmPaper] = useState(true);
  const [csvButton, setCsvButton] = useState(true);
  const [csvCopied, setCsvCopied] = useState(false);

  useEffect(() => {
    setLang(detectBrowserLang());
    if (typeof chrome === 'undefined') return;

    try {
      const q = new URLSearchParams(window.location.search).get('lang');
      if (q !== 'zh' && q !== 'en') {
        chrome.storage?.local?.get?.(MANUAL_LANG_STORAGE_KEY, (res) => {
          const manual = res?.[MANUAL_LANG_STORAGE_KEY];
          if (manual === 'zh' || manual === 'en') setLang(manual);
        });
      }
    } catch {
      /* ignore */
    }

    chrome.tabs?.getCurrent?.((tab) => {
      if (tab) {
        currentTabRef.current = { id: tab.id, windowId: tab.windowId };
      }
    });

    const checkPinned = () => {
      if (!chrome.action?.getUserSettings) return;
      chrome.action
        .getUserSettings()
        .then((u) => {
          setIsPinned(Boolean(u?.isOnToolbar));
        })
        .catch(() => {});
    };

    checkPinned();
    const timer = setInterval(checkPinned, 1200);
    window.addEventListener('focus', checkPinned);
    document.addEventListener('visibilitychange', checkPinned);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', checkPinned);
      document.removeEventListener('visibilitychange', checkPinned);
    };
  }, []);

  async function handleStart(mode: 'playground' | 'open_tab' = 'playground') {
    const cachedTab = currentTabRef.current;
    if (
      typeof chrome !== 'undefined' &&
      chrome.sidePanel?.open &&
      typeof cachedTab?.windowId === 'number'
    ) {
      chrome.sidePanel.open({ windowId: cachedTab.windowId }).catch(() => {});
    }

    const practiceUrl =
      lang === 'en' ? `${DEFAULT_PRACTICE_URL}?lang=en` : DEFAULT_PRACTICE_URL;

    setDone(true);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime
        .sendMessage({
          type: 'COMPLETE_ONBOARDING',
          payload: { tutorialDone: mode === 'open_tab' },
        })
        .catch(() => {});
    }

    if (mode === 'playground') {
      setTimeout(() => {
        window.location.href = practiceUrl;
      }, 160);
      return;
    }

    if (
      typeof chrome !== 'undefined' &&
      chrome.tabs?.query &&
      typeof cachedTab?.windowId === 'number'
    ) {
      const tabs = await chrome.tabs.query({ windowId: cachedTab.windowId }).catch(() => []);
      const existingWebTab = pickLandingTab(tabs, cachedTab.id);
      if (existingWebTab?.id) {
        await chrome.tabs.update(existingWebTab.id, { active: true }).catch(() => {});
        setTimeout(() => window.close(), 250);
        return;
      }
      setTimeout(() => {
        window.location.href = practiceUrl;
      }, 250);
      return;
    }

    setTimeout(() => window.close(), 700);
  }

  function handleDemoCsvExport() {
    setCsvCopied(true);
    setTimeout(() => setCsvCopied(false), 1800);
  }

  const zh = lang === 'zh';
  const activeRuleCount = Number(cleanAd) + Number(warmPaper) + Number(csvButton);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Opaque Top Bar with Strict .wrap Equal Edges */}
      <header className="border-b border-border bg-background">
        <div className="wrap h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size={28} />
            <span className="font-serif-editorial text-[18px] font-semibold tracking-tight text-foreground">
              PageCraft
            </span>
            <Badge variant="secondary" className="hidden sm:inline-flex font-mono">
              MV3 · Local-First
            </Badge>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              const next = lang === 'zh' ? 'en' : 'zh';
              setLang(next);
              saveManualLangOverride(next);
            }}
            className="h-10 px-3.5 text-[13px]"
          >
            {zh ? 'English' : '简体中文'}
          </Button>
        </div>
      </header>

      {/* Main Hero Onboarding Stage */}
      <main className="flex-1 flex items-center py-8 lg:py-12">
        <div className="wrap grid grid-cols-1 lg:grid-cols-[0.9fr_1.3fr] gap-8 lg:gap-12 items-center">
          {/* Left Column: Category-First Headline + 2-Step Toolbar Rail + 44px+ CTAs */}
          <div className="space-y-6 pc-enter" data-enter="">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground tabular-nums">
                <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                <span>
                  {zh
                    ? '100% 本地客户端 · 0 后台服务器 · CSS + .user.js'
                    : '100% client-side · 0 backend servers · CSS + .user.js'}
                </span>
              </div>

              <h1 className="font-serif-editorial text-[30px] sm:text-[36px] font-semibold tracking-tight leading-[1.2] text-foreground">
                {zh
                  ? '点选任意页面元素，用自然语言定制你的浏览器'
                  : 'Webpage customizer and userscript studio for Chrome'}
              </h1>

              <p className="text-[15.5px] text-muted-foreground leading-[1.6] max-w-[52ch]">
                {zh
                  ? '无需翻查 F12 选择器。点击页面区块即可隐藏弹窗横幅、重排护眼版式，或为数据表格注入导出按钮并复制标准 Tampermonkey 脚本。'
                  : 'Click any element on a live tab to strip clutter via CSS, mount interactive DOM tools, or export standard Tampermonkey .user.js scripts.'}
              </p>
            </div>

            {/* Flat-Divided 2-Step Toolbar Guide (strict max 2 boxes deep) */}
            <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/40 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-foreground">
                  {zh ? '两步固定并呼出侧栏工坊' : 'Pin and open the Side Panel in two steps'}
                </span>
                {isPinned === true ? (
                  <Badge variant="success" className="gap-1">
                    <Check className="h-3 w-3" />
                    <span>{zh ? '已固定到工具栏' : 'Pinned to toolbar'}</span>
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {zh ? '点击下方按钮也会直接打开侧栏' : 'Starting below opens the panel too'}
                  </span>
                )}
              </div>

              <div className="divide-y divide-border text-[13px]">
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 font-medium text-foreground">
                    <Puzzle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{zh ? '1. 打开浏览器扩展图标菜单' : '1. Open Chrome Extensions menu'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--pc-accent-ink)] shrink-0">
                    <Pin className="h-3 w-3" />
                    <span>{zh ? '固定 PageCraft' : 'Pin PageCraft'}</span>
                  </span>
                </div>

                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 font-medium text-foreground">
                    <BrandLogo size={15} />
                    <span>{zh ? '2. 点击工具栏 PageCraft 图标' : '2. Click PageCraft in toolbar'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 shrink-0">
                    <PanelRightOpen className="h-3.5 w-3.5" />
                    <span>{zh ? '呼出侧栏工坊' : 'Opens Side Panel'}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* 44px+ Action Buttons (stacks full-width at 390px) */}
            <div className="space-y-3 pt-1">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void handleStart('playground')}
                  className="h-11 px-5 text-[14px] w-full sm:w-auto justify-center"
                >
                  {done ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>
                        {zh ? '正在打开侧栏与靶场…' : 'Opening Side Panel & sandbox…'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        {zh ? '打开 20 秒练习靶场' : 'Try 20-second sandbox'}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>

                {!done && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => void handleStart('open_tab')}
                    className="h-11 px-4 text-[14px] w-full sm:w-auto justify-center"
                  >
                    <span>{zh ? '直接切回已打开网页' : 'Go to open webpage'}</span>
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {zh
                  ? '支持 Chrome 内置 Gemini Nano、本地离线 Ollama / LM Studio、自带 API Key 与 pagecraft-mcp 桥接。'
                  : 'Runs with Chrome Built-in Gemini Nano, local Ollama / LM Studio, BYOK, and pagecraft-mcp.'}
              </p>
            </div>
          </div>

          {/* Right Column: Real Interactive Preview Frame (App Frame + Attached SidePanel) */}
          <div className="pc-enter-stage rounded-[10px] border border-border bg-card overflow-hidden">
            {/* Browser Window Bar */}
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-secondary/45 border-b border-border">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--pc-border-strong)] shrink-0" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--pc-border-strong)] shrink-0" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--pc-border-strong)] shrink-0" />
                <span className="ml-2 font-mono text-xs text-muted-foreground truncate">
                  portal.example.com/q3-report
                </span>
              </div>
              <span className="text-xs font-medium text-[var(--pc-accent-ink)] shrink-0">
                {zh ? '切换开关实时预览' : 'Interactive live preview'}
              </span>
            </div>

            {/* Split Webpage Canvas + Miniature PageCraft SidePanel */}
            <div className="grid grid-cols-1 md:grid-cols-[1.28fr_0.72fr] divide-y md:divide-y-0 md:divide-x divide-border">
              {/* Simulated Live Webpage */}
              <div
                className={cn(
                  'p-4 sm:p-5 transition-colors duration-150 min-h-[330px] flex flex-col justify-between',
                  warmPaper
                    ? 'bg-[#FAF6EE] dark:bg-[#191816]'
                    : 'bg-[#FFFFFF] dark:bg-[#131312]',
                )}
              >
                <div>
                  {/* Collapsible Promo Banner with Terracotta Picker Outline */}
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows,opacity,margin] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]',
                      cleanAd
                        ? 'grid-rows-[0fr] opacity-0 mb-0 pointer-events-none'
                        : 'grid-rows-[1fr] opacity-100 mb-3.5',
                    )}
                    aria-hidden={cleanAd}
                  >
                    <div className="overflow-hidden">
                      <div className="rounded-[6px] border-2 border-[#C95533] bg-[rgba(201,85,51,0.08)] px-3 py-2 flex items-center justify-between gap-2 text-xs text-foreground">
                        <span className="truncate">
                          {zh ? '下载客户端领券解锁完整报表横幅' : 'App Download & Promo Nag Banner'}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--pc-accent-ink)] shrink-0">
                          <Crosshair className="h-3 w-3" />
                          <span>aside.promo</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-stretch">
                    <div className="flex-1 space-y-3 min-w-0">
                      <div
                        className={cn(
                          'font-semibold text-foreground transition-all duration-150',
                          warmPaper ? 'font-serif-editorial text-[18px]' : 'text-[15px]',
                        )}
                      >
                        {zh ? '2026 Q3 渠道转化与留存周报' : 'Q3 Channel Conversion Summary'}
                      </div>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        {zh
                          ? '移除顶部横幅与右侧推荐栏后，正文与数据表自动扩展至舒适栏宽，配合暖白纸面降低视觉疲劳。'
                          : 'Removing promo banners and side rails lets articles and data tables expand to full reading width.'}
                      </p>

                      {/* Live Data Table with Injected Export CSV Button */}
                      <div className="pt-1 space-y-2">
                        <div className="flex items-center justify-between gap-2 min-h-[28px]">
                          <span className="font-mono text-[11.5px] text-muted-foreground">
                            table.metrics-grid
                          </span>
                          {csvButton && (
                            <Button
                              type="button"
                              variant="primary"
                              size="xxs"
                              onClick={handleDemoCsvExport}
                              className="h-6 px-2 text-[11.5px]"
                            >
                              <Download className="h-3 w-3" />
                              <span>
                                {csvCopied
                                  ? zh
                                    ? '已复制 CSV ✓'
                                    : 'Copied CSV ✓'
                                  : zh
                                    ? '导出 CSV'
                                    : 'Export CSV'}
                              </span>
                            </Button>
                          )}
                        </div>

                        <table className="w-full text-xs border-collapse border-y border-border">
                          <thead>
                            <tr className="bg-secondary/50 text-foreground">
                              <th className="py-1.5 px-2 text-left font-medium">
                                {zh ? '渠道' : 'Channel'}
                              </th>
                              <th className="py-1.5 px-2 text-right font-medium">
                                {zh ? '转化率' : 'Conv.'}
                              </th>
                              <th className="py-1.5 px-2 text-right font-medium">
                                {zh ? '留存率' : 'Ret.'}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border text-muted-foreground font-mono tabular-nums">
                            <tr>
                              <td className="py-1.5 px-2 font-sans text-foreground">Organic</td>
                              <td className="py-1.5 px-2 text-right">14.8%</td>
                              <td className="py-1.5 px-2 text-right">68.2%</td>
                            </tr>
                            <tr>
                              <td className="py-1.5 px-2 font-sans text-foreground">Search</td>
                              <td className="py-1.5 px-2 text-right">11.2%</td>
                              <td className="py-1.5 px-2 text-right">61.5%</td>
                            </tr>
                            <tr>
                              <td className="py-1.5 px-2 font-sans text-foreground">Referral</td>
                              <td className="py-1.5 px-2 text-right">19.4%</td>
                              <td className="py-1.5 px-2 text-right">73.0%</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Collapsible Right Ad Rail */}
                    <div
                      className={cn(
                        'overflow-hidden transition-[width,margin,opacity] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] shrink-0',
                        cleanAd
                          ? 'w-0 ml-0 opacity-0 pointer-events-none'
                          : 'w-20 ml-3 opacity-100',
                      )}
                      aria-hidden={cleanAd}
                    >
                      <div className="w-20 h-full rounded-[6px] border border-dashed border-[var(--pc-border-strong)] bg-secondary/60 p-2 text-[11px] text-muted-foreground flex items-center justify-center text-center">
                        {zh ? '右侧推荐流' : 'Promo Rail'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Attached PageCraft SidePanel Replica */}
              <div className="bg-card divide-y divide-border flex flex-col justify-between">
                <div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 border-b border-border">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <BrandLogo size={18} />
                      <span className="font-serif-editorial text-[14px] font-semibold text-foreground">
                        PageCraft
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                      <Globe className="h-3 w-3 text-emerald-600 shrink-0" />
                      <span>{activeRuleCount}</span>
                    </span>
                  </div>

                  <div className="divide-y divide-border">
                    <label className="pc-row px-3.5 py-3 flex items-center justify-between gap-2 cursor-pointer min-h-[46px]">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          {zh ? '隐藏横幅与侧栏' : 'Hide banner & rail'}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">CSS</div>
                      </div>
                      <Switch checked={cleanAd} onCheckedChange={setCleanAd} />
                    </label>

                    <label className="pc-row px-3.5 py-3 flex items-center justify-between gap-2 cursor-pointer min-h-[46px]">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          {zh ? '暖白宽屏阅读纸面' : 'Warm paper reader'}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">CSS</div>
                      </div>
                      <Switch checked={warmPaper} onCheckedChange={setWarmPaper} />
                    </label>

                    <label className="pc-row px-3.5 py-3 flex items-center justify-between gap-2 cursor-pointer min-h-[46px]">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          {zh ? '挂载导出 CSV 按钮' : 'Mount CSV export'}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">JS</div>
                      </div>
                      <Switch checked={csvButton} onCheckedChange={setCsvButton} />
                    </label>
                  </div>
                </div>

                <div className="px-3.5 py-2.5 bg-secondary/35 flex items-center justify-between text-[11px] font-mono text-muted-foreground tabular-nums">
                  <span>insertCSS + userScripts</span>
                  <span>0 ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer aligned to .wrap */}
      <footer className="border-t border-border bg-background">
        <div className="wrap py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {zh
              ? 'PageCraft 开源版 · 零遥测 · 所有脚本与密钥仅存储在本地浏览器'
              : 'PageCraft Open Source · Zero telemetry · All scripts and keys remain local'}
          </span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/botshen/pagecraft"
              target="_blank"
              rel="noopener noreferrer"
              className="pc-focus hover:text-foreground hover:underline"
            >
              GitHub
            </a>
            <a
              href="https://pagecraft.shenxin.space/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="pc-focus hover:text-foreground hover:underline"
            >
              {zh ? '隐私说明' : 'Privacy'}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
