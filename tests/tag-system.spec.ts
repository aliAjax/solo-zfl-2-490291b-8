import { test, expect } from '@playwright/test';
import { makeLog, seed, snapshot, logTags } from './helpers';

/** 通过表单新建一条记录，tagInputs 为依次输入的原始标签 */
async function createLogViaForm(
  page: import('@playwright/test').Page,
  name: string,
  tagInputs: string[],
) {
  await page.getByRole('button', { name: '新建记录' }).click();
  await page.getByPlaceholder('比如：日·夜 · 静、快乐轴机').fill(name);
  await page.getByPlaceholder('Matrix / Keychron / 自制...').fill('TestBrand');
  await page.getByPlaceholder('Hyperglide MX Black / Gateron Baby Raccoon V2...').fill('Test Switch');
  const tagInput = page.locator('.modal-surface input.bg-transparent');
  for (const t of tagInputs) {
    await tagInput.fill(t);
    await tagInput.press('Enter');
  }
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.modal-surface')).toHaveCount(0);
}

test.describe('标签体系', () => {
  test('归一：编辑记录时别名归主名、下级归上级、去重且与顺序无关', async ({ page }) => {
    await seed(page, {
      logs: [makeLog({ id: 'base', name: '基准键盘' })],
      tags: {
        defs: [
          { name: '麻将音', aliases: ['mj'], parent: null },
          { name: '柔和', aliases: [], parent: null },
          { name: '软弹', aliases: ['软'], parent: '柔和' },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    // 两条记录用不同顺序输入同一组标签
    await createLogViaForm(page, '归一键盘A', ['mj', '软', '麻将音']);
    await createLogViaForm(page, '归一键盘B', ['麻将音', 'mj', '软']);

    const snap = await snapshot(page);
    const tagsA = snap.logs.find((l) => l.name === '归一键盘A')!.soundTags;
    const tagsB = snap.logs.find((l) => l.name === '归一键盘B')!.soundTags;

    // 别名 mj → 麻将音；软 → 软弹 → 上级柔和；麻将音 去重 → 恰好 2 个标签
    expect(tagsA).toHaveLength(2);
    expect([...tagsA].sort()).toEqual(['柔和', '麻将音'].sort());
    // 结果与输入顺序无关：两条记录归一结果完全一致
    expect(tagsB).toEqual(tagsA);

    // 界面上也只展示归一后的主名
    await page.locator('article', { hasText: '归一键盘A' }).first().click();
    const modal = page.locator('.modal-surface');
    await expect(modal.getByText('#麻将音')).toBeVisible();
    await expect(modal.getByText('#柔和')).toBeVisible();
    await expect(modal.getByText('#mj', { exact: true })).toHaveCount(0);
    await expect(modal.getByText('#软弹', { exact: true })).toHaveCount(0);
  });

  test('合并：引用/别名/下级迁到保留项，不留空标签，重跑不变', async ({ page }) => {
    await seed(page, {
      logs: [
        makeLog({ id: 'l1', name: '键盘一', soundTags: ['清脆'] }),
        makeLog({ id: 'l2', name: '键盘二', soundTags: ['亮', '明亮'] }),
        makeLog({ id: 'l3', name: '键盘三', soundTags: ['清脆'], tagsLocked: true }),
      ],
      tags: {
        defs: [
          { name: '清脆', aliases: ['亮'], parent: null },
          { name: '明亮', aliases: [], parent: null },
          { name: '高频', aliases: [], parent: '清脆' },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();
    await page.getByTestId('tag-merge-source').selectOption('清脆');
    await page.getByTestId('tag-merge-target').selectOption('明亮');
    await page.getByTestId('tag-merge-submit').click();

    // 写明受影响记录数：l1、l2 两条未锁定记录被改写，l3 锁定跳过
    await expect(page.getByTestId('tag-message')).toContainText('影响 2 条记录');

    const snap = await snapshot(page);
    // 源标签移除，不留空标签；下级「高频」迁到保留项
    expect(snap.tagDefs.map((d) => d.name).sort()).toEqual(['明亮', '高频'].sort());
    const kept = snap.tagDefs.find((d) => d.name === '明亮')!;
    // 别名与源主名都迁为保留项别名
    expect(kept.aliases).toContain('亮');
    expect(kept.aliases).toContain('清脆');
    expect(snap.tagDefs.find((d) => d.name === '高频')!.parent).toBe('明亮');
    // 引用迁移
    expect(await logTags(page, 'l1')).toEqual(['明亮']);
    expect(await logTags(page, 'l2')).toEqual(['明亮']);
    expect(await logTags(page, 'l3')).toEqual(['清脆']); // 锁定记录不动

    // 变更明细可查证
    await page.getByTestId('tag-changes-toggle').click();
    await expect(page.getByTestId('tag-changes')).toContainText('合并「清脆」→「明亮」');
    await expect(page.getByTestId('tag-changes')).toContainText('影响 2 条');

    // 幂等：重跑合并，状态完全不变
    const before = JSON.stringify(await snapshot(page));
    const rerun = await page.evaluate(() =>
      window.__appStore.getState().mergeTags('清脆', '明亮'),
    );
    expect(rerun.ok).toBe(true);
    expect(rerun.affectedRecords).toBe(0);
    const after = JSON.stringify(await snapshot(page));
    expect(after).toBe(before);
  });

  test('成环：上级编辑形成循环时被拦截并说明原因', async ({ page }) => {
    await seed(page, {
      logs: [makeLog({ id: 'base' })],
      tags: {
        defs: [
          { name: '甲', aliases: [], parent: null },
          { name: '乙', aliases: [], parent: '甲' },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();
    await page.getByTestId('tag-edit-甲').click();
    // 让 甲 的上级 = 乙，而 乙 的上级已是 甲 → 成环
    await page.getByTestId('tag-edit-parent').selectOption('乙');
    await page.getByTestId('tag-edit-save').click();

    await expect(page.getByTestId('tag-edit-error')).toContainText('成环');

    // 体系保持不变
    const snap = await snapshot(page);
    expect(snap.tagDefs.find((d) => d.name === '甲')!.parent).toBeNull();
    expect(snap.tagDefs.find((d) => d.name === '乙')!.parent).toBe('甲');

    // 直接调用也被拒绝并给出原因
    const res = await page.evaluate(() =>
      window.__appStore.getState().updateTagDef('甲', { aliases: [], parent: '乙' }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('成环');
  });

  test('有引用移除：先拦截提示引用数，合并后才能移除，空标签可直接移除', async ({ page }) => {
    await seed(page, {
      logs: [makeLog({ id: 'l1', name: '引用键盘', soundTags: ['金属感'] })],
      tags: {
        defs: [
          { name: '金属感', aliases: [], parent: null },
          { name: '冷艳', aliases: [], parent: null },
          { name: '空洞', aliases: [], parent: null },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();
    await expect(page.getByTestId('tag-refs-金属感')).toContainText('引用 1 条');

    // 有引用的标签不能直接移除，提示受影响记录数
    await page.getByTestId('tag-remove-金属感').click();
    await expect(page.getByTestId('tag-message')).toContainText('仍被 1 条记录引用');
    await expect(page.getByTestId('tag-row-金属感')).toBeVisible();

    // 先合并：引用迁到保留项，源标签随之移除
    await page.getByTestId('tag-merge-source').selectOption('金属感');
    await page.getByTestId('tag-merge-target').selectOption('冷艳');
    await page.getByTestId('tag-merge-submit').click();
    await expect(page.getByTestId('tag-message')).toContainText('影响 1 条记录');
    await expect(page.getByTestId('tag-row-金属感')).toHaveCount(0);
    expect(await logTags(page, 'l1')).toEqual(['冷艳']);

    // 无引用的空标签可直接移除
    await page.getByTestId('tag-remove-空洞').click();
    await expect(page.getByTestId('tag-message')).toContainText('影响 0 条记录');
    await expect(page.getByTestId('tag-row-空洞')).toHaveCount(0);

    // 变更明细完整记录
    await page.getByTestId('tag-changes-toggle').click();
    const changes = page.getByTestId('tag-changes');
    await expect(changes).toContainText('合并「金属感」→「冷艳」');
    await expect(changes).toContainText('移除空标签「空洞」');
  });

  test('锁定：锁定记录跳过归一，解锁后恢复', async ({ page }) => {
    await seed(page, {
      logs: [
        makeLog({ id: 'l1', name: '未锁键盘', soundTags: ['沉'] }),
        makeLog({ id: 'l2', name: '锁定键盘', soundTags: ['沉'], tagsLocked: true }),
        makeLog({ id: 'l3', name: '普通键盘', soundTags: ['厚重'] }),
      ],
      tags: {
        defs: [
          { name: '厚重', aliases: ['沉'], parent: null },
          { name: '沉稳', aliases: [], parent: null },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    // 未锁定记录：编辑保存即归一（沉 → 厚重）
    await page.locator('article', { hasText: '未锁键盘' }).getByTitle('编辑').click();
    await page.getByRole('button', { name: '保存修改' }).click();
    expect(await logTags(page, 'l1')).toEqual(['厚重']);

    // 锁定记录：表单提示已锁定，保存后原标签不动
    await page.locator('article', { hasText: '锁定键盘' }).getByTitle('编辑').click();
    await expect(page.getByTestId('form-lock-hint')).toBeVisible();
    await page.getByRole('button', { name: '保存修改' }).click();
    expect(await logTags(page, 'l2')).toEqual(['沉']);

    // 通过详情弹窗锁定 l1
    await page.locator('article', { hasText: '未锁键盘' }).first().click();
    await page.getByTestId('toggle-tag-lock').click();
    await expect(page.getByTestId('tag-lock-badge')).toBeVisible();
    await page.keyboard.press('Escape');

    // 合并 厚重 → 沉稳：只有未锁定的 l3 被迁移
    await page.getByTestId('open-tag-manager').click();
    await page.getByTestId('tag-merge-source').selectOption('厚重');
    await page.getByTestId('tag-merge-target').selectOption('沉稳');
    await page.getByTestId('tag-merge-submit').click();
    await expect(page.getByTestId('tag-message')).toContainText('影响 1 条记录');
    await page.keyboard.press('Escape');

    expect(await logTags(page, 'l1')).toEqual(['厚重']); // 锁定，跳过归一
    expect(await logTags(page, 'l2')).toEqual(['沉']); // 锁定，跳过归一
    expect(await logTags(page, 'l3')).toEqual(['沉稳']); // 未锁定，被迁移

    // 解锁后恢复归一：l2 编辑保存 → 沉（已迁为沉稳的别名）→ 沉稳
    await page.locator('article', { hasText: '锁定键盘' }).first().click();
    await page.getByTestId('toggle-tag-lock').click();
    await page.keyboard.press('Escape');
    await page.locator('article', { hasText: '锁定键盘' }).getByTitle('编辑').click();
    await page.getByRole('button', { name: '保存修改' }).click();
    expect(await logTags(page, 'l2')).toEqual(['沉稳']);
  });

  test('非法导入：非法体系被拦截并说明原因，旧版备份仍可读', async ({ page }) => {
    await seed(page, { logs: [makeLog({ id: 'base', name: '存量键盘' })] });
    await page.goto('/');

    const openImport = async () => {
      await page.getByTitle('数据导入导出').click();
      await page.getByRole('button', { name: '导入数据' }).click();
    };
    const upload = async (payload: unknown, filename: string) => {
      await page.locator('#import-file-input').setInputFiles({
        name: filename,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(payload)),
      });
    };
    const envelope = (data: unknown[], extra: Record<string, unknown> = {}) => ({
      format: 'keyfeeling-export',
      version: 2,
      exportedAt: new Date().toISOString(),
      recordCount: data.length,
      data,
      ...extra,
    });

    // 1) 别名重复 → 拦截并说明原因
    await openImport();
    await upload(
      envelope([makeLog({ id: 'imp-bad-1', name: '不应导入' })], {
        tagSystem: [
          { name: '甲', aliases: ['重复名'], parent: null },
          { name: '乙', aliases: ['重复名'], parent: null },
        ],
      }),
      'dup-alias.json',
    );
    await expect(page.getByTestId('import-error')).toContainText('标签体系不合法');
    await expect(page.getByTestId('import-error')).toContainText('重复名');
    expect((await snapshot(page)).logs).toHaveLength(1);
    expect((await snapshot(page)).tagDefs).toHaveLength(0);

    // 2) 层级成环 → 拦截并说明原因
    await upload(
      envelope([makeLog({ id: 'imp-bad-2', name: '不应导入2' })], {
        tagSystem: [
          { name: '甲', aliases: [], parent: '乙' },
          { name: '乙', aliases: [], parent: '甲' },
        ],
      }),
      'cycle.json',
    );
    await expect(page.getByTestId('import-error')).toContainText('成环');
    expect((await snapshot(page)).logs).toHaveLength(1);

    // 3) v1 旧备份（无标签体系）→ 正常导入
    await upload(
      {
        format: 'keyfeeling-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        recordCount: 1,
        data: [makeLog({ id: 'imp-old', name: '旧备份键盘' })],
      },
      'v1-backup.json',
    );
    await page.getByRole('button', { name: /确认导入/ }).click();
    await expect(page.getByText('导入完成')).toBeVisible();
    expect((await snapshot(page)).logs).toHaveLength(2);

    // 4) 合法 v2 备份 → 体系随备份恢复，导入记录同步归一
    await page.getByRole('button', { name: '继续导入' }).click();
    await upload(
      envelope([makeLog({ id: 'imp-v2', name: '体系键盘', soundTags: ['tx'] })], {
        tagSystem: [{ name: '导入体系', aliases: ['tx'], parent: null }],
        tagChanges: [
          {
            id: 'chg-1',
            at: new Date().toISOString(),
            type: 'create',
            summary: '新增标签「导入体系」',
            affectedRecords: 0,
          },
        ],
      }),
      'v2-backup.json',
    );
    await expect(page.getByTestId('import-tag-system-badge')).toContainText('1 个标签');
    await page.getByRole('button', { name: /确认导入/ }).click();
    await expect(page.getByText('导入完成')).toBeVisible();

    const snap = await snapshot(page);
    expect(snap.tagDefs.map((d) => d.name)).toEqual(['导入体系']);
    expect(await logTags(page, 'imp-v2')).toEqual(['导入体系']); // 别名 tx 归一到主名
    expect(snap.tagChanges.some((c) => c.type === 'import')).toBe(true);
  });
});
