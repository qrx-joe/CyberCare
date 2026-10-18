import { test, expect } from '@playwright/test';
import { hash } from '../../dist/domain.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('缺年份提醒进入实际文字和 HTML 下载；检测哈希仍对应同一份文件', async ({ page, context }) => {
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成日期核对\n活动时间：10 月 24 日 14:00—16:00\n活动地点：示例活动室\n报名方式：现场登记');
  await page.locator('#source-note').fill('开发者原创合成日期材料，不是真实活动');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  await expect(page.locator('#guidance-time')).toContainText('年份');
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title','time','location','registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check(); await page.locator('#confirm').click();
  await expect(page.locator('#final-text')).toContainText('年份待核实');
  const id = (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  const receipt = await (await context.request.get(`/api/tasks/${id}/receipt`)).json();
  expect(receipt.values.time).toBe('10 月 24 日 14:00—16:00');
  const files = {};
  for (const kind of ['text','html']) {
    const waiting = page.waitForEvent('download'); await page.locator(`#export-${kind}`).click();
    files[kind] = await readFile(await (await waiting).path(), 'utf8');
    expect(files[kind]).toContain('年份待核实');
  }
  expect(hash(files.html)).toBe(receipt.audit.htmlHash);
  const recipient = await context.newPage(); await recipient.setContent(files.html);
  await expect(recipient.locator('main > p')).toContainText('不要按阅读当天推算');
  const directory = '.local/validation/recipient-date-20261019';
  await mkdir(directory, { recursive:true });
  await writeFile(`${directory}/result.html`, files.html);
  await recipient.screenshot({ path:`${directory}/result.png`, fullPage:true });
  await recipient.close();
  await page.locator('#delete').click(); await expect(page.locator('#empty')).toBeVisible();
});

test('仍在运行的旧服务未声明全文修订能力时，不显示或发送无法保存的正文编辑', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch(), config = await response.json(); delete config.contentEditing;
    await route.fulfill({ response, json: config });
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible(); await expect(page.locator('#content-editor')).toBeHidden();
  await page.locator('#fact-title').fill('合成旧服务兼容检查');
  await page.locator('#edit-reason').fill('只修改四字段');
  const request = page.waitForRequest(request => request.url().endsWith('/edit'));
  await page.locator('#save').click(); expect((await request).postDataJSON().content).toBeUndefined();
  await expect(page.locator('#notice')).toContainText('已保存修改'); await page.locator('#delete').click();
});

test('完整正文可修订，保存后重新检测，下载与回执保留不同版本', async ({ page, context }) => {
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  const original = await page.locator('#original').textContent();
  const id = (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  await page.locator('#content-editor summary').click();
  await page.locator('#content-original').fill('活动名称：一起读书 · 社区公益阅读会\n活动说明：合成修订，不要求自带书籍。');
  await page.locator('#content-summary').fill('合成修订：阅读会免费参加。');
  await page.locator('#content-description').fill('<script>这是一段合成图像说明</script>');
  await expect(page.locator('#confirm')).toBeDisabled(); await expect(page.locator('#audit')).toBeDisabled();
  await page.locator('#edit-reason').fill('对照开发者合成答案修正正文，不是真实活动信息');
  await page.locator('#save').click(); await expect(page.locator('#audit-output')).toContainText('尚未检测');
  await expect(page.locator('#original')).toHaveText(original);
  await expect(page.locator('#content-original')).toHaveValue(/不要求自带书籍/);
  expect((await context.request.get(`/api/tasks/${id}/html`)).status()).toBe(409);
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('版本 2');
  for (const key of ['title', 'time', 'location', 'registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check(); await page.locator('#confirm').click();
  await expect(page.locator('#completed')).toBeVisible();
  await expect(page.locator('#final-text')).toContainText('不要求自带书籍');
  await expect(page.locator('#final-text')).not.toContainText('带一本喜欢的书');
  const receipt = await (await context.request.get(`/api/tasks/${id}/receipt`)).json();
  const html = await (await context.request.get(`/api/tasks/${id}/html`)).text();
  expect(receipt.extraction.original).toBe(original); expect(receipt.contentChanges).toHaveLength(3);
  expect(receipt.reviewedContent.original).toContain('不要求自带书籍');
  expect(receipt.originalTranscriptHash).toBe(hash(original)); expect(hash(html)).toBe(receipt.audit.htmlHash);
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  const invalid = await context.request.post(`/api/tasks/${id}/edit`, { headers: { 'X-CyberCare': '1' }, data: { revision:2, values:receipt.values, reason:'合成拒绝测试', content: { original:'', summary:'', description:'' } } });
  expect(invalid.status()).toBe(400);
  await page.locator('#delete').click();
  await expect(page.locator('#content-original')).toHaveValue('');
});

test('浏览器拒绝剪贴板时选择现有结果并说明键盘复制与下载退路', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('synthetic denied'); } } }));
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title', 'time', 'location', 'registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check(); await page.locator('#confirm').click();
  await expect(page.locator('#final-text')).toContainText('海报文字版');
  const text = await page.locator('#final-text').textContent();
  await page.locator('#copy').click();
  await expect(page.locator('#notice')).toContainText('Ctrl+C');
  await expect(page.locator('#notice')).toContainText('下载纯文本');
  expect(await page.evaluate(() => window.getSelection().toString())).toBe(text);
  await expect(page.locator('#final-text')).toBeFocused(); await expect(page.locator('#error')).toBeHidden();
  const download = page.waitForEvent('download'); await page.locator('#export-text').click(); await download;
  await page.locator('#delete').click(); await expect(page.locator('#final-text')).toBeEmpty();
});
