import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { normalizeExtraction } from '../../dist/domain.js';

test('未定位的模型引文标为待核实，留空原因与原文缺失区分，编辑不能让旧引文变成依据', async ({page},testInfo) => {
  // Developer-written text and normalized Provider-shaped output replace creation
  // and polling responses. The server owns a manual task; no model or export claim.
  const original='示例北区 11月8日 示例南区 14:00';
  const empty=()=>({value:null,evidence:''});
  const extraction=normalizeExtraction({original,summary:'开发者合成引用拒绝检查',description:'不是实际海报或模型结果',
    facts:{title:empty(),time:{value:'11月8日 14:00',evidence:'11月8日 14:00'},location:{value:'示例北区 示例南区',evidence:'示例北区 示例南区'},registration:empty()},uncertainties:[]});
  await page.route(/\/api\/tasks(?:\/[a-f0-9-]{36})?$/,async route=>{
    if(!['POST','GET'].includes(route.request().method()))return route.continue();
    const response=await route.fetch(); const task=await response.json();
    await route.fulfill({response,json:task.extraction?{...task,extraction}:task});
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill(original);
  await page.locator('#source-note').fill('开发者合成引用拒绝回归；创建响应明确替代，非模型结果');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  for(const key of ['time','location']){
    await expect(page.locator(`#fact-${key}`)).toHaveValue('');
    await expect(page.locator(`#evidence-${key}`)).toContainText('待核实的识别片段');
    await expect(page.locator(`#guidance-${key}`)).toContainText('当前转录中未找到');
  }
  await expect(page.locator('#evidence-time')).toContainText('11月8日 14:00');
  await expect(page.locator('#guidance-registration')).not.toContainText('当前转录中未找到');
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
  expect(await page.evaluate(async()=>(await window.axe.run()).violations.map(v=>v.id))).toEqual([]);
  for(const width of [1440,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#fact-fields > div').nth(1).screenshot({path:testInfo.outputPath(`rejected-time-${width}.png`)});
  }
  await page.locator('#fact-time').fill('11月8日 14:00');
  await expect(page.locator('#guidance-time')).not.toContainText('当前转录中未找到');
  await expect(page.locator('#evidence-time')).toContainText('待核实的识别片段');
  await expect(page.locator('#audit')).toBeDisabled();
  await page.locator('#fact-time').fill('');
  await expect(page.locator('#guidance-time')).toContainText('当前转录中未找到');
  await page.locator('#delete').click(); await expect(page.locator('#empty')).toBeVisible();
});
