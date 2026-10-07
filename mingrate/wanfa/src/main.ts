/** 塔罗占卜大师 - 核心应用逻辑（phase 驱动） */
import './style.css';
import { drawUniqueCards, randomOrientation, ALL_CARDS } from './cards';
import { generateReading, simulateStreaming } from './readings';
import type { GameState, Theme, DrawnCard, AIReading, Phase, ReadingSeed } from './types';
import { THEME_LABELS, POSITION_LABELS } from './types';
import { VoiceManager } from './voice-manager';
import { sound } from './sound';
import { openStage as openVoiceStage, closeStage as closeVoiceStage, isStageOpen } from './voice-stage';
import { setCallbacks as setPhaseCallbacks, startIntake, processUserInput, getSeed, getDrawnCards, getReadingForPhase, enterReading, enterFollowup, generateFollowup, resetAll as resetPhase, getPhase } from './phase';

// ===== 全局状态 =====
let currentState: GameState = 'LANDING';
let selectedTheme: Theme = 'general';
let drawnCards: DrawnCard[] = [];
let currentReading: AIReading | null = null;
let currentPhase: Phase = 'intake';

const app = document.querySelector<HTMLDivElement>('#app')!;
let contentEl: HTMLDivElement;

// ===== 语音管理器 =====
const voice = new VoiceManager();

// ===== 语音输入回调（Phase 感知：followup 用上下文，intake 用多轮） =====
voice.onUserSpeechResult((text: string) => {
  if (currentPhase === 'intake') {
    // intake：输入送 phase 引擎
    processUserInput(text);
  } else if (currentPhase === 'followup' && currentReading) {
    // followup：带上下文回复
    const answer = generateFollowup(text);

    const readingText = contentEl?.querySelector<HTMLDivElement>('#readingText');
    if (readingText) {
      const block = document.createElement('div');
      block.className = 'followup-answer';
      block.innerHTML = `<div class="followup-q">🎙️ 你问：${text}</div><div class="followup-a">${answer}</div>`;
      readingText.appendChild(block);
      readingText.scrollTop = readingText.scrollHeight;
    }
    voice.speak(answer, { rate: 1.0 });
  } else if (currentState === 'COMPLETE' && currentReading) {
    // 回退：旧兜底
    const answer = generateFollowup(text);
    const readingText = contentEl?.querySelector<HTMLDivElement>('#readingText');
    if (readingText) {
      const block = document.createElement('div');
      block.className = 'followup-answer';
      block.innerHTML = `<div class="followup-q">🎙️ 你问：${text}</div><div class="followup-a">${answer}</div>`;
      readingText.appendChild(block);
      readingText.scrollTop = readingText.scrollHeight;
    }
    voice.speak(answer, { rate: 1.0 });
  }
});

// ===== 初始化 =====
function init() {
  app.innerHTML = `
    <main class="sanctum">
      <div class="veil"></div>
      <div class="stars" aria-hidden="true"></div>
      <header class="nav d-flex align-items-center justify-content-between">
        <a class="brand" href="#" aria-label="首页"><span>✧</span> 星月占卜</a>
        <button class="sound" aria-label="切换环境音" aria-pressed="false"><span></span><span></span><span></span></button>
      </header>
      <div class="content"></div>
    </main>
  `;

  contentEl = app.querySelector('.content')!;

  // 生成星空
  const stars = app.querySelector('.stars')!;
  for (let i = 0; i < 60; i++) {
    const s = document.createElement('i');
    s.style.setProperty('--x', `${Math.random() * 100}%`);
    s.style.setProperty('--y', `${Math.random() * 100}%`);
    s.style.setProperty('--d', `${1.5 + Math.random() * 4}s`);
    s.style.setProperty('--s', `${1 + Math.random() * 3}px`);
    stars.append(s);
  }

  // 声音按钮
  app.querySelector('.sound')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const active = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', String(!active));
    btn.classList.toggle('active', !active);
  });

  // 鼠标视差
  window.addEventListener('pointermove', (e) => {
    document.documentElement.style.setProperty('--mx', `${(e.clientX / innerWidth - 0.5) * 12}px`);
    document.documentElement.style.setProperty('--my', `${(e.clientY / innerHeight - 0.5) * 12}px`);
  });

  showLanding();

  // 创建语音按钮（插入到 sanctum 底部，不受内容切换影响）
  const sanctum = app.querySelector('.sanctum') as HTMLElement;
  voice.createButton(sanctum);

  // 浮球 → 打开星灵语音在场界面
  const voiceBtn = sanctum.querySelector('.voice-btn');
  if (voiceBtn) {
    voiceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openVoiceStage({
        onStartListen: () => voice.startListening((text) => voice.stopListening()),
        onStopVoice: () => voice.stopSpeaking(),
      });
    }, true);
  }

  // Phase 回调
  setPhaseCallbacks({
    onPhaseChange: (phase) => {
      currentPhase = phase;
      if (phase === 'intake') { contentEl.style.display = 'none'; }
      else if (phase === 'drawing' || phase === 'reading') { if (isStageOpen()) closeVoiceStage(); contentEl.style.display = ''; drawnCards = getDrawnCards(); if (phase === 'drawing') reallyShowReveal(); }
    },
    onCardsReady: (cards) => { drawnCards = cards; },
    onSayLine: (text) => { voice.speak(text, { rate: 1.0 }); },
  });
}

// ===== 工具：清空内容区 =====
function clearContent() {
  if (contentEl) {
    contentEl.style.animation = 'none';
    contentEl.innerHTML = '';
    contentEl.className = 'content';
    void contentEl.offsetWidth; // reflow
  }
}

// ===== Screen 00: 首页 =====
function showLanding() {
  currentState = 'LANDING';
  voice.onGameState('LANDING');
  clearContent();
  contentEl.classList.add('screen-landing');
  contentEl.innerHTML = `
    <section class="hero container-fluid">
      <div class="copy col-12 col-md-5">
        <p class="eyebrow">· CELESTIAL GUIDANCE ·</p>
        <h1>塔罗占卜<br/><em>大师</em></h1>
        <p class="intro">将你的疑问交给星辰。<br/>闭上双眼，深呼吸，当你准备好时触碰水晶。</p>
      </div>
      <button class="orb btn p-0 border-0" type="button" aria-label="开始占卜">
        <span class="orbit orbit-one"></span>
        <span class="orbit orbit-two"></span>
        <span class="orb-core"><b>✦</b></span>
        <span class="orb-label">触碰水晶</span>
      </button>
      <div class="hint"><span></span> 触碰水晶开始</div>
    </section>
  `;

  const hero = contentEl.querySelector('.hero') as HTMLElement;
  hero.style.animation = 'arrive 1.2s ease-out both';

  contentEl.querySelector('.orb')!.addEventListener('click', () => {
    sound.unlock();
    sound.playStart();
    sound.startDrone();
    sound.setAmbientLevel('full');
    sound.setAmbientActivity(true);
    // Phase: 进入 intake → 星灵全屏
    startIntake();
    openVoiceStage({
      onStartListen: () => voice.startListening((text) => { voice.stopListening(); processUserInput(text); }),
      onStopVoice: () => voice.stopSpeaking(),
    });
  });
}

// ===== Screen 01: 选择主题 =====
function showThemeSelect() {
  currentState = 'THEME_SELECT';
  voice.onGameState('THEME_SELECT');
  sound.playTransition('neutral');
  clearContent();
  contentEl.classList.add('screen-theme');
  contentEl.innerHTML = `
    <div class="theme-container">
      <div class="theme-header">
        <p class="eyebrow">· 选择你的问题领域 ·</p>
        <h2>你想问宇宙哪个方向的事？</h2>
      </div>
      <div class="theme-cards">
        ${(Object.entries(THEME_LABELS) as [Theme, typeof THEME_LABELS[Theme]][])
          .map(([key, t]) => `
            <button class="theme-btn" data-theme="${key}">
              <span class="theme-icon">${t.icon}</span>
              <span class="theme-label">${t.label}</span>
            </button>
          `).join('')}
      </div>
      <div class="question-area" style="display:none">
        <p class="question-hint">写下你的问题，或默默在心里想好…</p>
        <div class="question-input-wrap">
          <input type="text" class="question-input" placeholder="例如：我该跳槽吗？" maxlength="100" />
          <span class="input-glow"></span>
        </div>
        <button class="btn-start" disabled>开始洗牌</button>
      </div>
    </div>
  `;

  const themeBtns = contentEl.querySelectorAll('.theme-btn');
  const questionArea = contentEl.querySelector<HTMLDivElement>('.question-area')!;
  const questionInput = contentEl.querySelector<HTMLInputElement>('.question-input')!;
  const startBtn = contentEl.querySelector<HTMLButtonElement>('.btn-start')!;

  let themeSelected = false;

  themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTheme = btn.getAttribute('data-theme') as Theme;
      themeSelected = true;
      startBtn.disabled = false;
      // 渐显问题输入区
      questionArea.style.display = 'block';
      setTimeout(() => questionArea.classList.add('visible'), 50);
      // 聚焦输入框
      setTimeout(() => questionInput.focus(), 400);
    });
  });

  startBtn.addEventListener('click', () => {
    showCutting();
  });

  questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && themeSelected) {
      showCutting();
    }
  });
}

// ===== Screen 02: 切牌仪式 =====
function showCutting() {
  currentState = 'CUTTING';
  voice.onGameState('CUTTING');
  sound.playShuffle();
  clearContent();
  contentEl.classList.add('screen-cutting');
  contentEl.innerHTML = `
    <div class="cutting-container">
      <p class="cutting-hint">用手划过牌面，把你的能量传递给塔罗……</p>
      <div class="deck-area">
        <div class="card-stack">
          ${Array.from({ length: 12 }, (_, i) => `
            <div class="stack-card" style="--i:${i}; transform: rotate(${(i - 6) * 0.8}deg) translateY(${i * -1}px) translateX(${(i - 6) * 0.3}px)">
              <div class="card-back-inner"></div>
            </div>
          `).join('')}
        </div>
        <div class="deck-glow"></div>
      </div>
      <p class="cutting-sub">手指在牌面上滑动，感受能量的流动……</p>
    </div>
  `;

  const deckArea = contentEl.querySelector<HTMLDivElement>('.deck-area')!;
  const hint = contentEl.querySelector<HTMLParagraphElement>('.cutting-hint')!;
  const sub = contentEl.querySelector<HTMLParagraphElement>('.cutting-sub')!;
  let cutDone = false;

  // 点击 = 切牌（简化版——在手机上可以是滑动）
  const doCut = () => {
    if (cutDone) return;
    cutDone = true;

    // 牌堆分裂动画
    const stackCards = contentEl.querySelectorAll('.stack-card');
    stackCards.forEach((card, i) => {
      const el = card as HTMLElement;
      if (i < 6) {
        el.style.transform = `translateX(-120px) translateY(${(i - 6) * -3}px) rotate(${i * -2}deg)`;
        el.style.opacity = '0.6';
      } else {
        el.style.transform = `translateX(120px) translateY(${(i - 6) * -3}px) rotate(${i * 2}deg)`;
        el.style.opacity = '0.6';
      }
      el.style.transition = 'transform 0.6s cubic-bezier(.2,.8,.2,1), opacity 0.6s';
    });

    // 中间金色光隙
    const glow = contentEl.querySelector('.deck-glow')! as HTMLElement;
    glow.style.opacity = '1';
    glow.style.transform = 'scaleX(1)';

    hint.textContent = '✨ 能量已接收……命运之轮即将转动';
    sub.textContent = '';

    setTimeout(() => showSpinning(), 1000);
  };

  // 桌面点击 + 拖拽
  deckArea.addEventListener('click', doCut);
  deckArea.addEventListener('touchstart', (e) => {
    e.preventDefault();
    doCut();
  }, { passive: false });

  // 鼠标拖拽切牌
  let isDragging = false;
  deckArea.addEventListener('mousedown', () => { isDragging = true; });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; doCut(); }
  });
}

// ===== Screen 03: 洗牌 & 停牌 =====
function showSpinning() {
  currentState = 'SPINNING';
  voice.onGameState('SPINNING');
  clearContent();
  contentEl.classList.add('screen-spinning');
  contentEl.innerHTML = `
    <div class="spinning-container">
      <p class="spinning-hint">当你有感觉的瞬间——按下它！</p>
      <div class="spinning-wheel">
        <div class="wheel-card-display">
          <span class="wheel-card-name">命运之轮</span>
        </div>
        <div class="wheel-ring"></div>
        <div class="wheel-ring wheel-ring-2"></div>
      </div>
      <button class="stop-btn" id="stopBtn">
        <span class="stop-inner">🃏 停！</span>
        <span class="stop-glow"></span>
      </button>
      <div class="spinning-countdown" id="countdown"></div>
    </div>
  `;

  const nameDisplay = contentEl.querySelector('.wheel-card-name') as HTMLElement;
  const stopBtn = contentEl.querySelector<HTMLButtonElement>('#stopBtn')!;
  const countdownEl = contentEl.querySelector('#countdown')!;
  let stopped = false;

  // 快速轮换牌名
  let nameIdx = 0;
  const nameInterval = setInterval(() => {
    if (stopped) return;
    nameIdx = (nameIdx + 1) % ALL_CARDS.length;
    nameDisplay.textContent = ALL_CARDS[nameIdx].name;
    // 闪烁
    nameDisplay.style.opacity = '0.3';
    setTimeout(() => nameDisplay.style.opacity = '1', 40);
  }, 70);

  // 自动停计时
  let autoCount = 0;
  const autoInterval = setInterval(() => {
    autoCount++;
    if (autoCount === 3) {
      // 3s 未按，提示
      const hint = contentEl.querySelector('.spinning-hint')!;
      hint.textContent = '命运在等你决定……';
    }
    if (autoCount >= 8) {
      // 8s 自动停
      if (!stopped) doStop();
    }
  }, 1000);

  function doStop() {
    if (stopped) return;
    stopped = true;
    clearInterval(nameInterval);
    clearInterval(autoInterval);

    // 按钮爆炸效果
    stopBtn.classList.add('pressed');
    const glow = stopBtn.querySelector('.stop-glow')! as HTMLElement;
    glow.style.transform = 'scale(20)';
    glow.style.opacity = '0';

    // 暗场过渡
    setTimeout(() => showVRFWait(), 400);
  }

  stopBtn.addEventListener('click', doStop);
  // 空格键也可停
  const keyHandler = (e: KeyboardEvent) => {
    if (e.code === 'Space' && currentState === 'SPINNING') {
      e.preventDefault();
      doStop();
    }
  };
  window.addEventListener('keydown', keyHandler);
}

// ===== Screen 04: VRF 等待（命运之轮） =====
function showVRFWait() {
  currentState = 'VRF_WAIT';
  voice.onGameState('VRF_WAIT');
  clearContent();
  contentEl.classList.add('screen-vrf');
  contentEl.innerHTML = `
    <div class="vrf-container">
      <div class="vrf-overlay"></div>
      <div class="vrf-light-column"></div>
      <div class="vrf-content">
        <div class="fate-wheel">
          <div class="fate-ring"></div>
          <div class="fate-ring fate-ring-2"></div>
          <div class="fate-ring fate-ring-3"></div>
          <div class="fate-center">✦</div>
          ${Array.from({ length: 12 }, (_, i) => `
            <div class="fate-spoke" style="transform: rotate(${i * 30}deg)">
              <span class="spoke-dot"></span>
            </div>
          `).join('')}
        </div>
        <p class="vrf-text" id="vrfText">宇宙正在回应你的问题……</p>
        <div class="chain-badge">
          <span class="chain-icon">🔗</span>
          链上验证 · 随机数已请求
        </div>
      </div>
    </div>
  `;

  const vrfText = contentEl.querySelector('#vrfText')!;

  // 模拟 VRF 等待 2.5s
  setTimeout(() => {
    vrfText.textContent = '🔥 命运之轮已经转动……';
  }, 1500);

  setTimeout(() => {
    vrfText.textContent = '✅ 宇宙回应已收到！';
    // 抽取卡牌
    const cards = drawUniqueCards(3);
    drawnCards = cards.map((card, i) => ({
      card,
      orientation: randomOrientation(),
      position: ['past', 'present', 'future'][i] as DrawnCard['position'],
    }));

    setTimeout(() => reallyShowReveal(), 500);
  }, 2500);
}

// ===== Screen 05: 翻牌揭示（phase 驱动） =====
function reallyShowReveal() {
  currentState = 'REVEALING';
  voice.onGameState('REVEALING');
  clearContent();
  contentEl.classList.add('screen-reveal');
  contentEl.innerHTML = `
    <div class="reveal-container">
      <div class="reveal-table">
        ${drawnCards.map((c, i) => {
          const pos = POSITION_LABELS[c.position];
          return `
            <div class="card-slot" data-index="${i}">
              <div class="card-wrapper" id="cardWrapper${i}">
                <div class="card-inner">
                  <div class="card-front">
                    <div class="card-visual suit-${c.card.suit || 'major'}">
                      <span class="card-arcana-tag">${c.card.arcana === 'major' ? '大阿卡纳' : (c.card.suit ? '小阿卡纳' : '')}</span>
                      <span class="card-suit-icon">${c.card.element === '火' ? '🔥' : c.card.element === '水' ? '💧' : c.card.element === '风' ? '🌪️' : c.card.element === '土' ? '🪨' : '✦'}</span>
                      <span class="card-name-display">${c.card.name}</span>
                      <span class="card-orientation">${c.orientation === 'upright' ? '正位' : '逆位'}</span>
                      <div class="card-keywords">
                        ${(c.orientation === 'upright' ? c.card.keywordsUpright : c.card.keywordsReversed).slice(0, 3).map(k => `<span>${k}</span>`).join('')}
                      </div>
                    </div>
                  </div>
                  <div class="card-back">
                    <div class="card-back-pattern">
                      <span class="back-star">✦</span>
                      <span class="back-star s2">✧</span>
                      <span class="back-star s3">✦</span>
                    </div>
                  </div>
                </div>
              </div>
              <p class="card-pos-label" style="color:${pos.color}">—— ${pos.label} ——</p>
              <p class="card-pos-desc">${pos.desc}</p>
            </div>
          `;
        }).join('')}
      </div>
      <p class="reveal-hint" id="revealHint">即将揭示你的命运之牌……</p>
    </div>
  `;

  // 逐张翻转
  const hints = [
    '第一张牌，诉说着你的过去……',
    '第二张牌，映照你的当下……',
    '第三张牌，预示着你的未来……',
  ];

  drawnCards.forEach((_, i) => {
    setTimeout(() => {
      const wrapper = contentEl.querySelector<HTMLDivElement>(`#cardWrapper${i}`);
      if (wrapper) {
        wrapper.classList.add('flipped');
        sound.playReveal(i, currentReading?.sentimentTag === 'dark' ? 'dark' : undefined);
        // 爆发粒子效果
        const burst = document.createElement('div');
        burst.className = 'card-burst';
        wrapper.appendChild(burst);
        setTimeout(() => burst.remove(), 800);
      }

      const hint = contentEl.querySelector('#revealHint')!;
      hint.textContent = hints[i] || '';

      // 牌间连线
      if (i > 0) {
        const prevSlot = contentEl.querySelector(`.card-slot[data-index="${i - 1}"]`)!;
        const currSlot = contentEl.querySelector(`.card-slot[data-index="${i}"]`)!;
        const line = document.createElement('div');
        line.className = 'card-connector';
        line.style.cssText = `
          position: absolute; top: 45%; left: ${(i - 1) * 33 + 28}%; width: 6%;
          height: 2px; background: linear-gradient(90deg, #F6C90E, transparent);
          opacity: 0; transition: opacity 0.8s;
        `;
        contentEl.querySelector('.reveal-table')!.appendChild(line);
        setTimeout(() => line.style.opacity = '0.8', 50);
      }
    }, (i + 1) * 1400);
  });

  // 全部翻完后进入解读
  setTimeout(() => {
    const hint = contentEl.querySelector('#revealHint')!;
    hint.textContent = '✨ 三张牌已全部揭示……让我为你解读';
    setTimeout(() => showReading(), 600);
  }, drawnCards.length * 1400 + 800);
}

// ===== Screen 06: AI 解读 =====
function showReading() {
  currentState = 'READING';
  voice.onGameState('READING');
  clearContent();
  contentEl.classList.add('screen-reading');

  // Phase 驱动解读：用 seed 上下文生成
  currentReading = getReadingForPhase() || generateReading(drawnCards, selectedTheme);
  sound.playCgAccent(currentReading?.sentimentTag === 'dark' ? 'dark' : 'bright');
  enterReading();

  contentEl.innerHTML = `
    <div class="reading-container">
      <div class="reading-mini-cards">
        ${drawnCards.map((c, i) => {
          const pos = POSITION_LABELS[c.position];
          return `
            <div class="mini-card" data-cardidx="${i}">
              <div class="mini-card-visual suit-${c.card.suit || 'major'}">
                <span class="mini-suit-icon">${c.card.element === '火' ? '🔥' : c.card.element === '水' ? '💧' : c.card.element === '风' ? '🌪️' : c.card.element === '土' ? '🪨' : '✦'}</span>
                <span class="mini-card-name">${c.card.name}</span>
                <span class="mini-orientation ${c.orientation}">${c.orientation === 'upright' ? '↑ 正位' : '↓ 逆位'}</span>
              </div>
              <span class="mini-pos" style="color:${pos.color}">${pos.label}</span>
            </div>
          `;
        }).join('')}
      </div>

      ${currentReading.specialCombo ? `<div class="special-combo-badge">🏆 ${currentReading.specialCombo}</div>` : ''}

      <div class="reading-text" id="readingText"></div>

      <div class="reading-status" id="readingStatus">
        <span class="reading-pulsor"></span>
        <span>灵性能量正在流淌……</span>
      </div>
    </div>
  `;

  const readingText = contentEl.querySelector<HTMLDivElement>('#readingText')!;
  const readingStatus = contentEl.querySelector('#readingStatus')!;
  let readingBuffer = '';

  // 高亮顶部对应的牌
  function highlightCard(section: string) {
    contentEl.querySelectorAll('.mini-card').forEach(el => el.classList.remove('active'));
    if (section === 'card') {
      // 从 readingBuffer 中找当前正在说的牌——简化：按顺序高亮
      const activeIdx = readingBuffer.split('【').length - 2;
      if (activeIdx >= 0 && activeIdx < 3) {
        contentEl.querySelector(`.mini-card[data-cardidx="${activeIdx}"]`)?.classList.add('active');
      }
    }
  }

  // 流式输出
  simulateStreaming(
    currentReading,
    (chunk: string, section: string) => {
      readingBuffer += chunk;
      // 格式化：markdown 风格的简单渲染
      let display = readingBuffer
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br/>')
        .replace(/【(.*?)】/g, '<span class="reading-highlight">【$1】</span>')
        .replace(/「(.*?)」/g, '<span class="reading-quote">「$1」</span>')
        .replace(/  (\d+)\. /g, '<br/>　$1. ');
      readingText.innerHTML = `<p>${display}</p>`;
      readingText.scrollTop = readingText.scrollHeight;
      highlightCard(section);

      // 更新状态（前几次）
      const statusText = readingStatus.querySelector('span:last-child')!;
      if (readingBuffer.length < 30) statusText.textContent = '星辰正在编织你的解读……';
      else if (readingBuffer.length < 100) statusText.textContent = '灵性能量正在流淌……';
    },
    () => {
      // 解读完成
      readingStatus.innerHTML = '<span class="reading-done">✅ 解读完成</span>';
      // 自动朗读完整解读
      if (currentReading) {
        voice.speakReading(currentReading, selectedTheme, () => {
          voice.setAvailable();
          enterFollowup();  // reading 末句 → followup 阶段
        });
      }
      sound.playTransition(currentReading?.sentimentTag === 'dark' ? 'dark' : 'bright');
      setTimeout(() => showComplete(), 1000);
    }
  );
}

// ===== Screen 07: 完成 =====
function showComplete() {
  currentState = 'COMPLETE';
  voice.onGameState('COMPLETE');
  // 不clear，在下方追加操作栏
  const container = contentEl.querySelector('.reading-container')!;

  // 移除 loading status
  const status = container.querySelector('.reading-status');
  if (status) status.remove();

  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar';
  actionBar.innerHTML = `
    <div class="action-bar-inner">
      <p class="action-blessing">💝 ${currentReading?.blessing}</p>
      ${currentReading && ['sad', 'anxious'].includes(currentReading?.sentimentTag || '') ? '<p class="action-comfort">不管今天的牌面如何，你已经足够好了。我就在这儿。</p>' : ''}
      <div class="action-buttons">
        <button class="action-btn" id="actionSave">
          <span class="action-icon">🌙</span>
          <span>存入星盘</span>
        </button>
        <button class="action-btn" id="actionShare">
          <span class="action-icon">📤</span>
          <span>分享</span>
        </button>
        <button class="action-btn primary" id="actionRedo">
          <span class="action-icon">🔄</span>
          <span>再来一次</span>
        </button>
      </div>
      <div class="followup-area" id="followupArea">
        <p class="followup-hint">🔮 还想了解更多？</p>
        <div class="followup-bubbles">
          <button class="followup-bubble" data-type="deep">🔍 深入分析</button>
          <button class="followup-bubble" data-type="advice">💡 更多建议</button>
          <button class="followup-bubble" data-type="meaning">🔮 对我意味着什么</button>
        </div>
      </div>
    </div>
  `;

  container.appendChild(actionBar);

  // 动效入场
  setTimeout(() => actionBar.classList.add('visible'), 100);

  // 按钮事件
  actionBar.querySelector('#actionRedo')?.addEventListener('click', () => {
    sound.playReset();
    showLanding();
  });

  actionBar.querySelector('#actionSave')?.addEventListener('click', () => {
    sound.playSave();
    const btn = actionBar.querySelector('#actionSave')!;
    btn.innerHTML = '<span>✅ 已存入</span>';
    // 保存到 localStorage
    try {
      const history = JSON.parse(localStorage.getItem('tarot_history') || '[]');
      history.unshift({
        date: new Date().toISOString(),
        theme: selectedTheme,
        cards: drawnCards.map(c => ({ name: c.card.name, orientation: c.orientation, position: c.position })),
        blessing: currentReading?.blessing,
      });
      localStorage.setItem('tarot_history', JSON.stringify(history.slice(0, 50)));
    } catch (_) { /* ignore */ }
  });

  actionBar.querySelector('#actionShare')?.addEventListener('click', () => {
    sound.playShare();
    // 简化分享：复制结果到剪贴板
    const text = `🔮 塔罗占卜大师 · ${THEME_LABELS[selectedTheme].label}占卜\n\n${drawnCards.map(c => `${c.card.name}（${c.orientation === 'upright' ? '正位' : '逆位'}）`).join(' | ')}\n\n💝 ${currentReading?.blessing}\n\n—— 来自星月占卜`;
    navigator.clipboard?.writeText(text).then(() => {
      const btn = actionBar.querySelector('#actionShare')!;
      btn.innerHTML = '<span>✅ 已复制</span>';
      setTimeout(() => {
        btn.innerHTML = '<span class="action-icon">📤</span><span>分享</span>';
      }, 2000);
    });
  });

  // 追问气泡
  const bubbles = actionBar.querySelectorAll('.followup-bubble');
  bubbles.forEach(b => {
    b.addEventListener('click', function (this: HTMLButtonElement) {
      const type = this.getAttribute('data-type') || 'meaning';
      // 追加一段追问内容
      const answers: Record<string, string> = {
        deep: '这张牌在你的牌阵中出现在特定的位置，这不是偶然。从符号学的角度看，牌面上的每一个元素都在传递信息——色彩、方向、人物、符号。试着去注意那些反复出现在你生活中的图案和数字，它们可能正是宇宙在与你对话的方式。',
        advice: '除了牌面本身的指引，你还可以尝试：① 每天早晨问自己"今天我最重要的三件事是什么"；② 在做出决定前给自己24小时的冷静期；③ 信任你的第一直觉——它通常比深思熟虑更接近真相。',
        meaning: '这些牌不是关于一个注定的未来，而是关于你当前的能量状态和可能的路径。它们提醒你：你有选择权，有觉察力，也有改变的能力。真正的占卜不是预测，而是赋能。',
      };
      const answer = answers[type] || '这是一个很好的问题。试着静下来，深呼吸三次，然后问自己——你的直觉已经在给你答案了。';

      // 追加到阅读区
      const readingText = contentEl.querySelector('#readingText')!;
      const followUpBlock = document.createElement('div');
      followUpBlock.className = 'followup-answer';
      followUpBlock.innerHTML = `<div class="followup-q">💬 你问：${this.textContent}</div><div class="followup-a">${answer}</div>`;
      readingText.appendChild(followUpBlock);
      readingText.scrollTop = readingText.scrollHeight;

      // 锁住气泡（免费版限制）
      this.classList.add('used');
      this.textContent = '🔒 已使用';
      this.disabled = true;
    });
  });
}

// ===== 启动 =====
init();
