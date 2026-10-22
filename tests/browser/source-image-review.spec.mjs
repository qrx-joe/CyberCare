import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const directory='.local/validation/source-image-review-20261020/browser';
async function upload(page){
 await page.goto('/#workbench');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
 const png=await page.locator('#poster-preview').screenshot();
 await page.locator('#mode').selectOption('manual');
 await expect(page.locator('#source-image-review')).toBeHidden();
 await page.locator('#image').setInputFiles({name:'synthetic-source.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('#image-zoom-in')).toBeVisible();
 return png;
}

test('原图可键盘放大移动并复位，从核对内容返回且不改未保存草稿',async({page,context})=>{
 await page.goto('/#workbench');
 await expect(page.locator('#image-zoom-in')).toHaveCount(1,{timeout:1000});
 await upload(page);
 await page.locator('#transcript').fill('活动名称：合成原图核对\n活动时间：2026年10月24日14:00\n活动地点：示例活动室\n报名方式：现场登记');
 await page.locator('#source-note').fill('开发者原创合成核对，非真实活动 / 模型输出');
 await page.locator('#permission').check();await page.locator('#create').click();await expect(page.locator('#draft')).toBeVisible();
 const id=(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
 await page.locator('#fact-location').fill('尚未保存的合成修订');
 const mutations=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/tasks')&&r.method()!=='GET')mutations.push(r.method());});
 await page.locator('#uncertainties').locator('..').locator('summary').click();
 await page.locator('#review-image').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#poster-viewport')).toBeFocused();
 await expect(page.locator('#image-zoom-status')).toContainText('2 倍');
 await page.keyboard.press('ArrowDown');
 await expect.poll(()=>page.locator('#poster-viewport').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 for(let n=0;n<2;n++)await page.locator('#image-zoom-in').click();
 await expect(page.locator('#image-zoom-status')).toContainText('8 倍');await expect(page.locator('#image-zoom-in')).toBeDisabled();
 await page.locator('#image-zoom-fit').click();await expect(page.locator('#image-zoom-status')).toContainText('适合预览框');
 await expect(page.locator('#image-zoom-out')).toBeDisabled();
 expect(await page.locator('#poster-viewport').evaluate(node=>({left:node.scrollLeft,top:node.scrollTop}))).toEqual({left:0,top:0});
 await expect(page.locator('#fact-location')).toHaveValue('尚未保存的合成修订');await expect(page.locator('#audit')).toBeDisabled();
 const task=await(await context.request.get(`/api/tasks/${id}`)).json();expect(task.revision).toBe(1);expect(task.values.location).toBe('示例活动室');expect(task.provider.requests).toBe(0);expect(mutations).toEqual([]);
 await page.locator('#delete').click();await expect(page.locator('#review-image')).toBeHidden();
 expect(await page.locator('#poster-preview').getAttribute('src')).not.toMatch(/^blob:/);
 await expect(page.locator('#image-zoom-status')).toContainText('适合预览框');
});

test('原图放大只在局部滚动，320px 与 200% 文字下按钮和键盘区域可用',async({page})=>{
 await upload(page);await page.setViewportSize({width:320,height:900});
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
 await page.locator('#image-zoom-in').click();await page.locator('#image-zoom-in').click();
 await expect(page.locator('#image-zoom-status')).toContainText('4 倍');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const size=await page.locator('#poster-viewport').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));expect(size.scroll).toBeGreaterThan(size.width);
 await page.locator('#poster-viewport').focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>page.locator('#poster-viewport').evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
 await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
 const axe=await page.evaluate(async()=>{const r=await window.axe.run();return{violations:r.violations.map(v=>v.id),incomplete:r.incomplete.map(v=>v.id)};});
 expect(axe.violations).toEqual([]);await mkdir(directory,{recursive:true});
 await page.locator('#source-image-review').screenshot({path:`${directory}/viewer-320-large.png`});await writeFile(`${directory}/axe.json`,JSON.stringify(axe,null,2));
 await page.locator('#image-zoom-fit').click();expect(await page.locator('#poster-viewport').evaluate(node=>node.scrollLeft)).toBe(0);
});

test('替换、无效文件及加载失败清除旧查看状态，临近到期放大不延长图片留存',async({page})=>{
 await page.clock.install();const png=await upload(page);
 await page.locator('#image-zoom-in').click();const first=await page.locator('#poster-preview').getAttribute('src');
 await page.locator('#image').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('#image-zoom-status')).toContainText('适合预览框');
 expect(await page.locator('#poster-preview').getAttribute('src')).not.toBe(first);
 expect(await page.evaluate(async url=>{try{await fetch(url);return true;}catch{return false;}},first)).toBe(false);
 await page.locator('#image').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic invalid file')});
 await expect(page.locator('#image-zoom-controls')).toBeHidden();expect(await page.locator('#poster-preview').getAttribute('src')).toBeNull();
 await page.locator('#image').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('synthetic invalid PNG bytes')});
 await expect(page.locator('#image-review-error')).toBeVisible();await expect(page.locator('#image-zoom-controls')).toBeHidden();await expect(page.locator('#poster-viewport')).toBeHidden();
 await page.locator('#image').setInputFiles({name:'recovered.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('#image-review-error')).toBeHidden();await expect(page.locator('#image-zoom-in')).toBeVisible();
 await page.clock.fastForward(29*60*1000);await page.locator('#image-zoom-in').click();
 await expect(page.locator('#image-zoom-status')).toContainText('2 倍');await page.clock.fastForward(2*60*1000);
 await expect(page.locator('#notice')).toContainText('资料已到期');
 expect(await page.locator('#poster-preview').getAttribute('src')).not.toMatch(/^blob:/);expect(await page.locator('#image').evaluate(input=>input.files.length)).toBe(0);
 await expect(page.locator('#image-zoom-status')).toContainText('适合预览框');await expect(page.locator('#image-review-error')).toBeHidden();
});
