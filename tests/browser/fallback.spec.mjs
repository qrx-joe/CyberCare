import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { ModelFailure } from '../../dist/provider.js';

async function stoppedLiveTask(page, status) {
  const requests = [];
  await page.route('**/api/config', async route => {
    const response = await route.fetch(), config = await response.json();
    config.provider.live = true; config.provider.limit = 1;
    await route.fulfill({ response, json: config });
  });
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON(); requests.push(input);
    if (input.mode !== 'live') return route.continue();
    // The server receives manual synthetic input, never a live provider request.
    // Only the browser sees the simulated terminal model state.
    const response = await route.fetch({ postData: JSON.stringify({ ...input, mode:'manual', text:'活动名称：合成替代任务' }) });
    const task = await response.json();
    const error = new ModelFailure({ stage:'output-truncated', httpStatus:200, elapsedMs:100, timeout:false,
      finishReason:'length', usage:null, timeoutMs:90000, reasoningEffort:null, maxTokens:2500 }).message;
    await route.fulfill({ response, json:{ ...task, status, source:{ ...task.source, mode:'live' },
      error:status === 'failed' ? error : undefined,
      extraction:undefined, values:undefined, provider:undefined } });
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  const png = await page.locator('#poster-preview').screenshot();
  await page.locator('#mode').selectOption('live');
  await page.locator('#image').setInputFiles({ name:'synthetic-fallback.png', mimeType:'image/png', buffer:png });
  await page.locator('#source-note').fill('开发者原创合成材料；人工兜底回归');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#desk-status')).toContainText(status === 'failed' ? '处理失败' : '任务已取消');
  const id = (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  return { id, requests, png };
}

test('模型失败后保留本页图片和来源，转人工核对并完成实际导出', async ({ page, context }) => {
  const { id, requests, png } = await stoppedLiveTask(page, 'failed');
  await expect(page.locator('#error')).toContainText('结果不完整');
  await expect(page.locator('#manual-fallback')).toBeVisible();
  await expect(page.locator('#manual-fallback-help')).toContainText('原到期时间不变');
  await page.setViewportSize({ width:390, height:900 });
  const directory = '.local/validation/manual-fallback-20261019'; await mkdir(directory, { recursive:true });
  await page.locator('#manual-fallback').screenshot({ path:`${directory}/failure-390.png` });
  await page.locator('#use-manual').click();
  await expect(page.locator('#mode')).toHaveValue('manual');
  await expect(page.locator('#transcript')).toBeFocused();
  await expect(page.locator('#transcript')).toHaveValue('');
  await expect(page.locator('#source-note')).toHaveValue('开发者原创合成材料；人工兜底回归');
  expect(await page.locator('#image').evaluate(input => input.files[0].name)).toBe('synthetic-fallback.png');
  await expect(page.locator('#poster-preview')).toBeVisible();
  await expect(page.locator('#permission')).not.toBeChecked();
  await expect(page.locator('#manual-fallback')).toBeHidden();
  expect((await context.request.get(`/api/tasks/${id}`)).status()).toBe(404);
  const text = '活动名称：合成人工兜底\n活动时间：2026 年 10 月 24 日 14:00\n活动地点：示例活动室\n报名方式：现场登记';
  await page.locator('#transcript').fill(text); await page.locator('#permission').check();
  await page.locator('#create').click(); await expect(page.locator('#draft')).toBeVisible();
  await expect(page.locator('#provider-label')).toContainText('非 OCR / AI');
  await expect(page.locator('#provider-label')).toContainText('外部请求 0 次');
  expect(requests.map(input => input.mode)).toEqual(['live','manual']);
  expect(requests[1].image.data).toBe(png.toString('base64'));
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title','time','location','registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check(); await page.locator('#confirm').click();
  const waiting = page.waitForEvent('download'); await page.locator('#export-text').click();
  expect(await readFile(await (await waiting).path(), 'utf8')).toContain('合成人工兜底');
  await page.locator('#delete').click();
});

test('已取消识别可转人工，保留材料不延长原期限，到期仍清空图片与文字', async ({ page }) => {
  await page.clock.install();
  await stoppedLiveTask(page, 'cancelled');
  await page.clock.fastForward(15 * 60 * 1000);
  await page.locator('#use-manual').click();
  await expect(page.locator('#mode')).toHaveValue('manual');
  await page.locator('#transcript').fill('活动名称：尚未提交的合成人工兜底');
  await page.setViewportSize({ width:320, height:900 }); await page.locator('#large').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = '.local/validation/manual-fallback-20261019'; await mkdir(directory, { recursive:true });
  await page.locator('#input-title').scrollIntoViewIfNeeded();
  await page.screenshot({ path:`${directory}/manual-320.png` });
  await page.clock.fastForward(16 * 60 * 1000);
  await expect(page.locator('#notice')).toContainText('资料已到期');
  await page.locator('#mode').selectOption('manual');
  await expect(page.locator('#transcript')).toHaveValue('');
  await expect(page.locator('#source-note')).toHaveValue('');
  expect(await page.locator('#image').evaluate(input => input.files.length)).toBe(0);
  expect(await page.locator('#poster-preview').getAttribute('src')).toBeNull();
});

test('转人工期间资料到期，晚到的删除响应不能恢复图片或来源', async ({ page }) => {
  await page.clock.install();
  const { id } = await stoppedLiveTask(page, 'failed');
  let release, ready;
  const held = new Promise(resolve => { ready = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/tasks/${id}`, async route => {
    const response = await route.fetch(); ready(); await resumed; await route.fulfill({ response });
  });
  await page.locator('#use-manual').click(); await held;
  await expect(page.locator('#use-manual')).toBeDisabled();
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator('#notice')).toContainText('资料已到期');
  const returned = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(id));
  release(); await returned;
  await expect(page.locator('#notice')).toContainText('资料已到期');
  await expect(page.locator('#manual-fallback')).toBeHidden();
  await expect(page.locator('#task-controls')).toBeHidden();
  await expect(page.locator('#source-note')).toHaveValue('开发者原创合成演示海报；非真实活动');
  expect(await page.locator('#image').evaluate(input => input.files.length)).toBe(0);
  expect(await page.locator('#poster-preview').getAttribute('src')).not.toMatch(/^blob:/);
});
