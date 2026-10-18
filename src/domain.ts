import { createHash } from 'node:crypto';
import { AppError, FIELDS, extractionSchema, contentSchema, fieldKeys, type Extraction, type Field, type Task, type ReviewedContent } from './contracts.js';

export const SAMPLE_TEXT = '活动名称：一起读书 · 社区公益阅读会\n活动时间：2026 年 10 月 24 日 14:00—16:00\n活动地点：示例社区活动室二楼\n活动说明：带一本喜欢的书，一起分享阅读。\n费用：免费\n说明：这是开发者编写的合成演示素材，不是真实活动。';
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Manual mode only parses explicit labels. It is never presented as OCR or AI. */
export function fromTranscript(original: string): Extraction {
  if (!original.trim()) throw new AppError(400, 'TEXT_REQUIRED', '请粘贴海报转录文字，或改用内置样例。');
  const facts = Object.fromEntries(fieldKeys.map(key => {
    const line = original.split(/\r?\n/).find(v => v.startsWith(`${FIELDS[key]}：`) || v.startsWith(`${FIELDS[key]}:`));
    return [key, { value: line?.slice(FIELDS[key].length + 1).trim() || null, evidence: line || '' }];
  })) as Extraction['facts'];
  return normalizeExtraction({ original, facts, summary: '按明确字段标签整理；未标注的内容需要人工核对。', description: '本路径没有视觉识别；请对照原海报核对转录。', uncertainties: [] });
}

/** Evidence substring checks are consistency checks, not proof of image truth. */
export function normalizeExtraction(value: unknown): Extraction {
  const data = extractionSchema.parse(value);
  for (const key of fieldKeys) {
    const fact = data.facts[key];
    if (fact.value && /^(未知|无法辨认|无法确认|未提供|不清楚|\[无法辨认\])$/.test(fact.value.trim())) fact.value = null;
    if (fact.value && (!fact.evidence.trim() || !data.original.includes(fact.evidence) || !fact.evidence.includes(fact.value))) {
      data.uncertainties.push(`${FIELDS[key]}的提取值缺少可定位的原文依据，已置为未知。`);
      fact.value = null;
    }
    if (!fact.value) data.uncertainties.push(`${FIELDS[key]}未知：原文未提供、未标注或无法可靠识别；不可自行补全。`);
  }
  return data;
}

export function requireDraft(task: Task, revision: number) {
  if (task.status !== 'needs_review' || !task.values || !task.extraction) throw new AppError(409, 'NOT_REVIEWABLE', '当前任务不可修改或确认。');
  if (task.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '草稿版本已变化，请重新加载后核对。');
}
export function editTask(task: Task, revision: number, values: Record<Field, string>, reason: string, content?: ReviewedContent) {
  requireDraft(task, revision);
  const reviewed = content === undefined ? undefined : contentSchema.parse(content);
  for (const key of fieldKeys) if (values[key].trim() !== task.values![key]) {
    task.changes.push({ at: new Date().toISOString(), field: key, before: task.values![key], after: values[key].trim(), reason });
  }
  task.values = Object.fromEntries(fieldKeys.map(key => [key, values[key].trim()])) as Record<Field, string>;
  if (reviewed) {
    const previous = task.reviewedContent ?? task.extraction!;
    task.contentChanges ??= [];
    for (const key of ['original', 'summary', 'description'] as const) if (reviewed[key] !== previous[key]) {
      task.contentChanges.push({ at: new Date().toISOString(), field: key, before: previous[key], after: reviewed[key], reason });
    }
    task.reviewedContent = reviewed;
  }
  task.revision++;
  delete task.audit;
}
export function confirmTask(task: Task, revision: number) {
  requireDraft(task, revision);
  if (!task.audit || task.audit.revision !== revision || task.audit.htmlHash !== hash(renderHtml(task))) throw new AppError(409, 'AUDIT_REQUIRED', '请先检测当前版本的无障碍 HTML。');
  if (task.audit.violations.some(v => v.impact === 'critical' || v.impact === 'serious')) throw new AppError(409, 'AUDIT_BLOCKED', '检测发现严重问题，请先修复后重新检测。');
  task.review = { at: new Date().toISOString(), revision, fields: [...fieldKeys], contentConfirmed: true };
  task.status = 'completed';
}

// A recipient keeps the current date caution even after leaving the review UI.
function dateReviewNote(task: Task): string {
  const time = task.values?.time.trim();
  return time && !/(?:19|20)\d{2}/.test(time)
    ? '年份待核实：活动时间未识别到完整年份。请向活动方确认完整日期后再安排行程；不要按阅读当天推算或自行补全年份。' : '';
}

export function renderText(task: Task): string {
  const e = task.extraction!;
  const content = task.reviewedContent ?? e;
  const dateNote = dateReviewNote(task);
  return `海报文字版\n${fieldKeys.map(k => `${FIELDS[k]}：${task.values![k] || '未知，请向活动方核实'}`).join('\n')}${dateNote ? `\n\n${dateNote}` : ''}\n\n内容概述\n${content.summary}\n\n图像说明\n${content.description}\n\n完整文字（可人工修订）\n${content.original}\n\n提取时的不确定项（修订记录另见回执）\n${e.uncertainties.join('\n') || '无额外标记；仍需人工核对。'}\n\n来源：${task.source.note}\n处理路径：${task.source.mode}\n原始提取与人工修订依据保存在证据 JSON 中；四项信息与完整文字需分别核对。\n本文件不代表 WCAG 认证、真实用户验证或机构采用。`;
}
/** One controlled template is both audited and exported, with all content escaped. */
export function renderHtml(task: Task): string {
  const dateNote = dateReviewNote(task);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>海报文字版</title><style>body{font:1.25rem/1.8 system-ui,sans-serif;color:#17221c;background:#fafbf6;max-width:48rem;margin:2rem auto;padding:1rem;overflow-wrap:anywhere}h1{font-size:2rem}pre{font:inherit;white-space:pre-wrap}dt{font-weight:700}dd{margin:0 0 1rem}</style></head><body><main><h1>海报文字版</h1><dl>${fieldKeys.map(k => `<dt>${FIELDS[k]}</dt><dd>${escapeHtml(task.values![k] || '未知，请向活动方核实')}</dd>`).join('')}</dl>${dateNote ? `<p><strong>${escapeHtml(dateNote)}</strong></p>` : ''}<h2>完整文字与来源</h2><pre>${escapeHtml(renderText(task))}</pre></main></body></html>`;
}
