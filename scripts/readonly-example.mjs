import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateImage } from '../dist/service.js';

const value = z.string().min(1).max(500).refine(text => !!text.trim()).nullable();
const commonsPage = z.string().max(2000).url().refine(text => {
  const url = new URL(text);
  return url.protocol === 'https:' && url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:')
    && !url.username && !url.password && !url.search && !url.hash;
});
const schema = z.object({
  imageFile: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$/i),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  original: z.string().min(1).max(12000),
  facts: z.object({ title:value, time:value, location:value, registration:value }).strict(),
  notes: z.array(z.string().max(700)).max(30),
  recordedAt: z.string().datetime(),
  source: z.object({ author:z.string().min(1).max(120), title:z.string().min(1).max(200), url:commonsPage,
    license:z.literal('CC BY 4.0'), licenseUrl:z.literal('https://creativecommons.org/licenses/by/4.0/') }).strict(),
  // Optional provenance so the page can say which model produced the archived fields.
  provider: z.object({ model:z.string().min(1).max(80), promptVersion:z.string().min(1).max(80),
    manualFieldEdits:z.number().int().min(0).max(4) }).strict().optional(),
}).strict();

function requireInside(parent, target) {
  const path = relative(parent, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('outside');
}

// This optional public-material package is separate from uploads and model reports.
// Only allowlisted display data and a checked local raster image enter the bundle.
export async function loadReadonlyExample(projectRoot) {
  const root = await realpath(projectRoot), directory = resolve(root, '.local/examples');
  const manifest = resolve(directory, 'poster-comparison.json');
  if (!existsSync(manifest)) return null;
  try {
    const actualDirectory = await realpath(directory), actualManifest = await realpath(manifest);
    requireInside(root, actualDirectory); requireInside(actualDirectory, actualManifest);
    if ((await stat(actualManifest)).size > 256 * 1024) throw new Error('metadata size');
    const input = schema.parse(JSON.parse(await readFile(actualManifest, 'utf8')));
    for (const fact of Object.values(input.facts)) if (fact !== null && !input.original.includes(fact)) throw new Error('ungrounded display value');
    const imagePath = await realpath(resolve(actualDirectory, input.imageFile));
    requireInside(actualDirectory, imagePath);
    if ((await stat(imagePath)).size > 2 * 1024 * 1024) throw new Error('image size');
    const bytes = await readFile(imagePath);
    if (createHash('sha256').update(bytes).digest('hex') !== input.imageSha256) throw new Error('image hash');
    const extension = extname(input.imageFile).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    const data = bytes.toString('base64');
    validateImage({ name:input.imageFile, mime, data });
    return { original:input.original, facts:input.facts, notes:input.notes, recordedAt:input.recordedAt,
      source:input.source, imageDataUrl:`data:${mime};base64,${data}`, ...(input.provider ? { provider:input.provider } : {}) };
  } catch {
    // Avoid echoing local file contents or arbitrary parse/validation values.
    throw new Error('只读示例数据或图片无效，请检查本地示例包。');
  }
}
