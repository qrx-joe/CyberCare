import { test, expect } from '@playwright/test';

async function interruptedTask(page, onRead) {
  const created = [], reads = [];
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataJSON().mode).toBe('sample');
    const response = await route.fetch(), task = await response.json(); created.push(task);
    // Only the browser sees a pending state; the server processes a synthetic sample, never a model call.
    await route.fulfill({ response, json:{ ...task, status:'processing', extraction:undefined, values:undefined, provider:undefined } });
  });
  await page.route(/\/api\/tasks\/[^/]+$/, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    reads.push(route.request().url());
    if (reads.length === 1) return route.abort('failed');
    await onRead(route, reads.length, created[0]);
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#retry-task')).toBeVisible();
  return { created, reads };
}

test('读取中断后可重复恢复同一任务，处理中继续轮询，不重新提交或延长到期', async ({ page, context }) => {
  const state = await interruptedTask(page, async (route, count, task) => {
    if (count === 2) return route.fulfill({ status:503, json:{ message:'合成测试：状态服务暂不可用' } });
    if (count === 3) return route.fulfill({ json:{ ...task, status:'processing', extraction:undefined, values:undefined, provider:undefined } });
    await route.continue();
  });
  await expect(page.locator('#task-read-recovery')).toContainText('不会重新提交图片或调用模型');
  const original = state.created[0];
  await page.locator('#retry-task').click();
  await expect(page.locator('#error')).toContainText('状态服务暂不可用');
  await expect(page.locator('#retry-task')).toBeEnabled();
  expect(state.reads).toHaveLength(2);
  await expect(page.locator('#task-meta')).toContainText(original.id);
  await page.locator('#retry-task').click();
  await expect(page.locator('#draft')).toBeVisible();
  await expect(page.locator('#task-read-recovery')).toBeHidden();
  await expect(page.locator('#result-title')).toBeFocused();
  const task = await (await context.request.get(`/api/tasks/${original.id}`)).json();
  expect(task.expiresAt).toBe(original.expiresAt);
  expect(task.revision).toBe(original.revision);
  expect(task.provider.requests).toBe(0);
  expect(state.created).toHaveLength(1); expect(state.reads).toHaveLength(4);
  const config = await (await context.request.get('/api/config')).json(); expect(config.provider.requests).toBe(0);
  await page.locator('#delete').click(); await expect(page.locator('#task-read-recovery')).toBeHidden();
});

test('恢复读取期间到期，晚到响应不能恢复任务和核对内容', async ({ page, context }) => {
  await page.clock.install();
  let release, ready;
  const held = new Promise(resolve => { ready = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  const state = await interruptedTask(page, async route => {
    const response = await route.fetch(); ready(); await resumed; await route.fulfill({ response });
  });
  await page.locator('#retry-task').click(); await held;
  await expect(page.locator('#retry-task')).toBeDisabled();
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator('#notice')).toContainText('资料已到期');
  const returned = page.waitForResponse(response => response.url().endsWith(`/tasks/${state.created[0].id}`));
  release(); await returned;
  await expect(page.locator('#draft')).toBeHidden(); await expect(page.locator('#task-controls')).toBeHidden();
  await expect(page.locator('#task-read-recovery')).toBeHidden(); await expect(page.locator('#original')).toBeEmpty();
  await expect(page.locator('#create')).toBeEnabled();
  expect(state.created).toHaveLength(1);
  // The page clock is synthetic; remove the still-live server sample explicitly.
  await context.request.delete(`/api/tasks/${state.created[0].id}`, { headers:{ 'X-CyberCare':'1' } });
});

test('重新读取已删除的任务时清空页面，不自动重建任务', async ({ page, context }) => {
  const state = await interruptedTask(page, route => route.continue());
  await context.request.delete(`/api/tasks/${state.created[0].id}`, { headers:{ 'X-CyberCare':'1' } });
  await page.locator('#retry-task').click();
  await expect(page.locator('#notice')).toContainText('任务已删除或到期');
  await expect(page.locator('#task-read-recovery')).toBeHidden(); await expect(page.locator('#task-controls')).toBeHidden();
  await expect(page.locator('#create')).toBeEnabled(); expect(state.created).toHaveLength(1);
});
