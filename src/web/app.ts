import type { Field, PublicTask, TimeKind, TimeReference } from '../contracts.js';
import { initHost } from './host.js';

function el<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T; }
const mode = el<HTMLSelectElement>('mode');
const transcript = el<HTMLTextAreaElement>('transcript');
const image = el<HTMLInputElement>('image');
const source = el<HTMLInputElement>('source-note');
let sampleText = '';
let modelTimeoutSeconds = 30;
let task: PublicTask | null = null;
let fields: Record<Field, string>;
let imageUrl: string | undefined;
let busy = false;
let taskReadInterrupted = false;
let dirty = false;
let contentEditing = false;
let summarySources = false;
let bodyReviewAvailable = false;
let refreshTimePicker: (() => boolean) | undefined;
let pendingCreation: { signature: string; key: string } | null = null;
const drafts: Record<string, { text: string; source: string }> = {};
let previousMode: string | null = null;
let workspaceVersion = 0;
let expiresAt = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const host = initHost();
const appBase = new URL('.', import.meta.url);
const imageReview = initImageReview();
const apiUrl = (path: string) => new URL(`api${path}`, appBase).href;
interface RecordedExample {
  original:string; facts:Record<Field,string | null>; notes:string[]; recordedAt:string; imageDataUrl:string;
  source:{author:string;title:string;url:string;license:string;licenseUrl:string};
  provider?:{model:string;promptVersion:string;manualFieldEdits:number};
}
const embeddedExample: unknown = '__CYBERCARE_READONLY_EXAMPLE__';
const recordedExample = embeddedExample && typeof embeddedExample === 'object' ? embeddedExample as RecordedExample : null;
class ExpiredWorkspace extends Error {}

function requireCurrent(version: number) {
  checkExpiry();
  if (version !== workspaceVersion) throw new ExpiredWorkspace();
}
function retainUntil(deadline: number) {
  expiresAt = expiresAt ? Math.min(expiresAt, deadline) : deadline;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(checkExpiry, Math.max(0, expiresAt - Date.now()));
  checkExpiry();
}
function clearWorkspace(keepMaterial = false) {
  const retained = keepMaterial ? { source: source.value, deadline: expiresAt } : null;
  workspaceVersion++; clearTimeout(expiryTimer); expiresAt = 0; task = null; busy = false; dirty = false; taskReadInterrupted = false;
  if (!retained) { image.value = ''; if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = undefined; }
  transcript.value = ''; source.value = ''; el<HTMLInputElement>('permission').checked = false;
  for (const key of Object.keys(drafts)) delete drafts[key]; pendingCreation = null;
  if (retained) drafts.manual = { text: '', source: retained.source };
  el('poster-preview').hidden = true; el('poster-preview').removeAttribute('src'); imageReview.sync();
  for (const id of ['fact-fields', 'original', 'summary', 'uncertainties', 'final-text', 'audit-output', 'task-meta', 'provider-label', 'feedback-status', 'body-review-list']) el(id).replaceChildren();
  for (const key of ['original', 'summary', 'description']) el<HTMLTextAreaElement>(`content-${key}`).value = '';
  el<HTMLSelectElement>('summary-mode').value = 'custom';
  el<HTMLDetailsElement>('content-editor').open = false;
  el<HTMLInputElement>('edit-reason').value = ''; el<HTMLSelectElement>('feedback').value = ''; clearChecks(); render();
  previousMode = null; mode.value = retained ? 'manual' : 'sample'; setupMode(); updateGates();
  // A fallback preserves the original deadline, rather than starting a new retention period.
  if (retained) retainUntil(retained.deadline);
}
function checkExpiry() {
  if (!expiresAt || Date.now() < expiresAt) return;
  clearWorkspace(); error(); notice('资料已到期，当前页面的用户文字、图片预览和任务已清空。可以重新开始。');
}

function initImageReview() {
  const preview = el<HTMLImageElement>('poster-preview'), viewport = el('poster-viewport'), canvas = el('poster-canvas');
  const controls = el('image-zoom-controls'), status = el('image-zoom-status'), review = el('review-image');
  const zoomIn = el<HTMLButtonElement>('image-zoom-in'), zoomOut = el<HTMLButtonElement>('image-zoom-out'), fit = el<HTMLButtonElement>('image-zoom-fit');
  let zoom = 1;
  function refresh(reset = false) {
    const hasSource = !preview.hidden && preview.hasAttribute('src');
    const available = !preview.hidden && !!preview.getAttribute('src') && preview.complete && preview.naturalWidth > 0;
    el('source-image-review').hidden = !hasSource && el('image-review-error').hidden;
    el('image-zoom-help').hidden = !hasSource;
    controls.hidden = !available; review.hidden = !available || !task?.extraction;
    viewport.hidden = preview.hidden || !preview.hasAttribute('src');
    zoomIn.disabled = !available || zoom === 8; zoomOut.disabled = fit.disabled = !available || zoom === 1;
    if (!available) { canvas.style.width = canvas.style.height = preview.style.width = ''; status.textContent = ''; return; }
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    const centerX = canvas.clientWidth ? (viewport.scrollLeft + width / 2) / canvas.clientWidth : .5;
    const centerY = canvas.clientHeight ? (viewport.scrollTop + height / 2) / canvas.clientHeight : .5;
    const ratio = Math.min(width / preview.naturalWidth, height / preview.naturalHeight) * zoom;
    const imageWidth = preview.naturalWidth * ratio, imageHeight = preview.naturalHeight * ratio;
    preview.style.width = `${imageWidth}px`;
    canvas.style.width = `${Math.max(width, imageWidth)}px`; canvas.style.height = `${Math.max(height, imageHeight)}px`;
    viewport.scrollLeft = reset ? 0 : centerX * canvas.clientWidth - width / 2;
    viewport.scrollTop = reset ? 0 : centerY * canvas.clientHeight - height / 2;
    const label = zoom === 1 ? '适合预览框' : `${zoom} 倍查看`;
    if (status.textContent !== label) status.textContent = label;
  }
  function changeZoom(next: number) {
    const version = workspaceVersion; checkExpiry();
    if (version !== workspaceVersion || preview.hidden || !preview.complete || !preview.naturalWidth) return;
    zoom = Math.max(1, Math.min(8, next)); refresh(zoom === 1);
  }
  zoomIn.addEventListener('click', () => changeZoom(zoom * 2));
  zoomOut.addEventListener('click', () => changeZoom(zoom / 2));
  fit.addEventListener('click', () => changeZoom(1));
  review.addEventListener('click', () => {
    const version = workspaceVersion; checkExpiry(); refresh();
    if (version !== workspaceVersion || review.hidden) return;
    if (zoom === 1) changeZoom(2);
    viewport.focus(); viewport.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
  preview.addEventListener('load', () => { checkExpiry(); refresh(true); });
  preview.addEventListener('error', () => {
    if (!preview.getAttribute('src') || !preview.complete || preview.naturalWidth) return;
    preview.hidden = true; preview.removeAttribute('src'); el('image-review-error').hidden = false; refresh();
  });
  new ResizeObserver(() => refresh(zoom === 1)).observe(viewport);
  return { refresh, sync() {
    zoom = 1; el('image-review-error').hidden = true;
    if (preview.hidden) preview.removeAttribute('src');
    refresh(true);
  } };
}
document.addEventListener('visibilitychange', checkExpiry);
window.addEventListener('pageshow', checkExpiry);
for (const input of [transcript, source]) input.addEventListener('input', () => {
  if (mode.value !== 'sample') retainUntil(Date.now() + 30 * 60 * 1000);
});

function notice(message: string) { el('notice').textContent = message; }
function error(message = '') { el('error').textContent = message; el('error').hidden = !message; }
function showRuntimeWarning(runtime?: { restartRequired:boolean | null }) {
  el('runtime-warning').hidden = runtime?.restartRequired === false;
  el('runtime-title').textContent = runtime?.restartRequired === true ? '本地演示有更新待加载' : '本地演示版本尚未核对';
  el('runtime-message').textContent = runtime?.restartRequired === true
    ? '构建文件已更新，当前服务仍使用启动时的版本。先保存所需结果，再重启本地服务并刷新页面。'
    : '服务没有提供可核对的版本记录，暂不能确认页面与服务端版本一致。可以先保存资料，再按下方步骤更新演示。';
}
// Presentation guidance only: it never fills facts or changes their evidence.
function fieldGuidance(key: Field, value: string) {
  const missing: Record<Field, string> = {
    title: '请向活动方核实活动的正式名称；未核实可以留空，确认保留未知。',
    time: '请核实完整日期（含年份）和开始、结束时间；不要把“明天”自行换算成日期。不确定可以留空。',
    location: '请向活动方核实场地、具体地址和楼层；不要根据活动名称推测地点。未核实可以留空。',
    registration: '请向活动方询问报名入口、报名方式和截止时间；没有可靠信息可以留空，确认保留未知。',
  };
  if (!value.trim()) return missing[key];
  if (key === 'time' && /今天|明天|后天|今晚|明晚|本周|这周|下周|本月|下月/.test(value)) {
    return '活动时间含相对日期。请向活动方确认具体日期及其参照日期；即使有年份，也不要按阅读当天推算。';
  }
  if (key === 'time' && value.split(/\r?\n/).some(line => /^(活动日期\/时段|报名截止|提交截止|用途待核实)[：:]/.test(line) && !/(?:19|20)\d{2}/.test(line))) {
    return '部分时间条目未标明完整年份。请按各自用途核实日期，不要从另一条截止时间补全年份。';
  }
  return key === 'time' && !/(?:19|20)\d{2}/.test(value)
    ? '请对照原图核实年份、具体日期和时段；不要把“今天”或“明天”自行换算成日期。' : '';
}
function fitFactEditors() {
  for (const input of el('fact-fields').querySelectorAll('textarea')) {
    if (!input.getClientRects().length) continue;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
  }
}
function createTimePicker(input: HTMLTextAreaElement, sourceText: string, references: TimeReference[], id: string, revision: number) {
  const labels: Record<TimeKind, string> = { event:'活动日期/时段', 'registration-deadline':'报名截止', 'submission-deadline':'提交截止', unknown:'用途待核实' };
  const element = document.createElement('details'); element.id = 'time-picker'; element.className = 'time-picker';
  const toggle = document.createElement('summary'); toggle.textContent = '核对不同用途的时间';
  const help = document.createElement('p'); help.id = 'time-picker-help';
  help.textContent = '分类是识别建议，请对照原图更正；不清楚就保留“用途待核实”。勾选后点击写入，才会填入空白时间草稿；随后仍须填写依据、保存、检测和确认。';
  const list = document.createElement('ul');
  const rows = references.map((reference, index) => {
    const item = document.createElement('li'), include = document.createElement('input'), selectLabel = document.createElement('label');
    include.type = 'checkbox'; include.id = `time-ref-${index}`; selectLabel.className = 'check';
    selectLabel.append(include, document.createTextNode(`采用条目 ${index + 1}`));
    const text = document.createElement('p'), quote = document.createElement('small'), sourceState = document.createElement('p');
    sourceState.id = `time-ref-state-${index}`; sourceState.hidden = true;
    include.setAttribute('aria-describedby', sourceState.id);
    text.textContent = reference.value; text.className = 'time-reference-value'; quote.textContent = `识别引用（含义待核对）：${reference.evidence}`;
    const roleLabel = document.createElement('label'), role = document.createElement('select'); role.id = `time-role-${index}`;
    role.setAttribute('aria-describedby', sourceState.id);
    roleLabel.htmlFor = role.id; roleLabel.textContent = `条目 ${index + 1} 的用途`;
    for (const [kind, label] of Object.entries(labels)) { const option = document.createElement('option'); option.value = kind; option.textContent = label; role.append(option); }
    role.value = reference.kind;
    for (const control of [include, role]) control.addEventListener('change', () => { clearChecks(); updateGates(); });
    item.append(selectLabel, text, quote, roleLabel, role, sourceState); list.append(item);
    return { reference, include, role, sourceState };
  });
  const preview = document.createElement('pre'); preview.id = 'time-composition-preview'; preview.hidden = true;
  const status = document.createElement('p'); status.id = 'time-picker-status';
  const button = document.createElement('button'); button.type = 'button'; button.id = 'apply-time-references'; button.textContent = '写入空白时间草稿';
  button.setAttribute('aria-describedby', `${help.id} ${status.id}`);
  const composed = () => rows.filter(row => row.include.checked).map(row => `${labels[row.role.value as TimeKind]}：${row.reference.value}`).join('\n');
  const refresh = () => {
    const active = !busy && task?.id === id && task.revision === revision && task.status === 'needs_review';
    const sourceChanged = contentEditing && el<HTMLTextAreaElement>('content-original').value !== sourceText;
    let unavailableSelection = false;
    for (const row of rows) {
      const available = !sourceChanged && sourceText.includes(row.reference.evidence) && row.reference.evidence.includes(row.reference.value);
      row.include.disabled = !active || (!available && !row.include.checked); // An unavailable selection can still be cancelled.
      row.role.disabled = !active || !available;
      row.sourceState.textContent = '这条识别引用已不在当前正文中，不能直接采用；请对照材料核实。'; row.sourceState.hidden = available || sourceChanged;
      if (row.include.checked && !available) unavailableSelection = true;
    }
    const value = composed(), pending = rows.some(row => row.include.checked), tooLong = value.length > input.maxLength;
    preview.textContent = value; preview.hidden = !pending;
    button.disabled = !active || sourceChanged || unavailableSelection || !!input.value || !pending || tooLong;
    status.textContent = sourceChanged || unavailableSelection ? '正文已变化，暂不能写入；可取消勾选，保存正文后重新核对。'
      : input.value ? '时间字段已有内容，不会覆盖。需要改写时请自行修改或清空；也可取消勾选。'
      : tooLong ? '组合文字超过 500 字符，未截断或写入；请减少勾选条目或手动核对。'
      : pending ? '以上选取尚未写入。请写入时间草稿或取消勾选，再进行保存、检测和确认。'
      : '勾选需要保留的条目，并核对用途。';
    return pending;
  };
  button.addEventListener('click', () => {
    checkExpiry(); if (!button.isConnected) return; refresh(); if (button.disabled) return;
    input.value = composed(); for (const row of rows) row.include.checked = false;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    notice('已按核对的用途写入时间草稿，尚未保存。请填写修改依据并保存，再检测和确认。'); input.focus();
  });
  element.append(toggle, help, list, preview, status, button);
  return { element, refresh };
}
function renderSamplePreview() {
  // Fixed examples only: never read the active upload, draft, or task here.
  const recorded = el<HTMLSelectElement>('sample-example').value === 'recorded' ? recordedExample : null;
  const lines = sampleText.split(/\r?\n/);
  const values = Object.fromEntries((Object.entries(fields) as [Field, string][]).map(([key, label]) => {
    const line = lines.find(text => text.startsWith(`${label}：`) || text.startsWith(`${label}:`));
    return [key, (recorded ? recorded.facts[key] : line?.slice(label.length + 1).trim()) || (recorded ? '未知；存档未提供' : '未知；示例未提供')];
  })) as Record<Field, string>;
  el('sample-facts').replaceChildren(...(Object.entries(fields) as [Field, string][]).filter(([key]) => key !== 'title').flatMap(([key, label]) => {
    const term = document.createElement('dt'), value = document.createElement('dd');
    term.textContent = label; value.textContent = values[key]; return [term, value];
  }));
  el('sample-reading-title').textContent = values.title;
  const dateGuidance = fieldGuidance('time', recorded ? recorded.facts.time || '' : values.time);
  el('sample-date-note').textContent = dateGuidance; el('sample-date-note').hidden = !dateGuidance;
  el('sample-original').textContent = recorded?.original ?? sampleText;
  const previewImage = el<HTMLImageElement>('sample-source-image');
  previewImage.src = recorded?.imageDataUrl ?? new URL('poster.svg', appBase).href;
  previewImage.alt = recorded ? `公开活动海报：${values.title}。完整转录在下方。` : '开发者原创合成阅读会海报，完整文字在下方转录。';
  const credit = el('sample-source-credit');
  credit.replaceChildren();
  if (recorded) {
    const sourceLink = document.createElement('a'), licenseLink = document.createElement('a');
    sourceLink.href = recorded.source.url; sourceLink.textContent = recorded.source.title;
    licenseLink.href = recorded.source.licenseUrl; licenseLink.textContent = recorded.source.license;
    for (const link of [sourceLink, licenseLink]) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    credit.append(document.createTextNode(`${recorded.source.author} / `), sourceLink, document.createTextNode(' · '), licenseLink, document.createTextNode(' · 来源提供的缩略图，原样保留'));
  } else credit.textContent = '开发者原创合成海报 · 非真实活动';
  const edits = recorded?.provider?.manualFieldEdits;
  el('sample-disclosure').textContent = recorded
    ? recorded.provider
      ? `AI 识别的已有结果 · StepFun ${recorded.provider.model}，提示词 ${recorded.provider.promptVersion}；${edits === 0 ? '四项字段均为模型输出，未人工改写' : `其中 ${edits} 项字段经人工修订`}。本次仅展示，不调用模型、不创建任务；非真人确认，活动和报名当前状态未核实。`
      : '公开材料的已有结果 · 本次仅展示，不调用模型、不创建任务。经过开发代理核对，非真人确认；活动和报名当前状态未核实。'
    : '合成示例 · 只读预览。尚未检测、尚未人工确认，不能作为正式回执。';
  const notes = recorded?.notes ?? (values.registration === '未知；示例未提供' ? ['示例未提供报名方式，确认前应保留未知。'] : []);
  el('sample-notes').replaceChildren(...notes.map(note => { const item = document.createElement('li'); item.textContent = note; return item; }));
  el('sample-preview-status').textContent = recorded
    ? `识别存档：${new Date(recorded.recordedAt).toLocaleDateString('zh-CN')}。原图、转录和待核实事项供你对照；本次没有生成新任务或正式回执。`
    : '以下是合成材料的展示示例，没有创建任务或调用模型。';
  el('sample-preview-content').hidden = false;
}
async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const version = workspaceVersion;
  const response = await fetch(apiUrl(path), {
    method, headers: { 'Content-Type': 'application/json', 'X-CyberCare': '1', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json(); requireCurrent(version);
  if (!response.ok) {
    if (data.code === 'TASK_NOT_FOUND' && task && path.startsWith(`/tasks/${task.id}`)) {
      clearWorkspace(); notice('任务已删除或到期，当前页面资料已清空。');
      throw new ExpiredWorkspace();
    }
    throw new Error(data.message || '请求失败');
  }
  return data as T;
}
function updateSummaryDraft() {
  const supported = contentEditing && summarySources;
  const hasContent = !!task?.values;
  const fromFields = supported && hasContent && el<HTMLSelectElement>('summary-mode').value === 'fields';
  el('summary-mode-controls').hidden = !supported;
  el('custom-summary-label').hidden = fromFields;
  el('content-summary').hidden = fromFields;
  el('field-summary-label').hidden = !fromFields;
  el('field-summary-preview').hidden = !fromFields;
  el('field-summary-preview').textContent = fromFields
    ? `根据四项活动信息整理；仍须对照原图核实。\n${(Object.keys(fields) as Field[]).map(key => `${fields[key]}：${el<HTMLTextAreaElement>(`fact-${key}`).value || '未知，请向活动方核实'}`).join('\n')}`
    : '';
  el('summary-source').hidden = !supported || !hasContent;
  el('summary-source').textContent = supported && hasContent
    ? `导出概述：${fromFields ? '根据当前四项信息生成，仍须对照原图核实。' : '使用下方概述草稿，仍须人工核对。'}可在正文修订中选择来源。`
    : '';
}
function updateGates() {
  updateSummaryDraft();
  el('task-read-recovery').hidden = !taskReadInterrupted || task?.status !== 'processing';
  el<HTMLButtonElement>('retry-task').disabled = busy;
  el('body-review').hidden = !bodyReviewAvailable || dirty || task?.status !== 'needs_review' || !task.bodyReview?.length;
  el<HTMLButtonElement>('review-body').disabled = busy;
  el('review-body').hidden = !contentEditing;
  const factEditors = el('fact-fields').querySelectorAll<HTMLTextAreaElement>('textarea');
  el('unknown-facts-help').hidden = task?.status !== 'needs_review' || factEditors.length !== 4 || [...factEditors].some(input => input.value.trim());
  for (const input of el('input-form').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) input.disabled = busy || !!task;
  for (const input of el('edit-form').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) input.disabled = busy;
  const excerptSource = task?.reviewedContent?.original ?? task?.extraction?.original;
  const excerptSourceChanged = contentEditing && el<HTMLTextAreaElement>('content-original').value !== excerptSource;
  for (const button of el('fact-fields').querySelectorAll<HTMLButtonElement>('button[data-excerpt-field]')) {
    button.disabled = busy || task?.status !== 'needs_review' || excerptSourceChanged || !!el<HTMLTextAreaElement>(`fact-${button.dataset.excerptField}`).value;
  }
  const timeSelectionPending = refreshTimePicker?.() ?? false;
  const audited = !!task?.audit && task.audit.revision === task.revision && !task.audit.violations.some(v => ['serious', 'critical'].includes(v.impact || ''));
  const checked = fields && (Object.keys(fields) as Field[]).every(k => el<HTMLInputElement>(`checked-${k}`).checked) && el<HTMLInputElement>('confirm-content').checked;
  el<HTMLButtonElement>('confirm').disabled = busy || dirty || timeSelectionPending || !audited || !checked;
  el<HTMLButtonElement>('audit').disabled = busy || dirty || timeSelectionPending;
  el<HTMLButtonElement>('save').disabled = busy || !dirty || timeSelectionPending;
  el<HTMLButtonElement>('create').disabled = busy || !!task;
  el<HTMLButtonElement>('use-manual').disabled = busy;
}
async function action(work: () => Promise<void>) {
  checkExpiry();
  if (busy) return;
  const version = workspaceVersion;
  busy = true; error(); updateGates();
  try { await work(); } catch (e) {
    if (version === workspaceVersion && !(e instanceof ExpiredWorkspace)) {
      error(e instanceof Error ? e.message : '操作失败，请重试。'); notice('本次操作未完成，请查看错误说明。');
    }
  }
  finally { if (version === workspaceVersion) busy = false; updateGates(); }
}
function setupMode() {
  if (previousMode) drafts[previousMode] = { text: transcript.value, source: source.value };
  const saved = drafts[mode.value];
  const sample = mode.value === 'sample', live = mode.value === 'live';
  transcript.value = saved?.text ?? (sample ? sampleText : '');
  source.value = saved?.source ?? (sample ? '开发者原创合成演示海报；非真实活动' : '');
  transcript.readOnly = sample || live;
  transcript.hidden = live;
  document.querySelector<HTMLLabelElement>('label[for=transcript]')!.hidden = live;
  el('text-help').hidden = live;
  el('file-group').hidden = sample;
  el('mode-help').textContent = sample ? '原创合成海报用于验证流程，不代表真实公益活动或模型效果。' : live ? `图片将发送给已配置的 StepFun 视觉模型。AI 提取不等于事实核实。最多等待 ${modelTimeoutSeconds} 秒，可取消，无自动重试。` : '图片用于对照并在服务端检查，不发送给模型；草稿来自你粘贴的转录文字，不是识别结果。';
  el<HTMLInputElement>('permission').checked = false;
  const preview = el<HTMLImageElement>('poster-preview');
  if (sample || imageUrl) preview.src = sample ? new URL('poster.svg', appBase).href : imageUrl!;
  else preview.removeAttribute('src');
  preview.hidden = !sample && !imageUrl;
  preview.alt = sample ? '合成阅读会海报，完整文字在下方转录框。' : '待核对的用户海报；请同时提供并核对文字版本。';
  imageReview.sync();
  previousMode = mode.value;
}
mode.addEventListener('change', setupMode);
image.addEventListener('change', () => {
  error();
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = undefined;
  const file = image.files?.[0];
  if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
    image.value = ''; error('仅支持不超过 2 MB 的 PNG、JPEG、WebP。');
  } else if (file) { imageUrl = URL.createObjectURL(file); retainUntil(Date.now() + 30 * 60 * 1000); }
  const preview = el<HTMLImageElement>('poster-preview');
  preview.hidden = !imageUrl;
  if (imageUrl) preview.src = imageUrl;
  imageReview.sync();
});

function render() {
  imageReview.refresh();
  refreshTimePicker = undefined;
  el('body-review-list').replaceChildren();
  if (task) retainUntil(Date.parse(task.expiresAt));
  host.setTask(task);
  el('task-controls').hidden = !task;
  el('empty').hidden = !!task;
  el('draft').hidden = task?.status !== 'needs_review';
  el('completed').hidden = task?.status !== 'completed';
  el('cancel').hidden = task?.status !== 'processing';
  const canUseManual = task?.source.mode === 'live' && ['failed', 'cancelled'].includes(task.status);
  el('manual-fallback').hidden = !canUseManual;
  // Progress reflects the existing task state; it never bypasses review gates.
  const step = task?.status === 'completed' ? 'export' : task?.status === 'needs_review' ? 'review' : 'input';
  for (const name of ['input', 'review', 'export']) {
    const item = el(`step-${name}`);
    if (name === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  }
  const deskStatus = el('desk-status');
  deskStatus.textContent = task ? { processing: '正在整理材料', needs_review: '等待人工核对', completed: '已确认，可导出', failed: '处理失败，请查看说明', cancelled: '任务已取消' }[task.status] : '等待提交材料';
  deskStatus.dataset.state = task?.status ?? 'empty';
  if (!task) return;
  const states = { processing: '正在处理', needs_review: '等待核对', completed: '已确认', failed: '处理失败', cancelled: '已取消' };
  el('task-meta').textContent = `任务 ${task.id} · 版本 ${task.revision} · ${states[task.status]} · ${new Date(task.expiresAt).toLocaleString('zh-CN')} 到期`;
  if (task.status === 'failed') { error(task.error); notice(canUseManual ? '识别未完成。可以保留本页图片和来源，改用人工转录。' : '任务失败；可删除后重新提交。'); }
  if (task.status === 'cancelled') notice(canUseManual ? '识别已取消，可保留本页材料改用人工转录；已发出的第三方请求可能仍计费。' : '任务已取消；已发出的第三方请求可能仍计费。可删除当前任务后重新开始。');
  if (!task.extraction || !task.values) return;
  el('provider-label').textContent = `${task.provider?.name} · ${task.provider?.elapsedMs} ms · 本任务外部请求 ${task.provider?.requests} 次`;
  el('original').textContent = task.extraction.original;
  el('summary').textContent = `${task.extraction.summary}\n${task.extraction.description}`;
  const content = task.reviewedContent ?? task.extraction;
  el('body-review-list').replaceChildren(...(task.bodyReview ?? []).map(hint => {
    const item = document.createElement('li');
    item.textContent = `${fields[hint.field]}：${hint.kind === 'unknown-retained' ? '当前保留未知。' : `当前填写为「${hint.current}」，正文未逐字定位。`}${hint.previous ? `正文仍含此前文字「${hint.previous}」。` : ''}相关修改依据：${hint.reason || '未记录，请核实。'}`;
    return item;
  }));
  for (const key of ['original', 'summary', 'description'] as const) el<HTMLTextAreaElement>(`content-${key}`).value = content[key];
  el<HTMLSelectElement>('summary-mode').value = task.summaryMode ?? 'custom';
  el('uncertainties').replaceChildren(...task.extraction.uncertainties.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  const container = el('fact-fields');
  container.replaceChildren();
  for (const [key, label] of Object.entries(fields) as [Field, string][]) {
    const wrap = document.createElement('div');
    const l = document.createElement('label'); l.htmlFor = `fact-${key}`; l.textContent = label;
    const input = document.createElement('textarea'); input.rows = 2; input.id = `fact-${key}`; input.maxLength = 500; input.value = task.values[key]; input.placeholder = '未知；留空可明确确认未知'; input.setAttribute('aria-describedby', `evidence-${key} guidance-${key}`);
    const quote = task.extraction.facts[key].evidence;
    const unlocatedQuote = !!quote.trim() && !task.extraction.original.includes(quote);
    const evidence = document.createElement('small'); evidence.id = `evidence-${key}`; evidence.textContent = `${unlocatedQuote ? '待核实的识别片段' : '提取依据'}：${quote || '无可定位文字；请核实或保留未知'}${task.changes.some(c => c.field === key) ? '（此字段有人工修订，见证据 JSON）' : ''}`;
    const guidance = document.createElement('p'); guidance.id = `guidance-${key}`; guidance.className = 'fact-guidance';
    const updateGuidance = () => {
      guidance.textContent = unlocatedQuote && !input.value.trim()
        ? '当前转录中未找到这段文字的完整对应，字段暂时留空。请对照原图核实后填写，也可以保留未知。'
        : fieldGuidance(key, input.value);
      guidance.hidden = !guidance.textContent;
    };
    updateGuidance();
    input.addEventListener('input', () => { updateGuidance(); fitFactEditors(); dirty = true; clearChecks(); updateGates(); });
    wrap.append(l, input, evidence, guidance);
    const timeReferences = task.extraction.timeReferences ?? [];
    if (key === 'time' && timeReferences.length) {
      const picker = createTimePicker(input, content.original, timeReferences, task.id, task.revision);
      wrap.append(picker.element); refreshTimePicker = picker.refresh;
    }
    if (unlocatedQuote && !task.extraction.facts[key].value && !(key === 'time' && timeReferences.length)) {
      const fragments = [...new Set(quote.split(/\r?\n/).map(fragment => fragment.trim()))]
        .filter(fragment => fragment && fragment.length <= 500 && content.original.includes(fragment)).slice(0, 6);
      if (fragments.length) {
        const picker = document.createElement('details'); picker.id = `excerpt-${key}`; picker.className = 'fact-excerpts';
        const toggle = document.createElement('summary'); toggle.textContent = '从原文选取片段';
        const help = document.createElement('p'); help.id = `excerpt-help-${key}`;
        help.textContent = '以下片段能在当前核对正文中逐字定位，未核实含义。仅填入空白草稿；正文有未保存修改时暂停选取。请对照原图、填写修改依据并保存。'
          + (key === 'time' ? ' 还须区分活动日期、时段与提交截止。' : '');
        const list = document.createElement('ul'), renderedId = task.id, renderedRevision = task.revision;
        fragments.forEach((fragment, index) => {
          const item = document.createElement('li'), text = document.createElement('p'), context = document.createElement('small'), button = document.createElement('button');
          text.className = 'excerpt-text'; text.textContent = fragment;
          const at = content.original.indexOf(fragment);
          context.textContent = `上下文：${at > 24 ? '…' : ''}${content.original.slice(Math.max(0, at - 24), at + fragment.length + 24)}${at + fragment.length + 24 < content.original.length ? '…' : ''}`;
          button.type = 'button'; button.textContent = '填入草稿'; button.dataset.excerptField = key;
          button.setAttribute('aria-label', `填入草稿：${label}片段 ${index + 1}`); button.setAttribute('aria-describedby', help.id);
          button.addEventListener('click', () => {
            checkExpiry();
            if (!button.isConnected || busy || task?.id !== renderedId || task.revision !== renderedRevision || task.status !== 'needs_review' || input.value
              || (contentEditing && el<HTMLTextAreaElement>('content-original').value !== content.original) || !content.original.includes(fragment)) return;
            input.value = fragment; input.dispatchEvent(new Event('input', { bubbles: true }));
            notice(`${label}已填入待核对草稿，尚未保存。请核实用途、填写修改依据并保存，再检测和确认。`); input.focus();
          });
          item.append(text, context, button); list.append(item);
        });
        picker.append(toggle, help, list); wrap.append(picker);
      }
    }
    container.append(wrap);
  }
  fitFactEditors();
  dirty = false; clearChecks();
  const audit = task.audit;
  el('audit-output').textContent = audit ? `${audit.engine} · 版本 ${audit.revision}\nCritical ${audit.violations.filter(v => v.impact === 'critical').length} / Serious ${audit.violations.filter(v => v.impact === 'serious').length} / 全部规则问题 ${audit.violations.length}\n需人工检查 ${audit.incomplete.length} 项；通过规则 ${audit.passes}\n${audit.violations.map(v => `${v.id}：${v.help}`).join('\n')}${audit.incomplete.map(v => `\n人工复核 ${v.id}：${v.help}`).join('')}\n检测仅覆盖自动规则，不代表完整 WCAG 符合性。` : '尚未检测当前版本；修改后需要重新检测。';
  if (task.feedback) el('feedback-status').textContent = `已保存自报反馈：${task.feedback.outcome}；未经独立核实。`;
  updateGates();
}
function clearChecks() {
  if (!fields) return;
  for (const key of Object.keys(fields)) el<HTMLInputElement>(`checked-${key}`).checked = false;
  el<HTMLInputElement>('confirm-content').checked = false;
}
async function imageData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file);
  });
}
el('input-form').addEventListener('submit', event => {
  event.preventDefault();
  void action(async () => {
    const version = workspaceVersion;
    const file = mode.value === 'sample' ? undefined : image.files?.[0];
    if (mode.value === 'live' && !file) throw new Error('请选择海报图片。');
    notice(mode.value === 'live' ? `正在调用真实视觉模型，请稍候；最多等待 ${modelTimeoutSeconds} 秒，无自动重试。` : '正在整理转录文字；本路径没有 AI 调用。');
    const payload = { mode: mode.value, sourceNote: source.value, permission: el<HTMLInputElement>('permission').checked, text: transcript.value, ...(file ? { image: { name: file.name, mime: file.type, data: await imageData(file) } } : {}) };
    requireCurrent(version);
    const signature = JSON.stringify(payload);
    // A lost creation response must not give an identical retry a new paid request.
    if (pendingCreation?.signature !== signature) pendingCreation = { signature, key: crypto.randomUUID() };
    task = await api<PublicTask>('/tasks', 'POST', payload, pendingCreation.key);
    pendingCreation = null;
    render();
    // Creation returns first so cancel/delete remain accessible during a live request.
    void poll(task.id);
  });
});
async function poll(id: string) {
  try {
    while (task?.id === id && task.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 500));
      const latest = await api<PublicTask>(`/tasks/${id}`);
      if (task?.id !== id) return;
      task = latest; render();
    }
    if (task?.id === id && task.status === 'needs_review') { notice('草稿已生成。请对照来源核对，未知字段可留空。'); el('result-title').focus(); }
  } catch (e) {
    if (task?.id === id) {
      taskReadInterrupted = true;
      error(e instanceof Error ? e.message : '读取失败'); notice('任务状态读取中断，处理可能仍在进行。可以重新读取当前任务，无需重新提交材料。'); updateGates();
    }
  }
}
el('retry-task').addEventListener('click', () => void action(async () => {
  if (!task || task.status !== 'processing' || !taskReadInterrupted) return;
  task = await api<PublicTask>(`/tasks/${task.id}`);
  taskReadInterrupted = false; render();
  if (task.status === 'processing') { notice('已恢复读取，任务仍在处理。'); void poll(task.id); }
  else if (task.status === 'needs_review') { notice('草稿已取回。请对照来源核对，未知字段可留空。'); el('result-title').focus(); }
}));
el('edit-form').addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    if (!task) return;
    if (refreshTimePicker?.()) throw new Error('时间选取尚未写入，请先写入时间草稿或取消勾选。');
    const reason = el<HTMLInputElement>('edit-reason').value.trim();
    if (!reason) throw new Error('请填写修改依据。');
    const values = Object.fromEntries(Object.keys(fields).map(k => [k, el<HTMLTextAreaElement>(`fact-${k}`).value]));
    const content = Object.fromEntries(['original', 'summary', 'description'].map(key => [key, el<HTMLTextAreaElement>(`content-${key}`).value]));
    task = await api<PublicTask>(`/tasks/${task.id}/edit`, 'POST', { revision: task.revision, values, reason, ...(contentEditing ? { content, ...(summarySources ? { summaryMode:el<HTMLSelectElement>('summary-mode').value } : {}) } : {}) });
    render(); notice(`已保存修改；旧确认与检测已失效，请重新检测。${task.bodyReview?.length && bodyReviewAvailable ? '字段修订与正文对照仍有提示，请查看后核实。' : ''}`);
  });
});
el('audit').addEventListener('click', () => void action(async () => {
  if (!task) return;
  if (dirty || refreshTimePicker?.()) throw new Error('请先写入或取消时间选取，并保存当前修改。');
  notice('服务端正在对本次导出的完整 HTML 运行 axe 检测…');
  task = await api<PublicTask>(`/tasks/${task.id}/audit`, 'POST', { revision: task.revision });
  render(); notice('检测完成。请查看问题与人工检查项，再逐项确认。');
}));
for (const key of ['original', 'summary', 'description']) el(`content-${key}`).addEventListener('input', () => { dirty = true; clearChecks(); updateGates(); });
el('summary-mode').addEventListener('change', () => { if (summarySources && task) { dirty = true; clearChecks(); updateGates(); } });
el('review-body').addEventListener('click', () => {
  checkExpiry();
  if (!task || busy || !contentEditing) return;
  el<HTMLDetailsElement>('content-editor').open = true;
  el('content-original').focus();
});
el('review-material').addEventListener('click', () => {
  el('input-title').focus({ preventScroll: true });
  el('input-title').scrollIntoView({ block: 'start', behavior: 'auto' });
});
el('review-form').addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    if (!task || dirty || refreshTimePicker?.()) throw new Error('请先写入或取消时间选取，保存修改并重新检测。');
    const confirmed = Object.fromEntries(Object.keys(fields).map(k => [k, el<HTMLInputElement>(`checked-${k}`).checked]));
    task = await api<PublicTask>(`/tasks/${task.id}/review`, 'POST', { revision: task.revision, confirmed, contentConfirmed: el<HTMLInputElement>('confirm-content').checked });
    render();
    const version = workspaceVersion;
    const response = await fetch(apiUrl(`/tasks/${task.id}/text`));
    const text = await response.text(); requireCurrent(version);
    if (!response.ok) throw new Error('读取结果失败，任务可能已到期。');
    el('final-text').textContent = text;
    notice('核对完成，可以导出。此记录不代表目标用户验证或机构采用。'); el('result-title').focus();
  });
});
el('cancel').addEventListener('click', () => void action(async () => { if (task) { task = await api<PublicTask>(`/tasks/${task.id}/cancel`, 'POST', {}); render(); } }));
el('use-manual').addEventListener('click', () => void action(async () => {
  if (!task || task.source.mode !== 'live' || !['failed', 'cancelled'].includes(task.status)) return;
  await api(`/tasks/${task.id}`, 'DELETE'); clearWorkspace(true);
  notice('已转为人工转录。请粘贴文字并重新确认材料使用权；图片只作对照，不再调用模型，原到期时间不变。');
  transcript.focus();
}));
el('delete').addEventListener('click', () => void action(async () => {
  if (!task) return;
  await api(`/tasks/${task.id}`, 'DELETE'); clearWorkspace();
  notice('已删除服务端任务，清空用户资料并恢复合成样例；已下载文件和供应商端资料不在删除范围。'); el('input-title').setAttribute('tabindex', '-1'); el('input-title').focus();
}));
for (const format of ['text', 'html', 'receipt']) el(`export-${format}`).addEventListener('click', () => void action(async () => {
  if (!task) return;
  const version = workspaceVersion;
  const response = await fetch(apiUrl(`/tasks/${task.id}/${format}`));
  if (!response.ok) throw new Error('导出失败，任务可能已过期。');
  const blob = await response.blob(); requireCurrent(version);
  if (!task) return;
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `cybercare-${task.id}.${format === 'receipt' ? 'json' : format === 'text' ? 'txt' : 'html'}`;
  link.click(); URL.revokeObjectURL(url); notice('已下载至你的设备；本地导出没有公开发布。');
}));
el('copy').addEventListener('click', () => void action(async () => {
  const text = el('final-text').textContent;
  if (!text) throw new Error('当前结果文字尚未读取成功，请使用“下载纯文本”。');
  try { await navigator.clipboard.writeText(text); notice('已复制文字。'); }
  catch {
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(el('final-text')); selection?.removeAllRanges(); selection?.addRange(range);
    el('final-text').setAttribute('tabindex', '-1'); el('final-text').focus();
    notice('浏览器未允许自动复制。已选中结果，可按 Ctrl+C（Mac 用 ⌘C），也可使用“下载纯文本”。');
  }
}));
el('send-feedback').addEventListener('click', () => void action(async () => {
  if (!task) return;
  const outcome = el<HTMLSelectElement>('feedback').value;
  if (!outcome) throw new Error('请先选择反馈。');
  task = await api<PublicTask>(`/tasks/${task.id}/feedback`, 'POST', { outcome }); render(); notice('自报反馈已记录；不等于实际公益效果。');
}));
el('large').addEventListener('click', () => { const active = document.documentElement.classList.toggle('large'); el('large').setAttribute('aria-pressed', String(active)); fitFactEditors(); });
window.addEventListener('resize', fitFactEditors);
const factResizeObserver = new ResizeObserver(fitFactEditors);
factResizeObserver.observe(el('fact-fields'));
el('check-runtime').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('check-runtime'); button.disabled = true;
  try {
    const response = await fetch(apiUrl('/health'));
    showRuntimeWarning(response.ok ? await response.json() : undefined);
  } catch { showRuntimeWarning(); }
  finally { button.disabled = false; }
});
for (const id of ['hero-example', 'nav-example']) el(id).addEventListener('click', event => {
  event.preventDefault(); el<HTMLDetailsElement>('sample-preview').open = true;
  el('sample-preview-toggle').focus({ preventScroll: true });
  el('sample-preview').scrollIntoView({ block: 'start', behavior: 'auto' });
});
el('sample-source-image').addEventListener('error', () => {
  el('sample-source-image').hidden = true; el('sample-source-fallback').hidden = false;
});
el('sample-source-image').addEventListener('load', () => {
  el('sample-source-image').hidden = false; el('sample-source-fallback').hidden = true;
});
el('sample-example').addEventListener('change', () => { if (fields) renderSamplePreview(); });
async function init() {
  try {
    const config = await api<{ fields: Record<Field, string>; sampleText: string; provider: { live: boolean; limit: number; timeoutMs?: number | null; configError?: string | null }; contentEditing?: boolean; summarySources?: boolean; fieldBodyReview?: boolean; runtime?: { restartRequired:boolean | null } }>('/config'); fields = config.fields; sampleText = config.sampleText;
    showRuntimeWarning(config.runtime);
    modelTimeoutSeconds = Math.ceil((config.provider.timeoutMs ?? 30000) / 1000);
    contentEditing = config.contentEditing === true;
    summarySources = config.summarySources === true;
    bodyReviewAvailable = config.fieldBodyReview === true;
    el('content-editor').hidden = !contentEditing;
    el('sample-example-picker').hidden = !recordedExample;
    el<HTMLOptionElement>('sample-recorded-option').disabled = !recordedExample;
    el<HTMLSelectElement>('sample-example').value = recordedExample ? 'recorded' : 'sample';
    renderSamplePreview();
    el('confirm-fields').replaceChildren(...(Object.entries(fields) as [Field, string][]).map(([key, name]) => {
      const label = document.createElement('label'); label.className = 'check'; const input = document.createElement('input'); input.type = 'checkbox'; input.id = `checked-${key}`; input.addEventListener('change', updateGates); label.append(input, document.createTextNode(`已核对${name}，或确认保留未知`)); return label;
    }));
    el('confirm-content').addEventListener('change', updateGates);
    const live = mode.querySelector<HTMLOptionElement>('option[value=live]')!;
    live.disabled = !config.provider.live; live.textContent = config.provider.live ? `真实视觉识别 · 进程最多 ${config.provider.limit} 次请求 / 无自动重试` : '真实视觉识别 · 未配置，未验证';
    setupMode(); updateGates(); notice('可使用合成样例演示。真实识别是否可用以上方配置状态为准。');
    if (config.provider.configError) error(`真实识别配置不可用：${config.provider.configError}可以继续使用合成样例或人工转录。`);
  } catch { el('sample-preview-status').textContent = '示例暂不可用，请确认服务已启动。'; error('无法读取服务配置，请确认服务可用。'); }
}
void init();
