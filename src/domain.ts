import { createHash } from 'node:crypto';
import { AppError, FIELDS, extractionSchema, factSchema, timeReferenceSchema, contentSchema, summaryModeSchema, fieldKeys, type Extraction, type Field, type Task, type ReviewedContent, type SummaryMode } from './contracts.js';

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

// Locate layout-only whitespace differences, then return the actual source span.
// Escaped non-whitespace text remains literal: no fuzzy words, numbers or punctuation.
function sourceSpan(source: string, quote: string): string | null {
  if (!quote.trim()) return null;
  if (source.includes(quote)) return quote;
  const pattern = quote.trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return source.match(new RegExp(pattern, 'u'))?.[0] ?? null;
}

// Narrow an overbroad multi-line quotation only after every fragment is found in
// source order. The value must fit wholly inside one fragment; never join values.
function supportingFragment(source: string, quote: string, value: string): string | null {
  const fragments = quote.split(/\r?\n/).filter(fragment => fragment.trim());
  if (fragments.length < 2) return null;
  let cursor = 0, supporting: string | null = null;
  for (const fragment of fragments) {
    const remaining = source.slice(cursor), span = sourceSpan(remaining, fragment);
    if (!span) return null;
    cursor += remaining.indexOf(span) + span.length;
    if (sourceSpan(span, value)) {
      if (supporting !== null) return null;
      supporting = span;
    }
  }
  return supporting;
}

/** Evidence substring checks are consistency checks, not proof of image truth. */
export function normalizeExtraction(value: unknown): Extraction {
  const data = extractionSchema.parse(value);
  for (const key of fieldKeys) {
    const fact = data.facts[key];
    if (fact.value && /^(未知|无法辨认|无法确认|未提供|不清楚|\[无法辨认\])$/.test(fact.value.trim())) fact.value = null;
    if (fact.value) {
      let evidence = sourceSpan(data.original, fact.evidence);
      const narrowed = !evidence;
      if (!evidence) evidence = supportingFragment(data.original, fact.evidence, fact.value);
      const locatedValue = evidence ? sourceSpan(evidence, fact.value) : null;
      if (evidence && locatedValue) {
        const located = factSchema.safeParse({ value: locatedValue, evidence });
        if (located.success) {
          fact.value = located.data.value; fact.evidence = located.data.evidence;
          if (narrowed) data.uncertainties.push(`${FIELDS[key]}的模型引文包含不连续片段；已仅保留完整包含提取值的原文片段作为依据，仍须对照原图核实语义。`);
        }
        else {
          data.uncertainties.push(`${FIELDS[key]}的原文跨度超出当前字段长度范围，已置为未知，请人工核对。`);
          fact.value = null;
        }
      } else {
        data.uncertainties.push(`${FIELDS[key]}的提取值缺少可定位的原文依据，已置为未知。`);
        fact.value = null;
      }
    }
    if (!fact.value) data.uncertainties.push(`${FIELDS[key]}未知：原文未提供、未标注或无法可靠识别；不可自行补全。`);
  }
  if (data.timeReferences) data.timeReferences = data.timeReferences.flatMap((reference, index) => {
    const evidence = sourceSpan(data.original, reference.evidence);
    const value = evidence ? sourceSpan(evidence, reference.value) : null;
    const located = evidence && value ? timeReferenceSchema.safeParse({ ...reference, value, evidence }) : null;
    if (located?.success) return [located.data];
    data.uncertainties.push(`时间条目 ${index + 1} 缺少长度合规且连续可定位的原文依据，未纳入时间建议。`);
    return [];
  });
  return data;
}

export function requireDraft(task: Task, revision: number) {
  if (task.status !== 'needs_review' || !task.values || !task.extraction) throw new AppError(409, 'NOT_REVIEWABLE', '当前任务不可修改或确认。');
  if (task.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '草稿版本已变化，请重新加载后核对。');
}
export function editTask(task: Task, revision: number, values: Record<Field, string>, reason: string, content?: ReviewedContent, summaryMode?: SummaryMode) {
  requireDraft(task, revision);
  const reviewed = content === undefined ? undefined : contentSchema.parse(content);
  const requestedMode = summaryMode === undefined ? undefined : summaryModeSchema.parse(summaryMode);
  const previous = task.reviewedContent ?? task.extraction!;
  // Old clients can still explicitly revise summary text without a mode field.
  const nextMode = requestedMode ?? (task.summaryMode === 'fields' && reviewed && reviewed.summary !== previous.summary ? 'custom' : task.summaryMode);
  for (const key of fieldKeys) if (values[key].trim() !== task.values![key]) {
    task.changes.push({ at: new Date().toISOString(), field: key, before: task.values![key], after: values[key].trim(), reason });
  }
  task.values = Object.fromEntries(fieldKeys.map(key => [key, values[key].trim()])) as Record<Field, string>;
  if (reviewed) {
    task.contentChanges ??= [];
    for (const key of ['original', 'summary', 'description'] as const) if (reviewed[key] !== previous[key]) {
      task.contentChanges.push({ at: new Date().toISOString(), field: key, before: previous[key], after: reviewed[key], reason });
    }
    task.reviewedContent = reviewed;
  }
  if (nextMode !== undefined) {
    const before = task.summaryMode ?? 'custom';
    if (before !== nextMode) { task.summarySourceChanges ??= []; task.summarySourceChanges.push({ at:new Date().toISOString(), before, after:nextMode, reason }); }
    task.summaryMode = nextMode;
  }
  task.revision++;
  delete task.audit;
}

/** A field template adds no organizer/sponsor narrative; fields still need image review. */
export function fieldSummary(values: Task['values']): string {
  return `根据四项活动信息整理；仍须对照原图核实。\n${fieldKeys.map(key => `${FIELDS[key]}：${values?.[key] || '未知，请向活动方核实'}`).join('\n')}`;
}
export function contentForTask(task: Task): ReviewedContent {
  const content = task.reviewedContent ?? task.extraction!;
  return task.summaryMode === 'fields' ? { ...content, summary:fieldSummary(task.values) } : content;
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
  if (time && /今天|明天|后天|今晚|明晚|本周|这周|下周|本月|下月/.test(time)) {
    return '相对日期待核实：活动时间含相对表述，请向活动方确认具体日期及其参照日期；不要按阅读当天推算。';
  }
  if (time?.split(/\r?\n/).some(line => /^(活动日期\/时段|报名截止|提交截止|用途待核实)[：:]/.test(line) && !/(?:19|20)\d{2}/.test(line))) {
    return '年份待核实：部分时间条目未标明完整年份。请按各自用途核实完整日期，不要从另一条截止时间补全年份。';
  }
  return time && !/(?:19|20)\d{2}/.test(time)
    ? '年份待核实：活动时间未识别到完整年份。请向活动方确认完整日期后再安排行程；不要按阅读当天推算或自行补全年份。' : '';
}

export function renderText(task: Task): string {
  const e = task.extraction!;
  const content = contentForTask(task);
  const dateNote = dateReviewNote(task);
  return `海报文字版\n${fieldKeys.map(k => `${FIELDS[k]}：${task.values![k] || '未知，请向活动方核实'}`).join('\n')}${dateNote ? `\n\n${dateNote}` : ''}\n\n内容概述\n${content.summary}\n\n图像说明\n${content.description}\n\n完整文字（可人工修订）\n${content.original}\n\n提取时的不确定项（修订记录另见回执）\n${e.uncertainties.join('\n') || '无额外标记；仍需人工核对。'}\n\n来源：${task.source.note}\n处理路径：${task.source.mode}\n原始提取与人工修订依据保存在证据 JSON 中；四项信息与完整文字需分别核对。\n本文件不代表 WCAG 认证、真实用户验证或机构采用。`;
}
/** One controlled template is both audited and exported, with all content escaped. */
export function renderHtml(task: Task): string {
  const e = task.extraction!;
  const content = contentForTask(task);
  const dateNote = dateReviewNote(task);
  const sections = [['facts', '活动信息'], ['summary', '内容概述'], ['description', '图像说明'], ['full-text', '完整文字'], ['uncertainties', '提取时的不确定项'], ['source', '来源与处理说明']] as const;
  const mode = { sample: '内置合成样例，非 AI 识别', manual: '人工转录，非 AI 识别', live: 'AI 提取，需操作者核对' }[task.source.mode];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(task.values!.title || '活动名称未知')} · 海报文字版</title><style>
body{font:1.25rem/1.8 system-ui,sans-serif;color:#17221c;background:#fafbf6;max-width:48rem;margin:2rem auto;padding:1rem;overflow-wrap:anywhere}
h1{font-size:2rem}h2{font-size:1.5rem}h1,h2{line-height:1.4}pre{font:inherit;white-space:pre-wrap}dt{font-weight:700}dd{margin:0 0 1rem}
a{color:#294d34;text-underline-offset:.2em}:focus-visible{outline:3px solid #294d34;outline-offset:4px}[tabindex="-1"]{scroll-margin-top:1rem}
nav{border-block:1px solid #bac5b9;margin:1.5rem 0;padding:.5rem 0}nav ul{display:flex;flex-wrap:wrap;gap:.25rem 1rem;list-style:none;padding:0}nav li{max-width:100%}nav a{display:block;min-height:44px;padding:.25rem .5rem}
.caution{border-left:4px solid #496644;padding:.5rem 1rem;background:#edf2e6}section{margin-block:2rem}footer{border-top:1px solid #bac5b9;padding-top:1rem}
@media print{nav{display:none}body{margin:0;max-width:none;color:#000;background:#fff}}
</style></head><body><main><h1>海报文字版</h1>
<nav aria-label="阅读目录"><p>跳到你需要的内容</p><ul>${sections.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ul></nav>
<section><h2 id="facts" tabindex="-1">活动信息</h2><dl>${fieldKeys.map(k => `<dt>${FIELDS[k]}</dt><dd${task.values![k].includes('\n') ? ' style="white-space:pre-wrap"' : ''}>${escapeHtml(task.values![k] || '未知，请向活动方核实')}</dd>`).join('')}</dl>${dateNote ? `<p id="date-review" class="caution"><strong>${escapeHtml(dateNote)}</strong></p>` : ''}</section>
<section><h2 id="summary" tabindex="-1">内容概述</h2><pre>${escapeHtml(content.summary || '未提供概述。')}</pre></section>
<section><h2 id="description" tabindex="-1">图像说明</h2><pre>${escapeHtml(content.description || '未提供图像说明。')}</pre></section>
<section><h2 id="full-text" tabindex="-1">完整文字</h2><pre>${escapeHtml(content.original)}</pre></section>
<section><h2 id="uncertainties" tabindex="-1">提取时的不确定项</h2><p>以下保留初次提取时的标记。当前内容可能已经修订，修订依据另见证据 JSON。</p><ul>${e.uncertainties.length ? e.uncertainties.map(text => `<li>${escapeHtml(text)}</li>`).join('') : '<li>无额外标记；仍需人工核对。</li>'}</ul></section>
<section><h2 id="source" tabindex="-1">来源与处理说明</h2><p>来源：${escapeHtml(task.source.note)}</p><p>处理路径：${mode}</p><p>原始提取与人工修订依据保存在证据 JSON 中；四项信息与完整文字需分别核对。未知信息请向活动方核实。</p></section>
</main><footer><p>本文件不代表 WCAG 认证、真实用户验证或机构采用。</p></footer></body></html>`;
}
