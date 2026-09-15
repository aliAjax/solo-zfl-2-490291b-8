import { test, expect } from '@playwright/test';
import { makeLog, seed } from './helpers';

test.describe('原有功能回归', () => {
  test('查看、筛选、对比、统计不回归', async ({ page }) => {
    await seed(page, {
      logs: [
        makeLog({ id: 'r1', name: '线性之王', switchType: 'linear', overallRating: 8, soundTags: ['麻将音'] }),
        makeLog({ id: 'r2', name: '段落咔哒', switchType: 'clicky', overallRating: 6, soundTags: ['沙脆'] }),
        makeLog({ id: 'r3', name: '茶轴日常', switchType: 'tactile', overallRating: 7, soundTags: [] }),
      ],
      tags: { defs: [], changes: [] },
    });
    await page.goto('/');

    // 列表查看
    await expect(page.locator('article')).toHaveCount(3);
    await expect(page.getByText('显示')).toContainText('3');

    // 详情查看
    await page.locator('article', { hasText: '线性之王' }).first().click();
    const detail = page.locator('.modal-surface');
    await expect(detail.getByText('线性之王')).toBeVisible();
    await expect(detail.getByText('#麻将音')).toBeVisible();
    await page.keyboard.press('Escape');

    // 筛选：轴体类型
    await page.getByRole('button', { name: '线性轴' }).click();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article')).toContainText('线性之王');

    // 筛选：最低评分
    await page.getByRole('button', { name: '全部' }).first().click();
    await page.locator('input[type=range]').fill('7');
    await expect(page.locator('article')).toHaveCount(2);

    // 筛选：关键词搜索 + 清除
    await page.locator('input[type=range]').fill('0');
    await page.getByPlaceholder('搜索名称、轴体、备注...').fill('不存在的东西');
    await expect(page.getByText('没有找到匹配的记录')).toBeVisible();
    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect(page.locator('article')).toHaveCount(3);

    // 对比：选两把进入对比视图
    await page.locator('article', { hasText: '线性之王' }).getByText('加入对比').click();
    await page.locator('article', { hasText: '段落咔哒' }).getByText('加入对比').click();
    await expect(page.getByText('已选择 2 把键盘')).toBeVisible();
    await page.getByRole('button', { name: '开始对比' }).click();
    await expect(page.getByText('项不同')).toBeVisible();
    await expect(page.getByText('键盘 A')).toBeVisible();
    await expect(page.getByText('键盘 B')).toBeVisible();

    // 统计视图
    await page.getByTitle('统计').click();
    await expect(page.getByText('条记录统计')).toBeVisible();
    await expect(page.getByText('平均评分')).toBeVisible();
    await expect(page.getByText('轴体类型占比')).toBeVisible();
    await expect(page.getByText('声音倾向分布')).toBeVisible();

    // 返回列表
    await page.getByRole('button', { name: '返回列表' }).click();
    await expect(page.locator('article')).toHaveCount(3);
  });
});
