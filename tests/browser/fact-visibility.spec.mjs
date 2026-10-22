import {test,expect} from '@playwright/test';

test('长字段无需内部滚动即可完整核对，输入、保存、窄屏与放大后仍可见',async({page,context})=>{
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
 await page.locator('#permission').check(); await page.locator('#create').click();
 await expect(page.locator('#draft')).toBeVisible();
 const values={title:'开发者原创的长字段可见性合成演示，不是真实活动或真实模型输出',
  time:'2026 年 10 月 24 日\n上午 09:30 签到\n10:00—12:00 活动\n12:00 结束',
  location:'Synthetic Community Center\nNorth Entrance\nHall B, Floor 4\nRoom 405\nUse the marked public entrance',registration:''};
 const expectVisible=async()=>{
  for(const key of Object.keys(values)){
   await expect(page.locator(`#fact-${key}`)).toHaveValue(values[key]);
   await expect.poll(()=>page.locator(`#fact-${key}`).evaluate(input=>input.scrollHeight<=input.clientHeight+1),{message:`${key} 的完整内容不应被字段内部截断`}).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 };
 for(const [key,value] of Object.entries(values))await page.locator(`#fact-${key}`).fill(value);
 await expectVisible();
 await page.locator('#edit-reason').fill('原创合成文字，仅验证完整显示与保存，不验证真实活动');
 await page.locator('#save').click(); await expect(page.locator('#notice')).toContainText('已保存修改');
 await expectVisible();
 const id=(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
 const before=await(await context.request.get(`/api/tasks/${id}`)).json();
 await page.setViewportSize({width:320,height:900}); await expectVisible();
 await page.locator('#large').click(); await expectVisible();
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';}); await expectVisible();
 await page.setViewportSize({width:1440,height:1000}); await expectVisible();
 const after=await(await context.request.get(`/api/tasks/${id}`)).json();
 expect(after.values).toEqual(before.values); expect(after.revision).toBe(before.revision);
 expect(after.changes).toEqual(before.changes); expect(errors).toEqual([]);
 await page.locator('#delete').click();
});
