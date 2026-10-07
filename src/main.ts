// Bootstrap is loaded first so the theme can selectively override its defaults.
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import './style.css';
import { TarotSession, majorArcanaGlyph } from './session';
import type { DrawDetails, OpeningDetails, SurveyDetails, SelfNarrationDetails, ReportDetails, MintDetails } from './tools';
import { drawCards } from './tools/deck';
import html2canvas from 'html2canvas';
import { DEFAULT_MODEL_ID, DEFAULT_BASE_URL, DEFAULT_API_KEY } from './agent/setup';
import { ZODIAC_SIGNS, generateHoroscope, getCachedHoroscope, loadArchive, clearArchive, type HoroscopeCard, type ArchiveEntry } from './horoscope';
import { speakOracleAliyun, stopAliyunTTS } from './aliyun-tts';
import { audioManager } from './audio-manager';
import { beginAsr, finishAsr, cancelAsr, type AsrMode, type AsrResult } from './asr';

type Reading = {
  title: string;
  symbol: string;
  keywords: string[];
  message: string;
  question?: string;
};

const readings: Reading[] = [
  { title: '星轨正在向你倾斜', symbol: '✦', keywords: ['契机', '笃定', '新生'], message: '你等待的答案已在途中。放下对完美时机的执念，今天向前迈出一小步。', question: '我该如何面对眼前的选择？' },
  { title: '月光照见隐藏的路', symbol: '☾', keywords: ['直觉', '静观', '答案'], message: '不必急于证明什么。安静下来，你最先听到的那个声音，正是此刻的指引。', question: '我现在最需要注意什么？' },
  { title: '命运之轮开始转动', symbol: '☉', keywords: ['转机', '相遇', '行动'], message: '一段新的连结即将出现。保持开放，回应那个让你感到好奇的邀请。', question: '接下来会有转机吗？' },
  { title: '守护之星与你同行', symbol: '✧', keywords: ['治愈', '边界', '温柔'], message: '你无需独自承受所有。把力量留给真正重要的人与事，温柔也是一种坚定。', question: '我该如何照顾好自己？' },
  { title: '水晶映出未来的回声', symbol: '◈', keywords: ['灵感', '创造', '表达'], message: '那个反复出现的念头值得被认真对待。记录它，并在七天内让它拥有形状。', question: '我的灵感值得坚持吗？' }
];

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main class="sanctum">
    <div class="veil"></div>
    <div class="stars" aria-hidden="true"></div>
    <header class="nav d-flex align-items-center justify-content-between">
      <div class="brand-menu dropdown">
        <button class="brand-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="打开星月占卜菜单">
          <span class="brand-star">✧</span>
        </button>
        <div class="dropdown-menu dropdown-menu-dark celestial-menu">
          <p class="menu-caption">星月指引</p>
          <button class="dropdown-item" type="button" data-action="divine"><span>✦</span> 开始占卜</button>
          <button class="dropdown-item" type="button" data-action="constellation"><span>☾</span> 今日星象</button>
          <button class="dropdown-item" type="button" data-action="energy"><span>◈</span> 能量档案</button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" type="button" data-action="config"><span>⚙</span> 配置 API Key</button>
        </div>
        <a class="brand" href="#" aria-label="星月占卜首页">星月占卜</a>
      </div>
      <div class="nav-actions">
        <button class="voice" type="button" aria-label="开启持续语音对话" aria-pressed="false" title="开启持续语音对话">
          <span class="voice-aura" aria-hidden="true"></span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"></path>
          </svg>
        </button>
      <button class="sound" aria-label="切换语音录入氛围" aria-pressed="false"><span></span><span></span><span></span></button>
      </div>
    </header>

    <section class="hero container-fluid">
      <aside class="chat" aria-label="占卜对话记录">
        <div class="chat-head">
          <span class="chat-orb" aria-hidden="true">✦</span>
          <div class="chat-id">
            <p class="chat-name">JARVIS · 星月</p>
            <p class="chat-status"><i></i> 静候你的提问</p>
          </div>
        </div>
        <div class="chat-log" role="log" aria-live="polite">
          <div class="chat-empty">按住水晶球，向星辰许下你的疑问……</div>
        </div>
        <div class="chat-controls chat-hidden" role="group" aria-label="继续倾诉或开始占卜">
          <button type="button" data-chat="more">💬 继续倾诉</button>
          <button type="button" data-chat="proceed">🔮 就聊这么多 · 开始占卜</button>
        </div>
        <div class="chat-input">
          <input type="text" placeholder="写下你的疑问……" aria-label="输入你的问题" maxlength="200" />
          <button type="button" aria-label="发送">发送</button>
        </div>
      </aside>

      <div class="copy col-12 col-md-5">
        <p class="eyebrow">· CELESTIAL GUIDANCE ·</p>
        <p class="intro">将你的疑问交给星辰。<br/>闭上双眼，深呼吸，当你准备好时触碰水晶。</p>
      </div>

      <button class="orb btn p-0 border-0" type="button" aria-label="开始占卜">
        <span class="orbit orbit-one"></span>
        <span class="orbit orbit-two"></span>
        <span class="orb-core">
          <i class="orb-mist mist-one"></i>
          <i class="orb-mist mist-two"></i>
          <b>✦</b>
        </span>
        <span class="orb-label">触碰水晶</span>
      </button>

      <div class="orb-stage"></div>
      <div class="hint"><span></span> 向下探索</div>
    </section>

  </main>
`;

const stars = document.querySelector<HTMLDivElement>('.stars')!;
for (let i = 0; i < 42; i++) {
  const star = document.createElement('i');
  star.style.setProperty('--x', `${Math.random() * 100}%`);
  star.style.setProperty('--y', `${Math.random() * 100}%`);
  star.style.setProperty('--d', `${1.8 + Math.random() * 4}s`);
  star.style.setProperty('--s', `${1 + Math.random() * 3}px`);
  stars.append(star);
}

const welcome = document.querySelector<HTMLDivElement>('#welcome');
if (welcome) {
  const welcomeStars = welcome.querySelector<HTMLDivElement>('.welcome-stars');
  if (welcomeStars) {
    for (let i = 0; i < 36; i++) {
      const star = document.createElement('i');
      star.style.setProperty('--x', `${Math.random() * 100}%`);
      star.style.setProperty('--y', `${Math.random() * 100}%`);
      star.style.setProperty('--d', `${1.8 + Math.random() * 4}s`);
      star.style.setProperty('--s', `${1 + Math.random() * 3}px`);
      welcomeStars.append(star);
    }
  }

  let dismissed = false;
  const enterMainPage = () => {
    if (dismissed) return;
    dismissed = true;
    welcome.classList.add('welcome-exit');
    welcome.addEventListener('transitionend', () => welcome.remove(), { once: true });
    // 首次点击即用户手势:顺手解锁 AudioContext 并启动 BGM,再触发开场问候。
    // 不再用定时器自动进入 —— 必须由用户轻触「轻触任意处进入」后才进主页。
    audioManager.unlock();
    audioManager.startBGM();
    window.setTimeout(maybeGreet, 500);
  };

  welcome.addEventListener('click', enterMainPage);
}

const orb = document.querySelector<HTMLButtonElement>('.orb')!;
const sanctum = document.querySelector<HTMLElement>('.sanctum')!;
const orbLabel = document.querySelector<HTMLElement>('.orb-label')!;
const chatLog = document.querySelector<HTMLDivElement>('.chat-log')!;
const chatStatus = document.querySelector<HTMLParagraphElement>('.chat-status')!;
const orbStage = document.querySelector<HTMLDivElement>('.orb-stage')!;
const chatInput = document.querySelector<HTMLDivElement>('.chat-input')!;
const chatInputField = chatInput.querySelector<HTMLInputElement>('input')!;
const chatInputSend = chatInput.querySelector<HTMLButtonElement>('button')!;

// 对话框可调节大小:放大超过约 55vw 时向中间靠,避免贴边遮挡水晶球(仅桌面端)
const chatAside = document.querySelector<HTMLElement>('.chat')!;
if (typeof ResizeObserver !== 'undefined') {
  const chatRo = new ResizeObserver(() => {
    chatAside.classList.toggle(
      'chat-centered',
      window.innerWidth > 800 && chatAside.getBoundingClientRect().width >= window.innerWidth * 0.55,
    );
  });
  chatRo.observe(chatAside);
}

// 塔罗 Agent 会话（真 AI 占卜驱动）
const session = new TarotSession(chatLog, {
  onStatus: (text, state) => setChatStatus(text, state),
  onSpeak: (text) => speakOracle(text, () => {}),
  onMint: (kind) => {
    if (kind === 'success') {
      audioManager.playMintConfirm();
      setTimeout(() => audioManager.playMintSuccess(), 400);
    }
  },
  onMintCard: (d) => renderMintOverlay(d),
  onOpening: (q) => { showChatControls(true); renderOpening(q); },
  onSurvey: (s) => { showChatControls(true); renderSurvey(s); },
  onSelfNarration: (s) => { showChatControls(true); renderSelfNarration(s); },
  onReport: (r) => renderReport(r),
  onDrawRequest: (args, signal) => requestDrawFromOrb(args, signal),
  onCardsDrawn: (d) => { showChatControls(false); renderFan(d); },
  onContinue: () => runSubmit(() => session.send('请继续解读下一张牌')),
});

// 首次无 API Key 时提示配置
if (!session.hasApiKey()) {
  setChatStatus('需要先配置 API Key', 'idle');
  chatLog.querySelector('.chat-empty')!.textContent = '点击右上角 ✧ 菜单 → 配置 API Key，然后开始占卜';
}

let previous = -1;
let channelTimer: number | undefined;
let releaseTimers: number[] = [];
let skipNextOrbClick = false;
let busy = false;

// 开场主动问候:进入主页后,星语先打招呼再自然开始了解诉求(仅一次)
let greeted = false;
function maybeGreet() {
  if (greeted || busy || !session.hasApiKey()) return;
  greeted = true;
  busy = true;
  audioManager.duckBGM();
  void session.greet().finally(() => {
    busy = false;
    audioManager.restoreBGM(600);
  });
}

// 抽牌阶段:中央水晶球进入「等待触碰抽牌」模式
type OrbMode = 'idle' | 'awaiting-draw';
let orbMode: OrbMode = 'idle';
let drawResolver: ((ok: boolean) => void) | null = null;

// 自述环节:问卷后由用户点击水晶球自述近况/此刻想法,提交后路由到 submitSelfNarration
let narrationMode = false;

// ASR(阿里云百炼 Paraformer):录音 → /api/asr → 转写。见 src/asr.ts。
// `continuousMode` 是右上角光环按钮的持续对话;`asrMode` 记录当前录音属于哪个手势。
let listening = false;
let continuousMode = false;
let asrMode: AsrMode | null = null;

function selectReading() {
  let index = Math.floor(Math.random() * readings.length);
  if (index === previous) index = (index + 1) % readings.length;
  previous = index;
  return readings[index];
}

function showReading(reading: Reading) {
  orbLabel.textContent = reading.title;
  orbLabel.classList.add('revealed');
}

function setChatStatus(text: string, state: 'idle' | 'thinking' | 'replying') {
  chatStatus.innerHTML = `<i></i> ${text}`;
  chatStatus.dataset.state = state;
}

function scrollChatToEnd() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendUserMessage(text: string) {
  chatLog.querySelector('.chat-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'msg msg-user';
  row.innerHTML = `<div class="bubble"></div>`;
  row.querySelector('.bubble')!.textContent = text;
  chatLog.append(row);
  scrollChatToEnd();
}

// Speaks the oracle's reply through Aliyun Bailian CosyVoice "龙嫱",
// falling back to the browser's TTS engine if the proxy is unavailable.
function speakOracle(text: string, onEnd: () => void) {
  void speakOracleAliyun(text, onEnd);
}

// ── 中央水晶球承载问答选项与抽牌牌阵 ─────────────────────────────
function clearOrbStage() {
  orbStage.innerHTML = '';
  orbStage.classList.remove('show');
}

function renderOpening(q: OpeningDetails) {
  clearOrbStage();
  const box = document.createElement('div');
  box.className = 'orb-question';
  const head = document.createElement('div');
  head.className = 'orb-q-head';
  head.textContent = q.question.text;
  box.appendChild(head);

  // 统一提交:选项点选或自由输入都走这里,发送后清空水晶球舞台
  const submit = (answer: string) => {
    const a = answer.trim();
    if (!a) return;
    clearOrbStage();
    sendText(a);
  };

  if (q.question.options?.length) {
    const opts = document.createElement('div');
    opts.className = 'orb-options';
    q.question.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'orb-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        opts.querySelectorAll('.orb-option').forEach((b) => b.classList.remove('picked'));
        btn.classList.add('picked'); // 点选反馈
        window.setTimeout(() => submit(opt), 240); // 先安排提交,音效失败也不影响
        try { audioManager.playCrystalTouch(); } catch { /* ignore */ }
      });
      opts.appendChild(btn);
    });
    box.appendChild(opts);
  }

  // 自由输入:选项不合适时,可直接写下自己的回答(不再被选项限制)
  const inputRow = document.createElement('div');
  inputRow.className = 'orb-open-input';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'orb-q-input';
  input.placeholder = '或直接写下你的回答……';
  input.maxLength = 100;
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'orb-open-go';
  go.textContent = '提交';
  const doSubmit = () => {
    submit(input.value); // 先提交,音效失败也不影响
    try { audioManager.playCrystalTouch(); } catch { /* ignore */ }
  };
  go.addEventListener('click', doSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) doSubmit();
  });
  inputRow.append(input, go);
  box.appendChild(inputRow);

  orbStage.appendChild(box);
  orbStage.classList.add('show');
}

function makeSkip(handlers: { skip: () => void; unskip?: () => void }): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'orb-q-skip';
  btn.textContent = '跳过 · 不想回答';
  let skipped = false;
  btn.addEventListener('click', () => {
    skipped = !skipped;
    if (skipped) {
      handlers.skip();
      btn.textContent = '↩ 取消跳过';
      btn.classList.add('active');
    } else {
      handlers.unskip?.();
      btn.textContent = '跳过 · 不想回答';
      btn.classList.remove('active');
    }
    audioManager.playCrystalTouch();
  });
  return btn;
}

function renderSurvey(s: SurveyDetails) {
  clearOrbStage();
  const box = document.createElement('div');
  box.className = 'orb-survey';
  const title = document.createElement('div');
  title.className = 'orb-survey-title';
  title.textContent = '星语想更懂你';
  box.appendChild(title);

  // 每题记录其当前选择(choice)/刻度(scale)/输入(text);skip 时记为「跳过」
  const answerOf = new Map<number, () => string>();

  s.questions.forEach((q, qi) => {
    const row = document.createElement('div');
    row.className = 'orb-q-row';
    const num = document.createElement('div');
    num.className = 'orb-q-num';
    num.textContent = `${qi + 1}`;
    row.appendChild(num);

    const body = document.createElement('div');
    body.className = 'orb-q-body';
    const head = document.createElement('div');
    head.className = 'orb-q-text';
    head.textContent = q.text;
    body.appendChild(head);

    if (q.type === 'choice' && q.options?.length) {
      const opts = document.createElement('div');
      opts.className = 'orb-options';
      let picked = '';
      let skipped = false;
      q.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'orb-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          if (skipped) return;
          opts.querySelectorAll('.orb-option').forEach((b) => b.classList.remove('picked'));
          btn.classList.add('picked');
          picked = opt;
          audioManager.playCrystalTouch();
        });
        opts.appendChild(btn);
      });
      body.appendChild(opts);
      answerOf.set(qi, () => (skipped ? '跳过' : picked || '（未选择）'));
      body.appendChild(makeSkip({
        skip: () => {
          skipped = true;
          picked = '';
          opts.querySelectorAll('.orb-option').forEach((b) => b.classList.remove('picked'));
          row.classList.add('skipped');
        },
        unskip: () => { skipped = false; row.classList.remove('skipped'); },
      }));
    } else if (q.type === 'scale') {
      const labels = q.options?.length ? q.options : ['1', '2', '3', '4', '5'];
      const scale = document.createElement('div');
      scale.className = 'orb-q-scale';
      let picked = '';
      let skipped = false;
      labels.forEach((lbl, li) => {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'orb-scale-seg';
        seg.textContent = lbl;
        seg.addEventListener('click', () => {
          if (skipped) return;
          scale.querySelectorAll('.orb-scale-seg').forEach((b) => b.classList.remove('picked'));
          seg.classList.add('picked');
          picked = `${li + 1}`;
          audioManager.playCrystalTouch();
        });
        scale.appendChild(seg);
      });
      body.appendChild(scale);
      answerOf.set(qi, () =>
        skipped ? '跳过' : picked ? `${picked}（${labels[Number(picked) - 1] ?? picked}）` : '（未选择）',
      );
      body.appendChild(makeSkip({
        skip: () => {
          skipped = true;
          picked = '';
          scale.querySelectorAll('.orb-scale-seg').forEach((b) => b.classList.remove('picked'));
          row.classList.add('skipped');
        },
        unskip: () => { skipped = false; row.classList.remove('skipped'); },
      }));
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'orb-q-input';
      input.placeholder = '写下你的答案……';
      body.appendChild(input);
      answerOf.set(qi, () => input.value.trim() || '（未填写）');
      body.appendChild(makeSkip({
        skip: () => { input.value = '跳过'; input.disabled = true; row.classList.add('skipped'); },
        unskip: () => { input.value = ''; input.disabled = false; row.classList.remove('skipped'); },
      }));
    }
    row.appendChild(body);
    box.appendChild(row);
  });

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'orb-submit';
  submit.textContent = '提交问卷 ✦';
  submit.addEventListener('click', () => {
    const answers = s.questions.map((q, i) => ({ question: q.text, answer: answerOf.get(i)?.() ?? '' }));
    const missing = answers.filter((a) => !a.answer || a.answer.startsWith('（未'));
    if (missing.length === s.questions.length) {
      setChatStatus('请至少回答一题再提交', 'idle');
      return;
    }
    clearOrbStage();
    runSubmit(() => session.submitSurvey(answers));
    try { audioManager.playCrystalTouch(); audioManager.playSparkle(3); } catch { /* ignore */ }
  });
  box.appendChild(submit);

  // 整份重新生成:允许用户换一批问题,避免敏感/不想答
  const regen = document.createElement('button');
  regen.type = 'button';
  regen.className = 'orb-regenerate';
  regen.textContent = '🔄 重新生成问卷';
  regen.addEventListener('click', () => {
    clearOrbStage();
    runSubmit(() => session.send('请重新为我生成一份问卷，换一批问题'));
    try { audioManager.playCrystalTouch(); } catch { /* ignore */ }
  });
  box.appendChild(regen);

  orbStage.appendChild(box);
  orbStage.classList.add('show');
}

function renderSelfNarration(s: SelfNarrationDetails) {
  clearOrbStage();
  narrationMode = true;
  orbLabel.textContent = '点击水晶球，说出你的想法';
  const box = document.createElement('div');
  box.className = 'orb-narration';
  const head = document.createElement('div');
  head.className = 'orb-q-head';
  head.textContent = s.prompt;
  box.appendChild(head);
  const hint = document.createElement('div');
  hint.className = 'orb-narration-hint';
  hint.textContent = '点击下方水晶球用语音自述，或在对话框里输入文字。';
  box.appendChild(hint);
  orbStage.appendChild(box);
  orbStage.classList.add('show');
}

function requestDrawFromOrb(
  args: { spread: string; question: string },
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    orbMode = 'awaiting-draw';
    orbLabel.textContent = `触碰水晶 · 发出「${args.spread}」`;
    orb.classList.add('awaiting-draw');
    setChatStatus('请触碰中央水晶，发出六张牌', 'thinking');
    drawResolver = resolve;
    signal?.addEventListener('abort', () => {
      if (drawResolver !== resolve) return;
      drawResolver = null;
      orbMode = 'idle';
      orb.classList.remove('awaiting-draw');
      orbLabel.textContent = '触碰水晶';
      setChatStatus('已取消发牌', 'idle');
      resolve(false);
    });
  });
}

function renderFan(d: DrawDetails): void {
  clearOrbStage();
  const chatEl = document.querySelector<HTMLElement>('.chat');
  chatEl?.classList.add('chat-hidden'); // 选牌期间隐藏对话框,让出全屏
  orbLabel.textContent = `「${d.spread}」· 盲选 3 张`;

  const drawn = drawCards(78); // 本地洗 78 张(含正逆位),不依赖模型返回
  const fan = document.createElement('div');
  fan.className = 'orb-fan';
  const chosen: { nameCn: string; reversed: boolean; meaningCn: string }[] = [];

  const isMobile = window.innerWidth < 640;
  const radius = Math.min(window.innerHeight * 0.38, isMobile ? 135 : 340, window.innerWidth * 0.42);
  const spreadDeg = isMobile ? 130 : 150; // 移动端收窄角度,避免太密
  fan.style.width = `${radius * 2 + 60}px`;
  fan.style.height = `${radius + 70}px`;
  const n = drawn.length;

  drawn.forEach((dc, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = -spreadDeg / 2 + t * spreadDeg;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `fan-card${dc.reversed ? ' reversed' : ''}`;
    card.style.setProperty('--a', `${angle}deg`);
    card.style.setProperty('--r', `${-radius}px`);
    card.innerHTML = `
      <span class="fan-card-inner">
        <span class="fan-face fan-back">✦</span>
        <span class="fan-face fan-front">
          <span class="fan-glyph">${majorArcanaGlyph(dc.card.nameCn)}</span>
          <span class="fan-cn">${dc.card.nameCn}</span>
          <span class="fan-pos">${dc.reversed ? '逆位' : '正位'}</span>
        </span>
      </span>`;
    card.addEventListener('click', () => {
      if (card.classList.contains('picked') || card.classList.contains('discarded')) return;
      card.classList.add('picked'); // 翻面亮出
      chosen.push({
        nameCn: dc.card.nameCn,
        reversed: dc.reversed,
        meaningCn: dc.reversed ? dc.card.reversedCn : dc.card.uprightCn,
      });
      audioManager.playCardReveal();
      if (chosen.length >= 3) {
        fan.querySelectorAll<HTMLElement>('.fan-card:not(.picked)').forEach((el) => el.classList.add('discarded'));
        window.setTimeout(() => {
          chatEl?.classList.remove('chat-hidden');
          clearOrbStage();
          orbLabel.textContent = '触碰水晶';
          runSubmit(() => session.submitSelection(chosen));
        }, 900);
      }
    });
    fan.appendChild(card);
  });

  orbStage.appendChild(fan);
  orbStage.classList.add('show');
  // 发牌音效(少量采样,避免 78 张连响)
  for (let i = 0; i < 6; i++) {
    window.setTimeout(() => audioManager.playCardReveal(), 380 + i * 90);
  }
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderReport(r: ReportDetails) {
  clearOrbStage();
  const box = document.createElement('div');
  box.className = 'orb-report';
  box.innerHTML = `
    <button class="orb-report-close" type="button" data-act="close" aria-label="关闭报告">✕</button>
    <div class="orb-report-title">${escHtml(r.title)}</div>
    <div class="orb-report-section">
      <div class="orb-report-h">现状</div>
      <div class="orb-report-text">${escHtml(r.summary)}</div>
    </div>
    <div class="orb-report-section">
      <div class="orb-report-h">背景</div>
      <div class="orb-report-text">${escHtml(r.context)}</div>
    </div>
    <div class="orb-report-cards">${r.cards
      .map(
        (c) => `<div class="orb-report-card">
          <div class="orb-report-card-name">${escHtml(c.nameCn)}（${c.reversed ? '逆位' : '正位'}）</div>
          <div class="orb-report-card-text">${escHtml(c.text)}</div>
        </div>`,
      )
      .join('')}</div>
    <div class="orb-report-section">
      <div class="orb-report-h">建议</div>
      <div class="orb-report-text">${escHtml(r.advice)}</div>
    </div>
    <div class="orb-report-section orb-report-relax">
      <div class="orb-report-h">散心方案</div>
      <div class="orb-report-text">${escHtml(r.relax)}</div>
    </div>
    <div class="orb-report-actions">
      <button class="orb-report-btn" type="button" data-act="img">🖼 生成图片报告</button>
      <button class="orb-report-btn orb-report-btn-primary" type="button" data-act="share">📤 系统分享</button>
    </div>`;
  orbStage.appendChild(box);
  orbStage.classList.add('show');

  box.querySelector<HTMLButtonElement>('[data-act="close"]')!.addEventListener('click', () => {
    audioManager.playCrystalTouch();
    clearOrbStage();
    orbLabel.textContent = '触碰水晶';
  });
  box.querySelector<HTMLButtonElement>('[data-act="img"]')!.addEventListener('click', () =>
    void downloadReportImage(box, r.title),
  );
  box.querySelector<HTMLButtonElement>('[data-act="share"]')!.addEventListener('click', () =>
    void shareReport(r, box),
  );
}

async function downloadReportImage(el: HTMLElement, title: string): Promise<void> {
  try {
    const canvas = await html2canvas(el, { backgroundColor: '#160a2e', scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || '星月占卜报告'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  } catch (err) {
    setChatStatus('生成图片失败：' + (err instanceof Error ? err.message : String(err)), 'idle');
  }
}

async function shareReport(r: ReportDetails, el: HTMLElement): Promise<void> {
  const nav = navigator as Navigator & {
    share?: (d: ShareData) => Promise<void>;
    canShare?: (d: ShareData) => boolean;
  };
  const text = `${r.title}\n${r.summary}\n建议：${r.advice}`;
  try {
    let payload: ShareData = { title: r.title, text };
    // 若浏览器支持文件分享,附带 PNG 报告图
    if (nav.canShare) {
      const canvas = await html2canvas(el, { backgroundColor: '#160a2e', scale: 2 });
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
      if (blob) {
        const file = new File([blob], `${r.title || '星月占卜报告'}.png`, { type: 'image/png' });
        if (nav.canShare({ files: [file] })) payload = { title: r.title, text, files: [file] };
      }
    }
    if (!nav.share) {
      await navigator.clipboard.writeText(text);
      setChatStatus('已复制报告文字（系统分享不可用）', 'idle');
      return;
    }
    await nav.share(payload);
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      setChatStatus('分享失败：' + err.message, 'idle');
    }
  }
}

// 纪念藏品的稀有度视觉(与收藏面板的稀有度配色一致)
const MINT_RARITY_STYLE: Record<string, { bg: string; border: string }> = {
  普通: { bg: 'linear-gradient(150deg,#20242e,#0a0c12)', border: '#94a3b8' },
  稀有: { bg: 'linear-gradient(150deg,#12293a,#06101a)', border: '#38bdf8' },
  史诗: { bg: 'linear-gradient(150deg,#2a1740,#12071e)', border: '#c084fc' },
  传说: { bg: 'linear-gradient(150deg,#3a2710,#180e03)', border: '#fbbf24' },
};

// 专属藏品:全屏翻转卡牌展示(入场先看卡背,自动翻面露出藏品,点击可来回翻面)
function renderMintOverlay(d: MintDetails) {
  const r = MINT_RARITY_STYLE[d.rarity] ?? MINT_RARITY_STYLE['普通'];
  const overlay = document.createElement('div');
  overlay.className = 'mint-overlay';
  overlay.innerHTML = `
    <div class="mint-flip" role="dialog" aria-modal="true" aria-label="纪念藏品">
      <button class="mint-overlay-close" type="button" aria-label="关闭">&times;</button>
      <div class="mint-flip-inner">
        <div class="mint-flip-face mint-back" style="background:${r.bg};border-color:${r.border}">
          <div class="mint-glyph">🔮</div>
          <div class="mint-back-title">星月占卜</div>
          <div class="mint-back-orn">TAROT · 星语</div>
        </div>
        <div class="mint-flip-face mint-front" style="background:${r.bg};border-color:${r.border}">
          <div class="mint-badge" style="color:${r.border};border-color:${r.border}">${escHtml(d.rarity)}</div>
          <div class="mint-glyph">✨</div>
          <div class="mint-name">${escHtml(d.name)}</div>
          <div class="mint-motif">${escHtml(d.motif)}</div>
          <div class="mint-meta"><span>编号 ${escHtml(d.serial)}</span><span>${escHtml(d.tokenId)}</span></div>
          <div class="mint-tip">点击卡牌可翻面</div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const inner = overlay.querySelector<HTMLElement>('.mint-flip-inner')!;
  requestAnimationFrame(() => {
    overlay.classList.add('mint-show');
    // 让入场淡入与翻面动作错开,先看卡背,再缓缓翻出藏品
    setTimeout(() => inner.classList.add('flipped'), 420);
  });

  const close = () => {
    overlay.classList.remove('mint-show');
    setTimeout(() => overlay.remove(), 360);
  };
  overlay.querySelector('.mint-overlay-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  inner.addEventListener('click', () => inner.classList.toggle('flipped'));
}

// 文本输入框发送(与语音共用 session.send 路径)
function sendText(text: string) {
  const q = text.trim();
  if (!q || busy) return;
  // 自述环节:文字输入直接提交为自述,而非普通提问
  if (narrationMode) {
    narrationMode = false;
    clearOrbStage();
    orbLabel.textContent = '触碰水晶';
    runSubmit(() => session.submitSelfNarration(q));
    return;
  }
  if (!session.hasApiKey()) {
    appendUserMessage(q);
    setChatStatus('请先配置 API Key（右上角 ✧ 菜单）', 'idle');
    return;
  }
  busy = true;
  audioManager.duckBGM();
  void session.send(q).finally(() => {
    busy = false;
    audioManager.restoreBGM(600);
  });
}

// 统一包装:问卷提交 / 选牌提交 / 逐张「继续」等由 UI 触发的会话推进动作
function runSubmit(task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  audioManager.duckBGM();
  void task().finally(() => {
    busy = false;
    audioManager.restoreBGM(600);
  });
}

// 倾诉 / 占卜切换:多轮沟通后由用户决定「继续倾诉」还是「就聊这么多」推进占卜
const chatControls = document.querySelector<HTMLDivElement>('.chat-controls')!;
const btnMoreChat = chatControls.querySelector<HTMLButtonElement>('[data-chat="more"]')!;
const btnProceed = chatControls.querySelector<HTMLButtonElement>('[data-chat="proceed"]')!;
function showChatControls(show: boolean) {
  chatControls.classList.toggle('chat-hidden', !show);
}
btnMoreChat.addEventListener('click', () => {
  if (busy) return;
  runSubmit(() => session.continueChat());
});
btnProceed.addEventListener('click', () => {
  if (busy) return;
  showChatControls(false);
  runSubmit(() => session.proceedToDivine());
});

chatInputSend.addEventListener('click', () => {
  const text = chatInputField.value;
  if (!text.trim()) return;
  chatInputField.value = '';
  sendText(text);
});
chatInputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    const text = chatInputField.value;
    if (!text.trim()) return;
    chatInputField.value = '';
    sendText(text);
  }
});

// Full conversational turn: sends the seeker's question to the real Tarot Agent.
// The Agent streams its reply + tool cards into .chat-log via TarotSession.
function converse(reading: Reading, question?: string, _continuous = false) {
  const q = question ?? reading.question ?? '请为我指引方向。';
  if (!session.hasApiKey()) {
    appendUserMessage(q);
    setChatStatus('请先配置 API Key（右上角 ✧ 菜单）', 'idle');
    busy = false;
    return;
  }
  // TTS 期间 BGM ducking
  audioManager.duckBGM();
  // session.send 内部渲染用户气泡 + 流式回复 + 工具卡片，完成后释放 busy
  void session.send(q).finally(() => {
    busy = false;
    // BGM 回升
    audioManager.restoreBGM(600);
    // 连续语音模式：Agent 回复完毕后自动重新开始聆听
    if (_continuous && continuousMode) {
      setChatStatus('星辰继续聆听……', 'thinking');
      window.setTimeout(() => {
        if (continuousMode && !busy && !listening) beginListening('continuous');
      }, 600);
    }
  });
}

function revealReading(reading?: Reading) {
  const r = reading ?? selectReading();
  window.clearTimeout(channelTimer);
  sanctum.classList.remove('star-channeling');
  void sanctum.offsetWidth;
  sanctum.classList.add('star-channeling');
  orb.classList.remove('resting');
  orb.classList.add('channeling');
  channelTimer = window.setTimeout(() => {
    showReading(r);
    orb.classList.remove('channeling', 'resting');
    sanctum.classList.remove('star-channeling');
  }, 850);
  return r;
}

// A brief full-screen flash punctuates the end of the energy release, right
// before the reading surfaces — a visual "snap" of the ritual completing.
function flashUI() {
  sanctum.classList.remove('flash');
  void sanctum.offsetWidth;
  sanctum.classList.add('flash');
  window.setTimeout(() => sanctum.classList.remove('flash'), 520);
}

function releaseChargedEnergy(spokenQuestion?: string) {
  const reading = selectReading();
  releaseTimers.forEach((timer) => window.clearTimeout(timer));
  releaseTimers = [];
  window.clearTimeout(channelTimer);
  orb.classList.remove('charging', 'channeling', 'resting', 'energy-burst');
  orb.classList.add('energy-dim');
  audioManager.playSpinStart(); // 命运之轮转动音

  releaseTimers.push(window.setTimeout(() => {
    orb.classList.remove('energy-dim');
    orb.classList.add('energy-burst');
    sanctum.classList.remove('star-channeling');
    void sanctum.offsetWidth;
    sanctum.classList.add('star-channeling');
  }, 160));

  releaseTimers.push(window.setTimeout(() => {
    showReading(reading);
    audioManager.playSpinStop();
    audioManager.playSpinSettle();
    audioManager.playCardReveal();
    orb.classList.remove('energy-burst', 'resting');
    sanctum.classList.remove('star-channeling');
    // Strong finishing flash marks the release, then the conversation begins.
    flashUI();
    // 长按语音已由 handleAsrEnd 转写好并作为 spokenQuestion 传入;
    // 没听清则为 undefined,走「无声抽牌」。
    converse(reading, spokenQuestion || undefined);
  }, 790));
}

// ── Voice input on the crystal (ASR) ───────────────────────────────
// 录音由 src/asr.ts 统一管理(阿里云百炼 Paraformer),支持三种手势:
//   tap(点一下)、hold(长按)、continuous(右上角光环持续对话)。
// `asrMode` 记录当前录音属于哪个手势,`handleAsrEnd` 在转写完成后统一路由。

function asrErrorToText(err: string): string {
  if (err === 'not-allowed') return '麦克风权限未开启，请允许后重试';
  if (err === 'no-audio') return '没有录到声音，请再试一次';
  if (err === 'no-text') return '没识别出内容，请再试一次';
  return err || '语音识别失败，请再试一次';
}

function handleAsrEnd(result: AsrResult) {
  const finishedMode = asrMode;
  asrMode = null;
  listening = false;
  orb.classList.remove('listening');
  sanctum.classList.remove('orb-listening');
  sanctum.classList.remove('voice-active');
  setVoiceLevel(0);
  audioManager.restoreBGM();

  // 长按:转写结果送入蓄能释放,由 releaseChargedEnergy 发起对话(不在此 converse)
  if (finishedMode === 'hold') {
    busy = true;
    releaseChargedEnergy(result.text ? result.text.trim() : undefined);
    return;
  }

  if (result.error) {
    audioManager.playRecogFail();
    setChatStatus(asrErrorToText(result.error), 'idle');
    if (finishedMode === 'continuous') stopContinuousChat();
    return;
  }

  const heard = result.text.trim();
  if (heard) {
    audioManager.playRecogSuccess();
    // 自述环节:语音内容提交为自述,而非普通提问
    if (narrationMode) {
      narrationMode = false;
      clearOrbStage();
      orbLabel.textContent = '触碰水晶';
      runSubmit(() => session.submitSelfNarration(heard));
      return;
    }
    busy = true;
    const reading = revealReading();
    converse(reading, heard, finishedMode === 'continuous');
  } else if (finishedMode === 'continuous') {
    // Persistent chat: nothing heard, keep the ear open.
    setChatStatus('我在听，请继续说……', 'thinking');
    window.setTimeout(() => { if (continuousMode && !busy) beginListening('continuous'); }, 400);
  } else {
    audioManager.playRecogFail();
    setChatStatus('没有听清，请再试一次', 'idle');
  }
}

function stopListening() {
  finishAsr();
}

function cancelListening() {
  cancelAsr();
  listening = false;
  asrMode = null;
  orb.classList.remove('listening');
  sanctum.classList.remove('orb-listening');
  sanctum.classList.remove('voice-active');
  setVoiceLevel(0);
  audioManager.restoreBGM();
}

function beginListening(mode: AsrMode = 'tap') {
  if (busy || listening) return;
  asrMode = mode;
  listening = true;
  orb.classList.add('listening');
  sanctum.classList.add('orb-listening');
  if (mode !== 'tap') sanctum.classList.add('voice-active');
  setChatStatus('星辰正在聆听……', 'thinking');

  // 先停掉可能正在朗读的 TTS,避免抢麦。
  stopAliyunTTS();
  audioManager.duckBGM();

  void beginAsr({
    mode,
    silenceMs: mode === 'hold' ? 0 : 1400,
    maxMs: mode === 'tap' ? 8000 : mode === 'continuous' ? 12000 : 0,
    onLevel: setVoiceLevel,
    onEnd: handleAsrEnd,
  });
}

orb.addEventListener('click', () => {
  if (skipNextOrbClick) {
    skipNextOrbClick = false;
    return;
  }
  // 抽牌模式:点击水晶即完成抽牌
  if (orbMode === 'awaiting-draw') {
    orbMode = 'idle';
    orb.classList.remove('awaiting-draw');
    orbLabel.textContent = '触碰水晶';
    audioManager.playCrystalTouch();
    audioManager.playSparkle(3);
    const resolver = drawResolver;
    drawResolver = null;
    resolver?.(true);
    return;
  }
  // 首次手势：解锁 AudioContext + 启动 BGM（幂等）
  audioManager.unlock();
  audioManager.startBGM();
  if (busy) {
    // 正在回复中 → 打断（清残留定时器 + 停 TTS + 中止 Agent）
    releaseTimers.forEach((t) => window.clearTimeout(t));
    releaseTimers = [];
    window.clearTimeout(channelTimer);
    audioManager.playSpinStop();
    audioManager.playInterrupt();
    stopAliyunTTS();
    session.abort();
    busy = false;
    setChatStatus('已打断，重新说吧', 'idle');
    return;
  }
  if (listening) {
    stopListening();
    return;
  }
  audioManager.playCrystalTouch();
  audioManager.playSparkle(3);
  beginListening('tap');
});
// A short tap opens voice input (ASR); a deliberate press-and-hold charges the
// crystal for the release-to-divine flow. Once the hold crosses the threshold we
// light the sound-responsive aura AND open the mic so the crystal reacts to the
// seeker's voice while they speak their question — mirroring the top-right aura
// button. On release we stop listening and let the held words become the query.
let holdTimer: number | undefined;
let holdEngaged = false;

orb.addEventListener('pointerdown', (event) => {
  if (busy || listening) return;
  orb.setPointerCapture(event.pointerId);
  holdEngaged = false;
  holdTimer = window.setTimeout(() => {
    holdEngaged = true;
    orb.classList.add('charging');
    sanctum.classList.add('orb-holding');
    // 录音 + 声控光环 + 转写由 beginListening 统一处理(src/asr.ts)
    beginListening('hold');
  }, 260);
});
orb.addEventListener('pointerup', (event) => {
  if (orb.hasPointerCapture(event.pointerId)) orb.releasePointerCapture(event.pointerId);
  window.clearTimeout(holdTimer);
  sanctum.classList.remove('orb-holding');
  // Only a real hold (charging engaged) releases stored energy; otherwise the
  // click handler fires and starts listening for the seeker's voice.
  if (!orb.classList.contains('charging')) return;
  skipNextOrbClick = true;
  holdEngaged = false;
  // 停止录音并转写,结果经 handleAsrEnd('hold') 送入 releaseChargedEnergy
  setChatStatus('正在解读你的心声……', 'thinking');
  stopListening();
});
orb.addEventListener('pointercancel', () => {
  window.clearTimeout(holdTimer);
  orb.classList.remove('charging');
  sanctum.classList.remove('orb-holding');
  if (holdEngaged) { cancelListening(); holdEngaged = false; }
});
orb.addEventListener('lostpointercapture', () => {
  window.clearTimeout(holdTimer);
  orb.classList.remove('charging');
  sanctum.classList.remove('orb-holding');
  if (holdEngaged) { cancelListening(); holdEngaged = false; }
});

const sound = document.querySelector<HTMLButtonElement>('.sound')!;
// Ambient toggle. It must NOT touch `voice-active` (that class is owned by the
// mic aura); instead it flips a self-contained ambience class so it never fights
// the voice halo. Also mutes/unmutes the oracle's TTS voice.
let ambientOn = false;
sound.addEventListener('click', () => {
  ambientOn = !ambientOn;
  sound.setAttribute('aria-pressed', String(ambientOn));
  sound.classList.toggle('active', ambientOn);
  sanctum.classList.toggle('ambient-active', ambientOn);
});

const voice = document.querySelector<HTMLButtonElement>('.voice')!;

// 光环电平由 src/asr.ts 的 onLevel 回调驱动,这里只负责写入 CSS 变量。
function setVoiceLevel(level: number) {
  const normalized = Math.min(1, Math.max(0, level));
  sanctum.style.setProperty('--voice-level', normalized.toFixed(3));
}

// ── Persistent top-right aura button: continuous voice chat ─────────
// Click to open a hands-free conversation — mic aura reacts to the voice, ASR
// listens, the oracle answers by TTS, then the ear reopens automatically. Click
// again to end. The aura halo tracks the seeker's voice level throughout.
function startContinuousChat() {
  continuousMode = true;
  voice.classList.add('active');
  voice.setAttribute('aria-pressed', 'true');
  voice.setAttribute('aria-label', '结束持续语音对话');
  voice.title = '结束持续语音对话';
  // 如果正在回复中，先打断
  if (busy) {
    stopAliyunTTS();
    session.abort();
    busy = false;
  }
  // 录音 + 声控光环 + 转写由 beginListening 统一处理(src/asr.ts)
  if (!busy && !listening) beginListening('continuous');
}

function stopContinuousChat() {
  continuousMode = false;
  cancelListening();
  voice.classList.remove('active');
  voice.setAttribute('aria-pressed', 'false');
  voice.setAttribute('aria-label', '开启持续语音对话');
  voice.title = '开启持续语音对话';
  if (!busy) setChatStatus('静候你的提问', 'idle');
}

voice.addEventListener('click', () => {
  audioManager.playBtnHover();
  if (continuousMode) stopContinuousChat();
  else startContinuousChat();
});

window.addEventListener('pagehide', () => {
  continuousMode = false;
  cancelListening();
  stopAliyunTTS();
  audioManager.dispose();
});

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((item) => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    if (action === 'divine') {
      if (busy) return;
      busy = true;
      const reading = revealReading();
      converse(reading, undefined);
    }
    if (action === 'constellation') {
      openHoroscopeModal();
    }
    if (action === 'energy') {
      openEnergyArchive();
    }
    if (action === 'config') {
      showApiKeyConfig(session);
    }
  });
});

window.addEventListener('pointermove', (event) => {
  document.documentElement.style.setProperty('--mx', `${(event.clientX / innerWidth - .5) * 12}px`);
  document.documentElement.style.setProperty('--my', `${(event.clientY / innerHeight - .5) * 12}px`);
});

// ── 今日星象 agent + 能量档案 ───────────────────────────────────────
// 「今日星象」:选星座 → 用「配置 API Key」里的模型生成今日运势卡片,自动存入能量档案。
// 「能量档案」:翻看历史星象卡片。
let hzStyleInjected = false;
function rarityClass(r: string): string {
  return ({ 普通: 'common', 稀有: 'rare', 史诗: 'epic', 传说: 'legendary' } as Record<string, string>)[r] ?? 'common';
}
function ensureHzStyle() {
  if (hzStyleInjected) return;
  hzStyleInjected = true;
  const el = document.createElement('style');
  el.textContent = `
  .hz-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
  .hz-sign{padding:10px 4px;border-radius:12px;border:1px solid rgba(198,129,241,.3);
    background:rgba(198,129,241,.07);color:#e7dfff;cursor:pointer;font-family:inherit;
    display:flex;flex-direction:column;align-items:center;gap:2px;transition:background .15s,transform .1s}
  .hz-sign:hover{background:rgba(198,129,241,.2)}
  .hz-sign:active{transform:scale(.96)}
  .hz-sign .hz-sym{font-size:20px}
  .hz-sign .hz-name{font-size:12.5px;font-weight:600}
  .hz-sign .hz-range{font-size:10px;color:#a99cc9}
  .hz-loading{text-align:center;padding:26px 0 20px;color:#d7cdf3;font-size:13.5px}
  .hz-loading .hz-orb{font-size:34px;display:inline-block;animation:hzSpin 2.2s linear infinite}
  @keyframes hzSpin{to{transform:rotate(360deg)}}
  .hz-sub{margin-top:8px;font-size:11.5px;color:#a99cc9}
  .hz-card{text-align:left}
  .hz-card-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .hz-card-sym{font-size:34px;line-height:1}
  .hz-card-title{font-size:16.5px;font-weight:700;color:#fff}
  .hz-card-date{font-size:11px;color:#a99cc9;margin-top:3px}
  .hz-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
  .hz-chip{padding:4px 11px;border-radius:999px;border:1px solid rgba(198,129,241,.4);
    background:rgba(198,129,241,.12);color:#e3d8ff;font-size:11.5px}
  .hz-msg{font-size:13.5px;line-height:1.8;color:#efe9ff;white-space:pre-wrap}
  .hz-lucky{display:flex;gap:18px;margin-top:12px;padding:10px 12px;border-radius:12px;
    background:rgba(255,255,255,.05);font-size:12px;color:#c9bce8}
  .hz-lucky b{color:#f0e6ff;font-weight:600;margin-left:4px}
  .hz-advice{margin-top:10px;font-size:12.5px;color:#e8d9a8}
  .hz-saved{margin-top:12px;font-size:11px;color:#8fd8b8;text-align:center}
  .hz-actions{display:flex;gap:10px;margin-top:14px}
  .hz-btn{flex:1;padding:10px 0;border-radius:12px;border:0;cursor:pointer;font-size:12.5px;
    font-weight:700;font-family:inherit;color:#fff;background:linear-gradient(135deg,#8b5cf6,#c084fc);
    transition:filter .15s,transform .1s}
  .hz-btn:hover{filter:brightness(1.1)}
  .hz-btn:active{transform:scale(.97)}
  .hz-btn.ghost{background:rgba(255,255,255,.09);color:#d7cdf3}
  .hz-list{max-height:56vh;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:8px}
  .hz-item{padding:10px 12px;border-radius:12px;border:1px solid rgba(198,129,241,.22);
    background:rgba(198,129,241,.06);cursor:pointer;text-align:left;color:inherit;font-family:inherit;
    transition:background .15s}
  .hz-item:hover{background:rgba(198,129,241,.16)}
  .hz-item-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .hz-item-title{font-size:13px;font-weight:600;color:#efe9ff}
  .hz-item-date{font-size:10.5px;color:#a99cc9;white-space:nowrap}
  .hz-item-sign{font-size:11px;color:#c084fc;margin-top:3px}
  .hz-item-kw{font-size:10.5px;color:#a99cc9;margin-top:3px}
  .hz-empty{text-align:center;padding:30px 6px;color:#a99cc9;font-size:12.5px;line-height:1.9}
  .hz-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px}
  .hz-clear{background:none;border:0;cursor:pointer;font-family:inherit;font-size:11px;color:#8a7fa6;padding:2px}
  .hz-clear:hover{color:#e94560}
  .hz-close{background:none;border:0;cursor:pointer;font-family:inherit;font-size:11.5px;color:#c4b5fd;padding:2px}
  .hz-close:hover{color:#fff}
  .hz-err{text-align:center;padding:18px 4px 8px;color:#ffb3c0;font-size:12.5px;line-height:1.7}
  .hz-rarity{display:inline-block;padding:1px 9px;border-radius:999px;font-size:10.5px;font-weight:700}
  .rz-common{background:rgba(148,163,184,.18);color:#b8c4d4}
  .rz-rare{background:rgba(56,189,248,.16);color:#7dd3fc}
  .rz-epic{background:rgba(192,132,252,.18);color:#d8b4fe}
  .rz-legendary{background:rgba(251,191,36,.16);color:#fcd34d}
  `;
  document.head.appendChild(el);
}

function openHzModal(): HTMLElement {
  ensureHzStyle();
  const mask = document.createElement('div');
  mask.className = 'cfg-mask';
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('cfg-show'));
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeHzModal(mask);
  });
  return mask;
}

function closeHzModal(mask: HTMLElement) {
  mask.classList.remove('cfg-show');
  setTimeout(() => mask.remove(), 260);
}

/** 今日星象:星座选择 → 观测中 → 运势卡片 */
function openHoroscopeModal() {
  const mask = openHzModal();
  const modal = document.createElement('div');
  modal.className = 'cfg-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="cfg-title">☾ 今日星象 · 选择你的星座</div>
    <div class="hz-grid">
      ${ZODIAC_SIGNS.map((z) => `
        <button class="hz-sign" type="button" data-sign="${z.name}">
          <span class="hz-sym">${z.symbol}</span>
          <span class="hz-name">${z.name}</span>
          <span class="hz-range">${z.range}</span>
        </button>`).join('')}
    </div>`;
  mask.appendChild(modal);

  modal.querySelectorAll<HTMLButtonElement>('.hz-sign').forEach((btn) => {
    btn.addEventListener('click', () => observeHoroscope(mask, modal, btn.dataset.sign!));
  });
}

/** 观测一个星座:展示加载态 → 调 agent → 渲染卡片(当日有缓存直接出卡) */
async function observeHoroscope(mask: HTMLElement, modal: HTMLElement, sign: string) {
  const cached = getCachedHoroscope(sign);
  if (cached) {
    renderHzCard(mask, modal, cached, true);
    return;
  }

  modal.innerHTML = `
    <div class="cfg-title">☾ 今日星象 · ${sign}</div>
    <div class="hz-loading">
      <span class="hz-orb">✦</span>
      <div>正在观测今日星象……</div>
      <div class="hz-sub">星语正在读取星轨,约需十几秒</div>
    </div>`;

  try {
    const card = await generateHoroscope(sign);
    renderHzCard(mask, modal, card, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    modal.innerHTML = `
      <div class="cfg-title">☾ 今日星象 · ${sign}</div>
      <div class="hz-err">✕ ${msg}</div>
      <div class="hz-actions">
        <button class="hz-btn ghost" type="button" data-back>换个星座</button>
        <button class="hz-btn" type="button" data-retry>重新观测</button>
      </div>`;
    modal.querySelector<HTMLButtonElement>('[data-back]')!.addEventListener('click', () => {
      closeHzModal(mask);
      openHoroscopeModal();
    });
    modal.querySelector<HTMLButtonElement>('[data-retry]')!.addEventListener('click', () => {
      void observeHoroscope(mask, modal, sign);
    });
  }
}

/** 渲染运势卡片;同时把标题映到中央水晶球 */
function renderHzCard(mask: HTMLElement, modal: HTMLElement, card: HoroscopeCard, fromCache: boolean) {
  showReading({ title: card.title, symbol: card.symbol, keywords: card.keywords, message: card.message });
  const signMeta = ZODIAC_SIGNS.find((z) => z.name === card.sign);
  modal.innerHTML = `
    <div class="hz-card">
      <div class="hz-card-head">
        <span class="hz-card-sym">${card.symbol}</span>
        <div>
          <div class="hz-card-title">${card.title}</div>
          <div class="hz-card-date">${card.sign}${signMeta ? ` ${signMeta.symbol}` : ''} · ${card.date}${fromCache ? ' · 今日已观测' : ''}</div>
        </div>
      </div>
      ${card.keywords.length ? `<div class="hz-chips">${card.keywords.map((k) => `<span class="hz-chip">${k}</span>`).join('')}</div>` : ''}
      <div class="hz-msg">${card.message}</div>
      <div class="hz-lucky">
        <span>幸运色<b>${card.luckyColor}</b></span>
        <span>幸运数字<b>${card.luckyNumber}</b></span>
      </div>
      ${card.advice ? `<div class="hz-advice">✧ ${card.advice}</div>` : ''}
      <div class="hz-saved">✦ 已存入能量档案</div>
      <div class="hz-actions">
        <button class="hz-btn ghost" type="button" data-again>再测别的星座</button>
        <button class="hz-btn" type="button" data-done>收下卡片</button>
      </div>
    </div>`;
  modal.querySelector<HTMLButtonElement>('[data-again]')!.addEventListener('click', () => {
    closeHzModal(mask);
    openHoroscopeModal();
  });
  modal.querySelector<HTMLButtonElement>('[data-done]')!.addEventListener('click', () => closeHzModal(mask));
}

/** 能量档案:星象卡片收藏夹 */
function openEnergyArchive() {
  ensureHzStyle();
  const mask = document.createElement('div');
  mask.className = 'cfg-mask';
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('cfg-show'));
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeHzModal(mask);
  });

  const modal = document.createElement('div');
  modal.className = 'cfg-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  mask.appendChild(modal);

  const renderList = () => {
    const archive = loadArchive();
    modal.innerHTML = `
      <div class="cfg-title">◈ 能量档案 · 收藏</div>
      ${archive.length
        ? `<div class="hz-list">${archive.map((c, i) => {
            if (c.kind === 'tarot') {
              return `
            <button class="hz-item" type="button" data-idx="${i}">
              <div class="hz-item-top">
                <span class="hz-item-title">✨ ${c.name}</span>
                <span class="hz-item-date">${c.date}</span>
              </div>
              <div class="hz-item-sign"><span class="hz-rarity rz-${rarityClass(c.rarity)}">${c.rarity}</span> 纪念藏品 · ${c.tokenId}</div>
              ${c.motif ? `<div class="hz-item-kw">${c.motif}</div>` : ''}
            </button>`;
            }
            return `
            <button class="hz-item" type="button" data-idx="${i}">
              <div class="hz-item-top">
                <span class="hz-item-title">${c.symbol} ${c.title}</span>
                <span class="hz-item-date">${c.date}</span>
              </div>
              <div class="hz-item-sign">${c.sign}</div>
              ${c.keywords.length ? `<div class="hz-item-kw">${c.keywords.join(' · ')}</div>` : ''}
            </button>`;
          }).join('')}</div>`
        : `<div class="hz-empty">档案还是空的<br>去「今日星象」生成星象卡<br>或完成一次塔罗占卜收集纪念藏品吧 ✦</div>`}
      <div class="hz-foot">
        ${archive.length ? '<button class="hz-clear" type="button" data-clear>清空档案</button>' : '<span></span>'}
        <button class="hz-close" type="button" data-close>关闭</button>
      </div>`;

    modal.querySelectorAll<HTMLButtonElement>('.hz-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = loadArchive()[Number(btn.dataset.idx)];
        if (card) renderCardDetail(card);
      });
    });
    modal.querySelector<HTMLButtonElement>('[data-close]')!.addEventListener('click', () => closeHzModal(mask));
    const clearBtn = modal.querySelector<HTMLButtonElement>('[data-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (clearBtn.dataset.arm === '1') {
          clearArchive();
          renderList();
        } else {
          clearBtn.dataset.arm = '1';
          clearBtn.textContent = '再点一次确认清空';
        }
      });
    }
  };

  const renderCardDetail = (card: ArchiveEntry) => {
    if (card.kind === 'tarot') {
      modal.innerHTML = `
        <div class="hz-card">
          <div class="hz-card-head">
            <span class="hz-card-sym">✨</span>
            <div>
              <div class="hz-card-title">${card.name}</div>
              <div class="hz-card-date"><span class="hz-rarity rz-${rarityClass(card.rarity)}">${card.rarity}</span> · ${card.date}</div>
            </div>
          </div>
          ${card.motif ? `<div class="hz-msg">${card.motif}</div>` : ''}
          <div class="hz-lucky">
            <span>编号<b>${card.serial}</b></span>
            <span>藏品 ID<b>${card.tokenId}</b></span>
          </div>
          <div class="hz-actions">
            <button class="hz-btn ghost" type="button" data-back>返回档案</button>
            <button class="hz-btn" type="button" data-close>收起</button>
          </div>
        </div>`;
    } else {
      showReading({ title: card.title, symbol: card.symbol, keywords: card.keywords, message: card.message });
      const signMeta = ZODIAC_SIGNS.find((z) => z.name === card.sign);
      modal.innerHTML = `
        <div class="hz-card">
          <div class="hz-card-head">
            <span class="hz-card-sym">${card.symbol}</span>
            <div>
              <div class="hz-card-title">${card.title}</div>
              <div class="hz-card-date">${card.sign}${signMeta ? ` ${signMeta.symbol}` : ''} · ${card.date}</div>
            </div>
          </div>
          ${card.keywords.length ? `<div class="hz-chips">${card.keywords.map((k) => `<span class="hz-chip">${k}</span>`).join('')}</div>` : ''}
          <div class="hz-msg">${card.message}</div>
          <div class="hz-lucky">
            <span>幸运色<b>${card.luckyColor}</b></span>
            <span>幸运数字<b>${card.luckyNumber}</b></span>
          </div>
          ${card.advice ? `<div class="hz-advice">✧ ${card.advice}</div>` : ''}
          <div class="hz-actions">
            <button class="hz-btn ghost" type="button" data-back>返回档案</button>
            <button class="hz-btn" type="button" data-close>收起</button>
          </div>
        </div>`;
    }
    modal.querySelector<HTMLButtonElement>('[data-back]')!.addEventListener('click', renderList);
    modal.querySelector<HTMLButtonElement>('[data-close]')!.addEventListener('click', () => closeHzModal(mask));
  };

  renderList();
}

// ── API Key 配置弹窗 ───────────────────────────────────────────────
function showApiKeyConfig(sess: TarotSession) {
  const mask = document.createElement('div');
  mask.className = 'cfg-mask';
  mask.innerHTML = `
    <div class="cfg-modal" role="dialog" aria-modal="true">
      <div class="cfg-title">⚙ 配置占卜服务</div>
      <label class="cfg-label">API Key（对话 · 星象）
        <input class="cfg-input" id="cfgKey" type="password" placeholder="智谱 Key,如 0387...xxx" autocomplete="off" />
      </label>
      <label class="cfg-label">语音识别 API Key（可选，留空则用上面的 Key）
        <input class="cfg-input" id="cfgAsrKey" type="password" placeholder="默认使用上方 API Key" autocomplete="off" />
      </label>
      <label class="cfg-label">语音识别模型（默认 glm-asr-2512）
        <input class="cfg-input" id="cfgAsrModel" type="text" placeholder="glm-asr-2512" autocomplete="off" />
      </label>
      <label class="cfg-label">API 地址（默认智谱 GLM）
        <input class="cfg-input" id="cfgUrl" type="text" placeholder="${DEFAULT_BASE_URL}" />
      </label>
      <label class="cfg-label">模型名称
        <input class="cfg-input" id="cfgModel" type="text" placeholder="${DEFAULT_MODEL_ID}" />
      </label>
      <div class="cfg-warn">⚠ 仅本地体验：Key 直接从浏览器发起请求，勿公开部署。</div>
      <div class="cfg-actions">
        <button class="cfg-btn cfg-cancel" type="button">取消</button>
        <button class="cfg-btn cfg-save" type="button">保存</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('cfg-show'));

  const keyEl = mask.querySelector<HTMLInputElement>('#cfgKey')!;
  const asrKeyEl = mask.querySelector<HTMLInputElement>('#cfgAsrKey')!;
  const asrModelEl = mask.querySelector<HTMLInputElement>('#cfgAsrModel')!;
  const urlEl = mask.querySelector<HTMLInputElement>('#cfgUrl')!;
  const modelEl = mask.querySelector<HTMLInputElement>('#cfgModel')!;
  keyEl.value = localStorage.getItem('tarot.apiKey') ?? DEFAULT_API_KEY;
  asrKeyEl.value = localStorage.getItem('tarot.asrApiKey') ?? '';
  asrModelEl.value = localStorage.getItem('tarot.asrModel') ?? '';
  urlEl.value = localStorage.getItem('tarot.baseUrl') ?? DEFAULT_BASE_URL;
  modelEl.value = localStorage.getItem('tarot.modelId') ?? DEFAULT_MODEL_ID;

  const close = () => { mask.classList.remove('cfg-show'); setTimeout(() => mask.remove(), 260); };
  mask.querySelector('.cfg-cancel')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  mask.querySelector('.cfg-save')!.addEventListener('click', () => {
    const apiKey = keyEl.value.trim();
    if (!apiKey) { keyEl.focus(); return; }
    localStorage.setItem('tarot.asrApiKey', asrKeyEl.value.trim()); // 语音识别专用 Key(可空=用主 Key)
    localStorage.setItem('tarot.asrModel', asrModelEl.value.trim()); // 语音识别模型(可空=glm-asr-2512)
    sess.saveConfig({ apiKey, baseUrl: urlEl.value.trim(), modelId: modelEl.value.trim() });
    setChatStatus('已配置，触碰水晶开始占卜', 'idle');
    const empty = chatLog.querySelector('.chat-empty');
    if (empty) empty.textContent = '按住水晶球，向星辰许下你的疑问……';
    close();
  });
  setTimeout(() => keyEl.focus(), 100);
}

// 配置弹窗样式
const cfgStyle = document.createElement('style');
cfgStyle.textContent = `
.cfg-mask{position:fixed;inset:0;z-index:1001;display:flex;align-items:center;justify-content:center;
  background:rgba(10,4,26,.62);backdrop-filter:blur(6px);opacity:0;transition:opacity .26s}
.cfg-mask.cfg-show{opacity:1}
.cfg-modal{width:min(92vw,400px);border-radius:20px;padding:24px;background:linear-gradient(160deg,#241246,#160a2e);
  border:1px solid rgba(198,129,241,.28);box-shadow:0 24px 80px rgba(0,0,0,.5);color:#ede7ff;
  font-family:'Noto Sans SC',system-ui,sans-serif;transform:translateY(14px) scale(.97);transition:transform .3s cubic-bezier(.2,.8,.2,1)}
.cfg-mask.cfg-show .cfg-modal{transform:none}
.cfg-title{font-size:17px;font-weight:600;margin-bottom:16px}
.cfg-label{display:block;font-size:12.5px;color:#a99cc9;margin-bottom:12px}
.cfg-input{width:100%;margin-top:5px;padding:9px 11px;border-radius:10px;border:1px solid rgba(198,129,241,.25);
  background:rgba(255,255,255,.05);color:#ede7ff;font-size:13px;font-family:inherit;box-sizing:border-box}
.cfg-input:focus{outline:none;border-color:rgba(198,129,241,.6)}
.cfg-warn{font-size:11.5px;color:#e0a94f;margin:4px 0 16px}
.cfg-actions{display:flex;gap:12px}
.cfg-btn{flex:1;padding:10px 0;border-radius:11px;border:0;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit}
.cfg-save{background:linear-gradient(135deg,#8b5cf6,#c084fc);color:#fff}
.cfg-cancel{background:rgba(255,255,255,.08);color:#c9bfe6}`;
document.head.appendChild(cfgStyle);
