/**
 * voice-stage.ts — 星灵语音在场界面（旁路 sidecar）
 *
 * 召之即来的沉浸语音界面，5 层结构：
 *   L0 退场解读页（blur + scale，不复原）
 *   L1 星尘 canvas
 *   L2 星灵律动球（加光融合流体）
 *   L3 星灵神情（耳朵/口型/外环）
 *   L4 流式文字
 *   L5 控制 + 微交互
 *
 * 驱动信号复用 sound.ts：getMicLevel() / getVoiceLevel() / stopVoice()，不改 TTS 实现。
 * 全局总开关：closeStage() → DOM 复位，背景复原。
 */
import { sound } from './sound';
import { setSpeaking } from './vad';

/* ====== 类型 ====== */
type StageState = 'idle' | 'listening' | 'thinking' | 'speaking';

/* ====== DOM 引用 ====== */
let dom: {
  root: HTMLElement; stage: HTMLElement; closeBtn: HTMLElement;
  stateTag: HTMLElement; tagText: HTMLElement;
  spirit: HTMLElement; orb: HTMLCanvasElement; ring: HTMLElement;
  earL: HTMLElement; earR: HTMLElement; mouth: HTMLElement;
  line: HTMLElement; caret: HTMLElement; hint: HTMLElement;
  hold: HTMLElement; holdFill: HTMLElement; holdText: HTMLElement;
  cont: HTMLElement; micBtn: HTMLElement; controls: HTMLElement;
  stars: HTMLCanvasElement;
} | null = null;

let state: StageState = 'idle';
let continuous = false;
let open = false;

/* canvas 上下文 */
let sx: CanvasRenderingContext2D | null = null;
let ox: CanvasRenderingContext2D | null = null;
let starsArr: Array<{ x: number; y: number; r: number; a: number; sp: number; vx: number; vy: number }> = [];
let animId = 0;
let typeTimer: ReturnType<typeof setInterval> | null = null;
let levelSmooth = 0;
let startle = 0;
let simPhase = 0;

/* 外部回调 */
let onStartListen: (() => void) | null = null;
let onStopVoice: (() => void) | null = null;

/* 状态标签文案映射 */
const TAG: Record<StageState, string> = {
  idle: '轻触星灵 · 唤起',
  listening: '正在倾听',
  thinking: '星灵思索中',
  speaking: '星灵在说',
};

/* 流式文字缓存 */
let heardText = '';
let sayText = '';

/* ====== 构建 DOM ====== */
function buildDOM(parent: HTMLElement): void {
  if (dom) return;

  /* 星尘 canvas（独立于主体，不下层） */
  const stars = document.createElement('canvas');
  stars.id = 'vs-stars';

  /* 前景：语音在场界面 */
  const stage = document.createElement('main');
  stage.className = 'vs-stage';
  stage.innerHTML = `
    <div class="vs-flow" id="vsFlow"></div>
    <div class="vs-state-tag"><span class="vs-dot"></span><span class="vs-tag-text">星灵在听</span></div>
    <div class="vs-spirit">
      <div class="vs-ring"></div>
      <div class="vs-ear vs-ear-l"></div><div class="vs-ear vs-ear-r"></div>
      <canvas class="vs-orb"></canvas>
      <div class="vs-mouth"></div>
    </div>
    <div class="vs-line" id="vsCurrentLine"><span class="vs-caret"></span></div>
    <div class="vs-hint" id="vsHint">我在听 · 直接说就好</div>
  `;

  /* 控制栏 */
  const controls = document.createElement('div');
  controls.className = 'vs-controls';
  controls.innerHTML = `
    <div class="vs-hold"><span class="vs-hold-fill"></span><span class="vs-hold-text">按住 说话</span></div>
    <div class="vs-row">
      <div class="vs-toggle"><span class="vs-sw"></span>连续通话</div>
      <div class="vs-mic-btn">启用麦克风</div>
    </div>
  `;

  /* 关闭按钮 */
  const closeBtn = document.createElement('button');
  closeBtn.className = 'vs-close';
  closeBtn.textContent = '✕';

  parent.append(stars, stage, controls, closeBtn);
  parent.classList.add('vs-ready');

  /* 缓存引用 */
  dom = {
    root: parent, stage, closeBtn,
    stateTag: stage.querySelector('.vs-state-tag')!,
    tagText: stage.querySelector('.vs-tag-text')!,
    spirit: stage.querySelector('.vs-spirit')!,
    orb: stage.querySelector('.vs-orb')!,
    ring: stage.querySelector('.vs-ring')!,
    earL: stage.querySelector('.vs-ear-l')!,
    earR: stage.querySelector('.vs-ear-r')!,
    mouth: stage.querySelector('.vs-mouth')!,
    line: stage.querySelector('#vsCurrentLine')!,
    caret: stage.querySelector('.vs-caret')!,
    hint: stage.querySelector('#vsHint')!,
    hold: controls.querySelector('.vs-hold')!,
    holdFill: controls.querySelector('.vs-hold-fill')!,
    holdText: controls.querySelector('.vs-hold-text')!,
    cont: controls.querySelector('.vs-toggle')!,
    micBtn: controls.querySelector('.vs-mic-btn')!,
    controls,
    stars,
  };

  /* 画布尺寸 */
  sizeStars();
  sizeOrb();

  /* 事件绑定 */
  bindEvents();

  /* 星灵默认呼吸（idle） */
  setState('idle');
}

/* ====== 画布尺寸 ====== */
function sizeStars(): void {
  if (!dom) return;
  dom.stars.width = innerWidth;
  dom.stars.height = innerHeight;
  starsArr = Array.from({ length: Math.round(innerWidth * innerHeight / 9000) }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: Math.random() * 1.3 + 0.2, a: Math.random(), sp: Math.random() * 0.0008 + 0.0002,
    vx: (Math.random() - 0.5) * 0.04, vy: (Math.random() - 0.5) * 0.04,
  }));
}

function sizeOrb(): void {
  if (!dom) return;
  const r = dom.orb.getBoundingClientRect();
  dom.orb.width = r.width * devicePixelRatio;
  dom.orb.height = r.height * devicePixelRatio;
}

/* ====== 状态机 ====== */
function setState(s: StageState): void {
  const prev = state;
  state = s;
  dom?.root.setAttribute('data-vs-state', s);
  if (dom) dom.tagText.textContent = TAG[s];
  if (dom) dom.caret.style.display = (s === 'listening' || s === 'speaking') ? 'inline-block' : 'none';

  // 补丁6：VAD 门控同步
  if (s === 'speaking') setSpeaking(true);
  if (prev === 'speaking' && s !== 'speaking') setSpeaking(false);
}

/* ====== 对话流沉淀 ====== */

/** 追加一句到对话流 + settle 动效 */
export function appendToFlow(text: string, who: 'user' | 'star'): void {
  if (!dom) return;

  const flow = document.getElementById('vsFlow');
  if (!flow) return;

  // 当前大字清空前先 clone 做 settle 动画
  const currentLine = dom.line;
  if (currentLine.firstChild && currentLine.childNodes[0].nodeValue !== '') {
    const clone = currentLine.cloneNode(true) as HTMLElement;
    clone.className = 'vs-line vs-line-settling';
    clone.style.position = 'fixed';
    clone.style.zIndex = '99';
    clone.style.pointerEvents = 'none';
    const rect = currentLine.getBoundingClientRect();
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.width = rect.width + 'px';
    document.body.appendChild(clone);

    // 飞入归位动画
    const flowRect = flow.getBoundingClientRect();
    const targetY = flowRect.top + flowRect.height - 20;
    const dy = targetY - rect.top;

    requestAnimationFrame(() => {
      clone.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1), opacity .6s';
      clone.style.transform = `translateY(${dy > 0 ? dy - 30 : dy}px) scale(.7)`;
      clone.style.opacity = '0.3';
      setTimeout(() => { if (clone.parentNode) clone.parentNode.removeChild(clone); }, 700);
    });
  }

  // 写入对话流
  const entry = document.createElement('div');
  entry.className = `vs-flow-entry vs-flow-${who}`;
  entry.textContent = text;
  flow.appendChild(entry);

  // 顶部渐隐：超过 N 条时删最早的
  while (flow.children.length > 20) {
    flow.removeChild(flow.firstChild!);
  }

  // 滚动到底
  flow.scrollTop = flow.scrollHeight;
}

/** 清空对话流 */
export function clearFlow(): void {
  const flow = document.getElementById('vsFlow');
  if (flow) flow.innerHTML = '';
}

/* ====== 流式打字 ====== */
function typeTo(text: string, done?: () => void): void {
  if (!dom) return;
  clearInterval(typeTimer!);
  let i = 0;
  const line = dom.line;
  if (line.firstChild) { line.childNodes[0].nodeValue = ''; } else { line.prepend(document.createTextNode('')); }
  const node = line.childNodes[0];
  typeTimer = setInterval(() => {
    node.nodeValue = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(typeTimer!); done?.(); }
  }, 50);
}

/* ====== 流程编排 ====== */
function startListen(): void {
  setState('listening');
  simPhase = Math.random() * 6;
  if (dom) dom.hint.textContent = continuous ? '连续通话中 · 点星灵可打断' : '说完松开 / 再次点星灵结束';
  onStartListen?.();
}

function goThink(): void {
  setState('thinking');
  if (dom && dom.line.firstChild) dom.line.childNodes[0].nodeValue = '';
  if (dom) dom.hint.textContent = '…';
}

function goSpeak(): void {
  setState('speaking');
  if (dom) dom.hint.textContent = '点星灵 / 出声 打断它';
}

function endSpeak(): void {
  if (continuous) {
    setTimeout(() => { if (state === 'speaking' || state === 'idle') startListen(); }, 400);
  } else {
    setState('idle');
    if (dom && dom.line.firstChild) dom.line.childNodes[0].nodeValue = '我在，说点什么';
    if (dom) dom.hint.textContent = '点星灵开始 · 或按住下方说话';
  }
}

function bargeIn(): void {
  if (state !== 'speaking') return;
  clearInterval(typeTimer!);
  startle = 1;
  sound.stopVoice();
  onStopVoice?.();
  setState('listening');
  simPhase = Math.random() * 6;
  if (dom && dom.line.firstChild) dom.line.childNodes[0].nodeValue = '';
  if (dom) dom.hint.textContent = '已打断 · 我在听';
  onStartListen?.();
}

/* ====== 打开/关闭 ====== */
export function openStage(opts?: {
  heardText?: string;
  sayText?: string;
  onStartListen?: () => void;
  onStopVoice?: () => void;
}): void {
  if (open) return;
  open = true;

  const sanctum = document.querySelector('.sanctum');
  if (!sanctum) return;

  buildDOM(sanctum as HTMLElement);
  if (opts?.heardText) heardText = opts.heardText;
  if (opts?.sayText) sayText = opts.sayText;
  if (opts?.onStartListen) onStartListen = opts.onStartListen;
  if (opts?.onStopVoice) onStopVoice = opts.onStopVoice;

  sanctum.classList.add('vs-stage-on');

  // 进界面即 continuous 模式 + 自动 listening（声音驱动）
  continuous = true;
  if (dom) dom.cont.classList.add('vs-on');

  // 补丁1：借用户手势（浮球点击链路）自动授权 mic
  sound.enableMic().then(ok => {
    if (dom) {
      dom.micBtn.textContent = ok ? '麦克风 · 已接入' : '麦克风不可用';
      if (ok) dom.micBtn.classList.add('vs-live');
    }
  });

  setState('listening');

  sx = dom?.stars.getContext('2d') ?? null;
  ox = dom?.orb.getContext('2d') ?? null;
  if (!animId) animId = requestAnimationFrame(loop);
}

export function closeStage(): void {
  if (!open) return;
  open = false;
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  setSpeaking(false); // 补丁6：复位 VAD 门控
  const sanctum = document.querySelector('.sanctum');
  if (sanctum) sanctum.classList.remove('vs-stage-on');
  setState('idle');
  if (dom) {
    dom.root.querySelectorAll('.vs-stage, .vs-controls, .vs-close, #vs-stars').forEach(el => el.remove());
  }
  dom = null;
  if (animId) { cancelAnimationFrame(animId); animId = 0; }
}

export function isStageOpen(): boolean { return open; }
export function getStageState(): StageState { return state; }

/* ====== 主渲染循环 ====== */
function loop(t: number): void {
  drawStars(t);
  if (open) drawOrb(t);
  animId = requestAnimationFrame(loop);
}

/* ====== 星尘 ====== */
function drawStars(t: number): void {
  if (!dom || !sx) return;
  const c = dom.stars;
  sx.clearRect(0, 0, c.width, c.height);
  for (const s of starsArr) {
    s.x += s.vx; s.y += s.vy;
    if (s.x < 0) s.x = c.width; if (s.x > c.width) s.x = 0;
    if (s.y < 0) s.y = c.height; if (s.y > c.height) s.y = 0;
    const tw = 0.55 + 0.45 * Math.sin(t * s.sp * 6 + s.a * 9);
    sx.globalAlpha = s.a * tw;
    sx.fillStyle = s.a > 0.85 ? '#e0bd86' : '#dfe6ff';
    sx.beginPath(); sx.arc(s.x, s.y, s.r, 0, 7); sx.fill();
  }
  sx.globalAlpha = 1;
}

/* ====== 律动球 ====== */
const BLOBS = [
  { hue: '#cdd6ff', ph: 0.0, rad: 0.42, ox: 0, oy: 0 },
  { hue: '#e0bd86', ph: 1.7, rad: 0.34, ox: 0.18, oy: 0.12 },
  { hue: '#cf6aa6', ph: 3.1, rad: 0.30, ox: -0.16, oy: 0.14 },
  { hue: '#9fb0ff', ph: 4.6, rad: 0.28, ox: 0.1, oy: -0.18 },
];

function drawOrb(t: number): void {
  if (!dom || !ox) return;
  const c = dom.orb;
  const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2;
  ox.clearRect(0, 0, W, H);

  // level 信号源：复用 sound.ts
  const idleBreath = 0.03 + 0.02 * Math.sin(t * 0.0016);
  let rawLevel = 0;
  if (state === 'listening') rawLevel = Math.max(idleBreath, sound.getMicLevel() || simMicLevel());
  else if (state === 'speaking') rawLevel = Math.max(idleBreath, sound.getVoiceLevel() || simVoiceLevel());
  else if (state === 'thinking') rawLevel = Math.max(idleBreath, 0.06);
  else rawLevel = idleBreath;

  levelSmooth += (rawLevel - levelSmooth) * 0.18;
  startle *= 0.86;

  const base = state === 'thinking' ? 0.62 : 0.82;
  const pulse = state === 'idle' ? 0.05 * Math.sin(t * 0.0016) : levelSmooth * 0.30;
  const scale = (base + pulse) * (1 - startle * 0.22);

  ox.save();
  ox.translate(cx, cy); ox.scale(scale, scale); ox.translate(-cx, -cy);
  ox.globalCompositeOperation = 'lighter';
  ox.filter = `blur(${R * 0.10}px)`;
  const bright = 0.5 + levelSmooth * 0.5 + (state === 'speaking' ? 0.12 : 0);

  for (const b of BLOBS) {
    const a = t * 0.0006 + b.ph;
    const wob = state === 'idle' ? 0.10 : 0.16 + levelSmooth * 0.22;
    const x = cx + (b.ox + Math.cos(a) * wob) * R;
    const y = cy + (b.oy + Math.sin(a * 1.3) * wob) * R;
    const rr = b.rad * R * (1 + levelSmooth * 0.25);
    const g = ox.createRadialGradient(x, y, 0, x, y, rr);
    const brightClamped = Math.max(0, Math.min(1, bright));
    g.addColorStop(0, hexA(b.hue, 0.95 * brightClamped));
    g.addColorStop(0.5, hexA(b.hue, 0.35 * brightClamped));
    g.addColorStop(1, hexA(b.hue, 0));
    ox.fillStyle = g; ox.beginPath(); ox.arc(x, y, rr, 0, 7); ox.fill();
  }
  ox.restore();

  // 口型开合
  if (state === 'speaking' && dom) {
    dom.mouth.style.setProperty('--vs-mouth', (0.25 + levelSmooth * 1.1).toFixed(2));
  }
}

/* ====== 模拟振幅源（麦克风未授权时兜底） ====== */
function simMicLevel(): number {
  simPhase += 0.16;
  return Math.max(0, Math.min(1,
    Math.sin(simPhase) * 0.6 + Math.sin(simPhase * 2.7) * 0.3 + Math.random() * 0.25
  ));
}

function simVoiceLevel(): number {
  simPhase += 0.08;
  return Math.max(0, Math.min(1,
    Math.sin(simPhase * 1.3) * 0.5 + Math.sin(simPhase * 3.1) * 0.3 + Math.random() * 0.15
  ));
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/* ====== 事件绑定 ====== */
function bindEvents(): void {
  if (!dom) return;

  /* 星灵点按 */
  dom.spirit.addEventListener('click', () => {
    if (!open) { openStage(); return; }
    if (state === 'idle') startListen();
    else if (state === 'listening') { goThink(); setTimeout(() => goSpeak(), 600); }
    else if (state === 'speaking') bargeIn();
  });

  /* 关闭 */
  dom.closeBtn.addEventListener('click', closeStage);

  /* 按住说话 */
  const hold = dom.hold, fill = dom.holdFill, text = dom.holdText;
  let holding = false;
  function down(e: Event): void {
    e.preventDefault();
    if (holding) return;
    holding = true;
    hold.classList.add('vs-on');
    text.textContent = '松开 发送';
    startListen();
  }
  function up(): void {
    if (!holding) return;
    holding = false;
    hold.classList.remove('vs-on');
    text.textContent = '按住 说话';
    fill.style.width = '0%';
    if (state === 'listening') { goThink(); setTimeout(() => goSpeak(), 600); }
  }
  hold.addEventListener('mousedown', down);
  hold.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);

  /* 连续通话 */
  dom.cont.addEventListener('click', function () {
    continuous = !continuous;
    this.classList.toggle('vs-on', continuous);
  });

  /* 启用麦克风 */
  dom.micBtn.addEventListener('click', async () => {
    const ok = await sound.enableMic();
    dom!.micBtn.textContent = ok ? '麦克风 · 已接入' : '麦克风不可用';
    if (ok) dom!.micBtn.classList.add('vs-live');
  });

  /* resize */
  window.addEventListener('resize', () => { sizeStars(); sizeOrb(); });
}

/* ====== 外部控制 ====== */
export function updateHeardText(text: string): void { heardText = text; }
export function updateSayText(text: string): void { sayText = text; }
export function setContinuous(on: boolean): void { continuous = on; }
