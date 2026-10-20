import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {fromTranscript,normalizeExtraction,hash} from '../../dist/domain.js';
async function prepare(page,original,timeReferences){
 const extraction=normalizeExtraction({...fromTranscript(original),timeReferences});
 // Provider-shaped synthetic UI data; actual server task/save/audit/export is
 // manual, so this never spends model requests or claims model accuracy.
 await page.route(/\/api\/tasks(?:\/[a-f0-9-]{36}(?:\/(?:audit|edit))?)?$/,async route=>{
  if(!['GET','POST'].includes(route.request().method()))return route.continue();
  const response=await route.fetch(),task=await response.json();
  await route.fulfill({response,json:task.extraction?{...task,extraction}:task});
 });
 await page.goto('/');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
 await page.locator('#mode').selectOption('manual');await page.locator('#transcript').fill(original);
 await page.locator('#source-note').fill('开发者原创合成时间条目；UI 提取响应为夹具，后端为真实人工任务');
 await page.locator('#permission').check();await page.locator('#create').click();await expect(page.locator('#draft')).toBeVisible();
 return(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
}

test('分散时间须选择与分类后写入；保存重测后正文与下载区分活动日期及截止',async({page,context},testInfo)=>{
 const date='10月24日',deadline='2026年10月20日 23:59';
 const original=`活动名称：合成时间用途核对\n活动日期：${date}\n说明段落不属于时间\n提交截止：${deadline}`;
 const id=await prepare(page,original,[{kind:'event',value:date,evidence:`活动日期：${date}`},{kind:'unknown',value:deadline,evidence:`提交截止：${deadline}`}]);
 await expect(page.locator('#time-picker')).toBeVisible({timeout:3000});
 await expect(page.locator('#fact-time')).toHaveValue('');await page.locator('#time-picker summary').click();
 await expect(page.locator('#time-ref-0')).not.toBeChecked();await expect(page.locator('#time-ref-1')).not.toBeChecked();await expect(page.locator('#apply-time-references')).toBeDisabled();
 await page.locator('#audit').click();await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
 for(const field of ['title','time','location','registration'])await page.locator(`#checked-${field}`).check();
 await page.locator('#confirm-content').check();await expect(page.locator('#confirm')).toBeEnabled();
 await page.locator('#time-picker summary').click();await page.locator('#time-ref-0').check();await page.locator('#time-ref-1').check();
 await page.locator('#time-role-1').selectOption('submission-deadline');
 await expect(page.locator('#audit')).toBeDisabled();await expect(page.locator('#confirm')).toBeDisabled();await expect(page.locator('#save')).toBeDisabled();
 const composed=`活动日期/时段：${date}\n提交截止：${deadline}`;
 await expect(page.locator('#time-composition-preview')).toHaveText(composed);
 const writes=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/tasks')&&request.method()!=='GET')writes.push(request.method());});
 await page.locator('#apply-time-references').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#fact-time')).toHaveValue(composed);await expect(page.locator('#fact-time')).toBeFocused();
 await expect(page.locator('#guidance-time')).toContainText('年份',{timeout:3000});
 await expect(page.locator('#time-ref-0')).not.toBeChecked();await expect(page.locator('#notice')).toContainText('尚未保存');expect(writes).toEqual([]);
 let task=await(await context.request.get(`/api/tasks/${id}`)).json();expect(task.revision).toBe(1);expect(task.values.time).toBe('');
 await page.locator('#save').click();await expect(page.locator('#error')).toContainText('修改依据');expect(writes).toEqual([]);
 await page.locator('#edit-reason').fill('对照合成原文区分活动日期和提交截止，不把截止当开始时间');await page.locator('#save').click();
 await expect(page.locator('#notice')).toContainText('已保存修改');task=await(await context.request.get(`/api/tasks/${id}`)).json();expect(task.revision).toBe(2);expect(task.values.time).toBe(composed);expect(task.audit).toBeUndefined();
 expect(task.changes.find(change=>change.field==='time')).toMatchObject({before:'',after:composed});
 await page.locator('#audit').click();await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
 for(const field of ['title','time','location','registration'])await page.locator(`#checked-${field}`).check();
 await page.locator('#confirm-content').check();await page.locator('#confirm').click();await expect(page.locator('#completed')).toBeVisible();
 const waiting=page.waitForEvent('download');await page.locator('#export-html').click();const html=await readFile(await(await waiting).path(),'utf8');
 const receipt=await(await context.request.get(`/api/tasks/${id}/receipt`)).json();expect(hash(html)).toBe(receipt.audit.htmlHash);expect(html).toContain(composed);expect(html).toContain('年份待核实');expect(receipt.provider.requests).toBe(0);
 expect((await(await context.request.get(`/api/tasks/${id}/text`)).text())).toContain(composed);
 const reader=await context.newPage();await reader.setViewportSize({width:1280,height:1000});await reader.setContent(html);
 expect(await reader.locator('dd').nth(1).evaluate(node=>{const text=node.firstChild,index=text.textContent.indexOf('提交截止');const first=document.createRange(),second=document.createRange();first.setStart(text,0);first.setEnd(text,2);second.setStart(text,index);second.setEnd(text,index+2);return second.getBoundingClientRect().top>first.getBoundingClientRect().top;})).toBe(true);
 await reader.locator('#facts').locator('..').screenshot({path:testInfo.outputPath('time-reading-1280.png')});
 await reader.setViewportSize({width:320,height:1000});expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await reader.locator('#facts').locator('..').screenshot({path:testInfo.outputPath('time-reading-320.png')});await reader.close();
 await page.locator('#delete').click();await expect(page.locator('#empty')).toBeVisible();expect((await context.request.get(`/api/tasks/${id}`)).status()).toBe(404);
});

test('用途待核实、正文变化、既有值、500字限制和到期均不触发自动改写',async({page},testInfo)=>{
 await page.clock.install();const long='x'.repeat(499),original=`活动名称：合成时间边界\n今天 14:00\n${long}`;
 await prepare(page,original,[{kind:'unknown',value:'今天 14:00',evidence:'今天 14:00'},{kind:'event',value:long,evidence:long}]);
 await page.locator('#time-picker summary').click();await expect(page.locator('#time-role-0')).toHaveValue('unknown');
 await page.locator('#fact-time').fill('保留我的时间草稿');await page.locator('#time-ref-0').check();await expect(page.locator('#apply-time-references')).toBeDisabled();await expect(page.locator('#fact-time')).toHaveValue('保留我的时间草稿');
 await page.locator('#fact-time').fill('');await expect(page.locator('#apply-time-references')).toBeEnabled();
 await page.locator('#content-editor summary').click();await page.locator('#content-original').fill('正文修改尚未保存');await expect(page.locator('#apply-time-references')).toBeDisabled();
 await page.locator('#time-ref-0').uncheck();await expect(page.locator('#save')).toBeEnabled();await expect(page.locator('#time-ref-0')).toBeDisabled();
 await page.locator('#content-original').fill(original);await page.locator('#time-ref-1').check();await expect(page.locator('#apply-time-references')).toBeDisabled();await expect(page.locator('#time-picker-status')).toContainText('500');await expect(page.locator('#fact-time')).toHaveValue('');
 await page.locator('#time-ref-1').uncheck();await page.locator('#time-ref-0').check();await page.locator('#apply-time-references').click();await expect(page.locator('#fact-time')).toHaveValue('用途待核实：今天 14:00');
 await expect(page.locator('#guidance-time')).toContainText('相对日期');
 await page.locator('#fact-time').fill('');await page.locator('#content-original').fill('活动名称：合成时间边界\n今天 14:00');
 await page.locator('#edit-reason').fill('删除无关的合成长字串，时间建议须按当前正文核对');await page.locator('#save').click();await expect(page.locator('#notice')).toContainText('已保存修改');
 await page.locator('#time-picker summary').click();await expect(page.locator('#time-ref-0')).toBeEnabled();await expect(page.locator('#time-ref-1')).toBeDisabled();
 await expect(page.locator('#time-ref-state-1')).toContainText('当前正文');
 await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
 const audit=await page.evaluate(async()=>{const r=await window.axe.run(document.querySelector('#time-picker'));return{violations:r.violations.map(v=>v.id),incomplete:r.incomplete.map(v=>v.id)};});
 await writeFile(testInfo.outputPath('time-picker-axe.json'),JSON.stringify(audit,null,2));expect(audit.violations).toEqual([]);
 for(const width of [1440,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#time-picker').screenshot({path:testInfo.outputPath(`time-picker-${width}.png`)});}
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.clock.fastForward(31*60*1000);await expect(page.locator('#notice')).toContainText('资料已到期');expect(await page.locator('#time-picker').count()).toBe(0);await expect(page.locator('#original')).toBeEmpty();
});
