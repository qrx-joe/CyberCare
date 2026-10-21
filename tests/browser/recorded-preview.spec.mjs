import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// A synthetic readonly fixture, not public-material/model evidence. Replacing only
// this compiled constant makes the feature testable without ignored local assets.
const fixture={original:'合成存档示例\n10月24日 13:00\n<script>alert(1)</script>\n指引已知',
  facts:{title:'合成存档示例',time:'10月24日 13:00',location:'<script>alert(1)</script>',registration:'指引已知'},
  notes:['入口目标未核实','合成说明 <img src=x onerror=alert(1)>'],recordedAt:'2026-01-01T00:00:00.000Z',
  source:{author:'Synthetic fixture',title:'Synthetic_test.png',url:'https://commons.wikimedia.org/wiki/File:Synthetic_test.png',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},
  provider:{model:'synthetic-model',promptVersion:'synthetic-v1',manualFieldEdits:1},
  imageDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg=='};
async function embedded(page,value){
  await page.route('**/app.js',async route=>{
    const response=await route.fetch(),code=await response.text();
    const marker=/const embeddedExample = [^\n]*;/;
    expect(code).toMatch(marker);
    await route.fulfill({response,body:code.replace(marker,()=>`const embeddedExample = ${JSON.stringify(value)};`)});
  });
}
test('已有结果明确标识存档与未知，切换不写任务、不覆盖脏草稿或执行材料脚本',async({page,context})=>{
  await embedded(page,fixture);
  const mutations=[],external=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/tasks')&&request.method()!=='GET')mutations.push(request.method());if(url.protocol==='https:')external.push(url.hostname);});
  await page.goto('/');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成草稿保持原样');await page.locator('#source-note').fill('开发者合成材料，不是存档来源');
  await page.locator('#permission').check();await page.locator('#create').click();await expect(page.locator('#draft')).toBeVisible();
  const id=(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  await page.locator('#fact-location').fill('合成未保存内容');const before=mutations.length;
  await page.locator('#hero-example').click();await expect(page.locator('#sample-example')).toHaveValue('recorded');
  await expect(page.locator('#sample-reading-title')).toHaveText('合成存档示例');
  await expect(page.locator('#sample-disclosure')).toContainText('已有结果');await expect(page.locator('#sample-disclosure')).toContainText('非真人确认');
  await expect(page.locator('#sample-disclosure')).toContainText('AI 识别');await expect(page.locator('#sample-disclosure')).toContainText('synthetic-model');
  await expect(page.locator('#sample-disclosure')).toContainText('其中 1 项字段经人工修订');
  await expect(page.locator('#sample-preview-status')).toContainText('识别存档');await expect(page.locator('#sample-date-note')).toContainText('年份');
  await expect(page.locator('#sample-facts')).toContainText('<script>alert(1)</script>');
  await expect(page.locator('#sample-notes')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#sample-preview script,#sample-notes img').count()).toBe(0);
  await expect(page.locator('#sample-source-credit')).toContainText('Synthetic fixture');
  const sourceLink=page.locator('#sample-source-credit a').first();
  await expect(sourceLink).toHaveAttribute('href',fixture.source.url);await expect(sourceLink).toHaveAttribute('rel','noopener noreferrer');
  await expect.poll(()=>page.locator('#sample-source-image').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.locator('#transcript')).toHaveValue('活动名称：合成草稿保持原样');
  await expect(page.locator('#fact-location')).toHaveValue('合成未保存内容');await expect(page.locator('#audit')).toBeDisabled();
  const task=await(await context.request.get(`/api/tasks/${id}`)).json();expect(task.revision).toBe(1);expect(task.values.location).toBe('');expect(task.provider.requests).toBe(0);
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
  expect(await page.evaluate(async()=> (await window.axe.run(document.querySelector('#sample-preview'))).violations.map(v=>v.id))).toEqual([]);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#sample-example').selectOption('sample');await expect(page.locator('#sample-reading-title')).toContainText('一起读书');
  await expect(page.locator('#sample-disclosure')).toContainText('尚未检测、尚未人工确认');
  expect(mutations.length).toBe(before);expect(external).toEqual([]);
  await page.locator('#sample-to-form').click();await expect(page.locator('#input-title')).toBeFocused();await expect(page.locator('#mode')).toHaveValue('manual');
  await page.locator('#delete').click();await expect(page.locator('#empty')).toBeVisible();
});
test('没有可选存档时保留合成示例，源图加载失败仍能查看文字',async({page})=>{
  await embedded(page,null);await page.route('**/poster.svg',route=>route.fulfill({status:404,body:'synthetic missing image'}));
  await page.goto('/');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);await page.locator('#nav-example').click();
  await expect(page.locator('#sample-example-picker')).toBeHidden();await expect(page.locator('#sample-recorded-option')).toBeDisabled();
  await expect(page.locator('#sample-reading-title')).toContainText('一起读书');await expect(page.locator('#sample-source-fallback')).toBeVisible();
  await expect(page.locator('#sample-source-image')).toBeHidden();await expect(page.locator('#sample-original')).toContainText('开发者编写');
  await expect(page.locator('#task-controls')).toBeHidden();await expect(page.locator('#sample-disclosure')).toContainText('合成示例');
});
