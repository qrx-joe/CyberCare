import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('旧会话创建的新任务保留完整有效期，任务自身仍按 30 分钟到期', { timeout: 15000 }, async () => {
  await mkdir('.local/validation', { recursive: true });
  const directory = await mkdtemp(resolve('.local/validation/session-regression-'));
  const clock = resolve(directory, 'clock.txt'); await writeFile(clock, '0');
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), MODEL_REQUEST_LIMIT: '0', CYBERCARE_TEST_CLOCK: clock };
  for (const key of Object.keys(env)) if (/^(STEPFUN_|NODE_OPTIONS$)/.test(key)) delete env[key];
  const processUnderTest = spawn(process.execPath, ['--import', new URL('./fixtures/server-clock.mjs', import.meta.url).href, 'dist/server.js'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; processUnderTest.stdout.on('data', data => { logs += data; }); processUnderTest.stderr.on('data', data => { logs += data; });
  try {
    const until = Date.now() + 5000;
    while (!logs.includes('CyberCare local demo')) {
      assert.equal(processUnderTest.exitCode, null, logs);
      assert.ok(Date.now() < until, logs);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const config = await fetch(`${origin}/api/config`);
    const cookie = config.headers.get('set-cookie').split(';')[0];
    await writeFile(clock, String(25 * 60 * 1000));
    const response = await fetch(`${origin}/api/tasks`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CyberCare': '1', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ mode: 'sample', permission: true, sourceNote: '合成会话续期回归' }) });
    assert.equal(response.status, 202); assert.match(response.headers.get('set-cookie'), /Max-Age=1800/);
    const task = await response.json();
    await writeFile(clock, String(31 * 60 * 1000));
    const stillActive = await fetch(`${origin}/api/tasks/${task.id}`, { headers: { Cookie: cookie } });
    assert.equal(stillActive.status, 200);
    assert.equal((await stillActive.json()).status, 'needs_review');
    await writeFile(clock, String(56 * 60 * 1000));
    const expired = await fetch(`${origin}/api/tasks/${task.id}`, { headers: { Cookie: cookie } });
    assert.equal(expired.status, 404);
    assert.equal((await expired.json()).code, 'TASK_NOT_FOUND');
  } finally {
    if (processUnderTest.exitCode === null && processUnderTest.signalCode === null) { processUnderTest.kill(); await once(processUnderTest, 'exit'); }
    await rm(clock, { force: true }); await rmdir(directory);
  }
});
