import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeExtraction, hash } from '../../dist/domain.js';

const empty=()=>({value:null,evidence:''});
async function createWithQuote(page,original,facts){
  // Synthetic normalized extraction replaces only the UI response. The server
  // owns a manual task with this same original; no real model request is made.
  const extraction=normalizeExtraction({original,summary:'合成引文摘录检查',description:'开发者合成 UI 夹具，非真实模型或用户结果',facts,uncertainties:[]});
  await page.route(/\/api\/tasks(?:\/[a-f0-9-]{36}(?:\/audit)?)?$/,async route=>{
    if(!['POST','GET'].includes(route.request().method()))return route.continue();
    const response=await route.fetch(),task=await response.json();
    await route.fulfill({response,json:task.extraction?{...task,extraction}:task});
  });
  await page.goto('/');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');await page.locator('#transcript').fill(original);
  await page.locator('#source-note').fill('开发者合成引文摘录检查；UI 提取响应明确替代，实际保存与检测使用人工任务');
  await page.locator('#permission').check();await page.locator('#create').click();await expect(page.locator('#draft')).toBeVisible();
  return (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
}

test('可定位片段由人显式填入草稿，不自动保存或覆盖，修改使检测确认失效',async({page,context},testInfo)=>{
  const date='10月24日',deadline='提交截止：2026年10月24日 23:59';
  const original=`活动名称：合成片段核对\n${date}\n中间是独立的议程段落，不是时间的一部分。\n${deadline}`;
  const id=await createWithQuote(page,original,{title:{value:'合成片段核对',evidence:'合成片段核对'},time:{value:`${date}\n${deadline}`,evidence:`${date}\n${deadline}`},location:empty(),registration:empty()});
  await expect(page.locator('#fact-time')).toHaveValue('');
  await expect(page.locator('#excerpt-time')).toBeVisible({timeout:3000});
  await expect(page.locator('#excerpt-time')).toContainText('未核实含义');
  await page.locator('#audit').click();await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for(const key of ['title','time','location','registration'])await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check();await expect(page.locator('#confirm')).toBeEnabled();
  await page.locator('#excerpt-time summary').click();
  const pick=page.getByRole('button',{name:'填入草稿：活动时间片段 2',exact:true});await expect(pick).toBeEnabled();
  const writes=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/tasks')&&request.method()!=='GET')writes.push(request.method());});
  await pick.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#fact-time')).toBeFocused();await expect(page.locator('#fact-time')).toHaveValue(deadline);
  await expect(pick).toBeDisabled();await expect(page.locator('#notice')).toContainText('尚未保存');
  await expect(page.locator('#audit')).toBeDisabled();await expect(page.locator('#confirm')).toBeDisabled();
  await expect(page.locator('#checked-time')).not.toBeChecked();await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#evidence-time')).toContainText('待核实的识别片段');
  for(const width of [1440,320]){await page.setViewportSize({width,height:1000});await page.locator('#fact-fields > div').nth(1).screenshot({path:testInfo.outputPath(`excerpt-draft-${width}.png`)});}
  expect(writes).toEqual([]);
  let task=await(await context.request.get(`/api/tasks/${id}`)).json();expect(task.revision).toBe(1);expect(task.values.time).toBe('');
  await page.locator('#save').click();await expect(page.locator('#error')).toContainText('修改依据');expect(writes).toEqual([]);
  await page.locator('#edit-reason').fill('对照合成原文，选取提交截止片段；不是活动开始时间');
  await page.locator('#save').click();await expect(page.locator('#notice')).toContainText('已保存修改');
  task=await(await context.request.get(`/api/tasks/${id}`)).json();expect(task.revision).toBe(2);expect(task.values.time).toBe(deadline);expect(task.audit).toBeUndefined();
  expect(task.changes.find(change=>change.field==='time')).toMatchObject({before:'',after:deadline});
  await page.locator('#audit').click();await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for(const key of ['title','time','location','registration'])await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check();await page.locator('#confirm').click();await expect(page.locator('#completed')).toBeVisible();
  const waiting=page.waitForEvent('download');await page.locator('#export-html').click();const html=await readFile(await(await waiting).path(),'utf8');
  const receipt=await(await context.request.get(`/api/tasks/${id}/receipt`)).json();expect(hash(html)).toBe(receipt.audit.htmlHash);expect(html).toContain(deadline);expect(receipt.provider.requests).toBe(0);
  await page.locator('#delete').click();await expect(page.locator('#empty')).toBeVisible();expect((await context.request.get(`/api/tasks/${id}`)).status()).toBe(404);
});

test('摘录仅含当前正文可定位且长度合规的文字，防止脚本、覆盖、正文变化与到期后使用',async({page},testInfo)=>{
  await page.clock.install();
  const script='<script>window.syntheticExcerptExecuted=true</script>',oversized='x'.repeat(501);
  const original=`活动名称：合成摘录边界\n已知日期\n独立段落\n${script}\n${oversized}`;
  const quote=`已知日期\n不存在的片段\n已知日期\n${script}`;
  await createWithQuote(page,original,{title:{value:'合成摘录边界',evidence:'合成摘录边界'},time:{value:`已知日期\n${script}`,evidence:quote},
    location:{value:'不存在的场地',evidence:`${oversized}\n不存在的片段`},registration:empty()});
  await page.locator('#excerpt-time summary').click();
  await expect(page.locator('#excerpt-time .excerpt-text')).toHaveText(['已知日期',script]);
  expect(await page.locator('#excerpt-time script').count()).toBe(0);expect(await page.evaluate(()=>window.syntheticExcerptExecuted)).toBeUndefined();
  expect(await page.locator('#excerpt-location').count()).toBe(0);expect(await page.locator('#excerpt-registration').count()).toBe(0);
  const pick=page.getByRole('button',{name:'填入草稿：活动时间片段 1',exact:true});
  await page.locator('#fact-time').fill('保留我的草稿');await expect(pick).toBeDisabled();await expect(page.locator('#fact-time')).toHaveValue('保留我的草稿');
  await page.locator('#fact-time').fill('');await expect(pick).toBeEnabled();
  await page.locator('#content-editor summary').click();await page.locator('#content-original').fill('已改正文，尚未保存');await expect(pick).toBeDisabled();
  await page.locator('#content-original').fill(original);await expect(pick).toBeEnabled();
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
  const audit=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('#edit-form'));return{violations:result.violations.map(v=>v.id),incomplete:result.incomplete.map(v=>v.id)};});
  await writeFile(testInfo.outputPath('excerpt-axe.json'),JSON.stringify(audit,null,2));expect(audit.violations).toEqual([]);
  for(const width of [1440,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#excerpt-time').screenshot({path:testInfo.outputPath(`excerpt-${width}.png`)});}
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.clock.fastForward(31*60*1000);await expect(page.locator('#notice')).toContainText('资料已到期');
  expect(await page.locator('#excerpt-time').count()).toBe(0);await expect(page.locator('#original')).toBeEmpty();
});
