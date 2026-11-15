import { useState, useEffect, useRef } from 'react';
import {
  Puzzle,
  Pin,
  Check,
  ArrowRight,
  Download,
  Crosshair,
  PanelRightOpen,
} from 'lucide-react';
import { BrandLogo } from '~/entrypoints/sidepanel/components/BrandLogo';
import { Button } from '../sidepanel/components/ui/button';
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

  // Interactive live proofing demo toggles
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
    // Open Side Panel synchronously inside the user click gesture before any `await`.
    const cachedTab = currentTabRef.current;
    if (typeof chrome !== 'undefined' && chrome.sidePanel?.open && typeof cachedTab?.windowId === 'number') {
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

    if (typeof chrome !== 'undefined' && chrome.tabs?.query && typeof cachedTab?.windowId === 'number') {
      const tabs = await chrome.tabs.query({ windowId: cachedTab.windowId }).catch(() => []);
      const existingWebTab = pickLandingTab(tabs, cachedTab.id);
      if (existingWebTab?.id) {
        await chrome.tabs.update(existingWebTab.id, { active: true }).catch(() => {});
        setTimeout(() => window.close(), 250);
        return;
      }
      // No scriptable webpage open yet — land on the interactive practice sandbox.
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between px-8 py-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <BrandLogo size={30} />
          <span className="font-serif-editorial text-lg font-semibold tracking-tight">
            PageCraft
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = lang === 'zh' ? 'en' : 'zh';
            setLang(next);
            saveManualLangOverride(next);
          }}
          className="text-[13px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-secondary cursor-pointer"
        >
          {zh ? 'English' : '简体中文'}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-8 py-8">
        <div className="w-full max-w-[1100px] grid grid-cols-1 lg:grid-cols-[0.88fr_1.32fr] gap-10 lg:gap-12 items-start">
          {/* Left Column: Editorial Headline + Complete 2-Step Toolbar Diagram + Primary Action */}
          <div className="space-y-6 pt-1 pc-stagger-1">
            <div className="space-y-3">
              <h1 className="font-serif-editorial text-3xl md:text-[36px] font-semibold tracking-tight leading-[1.24]">
                {zh ? (
                  <>
                    指哪改哪，
                    <br />
                    <span className="whitespace-nowrap">一句话定制任何网页</span>
                  </>
                ) : (
                  'Point at any element and reshape the web in plain words'
                )}
              </h1>
              <p className="text-[15px] text-muted-foreground leading-relaxed">
                {zh
                  ? '不用翻 F12 查代码。去弹窗、改护眼排版秒级生效，给表格加导出按钮还能一键复制标准 .user.js 油猴脚本。'
                  : 'No DevTools required. Clean up layouts immediately via CSS, or export full interactive userscripts to Tampermonkey.'}
              </p>
            </div>

            {/* Self-explanatory 2-Step Visual Chrome Toolbar Diagram (with live pin status) */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[13px] font-semibold text-foreground">
                  {zh ? '在任意网页两步呼出侧栏工坊' : 'Open the Side Panel in two clicks'}
                </div>
                {isPinned === true && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                    <Check className="h-3 w-3" />
                    <span>{zh ? '已固定到工具栏' : 'Pinned to toolbar'}</span>
                  </span>
                )}
                {isPinned === false && (
                  <span className="text-xs text-muted-foreground">
                    {zh ? '点下方开始后会自动打开侧栏' : 'Side Panel also opens on Start'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
                <div className="rounded-lg bg-secondary/65 px-3 py-2.5 flex items-center justify-between gap-1.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <Puzzle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{zh ? '右上角扩展' : 'Extensions'}</span>
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/12 text-[#8f381e] dark:text-[#f29b80] text-xs font-semibold shrink-0">
                    <Pin className="h-3 w-3" />
                    <span>{zh ? '固定图标' : 'Pin'}</span>
                  </span>
                </div>

                <div className="rounded-lg bg-secondary/65 px-3 py-2.5 flex items-center justify-between gap-1.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <BrandLogo size={15} />
                    <span>{zh ? '点图标' : 'Click icon'}</span>
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background text-foreground text-xs font-medium shrink-0">
                    <PanelRightOpen className="h-3.5 w-3.5 text-emerald-600" />
                    <span>{zh ? '呼出侧栏' : 'Side Panel'}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void handleStart('playground')}
                  className="pc-press gap-2 px-6 text-[14px] cursor-pointer"
                >
                  {done ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>
                        {zh
                          ? '正在打开侧栏工坊与练习靶场…'
                          : 'Opening Side Panel & Practice Sandbox…'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        {zh ? '20 秒亲手试改一次（免配置离线可用）' : 'Try a 20s Hands-On Demo (0 Setup)'}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>

                {!done && (
                  <button
                    type="button"
                    onClick={() => void handleStart('open_tab')}
                    className="text-[13px] font-medium text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-secondary/70 transition-colors cursor-pointer"
                  >
                    {zh ? '跳过练习，直接去当前网页 →' : 'Skip demo, go to my open tab →'}
                  </button>
                )}
              </div>
              <p className="text-[13px] text-muted-foreground">
                {zh
                  ? '100% 纯前端零后端 · 支持 Chrome 内置 AI / 本地 Ollama / 自带 API Key / MCP 编程智能体桥接'
                  : '100% Serverless & Zero-Telemetry · Chrome Built-in AI, Local Ollama, BYOK & MCP Agent Bridge'}
              </p>
            </div>
          </div>

          {/* Right Column: Hero Live Interactive Browser + SidePanel Proofing Stage */}
          <div className="pc-stagger-2 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            {/* Mock Browser Top Bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-secondary/55 border-b border-border/70">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  portal.example.com/report
                </span>
              </div>
              <span className="text-xs font-medium text-[#8f381e] dark:text-[#f29b80]">
                {zh ? '拨动右侧开关实时试改 ↓' : 'Toggle live switches ↓'}
              </span>
            </div>

            {/* Split Miniature Webpage + Attached SidePanel Proofing Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-[1.28fr_0.72fr] divide-y sm:divide-y-0 sm:divide-x divide-border/70">
              {/* Left Pane: Sample Webpage Being Reshaped Live with Smooth Spatial Reflow */}
              <div
                className={cn(
                  'p-5 transition-colors duration-220 min-h-[340px] flex flex-col justify-between',
                  warmPaper
                    ? 'bg-[#f8f5ec] dark:bg-[#1e1d1a]'
                    : 'bg-white dark:bg-[#141414]',
                )}
              >
                <div>
                  {/* Smoothly Collapsible Nag Banner (220ms peel-away transition) */}
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows,opacity,margin] duration-220 ease-[cubic-bezier(.16,1,.3,1)]',
                      cleanAd
                        ? 'grid-rows-[0fr] opacity-0 mb-0 pointer-events-none'
                        : 'grid-rows-[1fr] opacity-100 mb-3.5',
                    )}
                    aria-hidden={cleanAd}
                  >
                    <div className="overflow-hidden">
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/12 px-3 py-2 flex items-center justify-between text-xs text-foreground">
                        <span>
                          {zh ? '登录客户端领券看全文弹窗' : 'App Login & Promo Nag Banner'}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#8f381e] dark:text-[#f29b80] font-medium">
                          <Crosshair className="h-3 w-3" />
                          {zh ? '目标节点' : 'Target'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-stretch">
                    <div className="flex-1 space-y-3 min-w-0 transition-all duration-220 ease-[cubic-bezier(.16,1,.3,1)]">
                      <div
                        className={cn(
                          'font-semibold text-foreground transition-all duration-200',
                          warmPaper ? 'font-serif-editorial text-[18px]' : 'text-[15px]',
                        )}
                      >
                        {zh ? '2026 季度运营数据周报' : 'Q3 Operations Summary'}
                      </div>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        {zh
                          ? '收起悬浮干扰栏后正文自动舒展加宽，搭配柔和暖纸底色，长时间阅读技术文档与后台报表不再刺眼。'
                          : 'Distracting sidebars peel away smoothly so the article expands to full comfortable reading width.'}
                      </p>

                      {/* Sample HTML Table with Live Injected CSV Export Button */}
                      <div className="pt-1.5 space-y-2">
                        <div className="flex items-center justify-between h-6">
                          <span className="text-xs font-medium text-muted-foreground">
                            {zh ? '核心指标表' : 'Metrics Table'}
                          </span>
                          {csvButton && (
                            <button
                              type="button"
                              onClick={handleDemoCsvExport}
                              className="pc-confirm-pop pc-press inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-primary text-white text-xs font-medium cursor-pointer"
                            >
                              <Download className="h-3 w-3" />
                              <span>
                                {csvCopied
                                  ? zh
                                    ? '已导出 CSV ✓'
                                    : 'Exported ✓'
                                  : zh
                                    ? '导出 CSV'
                                    : 'Export CSV'}
                              </span>
                            </button>
                          )}
                        </div>
                        <table className="w-full text-xs border-collapse border-y border-border/80">
                          <thead>
                            <tr className="bg-secondary/45 text-foreground font-medium">
                              <th className="py-1.5 px-2 text-left font-medium">
                                {zh ? '渠道' : 'Channel'}
                              </th>
                              <th className="py-1.5 px-2 text-right font-medium">
                                {zh ? '转化' : 'Conv.'}
                              </th>
                              <th className="py-1.5 px-2 text-right font-medium">
                                {zh ? '留存' : 'Ret.'}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60 text-muted-foreground tabular-nums">
                            <tr>
                              <td className="py-1.5 px-2">Organic</td>
                              <td className="py-1.5 px-2 text-right">14.8%</td>
                              <td className="py-1.5 px-2 text-right">68.2%</td>
                            </tr>
                            <tr>
                              <td className="py-1.5 px-2">Search</td>
                              <td className="py-1.5 px-2 text-right">11.2%</td>
                              <td className="py-1.5 px-2 text-right">61.5%</td>
                            </tr>
                            <tr>
                              <td className="py-1.5 px-2">Referral</td>
                              <td className="py-1.5 px-2 text-right">19.4%</td>
                              <td className="py-1.5 px-2 text-right">73.0%</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Smoothly Collapsible Right Sidebar Ad */}
                    <div
                      className={cn(
                        'overflow-hidden transition-[width,margin,opacity] duration-220 ease-[cubic-bezier(.16,1,.3,1)] shrink-0',
                        cleanAd
                          ? 'w-0 ml-0 opacity-0 pointer-events-none'
                          : 'w-20 ml-3 opacity-100',
                      )}
                      aria-hidden={cleanAd}
                    >
                      <div className="w-20 h-full rounded-lg border border-dashed border-border bg-secondary/60 p-2 text-xs text-muted-foreground flex items-center justify-center text-center">
                        {zh ? '右侧杂乱推荐栏' : 'Noisy Sidebar'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Pane: Miniature PageCraft SidePanel Proofing Strip (clean, zero filler text) */}
              <div className="p-4 bg-card space-y-3">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                  <BrandLogo size={18} />
                  <span>{zh ? 'PageCraft 侧栏' : 'PageCraft Panel'}</span>
                </div>

                <div className="divide-y divide-border/70 border-y border-border/70">
                  <label className="py-3 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[13px] text-foreground">
                      {zh ? '隐藏弹窗与侧栏' : 'Hide nag & sidebar'}
                    </span>
                    <Switch checked={cleanAd} onCheckedChange={setCleanAd} />
                  </label>

                  <label className="py-3 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[13px] text-foreground">
                      {zh ? '暖白宽屏护眼纸底' : 'Warm paper reader'}
                    </span>
                    <Switch checked={warmPaper} onCheckedChange={setWarmPaper} />
                  </label>

                  <label className="py-3 flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[13px] text-foreground">
                      {zh ? '表格挂载导出 CSV' : 'Table CSV button'}
                    </span>
                    <Switch checked={csvButton} onCheckedChange={setCsvButton} />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
