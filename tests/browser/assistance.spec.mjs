import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const ready = async page => { await page.goto('/'); await expect(page.locator('#audio-status')).toContainText('可以先用'); };
test('语音合成与人工流程：校对、确认、修订失效、真实下载和会话隔离', async ({ page, context }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); await page.locator('#nav-audio').click();
  await expect(page).toHaveTitle('语音转写 · 赛博公益');
  await page.locator('#audio-permission').check(); await page.locator('#audio-create').click();
  await expect(page.locator('#audio-result')).toBeVisible();
  await expect(page.locator('#audio-label')).toContainText('模型请求 0');
  const id = (await page.locator('#audio-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  expect((await context.request.get(`/api/assistance/${id}/text`)).status()).toBe(409);
  await page.locator('#audio-confirmed').check(); await page.locator('#audio-review').click();
  await expect(page.locator('#audio-text-export')).toBeEnabled();
  await page.locator('#audio-text').fill('已回听核实：示例活动改为周六。');
  await expect(page.locator('#audio-text-export')).toBeDisabled();
  await page.locator('#audio-save').click(); await expect(page.locator('#audio-status')).toContainText('修改依据');
  await page.locator('#audio-reason').fill('合成修订测试，非真实事实'); await page.locator('#audio-save').click();
  await expect(page.locator('#audio-meta')).toContainText('版本 2');
  expect((await context.request.get(`/api/assistance/${id}/receipt`)).status()).toBe(409);
  await page.locator('#audio-confirmed').check(); await page.locator('#audio-review').click();
  const download = page.waitForEvent('download'); await page.locator('#audio-text-export').click();
  const bytes = await readFile(await (await download).path(), 'utf8'); expect(bytes).toContain('已回听核实'); expect(bytes).toContain('非 WCAG');
  const other = await context.browser().newContext(); expect((await other.request.get(`http://127.0.0.1:4311/api/assistance/${id}`)).status()).toBe(404); await other.close();
  await page.locator('#audio-delete').click(); await expect(page.locator('#audio-result')).toBeHidden();
  expect((await context.request.get(`/api/assistance/${id}`)).status()).toBe(404);
  await page.locator('#audio-mode').selectOption('manual'); await page.locator('#audio-manual').fill('<script>不执行</script>\n人工文字。'); await page.locator('#audio-source').fill('开发者合成文字');
  await page.locator('#audio-permission').check(); await page.locator('#audio-create').click(); await expect(page.locator('#audio-label')).toContainText('人工输入');
  await expect(page.locator('#audio-text')).toHaveValue(/<script>/); expect(errors).toEqual([]);
});

test('截图单步示例、确认和导航保留；删除不影响海报流程', async ({ page }) => {
  await ready(page); await page.locator('#nav-guide').click();
  await page.locator('#guide-permission').check(); await page.locator('#guide-create').click();
  await expect(page.locator('#guide-next')).toContainText('显示设置');
  await expect(page.locator('#guide-continue')).toBeDisabled();
  await page.locator('#guide-confirmed').check(); await page.locator('#guide-review').click();
  await expect(page.locator('#guide-continue')).toBeEnabled();
  await page.locator('#nav-home').click(); await page.goBack();
  await expect(page.locator('#guide-next')).toContainText('显示设置');
  await page.locator('#guide-delete').click(); await expect(page.locator('#guide-screen')).toBeEmpty();
  await page.locator('#nav-task').click(); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check(); await page.locator('#create').click(); await expect(page.locator('#draft')).toBeVisible();
});

test('新入口在 320px、200% 字号下可读，axe 检查与到期清理', async ({ page }) => {
  await page.clock.install(); await ready(page);
  await mkdir('.local/validation/multimodal-20261022', { recursive: true });
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js', 'utf8'));
  for (const kind of ['audio', 'guide']) {
    await page.locator(`#nav-${kind}`).click();
    await page.locator(`#${kind}-permission`).check(); await page.locator(`#${kind}-create`).click();
    await expect(page.locator(`#${kind}-result`)).toBeVisible();
    await page.setViewportSize({ width: 320, height: 900 }); await page.locator('html').evaluate(el => { el.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const audit = await page.evaluate(async () => (await window.axe.run()).violations.map(item => ({ id: item.id, nodes: item.nodes.map(n => n.target) })));
    expect(audit).toEqual([]);
    await page.screenshot({ path: `.local/validation/multimodal-20261022/${kind}-320.png`, fullPage: true });
    await page.locator('html').evaluate(el => { el.style.fontSize = ''; });
  }
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator('#guide-status')).toContainText('到期'); await expect(page.locator('#guide-screen')).toBeEmpty();
  await page.locator('#nav-audio').click(); await expect(page.locator('#audio-text')).toHaveValue(''); await expect(page.locator('#audio-original')).toBeEmpty();
});
