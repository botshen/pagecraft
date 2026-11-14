import { useState, useRef, useMemo, useEffect } from 'react';
import type {
  ActiveTabInfo,
  ModEngine,
  UserScript,
  UserScriptsAvailability,
} from '~/lib/userscripts/types';
import {
  deleteUserScript,
  exportAsUserScript,
  hostPatternFromUrl,
  isBroadMatch,
  normalizeMod,
  parseUserScriptHeader,
  upsertUserScript,
  validateMatches,
} from '~/lib/userscripts/store';
import { urlMatchesAny } from '~/lib/userscripts/matcher';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { SegmentedControl } from '../components/ui/segmented';
import { decodeRecipeShortcode, formatRecipeSharePost } from '~/lib/userscripts/share';
import {
  Plus,
  Download,
  Upload,
  Play,
  Copy,
  Pencil,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Search,
  X,
  FileDown,
  FileUp,
  Share2,
} from 'lucide-react';
import { cn } from '~/lib/utils';
import { recheckOrRecoverJsPermission } from '../utils';
import type { Lang } from '../i18n';

type ModFilterKey = 'all' | 'enabled' | 'css' | 'js';

function slugifyModFilename(name: string, fallbackId: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return cleaned || `pagecraft-mod-${fallbackId.slice(0, 8)}`;
}

function triggerBrowserDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  activeTab: ActiveTabInfo;
  mods: UserScript[];
  availability: UserScriptsAvailability | null;
  onModsChanged: () => Promise<void>;
  onRecheckAvailability: () => Promise<UserScriptsAvailability>;
  onNavigateStudio: () => void;
  onToast: (msg: string) => void;
  lang: Lang;
  t: (k: string) => string;
}

export default function ModsPage({
  activeTab,
  mods,
  availability,
  onModsChanged,
  onRecheckAvailability,
  onNavigateStudio,
  onToast,
  lang,
  t,
}: Props) {
  const [editing, setEditing] = useState<UserScript | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState('');
  const [draggingFile, setDraggingFile] = useState(false);
  const [importWarn, setImportWarn] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [modFilter, setModFilter] = useState<ModFilterKey>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const hasEnabledJsMods = mods.some((m) => m.enabled && m.engine === 'js');

  const filteredMods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return mods.filter((m) => {
      if (modFilter === 'enabled' && !m.enabled) return false;
      if (modFilter === 'css' && m.engine !== 'css') return false;
      if (modFilter === 'js' && m.engine !== 'js') return false;
      if (!q) return true;
      const haystack = `${m.name}\n${m.description}\n${m.matches.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [mods, modFilter, searchQuery]);

  const activeSiteList = activeTab.url
    ? filteredMods.filter((m) => urlMatchesAny(activeTab.url, m.matches))
    : [];
  const activeIds = new Set(activeSiteList.map((m) => m.id));
  const otherSiteList = filteredMods.filter((m) => !activeIds.has(m.id));

  async function syncRuntime() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({ type: 'USERSCRIPTS_SYNC' }).catch(() => {});
    }
  }

  async function handleToggle(mod: UserScript) {
    const next: UserScript = {
      ...mod,
      enabled: !mod.enabled,
      updatedAt: Date.now(),
    };
    await upsertUserScript(next);
    await syncRuntime();
    await onModsChanged();
    onToast(
      next.enabled
        ? lang === 'zh'
          ? `已启用：${mod.name}`
          : `Enabled: ${mod.name}`
        : lang === 'zh'
          ? `已暂停：${mod.name}`
          : `Paused: ${mod.name}`,
    );
  }

  function handleDeleteClick(mod: UserScript) {
    if (confirmDeleteId !== mod.id) {
      setConfirmDeleteId(mod.id);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmDeleteId((prev) => (prev === mod.id ? null : prev));
      }, 3500);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDeleteId(null);
    void handleDelete(mod);
  }

  async function handleDelete(mod: UserScript) {
    await deleteUserScript(mod.id);
    await syncRuntime();
    await onModsChanged();
    onToast(lang === 'zh' ? `已删除：${mod.name}` : `Deleted: ${mod.name}`);
  }

  async function handleRun(mod: UserScript) {
    if (mod.engine === 'js') {
      const avail = await onRecheckAvailability();
      if (!avail.available) {
        onToast(
          lang === 'zh'
            ? '请先在上方提示卡中开启一次「允许用户脚本」授权'
            : 'Enable "Allow User Scripts" first to run JS userscripts',
        );
        return;
      }
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const res = (await chrome.runtime
      .sendMessage({ type: 'USERSCRIPTS_TEST', payload: { id: mod.id } })
      .catch(() => null)) as { ok?: boolean; reloaded?: boolean } | null;
    if (res?.ok) {
      onToast(
        res.reloaded
          ? lang === 'zh'
            ? `已刷新页面并运行：${mod.name}`
            : `Reloaded tab & executed: ${mod.name}`
          : lang === 'zh'
            ? `样式已在当前页面实时生效：${mod.name}`
            : `CSS applied live: ${mod.name}`,
      );
    }
  }

  async function handleCopyUserscript(mod: UserScript) {
    await navigator.clipboard.writeText(exportAsUserScript(mod));
    onToast(t('copiedUserscript'));
  }

  async function handleShareRecipe(mod: UserScript) {
    await navigator.clipboard.writeText(formatRecipeSharePost(mod, lang));
    onToast(t('copiedShareRecipe'));
  }

  function handleDownloadUserscript(mod: UserScript) {
    const slug = slugifyModFilename(mod.name, mod.id);
    const filename = `${slug}.user.js`;
    triggerBrowserDownload(
      filename,
      exportAsUserScript(mod),
      'text/javascript;charset=utf-8',
    );
    onToast(lang === 'zh' ? `已下载：${filename}` : `Downloaded: ${filename}`);
  }

  function handleExportBackupJson() {
    if (mods.length === 0) return;
    const payload = {
      app: 'PageCraft',
      version: 1,
      exportedAt: new Date().toISOString(),
      mods,
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `pagecraft-mods-backup-${dateStr}.json`;
    triggerBrowserDownload(
      filename,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    );
    onToast(
      lang === 'zh'
        ? `已导出 ${mods.length} 条改造规则备份`
        : `Exported ${mods.length} mod(s) to JSON`,
    );
  }

  async function handleRestoreBackupFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      onToast(
        lang === 'zh' ? '备份文件超过 5MB 安全上限' : 'Backup file exceeds 5MB limit',
      );
      return;
    }
    try {
      const rawText = await file.text();
      const parsed: unknown = JSON.parse(rawText);
      const rawItems: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { mods?: unknown }).mods)
          ? ((parsed as { mods: unknown[] }).mods)
          : [];

      const validMods: UserScript[] = [];
      for (const item of rawItems) {
        if (!item || typeof item !== 'object') continue;
        const normalized = normalizeMod(item as Record<string, unknown>);
        if (!normalized) continue;
        if (validateMatches(normalized.matches, Boolean(normalized.allowAllUrls)) !== null) {
          continue;
        }
        if (normalized.engine === 'css' && !(normalized.css ?? '').trim()) continue;
        if (normalized.engine === 'js' && !normalized.code.trim()) continue;
        validMods.push(normalized);
      }

      if (validMods.length === 0) {
        onToast(
          lang === 'zh'
            ? '未在备份文件中找到有效规则'
            : 'No valid mods found in backup JSON',
        );
        return;
      }

      for (const mod of validMods) {
        await upsertUserScript(mod);
      }
      await syncRuntime();
      await onModsChanged();
      onToast(
        lang === 'zh'
          ? `已恢复 ${validMods.length} 条改造规则`
          : `Restored ${validMods.length} mod(s)`,
      );
    } catch {
      onToast(
        lang === 'zh'
          ? '备份文件格式无效，请选择 PageCraft 导出的 JSON 文件'
          : 'Invalid JSON backup file',
      );
    }
  }

  function startNewCustomMod() {
    const defaultMatch =
      (activeTab.url && hostPatternFromUrl(activeTab.url)) || 'https://example.com/*';
    setFormError(null);
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      description: '',
      engine: 'css',
      matches: [defaultMatch],
      code: '(() => {\n  // Your code here\n})();',
      css: '/* Example: .ad-banner { display: none !important; } */\n',
      enabled: true,
      source: 'manual',
      runAt: 'document_start',
      allowAllUrls: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function importRawScripts(
    entries: Array<{ raw: string; filename?: string }>,
  ): Promise<boolean> {
    const validEntries = entries.filter((e) => e.raw.trim().length > 0);
    if (validEntries.length === 0) return false;

    const defaultMatch =
      (activeTab.url && hostPatternFromUrl(activeTab.url)) || 'https://example.com/*';

    const importedNames: string[] = [];
    let sawRemoteWarn = false;

    for (const entry of validEntries) {
      const sharedRecipe = decodeRecipeShortcode(entry.raw);
      if (sharedRecipe) {
        const broad = sharedRecipe.matches.some((m) => isBroadMatch(m));
        const err = validateMatches(sharedRecipe.matches, broad);
        if (err) {
          setFormError(err);
          return false;
        }
        const now = Date.now();
        const mod: UserScript = {
          id: crypto.randomUUID(),
          name: sharedRecipe.name,
          description: sharedRecipe.description,
          engine: sharedRecipe.engine,
          matches: sharedRecipe.matches,
          code: sharedRecipe.engine === 'js' ? sharedRecipe.body : '',
          css: sharedRecipe.engine === 'css' ? sharedRecipe.body : undefined,
          targetSelectors: sharedRecipe.targetSelectors,
          enabled: true,
          source: 'manual',
          runAt: sharedRecipe.runAt,
          allowAllUrls: broad,
          createdAt: now,
          updatedAt: now,
        };
        await upsertUserScript(mod);
        importedNames.push(mod.name);
        continue;
      }

      const parsed = parseUserScriptHeader(entry.raw, lang);
      const matches = parsed.matches.length > 0 ? parsed.matches : [defaultMatch];
      const broad = matches.some((m) => isBroadMatch(m));
      const err = validateMatches(matches, broad);
      if (err) {
        setFormError(err);
        return false;
      }

      if (parsed.warnings.length > 0) {
        sawRemoteWarn = true;
      }

      const fallbackFileTitle = entry.filename
        ? entry.filename.replace(/\.user\.js$/i, '').replace(/\.js$/i, '').trim()
        : '';
      const name =
        parsed.name ||
        fallbackFileTitle ||
        (lang === 'zh' ? '导入的油猴脚本' : 'Imported Userscript');

      const usePureCss = Boolean(parsed.extractedCss);
      const now = Date.now();
      const mod: UserScript = {
        id: crypto.randomUUID(),
        name,
        description: parsed.description || '',
        engine: usePureCss ? 'css' : 'js',
        matches,
        code: usePureCss ? '' : parsed.body,
        css: usePureCss ? parsed.extractedCss : undefined,
        enabled: true,
        source: 'manual',
        runAt: usePureCss ? 'document_start' : (parsed.runAt ?? 'document_idle'),
        allowAllUrls: broad,
        createdAt: now,
        updatedAt: now,
      };
      await upsertUserScript(mod);
      importedNames.push(mod.name);
    }

    await syncRuntime();
    await onModsChanged();
    setImportSource('');
    setImportOpen(false);
    setFormError(null);
    setImportWarn(
      sawRemoteWarn
        ? lang === 'zh'
          ? '提示：刚导入的脚本包含远程依赖（@require）或跨站请求（GM_xmlhttpRequest）。受 Chrome MV3 安全规范限制，远程外部库不会自动拉取，轻量 DOM / GM_addStyle / GM_setValue 功能可正常运行。'
          : 'Note: This script uses @require or GM_xmlhttpRequest, which Chrome MV3 restricts for security. Standard DOM, GM_addStyle, and GM_getValue/setValue APIs work normally.'
        : null,
    );

    if (importedNames.length === 1) {
      onToast(
        lang === 'zh' ? `已导入脚本：${importedNames[0]}` : `Imported: ${importedNames[0]}`,
      );
    } else {
      onToast(
        lang === 'zh'
          ? `已批量导入 ${importedNames.length} 个脚本`
          : `Imported ${importedNames.length} userscripts`,
      );
    }
    return true;
  }

  async function handleImportPaste() {
    await importRawScripts([{ raw: importSource }]);
  }

  async function handleImportFileList(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setFormError(null);
    const entries: Array<{ raw: string; filename: string }> = [];
    for (const file of Array.from(fileList)) {
      if (file.name.toLowerCase().endsWith('.json')) {
        await handleRestoreBackupFile(file);
        continue;
      }
      if (file.size > 1_000_000) {
        setFormError(
          lang === 'zh'
            ? `文件「${file.name}」超过 1MB 安全上限。`
            : `File "${file.name}" exceeds the 1MB limit.`,
        );
        return;
      }
      const text = await file.text().catch(() => '');
      if (text.trim()) {
        entries.push({ raw: text, filename: file.name });
      }
    }
    await importRawScripts(entries);
  }

  async function handleSaveEditing() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setFormError(lang === 'zh' ? '请填写规则名称。' : 'Name is required.');
      return;
    }
    const matches = editing.matches.map((m) => m.trim()).filter(Boolean);
    const err = validateMatches(matches, Boolean(editing.allowAllUrls));
    if (err) {
      setFormError(err);
      return;
    }
    if (editing.engine === 'css' && !(editing.css ?? '').trim()) {
      setFormError(lang === 'zh' ? '请填写 CSS 样式内容。' : 'CSS content cannot be empty.');
      return;
    }
    if (editing.engine === 'js' && !editing.code.trim()) {
      setFormError(lang === 'zh' ? '请填写 JS 脚本内容。' : 'JS code cannot be empty.');
      return;
    }

    const next: UserScript = {
      ...editing,
      name,
      matches,
      runAt: editing.engine === 'css' ? 'document_start' : editing.runAt,
      updatedAt: Date.now(),
    };
    await upsertUserScript(next);
    await syncRuntime();
    await onModsChanged();
    setEditing(null);
    setFormError(null);
    onToast(lang === 'zh' ? `已保存修改：${next.name}` : `Saved: ${next.name}`);
  }

  if (editing) {
    return (
      <div className="animate-page-enter rounded-xl bg-card border border-border p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">
            {lang === 'zh' ? '编辑改造规则' : 'Edit Mod'}
          </h2>
          <SegmentedControl
            size="sm"
            value={editing.engine}
            onChange={(v: string) => setEditing({ ...editing, engine: v as ModEngine })}
            items={[
              { id: 'css', label: 'CSS' },
              { id: 'js', label: 'JS' },
            ]}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="pc-mod-name" className="text-[13px] font-medium text-muted-foreground">
            {lang === 'zh' ? '名称' : 'Name'}
          </label>
          <Input
            id="pc-mod-name"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder={lang === 'zh' ? '例如：隐藏知乎登录框' : 'e.g. Clean Article View'}
            className="text-[13px] max-w-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="pc-mod-matches" className="text-[13px] font-medium text-muted-foreground">
            {lang === 'zh' ? '匹配网址（@match，每行一条）' : '@match patterns (one per line)'}
          </label>
          <Textarea
            id="pc-mod-matches"
            rows={2}
            value={editing.matches.join('\n')}
            onChange={(e) =>
              setEditing({ ...editing, matches: e.target.value.split('\n') })
            }
            className="font-mono text-xs"
          />
          <label className="inline-flex items-center gap-2 pt-1 text-[13px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(editing.allowAllUrls)}
              onChange={(e) => setEditing({ ...editing, allowAllUrls: e.target.checked })}
            />
            <span>
              {lang === 'zh' ? '允许在所有网站生效（<all_urls>）' : 'Allow running on all sites'}
            </span>
          </label>
        </div>

        <div className="space-y-1">
          <label htmlFor="pc-mod-body" className="text-[13px] font-medium text-muted-foreground">
            {editing.engine === 'css' ? 'CSS' : 'JavaScript'}
          </label>
          <Textarea
            id="pc-mod-body"
            rows={10}
            value={editing.engine === 'css' ? editing.css ?? '' : editing.code}
            onChange={(e) =>
              editing.engine === 'css'
                ? setEditing({ ...editing, css: e.target.value })
                : setEditing({ ...editing, code: e.target.value })
            }
            className="font-mono text-xs leading-relaxed"
          />
        </div>

        {formError && (
          <p className="text-[13px] text-destructive leading-snug">{formError}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(null);
              setFormError(null);
            }}
            className="cursor-pointer"
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSaveEditing()}
            className="pc-press cursor-pointer"
          >
            {t('saveMod')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-4 pb-6"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDraggingFile(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          setDraggingFile(false);
          void handleImportFileList(e.dataTransfer.files);
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".js,.user.js,text/javascript,application/javascript"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleImportFileList(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleRestoreBackupFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Top Action Bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant={mods.length === 0 ? 'ghost' : 'outline'}
          onClick={() => {
            setImportOpen((v) => !v);
            setFormError(null);
          }}
          className="pc-press gap-1.5 text-[13px] cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" />
          <span>{t('importScript')}</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={startNewCustomMod}
          className="pc-press gap-1.5 text-[13px] cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t('newManualMod')}</span>
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {mods.length > 0 && (
            <button
              type="button"
              onClick={handleExportBackupJson}
              className="pc-press inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>{t('backupJson')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="pc-press inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors cursor-pointer"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span>{t('restoreJson')}</span>
          </button>
        </div>
      </div>

      {/* Compact Search + Engine/Status Filter Bar (shown when library has >= 4 mods) */}
      {mods.length >= 4 && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('modsSearchPlaceholder')}
              aria-label={t('modsSearchPlaceholder')}
              className="pl-8 pr-7 h-8 text-xs max-w-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                { id: 'all', label: t('modsFilterAll') },
                { id: 'enabled', label: t('modsFilterEnabled') },
                { id: 'css', label: 'CSS' },
                { id: 'js', label: 'JS' },
              ] as Array<{ id: ModFilterKey; label: string }>
            ).map((chip) => {
              const active = modFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setModFilter(chip.id)}
                  className={cn(
                    'pc-press px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                    active
                      ? 'bg-primary text-white border-primary'
                      : 'bg-card hover:bg-secondary/75 text-muted-foreground hover:text-foreground border-border/80',
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* File + Paste Import .user.js Drawer */}
      {(importOpen || draggingFile) && (
        <div className="animate-page-enter rounded-xl border border-border bg-card p-3.5 space-y-3">
          {/* 1-Click Local .user.js File Picker / Dropzone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'w-full rounded-lg border border-dashed px-3 py-3 text-center transition-colors cursor-pointer flex flex-col items-center gap-1',
              draggingFile
                ? 'border-primary bg-primary/8 text-foreground'
                : 'border-border hover:border-primary/50 bg-secondary/35 hover:bg-secondary/60 text-foreground',
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
              <Upload className="h-3.5 w-3.5 text-primary" />
              <span>
                {lang === 'zh'
                  ? '点击选择本地 .user.js 文件（支持拖拽或多选）'
                  : 'Choose or drop .user.js files here'}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {lang === 'zh'
                ? '兼容 Tampermonkey / 脚本猫头部及常用 GM_addStyle / GM_setValue 接口'
                : 'Supports Tampermonkey headers & GM_addStyle / GM_getValue / GM_setClipboard'}
            </span>
          </button>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {lang === 'zh'
                ? '或者直接粘贴油猴脚本（==UserScript==）、小红书配方口令（#PC1:...#）或分享链接：'
                : 'Or paste userscript code (==UserScript==), a #PC1:...# recipe shortcode, or a share link:'}
            </p>
            <Textarea
              rows={5}
              value={importSource}
              onChange={(e) => setImportSource(e.target.value)}
              placeholder={t('importPlaceholder')}
              className="font-mono text-xs"
            />
          </div>
          {formError && <p className="text-[13px] text-destructive">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setImportOpen(false);
                setDraggingFile(false);
              }}
              className="cursor-pointer"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!importSource.trim()}
              onClick={() => void handleImportPaste()}
              className="pc-press cursor-pointer"
            >
              {t('importScript')}
            </Button>
          </div>
        </div>
      )}

      {/* Optional MV3 Compatibility Notice when an imported script used @require / GM_xmlhttpRequest */}
      {importWarn && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/8 px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs text-foreground leading-relaxed">
          <span>{importWarn}</span>
          <button
            type="button"
            onClick={() => setImportWarn(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* JS Engine Off Notice (only if user actually has JS scripts enabled) */}
      {hasEnabledJsMods && availability?.available === false && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/8 p-3 space-y-2">
          <div className="flex items-start gap-2 text-[13px]">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed text-foreground">{t('jsPermTitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                  const firstJsMod = mods.find((m) => m.enabled && m.engine === 'js');
                  chrome.runtime
                    .sendMessage({
                      type: 'OPEN_EXTENSION_DETAILS',
                      payload: { modId: firstJsMod?.id },
                    })
                    .catch(() => {});
                }
              }}
              className="text-[13px] gap-1 cursor-pointer"
            >
              <span>{t('openExtDetails')}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const firstJsMod = mods.find((m) => m.enabled && m.engine === 'js');
                void recheckOrRecoverJsPermission({
                  recheck: onRecheckAvailability,
                  modId: firstJsMod?.id,
                  tabId: activeTab.tabId,
                  beforeReload: () =>
                    onToast(
                      lang === 'zh'
                        ? '检测到授权已开启，正在重启引擎并应用…'
                        : 'Permission detected! Reloading engine to apply…',
                    ),
                });
              }}
              className="text-[13px] cursor-pointer"
            >
              {lang === 'zh' ? '重新检测' : 'Re-check'}
            </Button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {mods.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 px-5 text-center space-y-3.5">
          <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[260px] mx-auto">
            {t('noModsYet')}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={onNavigateStudio}
            className="pc-press px-4 text-[13px] cursor-pointer"
          >
            {lang === 'zh' ? '前往工坊挑选现成同款' : 'Browse Recipes in Studio'}
          </Button>
        </div>
      ) : filteredMods.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-8 px-5 text-center space-y-2">
          <p className="text-[13px] text-muted-foreground">{t('modsNoSearchMatch')}</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setModFilter('all');
            }}
            className="text-xs font-medium text-primary hover:underline cursor-pointer"
          >
            {t('modsResetFilter')}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {activeSiteList.length > 0 && (
            <ModGroup
              title={`${t('activeSiteMods')}${activeTab.host ? ` · ${activeTab.host}` : ''}`}
              items={activeSiteList}
              hideMatches
              lang={lang}
              t={t}
              confirmDeleteId={confirmDeleteId}
              onToggle={handleToggle}
              onRun={handleRun}
              onEdit={setEditing}
              onCopy={handleCopyUserscript}
              onShare={handleShareRecipe}
              onDownload={handleDownloadUserscript}
              onDelete={handleDeleteClick}
            />
          )}

          {otherSiteList.length > 0 && (
            <ModGroup
              title={activeSiteList.length > 0 ? t('otherSiteMods') : t('tabMods')}
              items={otherSiteList}
              lang={lang}
              t={t}
              confirmDeleteId={confirmDeleteId}
              onToggle={handleToggle}
              onRun={handleRun}
              onEdit={setEditing}
              onCopy={handleCopyUserscript}
              onShare={handleShareRecipe}
              onDownload={handleDownloadUserscript}
              onDelete={handleDeleteClick}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModGroup({
  title,
  items,
  hideMatches = false,
  lang,
  t,
  confirmDeleteId,
  onToggle,
  onRun,
  onEdit,
  onCopy,
  onShare,
  onDownload,
  onDelete,
}: {
  title: string;
  items: UserScript[];
  hideMatches?: boolean;
  lang: Lang;
  t: (k: string) => string;
  confirmDeleteId: string | null;
  onToggle: (m: UserScript) => void;
  onRun: (m: UserScript) => void;
  onEdit: (m: UserScript) => void;
  onCopy: (m: UserScript) => void;
  onShare: (m: UserScript) => void;
  onDownload: (m: UserScript) => void;
  onDelete: (m: UserScript) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[14px] font-semibold text-foreground px-0.5">{title}</h3>
      <div className="divide-y divide-border/70 rounded-xl border border-border bg-card overflow-hidden">
        {items.map((mod) => {
          const confirmingDelete = confirmDeleteId === mod.id;
          return (
            <div key={mod.id} className="p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        'text-[14px] font-medium leading-snug',
                        !mod.enabled && 'text-muted-foreground line-through',
                      )}
                    >
                      {mod.name}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-xs px-1.5 py-0 font-mono"
                    >
                      {mod.engine === 'css' ? 'CSS' : 'JS'}
                    </Badge>
                  </div>
                  {mod.description && (
                    <p className="text-[13px] text-muted-foreground leading-relaxed">
                      {mod.description}
                    </p>
                  )}
                  {!hideMatches && (
                    <div className="font-mono text-xs text-muted-foreground truncate">
                      {mod.matches.join(', ')}
                    </div>
                  )}
                </div>

                <Switch
                  checked={mod.enabled}
                  onCheckedChange={() => onToggle(mod)}
                  aria-label={mod.name}
                />
              </div>

              <div className="flex items-center gap-3 text-[13px] text-muted-foreground pt-0.5">
                {mod.engine === 'js' && (
                  <button
                    type="button"
                    onClick={() => onRun(mod)}
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{t('runNow')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(mod)}
                  className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>{t('editMod')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShare(mod)}
                  title={t('shareRecipe')}
                  className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>{t('shareRecipe')}</span>
                </button>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onCopy(mod)}
                    title={t('exportUserscript')}
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>.user.js</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(mod)}
                    title={t('downloadUserscript')}
                    aria-label={`${t('downloadUserscript')}: ${mod.name}`}
                    className="inline-flex items-center p-0.5 rounded hover:text-foreground hover:bg-secondary/70 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(mod)}
                  className={cn(
                    'ml-auto inline-flex items-center gap-1 cursor-pointer transition-colors',
                    confirmingDelete
                      ? 'pc-confirm-pop px-2 py-0.5 rounded-md bg-destructive/12 text-destructive font-medium'
                      : 'hover:text-destructive',
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{confirmingDelete ? t('confirmDelete') : t('deleteMod')}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
