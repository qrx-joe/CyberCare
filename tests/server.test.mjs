import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, rm, rmdir, cp } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

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

test('运行版本固定在启动构建；磁盘更新、缺失或损坏均不能冒充已加载的新版本', { timeout:15000 }, async () => {
  const validation = resolve('.local/validation');
  await mkdir(validation,{recursive:true});
  const directory = await mkdtemp(resolve(validation,'runtime-build-'));
  await cp(resolve('dist'),resolve(directory,'dist'),{recursive:true,filter:path=>!path.startsWith(resolve('dist/web'))});
  const manifest = resolve(directory,'dist/build-info.json');
  const first = {sourceCommit:'a'.repeat(40),sourceDirty:false,builtAt:'2026-10-20T00:00:00.000Z',localMediaIncluded:false,applicationHash:'a'.repeat(64)};
  const sameContent = {...first,sourceCommit:'b'.repeat(40),sourceDirty:true,builtAt:'2026-10-20T00:01:00.000Z'};
  // Uncommitted application changes can retain the same commit, but change the content hash.
  const next = {...first,builtAt:'2026-10-20T00:02:00.000Z',applicationHash:'c'.repeat(64)};
  await writeFile(manifest,JSON.stringify(first));
  const reservation = createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
  const port = reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = {...process.env,PORT:String(port),MODEL_REQUEST_LIMIT:'0'};
  for (const key of Object.keys(env)) if (/^(STEPFUN_|CYBERCARE_|NODE_OPTIONS$)/.test(key)) delete env[key];
  let child;
  const start = async () => {
    child = spawn(process.execPath,[resolve(directory,'dist/server.js')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let logs = ''; child.stdout.on('data',data=>{logs+=data;}); child.stderr.on('data',data=>{logs+=data;});
    const until = Date.now()+5000;
    while (!logs.includes('CyberCare local demo')) {
      assert.equal(child.exitCode,null,logs); assert.ok(Date.now()<until,logs);
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  };
  const stop = async () => {
    if (child && child.exitCode===null && child.signalCode===null) { const ended=once(child,'exit'); child.kill(); await ended; }
  };
  const health = async () => {
    const response = await fetch(`${origin}/api/health`);
    assert.equal(response.status,200);
    return response.json();
  };
  try {
    await start();
    assert.deepEqual((await health()).build,first);
    await writeFile(manifest,JSON.stringify(sameContent));
    const metadataOnly = await health();
    assert.deepEqual(metadataOnly.build,first); assert.deepEqual(metadataOnly.availableBuild,sameContent);
    assert.equal(metadataOnly.restartRequired,false);
    await writeFile(manifest,JSON.stringify(next));
    const changed = await health();
    assert.deepEqual(changed.build,first);
    assert.deepEqual(changed.availableBuild,next);
    assert.equal(changed.restartRequired,true);
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.deepEqual(config.runtime,changed);
    assert.equal(config.provider.requests,0);
    const {applicationHash,...legacy}=first;
    await writeFile(manifest,JSON.stringify(legacy)); assert.equal((await health()).restartRequired,null);
    await writeFile(manifest,JSON.stringify({...first,applicationHash:'invalid'})); assert.equal((await health()).restartRequired,null);
    await writeFile(manifest,'{"secret":"must-not-be-returned"}');
    const invalid = await health();
    assert.deepEqual(invalid.build,first); assert.equal(invalid.availableBuild,null); assert.equal(invalid.restartRequired,null);
    assert.ok(!JSON.stringify(invalid).includes('must-not-be-returned'));
    await rm(manifest);
    assert.equal((await health()).restartRequired,null);
    await writeFile(manifest,JSON.stringify(next));
    await stop(); await start();
    const restarted = await health();
    assert.deepEqual(restarted.build,next); assert.equal(restarted.restartRequired,false);
    await stop(); await rm(manifest); await start();
    const unknown = await health();
    assert.equal(unknown.build,null); assert.equal(unknown.restartRequired,null);
    assert.equal((await fetch(`${origin}/api/config`)).status,200);
  } finally {
    await stop();
    assert.ok(directory.startsWith(validation+sep));
    await rm(directory,{recursive:true,force:true});
  }
});
