import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadReadonlyExample } from './readonly-example.mjs';
const includeLocalMedia = process.env.CYBERCARE_INCLUDE_LOCAL_MEDIA !== '0';
await mkdir('dist/web', { recursive: true });
for (const name of ['index.html', 'style.css', 'poster.svg', 'human-patch-primary.svg', 'avatar-stage.html']) {
  await cp(`src/web/${name}`, `dist/web/${name}`);
}
// Optional vendor SDK is pinned by content, kept out of source control and never fetched by build.
const sdkPath = '.local/avatar/xmovAvatar-e2e-20261022.js';
if (existsSync(sdkPath)) {
  const sdk = await readFile(sdkPath);
  if (createHash('sha256').update(sdk).digest('hex') !== '8d03fe57a3a2ed6e0614029471c8e4b91705f9385b67ae1b93da49dfa7e5d612') throw new Error('Xingyun SDK hash does not match the reviewed local version.');
  await writeFile('dist/web/xmov-avatar.js', sdk);
} else await rm('dist/web/xmov-avatar.js', { force: true });
// User-supplied reference stays local; the app has a text fallback without it.
const reference = '.local/reference/attention-poster.jpg';
if (includeLocalMedia && existsSync(reference)) await cp(reference, 'dist/web/reference-poster.jpg');
else await rm('dist/web/reference-poster.jpg', { force: true });
// The local-only atlas is embedded in the host module, with no extra route or credentials.
const atlasPath = '.local/avatar/character-atlas-v1.png';
const atlas = includeLocalMedia && existsSync(atlasPath) ? await readFile(atlasPath) : undefined;
if (atlas && atlas.length > 6 * 1024 * 1024) throw new Error('Avatar atlas exceeds the local demo 6 MB asset limit.');
const kowtowPath = '.local/avatar/character-kowtow-v1.png';
const kowtow = includeLocalMedia && existsSync(kowtowPath) ? await readFile(kowtowPath) : undefined;
if (kowtow && kowtow.length > 6 * 1024 * 1024) throw new Error('Kowtow atlas exceeds the local demo 6 MB asset limit.');
const hostCode = await readFile('dist/web/host.js', 'utf8');
await writeFile('dist/web/host.js', hostCode
  .replace('__CYBERCARE_AVATAR_ATLAS__', atlas ? `data:image/png;base64,${atlas.toString('base64')}` : '')
  .replace('__CYBERCARE_KOWTOW_ATLAS__', kowtow ? `data:image/png;base64,${kowtow.toString('base64')}` : ''));
const example = includeLocalMedia ? await loadReadonlyExample(process.cwd()) : null;
const appCode = await readFile('dist/web/app.js', 'utf8');
const exampleMarker = /(['"])__CYBERCARE_READONLY_EXAMPLE__\1/;
if (!exampleMarker.test(appCode)) throw new Error('Readonly example marker is missing.');
await writeFile('dist/web/app.js', appCode.replace(exampleMarker, () => JSON.stringify(example)));
let sourceCommit = null, sourceDirty = null;
try {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (relative(realpathSync(gitRoot), realpathSync(process.cwd())) !== '') throw new Error('Source archive is inside another repository.');
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { /* Source archives can build without Git metadata. */ }
// Compare runtime inputs rather than documentation commits or build timestamps.
const application = createHash('sha256');
application.update(JSON.stringify(['cybercare-application-v1', process.versions.node]) + '\n');
async function includeFile(name, path) {
  const content = await readFile(path);
  application.update(JSON.stringify([name, content.length]) + '\n'); application.update(content);
}
async function includeDirectory(path, prefix = '') {
  const entries = (await readdir(path, { withFileTypes:true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const name = prefix + entry.name;
    if (name === 'build-info.json') continue;
    if (entry.isDirectory()) await includeDirectory(`${path}/${entry.name}`, `${name}/`);
    else if (entry.isFile()) await includeFile(`dist/${name}`, `${path}/${entry.name}`);
    else throw new Error(`Cannot fingerprint non-file build entry: ${name}`);
  }
}
for (const name of ['package.json', 'package-lock.json']) await includeFile(name, name);
await includeDirectory('dist');
const applicationHash = application.digest('hex');
await writeFile('dist/build-info.json', JSON.stringify({ sourceCommit, sourceDirty, builtAt: new Date().toISOString(), localMediaIncluded: includeLocalMedia && !!(atlas || kowtow || existsSync(reference) || example), applicationHash }));
console.log('Built local demo in dist/ (no deployment).');
