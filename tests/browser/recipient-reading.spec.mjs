import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const hash = value => createHash('sha256').update(value).digest('hex');

test('接收者可离线按目录和标题定位内容；修订、未知与实际导出版本保持一致', async ({ page, context, browser }) => {
  await page.goto('/#workbench');
  await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成接收者阅读检查\n活动时间：10月24日14:00—16:00\n活动地点：示例活动室\n说明：这不是实际活动。');
  await page.locator('#source-note').fill('开发者原创合成材料 <img src="https://invalid.example/source">');
  await page.locator('#permission').check();
  await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  const id = (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  const original = '完整文字唯一标记\n' + '这段合成文字用于检查较长内容的换行与目录跳转。'.repeat(90) + '\n<script>合成危险字符</script>';
  await page.locator('#content-editor summary').click();
  await page.locator('#content-original').fill(original);
  await page.locator('#content-summary').fill('概述唯一标记：请先核实日期。');
  await page.locator('#content-description').fill('图像说明唯一标记：合成文字海报。');
  await page.locator('#edit-reason').fill('对照开发者合成答案修订，不是真实用户记录');
  await page.locator('#save').click();
  await expect(page.locator('#notice')).toContainText('已保存修改');
  await page.locator('#audit').click();
  await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for (const key of ['title','time','location','registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check();
  await page.locator('#confirm').click();
  await expect(page.locator('#completed')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.locator('#export-html').click();
  const html = await readFile(await (await waiting).path(), 'utf8');
  const receipt = await (await context.request.get(`/api/tasks/${id}/receipt`)).json();
  expect(hash(html)).toBe(receipt.audit.htmlHash);
  expect(receipt.contentChanges).toHaveLength(3);
  expect(receipt.provider.requests).toBe(0);

  const readerContext = await browser.newContext({ offline:true, viewport:{width:1280,height:900} });
  try {
    const reader = await readerContext.newPage();
    const requests = [];
    reader.on('request', request => requests.push(request.url()));
    await reader.setContent(html);
    expect(await reader.locator('h1,h2').allTextContents()).toEqual([
      '海报文字版','活动信息','内容概述','图像说明','完整文字','提取时的不确定项','来源与处理说明',
    ]);
    await expect(reader.locator('#facts + dl dd').last()).toContainText('未知，请向活动方核实');
    await expect(reader.locator('#date-review')).toContainText('年份待核实');
    await expect(reader.locator('#full-text + pre')).toHaveText(original);
    expect((await reader.locator('body').textContent()).match(/概述唯一标记/g)).toHaveLength(1);
    await expect(reader.locator('script,img,iframe')).toHaveCount(0);
    const navigation = reader.getByRole('navigation', {name:'阅读目录'});
    const links = await navigation.locator('a').all();
    expect(links).toHaveLength(6);
    for (const link of links) {
      const target = await link.getAttribute('href');
      expect(target).toMatch(/^#[a-z-]+$/);
      await link.focus();
      await reader.keyboard.press('Enter');
      await expect(reader.locator(target)).toBeFocused();
    }
    await reader.addScriptTag({content:await readFile('node_modules/axe-core/axe.min.js','utf8')});
    const axe = await reader.evaluate(async () => {
      const r = await window.axe.run();
      return {violations:r.violations.map(v=>({id:v.id,impact:v.impact})),incomplete:r.incomplete.map(v=>v.id)};
    });
    expect(axe.violations).toEqual([]);
    const directory = '.local/validation/recipient-reading-20261020';
    await mkdir(directory,{recursive:true});
    await reader.getByRole('heading',{name:'海报文字版',exact:true}).scrollIntoViewIfNeeded();
    await reader.screenshot({path:`${directory}/reading-1280.png`});
    await writeFile(`${directory}/result.html`,html);
    await reader.setViewportSize({width:320,height:844});
    await reader.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const jump = navigation.getByRole('link',{name:'完整文字',exact:true});
    await jump.focus(); await reader.keyboard.press('Enter');
    await expect(reader.locator('#full-text')).toBeFocused();
    expect(await reader.locator('#full-text + pre').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(40);
    expect(requests).toEqual([]);
    await reader.screenshot({path:`${directory}/reading-320-large.png`});
    await reader.emulateMedia({media:'print'});
    await expect(navigation).toBeHidden();
    await expect(reader.locator('#facts')).toBeVisible();
    await expect(reader.locator('#full-text + pre')).toHaveText(original);
    await writeFile(`${directory}/check.json`,JSON.stringify({htmlHash:hash(html),receiptHash:receipt.audit.htmlHash,axe,requests,modelRequests:0,humanReviewed:false},null,2));
  } finally { await readerContext.close(); }
  await page.locator('#delete').click();
  await expect(page.locator('#empty')).toBeVisible();
});
