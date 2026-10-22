import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

test('真实上传链路的替代 Provider 回归：浏览器转换音频、服务端解码截图与补图继续', async ({ browser }) => {
  test.setTimeout(60000);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, PORT: String(port), STEPFUN_API_KEY: 'synthetic-test-only', STEPFUN_BASE_URL: 'https://api.stepfun.com/v1', STEPFUN_MODEL: 'synthetic-model', MODEL_REQUEST_LIMIT: '8' };
  delete env.STEPFUN_REASONING_EFFORT; delete env.CYBERCARE_PUBLIC_ORIGIN; delete env.CYBERCARE_BASE_PATH;
  const server = spawn(process.execPath, ['--import', new URL('../fixtures/assistance-model.mjs', import.meta.url).href, 'dist/server.js'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` });
  try {
    const deadline = Date.now() + 5000;
    while (!logs.includes('CyberCare local demo')) { expect(server.exitCode, logs).toBeNull(); expect(Date.now()).toBeLessThan(deadline); await new Promise(resolve => setTimeout(resolve, 25)); }
    const screen = await context.newPage(); await screen.setContent('<html lang="zh-CN"><body><h1>合成设置页</h1><button>显示设置</button></body></html>');
    const first = await screen.screenshot(); await screen.setContent('<html lang="zh-CN"><body><h1>显示设置</h1><button>文字大小</button></body></html>'); const second = await screen.screenshot(); await screen.close();
    const page = await context.newPage(); await page.goto('/#audio'); await expect(page.locator('#audio-status')).toContainText('可以先用');
    await page.locator('#audio-mode').selectOption('live');
    const b = Buffer.alloc(44 + 32000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
    await page.locator('#audio-file').setInputFiles({ name: 'synthetic-silence.wav', mimeType: 'audio/wav', buffer: b });
    await page.locator('#audio-source').fill('合成上传回归，模型为替代实现'); await page.locator('#audio-permission').check(); await page.locator('#audio-create').click();
    await expect(page.locator('#audio-text')).toHaveValue('明天下午两点在示例活动室开会。'); await expect(page.locator('#audio-summary')).toHaveValue('明天下午两点开会。');
    await page.locator('#nav-guide').click(); await page.locator('#guide-mode').selectOption('live');
    await page.locator('#guide-file').setInputFiles({ name: 'screen-one.png', mimeType: 'image/png', buffer: first });
    await page.locator('#guide-source').fill('开发者合成界面截图'); await page.locator('#guide-permission').check(); await page.locator('#guide-create').click();
    await expect(page.locator('#guide-next')).toContainText('显示设置');
    const id = (await page.locator('#guide-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
    await page.locator('#guide-confirmed').check(); await page.locator('#guide-review').click(); await expect(page.locator('#guide-continue')).toBeEnabled(); await page.locator('#guide-continue').click();
    await page.locator('#guide-file').setInputFiles({ name: 'screen-two.png', mimeType: 'image/png', buffer: second }); await page.locator('#guide-create').click();
    await expect(page.locator('#guide-meta')).not.toContainText(id); await expect(page.locator('#guide-next')).toContainText('显示设置');
    const current = (await page.locator('#guide-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
    const task = await (await context.request.get(`/api/assistance/${current}`)).json(); expect(task.previousId).toBe(id);
    await page.locator('#guide-delete').click(); await expect(page.locator('#guide-result')).toBeHidden();
    await expect.poll(async () => (await context.request.get(`/api/assistance/${id}`)).status()).toBe(404);
    const config = await (await context.request.get('/api/assistance/config')).json(); expect(config.requests).toBe(4);
  } finally { await context.close(); if (server.exitCode === null && server.signalCode === null) { server.kill(); await once(server, 'exit'); } }
});
