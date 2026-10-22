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
    for (const [name, content] of Object.entries({ 'index.html':'<!doctype html><title>合成构建测试</title>', 'style.css':'', 'poster.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>', 'human-patch-primary.svg':'<svg xmlns="http://www.w3.org/2000/svg"><title>合成标识</title></svg>', 'avatar-stage.html':'<!doctype html><title>合成讲解测试</title>' })) {
      await writeFile(resolve(directory, 'src/web', name), content);
    }
    await writeFile(resolve(directory, 'dist/web/host.js'), 'const atlas = "__CYBERCARE_AVATAR_ATLAS__"; const kowtow = "__CYBERCARE_KOWTOW_ATLAS__";');
    await writeFile(resolve(directory, 'dist/web/app.js'), 'const example = "__CYBERCARE_READONLY_EXAMPLE__";');
    await writeFile(resolve(directory, 'package.json'), '{"name":"synthetic-build"}');
    await writeFile(resolve(directory, 'package-lock.json'), '{"lockfileVersion":3}');
    await mkdir(resolve(directory, '.local/examples'), { recursive:true });
    await mkdir(resolve(directory, '.local/avatar'), { recursive:true });
    await writeFile(resolve(directory, '.local/avatar/character-kowtow-v1.png'), 'synthetic local-only kowtow bytes');
    await writeFile(resolve(directory, '.local/examples/poster-comparison.json'), 'invalid disabled local data');
    const child = spawnSync(process.execPath, [resolve('scripts/build.mjs')], { cwd:directory, env:{ ...process.env, CYBERCARE_INCLUDE_LOCAL_MEDIA:'0' }, encoding:'utf8', windowsHide:true });
    assert.equal(child.status, 0, child.stderr);
    const build = JSON.parse(await readFile(resolve(directory, 'dist/build-info.json'), 'utf8'));
    assert.equal(build.sourceCommit, null);
    assert.equal(build.sourceDirty, null);
    // Character frames are public demo assets since 10/22: present files are embedded
    // even with local media disabled, while the personal example stays excluded.
    assert.equal(build.localMediaIncluded, true);
    assert.equal(await readFile(resolve(directory, 'dist/web/host.js'), 'utf8'), `const atlas = ""; const kowtow = "data:image/png;base64,${Buffer.from('synthetic local-only kowtow bytes').toString('base64')}";`);
    assert.equal(await readFile(resolve(directory, 'dist/web/app.js'), 'utf8'), 'const example = null;');
  } finally {
    assert.ok(directory.startsWith(validation + sep));
    await rm(directory, { recursive:true, force:true });
  }
});

test('同内容重复构建保持应用指纹，后端、样式、本地素材和依赖清单变化使其失效', async () => {
  const validation = resolve('.local/validation'); await mkdir(validation, { recursive:true });
  const directory = await mkdtemp(resolve(validation, 'build-identity-'));
  try {
    await mkdir(resolve(directory, 'src/web'), { recursive:true });
    await mkdir(resolve(directory, 'dist/web'), { recursive:true });
    await mkdir(resolve(directory, '.local/reference'), { recursive:true });
    await mkdir(resolve(directory, '.local/avatar'), { recursive:true });
    for (const name of ['index.html','style.css','poster.svg','human-patch-primary.svg','avatar-stage.html']) await writeFile(resolve(directory, 'src/web', name), `synthetic ${name}`);
    await writeFile(resolve(directory, 'package.json'), '{"name":"synthetic-build"}');
    await writeFile(resolve(directory, 'package-lock.json'), '{"lockfileVersion":3}');
    await writeFile(resolve(directory, 'dist/server.js'), 'export const synthetic = 1;');
    await writeFile(resolve(directory, '.local/reference/attention-poster.jpg'), 'synthetic media bytes; no image decoding asserted');
    const build = async () => {
      // tsc emits fresh markers before each real build; these stand in for its unchanged output.
      await writeFile(resolve(directory, 'dist/web/host.js'), 'const atlas = "__CYBERCARE_AVATAR_ATLAS__"; const kowtow = "__CYBERCARE_KOWTOW_ATLAS__";');
      await writeFile(resolve(directory, 'dist/web/app.js'), 'const example = "__CYBERCARE_READONLY_EXAMPLE__";');
      const child = spawnSync(process.execPath, [resolve('scripts/build.mjs')], { cwd:directory, env:{...process.env,CYBERCARE_INCLUDE_LOCAL_MEDIA:'1'}, encoding:'utf8', windowsHide:true });
      assert.equal(child.status, 0, child.stderr);
      const info = JSON.parse(await readFile(resolve(directory, 'dist/build-info.json'), 'utf8'));
      assert.match(info.applicationHash ?? '', /^[a-f0-9]{64}$/); return info;
    };
    const first = await build();
    await writeFile(resolve(directory, 'doc.md'), 'synthetic documentation update');
    await writeFile(resolve(directory, 'dist/build-info.json'), '{"builtAt":"2000-01-01T00:00:00.000Z"}');
    const repeated = await build();
    assert.notEqual(first.builtAt, repeated.builtAt); assert.equal(first.applicationHash, repeated.applicationHash);
    let previous = repeated.applicationHash;
    for (const [file, content] of [
      ['dist/server.js','export const synthetic = 2;'], ['src/web/style.css','body { color: #17221c; }'],
      ['.local/reference/attention-poster.jpg','different synthetic media bytes'], ['package-lock.json','{"lockfileVersion":3,"synthetic":true}'],
      ['.local/avatar/character-kowtow-v1.png','synthetic kowtow bytes; no image decoding asserted'],
    ]) {
      await writeFile(resolve(directory, file), content);
      const next = await build(); assert.notEqual(next.applicationHash, previous, file); previous = next.applicationHash;
    }
  } finally {
    assert.ok(directory.startsWith(validation + sep)); await rm(directory, { recursive:true, force:true });
  }
});
