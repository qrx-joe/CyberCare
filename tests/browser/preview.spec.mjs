import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

test('首屏整理前后入口展示源图，保持未保存的核对草稿与任务不变', async ({page,context}) => {
  const mutations=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/tasks')&&request.method()!=='GET')mutations.push(request.method());});
  await page.goto('/#workbench');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成草稿隔离检查');
  await page.locator('#source-note').fill('开发者原创合成材料；只读入口回归');
  await page.locator('#permission').check();await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  const id=(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  await page.locator('#fact-location').fill('尚未保存的合成场地');
  const before=mutations.length;
  await page.locator('#nav-home').click();
  await page.locator('#hero-example').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#sample-preview')).toHaveAttribute('open','');
  await expect(page.locator('#sample-preview-toggle')).toBeFocused();
  if (await page.locator('#sample-example-picker').isVisible()) await page.locator('#sample-example').selectOption('sample');
  await expect(page.locator('#sample-source-image')).toBeVisible();
  await expect.poll(()=>page.locator('#sample-source-image').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.locator('#sample-reading-title')).toContainText('一起读书');
  await expect(page.locator('#fact-location')).toHaveValue('尚未保存的合成场地');
  await expect(page.locator('#mode')).toHaveValue('manual');
  await expect(page.locator('#audit')).toBeDisabled();
  expect(mutations.length).toBe(before);
  const task=await(await context.request.get(`/api/tasks/${id}`)).json();
  expect(task.revision).toBe(1);expect(task.values.location).toBe('');expect(task.provider.requests).toBe(0);
  await page.locator('#sample-to-form').click();await expect(page.locator('#input-title')).toBeFocused();
  await page.locator('#delete').click();await expect(page.locator('#empty')).toBeVisible();
});

test('只读示例可键盘展开，不创建任务、检测或导出，不覆盖人工草稿', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/tasks')) requests.push(request.method()); });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#nav-task').click();
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：尚未提交的合成草稿');
  await page.locator('#source-note').fill('保留输入的回归检查');
  await page.locator('#nav-home').click();
  await page.locator('#sample-preview-toggle').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#sample-preview-content')).toBeVisible();
  if (await page.locator('#sample-example-picker').isVisible()) await page.locator('#sample-example').selectOption('sample');
  await expect(page.locator('#sample-preview')).toContainText('尚未检测、尚未人工确认');
  await expect(page.locator('#sample-facts')).toContainText('未知；示例未提供');
  await expect(page.locator('#sample-reading-title')).toContainText('一起读书');
  await expect(page.locator('#task-controls')).toBeHidden();
  await expect(page.locator('#completed')).toBeHidden();
  await expect(page.locator('#permission')).not.toBeChecked();
  await expect(page.locator('#transcript')).toHaveValue('活动名称：尚未提交的合成草稿');
  await expect(page.locator('#source-note')).toHaveValue('保留输入的回归检查');
  expect(await page.locator('#sample-preview [download], #sample-preview button').count()).toBe(0);
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js', 'utf8'));
  const audit = await page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector('#sample-preview'));
    return { violations: result.violations.map(v => v.id), incomplete: result.incomplete.map(v => v.id) };
  });
  await writeFile('.local/validation/preview-axe.json', JSON.stringify(audit, null, 2));
  expect(audit.violations).toEqual([]); expect(audit.incomplete).toEqual([]);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height:844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#sample-to-form').click(); await expect(page.locator('#input-title')).toBeFocused();
  await expect(page.locator('#mode')).toHaveValue('manual');
  expect(requests).toEqual([]);
});

test('核实提示跟随未知字段，不补填日期；修改仍使检测和确认失效', async ({ page, context }) => {
  await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成核对测试\n活动时间：10 月 20 日 下午 2 点');
  await page.locator('#source-note').fill('开发者编写的合成缺字段材料');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  await expect(page.locator('#fact-time')).toHaveValue('10 月 20 日 下午 2 点');
  await expect(page.locator('#guidance-time')).toContainText('年份');
  await expect(page.locator('#fact-location')).toHaveValue('');
  await expect(page.locator('#guidance-location')).toContainText('具体地址');
  await expect(page.locator('#guidance-registration')).toContainText('报名入口');
  await expect(page.locator('#fact-registration')).toHaveAttribute('aria-describedby', 'evidence-registration guidance-registration');
  await page.locator('#audit').click(); await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title', 'time', 'location', 'registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check(); await expect(page.locator('#confirm')).toBeEnabled();
  await page.locator('#fact-registration').fill('合成报名方式');
  await expect(page.locator('#guidance-registration')).toBeHidden();
  await expect(page.locator('#confirm')).toBeDisabled();
  await expect(page.locator('#checked-registration')).not.toBeChecked();
  await page.locator('#fact-registration').fill(''); await expect(page.locator('#guidance-registration')).toBeVisible();
  await page.locator('#fact-registration').fill('合成报名方式');
  await page.locator('#edit-reason').fill('仅用于回归测试的合成补充，不是真实报名渠道');
  await page.locator('#save').click(); await expect(page.locator('#audit-output')).toContainText('尚未检测');
  await expect(page.locator('#confirm')).toBeDisabled();
  const id = (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  const task = await (await context.request.get(`/api/tasks/${id}`)).json();
  expect(task.revision).toBe(2); expect(task.audit).toBeUndefined();
  expect(task.values.time).toBe('10 月 20 日 下午 2 点'); expect(task.values.location).toBe('');
  expect((await context.request.get(`/api/tasks/${id}/receipt`)).status()).toBe(409);
});

test('配置不可用时明确说明预览不可用，不显示伪造结果', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ status:503, contentType:'application/json', body:'{"message":"synthetic offline"}' }));
  await page.goto('/'); await page.locator('#sample-preview-toggle').click();
  await expect(page.locator('#sample-preview-status')).toContainText('示例暂不可用');
  await expect(page.locator('#sample-preview-content')).toBeHidden();
  await expect(page.locator('#sample-facts')).toBeEmpty();
});
