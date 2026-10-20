import { randomUUID } from 'node:crypto';
import { AppError, fieldKeys, type Audit, type Input, type PublicTask, type Task } from './contracts.js';
import { hash, SAMPLE_TEXT, fieldBodyReview } from './domain.js';
import { createProvider } from './provider.js';
import { imageSize } from 'image-size';

export function validateImage(image: Input['image']) {
  if (!image) return;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new AppError(415, 'FILE_INVALID', '图片编码无效。');
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new AppError(413, 'FILE_TOO_LARGE', '本地 MVP 图片上限为 2 MB。');
  const valid = image.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : image.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new AppError(415, 'FILE_INVALID', '图片签名与类型不匹配；仅接受 PNG、JPEG、WebP。');
  if (!/\.(png|jpe?g|webp)$/i.test(image.name)) throw new AppError(415, 'FILE_INVALID', '文件扩展名不支持。');
  try {
    const size = imageSize(bytes);
    if (!size.width || !size.height || size.width * size.height > 16000000 || size.width > 8000 || size.height > 8000) throw new Error('dimensions');
  } catch { throw new AppError(415, 'IMAGE_DIMENSIONS', '无法读取图片尺寸，或尺寸超过 8000 边长 / 1600 万像素。'); }
}

export function createTaskService(provider = createProvider(), ttlMs = 30 * 60 * 1000) {
  const tasks = new Map<string, Task>();
  const keys = new Map<string, { fingerprint: string; id: string }>();
  function prune() {
    for (const [id, t] of tasks) if (Date.parse(t.expiresAt) <= Date.now()) { t.controller.abort(); tasks.delete(id); }
    for (const [key, entry] of keys) if (!tasks.has(entry.id)) keys.delete(key);
  }
  function get(id: string, session: string) {
    prune();
    const t = tasks.get(id);
    if (!t || t.session !== session) throw new AppError(404, 'TASK_NOT_FOUND', '任务不存在、已删除或已过期。');
    return t;
  }
  return {
    get, prune,
    public(task: Task): PublicTask {
      const { controller: _controller, session: _session, ...rest } = task;
      const hints = fieldBodyReview(task);
      return { ...rest, ...(hints.length ? { bodyReview:hints } : {}) };
    },
    create(input: Input, session: string, key: string) {
      prune();
      validateImage(input.image);
      if (input.mode === 'live' && !input.image) throw new AppError(400, 'IMAGE_REQUIRED', '请选择图片。');
      if (input.mode === 'live' && !provider.info().live) throw new AppError(503, 'MODEL_NOT_CONFIGURED', '尚未配置真实视觉模型。');
      if (input.mode === 'manual' && !input.text?.trim()) throw new AppError(400, 'TEXT_REQUIRED', '请粘贴转录文字。');
      const fingerprint = hash(JSON.stringify(input));
      const idemKey = `${session}:${key}`;
      const prior = keys.get(idemKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '同一请求编号不能用于不同资料。');
        return get(prior.id, session);
      }
      if (tasks.size >= 50 || [...tasks.values()].filter(t => t.session === session).length >= 5) throw new AppError(429, 'TASK_LIMIT', '演示任务数量已达上限，请删除旧任务或等待过期。');
      if ([...tasks.values()].filter(t => t.status === 'processing').length >= 2) throw new AppError(429, 'BUSY', '正在处理其他任务，请稍后再试。');
      const task: Task = {
        id: randomUUID(), session, status: 'processing', revision: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        source: { mode: input.mode, note: input.sourceNote, permission: input.mode === 'sample' ? '开发者原创合成素材' : '提交者声明有权处理；未经独立核实', sha256: hash(input.image ? Buffer.from(input.image.data, 'base64') : input.mode === 'sample' ? SAMPLE_TEXT : input.text!), fileName: input.image?.name ?? null },
        changes: [], controller: new AbortController(),
      };
      if (input.mode === 'live') task.summaryMode = 'fields';
      tasks.set(task.id, task);
      keys.set(idemKey, { fingerprint, id: task.id });
      // Local single-process work only. Abort/deletion/expiry must win over late results.
      void provider.extract(input, task.controller.signal).then(({ extraction, provider: metadata }) => {
        if (tasks.get(task.id) !== task || task.status !== 'processing' || Date.parse(task.expiresAt) <= Date.now()) return;
        task.extraction = extraction;
        task.values = Object.fromEntries(fieldKeys.map(k => [k, extraction.facts[k].value ?? ''])) as Task['values'];
        task.provider = metadata;
        task.status = 'needs_review';
      }).catch(error => {
        if (tasks.get(task.id) !== task || task.status !== 'processing') return;
        task.status = 'failed';
        task.error = error instanceof AppError ? error.message : '处理失败，未生成结果。';
      });
      return task;
    },
    cancel(id: string, session: string) {
      const t = get(id, session);
      if (t.status !== 'processing') throw new AppError(409, 'NOT_PROCESSING', '当前任务未在处理中。');
      t.status = 'cancelled'; t.controller.abort(); return t;
    },
    remove(id: string, session: string) {
      const t = tasks.get(id);
      if (!t || t.session !== session) return;
      tasks.delete(id); t.controller.abort(); prune();
    },
    async audit(id: string, session: string, revision: number, html: string, run: (html: string, revision: number) => Promise<Audit>) {
      const t = get(id, session);
      if (t.status !== 'needs_review' || t.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '请检测最新草稿。');
      const audit = await run(html, revision);
      if (get(id, session) !== t || t.status !== 'needs_review' || t.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '检测期间草稿已变化，结果未写入。');
      t.audit = audit; return t;
    },
    close() { for (const task of tasks.values()) task.controller.abort(); tasks.clear(); keys.clear(); },
  };
}
