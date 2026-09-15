import { create } from 'zustand';
import type { KeyboardLog, FilterState, UIState, ViewMode, TagDef, TagChange } from '@/types';
import { sampleData } from '@/data/sampleData';
import type { ImportApplyResult, ValidatedLog } from '@/utils/importExport';
import { applyImport, genNewId } from '@/utils/importExport';
import {
  countReferences,
  mergeTagDefs,
  normalizeTags,
  removeTagDef,
  validateTagSystem,
  type TagActionResult,
} from '@/utils/tagSystem';

const STORAGE_KEY = 'keyfeeling-logs-v1';
const TAGS_STORAGE_KEY = 'keyfeeling-tags-v1';
const MAX_TAG_CHANGES = 100;

function loadFromStorage(): KeyboardLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleData));
      return sampleData;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return sampleData;
  } catch {
    return sampleData;
  }
}

function saveToStorage(logs: KeyboardLog[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

function loadTagsFromStorage(): { defs: TagDef[]; changes: TagChange[] } {
  try {
    const raw = localStorage.getItem(TAGS_STORAGE_KEY);
    if (!raw) return { defs: [], changes: [] };
    const parsed = JSON.parse(raw);
    const defs: TagDef[] = Array.isArray(parsed?.defs) ? parsed.defs : [];
    const changes: TagChange[] = Array.isArray(parsed?.changes) ? parsed.changes : [];
    // 防御：本地体系损坏时丢弃，避免非法体系进入运行时
    if (validateTagSystem(defs).length > 0) return { defs: [], changes: [] };
    return { defs, changes };
  } catch {
    return { defs: [], changes: [] };
  }
}

function saveTagsToStorage(defs: TagDef[], changes: TagChange[]) {
  try {
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify({ defs, changes }));
  } catch {
    // ignore
  }
}

function genId() {
  return genNewId();
}

function makeChange(type: TagChange['type'], summary: string, affectedRecords: number): TagChange {
  return { id: genId(), at: new Date().toISOString(), type, summary, affectedRecords };
}

interface AppState {
  logs: KeyboardLog[];
  filter: FilterState;
  ui: UIState;
  tagDefs: TagDef[];
  tagChanges: TagChange[];
  setFilter: (patch: Partial<FilterState>) => void;
  resetFilter: () => void;
  createLog: (data: Omit<KeyboardLog, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateLog: (id: string, data: Partial<KeyboardLog>) => void;
  deleteLog: (id: string) => void;
  importLogs: (
    selectedForImport: string[],
    fileValidLogs: KeyboardLog[],
    duplicateWithExisting: ValidatedLog[],
    strategy: 'skip' | 'overwrite' | 'regenerate',
    tagPayload?: { defs: TagDef[]; changes: TagChange[] } | null,
  ) => ImportApplyResult;
  addTagDef: (input: { name: string; aliases: string[]; parent: string | null }) => TagActionResult;
  updateTagDef: (
    name: string,
    patch: { aliases: string[]; parent: string | null },
  ) => TagActionResult;
  mergeTags: (source: string, target: string) => TagActionResult;
  removeTag: (name: string) => TagActionResult;
  toggleTagLock: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleCompareSelect: (id: string) => void;
  clearCompareSelect: () => void;
  openFormModal: (log?: KeyboardLog | null) => void;
  closeFormModal: () => void;
  openDetail: (log: KeyboardLog) => void;
  closeDetail: () => void;
  openImportExport: () => void;
  closeImportExport: () => void;
  openTagManager: () => void;
  closeTagManager: () => void;
}

const defaultFilter: FilterState = {
  switchType: 'all',
  soundCharacter: 'all',
  minRating: 0,
  searchKeyword: '',
};

const defaultUI: UIState = {
  viewMode: 'list',
  selectedForCompare: [],
  formModalOpen: false,
  editingLog: null,
  detailLog: null,
  importExportModalOpen: false,
  tagManagerOpen: false,
};

export const useAppStore = create<AppState>((set, get) => {
  /** 提交体系变更：写状态、记变更明细、持久化 */
  const commitTagSystem = (defs: TagDef[], change: TagChange | null) => {
    const changes = change
      ? [change, ...get().tagChanges].slice(0, MAX_TAG_CHANGES)
      : get().tagChanges;
    set({ tagDefs: defs, tagChanges: changes });
    saveTagsToStorage(defs, changes);
  };

  /** 对未锁定记录按当前体系归一，返回新数组与受影响条数 */
  const normalizeUnlockedLogs = (logs: KeyboardLog[], defs: TagDef[]) => {
    let affected = 0;
    const next = logs.map((l) => {
      if (l.tagsLocked) return l;
      const normalized = normalizeTags(l.soundTags, defs);
      if (normalized.join('') !== l.soundTags.join('')) {
        affected++;
        return { ...l, soundTags: normalized };
      }
      return l;
    });
    return { next, affected };
  };

  const persistedTags = loadTagsFromStorage();

  return {
    logs: loadFromStorage(),
    filter: defaultFilter,
    ui: defaultUI,
    tagDefs: persistedTags.defs,
    tagChanges: persistedTags.changes,

    setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
    resetFilter: () => set({ filter: defaultFilter }),

    createLog: (data) => {
      const now = new Date().toISOString();
      const newLog: KeyboardLog = {
        ...data,
        soundTags: normalizeTags(data.soundTags, get().tagDefs),
        id: genId(),
        createdAt: now,
        updatedAt: now,
      };
      const next = [newLog, ...get().logs];
      set({ logs: next, ui: { ...get().ui, formModalOpen: false, editingLog: null } });
      saveToStorage(next);
    },

    updateLog: (id, data) => {
      const defs = get().tagDefs;
      const next = get().logs.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...data, updatedAt: new Date().toISOString() };
        // 锁定记录跳过归一，保留原始标签
        if (!merged.tagsLocked && data.soundTags) {
          merged.soundTags = normalizeTags(data.soundTags, defs);
        }
        return merged;
      });
      set({ logs: next, ui: { ...get().ui, formModalOpen: false, editingLog: null } });
      saveToStorage(next);
    },

    deleteLog: (id) => {
      const next = get().logs.filter((l) => l.id !== id);
      const selected = get().ui.selectedForCompare.filter((sid) => sid !== id);
      set({ logs: next, ui: { ...get().ui, selectedForCompare: selected, detailLog: null } });
      saveToStorage(next);
    },

    importLogs: (selectedForImport, fileValidLogs, duplicateWithExisting, strategy, tagPayload) => {
      const result = applyImport(
        get().logs,
        selectedForImport,
        fileValidLogs,
        duplicateWithExisting,
        strategy,
      );

      let defs = get().tagDefs;
      let changes = get().tagChanges;

      // 备份带体系：导入即恢复体系与历史变更明细
      if (tagPayload?.defs) {
        defs = tagPayload.defs;
        changes = [...tagPayload.changes, ...changes].slice(0, MAX_TAG_CHANGES);
      }

      // 归一所有未锁定记录（导入的记录与既有记录一视同仁）
      const { next: finalLogs, affected } = normalizeUnlockedLogs(result.finalLogs, defs);

      if (tagPayload?.defs) {
        changes = [
          makeChange(
            'import',
            `导入标签体系（${tagPayload.defs.length} 个标签），归一影响 ${affected} 条记录`,
            affected,
          ),
          ...changes,
        ].slice(0, MAX_TAG_CHANGES);
      }

      set({ logs: finalLogs, tagDefs: defs, tagChanges: changes });
      saveToStorage(finalLogs);
      saveTagsToStorage(defs, changes);
      return { ...result, finalLogs };
    },

    addTagDef: (input) => {
      const name = input.name.trim().replace(/^#+/, '').trim();
      if (!name) return { ok: false, error: '主名不能为空', affectedRecords: 0 };
      const aliases = [
        ...new Set(
          input.aliases.map((a) => a.trim().replace(/^#+/, '').trim()).filter(Boolean),
        ),
      ].filter((a) => a !== name);
      const parent = input.parent?.trim() || null;
      const next = [...get().tagDefs, { name, aliases, parent }];
      const errors = validateTagSystem(next);
      if (errors.length) {
        return { ok: false, error: errors.join('；'), affectedRecords: 0 };
      }
      commitTagSystem(next, makeChange('create', `新增标签「${name}」`, 0));
      return { ok: true, affectedRecords: 0 };
    },

    updateTagDef: (name, patch) => {
      const defs = get().tagDefs;
      if (!defs.some((d) => d.name === name)) {
        return { ok: false, error: `标签「${name}」不存在`, affectedRecords: 0 };
      }
      const aliases = [
        ...new Set(
          patch.aliases.map((a) => a.trim().replace(/^#+/, '').trim()).filter(Boolean),
        ),
      ].filter((a) => a !== name);
      const parent = patch.parent?.trim() || null;
      const next = defs.map((d) => (d.name === name ? { ...d, aliases, parent } : d));
      const errors = validateTagSystem(next);
      if (errors.length) {
        return { ok: false, error: errors.join('；'), affectedRecords: 0 };
      }
      commitTagSystem(next, makeChange('update', `编辑标签「${name}」`, 0));
      return { ok: true, affectedRecords: 0 };
    },

    mergeTags: (source, target) => {
      const res = mergeTagDefs(get().tagDefs, source, target);
      if (!res.ok) {
        return { ok: false, error: res.error, affectedRecords: 0 };
      }
      if (!res.changed) {
        // 幂等：源标签不存在（已合并过），重跑不变
        return { ok: true, affectedRecords: 0 };
      }
      // 引用迁移：未锁定记录按新体系归一（源主名/别名 → 保留项）
      const { next: nextLogs, affected } = normalizeUnlockedLogs(get().logs, res.defs);
      set({ logs: nextLogs });
      saveToStorage(nextLogs);
      commitTagSystem(
        res.defs,
        makeChange('merge', `合并「${source}」→「${target}」`, affected),
      );
      return { ok: true, affectedRecords: affected };
    },

    removeTag: (name) => {
      const defs = get().tagDefs;
      if (!defs.some((d) => d.name === name)) {
        return { ok: true, affectedRecords: 0 };
      }
      // 有引用的标签必须先合并再移除，并告知受影响记录数
      const refs = countReferences(defs, name, get().logs);
      if (refs > 0) {
        return {
          ok: false,
          error: `「${name}」仍被 ${refs} 条记录引用，请先合并到其他标签`,
          affectedRecords: refs,
        };
      }
      const res = removeTagDef(defs, name);
      if (!res.ok) {
        return { ok: false, error: res.error, affectedRecords: 0 };
      }
      if (res.changed) {
        commitTagSystem(res.defs, makeChange('remove', `移除空标签「${name}」`, 0));
      }
      return { ok: true, affectedRecords: 0 };
    },

    toggleTagLock: (id) => {
      const next = get().logs.map((l) =>
        l.id === id ? { ...l, tagsLocked: !l.tagsLocked } : l,
      );
      const detailLog = get().ui.detailLog;
      set({
        logs: next,
        ui: {
          ...get().ui,
          detailLog:
            detailLog && detailLog.id === id
              ? { ...detailLog, tagsLocked: !detailLog.tagsLocked }
              : detailLog,
        },
      });
      saveToStorage(next);
    },

    setViewMode: (mode) => set({ ui: { ...get().ui, viewMode: mode } }),

    toggleCompareSelect: (id) => {
      const cur = get().ui.selectedForCompare;
      let next: string[];
      if (cur.includes(id)) {
        next = cur.filter((x) => x !== id);
      } else if (cur.length >= 2) {
        next = [cur[1], id];
      } else {
        next = [...cur, id];
      }
      set({ ui: { ...get().ui, selectedForCompare: next } });
    },

    clearCompareSelect: () =>
      set({ ui: { ...get().ui, selectedForCompare: [], viewMode: 'list' } }),

    openFormModal: (log) =>
      set({ ui: { ...get().ui, formModalOpen: true, editingLog: log ?? null } }),
    closeFormModal: () => set({ ui: { ...get().ui, formModalOpen: false, editingLog: null } }),

    openDetail: (log) => set({ ui: { ...get().ui, detailLog: log } }),
    closeDetail: () => set({ ui: { ...get().ui, detailLog: null } }),

    openImportExport: () => set({ ui: { ...get().ui, importExportModalOpen: true } }),
    closeImportExport: () => set({ ui: { ...get().ui, importExportModalOpen: false } }),

    openTagManager: () => set({ ui: { ...get().ui, tagManagerOpen: true } }),
    closeTagManager: () => set({ ui: { ...get().ui, tagManagerOpen: false } }),
  };
});

export function useFilteredLogs(): KeyboardLog[] {
  const { logs, filter } = useAppStore();
  const { switchType, soundCharacter, minRating, searchKeyword } = filter;
  const kw = searchKeyword.trim().toLowerCase();
  return logs.filter((log) => {
    if (switchType !== 'all' && log.switchType !== switchType) return false;
    if (soundCharacter !== 'all' && log.soundCharacter !== soundCharacter) return false;
    if (log.overallRating < minRating) return false;
    if (kw) {
      const haystack = [
        log.name,
        log.brand,
        log.model,
        log.switchName,
        log.notes,
        log.keycapProcess,
        ...log.soundTags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}
