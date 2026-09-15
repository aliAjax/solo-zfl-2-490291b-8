import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Tags,
  Plus,
  Pencil,
  Trash2,
  GitMerge,
  Check,
  AlertTriangle,
  History,
  ChevronDown,
  ChevronRight,
  CornerUpRight,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { countReferences } from '@/utils/tagSystem';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export default function TagManagerModal() {
  const {
    ui,
    closeTagManager,
    tagDefs,
    tagChanges,
    logs,
    addTagDef,
    updateTagDef,
    mergeTags,
    removeTag,
  } = useAppStore();

  const isOpen = ui.tagManagerOpen;

  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [newParent, setNewParent] = useState('');
  const [addError, setAddError] = useState('');

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editAliases, setEditAliases] = useState('');
  const [editParent, setEditParent] = useState('');
  const [editError, setEditError] = useState('');

  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');

  const [message, setMessage] = useState<Message | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) closeTagManager();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeTagManager]);

  useEffect(() => {
    if (isOpen) {
      setNewName('');
      setNewAliases('');
      setNewParent('');
      setAddError('');
      setEditingName(null);
      setEditError('');
      setMergeSource('');
      setMergeTarget('');
      setMessage(null);
      setShowChanges(false);
    }
  }, [isOpen]);

  const refCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const def of tagDefs) {
      map.set(def.name, countReferences(tagDefs, def.name, logs));
    }
    return map;
  }, [tagDefs, logs]);

  if (!isOpen) return null;

  const splitAliases = (raw: string) =>
    raw
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleAdd = () => {
    setAddError('');
    setMessage(null);
    const res = addTagDef({
      name: newName,
      aliases: splitAliases(newAliases),
      parent: newParent || null,
    });
    if (!res.ok) {
      setAddError(res.error ?? '添加失败');
      return;
    }
    setMessage({ kind: 'success', text: `已新增标签「${newName.trim().replace(/^#+/, '')}」` });
    setNewName('');
    setNewAliases('');
    setNewParent('');
  };

  const startEdit = (name: string) => {
    const def = tagDefs.find((d) => d.name === name);
    if (!def) return;
    setEditingName(name);
    setEditAliases(def.aliases.join(', '));
    setEditParent(def.parent ?? '');
    setEditError('');
    setMessage(null);
  };

  const handleSaveEdit = () => {
    if (!editingName) return;
    const res = updateTagDef(editingName, {
      aliases: splitAliases(editAliases),
      parent: editParent || null,
    });
    if (!res.ok) {
      setEditError(res.error ?? '保存失败');
      return;
    }
    setMessage({ kind: 'success', text: `已更新标签「${editingName}」` });
    setEditingName(null);
    setEditError('');
  };

  const handleMerge = () => {
    setMessage(null);
    if (!mergeSource || !mergeTarget) return;
    const res = mergeTags(mergeSource, mergeTarget);
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error ?? '合并失败' });
      return;
    }
    setMessage({
      kind: 'success',
      text: `已合并「${mergeSource}」→「${mergeTarget}」，影响 ${res.affectedRecords} 条记录`,
    });
    setMergeSource('');
    setMergeTarget('');
  };

  const handleRemove = (name: string) => {
    setMessage(null);
    const res = removeTag(name);
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error ?? '移除失败' });
      return;
    }
    setMessage({ kind: 'success', text: `已移除空标签「${name}」，影响 0 条记录` });
  };

  const parentOptions = (exclude: string[]) =>
    tagDefs.filter((d) => !exclude.includes(d.name));

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && closeTagManager()}
    >
      <div className="modal-surface scrollbar-thin" data-testid="tag-manager">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-ink-700/60 bg-gradient-to-b from-ink-800/98 to-ink-800/90 backdrop-blur-sm">
          <div>
            <h2 className="font-mono text-lg font-bold text-gradient-brass flex items-center gap-2">
              <Tags className="h-4 w-4" />
              标签体系管理
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">
              别名归到主名 · 下级归到上级 · 锁定记录跳过归一
            </p>
          </div>
          <button
            onClick={closeTagManager}
            className="p-2 rounded-lg text-ink-500 hover:text-ink-200 hover:bg-ink-700/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {message && (
            <div
              data-testid="tag-message"
              className={`rounded-lg border p-3 text-xs flex items-start gap-2 animate-fadeIn ${
                message.kind === 'success'
                  ? 'bg-moss-500/10 border-moss-500/30 text-moss-300'
                  : 'bg-wine-500/10 border-wine-500/30 text-wine-300'
              }`}
            >
              {message.kind === 'success' ? (
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              )}
              <span className="whitespace-pre-wrap">{message.text}</span>
            </div>
          )}

          {/* 新增标签 */}
          <section className="rounded-xl bg-ink-900/60 border border-ink-700/60 p-4 space-y-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-brass-200 flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              新增标签
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-ink-500 mb-1">主名 *</label>
                <input
                  data-testid="tag-add-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="如：麻将音"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-ink-500 mb-1">
                  别名（逗号分隔）
                </label>
                <input
                  data-testid="tag-add-aliases"
                  type="text"
                  value={newAliases}
                  onChange={(e) => setNewAliases(e.target.value)}
                  placeholder="如：mj, 麻雀音"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-ink-500 mb-1">上级</label>
                <select
                  data-testid="tag-add-parent"
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                  className="input-field appearance-none cursor-pointer"
                >
                  <option value="">无上级</option>
                  {parentOptions([newName.trim()]).map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {addError && (
              <p data-testid="tag-add-error" className="text-[11px] text-wine-400 whitespace-pre-wrap">
                {addError}
              </p>
            )}
            <div className="flex justify-end">
              <button
                data-testid="tag-add-submit"
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="btn-primary !px-4 !py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-3.5 w-3.5" />
                添加标签
              </button>
            </div>
          </section>

          {/* 合并标签 */}
          <section className="rounded-xl bg-ink-900/60 border border-ink-700/60 p-4 space-y-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-brass-200 flex items-center gap-1.5">
              <GitMerge className="h-3.5 w-3.5" />
              合并标签
            </h3>
            <p className="text-[11px] text-ink-500 leading-relaxed">
              源标签的引用、别名、下级全部迁到保留项，源标签随后移除，不留空标签；重复合并不会产生变化。
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-mono text-ink-500 mb-1">源标签（被移除）</label>
                <select
                  data-testid="tag-merge-source"
                  value={mergeSource}
                  onChange={(e) => setMergeSource(e.target.value)}
                  className="input-field appearance-none cursor-pointer"
                >
                  <option value="">选择源标签</option>
                  {tagDefs.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                      {(refCounts.get(d.name) ?? 0) > 0 ? `（${refCounts.get(d.name)} 条引用）` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <CornerUpRight className="hidden sm:block h-4 w-4 text-ink-500 mb-3" />
              <div className="flex-1">
                <label className="block text-[11px] font-mono text-ink-500 mb-1">保留项</label>
                <select
                  data-testid="tag-merge-target"
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                  className="input-field appearance-none cursor-pointer"
                >
                  <option value="">选择保留标签</option>
                  {tagDefs
                    .filter((d) => d.name !== mergeSource)
                    .map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              <button
                data-testid="tag-merge-submit"
                onClick={handleMerge}
                disabled={!mergeSource || !mergeTarget || mergeSource === mergeTarget}
                className="btn-primary !px-4 !py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <GitMerge className="h-3.5 w-3.5" />
                合并
              </button>
            </div>
          </section>

          {/* 标签列表 */}
          <section className="space-y-2">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-brass-200">
              全部标签（{tagDefs.length}）
            </h3>
            {tagDefs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-6 text-center text-xs text-ink-500">
                还没有标签体系，先在上方新增一个标签吧
              </div>
            ) : (
              <div className="space-y-2">
                {tagDefs.map((def) => {
                  const refs = refCounts.get(def.name) ?? 0;
                  const editing = editingName === def.name;
                  return (
                    <div
                      key={def.name}
                      data-testid={`tag-row-${def.name}`}
                      className="rounded-lg border border-ink-700/60 bg-ink-900/40 overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <span className="font-mono text-sm text-brass-100">#{def.name}</span>
                        {def.aliases.map((a) => (
                          <span
                            key={a}
                            className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-ink-800 text-ink-400 border border-ink-700/70"
                          >
                            = {a}
                          </span>
                        ))}
                        <span className="text-[10px] font-mono text-ink-500">
                          上级: {def.parent ? `#${def.parent}` : '—'}
                        </span>
                        <span
                          className={`text-[10px] font-mono ${refs > 0 ? 'text-brass-200' : 'text-ink-600'}`}
                          data-testid={`tag-refs-${def.name}`}
                        >
                          引用 {refs} 条
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            data-testid={`tag-edit-${def.name}`}
                            onClick={() => (editing ? setEditingName(null) : startEdit(def.name))}
                            className="p-1.5 rounded-md text-ink-500 hover:text-moss-400 hover:bg-moss-500/10 transition-all"
                            title="编辑别名 / 上级"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            data-testid={`tag-remove-${def.name}`}
                            onClick={() => handleRemove(def.name)}
                            className="p-1.5 rounded-md text-ink-500 hover:text-wine-400 hover:bg-wine-500/10 transition-all"
                            title="移除（有引用时需先合并）"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {editing && (
                        <div className="border-t border-ink-700/50 p-3 space-y-3 bg-ink-950/30 animate-fadeIn">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-mono text-ink-500 mb-1">
                                别名（逗号分隔）
                              </label>
                              <input
                                data-testid="tag-edit-aliases"
                                type="text"
                                value={editAliases}
                                onChange={(e) => setEditAliases(e.target.value)}
                                className="input-field"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-mono text-ink-500 mb-1">
                                上级
                              </label>
                              <select
                                data-testid="tag-edit-parent"
                                value={editParent}
                                onChange={(e) => setEditParent(e.target.value)}
                                className="input-field appearance-none cursor-pointer"
                              >
                                <option value="">无上级</option>
                                {parentOptions([def.name]).map((d) => (
                                  <option key={d.name} value={d.name}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {editError && (
                            <p
                              data-testid="tag-edit-error"
                              className="text-[11px] text-wine-400 whitespace-pre-wrap"
                            >
                              {editError}
                            </p>
                          )}
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingName(null)}
                              className="btn-ghost !px-3 !py-1.5 text-xs"
                            >
                              取消
                            </button>
                            <button
                              data-testid="tag-edit-save"
                              onClick={handleSaveEdit}
                              className="btn-primary !px-3 !py-1.5 text-xs"
                            >
                              <Check className="h-3.5 w-3.5" />
                              保存
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 变更明细 */}
          <section>
            <button
              data-testid="tag-changes-toggle"
              onClick={() => setShowChanges((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-ink-400 hover:text-brass-200 transition-colors"
            >
              {showChanges ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <History className="h-3.5 w-3.5" />
              变更明细（{tagChanges.length}）
            </button>
            {showChanges && (
              <div
                data-testid="tag-changes"
                className="mt-2 rounded-lg bg-ink-900/60 border border-ink-700/60 max-h-48 overflow-y-auto scrollbar-thin animate-fadeIn"
              >
                {tagChanges.length === 0 ? (
                  <p className="p-4 text-center text-[11px] text-ink-600">暂无变更记录</p>
                ) : (
                  <ul className="divide-y divide-ink-700/40">
                    {tagChanges.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-3 px-3 py-2 text-[11px] font-mono"
                      >
                        <span className="text-ink-600 shrink-0">{formatTime(c.at)}</span>
                        <span className="text-ink-300 flex-1">{c.summary}</span>
                        <span
                          className={`shrink-0 ${c.affectedRecords > 0 ? 'text-brass-200' : 'text-ink-600'}`}
                        >
                          影响 {c.affectedRecords} 条
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
