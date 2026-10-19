import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('新启动服务的运行构建与磁盘一致，日常流程不显示更新提醒', async ({page,context}) => {
  await page.goto('/');
  await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await expect(page.locator('#runtime-warning')).toBeHidden();
  const config = await (await context.request.get('/api/config')).json();
  expect(config.runtime.restartRequired).toBe(false);
  expect(config.runtime.build).toEqual(config.runtime.availableBuild);
  expect(config.provider.requests).toBe(0);
});

test('构建差异与检查失败分别说明；重新核对不清空草稿或自动重启', async ({page}) => {
  const taskRequests = [];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/tasks'))taskRequests.push(request.method());});
  await page.route('**/api/config',async route=>{
    const response = await route.fetch(), config = await response.json();
    config.runtime.restartRequired = true; // Synthetic mismatch; no actual shared build mutation.
    await route.fulfill({response,json:config});
  });
  let healthy = false;
  await page.route('**/api/health',route=>route.fulfill({status:healthy?200:503,contentType:'application/json',body:JSON.stringify(healthy?{restartRequired:false}:{message:'synthetic unavailable'})}));
  await page.goto('/');
  await expect(page.locator('#runtime-title')).toContainText('有更新待加载');
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：未提交的合成草稿');
  await page.locator('#source-note').fill('开发者合成输入，不得因版本检查丢失');
  await page.locator('#runtime-warning summary').click();
  await expect(page.locator('#runtime-warning')).toContainText('重启会清空');
  await page.locator('#check-runtime').click();
  await expect(page.locator('#runtime-title')).toContainText('尚未核对');
  await expect(page.locator('#runtime-message')).not.toContainText('仍使用启动时的版本');
  await page.setViewportSize({width:320,height:900});
  await page.locator('#large').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
  const axe = await page.evaluate(async()=>{
    const r=await window.axe.run();
    return {violations:r.violations.map(v=>({id:v.id,impact:v.impact})),incomplete:r.incomplete.map(v=>v.id)};
  });
  expect(axe.violations).toEqual([]);
  const directory='.local/validation/runtime-build-20261020';
  await mkdir(directory,{recursive:true});
  await page.locator('#runtime-warning').screenshot({path:`${directory}/warning-320-large.png`});
  await writeFile(`${directory}/warning-axe.json`,JSON.stringify(axe,null,2));
  healthy=true;
  await page.locator('#check-runtime').click();
  await expect(page.locator('#runtime-warning')).toBeHidden();
  await expect(page.locator('#transcript')).toHaveValue('活动名称：未提交的合成草稿');
  await expect(page.locator('#source-note')).toHaveValue('开发者合成输入，不得因版本检查丢失');
  expect(taskRequests).toEqual([]);
});

test('旧服务不提供版本能力时保留未知，不冒报新版已经加载', async ({page}) => {
  await page.route('**/api/config',async route=>{
    const response=await route.fetch(),config=await response.json(); delete config.runtime;
    await route.fulfill({response,json:config});
  });
  await page.goto('/');
  await expect(page.locator('#runtime-warning')).toBeVisible();
  await expect(page.locator('#runtime-title')).toContainText('尚未核对');
  await expect(page.locator('#runtime-message')).toContainText('暂不能确认');
  await expect(page.locator('#mode')).toBeEnabled();
});
