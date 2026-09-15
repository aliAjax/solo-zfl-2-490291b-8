import type { KeyboardLog, TagDef } from '@/types';

/**
 * 标签体系纯逻辑：
 * - 体系校验（主名/别名全局唯一、上级必须存在、层级不成环）
 * - 记录标签归一（别名→主名、下级→上级、去重、结果与输入顺序无关）
 * - 合并（引用/别名/下级迁到保留项，源标签移除，重跑不变）
 * - 移除（仅允许无引用的空标签，下级重挂到其上级）
 */

export interface TagDefsResult {
  ok: boolean;
  defs: TagDef[];
  /** 本次操作是否真正改变了体系（幂等重跑时为 false） */
  changed: boolean;
  error?: string;
}

export interface TagActionResult {
  ok: boolean;
  error?: string;
  /** 受影响的记录数（合并 / 有引用移除拦截时给出） */
  affectedRecords: number;
}

function cleanToken(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^#+/, '').trim() : '';
}

/** 校验整个标签体系，返回中文原因列表；空数组表示合法 */
export function validateTagSystem(defs: TagDef[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>(); // token -> 来源描述

  for (const def of defs) {
    const name = cleanToken(def?.name);
    if (!name) {
      errors.push('存在主名为空的标签');
      continue;
    }
    if (seen.has(name)) {
      errors.push(`「${name}」重复：既是${seen.get(name)}，又被用作主名`);
    } else {
      seen.set(name, '主名');
    }
  }

  for (const def of defs) {
    const name = cleanToken(def?.name) || '(空主名)';
    const aliases = Array.isArray(def?.aliases) ? def.aliases : [];
    for (const rawAlias of aliases) {
      const alias = cleanToken(rawAlias);
      if (!alias) {
        errors.push(`标签「${name}」存在空别名`);
        continue;
      }
      if (seen.has(alias)) {
        errors.push(`别名「${alias}」与${seen.get(alias)}重复（在「${name}」上）`);
      } else {
        seen.set(alias, `「${name}」的别名`);
      }
    }
  }

  const names = new Set(defs.map((d) => cleanToken(d?.name)).filter(Boolean));
  for (const def of defs) {
    const name = cleanToken(def?.name);
    if (!name) continue;
    const parent = cleanToken(def?.parent);
    if (parent && !names.has(parent)) {
      errors.push(`标签「${name}」的上级「${parent}」不存在`);
    }
  }

  // 成环检测：沿 parent 链向上走，重访即环
  const parentOf = new Map<string, string | null>();
  for (const def of defs) {
    const name = cleanToken(def?.name);
    if (name) parentOf.set(name, cleanToken(def?.parent) || null);
  }
  const cycleReported = new Set<string>();
  for (const start of parentOf.keys()) {
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur: string | null = start;
    while (cur && parentOf.has(cur)) {
      if (visited.has(cur)) {
        const cycle = [...chain.slice(chain.indexOf(cur)), cur];
        const key = [...cycle].sort().join('→');
        if (!cycleReported.has(key)) {
          cycleReported.add(key);
          errors.push(`层级成环：${cycle.join(' → ')}`);
        }
        break;
      }
      visited.add(cur);
      chain.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  return errors;
}

/** 别名 → 主名 映射 */
export function buildAliasMap(defs: TagDef[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of defs) {
    const name = cleanToken(def.name);
    if (!name) continue;
    map.set(name, name);
    for (const rawAlias of def.aliases ?? []) {
      const alias = cleanToken(rawAlias);
      if (alias) map.set(alias, name);
    }
  }
  return map;
}

/**
 * 归一一组标签：
 * 1. 别名归到主名；2. 下级沿 parent 链归到最顶层上级；
 * 3. 同一记录去重；4. 输出排序固定，结果与输入顺序无关。
 * 不在体系中的标签原样保留。
 */
export function normalizeTags(tags: string[], defs: TagDef[]): string[] {
  const aliasMap = buildAliasMap(defs);
  const parentOf = new Map<string, string | null>();
  for (const def of defs) {
    const name = cleanToken(def.name);
    if (name) parentOf.set(name, cleanToken(def.parent) || null);
  }

  const out = new Set<string>();
  for (const raw of tags ?? []) {
    const token = cleanToken(raw);
    if (!token) continue;
    let cur = aliasMap.get(token) ?? token;
    const walked = new Set<string>([cur]);
    while (parentOf.has(cur)) {
      const parent = parentOf.get(cur);
      if (!parent || walked.has(parent)) break; // 防御：非法体系不死循环
      cur = parent;
      walked.add(cur);
    }
    out.add(cur);
  }

  return [...out].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/**
 * 统计引用了某标签的记录数。
 * 按归一后的有效归属判断：记录持有目标标签的主名、别名，
 * 或持有其下级标签（含下级的别名，归一会沿上级链经过目标），都视为引用。
 * 锁定记录持有的标签同样计入。
 */
export function countReferences(
  defs: TagDef[],
  name: string,
  logs: Pick<KeyboardLog, 'soundTags'>[],
): number {
  if (!defs.some((d) => d.name === name)) return 0;
  const aliasMap = buildAliasMap(defs);
  const parentOf = new Map<string, string | null>();
  for (const def of defs) {
    const n = cleanToken(def.name);
    if (n) parentOf.set(n, cleanToken(def.parent) || null);
  }
  let count = 0;
  for (const log of logs) {
    if (recordHoldsTag(log.soundTags ?? [], name, aliasMap, parentOf)) count++;
  }
  return count;
}

/** 记录是否有效持有目标标签：主名 / 别名 / 下级三条路径 */
function recordHoldsTag(
  tags: string[],
  target: string,
  aliasMap: Map<string, string>,
  parentOf: Map<string, string | null>,
): boolean {
  for (const raw of tags) {
    const token = cleanToken(raw);
    if (!token) continue;
    let cur = aliasMap.get(token) ?? token;
    // 路径一、二：主名或别名直接命中
    if (cur === target) return true;
    // 路径三：持有下级标签，沿上级链向上经过目标
    const walked = new Set<string>([cur]);
    while (parentOf.has(cur)) {
      const parent = parentOf.get(cur);
      if (!parent || walked.has(parent)) break; // 防御：非法体系不死循环
      if (parent === target) return true;
      cur = parent;
      walked.add(cur);
    }
  }
  return false;
}

/**
 * 合并标签：source 并入 target（保留项）。
 * 别名与源主名迁为 target 的别名，下级改挂 target，source 从体系中移除。
 * 源标签不存在时视为已合并，幂等返回成功且 changed=false。
 */
export function mergeTagDefs(defs: TagDef[], sourceName: string, targetName: string): TagDefsResult {
  const source = defs.find((d) => d.name === sourceName);
  const target = defs.find((d) => d.name === targetName);
  if (!target) {
    return { ok: false, defs, changed: false, error: `目标标签「${targetName}」不存在` };
  }
  if (!source) {
    return { ok: true, defs, changed: false };
  }
  if (sourceName === targetName) {
    return { ok: false, defs, changed: false, error: '不能把标签合并到它自己' };
  }

  const next: TagDef[] = defs
    .filter((d) => d.name !== sourceName)
    .map((d) => ({ ...d, aliases: [...d.aliases] }));

  const kept = next.find((d) => d.name === targetName)!;
  // 别名迁移：源别名 + 源主名 都归到保留项（保持全局唯一）
  const aliasSet = new Set([...kept.aliases, ...source.aliases.map(cleanToken), source.name]);
  aliasSet.delete('');
  aliasSet.delete(kept.name);
  kept.aliases = [...aliasSet];

  // 下级迁移：source 的下级改挂到保留项
  for (const d of next) {
    if (d.name !== kept.name && d.parent === sourceName) {
      d.parent = targetName;
    }
  }
  // 保留项自身若挂在 source 下，则继承 source 的上级
  if (kept.parent === sourceName) {
    kept.parent = source.parent ?? null;
  }

  const errors = validateTagSystem(next);
  if (errors.length) {
    return { ok: false, defs, changed: false, error: errors.join('；') };
  }
  return { ok: true, defs: next, changed: true };
}

/**
 * 移除空标签（无引用时调用）：下级重挂到被移除标签的上级。
 * 标签不存在时幂等返回成功且 changed=false。
 */
export function removeTagDef(defs: TagDef[], name: string): TagDefsResult {
  const target = defs.find((d) => d.name === name);
  if (!target) {
    return { ok: true, defs, changed: false };
  }
  const next: TagDef[] = defs
    .filter((d) => d.name !== name)
    .map((d) => ({
      ...d,
      aliases: [...d.aliases],
      parent: d.parent === name ? target.parent ?? null : d.parent,
    }));
  const errors = validateTagSystem(next);
  if (errors.length) {
    return { ok: false, defs, changed: false, error: errors.join('；') };
  }
  return { ok: true, defs: next, changed: true };
}

/** 解析并校验导入的体系数据；不合法时给出全部原因 */
export function parseTagDefs(raw: unknown): { defs: TagDef[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { defs: [], errors: ['tagSystem 必须是数组'] };
  }
  const defs: TagDef[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`标签 #${index} 不是有效对象`);
      return;
    }
    const obj = item as Record<string, unknown>;
    const name = cleanToken(obj.name);
    if (!name) {
      errors.push(`标签 #${index} 缺少主名`);
      return;
    }
    if (obj.aliases !== undefined && !Array.isArray(obj.aliases)) {
      errors.push(`标签「${name}」的 aliases 必须是数组`);
      return;
    }
    if (obj.parent !== undefined && obj.parent !== null && typeof obj.parent !== 'string') {
      errors.push(`标签「${name}」的 parent 必须是字符串或 null`);
      return;
    }
    const aliases = ((obj.aliases as unknown[]) ?? [])
      .map(cleanToken)
      .filter(Boolean);
    const parent = cleanToken(obj.parent) || null;
    defs.push({ name, aliases, parent });
  });
  if (errors.length === 0) {
    errors.push(...validateTagSystem(defs));
  }
  return { defs: errors.length ? [] : defs, errors };
}
