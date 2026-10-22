import { test, expect } from '@playwright/test';

const ready = async page => { await page.goto('/#audio'); await expect(page.locator('#audio-status')).toContainText('可以先用'); };

test('取消之后晚到的 processing 响应不能恢复处理中状态', async ({ page, context }) => {
  // Browser response substitution isolates request ordering; server cancel lifecycle has separate unit coverage.
  let created, release, arrive;
  const held = new Promise(resolve => { arrive = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/assistance', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); created = await response.json();
    await route.fulfill({ response, json: { ...created, status: 'processing', audio: undefined } });
  });
  await page.route(/\/api\/assistance\/[a-f0-9-]{36}$/, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    arrive(); await resumed;
    await route.fulfill({ json: { ...created, status: 'processing', audio: undefined } });
  });
  await page.route(/\/api\/assistance\/[a-f0-9-]{36}\/cancel$/, route => route.fulfill({ json: { ...created, status: 'cancelled', audio: undefined } }));
  try {
    await ready(page); await page.locator('#audio-permission').check(); await page.locator('#audio-create').click(); await held;
    await page.locator('#audio-cancel').click(); await expect(page.locator('#audio-status')).toContainText('已取消');
    const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(created.id));
    release(); await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.locator('#audio-status').textContent()).toContain('已取消');
    await expect(page.locator('#audio-cancel')).toBeHidden();
  } finally { release(); if (created) await context.request.delete(`/api/assistance/${created.id}`, { headers: { 'X-CyberCare': '1' } }); }
});

test('全文修订的具体差异在未保存草稿、API、当前导出中一致展示，摘要同步后消失', async ({ page, context }) => {
  await ready(page); await page.locator('#audio-permission').check(); await page.locator('#audio-create').click();
  await expect(page.locator('#audio-result')).toBeVisible();
  const id = (await page.locator('#audio-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  await page.locator('#audio-text').fill('活动安排需要重新核实。'); await page.locator('#audio-summary').fill('请提前带好借阅证');
  await expect(page.locator('#audio-consistency')).toContainText('请提前带好借阅证');
  await page.locator('#audio-reason').fill('开发者合成修订，原转写保留用于对照'); await page.locator('#audio-save').click();
  await expect(page.locator('#audio-meta')).toContainText('版本 2');
  const task = await (await context.request.get(`/api/assistance/${id}`)).json(); expect(task.audioReviewHints).toHaveLength(1);
  await page.locator('#audio-confirmed').check(); await page.locator('#audio-review').click();
  await expect(page.locator('#audio-text-export')).toBeEnabled();
  const exported = await (await context.request.get(`/api/assistance/${id}/text`)).text(); expect(exported).toContain('摘要仍含');
  await page.locator('#audio-summary').fill('活动安排待核实。'); await expect(page.locator('#audio-consistency')).toBeHidden();
  await page.locator('#audio-save').click(); await expect(page.locator('#audio-meta')).toContainText('版本 3');
  expect((await (await context.request.get(`/api/assistance/${id}`)).json()).audioReviewHints ?? []).toHaveLength(0);
  await page.locator('#audio-delete').click();
});

test('删除失败不能被错误消息中的“删除”二字当成删除成功，可再次删除同一任务', async ({ page, context }) => {
  await ready(page); await page.locator('#audio-permission').check(); await page.locator('#audio-create').click();
  await expect(page.locator('#audio-result')).toBeVisible();
  const id = (await page.locator('#audio-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  let deletes = 0;
  await page.route(`**/api/assistance/${id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    if (++deletes === 1) return route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '内部处理失败，请重试或删除任务。' } });
    return route.continue();
  });
  await page.locator('#audio-delete').click();
  await expect(page.locator('#audio-status')).toContainText('服务端删除尚未确认');
  await expect(page.locator('#audio-original')).toBeEmpty();
  expect((await context.request.get(`/api/assistance/${id}`)).status()).toBe(200);
  await page.locator('#audio-delete').click();
  await expect.poll(async () => (await context.request.get(`/api/assistance/${id}`)).status()).toBe(404);
  expect(deletes).toBe(2);
});

test('写入响应丢失只重新读取，失败保存保留脏草稿，404 清空后可重新开始', async ({ page, context }) => {
  await ready(page); let reviews = 0, creates = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/assistance') creates++; });
  await page.locator('#audio-permission').check(); await page.locator('#audio-create').click(); await expect(page.locator('#audio-result')).toBeVisible();
  const id = (await page.locator('#audio-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  await page.route(`**/api/assistance/${id}/review`, async route => { reviews++; await route.fetch(); await route.abort('failed'); });
  await page.locator('#audio-confirmed').check(); await page.locator('#audio-review').click();
  await expect(page.locator('#audio-retry')).toBeVisible(); await expect(page.locator('#audio-text-export')).toBeDisabled();
  await page.locator('#audio-retry').click(); await expect(page.locator('#audio-text-export')).toBeEnabled(); expect(reviews).toBe(1);
  await page.locator('#audio-text').fill('未保存的合成校对文字'); await page.locator('#audio-reason').fill('合成接口中断测试');
  await page.route(`**/api/assistance/${id}/edit`, route => route.fulfill({ status: 503, json: { message: '合成保存中断，未写入' } }));
  await page.locator('#audio-save').click(); await expect(page.locator('#audio-retry')).toBeVisible();
  await page.locator('#audio-retry').click(); await expect(page.locator('#audio-retry')).toBeHidden();
  await expect(page.locator('#audio-text')).toHaveValue('未保存的合成校对文字'); await expect(page.locator('#audio-text-export')).toBeDisabled();
  await page.unroute(`**/api/assistance/${id}/edit`); await page.locator('#audio-save').click(); await expect(page.locator('#audio-meta')).toContainText('版本 2');
  await page.unroute(`**/api/assistance/${id}/review`);
  await context.request.delete(`/api/assistance/${id}`, { headers: { 'X-CyberCare': '1' } });
  await page.locator('#audio-confirmed').check(); await page.locator('#audio-review').click(); await expect(page.locator('#audio-retry')).toBeVisible();
  await page.locator('#audio-retry').click(); await expect(page.locator('#audio-status')).toContainText('已删除或到期');
  await expect(page.locator('#audio-original')).toBeEmpty(); await expect(page.locator('#audio-text')).toHaveValue('');
  await expect(page.locator('#audio-create')).toBeEnabled(); expect(creates).toBe(1);
  expect((await (await context.request.get('/api/assistance/config')).json()).requests).toBe(0);
});
