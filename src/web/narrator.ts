import type { PublicTask } from '../contracts.js';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const base = new URL('.', import.meta.url);
const introduction = '你好，这里是赛博公益。这段是固定介绍，不是实时 AI 对话。想把海报整理成方便阅读的文字，可以先核对时间、地点和报名方式。不清楚的就保留未知，核对完成后再下载。';
interface Config { configured: boolean; reason: string; maxSeconds: number; }
export function initNarrator() {
  const dialog = el<HTMLDialogElement>('avatar-dialog'), viewport = el('avatar-viewport'), status = el('avatar-status');
  const demo = el<HTMLButtonElement>('avatar-demo'), read = el<HTMLButtonElement>('avatar-read'), stopButton = el<HTMLButtonElement>('avatar-stop');
  const consent = el<HTMLInputElement>('avatar-consent'), transcript = el('avatar-transcript');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let task: PublicTask | null = null, allowed = false, config: Config | undefined, frame: HTMLIFrameElement | undefined;
  let attemptId = '', epoch = 0, active = false, fingerprint = '', deadline: ReturnType<typeof setTimeout> | undefined;
  const api = async (path: string, data?: unknown, keepalive = false) => {
    const response = await fetch(new URL(`api/${path}`, base), { ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CyberCare': '1' }, body: JSON.stringify(data) }), keepalive });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '连接未完成。');
    return result;
  };
  function gates() { demo.disabled = active || reduced.matches || !consent.checked || !config?.configured; read.disabled = demo.disabled || !allowed; stopButton.disabled = !active; }
  async function stop(message = '播放已停止，首页的 2D 角色还可以继续使用。', clearText = false) {
    const oldId = attemptId, version = ++epoch;
    attemptId = ''; active = false; clearTimeout(deadline);
    frame?.remove(); frame = undefined; viewport.hidden = true;
    if (clearText) transcript.textContent = '';
    status.textContent = message; gates();
    if (oldId) {
      try { await api('avatar/stop', { attemptId: oldId }, true); }
      catch { if (version === epoch) status.textContent = '本机播放已停止，但星云会话关闭未获确认；重新打开可重试，若持续异常请到星云控制台核对。'; }
    }
  }
  async function refresh() {
    const version = epoch;
    try { const next = await api('avatar/config') as Config; if (version !== epoch || !dialog.open) return; config = next; status.textContent = reduced.matches ? '系统已开启减少动态，虚拟人播放已关闭；原有文字内容仍可阅读。' : next.reason; }
    catch { if (version === epoch) { config = undefined; status.textContent = '暂时读不到语音虚拟人的配置，首页的 2D 角色还可以继续使用。'; } }
    gates();
  }
  function open() { if (!dialog.open) dialog.showModal(); void refresh(); }
  async function play(poster: boolean) {
    if (active || reduced.matches || !consent.checked || !config?.configured || (poster && !allowed)) return;
    const version = ++epoch; active = true; gates();
    status.textContent = '正在连接星云；连接成功后会播放声音。';
    try {
      let text = introduction;
      if (poster) {
        const current = task!;
        const narration = await api(`tasks/${current.id}/narration`, { revision: current.revision, permission: true });
        if (version !== epoch) return;
        if (Date.parse(narration.expiresAt) <= Date.now() || !allowed) { await stop('海报已变化或到期，请重新核对。', true); return; }
        text = narration.text;
      }
      if (version !== epoch) return;
      transcript.textContent = text;
      attemptId = crypto.randomUUID();
      frame = document.createElement('iframe'); frame.title = '星云虚拟人播报画面'; frame.allow = "microphone 'none'; camera 'none'; geolocation 'none'";
      const currentFrame = frame, currentAttempt = attemptId;
      frame.addEventListener('load', () => {
        if (version === epoch) currentFrame.contentWindow?.postMessage({ type: 'start', text, attemptId: currentAttempt }, location.origin);
      });
      frame.src = new URL('avatar-stage.html', base).href; viewport.replaceChildren(frame); viewport.hidden = false;
      deadline = setTimeout(() => { void stop('本次讲解已到时限，播放已停止。你还可以阅读下方文字。'); }, Math.min(120, config.maxSeconds) * 1000);
    } catch (error) { if (version === epoch) await stop(error instanceof Error ? error.message : '讲解未完成，已回退原有角色。'); }
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow || !active || event.data?.source !== 'cybercare-avatar' || event.data.attemptId !== attemptId) return;
    const message = event.data;
    if (message.type === 'diagnostic' && typeof message.text === 'string' && message.text.length < 200) dialog.dataset.connectionDiagnostic = message.text;
    if (message.type === 'progress') status.textContent = '正在准备虚拟人画面…';
    if (message.type === 'submitted') status.textContent = '文字已交给星云，正在等待声音。';
    if (message.type === 'speaking') status.textContent = '正在播报。下方保留完整讲解文字。';
    if (message.type === 'ended') { void stop('本次播报结束，已断开连接。'); }
    if (message.type === 'failed') { dialog.dataset.failureCode = typeof message.text === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(message.text) ? message.text : 'SDK_FAILURE'; config = undefined; void stop('星云连接或播报未完成，已回退原有角色。请检查账号配置，文字仍可阅读。'); }
  });
  el('avatar-open').addEventListener('click', open);
  el<HTMLButtonElement>('avatar-open').disabled = false;
  el('narrate-poster').addEventListener('click', open);
  el('avatar-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { consent.checked = false; void stop(undefined, true); });
  consent.addEventListener('change', () => { if (!consent.checked && active) void stop('你已取消同意播报，播放已停止。'); gates(); });
  demo.addEventListener('click', () => { void play(false); }); read.addEventListener('click', () => { void play(true); });
  stopButton.addEventListener('click', () => { void stop(); });
  el('avatar-refresh').addEventListener('click', () => { if (!active) void refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) void stop('页面已隐藏，播放与连接已停止。', true); });
  window.addEventListener('pagehide', () => { void stop(undefined, true); });
  window.addEventListener('hashchange', () => { if (active || dialog.open) { dialog.close(); void stop(undefined, true); } });
  reduced.addEventListener('change', event => { if (event.matches && active) void stop('已开启减少动态，虚拟人播放已停止。'); gates(); });
  gates();
  return { setContext(current: PublicTask | null, canRead: boolean) {
    const next = `${current?.id}:${current?.revision}:${canRead}`;
    if (next !== fingerprint) { fingerprint = next; if (active) void stop('海报状态已变化，播放已停止。请核对当前版本。', true); else transcript.textContent = ''; }
    task = current; allowed = canRead && current?.status === 'completed'; gates();
  } };
}
