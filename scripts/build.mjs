import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
const includeLocalMedia = process.env.CYBERCARE_INCLUDE_LOCAL_MEDIA !== '0';
await mkdir('dist/web', { recursive: true });
for (const name of ['index.html', 'style.css', 'poster.svg']) {
  await cp(`src/web/${name}`, `dist/web/${name}`);
}
// User-supplied reference stays local; the app has a text fallback without it.
const reference = '.local/reference/attention-poster.jpg';
if (includeLocalMedia && existsSync(reference)) await cp(reference, 'dist/web/reference-poster.jpg');
else await rm('dist/web/reference-poster.jpg', { force: true });
// A local-only atlas is embedded in the existing host module: no extra route,
// credentials, dependency or server restart, so current in-memory tasks survive.
const atlasPath = '.local/avatar/character-atlas-v1.png';
const atlas = includeLocalMedia && existsSync(atlasPath) ? await readFile(atlasPath) : undefined;
if (atlas && atlas.length > 6 * 1024 * 1024) throw new Error('Avatar atlas exceeds the local demo 6 MB asset limit.');
const hostCode = await readFile('dist/web/host.js', 'utf8');
await writeFile('dist/web/host.js', hostCode.replace('__CYBERCARE_AVATAR_ATLAS__', atlas ? `data:image/png;base64,${atlas.toString('base64')}` : ''));
let sourceCommit = null, sourceDirty = null;
try {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (relative(realpathSync(gitRoot), realpathSync(process.cwd())) !== '') throw new Error('Source archive is inside another repository.');
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { /* Source archives can build without Git metadata. */ }
await writeFile('dist/build-info.json', JSON.stringify({ sourceCommit, sourceDirty, builtAt: new Date().toISOString(), localMediaIncluded: includeLocalMedia && !!(atlas || existsSync(reference)) }));
console.log('Built local demo in dist/ (no deployment).');
