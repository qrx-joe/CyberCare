import {test,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {hash} from '../../dist/domain.js';
const original='活动名称：合成正文对照核验\n活动时间：2026年10月24日14:00\n活动地点：示例活动室二楼';
const directory='.local/validation/field-body-review-20261020/browser';
async function prepare(page){
 await page.goto('/#workbench');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
 await page.locator('#mode').selectOption('manual');await page.locator('#transcript').fill(original);await page.locator('#source-note').fill('开发者原创合成材料，非真实活动或用户验证');
 await page.locator('#permission').check();await page.locator('#create').click();await expect(page.locator('#draft')).toBeVisible();
 return(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
}
async function saveLocation(page,value,reason){
 await page.locator('#fact-location').fill(value);await page.locator('#edit-reason').fill(reason);await page.locator('#save').click();
 await expect(page.locator('#notice')).toContainText('已保存修改');
}
async function download(page,context,id,name){
 await page.locator('#audit').click();await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
 for(const key of ['title','time','location','registration'])await page.locator(`#checked-${key}`).check();
 await page.locator('#confirm-content').check();await page.locator('#confirm').click();await expect(page.locator('#completed')).toBeVisible();
 const receipt=await(await context.request.get(`/api/tasks/${id}/receipt`)).json();const files={};
 for(const kind of ['html','text']){const waiting=page.waitForEvent('download');await page.locator(`#export-${kind}`).click();files[kind]=await readFile(await(await waiting).path(),'utf8');}
 expect(hash(files.html)).toBe(receipt.audit.htmlHash);
 await mkdir(`${directory}/${name}`,{recursive:true});await writeFile(`${directory}/${name}/receipt.json`,JSON.stringify(receipt,null,2));
 await writeFile(`${directory}/${name}/result.html`,files.html);await writeFile(`${directory}/${name}/result.txt`,files.text);
 return{receipt,files};
}

test('定向对照显示当前值、旧正文与依据，可保留差异并带入同版本实际下载',async({page,context})=>{
 const id=await prepare(page);await saveLocation(page,'示例活动室一楼','合成答案改为一楼，保留原转录供核对');
 await expect(page.locator('#body-review')).toBeVisible({timeout:1000});
 for(const value of ['示例活动室一楼','示例活动室二楼','合成答案改为一楼'])await expect(page.locator('#body-review-list')).toContainText(value);
 await page.locator('#review-body').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#content-original')).toBeFocused();await expect(page.locator('#content-original')).toHaveValue(original);
 const {receipt,files}=await download(page,context,id,'retained');
 expect(receipt.bodyReview).toHaveLength(1);expect(receipt.extraction.original).toBe(original);expect(receipt.reviewedContent.original).toBe(original);
 for(const file of Object.values(files))for(const value of ['字段修订与正文对照','示例活动室一楼','示例活动室二楼','合成答案改为一楼'])expect(file).toContain(value);
 const reader=await context.newPage();await reader.setContent(files.html);await expect(reader.locator('#field-body-review-title')).toBeVisible();await reader.close();
 await page.locator('#delete').click();await expect(page.locator('#body-review-list')).toBeEmpty();expect((await context.request.get(`/api/tasks/${id}`)).status()).toBe(404);
});

test('正文修正移除提示；主动清空保留未知，草稿门禁、窄屏和到期清理继续有效',async({page,context})=>{
 await page.clock.install();const id=await prepare(page);await saveLocation(page,'示例活动室一楼','合成地点更正');
 await page.locator('#review-body').click();await page.locator('#content-original').fill(original.replace('二楼','一楼'));
 await expect(page.locator('#body-review')).toBeHidden();await expect(page.locator('#audit')).toBeDisabled();
 await page.locator('#edit-reason').fill('同步合成正文为一楼');await page.locator('#save').click();await expect(page.locator('#notice')).toContainText('已保存修改');
 await expect(page.locator('#body-review')).toBeHidden();expect((await(await context.request.get(`/api/tasks/${id}`)).json()).bodyReview).toBeUndefined();
 await saveLocation(page,'','合成场地暂不可核实，保留正文作为转录');
 await expect(page.locator('#body-review')).toBeVisible();await expect(page.locator('#body-review-list')).toContainText('未知');
 await expect(page.locator('#fact-location')).toHaveValue('');expect((await(await context.request.get(`/api/tasks/${id}`)).json()).bodyReview[0].kind).toBe('unknown-retained');
 await mkdir(directory,{recursive:true});
 for(const width of [1440,320]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#body-review').scrollIntoViewIfNeeded();await page.screenshot({path:`${directory}/review-${width}.png`});}
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>{document.documentElement.style.fontSize='';});await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
 expect(await page.evaluate(async()=>(await window.axe.run()).violations.map(item=>item.id))).toEqual([]);
 const {receipt,files}=await download(page,context,id,'unknown');expect(receipt.values.location).toBe('');expect(files.text).toContain('当前保留未知');expect(files.html).toContain('示例活动室一楼');
 await page.clock.fastForward(31*60*1000);await expect(page.locator('#notice')).toContainText('资料已到期');await expect(page.locator('#body-review-list')).toBeEmpty();await expect(page.locator('#body-review')).toBeHidden();
 // The browser clock does not advance the server: explicitly remove the actual task.
 expect((await context.request.delete(`/api/tasks/${id}`,{headers:{'X-CyberCare':'1'}})).status()).toBe(200);
});

test('旧服务未声明对照能力时隐藏新控件，编辑协议保持原样',async({page})=>{
 await page.route('**/api/config',async route=>{const response=await route.fetch(),config=await response.json();delete config.fieldBodyReview;await route.fulfill({response,json:config});});
 await prepare(page);const saving=page.waitForRequest(request=>request.url().endsWith('/edit'));
 await saveLocation(page,'示例活动室一楼','合成旧服务兼容检查');expect((await saving).postDataJSON().bodyReview).toBeUndefined();
 await expect(page.locator('#body-review')).toBeHidden();await page.locator('#delete').click();
});
