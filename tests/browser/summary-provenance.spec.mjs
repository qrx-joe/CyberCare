import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fieldSummary, hash } from '../../dist/domain.js';

const unusedDraft = '合成反例：虚构协会主办并赞助本次活动。';
const directory = '.local/validation/summary-provenance-20261020/browser';

async function prepare(page, context) {
  // Persist a manual task and an unused summary draft through the real API.
  // Only creation delivery waits for setup; no live provider or later response is substituted.
  await page.route(/\/api\/tasks$/, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(), created = await response.json();
    let task;
    await expect.poll(async () => {
      task = await (await context.request.get(`/api/tasks/${created.id}`)).json();
      return task.status;
    }).toBe('needs_review');
    const seeded = await context.request.post(`/api/tasks/${task.id}/edit`, {
      headers:{ 'X-CyberCare':'1' }, data:{ revision:task.revision, values:task.values,
        reason:'开发者合成来源切换夹具；不是真实模型输出', summaryMode:'fields',
        content:{ ...task.extraction, summary:unusedDraft } },
    });
    expect(seeded.status()).toBe(200);
    await route.fulfill({response, json:await seeded.json()});
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成概述来源核对\n活动时间：10月24日 14:00\n活动地点：示例活动室\n报名方式：现场登记');
  await page.locator('#source-note').fill('开发者原创合成材料；后端人工任务，不是真实模型或活动');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  return (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
}

async function finish(page, context, id, name) {
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title','time','location','registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check(); await page.locator('#confirm').click();
  await expect(page.locator('#completed')).toBeVisible();
  const receipt = await (await context.request.get(`/api/tasks/${id}/receipt`)).json();
  const files = {};
  for (const kind of ['text','html']) {
    const waiting = page.waitForEvent('download'); await page.locator(`#export-${kind}`).click();
    files[kind] = await readFile(await (await waiting).path(), 'utf8');
  }
  expect(hash(files.html)).toBe(receipt.audit.htmlHash);
  await mkdir(`${directory}/${name}`, {recursive:true});
  await writeFile(`${directory}/${name}/receipt.json`,JSON.stringify(receipt,null,2));
  await writeFile(`${directory}/${name}/result.html`,files.html);
  await writeFile(`${directory}/${name}/result.txt`,files.text);
  return {receipt,files};
}

test('字段概述跟随草稿与保存版本，未使用的叙述保留回执且不进入实际导出', async ({page,context}) => {
  const id = await prepare(page,context);
  await expect(page.locator('#summary-mode')).toHaveCount(1,{timeout:1000});
  await expect(page.locator('#summary-source')).toContainText('四项信息');
  await page.locator('#content-editor summary').click();
  await expect(page.locator('#summary-mode')).toHaveValue('fields');
  await expect(page.locator('#content-summary')).toBeHidden();
  await expect(page.locator('#content-summary')).toHaveValue(unusedDraft);
  const task = await (await context.request.get(`/api/tasks/${id}`)).json();
  await expect(page.locator('#field-summary-preview')).toHaveText(fieldSummary(task.values));
  await expect(page.locator('#field-summary-preview')).not.toContainText('虚构协会');
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  await page.locator('#fact-location').fill('合成修订场地');
  await expect(page.locator('#field-summary-preview')).toContainText('合成修订场地');
  await expect(page.locator('#audit')).toBeDisabled(); await expect(page.locator('#confirm')).toBeDisabled();
  await page.locator('#edit-reason').fill('对照合成答案更正地点');
  const saved = page.waitForRequest(request => request.url().endsWith('/edit'));
  await page.locator('#save').click(); expect((await saved).postDataJSON().summaryMode).toBe('fields');
  await expect(page.locator('#audit-output')).toContainText('尚未检测');
  expect((await context.request.get(`/api/tasks/${id}/html`)).status()).toBe(409);
  const {receipt,files} = await finish(page,context,id,'fields');
  expect(receipt.summaryMode).toBe('fields'); expect(receipt.reviewedContent.summary).toBe(unusedDraft);
  expect(files.text).toContain(fieldSummary(receipt.values));
  for (const file of Object.values(files)) { expect(file).not.toContain('虚构协会'); expect(file).toContain('合成修订场地'); expect(file).toContain('年份待核实'); }
  await page.locator('#delete').click(); await expect(page.locator('#field-summary-preview')).toBeEmpty();
  expect((await context.request.get(`/api/tasks/${id}`)).status()).toBe(404);
});

test('来源切换保留人工草稿，记录依据并转义导出；窄屏、放大及到期清理覆盖新增控件', async ({page,context}) => {
  await page.clock.install(); const id = await prepare(page,context);
  await page.locator('#content-editor summary').click();
  await page.locator('#summary-mode').selectOption('custom');
  await expect(page.locator('#content-summary')).toHaveValue(unusedDraft);
  const reviewed = '合成人工概述：地点待核实，保留 <script> 文本。';
  await page.locator('#content-summary').fill(reviewed);
  await page.locator('#summary-mode').selectOption('fields');
  await expect(page.locator('#content-summary')).toBeHidden();
  await page.locator('#summary-mode').selectOption('custom');
  await expect(page.locator('#content-summary')).toHaveValue(reviewed);
  await expect(page.locator('#field-summary-preview')).toBeEmpty();
  await expect(page.locator('#audit')).toBeDisabled();
  expect((await (await context.request.get(`/api/tasks/${id}`)).json()).summaryMode).toBe('fields');
  for (const width of [1440,320]) {
    await page.setViewportSize({width,height:960});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#summary-mode').scrollIntoViewIfNeeded();
    await mkdir(directory,{recursive:true}); await page.screenshot({path:`${directory}/editor-${width}.png`});
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
  const audit = await page.evaluate(async () => (await window.axe.run()).violations.map(item => item.id));
  expect(audit).toEqual([]);
  await page.locator('#edit-reason').fill('开发者核对合成正文，明确采用人工概述');
  await page.locator('#save').click(); await expect(page.locator('#audit-output')).toContainText('尚未检测');
  const {receipt,files} = await finish(page,context,id,'custom');
  expect(receipt.summaryMode).toBe('custom'); expect(receipt.summarySourceChanges.at(-1)).toMatchObject({before:'fields',after:'custom',reason:'开发者核对合成正文，明确采用人工概述'});
  expect(files.text).toContain(reviewed); expect(files.html).toContain('&lt;script&gt;'); expect(files.html).not.toContain('<script>');
  expect(files.text).not.toContain('虚构协会');
  await page.clock.fastForward(31*60*1000);
  await expect(page.locator('#notice')).toContainText('资料已到期');
  await expect(page.locator('#content-summary')).toHaveValue(''); await expect(page.locator('#field-summary-preview')).toBeEmpty();
  await expect(page.locator('#summary-source')).toBeEmpty(); await expect(page.locator('#summary-mode')).toHaveValue('custom');
  // Browser clock advances only the UI; explicitly clean up the still-real server task.
  expect((await context.request.delete(`/api/tasks/${id}`,{headers:{'X-CyberCare':'1'}})).status()).toBe(200);
});

test('旧服务没有声明概述来源能力时隐藏控件，也不发送来源字段', async ({page}) => {
  await page.route('**/api/config',async route => {
    const response=await route.fetch(),config=await response.json(); delete config.summarySources;
    await route.fulfill({response,json:config});
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click(); await expect(page.locator('#draft')).toBeVisible();
  await page.locator('#content-editor summary').click();
  await expect(page.locator('#summary-mode-controls')).toBeHidden(); await expect(page.locator('#content-summary')).toBeVisible();
  await page.locator('#content-summary').fill('合成旧协议概述'); await page.locator('#edit-reason').fill('合成旧服务兼容核对');
  const saving=page.waitForRequest(request=>request.url().endsWith('/edit'));
  await page.locator('#save').click(); expect((await saving).postDataJSON().summaryMode).toBeUndefined();
  await expect(page.locator('#content-summary')).toHaveValue('合成旧协议概述'); await page.locator('#delete').click();
});
