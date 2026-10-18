import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

test('源码包在其他 Git 仓库内构建时，不借用外层提交作为自身版本', async () => {
  const validation = resolve('.local/validation');
  await mkdir(validation, { recursive:true });
  const directory = await mkdtemp(resolve(validation, 'build-metadata-'));
  try {
    await mkdir(resolve(directory, 'src/web'), { recursive:true });
    await mkdir(resolve(directory, 'dist/web'), { recursive:true });
    for (const [name, content] of Object.entries({ 'index.html':'<!doctype html><title>合成构建测试</title>', 'style.css':'', 'poster.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>' })) {
      await writeFile(resolve(directory, 'src/web', name), content);
    }
    await writeFile(resolve(directory, 'dist/web/host.js'), 'const atlas = "__CYBERCARE_AVATAR_ATLAS__";');
    const child = spawnSync(process.execPath, [resolve('scripts/build.mjs')], { cwd:directory, env:{ ...process.env, CYBERCARE_INCLUDE_LOCAL_MEDIA:'0' }, encoding:'utf8', windowsHide:true });
    assert.equal(child.status, 0, child.stderr);
    const build = JSON.parse(await readFile(resolve(directory, 'dist/build-info.json'), 'utf8'));
    assert.equal(build.sourceCommit, null);
    assert.equal(build.sourceDirty, null);
    assert.equal(build.localMediaIncluded, false);
  } finally {
    assert.ok(directory.startsWith(validation + sep));
    await rm(directory, { recursive:true, force:true });
  }
});
