import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { hash } from '../../dist/domain.js';

const exports = ['#export-text', '#export-html', '#export-receipt'];
async function reviewable(page) {
  await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click(); await expect(page.locator('#draft')).toBeVisible();
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title', 'time', 'location', 'registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check();
  return (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
}
async function download(page, selector) {
  const pending = page.waitForEvent('download'); await page.locator(selector).click();
  return readFile(await (await pending).path());
}

test('确认后读取文字及下载期间禁用结果操作，响应到达后一次点击实际下载同版本文件', async ({ page, context }) => {
  const id = await reviewable(page);
  let release, arrive;
  const held = new Promise(resolve => { arrive = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  let textReads = 0;
  await page.route(`**/api/tasks/${id}/text`, async route => {
    if (++textReads === 1) { arrive(); await resumed; }
    await route.continue();
  });
  let releaseDownload;
  try {
    await page.locator('#confirm').click(); await held; await expect(page.locator('#completed')).toBeVisible();
    for (const selector of [...exports, '#copy', '#send-feedback']) await expect(page.locator(selector)).toBeDisabled();
    await expect(page.locator('#export-status')).toContainText('请稍候'); await expect(page.locator('#final-text')).toBeEmpty();
    release(); await expect(page.locator('#final-text')).toContainText('海报文字版');
    for (const selector of [...exports, '#copy', '#send-feedback']) await expect(page.locator(selector)).toBeEnabled();

    let downloadArrive;
    const downloadHeld = new Promise(resolve => { downloadArrive = resolve; });
    const downloadResumed = new Promise(resolve => { releaseDownload = resolve; });
    await page.route(`**/api/tasks/${id}/html`, async route => { downloadArrive(); await downloadResumed; await route.continue(); });
    const pending = page.waitForEvent('download'); await page.locator('#export-html').click(); await downloadHeld;
    for (const selector of [...exports, '#copy', '#send-feedback']) await expect(page.locator(selector)).toBeDisabled();
    releaseDownload(); const html = await readFile(await (await pending).path(), 'utf8');
    const text = (await download(page, '#export-text')).toString('utf8');
    const receipt = JSON.parse((await download(page, '#export-receipt')).toString('utf8'));
    expect(hash(html)).toBe(receipt.audit.htmlHash); expect(text).toContain('一起读书'); expect(textReads).toBe(2);
    expect(receipt.provider.requests).toBe(0); expect(receipt.review.revision).toBe(receipt.revision);
    await page.locator('#delete').click(); await expect(page.locator('#empty')).toBeVisible();
  } finally { release(); releaseDownload?.(); await context.request.delete(`/api/tasks/${id}`, { headers: { 'X-CyberCare': '1' } }); }
});

test('结果文字预览读取失败仍可下载已确认文件，复制不使用空白预览且不重复确认', async ({ page, context }) => {
  const id = await reviewable(page); let reviews = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api/tasks/${id}/review`)) reviews++; });
  await page.route(`**/api/tasks/${id}/text`, route => route.fulfill({ status: 503, json: { message: '合成预览读取中断' } }));
  try {
    await page.locator('#confirm').click(); await expect(page.locator('#error')).toContainText('核对已保存');
    await expect(page.locator('#final-text')).toBeEmpty(); await expect(page.locator('#copy')).toBeDisabled();
    for (const selector of exports) await expect(page.locator(selector)).toBeEnabled();
    await expect(page.locator('#export-status')).toContainText('下载');
    await page.unroute(`**/api/tasks/${id}/text`);
    const text = (await download(page, '#export-text')).toString('utf8'); expect(text).toContain('一起读书'); expect(reviews).toBe(1);
    expect((await (await context.request.get(`/api/tasks/${id}`)).json()).status).toBe('completed');
    await page.locator('#delete').click(); await expect(page.locator('#empty')).toBeVisible();
  } finally { await context.request.delete(`/api/tasks/${id}`, { headers: { 'X-CyberCare': '1' } }); }
});
