import type { Page } from '@playwright/test';

export interface SeedTagDef {
  name: string;
  aliases: string[];
  parent: string | null;
}

interface TagActionResult {
  ok: boolean;
  error?: string;
  affectedRecords: number;
}

declare global {
  interface Window {
    __appStore: {
      getState: () => {
        logs: Array<{ id: string; name: string; soundTags: string[]; tagsLocked?: boolean }>;
        tagDefs: SeedTagDef[];
        tagChanges: Array<{ type: string; summary: string; affectedRecords: number }>;
        mergeTags: (source: string, target: string) => TagActionResult;
        removeTag: (name: string) => TagActionResult;
        updateTagDef: (
          name: string,
          patch: { aliases: string[]; parent: string | null },
        ) => TagActionResult;
      };
    };
  }
}

let seq = 0;

/** 构造一条能通过导入校验的完整记录 */
export function makeLog(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  seq += 1;
  return {
    id: `log-${seq}`,
    name: `测试键盘${seq}`,
    brand: 'TestBrand',
    model: 'T1',
    purchaseDate: '2025-01-01',
    overallRating: 7,
    switchName: 'Test Switch',
    switchType: 'linear',
    switchLubed: '',
    keycapMaterial: 'PBT',
    keycapProfile: 'Cherry',
    keycapProcess: '',
    plateMaterial: '铝',
    plateThickness: '1.5mm',
    fillMaterial: '',
    caseMaterial: '铝合金',
    soundCharacter: 'neutral',
    soundTags: [] as string[],
    reboundRating: 5,
    tactilityRating: 5,
    fatigueRating: 5,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 在应用加载前向 localStorage 播种记录与标签体系 */
export async function seed(
  page: Page,
  data: { logs: unknown[]; tags?: { defs: SeedTagDef[]; changes?: unknown[] } },
) {
  await page.addInitScript((payload) => {
    localStorage.setItem('keyfeeling-logs-v1', JSON.stringify(payload.logs));
    localStorage.setItem(
      'keyfeeling-tags-v1',
      JSON.stringify(payload.tags ?? { defs: [], changes: [] }),
    );
  }, data);
}

export interface StoreSnapshot {
  logs: Array<{ id: string; name: string; soundTags: string[]; tagsLocked?: boolean }>;
  tagDefs: SeedTagDef[];
  tagChanges: Array<{ type: string; summary: string; affectedRecords: number }>;
}

export async function snapshot(page: Page): Promise<StoreSnapshot> {
  return page.evaluate(() => {
    const s = window.__appStore.getState();
    return {
      logs: s.logs.map((l) => ({
        id: l.id,
        name: l.name,
        soundTags: l.soundTags,
        tagsLocked: l.tagsLocked,
      })),
      tagDefs: s.tagDefs,
      tagChanges: s.tagChanges,
    };
  });
}

export async function logTags(page: Page, id: string): Promise<string[]> {
  const snap = await snapshot(page);
  const log = snap.logs.find((l) => l.id === id);
  if (!log) throw new Error(`log ${id} not found`);
  return log.soundTags;
}
