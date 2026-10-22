import { randomUUID } from 'node:crypto';
import { AppError, type AssistanceInput, type AssistanceTask, type PublicAssistanceTask } from './contracts.js';
import { hash } from './domain.js';
import { validateImage } from './service.js';
import { createAssistanceProvider } from './assistance-provider.js';
import { AssistanceFailure } from './provider.js';
import { audioReviewHints } from './audio-review.js';

export function validateAudio(data: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new AppError(415, 'AUDIO_INVALID', '音频编码无效。');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new AppError(413, 'AUDIO_TOO_LARGE', '转换后音频上限为 2 MB。');
  const invalid = () => new AppError(415, 'AUDIO_INVALID', '仅接受最长 60 秒、16 kHz 单声道 16bit PCM WAV。请重新选择有效音频。');
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
  let format = false, pcm = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > bytes.length) throw invalid();
    if (tag === 'fmt ') {
      if (format || length < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt32LE(start + 4) !== 16000 || bytes.readUInt32LE(start + 8) !== 32000 || bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) throw invalid();
      format = true;
    }
    if (tag === 'data') { if (pcm || length % 2 !== 0) throw invalid(); pcm = length; }
    offset = start + length + (length % 2);
  }
  if (!format || pcm < 3200 || pcm > 60 * 32000) throw invalid();
  return pcm / 32000;
}

export function createAssistanceService(adapter: ReturnType<typeof createAssistanceProvider>, ttlMs = 30 * 60 * 1000) {
  const tasks = new Map<string, AssistanceTask>(), keys = new Map<string, { id: string; fingerprint: string }>();
  function prune() {
    for (const [id, task] of tasks) if (Date.parse(task.expiresAt) <= Date.now()) { task.controller.abort(); tasks.delete(id); }
    for (const [key, item] of keys) if (!tasks.has(item.id)) keys.delete(key);
  }
  function get(id: string, session: string) {
    prune(); const task = tasks.get(id);
    if (!task || task.session !== session) throw new AppError(404, 'TASK_NOT_FOUND', '任务不存在、已删除或已过期。');
    return task;
  }
  function current(id: string, session: string, revision: number) {
    const task = get(id, session);
    if (!['needs_review', 'completed'].includes(task.status) || task.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '请先读取并核对当前版本。');
    return task;
  }
  return {
    get, prune,
    public(task: AssistanceTask): PublicAssistanceTask {
      const { session: _session, controller: _controller, ...rest } = task;
      const hints = audioReviewHints(task.audio, task.reviewed?.text ?? task.audio?.original ?? '', task.reviewed?.summary ?? task.audio?.summary.map(item => item.text).join('\n') ?? '');
      return { ...rest, ...(hints.length ? { audioReviewHints: hints } : {}) };
    },
    create(input: AssistanceInput, session: string, key: string) {
      prune(); const fingerprint = hash(JSON.stringify(input)), requestKey = `${session}:${key}`, prior = keys.get(requestKey);
      if (prior) { if (prior.fingerprint !== fingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '相同请求编号的材料不能更换。'); return get(prior.id, session); }
      if (input.kind === 'audio') {
        if (input.mode === 'live') { if (!input.audio) throw new AppError(400, 'AUDIO_REQUIRED', '请选择音频。'); validateAudio(input.audio.data); }
        if (input.mode === 'manual' && !input.text?.trim()) throw new AppError(400, 'TEXT_REQUIRED', '请填写人工转写文字。');
      } else {
        if (input.mode === 'live' && !input.image) throw new AppError(400, 'IMAGE_REQUIRED', '请选择截图。');
        validateImage(input.image);
        if (input.previousId) {
          const prior = get(input.previousId, session);
          if (prior.kind !== 'guide' || prior.status !== 'completed' || prior.goal !== input.goal || prior.mode !== input.mode) throw new AppError(409, 'STEP_NOT_CONFIRMED', '先确认上一步，并保留同一目标和模式。');
          if (prior.guidance?.risk === 'sensitive') throw new AppError(409, 'SENSITIVE_STEP', '上轮涉及敏感操作，当前指导已停止。请先通过官方渠道独立核实。');
          if (input.mode === 'live' && prior.sourceHash === hash(Buffer.from(input.image!.data, 'base64'))) throw new AppError(409, 'NEW_SCREEN_REQUIRED', '请上传操作后的新截图，再核对当前界面。');
        }
      }
      if (tasks.size >= 50 || [...tasks.values()].filter(t => t.session === session).length >= 8 || [...tasks.values()].filter(t => t.status === 'processing').length >= 2) throw new AppError(429, 'TASK_LIMIT', '临时任务已达上限，请删除旧任务或稍后再试。');
      const task: AssistanceTask = {
        id: randomUUID(), kind: input.kind, mode: input.mode, session, status: 'processing', revision: 1,
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlMs).toISOString(), sourceNote: input.sourceNote,
        sourceHash: hash(input.mode === 'sample' ? `synthetic-${input.kind}-v1` : input.kind === 'audio' ? input.audio ? Buffer.from(input.audio.data, 'base64') : input.text! : Buffer.from(input.image!.data, 'base64')),
        ...(input.kind === 'guide' ? { goal: input.goal, previousId: input.previousId } : {}), providers: [], controller: new AbortController(),
      };
      tasks.set(task.id, task); keys.set(requestKey, { id: task.id, fingerprint });
      void adapter.run(input, task.controller.signal).then(output => {
        if (tasks.get(task.id) !== task || task.status !== 'processing' || Date.parse(task.expiresAt) <= Date.now()) return;
        Object.assign(task, output); task.status = 'needs_review';
      }).catch(error => {
        if (tasks.get(task.id) !== task || task.status !== 'processing' || Date.parse(task.expiresAt) <= Date.now()) return;
        task.status = 'failed'; task.error = error instanceof AppError ? error.message : '结果格式不符，未生成指导或转写。';
        if (error instanceof AssistanceFailure) task.providers.push({ stage: '调用失败', model: null, requests: error.diagnostic.requests, usage: error.diagnostic.usage });
      });
      return task;
    },
    edit(id: string, session: string, input: { revision: number; text: string; summary: string; reason: string }) {
      const task = current(id, session, input.revision);
      if (task.kind !== 'audio') throw new AppError(400, 'AUDIO_ONLY', '仅语音文字支持人工修订。');
      task.reviewed = { text: input.text, summary: input.summary, reason: input.reason, at: new Date().toISOString() };
      task.revision++; task.status = 'needs_review'; delete task.confirmedAt; return task;
    },
    review(id: string, session: string, revision: number) {
      const task = current(id, session, revision); task.status = 'completed'; task.confirmedAt = new Date().toISOString(); return task;
    },
    cancel(id: string, session: string) {
      const task = get(id, session);
      if (task.status !== 'processing') throw new AppError(409, 'NOT_PROCESSING', '任务未在处理中。');
      task.status = 'cancelled'; task.controller.abort(); return task;
    },
    remove(id: string, session: string) { const task = get(id, session); tasks.delete(id); task.controller.abort(); prune(); },
    exportText(id: string, session: string) {
      const task = get(id, session);
      if (task.status !== 'completed') throw new AppError(409, 'REVIEW_REQUIRED', '请先确认当前版本。');
      const prefix = `CyberCare ${task.kind === 'audio' ? '语音转写' : '截图操作指导'}\n模式：${task.mode === 'sample' ? '合成文字/界面示例，非 AI 识别' : task.mode === 'manual' ? '人工输入，非语音识别' : 'AI 结果，经当前操作者核对，仍可能有错'}\n来源：${task.sourceNote}\n版本：${task.revision}\n非 WCAG 检测回执；未经独立用户验证。\n`;
      if (task.audio) {
        const text = task.reviewed?.text ?? task.audio.original, summary = task.reviewed?.summary ?? task.audio.summary.map(s => s.text).join('\n');
        const hints = audioReviewHints(task.audio, text, summary);
        return `${prefix}\n完整文字\n${text}\n\n重点摘要（不替代全文）\n${summary || '未生成'}${hints.length ? `\n\n全文与摘要待核对\n${hints.map(hint => hint.message).join('\n')}` : ''}\n\n初次转写的原文依据与关键事项（人工修订后请重新核实）\n${task.audio.facts.map(f => `${f.kind}: ${f.text} [依据：${f.evidence}]`).join('\n')}\n${[...task.audio.uncertainties, task.audio.summaryError ?? ''].join('\n')}`;
      }
      const g = task.guidance!;
      return `${prefix}\n目标：${task.goal}\n当前页面：${g.screen}\n当前一步：${g.next ? `${g.next.action}\n位置：${g.next.position}\n控件：${g.next.target}` : '暂停操作，无法可靠提供当前一步'}\n确认方式：${g.check}\n${g.warnings.join('\n')}\n本次仅为当前截图的指导记录，不证明实际操作完成。`;
    },
    close() { for (const task of tasks.values()) task.controller.abort(); tasks.clear(); keys.clear(); },
  };
}
