import type { Field, PublicTask } from '../contracts.js';
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
let dirty = false;
let contentEditing = false;
let pendingCreation: { signature: string; key: string } | null = null;
const drafts: Record<string, { text: string; source: string }> = {};
let previousMode: string | null = null;
let workspaceVersion = 0;
let expiresAt = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const host = initHost();
const appBase = new URL('.', import.meta.url);
const apiUrl = (path: string) => new URL(`api${path}`, appBase).href;
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
  workspaceVersion++; clearTimeout(expiryTimer); expiresAt = 0; task = null; busy = false; dirty = false;
  if (!retained) { image.value = ''; if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = undefined; }
  transcript.value = ''; source.value = ''; el<HTMLInputElement>('permission').checked = false;
  for (const key of Object.keys(drafts)) delete drafts[key]; pendingCreation = null;
  if (retained) drafts.manual = { text: '', source: retained.source };
  el('poster-preview').hidden = true;
  for (const id of ['fact-fields', 'original', 'summary', 'uncertainties', 'final-text', 'audit-output', 'task-meta', 'provider-label', 'feedback-status']) el(id).replaceChildren();
  for (const key of ['original', 'summary', 'description']) el<HTMLTextAreaElement>(`content-${key}`).value = '';
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
document.addEventListener('visibilitychange', checkExpiry);
window.addEventListener('pageshow', checkExpiry);
for (const input of [transcript, source]) input.addEventListener('input', () => {
  if (mode.value !== 'sample') retainUntil(Date.now() + 30 * 60 * 1000);
});

function notice(message: string) { el('notice').textContent = message; }
function error(message = '') { el('error').textContent = message; el('error').hidden = !message; }
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
  return key === 'time' && !/(?:19|20)\d{2}/.test(value)
    ? '请对照原图核实年份、具体日期和时段；不要把“今天”或“明天”自行换算成日期。' : '';
}
function renderSamplePreview() {
  // Use the existing synthetic transcript; this is not a task or an export.
  const lines = sampleText.split(/\r?\n/);
  const values = Object.fromEntries((Object.entries(fields) as [Field, string][]).map(([key, label]) => {
    const line = lines.find(text => text.startsWith(`${label}：`) || text.startsWith(`${label}:`));
    return [key, line?.slice(label.length + 1).trim() || '未知；示例未提供'];
  })) as Record<Field, string>;
  el('sample-facts').replaceChildren(...(Object.entries(fields) as [Field, string][]).flatMap(([key, label]) => {
    const term = document.createElement('dt'), value = document.createElement('dd');
    term.textContent = label; value.textContent = values[key]; return [term, value];
  }));
  el('sample-reading-title').textContent = values.title;
  el('sample-reading-time').textContent = `${fields.time}：${values.time}`;
  el('sample-reading-location').textContent = `${fields.location}：${values.location}`;
  el('sample-original').textContent = sampleText;
  el('sample-preview-status').textContent = '以下是合成材料的展示示例，没有创建任务或调用模型。';
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
function updateGates() {
  for (const input of el('input-form').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) input.disabled = busy || !!task;
  for (const input of el('edit-form').querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')) input.disabled = busy;
  const audited = !!task?.audit && task.audit.revision === task.revision && !task.audit.violations.some(v => ['serious', 'critical'].includes(v.impact || ''));
  const checked = fields && (Object.keys(fields) as Field[]).every(k => el<HTMLInputElement>(`checked-${k}`).checked) && el<HTMLInputElement>('confirm-content').checked;
  el<HTMLButtonElement>('confirm').disabled = busy || dirty || !audited || !checked;
  el<HTMLButtonElement>('audit').disabled = busy || dirty;
  el<HTMLButtonElement>('save').disabled = busy || !dirty;
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
  preview.src = sample ? new URL('poster.svg', appBase).href : imageUrl || '';
  preview.hidden = !sample && !imageUrl;
  preview.alt = sample ? '合成阅读会海报，完整文字在下方转录框。' : '待核对的用户海报；请同时提供并核对文字版本。';
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
});

function render() {
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
  for (const key of ['original', 'summary', 'description'] as const) el<HTMLTextAreaElement>(`content-${key}`).value = content[key];
  el('uncertainties').replaceChildren(...task.extraction.uncertainties.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  const container = el('fact-fields');
  container.replaceChildren();
  for (const [key, label] of Object.entries(fields) as [Field, string][]) {
    const wrap = document.createElement('div');
    const l = document.createElement('label'); l.htmlFor = `fact-${key}`; l.textContent = label;
    const input = document.createElement('textarea'); input.rows = 2; input.id = `fact-${key}`; input.maxLength = 500; input.value = task.values[key]; input.placeholder = '未知；留空可明确确认未知'; input.setAttribute('aria-describedby', `evidence-${key} guidance-${key}`);
    const evidence = document.createElement('small'); evidence.id = `evidence-${key}`; evidence.textContent = `提取依据：${task.extraction.facts[key].evidence || '无可定位文字；请核实或保留未知'}${task.changes.some(c => c.field === key) ? '（此字段有人工修订，见证据 JSON）' : ''}`;
    const guidance = document.createElement('p'); guidance.id = `guidance-${key}`; guidance.className = 'fact-guidance';
    const updateGuidance = () => { guidance.textContent = fieldGuidance(key, input.value); guidance.hidden = !guidance.textContent; };
    updateGuidance();
    input.addEventListener('input', () => { updateGuidance(); dirty = true; clearChecks(); updateGates(); });
    wrap.append(l, input, evidence, guidance); container.append(wrap);
  }
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
    if (task?.id === id) { error(e instanceof Error ? e.message : '读取失败'); notice('读取任务失败；可以删除当前任务，或重新打开页面。'); }
  }
}
el('edit-form').addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    if (!task) return;
    const reason = el<HTMLInputElement>('edit-reason').value.trim();
    if (!reason) throw new Error('请填写修改依据。');
    const values = Object.fromEntries(Object.keys(fields).map(k => [k, el<HTMLTextAreaElement>(`fact-${k}`).value]));
    const content = Object.fromEntries(['original', 'summary', 'description'].map(key => [key, el<HTMLTextAreaElement>(`content-${key}`).value]));
    task = await api<PublicTask>(`/tasks/${task.id}/edit`, 'POST', { revision: task.revision, values, reason, ...(contentEditing ? { content } : {}) });
    render(); notice('已保存修改；旧确认与检测已失效，请重新检测。');
  });
});
el('audit').addEventListener('click', () => void action(async () => {
  if (!task) return;
  notice('服务端正在对本次导出的完整 HTML 运行 axe 检测…');
  task = await api<PublicTask>(`/tasks/${task.id}/audit`, 'POST', { revision: task.revision });
  render(); notice('检测完成。请查看问题与人工检查项，再逐项确认。');
}));
for (const key of ['original', 'summary', 'description']) el(`content-${key}`).addEventListener('input', () => { dirty = true; clearChecks(); updateGates(); });
el('review-form').addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    if (!task || dirty) throw new Error('请先保存修改并重新检测。');
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
el('large').addEventListener('click', () => { const active = document.documentElement.classList.toggle('large'); el('large').setAttribute('aria-pressed', String(active)); });
async function init() {
  try {
    const config = await api<{ fields: Record<Field, string>; sampleText: string; provider: { live: boolean; limit: number; timeoutMs?: number | null; configError?: string | null }; contentEditing?: boolean }>('/config'); fields = config.fields; sampleText = config.sampleText;
    modelTimeoutSeconds = Math.ceil((config.provider.timeoutMs ?? 30000) / 1000);
    contentEditing = config.contentEditing === true;
    el('content-editor').hidden = !contentEditing;
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
