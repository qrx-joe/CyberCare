import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError, FIELDS, inputSchema, editSchema, reviewSchema, feedbackSchema } from './contracts.js';
import { confirmTask, editTask, renderHtml, renderText, hash, SAMPLE_TEXT } from './domain.js';
import { createProvider } from './provider.js';
import { createTaskService } from './service.js';
import { createAuditor } from './audit.js';

const port = Number(process.env.PORT || 4310);
const publicOrigin = process.env.CYBERCARE_PUBLIC_ORIGIN ? new URL(process.env.CYBERCARE_PUBLIC_ORIGIN) : undefined;
if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash)) throw new Error('CYBERCARE_PUBLIC_ORIGIN must be an HTTPS origin.');
const cookiePath = process.env.CYBERCARE_BASE_PATH || '/';
if (!/^\/(?:[a-z0-9-]+\/)*$/.test(cookiePath)) throw new Error('CYBERCARE_BASE_PATH must be an absolute directory path.');
const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(publicOrigin ? [publicOrigin.host] : [])];
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(publicOrigin ? [publicOrigin.origin] : [])]);
const buildSchema = z.object({ sourceCommit:z.string().regex(/^[a-f0-9]{40}$/).nullable(), sourceDirty:z.boolean().nullable(), builtAt:z.string().datetime(), localMediaIncluded:z.boolean() });
async function readBuild() {
  try {
    const parsed = buildSchema.safeParse(JSON.parse(await readFile(new URL('build-info.json', import.meta.url), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
// A rebuild replaces files, not modules already loaded by this process.
const runningBuild = await readBuild();
const startedAt = new Date().toISOString();
async function runtimeInfo() {
  const availableBuild = await readBuild();
  return { status:'ok', startedAt, build:runningBuild, availableBuild, restartRequired:runningBuild && availableBuild ? JSON.stringify(runningBuild) !== JSON.stringify(availableBuild) : null };
}
const provider = createProvider();
const service = createTaskService(provider);
const auditor = createAuditor();
const sessions = new Map<string, number>();
const staticPaths: Record<string, [string, string]> = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['web/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['web/style.css', 'text/css; charset=utf-8'],
  '/poster.svg': ['web/poster.svg', 'image/svg+xml'],
  '/human-patch-primary.svg': ['web/human-patch-primary.svg', 'image/svg+xml'],
  '/host.js': ['web/host.js', 'text/javascript; charset=utf-8'],
  '/reference-poster.jpg': ['web/reference-poster.jpg', 'image/jpeg'],
};
const sweep = setInterval(() => {
  service.prune();
  for (const [token, until] of sessions) if (until <= Date.now()) sessions.delete(token);
}, 10000).unref();

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type'] !== 'application/json') throw new AppError(415, 'JSON_REQUIRED', '仅接受 JSON 请求。');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw new AppError(413, 'BODY_TOO_LARGE', '请求超过 3 MB 上限。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'JSON_INVALID', '请求内容不是合法 JSON。'); }
}

export const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    if (!allowedHosts.includes(req.headers.host || '')) throw new AppError(403, 'LOCAL_ONLY', '本 Demo 只允许本机访问。');
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const method = req.method || 'GET';
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(method) && (req.headers['x-cybercare'] !== '1' || (req.headers.origin && !allowedOrigins.has(req.headers.origin)))) throw new AppError(403, 'ORIGIN_REJECTED', '请求来源不允许。');
      if (method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, await runtimeInfo());
      }
      let token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('cybercare='))?.slice(10);
      if (!token || !sessions.has(token) || sessions.get(token)! <= Date.now()) {
        if (sessions.size >= 256) throw new AppError(429, 'SESSION_LIMIT', '会话已达上限，请稍后再试。');
        token = randomBytes(32).toString('hex');
      }
      // Session renewal must cover tasks created after the initial page load.
      // Each task still expires independently after 30 minutes.
      sessions.set(token, Date.now() + 30 * 60 * 1000);
      res.setHeader('Set-Cookie', `cybercare=${token}; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=1800${publicOrigin && req.headers.host === publicOrigin.host ? '; Secure' : ''}`);
      if (method === 'GET' && url.pathname === '/api/config') return json(res, 200, { fields: FIELDS, sampleText: SAMPLE_TEXT, provider: provider.info(), imageLimitMb: 2, ttlMinutes: 30, contentEditing: true, runtime:await runtimeInfo() });
      if (method === 'POST' && url.pathname === '/api/tasks') {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(key)) throw new AppError(400, 'KEY_REQUIRED', '缺少有效请求编号。');
        const input = inputSchema.parse(await body(req));
        if (input.image) await auditor.decodeImage(input.image);
        const task = service.create(input, token, key);
        return json(res, 202, service.public(task));
      }
      const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]{36})(?:\/(edit|audit|review|feedback|cancel|html|text|receipt))?$/);
      if (!match) throw new AppError(404, 'NOT_FOUND', '接口不存在。');
      const id = match[1]!, action = match[2];
      if (method === 'DELETE' && !action) { service.remove(id, token); return json(res, 200, { deleted: true }); }
      const task = service.get(id, token);
      if (method === 'GET' && !action) return json(res, 200, service.public(task));
      if (method === 'POST' && action === 'edit') {
        const input = editSchema.parse(await body(req)); editTask(task, input.revision, input.values, input.reason, input.content, input.summaryMode);
      } else if (method === 'POST' && action === 'audit') {
        const input = z.object({ revision: z.number().int() }).parse(await body(req));
        if (!task.extraction) throw new AppError(409, 'NO_RESULT', '任务还没有可检测的草稿。');
        await service.audit(id, token, input.revision, renderHtml(task), auditor.run);
      } else if (method === 'POST' && action === 'review') {
        const input = reviewSchema.parse(await body(req)); confirmTask(task, input.revision);
      } else if (method === 'POST' && action === 'feedback') {
        const input = feedbackSchema.parse(await body(req));
        if (task.status !== 'completed') throw new AppError(409, 'NOT_COMPLETED', '请先完成关键字段核对。');
        task.feedback = { at: new Date().toISOString(), outcome: input.outcome };
      } else if (method === 'POST' && action === 'cancel') {
        service.cancel(id, token);
      } else if (method === 'GET' && ['html', 'text', 'receipt'].includes(action || '')) {
        if (task.status !== 'completed') throw new AppError(409, 'REVIEW_REQUIRED', '完成检测和人工确认后才能导出。');
        if (action === 'receipt') {
          return json(res, 200, { ...service.public(task), originalTranscriptHash: hash(task.extraction!.original), auditScope: '服务端对导出 HTML 执行 axe；不验证原图事实或完整 WCAG 符合性', actualAdoption: '未验证', targetUserTesting: '未开展', feedbackScope: '当前操作者自报，未经独立核实' });
        }
        res.setHeader('Content-Disposition', `attachment; filename="cybercare-${id}.${action === 'html' ? 'html' : 'txt'}"`);
        res.writeHead(200, { 'Content-Type': action === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
        return res.end(action === 'html' ? renderHtml(task) : renderText(task));
      } else throw new AppError(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      return json(res, 200, service.public(task));
    }
    const file = staticPaths[url.pathname];
    if (method !== 'GET' || !file) throw new AppError(404, 'NOT_FOUND', '页面不存在。');
    let contents: Buffer;
    try { contents = await readFile(new URL(file[0], import.meta.url)); }
    catch { throw new AppError(404, 'ASSET_NOT_FOUND', '本地参考素材未附带；文字入口仍可使用。'); }
    res.writeHead(200, { 'Content-Type': file[1] }); res.end(contents);
  } catch (e) {
    const error = e instanceof AppError ? e : e instanceof z.ZodError ? new AppError(400, 'INVALID_INPUT', '输入缺失或格式错误，请检查字段、长度和逐项确认。') : new AppError(500, 'INTERNAL_ERROR', '内部处理失败，请重试或删除任务。');
    if (!res.headersSent) json(res, error.status, { code: error.code, message: error.message, request_id: requestId, retryable: false });
    else res.end();
  }
});
server.requestTimeout = 15000;
export async function closeResources() { clearInterval(sweep); service.close(); await auditor.close(); }
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  server.listen(port, '127.0.0.1', () => console.log(`CyberCare local demo: http://127.0.0.1:${port}`));
  async function stop() { server.close(); await closeResources(); process.exit(0); }
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
