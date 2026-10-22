import { test, expect } from '@playwright/test';

test('四项未知时可回到材料对照；输入提示随草稿更新且仍可明确确认未知', async ({page,context}) => {
  await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  // Developer-written text exercises the all-unknown state; this is not a stored model response.
  await page.locator('#transcript').fill('这是一段没有活动字段标签的合成输入，仅用于界面回归。');
  await page.locator('#source-note').fill('开发者原创合成未知字段检查，不是真实用户记录');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  const id=(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  await expect(page.locator('#unknown-facts-help')).toBeVisible();
  await expect(page.locator('#unknown-facts-help')).toContainText('保留未知');
  await page.locator('#review-material').click();
  await expect(page.locator('#input-title')).toBeFocused();
  await expect(page.locator('#transcript')).toHaveValue('这是一段没有活动字段标签的合成输入，仅用于界面回归。');
  await page.locator('#fact-title').fill('开发者合成活动名称');
  await expect(page.locator('#unknown-facts-help')).toBeHidden();
  await expect(page.locator('#audit')).toBeDisabled();
  await page.locator('#fact-title').fill('');
  await expect(page.locator('#unknown-facts-help')).toBeVisible();
  await page.locator('#edit-reason').fill('合成回归：检查提示后恢复为空，不凭空填写活动信息');
  await page.locator('#save').click(); await expect(page.locator('#notice')).toContainText('已保存修改');
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for(const field of ['title','time','location','registration'])await page.locator(`#checked-${field}`).check();
  await page.locator('#confirm-content').check(); await page.locator('#confirm').click();
  await expect(page.locator('#completed')).toBeVisible();
  await expect(page.locator('#unknown-facts-help')).toBeHidden();
  const receipt=await(await context.request.get(`/api/tasks/${id}/receipt`)).json();
  expect(Object.values(receipt.values)).toEqual(['','','','']);
  expect(receipt.provider.requests).toBe(0);
  await page.locator('#delete').click(); await expect(page.locator('#empty')).toBeVisible();
});
