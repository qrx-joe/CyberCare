import type { PublicAssistanceTask } from '../contracts.js';
const { audioReviewHints } = await import(new URL('audio-review.js', import.meta.url).href) as typeof import('../audio-review.js');

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const base = new URL('api/assistance', import.meta.url);
class AssistanceApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function api<T>(path = '', method = 'GET', data?: unknown, key?: string): Promise<T> {
  const response = await fetch(`${base.href}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CyberCare': '1', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new AssistanceApiError(response.status, result.message || '状态读取失败，请重新读取，不要重复提交材料。');
  return result;
}
function toBase64(bytes: Uint8Array) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function wav(file: File) {
  if (!file.size || file.size > 10 * 1024 * 1024 || !/\.(wav|mp3|m4a|ogg|webm)$/i.test(file.name)) throw new Error('请选择最多 10 MB 的 WAV、MP3、M4A、OGG 或 WebM。');
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration < .1 || decoded.duration > 60) throw new Error('首版支持 0.1–60 秒的短音频，请先截取需要的片段。');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000), source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering(), pcm = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
    const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const n = Math.max(-1, Math.min(1, pcm[i]!)); view.setInt16(44 + i * 2, n < 0 ? n * 32768 : n * 32767, true); }
    return { name: 'local-converted.wav', data: toBase64(new Uint8Array(buffer)) };
  } finally { await context.close(); }
}

export function initAssistance() {
  for (const kind of ['audio', 'guide'] as const) {
    const el = <T extends HTMLElement = HTMLElement>(name: string) => element<T>(`${kind}-${name}`);
    const form = el<HTMLFormElement>('form'), mode = el<HTMLSelectElement>('mode'), file = el<HTMLInputElement>('file');
    const confirmed = el<HTMLInputElement>('confirmed');
    let task: PublicAssistanceTask | null = null, epoch = 0, busy = false, continuing = false, until = 0, preview = '', timer: ReturnType<typeof setTimeout> | undefined;
    let requestKey: string | undefined, signature = '', ids = new Set<string>(), mutation = 0, readInterrupted = false;
    const notice = (message: string) => { el('status').textContent = message; };
    const dirty = () => Boolean(kind === 'audio' && task?.audio && (el<HTMLTextAreaElement>('text').value !== (task.reviewed?.text ?? task.audio.original) || el<HTMLTextAreaElement>('summary').value !== (task.reviewed?.summary ?? task.audio.summary.map(s => s.text).join('\n'))));
    function gates() {
      const locked = busy || readInterrupted || Boolean(task && !continuing);
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,button,select,textarea')) control.disabled = locked;
      if (continuing) { mode.disabled = true; el<HTMLInputElement>('goal').disabled = true; }
      el('cancel').hidden = task?.status !== 'processing';
      el<HTMLButtonElement>('cancel').disabled = busy || readInterrupted;
      el('retry').hidden = !readInterrupted;
      el<HTMLButtonElement>('review').disabled = busy || readInterrupted || !task || !['needs_review', 'completed'].includes(task.status) || !confirmed.checked || dirty();
      for (const type of ['text', 'receipt']) el<HTMLButtonElement>(`${type}-export`).disabled = busy || readInterrupted || task?.status !== 'completed' || dirty();
      if (kind === 'audio') {
        el<HTMLButtonElement>('save').disabled = busy || readInterrupted || !dirty();
        for (const name of ['text', 'summary', 'reason']) el<HTMLTextAreaElement>(name).disabled = busy || readInterrupted;
        const hints = audioReviewHints(task?.audio, el<HTMLTextAreaElement>('text').value, el<HTMLTextAreaElement>('summary').value);
        el('consistency').textContent = hints.map(hint => hint.message).join('\n'); el('consistency').hidden = !hints.length;
      } else el<HTMLButtonElement>('continue').disabled = busy || readInterrupted || task?.status !== 'completed' || task.guidance?.risk === 'sensitive';
    }
    function revoke() {
      if (preview) URL.revokeObjectURL(preview); preview = '';
      const target = el<HTMLMediaElement | HTMLImageElement>('preview');
      if (target instanceof HTMLMediaElement) { target.pause(); target.removeAttribute('src'); target.load(); } else target.removeAttribute('src');
      target.hidden = true;
    }
    function modeView() {
      el('file-group').hidden = mode.value !== 'live';
      if (kind === 'audio') el('manual-group').hidden = mode.value !== 'manual';
      else { el('sample').hidden = mode.value !== 'sample'; el<HTMLInputElement>('goal').readOnly = mode.value === 'sample'; }
      el<HTMLInputElement>('source').value = mode.value === 'sample' ? '开发者原创合成示例，非真实材料' : '';
      el<HTMLInputElement>('permission').checked = false;
    }
    function render(next: PublicAssistanceTask, preserveDraft = false) {
      const draft = preserveDraft && next.id === task?.id && next.revision === task.revision && dirty()
        ? { text: el<HTMLTextAreaElement>('text').value, summary: el<HTMLTextAreaElement>('summary').value } : null;
      task = next; ids.add(next.id); until = until ? Math.min(until, Date.parse(next.expiresAt)) : Date.parse(next.expiresAt);
      el('meta').textContent = `${next.id} · 版本 ${next.revision} · ${new Date(until).toLocaleString('zh-CN')} 到期`;
      notice({ processing: '正在处理，可取消；不会自动重试模型请求。', needs_review: '结果已准备，请对照材料核对。', completed: '当前版本已确认，可以导出。', failed: next.error ?? '处理失败，请查看配置或改用人工文字。', cancelled: '已取消。已发出的模型请求可能仍计费。' }[next.status]);
      el('result').hidden = !next.audio && !next.guidance;
      confirmed.checked = false;
      if (next.audio || next.guidance) el('label').textContent = next.mode === 'sample' ? '合成固定示例，模型请求 0；不是音频或截图识别。' : next.mode === 'manual' ? '人工输入文字，模型请求 0；不是语音识别。' : 'StepFun AI 结果，需要人工核对；不证明事实准确或操作安全。';
      if (next.audio) {
        el('original').textContent = next.audio.original;
        el('evidence').textContent = ['摘要依据（初次转写）', ...next.audio.summary.map(s => `${s.text}\n依据：${s.evidence}`), '关键事项（初次转写，人工修改后须重新核实）', ...next.audio.facts.map(f => `${f.kind}: ${f.text}\n依据：${f.evidence}`)].join('\n\n');
        el<HTMLTextAreaElement>('text').value = next.reviewed?.text ?? next.audio.original;
        el<HTMLTextAreaElement>('summary').value = next.reviewed?.summary ?? next.audio.summary.map(s => s.text).join('\n');
        if (draft) { el<HTMLTextAreaElement>('text').value = draft.text; el<HTMLTextAreaElement>('summary').value = draft.summary; }
        el('warnings').textContent = [next.audio.summaryError, ...next.audio.uncertainties, '请回听核对数字、人名与听不清的片段；紧急、安全或医疗信息请核实原始来源。'].filter(Boolean).join('\n');
      }
      if (next.guidance) {
        const g = next.guidance;
        el('screen').textContent = g.screen;
        el('next').textContent = g.next?.action ?? '暂停操作：当前无法可靠提供可执行的一步。';
        el('position').textContent = g.next ? `位置：${g.next.position}\n可见控件：${g.next.target}\n识别依据：${g.next.evidence}` : '请先核实界面，不猜测控件或后续页面。';
        el('check').textContent = g.check;
        el('warnings').textContent = [...g.warnings, '请与实际界面对照；以上不代表已操作完成或安全认证。'].join('\n');
        el('continue').textContent = g.next ? '已操作，上传新截图继续' : '补充新截图继续';
      }
      if (draft) notice('已重新读取任务状态。未保存的文字仍保留，请保存并重新确认后再导出。');
      gates();
    }
    async function poll(version: number) {
      if (version !== epoch || !task) return;
      const startedMutation = mutation;
      try {
        const result = await api<PublicAssistanceTask>(`/${task.id}`);
        if (version !== epoch || startedMutation !== mutation) return;
        readInterrupted = false; render(result, true); if (result.status === 'processing') timer = setTimeout(() => { void poll(version); }, 700);
      } catch (error) {
        if (version !== epoch || startedMutation !== mutation) return;
        if (error instanceof AssistanceApiError && error.status === 404) { await clear('任务已删除或到期，本页资料已清空。'); return; }
        readInterrupted = true; notice(error instanceof Error ? error.message : '读取失败'); gates();
      }
    }
    async function clear(message = '已清空本页资料并删除可访问的临时任务。') {
      ++epoch; clearTimeout(timer); task = null; continuing = false; busy = false; readInterrupted = false; until = 0; requestKey = undefined; signature = '';
      revoke(); form.reset(); if (kind === 'audio') { for (const name of ['text', 'summary', 'reason']) el<HTMLInputElement>(name).value = ''; el('original').textContent = ''; el('evidence').textContent = ''; el('warnings').textContent = ''; }
      else { for (const name of ['screen', 'next', 'position', 'check', 'warnings']) el(name).textContent = ''; el('continuing').hidden = true; }
      confirmed.checked = false; el('result').hidden = true; el('meta').textContent = ''; el('retry').hidden = true; el<HTMLButtonElement>('retry').disabled = false; modeView(); gates(); notice(message);
      const oldIds = [...ids]; ids = new Set();
      await Promise.all(oldIds.map(async id => { try { await api(`/${id}`, 'DELETE'); } catch (error) { if (!(error instanceof AssistanceApiError && error.status === 404)) { ids.add(id); notice('本页资料已清空，服务端删除尚未确认。请再次点击删除；任务仍按原时间到期。'); } } }));
    }
    mode.addEventListener('change', () => { revoke(); file.value = ''; until = 0; if (kind === 'audio') el<HTMLTextAreaElement>('manual').value = ''; modeView(); });
    file.addEventListener('change', () => {
      revoke(); until ||= Date.now() + 30 * 60 * 1000;
      const selected = file.files?.[0]; if (!selected) return;
      if (selected.size > (kind === 'audio' ? 10 : 2) * 1024 * 1024 || (kind === 'guide' && !['image/png', 'image/jpeg', 'image/webp'].includes(selected.type))) { file.value = ''; notice('文件类型或大小不支持，请按输入框说明重新选择。'); return; }
      preview = URL.createObjectURL(selected); const target = el<HTMLMediaElement | HTMLImageElement>('preview'); target.src = preview; target.hidden = false;
    });
    if (kind === 'audio') for (const name of ['manual', 'source']) el(name).addEventListener('input', () => { until ||= Date.now() + 30 * 60 * 1000; });
    else for (const name of ['goal', 'source']) el(name).addEventListener('input', () => { until ||= Date.now() + 30 * 60 * 1000; });
    form.addEventListener('submit', event => {
      event.preventDefault(); if (busy || (task && !continuing)) return;
      const version = epoch; busy = true; gates(); notice('正在检查本地材料…');
      void (async () => {
        try {
          const payload: Record<string, unknown> = { kind, mode: mode.value, sourceNote: el<HTMLInputElement>('source').value, permission: el<HTMLInputElement>('permission').checked };
          if (!payload.permission) throw new Error('请先确认材料使用依据。');
          const selected = file.files?.[0];
          if (kind === 'audio') { if (mode.value === 'manual') payload.text = el<HTMLTextAreaElement>('manual').value; if (mode.value === 'live') { if (!selected) throw new Error('请选择短音频。'); payload.audio = await wav(selected); } }
          else { payload.goal = el<HTMLInputElement>('goal').value; if (continuing) payload.previousId = task!.id; if (mode.value === 'live') { if (!selected) throw new Error('请选择当前界面截图。'); payload.image = { name: selected.name, mime: selected.type, data: toBase64(new Uint8Array(await selected.arrayBuffer())) }; } }
          if (version !== epoch) return;
          if (until && until <= Date.now()) { await clear('本页材料已到期，请重新选择。'); return; }
          const nextSignature = JSON.stringify(payload);
          if (nextSignature !== signature) { signature = nextSignature; requestKey = crypto.randomUUID(); }
          notice('已提交本轮处理，模型调用无自动重试。');
          const result = await api<PublicAssistanceTask>('', 'POST', payload, requestKey);
          if (version !== epoch) { try { await api(`/${result.id}`, 'DELETE'); } catch { ids.add(result.id); } return; }
          continuing = false; if (kind === 'guide') el('continuing').hidden = true;
          render(result); if (result.status === 'processing') void poll(version);
        } catch (error) { if (version === epoch) notice(error instanceof Error ? error.message : '提交未完成，可用同一材料重试提交；不会自动更换请求编号。'); }
        finally { if (version === epoch) { busy = false; gates(); } }
      })();
    });
    const act = async (path: string, data?: unknown) => {
      if (!task || busy || readInterrupted) return; const version = epoch; mutation++; clearTimeout(timer); busy = true; gates();
      try { const next = await api<PublicAssistanceTask>(`/${task.id}/${path}`, 'POST', data); if (version === epoch) { readInterrupted = false; render(next); } }
      catch (error) { if (version === epoch) { readInterrupted = true; notice(`${error instanceof Error ? error.message : '操作失败'} 请重新读取任务状态，未自动重试操作。`); } }
      finally { if (version === epoch) { busy = false; gates(); } }
    };
    el('cancel').addEventListener('click', () => { void act('cancel'); });
    el('delete').addEventListener('click', () => { void clear(); });
    el('retry').addEventListener('click', () => { const version = epoch; el<HTMLButtonElement>('retry').disabled = true; void poll(version).finally(() => { if (version === epoch) el<HTMLButtonElement>('retry').disabled = false; }); });
    confirmed.addEventListener('change', gates);
    el('review').addEventListener('click', () => { if (task && confirmed.checked && !dirty()) void act('review', { revision: task.revision, confirmed: true }); });
    if (kind === 'audio') {
      for (const name of ['text', 'summary']) el(name).addEventListener('input', () => { confirmed.checked = false; gates(); });
      el('save').addEventListener('click', () => {
        if (!task) return;
        const reason = el<HTMLInputElement>('reason').value.trim(); if (!reason) { notice('请填写修改依据，再保存当前文字。'); return; }
        void act('edit', { revision: task.revision, text: el<HTMLTextAreaElement>('text').value, summary: el<HTMLTextAreaElement>('summary').value, reason });
      });
    } else el('continue').addEventListener('click', () => {
      if (readInterrupted || task?.status !== 'completed' || task.guidance?.risk === 'sensitive') return;
      continuing = true; revoke(); file.value = ''; el('continuing').hidden = false; gates();
      if (mode.value === 'live') file.focus(); else notice('合成示例只演示同一固定界面；真实继续需要切换至真实模式重新开始。');
    });
    for (const type of ['text', 'receipt']) el(`${type}-export`).addEventListener('click', () => {
      if (readInterrupted || task?.status !== 'completed' || dirty()) return;
      const a = document.createElement('a'); a.href = `${base.href}/${task.id}/${type}`; a.download = ''; document.body.append(a); a.click(); a.remove();
    });
    window.setInterval(() => { if (until && Date.now() >= until) void clear('本页材料与任务已到期，已清空；请重新开始。'); }, 1000);
    window.addEventListener('pagehide', revoke);
    modeView(); gates();
    void api<{ audio: boolean; guide: boolean; stopped: boolean; limit: number; requests: number }>('/config').then(config => {
      const live = mode.querySelector<HTMLOptionElement>('option[value=live]')!;
      live.disabled = !config[kind] || config.stopped || config.requests >= config.limit;
      live.textContent = live.disabled ? '真实模式 · 未配置或本进程已停止' : kind === 'audio' ? '真实音频转写 + 重点整理' : '真实截图 · 当前一步指导';
      notice('可以先用合成示例体验，或选择已配置的真实模式。');
    }).catch(() => notice('新版接口暂不可读，请先保存已有结果，再重启本地服务。'));
  }
}
