import type { PublicTask } from '../contracts.js';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const lessons = [
  { title: '图片里的字，谁来读？', text: '海报上的字，读屏软件不一定能读出来。另附一份文字，依赖读屏的人就能多一种办法了解活动。', source: '资料：W3C 图片教程', url: 'https://www.w3.org/WAI/tutorials/images/' },
  { title: '“一张活动海报”，这就够了吗？', text: '光写“一张活动海报”，还不知道活动在哪、几点开始、怎么报名。图里写了什么，文字就要说明白；图里没写的，也别替它编。', source: '资料：W3C 图片教程', url: 'https://www.w3.org/WAI/tutorials/images/' },
  { title: '自动检测零问题，就能放心了吗？', text: '工具能查出一些无障碍问题，但页面好不好用，还得由人来试。信息有没有错、读屏顺不顺、接收者能不能读懂，都需要另外核对和测试。', source: '资料：W3C 无障碍评估', url: 'https://www.w3.org/WAI/test-evaluate/' },
];
const banter = ['头可以先不磕，活动时间可不能瞎编。', '我负责把话说明白，你负责决定要不要继续。成交？', '今天不卷功德值。先把“报名方式未知”老实留下来。', '都看到这里了，要不顺手看看那张海报？不催，真的。'];
const greetings = { processing: '材料收到了，我先整理。你等会儿帮我核对关键内容。', needs_review: '草稿来了。我不确定的地方会留空，别急着替它编个答案。', completed: '这次咱俩都站着。核对回执已经准备好，去看看。', failed: '这次没处理好。先把问题说明白，再决定重试还是换人工转录。', cancelled: '收到，先停在这里。你随时可以删除这次任务。' };

// Replaced at build time only when the generated, local-only sprite atlas exists.
const AVATAR_ATLAS = '__CYBERCARE_AVATAR_ATLAS__';
const KOWTOW_ATLAS = '__CYBERCARE_KOWTOW_ATLAS__';

/** Render actual expression frames; never animate the poster or card background. */
class SpriteAvatar {
  ready = false;
  bowReady = false;
  private image = new Image();
  private bowImage = new Image();
  private enabled = false;
  private visible = true;
  private sequenceTimer?: ReturnType<typeof setTimeout>;
  private blinkTimer?: ReturnType<typeof setTimeout>;
  private busyUntil = 0;
  private observer: IntersectionObserver;
  private canvas = element<HTMLCanvasElement>('avatar-canvas');
  private stage = element('character-frame');
  private context = this.canvas.getContext('2d');

  constructor(private onVisualChange: () => void) {
    this.observer = new IntersectionObserver(entries => {
      this.visible = entries[0]?.isIntersecting ?? false;
      this.sync();
    }, { threshold: .05 });
    this.observer.observe(this.stage);
    document.addEventListener('visibilitychange', () => this.sync());
    window.addEventListener('pagehide', () => { this.stop(); this.observer.disconnect(); });
    this.image.onload = () => {
      const ratio = (this.image.naturalWidth / 4) / (this.image.naturalHeight / 2);
      // Reject an obviously wrong layout; original reference remains the fallback.
      if (!this.context || this.image.naturalWidth < 512 || ratio < .6 || ratio > 1.5) {
        this.stage.dataset.avatarState = 'fallback'; this.onVisualChange(); return;
      }
      this.ready = true; this.draw(0); this.sync(); this.onVisualChange();
    };
    this.image.onerror = () => { this.stage.dataset.avatarState = 'fallback'; this.onVisualChange(); };
    if (AVATAR_ATLAS && !AVATAR_ATLAS.startsWith('__CYBERCARE')) this.image.src = AVATAR_ATLAS;
    else this.stage.dataset.avatarState = 'fallback';
    this.bowImage.onload = () => {
      const ratio = (this.bowImage.naturalWidth / 4) / (this.bowImage.naturalHeight / 2);
      this.bowReady = this.bowImage.naturalWidth >= 512 && ratio >= .6 && ratio <= 1.5;
      this.onVisualChange();
    };
    this.bowImage.onerror = () => { this.bowReady = false; this.onVisualChange(); };
    if (KOWTOW_ATLAS && !KOWTOW_ATLAS.startsWith('__CYBERCARE')) this.bowImage.src = KOWTOW_ATLAS;
  }

  private active() { return this.ready && this.enabled && this.visible && !document.hidden; }
  private draw(index: number, image = this.image) {
    if (!this.ready || !this.context) return;
    const w = image.naturalWidth / 4, h = image.naturalHeight / 2;
    const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(image, index % 4 * w, Math.floor(index / 4) * h, w, h,
      (this.canvas.width - w * scale) / 2, (this.canvas.height - h * scale) / 2, w * scale, h * scale);
    this.stage.dataset.avatarFrame = String(index);
    this.stage.dataset.avatarSheet = image === this.bowImage ? 'kowtow' : 'expressions';
    element('bow-sound').hidden = image !== this.bowImage || index !== 4;
  }
  private stop() {
    clearTimeout(this.sequenceTimer); clearTimeout(this.blinkTimer);
    this.busyUntil = 0;
    this.stage.classList.remove('bowing'); element('bow-sound').hidden = true;
    this.stage.dataset.motion = 'off';
    if (this.ready) { this.draw(0); this.stage.dataset.avatarState = 'paused'; }
  }
  private sync() {
    this.stop();
    if (!this.active()) return;
    this.stage.dataset.motion = 'on'; this.stage.dataset.avatarState = 'idle'; this.scheduleBlink();
  }
  setEnabled(value: boolean) { this.enabled = value; this.sync(); }
  private scheduleBlink() {
    clearTimeout(this.blinkTimer);
    if (!this.active()) return;
    this.blinkTimer = setTimeout(() => {
      if (Date.now() >= this.busyUntil) this.sequence([0, 1, 2, 1, 0], 85, 'blinking');
      else this.scheduleBlink();
    }, 2800 + Math.random() * 1800);
  }
  private sequence(frames: number[], interval: number | number[], state: string, image = this.image) {
    if (!this.active()) return;
    clearTimeout(this.sequenceTimer); clearTimeout(this.blinkTimer);
    this.busyUntil = Date.now() + (typeof interval === 'number' ? frames.length * interval : interval.reduce((a, b) => a + b, 0));
    this.stage.dataset.avatarState = state;
    this.stage.classList.toggle('bowing', state === 'bowing');
    let index = 0;
    const advance = () => {
      if (!this.active()) { this.stop(); return; }
      const next = frames[index++];
      if (next === undefined) {
        this.stage.classList.remove('bowing');
        this.draw(0); this.busyUntil = 0; this.stage.dataset.avatarState = 'idle'; this.scheduleBlink(); return;
      }
      this.draw(next, image); this.sequenceTimer = setTimeout(advance, typeof interval === 'number' ? interval : interval[index - 1]);
    };
    advance();
  }
  speak(length: number) {
    if (!this.active()) return;
    const frames = Array.from({ length: Math.min(15, Math.max(6, Math.ceil(length / 4))) }, (_, i) => [3, 4, 3, 0][i % 4]!);
    this.sequence(frames, 120, 'talking');
  }
  bow() {
    if (this.bowReady) this.sequence([0, 1, 2, 3, 4, 5, 6, 7], [100, 150, 150, 170, 520, 150, 150, 160], 'bowing', this.bowImage);
  }
}

/** Attention stays in the browser. These lines never masquerade as model output. */
export function initHost() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const speech = element('host-speech');
  let motion = !reduced.matches, lesson = 0, bows = 0;
  let lastStage: PublicTask['status'] | null = null;
  const reference = element<HTMLImageElement>('character-image');
  let referenceFailed = false;
  const syncVisual = () => {
    reference.hidden = avatar.ready || referenceFailed;
    element('avatar-animation').hidden = !avatar.ready;
    element('character-fallback').hidden = avatar.ready || !referenceFailed;
    element('avatar-kind').textContent = avatar.ready ? '2D 动态角色 · 本地帧动画' : referenceFailed ? '文字角色 · 图片暂不可用' : '静态参考图 · 动画暂不可用';
    syncMotion();
  };
  const avatar = new SpriteAvatar(syncVisual);
  const say = (line: string) => { speech.textContent = line; avatar.speak(line.length); };
  const syncMotion = () => {
    const allowed = avatar.ready && motion && !reduced.matches;
    element('host-motion').setAttribute('aria-pressed', String(allowed));
    element('host-motion').textContent = avatar.ready ? `角色动作：${allowed ? '开' : '关'}` : '角色动作：不可用';
    element<HTMLButtonElement>('host-motion').disabled = reduced.matches || !avatar.ready;
    element('bow-kind').textContent = allowed && avatar.bowReady ? '2D 磕头' : '文字互动';
    avatar.setEnabled(allowed);
  };
  syncMotion();
  reduced.addEventListener('change', () => { if (reduced.matches) motion = false; syncMotion(); });
  element('host-motion').addEventListener('click', () => { motion = !motion; syncMotion(); });
  element('host-bow').addEventListener('click', () => {
    bows++;
    const allowed = avatar.ready && avatar.bowReady && motion && !reduced.matches;
    say(allowed ? (bows === 1 ? '这次认真磕一个。接下来，帮我看看一张海报？' : '再磕一个。然后一起核对一条信息，好不好？') : '动作先省了，我用文字打个招呼。接下来，帮我看看一张海报？');
    if (allowed) avatar.bow();
  });
  element('host-banter').addEventListener('click', () => say(banter[Math.floor(Math.random() * banter.length)]!));
  const showLesson = () => {
    element('quick-learn').hidden = false;
    element('learn-open').setAttribute('aria-expanded', 'true');
    element('learn-title').focus({ preventScroll: true });
    element('quick-learn').scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
  };
  for (const id of ['learn-open', 'nav-learn']) element(id).addEventListener('click', event => { event.preventDefault(); showLesson(); });
  element('learn-next').addEventListener('click', () => {
    lesson = (lesson + 1) % lessons.length;
    const item = lessons[lesson]!;
    element('learn-title').textContent = item.title; element('learn-text').textContent = item.text;
    element('learn-source').textContent = item.source; element<HTMLAnchorElement>('learn-source').href = item.url;
    element('learn-index').textContent = `科普示例 ${lesson + 1} / ${lessons.length} · 固定三条，非每日更新`;
    element('learn-title').focus({ preventScroll: true });
  });
  for (const id of ['hero-task', 'learn-task']) element(id).addEventListener('click', event => {
    event.preventDefault();
    say('今天先做这一件：核对海报里的时间、地点和报名方式。不知道的，就保留未知。');
    element('input-title').setAttribute('tabindex', '-1'); element('input-title').focus({ preventScroll: true });
    element('task-station').scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
  });
  const useFallback = () => { referenceFailed = true; syncVisual(); };
  reference.addEventListener('error', useFallback);
  if (reference.complete && reference.naturalWidth === 0) useFallback();
  syncVisual();
  return {
    setMotion(enabled: boolean) { motion = enabled; syncMotion(); },
    setTask(task: PublicTask | null) {
      const stage = task?.status ?? null;
      if (stage === lastStage) return;
      lastStage = stage;
      say(stage ? greetings[stage] : '这次资料已清空。先歇一会儿，或者再做一张。');
    },
  };
}
