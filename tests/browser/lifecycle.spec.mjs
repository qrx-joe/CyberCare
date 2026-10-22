import { test, expect } from '@playwright/test';

async function manualDraft(page, withImage = false) {
  await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  const png = withImage ? await page.locator('#poster-preview').screenshot() : undefined;
  await page.locator('#mode').selectOption('manual');
  if (png) await page.locator('#image').setInputFiles({ name: 'synthetic-lifecycle.png', mimeType: 'image/png', buffer: png });
  await page.locator('#transcript').fill('活动名称：合成生命周期回归\n活动时间：未知');
  await page.locator('#source-note').fill('开发者原创合成测试，不含真实个人资料');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
}

test('等待检测与保存响应时不可编辑，避免静默丢失新输入', async ({ page }) => {
  await manualDraft(page);
  for (const operation of ['audit', 'edit']) {
    if (operation === 'edit') {
      await page.locator('#fact-title').fill('合成生命周期回归（修订）');
      await page.locator('#edit-reason').fill('合成文字的修订测试');
    }
    let release, ready;
    const held = new Promise(resolve => { ready = resolve; });
    const resumed = new Promise(resolve => { release = resolve; });
    await page.route(`**/api/tasks/*/${operation}`, async route => {
      const response = await route.fetch(); ready(); await resumed; await route.fulfill({ response });
    });
    await page.locator(operation === 'audit' ? '#audit' : '#save').click(); await held;
    await expect(page.locator('#fact-title')).toBeDisabled();
    await expect(page.locator('#edit-reason')).toBeDisabled();
    release();
    await expect(page.locator('#fact-title')).toBeEnabled();
    await expect(page.locator('#fact-title')).toHaveValue(operation === 'audit' ? '合成生命周期回归' : '合成生命周期回归（修订）');
  }
});

test('资料到期清除文字、文件与 Blob 引用，晚到检测响应不能复活任务', async ({ page }) => {
  await page.clock.install();
  await manualDraft(page, true);
  let release, ready;
  const held = new Promise(resolve => { ready = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/tasks/*/audit', async route => {
    const response = await route.fetch(); ready(); await resumed; await route.fulfill({ response });
  });
  await page.locator('#audit').click(); await held;
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator('#notice')).toContainText('资料已到期');
  await expect(page.locator('#draft')).toBeHidden();
  await expect(page.locator('#task-controls')).toBeHidden();
  await expect(page.locator('#original')).toBeEmpty();
  await expect(page.locator('#summary')).toBeEmpty();
  expect(await page.locator('#image').evaluate(input => input.files.length)).toBe(0);
  expect(await page.locator('#poster-preview').getAttribute('src')).not.toMatch(/^blob:/);
  await expect(page.locator('#transcript')).not.toHaveValue(/合成生命周期回归/);
  await expect(page.locator('#create')).toBeEnabled();
  const responseReturned = page.waitForResponse(response => response.url().endsWith('/audit'));
  release(); await responseReturned;
  await expect(page.locator('#draft')).toBeHidden();
  await expect(page.locator('#original')).toBeEmpty();
  await expect(page.locator('#notice')).toContainText('资料已到期');
});

test('未提交的人工草稿同样到期，切换模式不能恢复过期输入', async ({ page }) => {
  await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.clock.install();
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：尚未提交的合成资料');
  await page.locator('#source-note').fill('合成暂存来源');
  await page.locator('#mode').selectOption('sample');
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator('#notice')).toContainText('资料已到期');
  await page.locator('#mode').selectOption('manual');
  await expect(page.locator('#transcript')).toHaveValue('');
  await expect(page.locator('#source-note')).toHaveValue('');
});
