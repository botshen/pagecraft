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
  mergeImportedUserScripts,
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
import {
  decodeRecipeShortcode,
  formatRecipeSharePost,
} from '~/lib/userscripts/share';
import {
  DEFAULT_PACK_HUB_URL,
  buildGitHubPackSubmissionUrl,
  buildPackFromUserScripts,
  decodePackShortcode,
  formatPackSharePost,
  instantiatePackMods,
  parsePackJson,
  resolveCatalogPack,
  serializePackJson,
  slugifyPackId,
  type CommunityPack,
  type LocalizedCatalogPack,
} from '~/lib/userscripts/packs';
import { COMMUNITY_CATALOG_PACKS } from '~/lib/userscripts/community-catalog.generated';
import { auditPackSafety } from '~/lib/userscripts/safety-audit';
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
  Package,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Send,
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
  pendingPack?: CommunityPack | null;
  onConsumePendingPack?: () => void;
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
  pendingPack,
  onConsumePendingPack,
  onModsChanged,
  onRecheckAvailability,
  onNavigateStudio,
  onToast,
  lang,
  t,
}: Props) {
  const [editing, setEditing] = useState<UserScript | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [packBuilderOpen, setPackBuilderOpen] = useState(false);
  const [reviewingPack, setReviewingPack] = useState<CommunityPack | null>(null);
  const [reviewSelectedIds, setReviewSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(() => new Set());
  const [builderModIds, setBuilderModIds] = useState<Set<string>>(() => new Set());
  const [builderName, setBuilderName] = useState('');
  const [builderAuthor, setBuilderAuthor] = useState('@community');
  const [builderDesc, setBuilderDesc] = useState('');
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

  function openPackReview(pack: CommunityPack) {
    setReviewingPack(pack);
    setReviewSelectedIds(new Set(pack.mods.map((m) => m.id)));
    setExpandedRuleIds(new Set());
    setImportOpen(false);
    setHubOpen(false);
    setPackBuilderOpen(false);
    setFormError(null);
  }

  useEffect(() => {
    if (pendingPack) {
      openPackReview(pendingPack);
      onConsumePendingPack?.();
    }
  }, [pendingPack, onConsumePendingPack]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const hasEnabledJsMods = mods.some((m) => m.enabled && m.engine === 'js');
  const enabledCount = useMemo(() => mods.filter((m) => m.enabled).length, [mods]);
  const cssCount = useMemo(() => mods.filter((m) => m.engine === 'css').length, [mods]);
  const jsCount = useMemo(() => mods.filter((m) => m.engine === 'js').length, [mods]);

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

  const installedPackIds = useMemo(
    () => new Set(mods.map((m) => m.packId).filter((id): id is string => Boolean(id))),
    [mods],
  );

  const sortedCatalogPacks = useMemo<LocalizedCatalogPack[]>(() => {
    const host = (activeTab.host ?? '').toLowerCase();
    return [...COMMUNITY_CATALOG_PACKS].sort((a, b) => {
      const aMatch =
        (host && a.siteHints.some((h) => host.includes(h))) ||
        (activeTab.url && a.zh.mods.some((m) => urlMatchesAny(activeTab.url, m.matches)));
      const bMatch =
        (host && b.siteHints.some((h) => host.includes(h))) ||
        (activeTab.url && b.zh.mods.some((m) => urlMatchesAny(activeTab.url, m.matches)));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }, [activeTab.host, activeTab.url]);

  const packSafetyReport = useMemo(() => {
    if (!reviewingPack) return null;
    const pickedMods = reviewingPack.mods.filter((m) => reviewSelectedIds.has(m.id));
    return auditPackSafety(pickedMods.length > 0 ? pickedMods : reviewingPack.mods);
  }, [reviewingPack, reviewSelectedIds]);

  const builtPackPreview = useMemo<CommunityPack | null>(() => {
    if (!packBuilderOpen) return null;
    const selected = mods.filter((m) => builderModIds.has(m.id));
    if (selected.length === 0) return null;
    return buildPackFromUserScripts(selected, {
      name: builderName.trim() || (lang === 'zh' ? '我的 PageCraft 配方包' : 'My PageCraft Pack'),
      author: builderAuthor.trim() || '@community',
      description: builderDesc.trim(),
    });
  }, [packBuilderOpen, mods, builderModIds, builderName, builderAuthor, builderDesc, lang]);

  function openExternalUrl(url: string) {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url }).catch(() => window.open(url, '_blank', 'noopener'));
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function startPackBuilder() {
    const nextOpen = !packBuilderOpen;
    setPackBuilderOpen(nextOpen);
    if (!nextOpen) return;
    setImportOpen(false);
    setHubOpen(false);
    setReviewingPack(null);
    const siteMatches = activeTab.url
      ? mods.filter((m) => urlMatchesAny(activeTab.url, m.matches))
      : [];
    const defaultSet = (siteMatches.length > 0 ? siteMatches : mods.filter((m) => m.enabled).length > 0 ? mods.filter((m) => m.enabled) : mods).slice(0, 12);
    setBuilderModIds(new Set(defaultSet.map((m) => m.id)));
    setBuilderName(
      activeTab.host
        ? lang === 'zh'
          ? `${activeTab.host} 定制套装`
          : `${activeTab.host} Custom Pack`
        : lang === 'zh'
          ? '我的网页定制套装'
          : 'My Custom Recipe Pack',
    );
    setBuilderDesc('');
  }

  async function handleConfirmPackImport() {
    if (!reviewingPack || reviewSelectedIds.size === 0) return;
    if (packSafetyReport?.level === 'blocked') return;

    const instantiated = instantiatePackMods(reviewingPack, reviewSelectedIds);
    if (instantiated.length === 0) return;

    await mergeImportedUserScripts(instantiated);
    await syncRuntime();
    await onModsChanged();

    const usesJs = instantiated.some((m) => m.engine === 'js');
    if (usesJs) {
      const avail = await onRecheckAvailability();
      if (!avail.available) {
        onToast(
          lang === 'zh'
            ? `已导入「${reviewingPack.name}」${instantiated.length} 条规则（JS 规则需开启允许用户脚本）`
            : `Imported ${instantiated.length} rule(s) from "${reviewingPack.name}" (enable Allow User Scripts for JS)`,
        );
        setReviewingPack(null);
        return;
      }
    }

    onToast(
      lang === 'zh'
        ? `已导入并启用《${reviewingPack.name}》（${instantiated.length} 条规则）`
        : `Imported & activated "${reviewingPack.name}" (${instantiated.length} rule(s))`,
    );
    setReviewingPack(null);
  }

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
            ? '请先在提示栏开启「允许用户脚本」开关'
            : 'Enable "Allow User Scripts" first to run JS scripts',
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
            ? `已重新加载并执行：${mod.name}`
            : `Reloaded tab and executed: ${mod.name}`
          : lang === 'zh'
            ? `样式已在当前页面生效：${mod.name}`
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
        ? `已导出 ${mods.length} 条规则备份`
        : `Exported ${mods.length} rule(s) to JSON`,
    );
  }

  async function handleRestoreBackupFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      onToast(lang === 'zh' ? '备份文件超过 5MB 上限' : 'Backup file exceeds 5MB limit');
      return;
    }
    try {
      const rawText = await file.text();
      const packManifest = parsePackJson(rawText);
      if (packManifest) {
        openPackReview(packManifest);
        return;
      }

      const parsed: unknown = JSON.parse(rawText);
      const rawItems: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { mods?: unknown }).mods)
          ? (parsed as { mods: unknown[] }).mods
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
            : 'No valid rules found in backup JSON',
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
          ? `已恢复 ${validMods.length} 条规则`
          : `Restored ${validMods.length} rule(s)`,
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
      code: '(() => {\n  // DOM script\n})();',
      css: '/* .promo-banner { display: none !important; } */\n',
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
      const decodedPack =
        decodePackShortcode(entry.raw) ?? parsePackJson(entry.raw);
      if (decodedPack) {
        setImportSource('');
        openPackReview(decodedPack);
        return true;
      }

      const sharedRecipe = decodeRecipeShortcode(entry.raw);
      if (sharedRecipe) {
        const broad = sharedRecipe.matches.some((m) => isBroadMatch(m));
        const err = validateMatches(sharedRecipe.matches, broad);
        if (err) {
          setFormError(err);
          return false;
        }
        setImportSource('');
        openPackReview({
          kind: 'pagecraft-pack',
          version: 1,
          id: slugifyPackId(sharedRecipe.name, 'shared-recipe'),
          name: sharedRecipe.name,
          description: sharedRecipe.description,
          author: '@shared',
          tags: [],
          siteHints: [],
          mods: [
            {
              id: slugifyPackId(sharedRecipe.name, 'rule-1'),
              name: sharedRecipe.name,
              description: sharedRecipe.description,
              engine: sharedRecipe.engine,
              matches: sharedRecipe.matches,
              body: sharedRecipe.body,
              runAt: sharedRecipe.runAt,
              targetSelectors: sharedRecipe.targetSelectors,
            },
          ],
        });
        return true;
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
        (lang === 'zh' ? '导入的油猴脚本' : 'Imported userscript');

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
          ? '提示：导入的脚本包含 @require 或 GM_xmlhttpRequest。受 Chrome MV3 安全规范限制，远程库不会拉取，标准 DOM / GM_addStyle / GM_setValue 可正常运行。'
          : 'Note: This script references @require or GM_xmlhttpRequest, which Chrome MV3 blocks. Standard DOM, GM_addStyle, and GM_getValue/setValue APIs run normally.'
        : null,
    );

    if (importedNames.length === 1) {
      onToast(lang === 'zh' ? `已导入：${importedNames[0]}` : `Imported: ${importedNames[0]}`);
    } else {
      onToast(
        lang === 'zh'
          ? `已导入 ${importedNames.length} 个脚本`
          : `Imported ${importedNames.length} scripts`,
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
            ? `文件「${file.name}」超过 1MB 上限。`
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
      setFormError(lang === 'zh' ? '请填写规则名称。' : 'Rule name is required.');
      return;
    }
    const matches = editing.matches.map((m) => m.trim()).filter(Boolean);
    const err = validateMatches(matches, Boolean(editing.allowAllUrls));
    if (err) {
      setFormError(err);
      return;
    }
    if (editing.engine === 'css' && !(editing.css ?? '').trim()) {
      setFormError(lang === 'zh' ? '请填写 CSS 内容。' : 'CSS content cannot be empty.');
      return;
    }
    if (editing.engine === 'js' && !editing.code.trim()) {
      setFormError(lang === 'zh' ? '请填写 JS 脚本内容。' : 'JavaScript code cannot be empty.');
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
    onToast(lang === 'zh' ? `已保存：${next.name}` : `Saved: ${next.name}`);
  }

  if (editing) {
    return (
      <div className="pc-enter rounded-[10px] bg-card border border-border divide-y divide-border overflow-hidden mb-6">
        <div className="px-3.5 py-2.5 bg-secondary/35 flex items-center justify-between gap-2">
          <h2 className="text-[13.5px] font-semibold text-foreground">
            {lang === 'zh' ? '编辑改造规则' : 'Edit rule'}
          </h2>
          <SegmentedControl
            size="sm"
            className="w-28"
            value={editing.engine}
            onChange={(v: string) => setEditing({ ...editing, engine: v as ModEngine })}
            items={[
              { id: 'css', label: 'CSS' },
              { id: 'js', label: 'JS' },
            ]}
          />
        </div>

        <div className="p-3.5 space-y-3">
          <div className="space-y-1">
            <label htmlFor="pc-mod-name" className="text-xs font-medium text-muted-foreground">
              {lang === 'zh' ? '规则名称' : 'Name'}
            </label>
            <Input
              id="pc-mod-name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={lang === 'zh' ? '例如：隐藏知乎右侧栏' : 'e.g. Clean article view'}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="pc-mod-matches" className="text-xs font-medium text-muted-foreground">
              {lang === 'zh' ? '@match 网址规则（每行一条）' : '@match patterns (one per line)'}
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
            <label className="inline-flex items-center gap-2 pt-1 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(editing.allowAllUrls)}
                onChange={(e) => setEditing({ ...editing, allowAllUrls: e.target.checked })}
                className="accent-[var(--pc-accent)]"
              />
              <span>
                {lang === 'zh' ? '允许匹配所有站点（<all_urls>）' : 'Allow running on all sites'}
              </span>
            </label>
          </div>

          <div className="space-y-1">
            <label htmlFor="pc-mod-body" className="text-xs font-medium text-muted-foreground">
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
            <p className="text-xs text-destructive leading-snug">{formError}</p>
          )}
        </div>

        <div className="px-3.5 py-2.5 bg-secondary/25 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(null);
              setFormError(null);
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSaveEditing()}
          >
            {t('saveMod')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-3.5 pb-6 pc-enter"
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
        accept=".js,.user.js,.json,text/javascript,application/javascript,application/json"
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

      {/* Top Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant={hubOpen ? 'primary' : 'secondary'}
          onClick={() => {
            setHubOpen((v) => !v);
            setImportOpen(false);
            setPackBuilderOpen(false);
            setReviewingPack(null);
            setFormError(null);
          }}
          className="text-xs px-2.5"
        >
          <Package className="h-3.5 w-3.5" />
          <span>{t('communityHubBtn')}</span>
        </Button>
        <Button
          size="sm"
          variant={importOpen ? 'primary' : 'secondary'}
          onClick={() => {
            setImportOpen((v) => !v);
            setHubOpen(false);
            setPackBuilderOpen(false);
            setReviewingPack(null);
            setFormError(null);
          }}
          className="text-xs px-2.5"
        >
          <Download className="h-3.5 w-3.5" />
          <span>{t('importScript')}</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={startNewCustomMod}
          className="text-xs px-2.5"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t('newManualMod')}</span>
        </Button>
        {mods.length > 0 && (
          <Button
            size="sm"
            variant={packBuilderOpen ? 'primary' : 'secondary'}
            onClick={startPackBuilder}
            className="text-xs px-2.5"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>{t('packShareBtn')}</span>
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {mods.length > 0 && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={handleExportBackupJson}
              className="px-2"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>{t('backupJson')}</span>
            </Button>
          )}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => backupInputRef.current?.click()}
            className="px-2"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span>{t('restoreJson')}</span>
          </Button>
        </div>
      </div>

      {/* Security Audit & Source Review Import Sheet (MV3 User-Confirmed Import) */}
      {reviewingPack && packSafetyReport && (
        <section className="pc-enter rounded-[10px] border border-[var(--pc-accent)]/45 bg-card divide-y divide-border overflow-hidden">
          <div className="px-3.5 py-2.5 bg-secondary/40 flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                <span className="text-[13px] font-semibold text-foreground">
                  {t('reviewPackTitle')}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground truncate">
                {reviewingPack.name} · {reviewingPack.author} · {reviewingPack.mods.length}{' '}
                {lang === 'zh' ? '条规则' : 'rule(s)'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReviewingPack(null)}
              aria-label={t('cancel')}
              className="pc-btn p-1 rounded-[5px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div
            className={cn(
              'px-3.5 py-2.5 text-xs leading-relaxed space-y-1',
              packSafetyReport.level === 'blocked'
                ? 'bg-destructive/10 text-destructive'
                : packSafetyReport.level === 'review_warning'
                  ? 'bg-amber-500/10 text-foreground'
                  : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
            )}
          >
            <div className="font-semibold">
              {packSafetyReport.level === 'safe_css'
                ? `✓ ${t('safetySafeCss')}`
                : packSafetyReport.level === 'clean_local_js'
                  ? `✓ ${t('safetyCleanLocalJs')}`
                  : packSafetyReport.level === 'blocked'
                    ? `✕ ${t('safetyBlocked')}`
                    : `⚠ ${t('safetyReviewWarn')}`}
            </div>
            {packSafetyReport.findings.map((f) => (
              <div key={f.code} className="text-[11.5px] opacity-90">
                • {lang === 'zh' ? f.messageZh : f.messageEn}
              </div>
            ))}
          </div>

          <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
            {reviewingPack.mods.map((rule) => {
              const checked = reviewSelectedIds.has(rule.id);
              const expanded = expandedRuleIds.has(rule.id);
              return (
                <div key={rule.id} className="px-3.5 py-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setReviewSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(rule.id);
                            else next.delete(rule.id);
                            return next;
                          });
                        }}
                        className="mt-0.5 accent-[var(--pc-accent)] shrink-0"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12.5px] font-medium text-foreground">
                            {rule.name}
                          </span>
                          <Badge
                            variant={rule.engine === 'css' ? 'default' : 'secondary'}
                            className="font-mono uppercase px-1.5 py-0 text-[10px]"
                          >
                            {rule.engine}
                          </Badge>
                        </div>
                        {rule.description && (
                          <p className="text-[11.5px] text-muted-foreground leading-snug">
                            {rule.description}
                          </p>
                        )}
                        <div className="font-mono text-[11px] text-muted-foreground truncate">
                          {rule.matches.join(', ')}
                        </div>
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedRuleIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(rule.id)) next.delete(rule.id);
                          else next.add(rule.id);
                          return next;
                        });
                      }}
                      className="pc-btn inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[5px] text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0 cursor-pointer"
                    >
                      <span>{expanded ? t('hideSource') : t('viewSource')}</span>
                      {expanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                  {expanded && (
                    <pre className="p-2.5 rounded-[7px] bg-secondary/75 border border-border font-mono text-[11px] leading-relaxed overflow-x-auto max-h-40 text-foreground whitespace-pre">
                      {rule.body}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-3.5 py-2.5 bg-secondary/25 flex items-center justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => setReviewingPack(null)}>
              {t('cancel')}
            </Button>
            <Button
              size="xs"
              variant="primary"
              disabled={reviewSelectedIds.size === 0 || packSafetyReport.level === 'blocked'}
              onClick={() => void handleConfirmPackImport()}
            >
              {t('reviewConfirmBtn')} ({reviewSelectedIds.size})
            </Button>
          </div>
        </section>
      )}

      {/* Offline Bundled Community Recipe Hub Drawer */}
      {hubOpen && (
        <section className="pc-enter rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          <div className="px-3.5 py-2.5 bg-secondary/35 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <Package className="h-4 w-4 text-primary" />
              <span>{t('communityHubBtn')}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openExternalUrl(DEFAULT_PACK_HUB_URL)}
                className="pc-focus inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                <span>{t('openWebHubBtn')}</span>
              </button>
              <button
                type="button"
                onClick={() => setHubOpen(false)}
                aria-label={t('cancel')}
                className="pc-btn p-1 rounded-[5px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="divide-y divide-border max-h-[340px] overflow-y-auto">
            {sortedCatalogPacks.map((entry) => {
              const v = lang === 'zh' ? entry.zh : entry.en;
              const isInstalled = installedPackIds.has(entry.id);
              const host = (activeTab.host ?? '').toLowerCase();
              const isForSite = Boolean(
                (host && entry.siteHints.some((h) => host.includes(h))) ||
                (activeTab.url && entry.zh.mods.some((m) => urlMatchesAny(activeTab.url, m.matches))),
              );
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'px-3.5 py-2.5 flex items-start justify-between gap-3',
                    isForSite && 'bg-[var(--pc-accent-subtle)]/35',
                  )}
                >
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-medium text-foreground">{v.name}</span>
                      <Badge variant="outline" className="px-1.5 py-0 text-[10.5px]">
                        {v.mods.length} {lang === 'zh' ? '条规则' : 'rules'}
                      </Badge>
                      {isForSite && (
                        <Badge variant="default" className="px-1.5 py-0 text-[10.5px]">
                          {t('forThisSite')}
                        </Badge>
                      )}
                      {isInstalled && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10.5px]">
                          {lang === 'zh' ? '已安装' : 'Installed'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug">
                      {v.description}
                    </p>
                    <div className="font-mono text-[11px] text-muted-foreground truncate">
                      {entry.siteHints.join(' · ')}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant={isInstalled ? 'secondary' : 'primary'}
                    onClick={() => openPackReview(resolveCatalogPack(entry, lang))}
                    className="shrink-0 mt-0.5"
                  >
                    {isInstalled
                      ? lang === 'zh'
                        ? '查看 / 更新'
                        : 'Update'
                      : t('handoffReviewBtn')}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bundle & Submit Community Pack Sheet */}
      {packBuilderOpen && (
        <section className="pc-enter rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          <div className="px-3.5 py-2.5 bg-secondary/35 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <Share2 className="h-4 w-4 text-primary" />
              <span>{t('packBuilderTitle')}</span>
            </div>
            <button
              type="button"
              onClick={() => setPackBuilderOpen(false)}
              aria-label={t('cancel')}
              className="pc-btn p-1 rounded-[5px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-3.5 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium text-muted-foreground">
                  {t('packNameLabel')}
                </label>
                <Input
                  value={builderName}
                  onChange={(e) => setBuilderName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium text-muted-foreground">
                  {t('packAuthorLabel')}
                </label>
                <Input
                  value={builderAuthor}
                  onChange={(e) => setBuilderAuthor(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11.5px] font-medium text-muted-foreground">
                {t('packDescLabel')}
              </label>
              <Input
                value={builderDesc}
                onChange={(e) => setBuilderDesc(e.target.value)}
                placeholder={
                  lang === 'zh'
                    ? '例如：屏蔽推荐流并优化阅读排版'
                    : 'e.g. Clean feed promos and polish article typography'
                }
                className="h-8 text-xs"
              />
            </div>
            <div className="rounded-[8px] border border-border divide-y divide-border max-h-36 overflow-y-auto">
              {mods.map((m) => (
                <label
                  key={m.id}
                  className="px-2.5 py-1.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-secondary/35"
                >
                  <input
                    type="checkbox"
                    checked={builderModIds.has(m.id)}
                    onChange={(e) => {
                      setBuilderModIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(m.id);
                        else next.delete(m.id);
                        return next;
                      });
                    }}
                    className="accent-[var(--pc-accent)] shrink-0"
                  />
                  <span className="truncate flex-1 font-medium text-foreground">{m.name}</span>
                  <Badge variant="outline" className="font-mono uppercase px-1 py-0 text-[10px]">
                    {m.engine}
                  </Badge>
                </label>
              ))}
            </div>
          </div>
          <div className="px-3.5 py-2.5 bg-secondary/25 flex items-center gap-1.5 flex-wrap">
            <Button
              type="button"
              size="xs"
              variant="primary"
              disabled={!builtPackPreview}
              onClick={() => {
                if (!builtPackPreview) return;
                void navigator.clipboard.writeText(formatPackSharePost(builtPackPreview, lang));
                onToast(t('copiedPackPostToast'));
              }}
            >
              <Copy className="h-3 w-3" />
              <span>{t('copyPackPostBtn')}</span>
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={!builtPackPreview}
              onClick={() => {
                if (!builtPackPreview) return;
                const filename = `${builtPackPreview.id}.pagecraft-pack.json`;
                triggerBrowserDownload(
                  filename,
                  serializePackJson(builtPackPreview),
                  'application/json;charset=utf-8',
                );
                onToast(lang === 'zh' ? `已下载：${filename}` : `Downloaded: ${filename}`);
              }}
            >
              <FileDown className="h-3 w-3" />
              <span>{t('downloadPackJsonBtn')}</span>
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={!builtPackPreview}
              onClick={() => {
                if (!builtPackPreview) return;
                openExternalUrl(buildGitHubPackSubmissionUrl(builtPackPreview));
              }}
              className="ml-auto"
            >
              <Send className="h-3 w-3" />
              <span>{t('submitGitHubHubBtn')}</span>
            </Button>
          </div>
        </section>
      )}

      {/* Flat-Divided Drag-and-Drop / #PC1:...# Import Sheet (strict max 2 boxes deep) */}
      {(importOpen || draggingFile) && (
        <section className="pc-enter rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'pc-focus w-full px-3.5 py-3 text-left transition-colors cursor-pointer flex items-center justify-between gap-2',
              draggingFile
                ? 'bg-[var(--pc-accent-subtle)] text-foreground'
                : 'bg-secondary/45 hover:bg-secondary/75 text-foreground',
            )}
          >
            <div className="min-w-0 space-y-0.5">
              <div className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                <Upload className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>
                  {lang === 'zh'
                    ? '选择或拖拽本地 .user.js / .json 文件'
                    : 'Choose or drop .user.js / .json files'}
                </span>
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                {lang === 'zh'
                  ? '支持 Tampermonkey 脚本头及 GM_addStyle / GM_setValue'
                  : 'Supports Tampermonkey headers and GM_addStyle / GM_getValue'}
              </p>
            </div>
            <Badge variant="outline" className="font-mono shrink-0">
              .user.js
            </Badge>
          </button>

          <div>
            <Textarea
              rows={5}
              value={importSource}
              onChange={(e) => setImportSource(e.target.value)}
              placeholder={t('importPlaceholder')}
              className="border-0 rounded-none bg-transparent focus-visible:ring-0 focus-visible:border-transparent font-mono text-xs"
            />
            {formError && (
              <p className="px-3.5 pb-2 text-xs text-destructive">{formError}</p>
            )}
          </div>

          <div className="px-3.5 py-2 bg-secondary/25 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              ==UserScript== · #PC1 · #PCP1 · .json
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setImportOpen(false);
                  setDraggingFile(false);
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="xs"
                disabled={!importSource.trim()}
                onClick={() => void handleImportPaste()}
              >
                {t('importScript')}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Search + Segmented Filter Bar */}
      {mods.length > 0 && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('modsSearchPlaceholder')}
              aria-label={t('modsSearchPlaceholder')}
              className="pl-8 pr-7 h-8 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="pc-focus absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <SegmentedControl
            size="sm"
            className="w-full"
            value={modFilter}
            onChange={(v: string) => setModFilter(v as ModFilterKey)}
            items={[
              { id: 'all', label: t('modsFilterAll'), badge: mods.length },
              { id: 'enabled', label: t('modsFilterEnabled'), badge: enabledCount || undefined },
              { id: 'css', label: 'CSS', badge: cssCount || undefined },
              { id: 'js', label: 'JS', badge: jsCount || undefined },
            ]}
          />
        </div>
      )}

      {/* MV3 Compatibility Notice */}
      {importWarn && (
        <div className="rounded-[10px] border border-amber-600/30 bg-amber-500/[0.08] px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs text-foreground leading-relaxed">
          <span>{importWarn}</span>
          <button
            type="button"
            onClick={() => setImportWarn(null)}
            aria-label={t('cancel')}
            className="pc-focus shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* JS Engine Off Notice */}
      {hasEnabledJsMods && availability?.available === false && (
        <div className="rounded-[10px] border border-amber-600/30 bg-card p-3.5 space-y-2.5">
          <div className="flex items-start gap-2 text-[13px]">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-snug text-foreground">{t('jsPermTitle')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="xs"
              variant="secondary"
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
            >
              <span>{t('openExtDetails')}</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                const firstJsMod = mods.find((m) => m.enabled && m.engine === 'js');
                void recheckOrRecoverJsPermission({
                  recheck: onRecheckAvailability,
                  modId: firstJsMod?.id,
                  tabId: activeTab.tabId,
                  beforeReload: () =>
                    onToast(
                      lang === 'zh'
                        ? '已检测到授权，正在重启引擎并应用…'
                        : 'Permission detected. Reloading engine…',
                    ),
                });
              }}
            >
              {lang === 'zh' ? '检查开关' : 'Re-check'}
            </Button>
          </div>
        </div>
      )}

      {/* Empty State or Hairline-Divided Mod Cards */}
      {mods.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-card py-9 px-4 text-center space-y-3">
          <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[260px] mx-auto">
            {t('noModsYet')}
          </p>
          <Button variant="primary" size="sm" onClick={onNavigateStudio}>
            {lang === 'zh' ? '前往工坊选用配方' : 'Open Studio recipes'}
          </Button>
        </div>
      ) : filteredMods.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-card py-7 px-4 text-center space-y-2">
          <p className="text-[13px] text-muted-foreground">{t('modsNoSearchMatch')}</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setModFilter('all');
            }}
            className="pc-focus text-xs font-medium text-primary hover:underline cursor-pointer"
          >
            {t('modsResetFilter')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {activeSiteList.length > 0 && (
            <ModGroup
              title={`${t('activeSiteMods')}${activeTab.host ? ` · ${activeTab.host}` : ''}`}
              items={activeSiteList}
              hideMatches
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-foreground truncate">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-border rounded-[10px] border border-border bg-card overflow-hidden">
        {items.map((mod) => {
          const confirmingDelete = confirmDeleteId === mod.id;
          return (
            <div key={mod.id} className="pc-row p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        'text-[13.5px] font-medium leading-snug text-foreground',
                        !mod.enabled && 'text-muted-foreground line-through',
                      )}
                    >
                      {mod.name}
                    </span>
                    <Badge
                      variant={mod.engine === 'css' ? 'default' : 'secondary'}
                      className="font-mono uppercase px-1.5 py-0"
                    >
                      {mod.engine}
                    </Badge>
                    {mod.packName && (
                      <Badge variant="outline" className="px-1.5 py-0 font-normal">
                        {mod.packName}
                      </Badge>
                    )}
                  </div>
                  {mod.description && (
                    <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                      {mod.description}
                    </p>
                  )}
                  {!hideMatches && (
                    <div className="font-mono text-[11.5px] text-muted-foreground truncate">
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

              <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap text-xs text-muted-foreground">
                {mod.engine === 'js' && (
                  <button
                    type="button"
                    onClick={() => onRun(mod)}
                    className="pc-btn inline-flex items-center gap-1 py-0.5 hover:text-foreground cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    <span>{t('runNow')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(mod)}
                  className="pc-btn inline-flex items-center gap-1 py-0.5 hover:text-foreground cursor-pointer"
                >
                  <Pencil className="h-3 w-3" />
                  <span>{t('editMod')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShare(mod)}
                  title={t('shareRecipe')}
                  className="pc-btn inline-flex items-center gap-1 py-0.5 hover:text-foreground cursor-pointer"
                >
                  <Share2 className="h-3 w-3" />
                  <span>{t('shareRecipe')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(mod)}
                  title={t('exportUserscript')}
                  className="pc-btn inline-flex items-center gap-1 py-0.5 font-mono hover:text-foreground cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  <span>.user.js</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(mod)}
                  title={t('downloadUserscript')}
                  aria-label={`${t('downloadUserscript')}: ${mod.name}`}
                  className="pc-btn inline-flex items-center p-1 rounded-[4px] hover:text-foreground hover:bg-secondary cursor-pointer"
                >
                  <Download className="h-3 w-3" />
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(mod)}
                  className={cn(
                    'pc-btn ml-auto inline-flex items-center gap-1 cursor-pointer',
                    confirmingDelete
                      ? 'px-2 py-0.5 rounded-[5px] bg-destructive text-[#FAF8F5] font-medium'
                      : 'py-0.5 hover:text-destructive',
                  )}
                >
                  <Trash2 className="h-3 w-3" />
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
