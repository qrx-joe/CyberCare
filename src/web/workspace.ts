import type { PublicTask } from '../contracts.js';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const profiles = { xiaohe: { name: '小禾', avatar: '禾' }, acheng: { name: '阿澄', avatar: '澄' } };
type Profile = keyof typeof profiles;
type Page = 'home' | 'workbench' | 'me' | 'audio' | 'guide';
const identityKey = 'cybercare.demo-identity.v1';
const preferencesKey = 'cybercare.reading-preferences.v1';

/** Presentation state only: no task content, session cookies or credentials enter browser storage. */
export function initWorkspace(options: { continueTask: () => void; setLarge: (active: boolean) => void; setMotion: (active: boolean) => void }) {
  const dialog = element<HTMLDialogElement>('login-dialog');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let opener: HTMLElement | null = null;
  let profile: Profile | null = null;
  let preferences = { large: false, reduceMotion: false };
  let storageUnavailable = false;
  const announce = (text: string) => { element('workspace-message').textContent = text; };
  function read(key: string, scope: 'localStorage' | 'sessionStorage'): unknown {
    try { return JSON.parse(window[scope].getItem(key) ?? 'null'); }
    catch { return null; }
  }
  function write(key: string, value: unknown, scope: 'localStorage' | 'sessionStorage') {
    try {
      if (value === null) window[scope].removeItem(key);
      else window[scope].setItem(key, JSON.stringify(value));
    } catch { storageUnavailable = true; }
    if (storageUnavailable) announce('浏览器未允许保存设置。本页仍可体验，刷新后身份或偏好可能无法保留。');
  }
  const savedIdentity = read(identityKey, 'sessionStorage') as { version?: unknown; profile?: unknown } | null;
  if (savedIdentity?.version === 1 && (savedIdentity.profile === 'xiaohe' || savedIdentity.profile === 'acheng')) profile = savedIdentity.profile;
  const savedPreferences = read(preferencesKey, 'localStorage') as { version?: unknown; large?: unknown; reduceMotion?: unknown } | null;
  if (savedPreferences?.version === 1 && typeof savedPreferences.large === 'boolean' && typeof savedPreferences.reduceMotion === 'boolean') {
    preferences = { large: savedPreferences.large, reduceMotion: savedPreferences.reduceMotion };
  }

  function pageFor(hash: string): Page {
    if (hash === '#audio' || hash === '#guide') return hash.slice(1) as Page;
    if (['#workbench', '#task-station', '#input-title'].includes(hash)) return 'workbench';
    return hash === '#me' ? 'me' : 'home';
  }
  function showPage(hash: string, focus: boolean) {
    const page = pageFor(hash);
    for (const section of document.querySelectorAll<HTMLElement>('[data-page]')) section.hidden = section.dataset.page !== page;
    for (const link of document.querySelectorAll<HTMLElement>('[data-page-link]')) {
      if (link.dataset.pageLink === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = { home: '赛博公益 · 求求你了，听我把话说完', workbench: '海报工作台 · 赛博公益', me: '我的工作台 · 赛博公益', audio: '语音转写 · 赛博公益', guide: '截图指导 · 赛博公益' }[page];
    if (hash === '#sample-preview') element<HTMLDetailsElement>('sample-preview').open = true;
    if (hash === '#quick-learn') element('learn-open').click();
    if (focus) {
      const target = element(hash === '#sample-preview' ? 'sample-preview-toggle' : hash === '#quick-learn' ? 'learn-title'
        : hash === '#input-title' || hash === '#task-station' ? 'input-title' : { home: 'headline', workbench: 'task-title', me: 'my-title', audio: 'audio-title', guide: 'guide-title' }[page]);
      target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true });
      if (['#home', '#workbench', '#me', '#audio', '#guide', ''].includes(hash)) window.scrollTo({ top: 0, behavior: 'auto' });
      else target.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }
  function navigate(page: Page) {
    const hash = `#${page}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    showPage(hash, true);
  }
  // Keep native fragments and browser history; switching views never reloads the active task.
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    if (!link) return;
    const hash = link.getAttribute('href')!;
    if (!['#home', '#me', '#workbench', '#audio', '#guide', '#task-station', '#input-title', '#sample-preview', '#quick-learn'].includes(hash)) return;
    event.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    showPage(hash, true);
  }, { capture: true });
  window.addEventListener('hashchange', () => showPage(location.hash, true));

  function syncIdentity() {
    const identity = profile ? profiles[profile] : null;
    element('account-label').textContent = identity ? identity.name : '演示登录';
    element('account-avatar').textContent = identity?.avatar ?? '↗';
    if (identity) element('account-open').removeAttribute('aria-haspopup');
    else element('account-open').setAttribute('aria-haspopup', 'dialog');
    element('account-open').setAttribute('aria-label', identity ? `${identity.name}的工作台，演示身份` : '演示登录');
    element('profile-avatar').textContent = identity?.avatar ?? '↗';
    element('profile-name').textContent = identity ? `你好，${identity.name}。` : '你好，来访的朋友。';
    element('profile-description').textContent = identity ? '称呼选好了，接着核对海报吧。' : '不用登录，也能核对和导出海报。';
    element('profile-login').textContent = identity ? '更换演示身份' : '选择演示身份';
    element('profile-logout').hidden = !identity;
  }
  function syncPreferences() {
    element<HTMLInputElement>('preference-large').checked = preferences.large;
    options.setLarge(preferences.large);
    element<HTMLInputElement>('preference-motion').checked = preferences.reduceMotion || reducedMotion.matches;
    element<HTMLInputElement>('preference-motion').disabled = reducedMotion.matches;
    element('preference-motion-help').textContent = reducedMotion.matches ? '已跟随系统减少动态，角色动作保持关闭。' : '角色不再动，文字互动照常使用。';
    options.setMotion(!preferences.reduceMotion);
  }
  const savePreferences = () => write(preferencesKey, { version: 1, ...preferences }, 'localStorage');
  element('preference-large').addEventListener('change', () => {
    preferences.large = element<HTMLInputElement>('preference-large').checked; syncPreferences(); savePreferences();
  });
  element('large').addEventListener('click', () => {
    preferences.large = document.documentElement.classList.contains('large');
    element<HTMLInputElement>('preference-large').checked = preferences.large; savePreferences();
  });
  element('preference-motion').addEventListener('change', () => {
    preferences.reduceMotion = element<HTMLInputElement>('preference-motion').checked; syncPreferences(); savePreferences();
  });
  element('host-motion').addEventListener('click', () => {
    preferences.reduceMotion = element('host-motion').getAttribute('aria-pressed') !== 'true';
    element<HTMLInputElement>('preference-motion').checked = preferences.reduceMotion; savePreferences();
  });
  reducedMotion.addEventListener('change', syncPreferences);

  function syncLoginChoice() {
    const selected = dialog.querySelector<HTMLInputElement>('input[name="demo-profile"]:checked')?.value;
    if (selected === 'xiaohe' || selected === 'acheng') element('login-submit').textContent = `以${profiles[selected].name}的身份体验 ↗`;
  }
  function openLogin(trigger: HTMLElement) {
    opener = trigger;
    const radio = dialog.querySelector<HTMLInputElement>(`input[value="${profile ?? 'xiaohe'}"]`)!;
    radio.checked = true; syncLoginChoice();
    element('login-guest').textContent = profile ? '保留当前身份，返回' : '先以游客继续';
    dialog.showModal(); document.body.classList.add('dialog-open');
    radio.focus();
  }
  dialog.addEventListener('close', () => { document.body.classList.remove('dialog-open'); opener?.focus({ preventScroll: true }); });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:checked')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  element('login-close').addEventListener('click', () => dialog.close());
  element('login-guest').addEventListener('click', () => dialog.close());
  element('account-open').addEventListener('click', () => profile ? navigate('me') : openLogin(element('account-open')));
  element('profile-login').addEventListener('click', () => openLogin(element('profile-login')));
  element('login-form').addEventListener('change', syncLoginChoice);
  element('login-form').addEventListener('submit', event => {
    event.preventDefault();
    const selected = dialog.querySelector<HTMLInputElement>('input[name="demo-profile"]:checked')?.value;
    if (selected !== 'xiaohe' && selected !== 'acheng') return;
    profile = selected; syncIdentity(); opener = null; dialog.close(); navigate('me');
    announce(`这次就叫${profiles[selected].name}。称呼只在当前标签页记住，刷新后任务无法恢复。`);
    write(identityKey, { version: 1, profile }, 'sessionStorage');
  });
  element('profile-logout').addEventListener('click', () => {
    profile = null; syncIdentity();
    announce('已退出演示身份。本页任务和阅读偏好仍在，可继续以游客使用。');
    write(identityKey, null, 'sessionStorage'); element('profile-login').focus();
  });
  element('session-continue').addEventListener('click', () => { navigate('workbench'); options.continueTask(); });
  syncIdentity(); syncPreferences(); showPage(location.hash, false);

  return {
    setTask(task: PublicTask | null) {
      const states = { processing: '正在整理', needs_review: '等待核对', completed: '可导出', failed: '处理失败', cancelled: '已取消' };
      element('session-state').textContent = task ? states[task.status] : '尚未开始';
      element('session-state').dataset.state = task?.status ?? 'empty';
      element('session-description').textContent = !task ? '选一张海报开始，也可以先用内置样例试试。'
        : { processing: '海报正在整理，可以去工作台看进度，也可以取消。', needs_review: '草稿准备好了。请对照材料核对，检测后再逐项确认。', completed: '核对完成了，可以下载文字、大字 HTML 和核对记录。', failed: '这次没处理成功，去工作台看看原因和接下来怎么做。', cancelled: '任务已取消，回工作台删除后就能重新开始。' }[task.status];
      element('session-expiry').hidden = !task;
      element('session-expiry').textContent = task ? `${new Date(task.expiresAt).toLocaleString('zh-CN')} 到期；想留的结果，到期前记得导出。` : '';
      element('session-continue').textContent = task ? { processing: '查看处理进度 ↗', needs_review: '继续核对 ↗', completed: '前往导出结果 ↗', failed: '查看处理说明 ↗', cancelled: '返回海报工作台 ↗' }[task.status] : '开始核对海报 ↗';
    },
  };
}
