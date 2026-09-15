import { test, expect } from '@playwright/test';
import { makeLog, seed, snapshot, logTags } from './helpers';

test.describe('标签移除的引用统计', () => {
  test('锁定记录持下级标签：按有效归属计入引用并拦截移除', async ({ page }) => {
    await seed(page, {
      logs: [
        // 锁定记录持有下级标签主名
        makeLog({ id: 'l1', name: '锁定键盘A', soundTags: ['枝'], tagsLocked: true }),
        // 锁定记录持有下级标签的别名
        makeLog({ id: 'l2', name: '锁定键盘B', soundTags: ['枝alias'], tagsLocked: true }),
      ],
      tags: {
        defs: [
          { name: '根', aliases: [], parent: null },
          { name: '枝', aliases: ['枝alias'], parent: '根' },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();

    // 「根」自身没有任何记录直接持有，但两条锁定记录经下级路径有效归属到它
    await expect(page.getByTestId('tag-refs-根')).toContainText('引用 2 条');

    await page.getByTestId('tag-remove-根').click();
    await expect(page.getByTestId('tag-message')).toContainText('仍被 2 条记录引用');

    // 体系与记录均未被动过
    const snap = await snapshot(page);
    expect(snap.tagDefs.map((d) => d.name).sort()).toEqual(['根', '枝'].sort());
    expect(await logTags(page, 'l1')).toEqual(['枝']);
    expect(await logTags(page, 'l2')).toEqual(['枝alias']);
  });

  test('未锁定记录持下级标签：拦截计数与合并变更明细一致', async ({ page }) => {
    await seed(page, {
      logs: [makeLog({ id: 'u1', name: '未锁键盘', soundTags: ['叶'] })],
      tags: {
        defs: [
          { name: '根', aliases: [], parent: null },
          { name: '叶', aliases: [], parent: '根' },
          { name: '新根', aliases: [], parent: null },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();

    // 记录只持有下级「叶」，归一沿上级链经过「根」→ 算 1 条引用
    await expect(page.getByTestId('tag-refs-根')).toContainText('引用 1 条');
    await page.getByTestId('tag-remove-根').click();
    await expect(page.getByTestId('tag-message')).toContainText('仍被 1 条记录引用');
    await expect(page.getByTestId('tag-row-根')).toBeVisible();

    // 先合并再移除：合并的受影响记录数与拦截说明一致（都是 1 条）
    await page.getByTestId('tag-merge-source').selectOption('根');
    await page.getByTestId('tag-merge-target').selectOption('新根');
    await page.getByTestId('tag-merge-submit').click();
    await expect(page.getByTestId('tag-message')).toContainText('影响 1 条记录');

    // 下级「叶」迁到新根下，记录归一到新根
    const snap = await snapshot(page);
    expect(snap.tagDefs.find((d) => d.name === '叶')!.parent).toBe('新根');
    expect(await logTags(page, 'u1')).toEqual(['新根']);

    // 变更明细与拦截说明的数字一致
    await page.getByTestId('tag-changes-toggle').click();
    const changes = page.getByTestId('tag-changes');
    await expect(changes).toContainText('合并「根」→「新根」');
    await expect(changes).toContainText('影响 1 条');
  });

  test('无引用移除：照常完成，下级按原规则重挂到上级', async ({ page }) => {
    await seed(page, {
      logs: [makeLog({ id: 'x1', name: '无关键盘', soundTags: ['无关'] })],
      tags: {
        defs: [
          { name: '顶', aliases: [], parent: null },
          { name: '中', aliases: [], parent: '顶' },
          { name: '底', aliases: [], parent: '中' },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();
    await expect(page.getByTestId('tag-refs-中')).toContainText('引用 0 条');

    await page.getByTestId('tag-remove-中').click();
    await expect(page.getByTestId('tag-message')).toContainText('影响 0 条记录');
    await expect(page.getByTestId('tag-row-中')).toHaveCount(0);

    // 下级「底」重挂到被移除标签的上级「顶」
    const snap = await snapshot(page);
    expect(snap.tagDefs.map((d) => d.name).sort()).toEqual(['顶', '底'].sort());
    expect(snap.tagDefs.find((d) => d.name === '底')!.parent).toBe('顶');

    // 变更明细记录移除且影响 0 条
    await page.getByTestId('tag-changes-toggle').click();
    await expect(page.getByTestId('tag-changes')).toContainText('移除空标签「中」');
  });

  test('合并后移除：源标签已消失可幂等移除，保留项按迁移后引用拦截', async ({ page }) => {
    await seed(page, {
      logs: [makeLog({ id: 'v1', name: '迁移键盘', soundTags: ['旧a'] })],
      tags: {
        defs: [
          { name: '旧', aliases: ['旧a'], parent: null },
          { name: '新', aliases: [], parent: null },
        ],
        changes: [],
      },
    });
    await page.goto('/');

    await page.getByTestId('open-tag-manager').click();

    // 记录经别名「旧a」引用「旧」→ 拦截并给出 1 条
    await page.getByTestId('tag-remove-旧').click();
    await expect(page.getByTestId('tag-message')).toContainText('仍被 1 条记录引用');

    // 合并：引用迁移到保留项
    await page.getByTestId('tag-merge-source').selectOption('旧');
    await page.getByTestId('tag-merge-target').selectOption('新');
    await page.getByTestId('tag-merge-submit').click();
    await expect(page.getByTestId('tag-message')).toContainText('影响 1 条记录');
    expect(await logTags(page, 'v1')).toEqual(['新']);

    // 合并后源标签已不存在：再移除是幂等空操作，体系不再变化
    const before = JSON.stringify(await snapshot(page));
    const again = await page.evaluate(() =>
      window.__appStore.getState().removeTag('旧'),
    );
    expect(again.ok).toBe(true);
    expect(again.affectedRecords).toBe(0);
    expect(JSON.stringify(await snapshot(page))).toBe(before);

    // 保留项「新」继承了引用：移除它被拦截，计数与迁移后实际一致
    await page.getByTestId('tag-remove-新').click();
    await expect(page.getByTestId('tag-message')).toContainText('仍被 1 条记录引用');
    await expect(page.getByTestId('tag-row-新')).toBeVisible();
    expect(await logTags(page, 'v1')).toEqual(['新']);
  });
});
