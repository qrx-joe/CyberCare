import type { PublicTask } from '../contracts.js';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const lessons = [
  { title: '图片里的字，谁来读？', text: '一张海报对你是活动信息，对依赖读屏的人，却可能只是一张没有说明的图片。给它一份等效文字，就多了一个获取信息的入口。', source: '资料：W3C 图片教程', url: 'https://www.w3.org/WAI/tutorials/images/' },
  { title: '“一张活动海报”，这就够了吗？', text: '如果活动时间、地点和报名方式都写在图里，只有一句“一张活动海报”还不够。文字替代内容需要传达图中实际提供的信息；原图没写的，也不要补一个答案。', source: '资料：W3C 图片教程', url: 'https://www.w3.org/WAI/tutorials/images/' },
  { title: '自动检测零问题，就能放心了吗？', text: '工具能发现一部分无障碍问题，却不能独自判断一个页面是否真正可用。内容是否准确、读屏是否顺畅、接收者是否读懂，仍然需要人工核对和实际使用测试。', source: '资料：W3C 无障碍评估', url: 'https://www.w3.org/WAI/test-evaluate/' },
];
const banter = ['头可以先不磕，活动时间可不能瞎编。', '我负责把话说明白，你负责决定要不要继续。成交？', '今天不卷功德值。先把“报名方式未知”老实留下来。', '都看到这里了，要不顺手看看那张海报？不催，真的。'];
const greetings = { processing: '材料收到了，我先整理。你等会儿帮我核对关键内容。', needs_review: '草稿来了。我不确定的地方会留空，别急着替它编个答案。', completed: '这次咱俩都站着。核对回执已经准备好，去看看。', failed: '这次没处理好。先把问题说明白，再决定重试还是换人工转录。', cancelled: '收到，先停在这里。你随时可以删除这次任务。' };

// Replaced at build time only when the generated, local-only sprite atlas exists.
const AVATAR_ATLAS = '__CYBERCARE_AVATAR_ATLAS__';

/** Render actual expression frames; never animate the poster or card background. */
class SpriteAvatar {
  ready = false;
  private image = new Image();
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
  }

  private active() { return this.ready && this.enabled && this.visible && !document.hidden; }
  private draw(index: number) {
    if (!this.ready || !this.context) return;
    const w = this.image.naturalWidth / 4, h = this.image.naturalHeight / 2;
    const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(this.image, index % 4 * w, Math.floor(index / 4) * h, w, h,
      (this.canvas.width - w * scale) / 2, (this.canvas.height - h * scale) / 2, w * scale, h * scale);
    this.stage.dataset.avatarFrame = String(index);
  }
  private stop() {
    clearTimeout(this.sequenceTimer); clearTimeout(this.blinkTimer);
    this.busyUntil = 0;
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
  private sequence(frames: number[], interval: number, state: string) {
    if (!this.active()) return;
    clearTimeout(this.sequenceTimer); clearTimeout(this.blinkTimer);
    this.busyUntil = Date.now() + frames.length * interval;
    this.stage.dataset.avatarState = state;
    let index = 0;
    const advance = () => {
      if (!this.active()) { this.stop(); return; }
      const next = frames[index++];
      if (next === undefined) {
        this.draw(0); this.busyUntil = 0; this.stage.dataset.avatarState = 'idle'; this.scheduleBlink(); return;
      }
      this.draw(next); this.sequenceTimer = setTimeout(advance, interval);
    };
    advance();
  }
  speak(length: number) {
    if (!this.active()) return;
    const frames = Array.from({ length: Math.min(15, Math.max(6, Math.ceil(length / 4))) }, (_, i) => [3, 4, 3, 0][i % 4]!);
    this.sequence(frames, 120, 'talking');
  }
  bow() { this.sequence([0, 7, 6, 6, 7, 0], 125, 'bowing'); }
}

/** Attention stays in the browser. These lines never masquerade as model output. */
export function initHost() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const frame = element('character-frame');
  const speech = element('host-speech');
  let motion = !reduced.matches, lesson = 0, bows = 0;
  let lastStage: PublicTask['status'] | null = null;
  let bowTimer: ReturnType<typeof setTimeout> | undefined;
  const reference = element<HTMLImageElement>('character-image');
  let referenceFailed = false;
  const syncVisual = () => {
    reference.hidden = avatar.ready || referenceFailed;
    element('avatar-animation').hidden = !avatar.ready;
    element('character-fallback').hidden = avatar.ready || !referenceFailed;
    element('avatar-kind').textContent = avatar.ready ? '2D 动态角色 · 本地帧动画' : '静态参考图 · 动画素材未就绪';
  };
  const avatar = new SpriteAvatar(syncVisual);
  const say = (line: string) => { speech.textContent = line; avatar.speak(line.length); };
  const syncMotion = () => {
    const allowed = motion && !reduced.matches;
    element('host-motion').setAttribute('aria-pressed', String(allowed));
    element('host-motion').textContent = `角色动作：${allowed ? '开' : '关'}`;
    element<HTMLButtonElement>('host-motion').disabled = reduced.matches;
    avatar.setEnabled(allowed);
  };
  const stopBow = () => { clearTimeout(bowTimer); frame.classList.remove('bowing'); element('bow-sound').hidden = true; };
  syncMotion();
  reduced.addEventListener('change', () => { if (reduced.matches) { motion = false; stopBow(); } syncMotion(); });
  element('host-motion').addEventListener('click', () => { motion = !motion; stopBow(); syncMotion(); });
  element('host-bow').addEventListener('click', () => {
    stopBow(); bows++;
    say(bows === 1 ? '咚。才艺结束。接下来，帮我看看一张海报？' : '先不磕了。你先帮我核对一条信息，再说。');
    element('bow-sound').hidden = false;
    if (motion && !reduced.matches) {
      // Class records the interaction; the sprite layer owns the character motion.
      void frame.offsetWidth;
      frame.classList.add('bowing');
      avatar.bow();
    }
    bowTimer = setTimeout(stopBow, 800);
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
    element('learn-index').textContent = `固定科普示例 ${lesson + 1} / ${lessons.length} · 非每日更新服务`;
    element('learn-title').focus({ preventScroll: true });
  });
  for (const id of ['hero-task', 'learn-task', 'nav-task']) element(id).addEventListener('click', event => {
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
    setTask(task: PublicTask | null) {
      const stage = task?.status ?? null;
      if (stage === lastStage) return;
      lastStage = stage;
      say(stage ? greetings[stage] : '这次资料已清空。先歇一会儿，或者再做一张。');
    },
  };
}
