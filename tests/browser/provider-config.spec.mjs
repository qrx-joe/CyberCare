import { test, expect } from '@playwright/test';

for (const [timeoutMs, seconds] of [[90000,90],[undefined,30]]) {
  test(`识别前与等待中展示实际 ${seconds} 秒上限，兼容旧配置，无真实模型调用`, async ({ page }) => {
    await page.route('**/api/config', async route => {
      const response = await route.fetch(), config = await response.json();
      config.provider.live = true; config.provider.limit = 1;
      if (timeoutMs === undefined) delete config.provider.timeoutMs;
      else config.provider.timeoutMs = timeoutMs;
      await route.fulfill({ response, json:config });
    });
    let release, ready;
    const held = new Promise(resolve => { ready = resolve; });
    const resumed = new Promise(resolve => { release = resolve; });
    await page.route('**/api/tasks', async route => {
      ready(); await resumed;
      await route.fulfill({ status:400, json:{ message:'合成测试拦截；未发送真实模型请求。' } });
    });
    await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
    const png = await page.locator('#poster-preview').screenshot();
    await page.locator('#mode').selectOption('live');
    await expect(page.locator('#mode-help')).toContainText(`最多等待 ${seconds} 秒`);
    await page.locator('#image').setInputFiles({ name:'synthetic-config.png', mimeType:'image/png', buffer:png });
    await page.locator('#source-note').fill('原创合成配置测试'); await page.locator('#permission').check();
    await page.locator('#create').click(); await held;
    try { await expect(page.locator('#notice')).toContainText(`最多等待 ${seconds} 秒`); }
    finally { release(); }
    await expect(page.locator('#error')).toContainText('合成测试拦截');
    await expect(page.locator('#notice')).toContainText('操作未完成');
    await expect(page.locator('#create')).toBeEnabled();
  });
}

test('真实识别配置无效时说明问题，合成任务仍能继续，不创建模型请求', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch(), config = await response.json();
    config.provider.live = false; config.provider.timeoutMs = null;
    config.provider.configError = '合成测试：等待配置超出允许范围。';
    await route.fulfill({ response, json:config });
  });
  await page.goto('/#workbench'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await expect(page.locator('#error')).toContainText('真实识别配置不可用');
  await expect(page.locator('#mode option[value=live]')).toBeDisabled();
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  await expect(page.locator('#provider-label')).toContainText('外部请求 0 次');
  await page.locator('#delete').click();
});
