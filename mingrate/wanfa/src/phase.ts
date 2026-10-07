/**
 * phase.ts — 顶层编排：intake → drawing → reading → followup
 *
 * 职责：
 * - phase 状态机 + 路由
 * - intake 多轮对话模拟（现实项目替换为 LLM API 调用）
 * - reading_seed 维护
 * - 各 phase 切换时调用对应 UI 渲染/销毁
 *
 * 设计原则：
 * - intake 禁止渲染牌阵/解读 DOM（界面互斥）
 * - reading 禁止显示星灵全屏层（星灵退为浮球）
 * - followup 带 seed+牌阵+history 上下文
 */
import type { Phase, ReadingSeed, IntakeTurn, DrawnCard } from './types';
import { EMPATHY_PROMPT, JUDGMENT_PROMPT, STANDUP_TEMPLATE, READING_SYSTEM_PROMPT, FOLLOWUP_PROMPT, INTAKE_OPENING } from './prompts';
import { appendToFlow } from './voice-stage';
import { drawUniqueCards, randomOrientation, getCardByName } from './cards';
import { generateReading } from './readings';

// ===== 状态 =====
let currentPhase: Phase = 'intake';
let readingSeed: ReadingSeed | null = null;
let history: IntakeTurn[] = [];
let drawnCards: DrawnCard[] = [];
let currentCardsRaw: DrawnCard[] = [];

/* 外部回调：各 phase 进出时通知 UI */
let onPhaseChange: ((phase: Phase, seed?: ReadingSeed | null) => void) | null = null;
let onSeedReady: ((seed: ReadingSeed) => void) | null = null;
let onCardsReady: ((cards: DrawnCard[]) => void) | null = null;
let onSayLine: ((text: string, isLast: boolean) => void) | null = null;

// ===== 注册回调 =====
export function setCallbacks(cbs: {
  onPhaseChange?: (phase: Phase, seed?: ReadingSeed | null) => void;
  onSeedReady?: (seed: ReadingSeed) => void;
  onCardsReady?: (cards: DrawnCard[]) => void;
  onSayLine?: (text: string, isLast: boolean) => void;
}): void {
  if (cbs.onPhaseChange) onPhaseChange = cbs.onPhaseChange;
  if (cbs.onSeedReady) onSeedReady = cbs.onSeedReady;
  if (cbs.onCardsReady) onCardsReady = cbs.onCardsReady;
  if (cbs.onSayLine) onSayLine = cbs.onSayLine;
}

// ===== Phase 读写 =====
export function getPhase(): Phase { return currentPhase; }
export function getSeed(): ReadingSeed | null { return readingSeed; }
export function getHistory(): IntakeTurn[] { return history; }
export function getDrawnCards(): DrawnCard[] { return drawnCards; }

// ===== Phase 切换 =====
function setPhase(p: Phase, seed?: ReadingSeed | null): void {
  currentPhase = p;
  onPhaseChange?.(p, seed ?? readingSeed);
}

// ===== intake：多轮对话 =====
/**
 * 模拟 intake LLM 调用（现实项目替换为真实 API）。
 * 每轮：解析用户输入 → 提取信息 → 构建 seed（渐进式）→ 决定是否 ready_to_read。
 */
let intakeRound = 0;
let accumulatedInfo: Partial<ReadingSeed> = {};

export function startIntake(): void {
  currentPhase = 'intake';
  intakeRound = 0;
  accumulatedInfo = {};
  history = [];
  readingSeed = null;
  drawnCards = [];
  setPhase('intake');
}

/**
 * 处理用户的一轮输入（共情与判断解耦）。
 * 1. empathy call：生成共情回复（不含收敛意图）
 * 2. judgment call：判断是否 ready + 情绪 weight
 * 3. 若 ready → 起身回合 + trigger drawing
 */
export function processUserInput(userText: string): boolean {
  if (currentPhase !== 'intake') return false;
  intakeRound++;

  // 积累信息（规则引擎，模拟 LLM）
  accumulateInfo(userText);

  // 共情调用：决定说什么（禁收敛词）
  const empathySay = generateEmpathy(userText, intakeRound);

  // 判断调用：决定是否 ready + seed
  const judgment = generateJudgment(userText, intakeRound);

  const turn: IntakeTurn = {
    user: userText,
    assistant: {
      say: empathySay,
      ready_to_read: false,
      seed: null,
    },
  };

  history.push(turn);
  // 补丁3：对话流沉淀
  appendToFlow(userText, 'user');
  onSayLine?.(empathySay, false);
  appendToFlow(empathySay, 'star');

  // 判断就绪 + 情绪足够落地 → 起身回合（修正①：共情与收敛解耦）
  if (judgment.ready) {
    readingSeed = judgment.seed;
    onSeedReady?.(readingSeed!);
    // 起身回合：温暖过渡 + 抽牌邀请，郑重而不催
    appendToFlow(STANDUP_TEMPLATE, 'star');
    onSayLine?.(STANDUP_TEMPLATE, true);
    setTimeout(() => { doDrawing(); }, 600);
    return true;
  }
  return false;
}

/** 积累用户信息（规则引擎） */
function accumulateInfo(text: string): void {
  const t = text || '';
  if (!accumulatedInfo.focus && t.length > 3) accumulatedInfo.focus = t;
  if (!accumulatedInfo.domain) {
    accumulatedInfo.domain = ['感情','爱情'].find(k => t.includes(k)) ? '感情' :
      ['事业','工作','跳槽'].find(k => t.includes(k)) ? '事业' :
      ['财运','钱','收入'].find(k => t.includes(k)) ? '财运' :
      ['健康','身体','睡'].find(k => t.includes(k)) ? '健康' : '综合';
  }
  if (!accumulatedInfo.emotion) {
    accumulatedInfo.emotion = ['焦虑','不安','担心','紧张'].find(k => t.includes(k)) ? 'anxious' :
      ['难过','伤心','失落','孤独'].find(k => t.includes(k)) ? 'sad' :
      ['迷茫','犹豫','不懂'].find(k => t.includes(k)) ? 'confused' :
      ['希望','期待','加油'].find(k => t.includes(k)) ? 'hopeful' : 'neutral';
  }
}

/** 共情生成（纯陪伴，禁收敛） */
function generateEmpathy(text: string, round: number): string {
  const t = text || '';
  const pool: string[] = [];

  if (round === 1) {
    // 开场
    pool.push('嗯，我在听。');
    pool.push('这样啊……你慢慢说。');
    pool.push('我在。');
  } else {
    // 不规则姿态：自由选
    const patterns = [
      // 纯陪伴
      '嗯……',
      '这样啊。',
      '我听到了。',
      // 具象共鸣
      '像心里一直绷着一根弦，晚上躺下也松不了。',
      '像一个人走在雾里，看不清前面，但还是在走。',
      // 轻猜测
      '是不是有点像……卡在一个地方，进退都不对？',
      // 温柔追问
      '这种情况……多久了？',
      '身边有人知道你在扛这些吗？',
      // 回扣细节
      `你刚说「${t.slice(0, 12)}」……我记住了。`,
    ];
    pool.push(...patterns);
  }

  return pool[Math.floor(Math.random() * pool.length)] || '嗯……';
}

/** 独立判断（决定 ready/weight/seed） */
function generateJudgment(text: string, round: number): { ready: boolean; weight: number; seed: ReadingSeed | null } {
  const t = text || '';
  const info = accumulatedInfo;

  // 用户主动要求抽牌 → 立即 ready
  if (t.includes('看看') || t.includes('抽牌') || t.includes('占卜') || t.includes('算算')) {
    return { ready: true, weight: 1.0, seed: makeSeed(info, t) };
  }

  // 满 3 轮且信息清晰 → ready
  if (round >= 3 && info.focus && info.domain) {
    return { ready: true, weight: weightFor(info), seed: makeSeed(info, t) };
  }

  // 话长（>40 字）且情绪已落地 → ready
  if (t.length > 40 && info.emotion) {
    return { ready: true, weight: weightFor(info), seed: makeSeed(info, t) };
  }

  return { ready: false, weight: 0, seed: null };
}

function weightFor(info: Partial<ReadingSeed>): number {
  const w = { anxious: 1.0, sad: 1.4, confused: 0.7, hopeful: 0.3, neutral: 0.2 };
  return w[info.emotion as keyof typeof w] ?? 0.3;
}

function makeSeed(info: Partial<ReadingSeed>, text: string): ReadingSeed {
  const t = text || info.focus || '';
  const words = [info.domain || '综合'];
  if (info.focus) words.push(info.focus.slice(0, 6));
  return {
    focus: info.focus || t.slice(0, 40) || '内心困惑',
    emotion: (info.emotion || 'neutral') as ReadingSeed['emotion'],
    domain: info.domain || '综合',
    keywords: words.slice(0, 4).filter(Boolean).length > 0 ? words.slice(0, 4) : ['方向', '能量'],
    energy_tags: ['需要梳理'],
    chosen_cards: buildChosenCards(info),
  };
}

/** 根据内容给出推荐牌（C 档） */
function buildChosenCards(info: Partial<ReadingSeed>): ReadingSeed['chosen_cards'] {
  const domain = info.domain || '综合';
  const emotion = info.emotion || 'neutral';

  // 不同领域+情绪配不同牌组
  const cardPool: Record<string, Array<{name: string; ori: 'upright' | 'reversed'; why: string; pos: string}>> = {
    '感情_anxious': [
      { name: '恋人', ori: 'upright', why: '情感核心选择', pos: 'past' },
      { name: '圣杯二', ori: 'reversed', why: '关系失衡的当下', pos: 'present' },
      { name: '星星', ori: 'upright', why: '希望指引', pos: 'future' },
    ],
    '感情_sad': [
      { name: '圣杯五', ori: 'upright', why: '过去的失落', pos: 'past' },
      { name: '力量', ori: 'upright', why: '内心在撑', pos: 'present' },
      { name: '太阳', ori: 'upright', why: '终会放晴', pos: 'future' },
    ],
    '事业_anxious': [
      { name: '宝剑王牌', ori: 'reversed', why: '思绪被拧住', pos: 'past' },
      { name: '权杖三', ori: 'upright', why: '视野在打开', pos: 'present' },
      { name: '世界', ori: 'upright', why: '完成一个周期', pos: 'future' },
    ],
    '健康_anxious': [
      { name: '节制', ori: 'reversed', why: '内在失衡与自我苛责', pos: 'past' },
      { name: '权杖二', ori: 'upright', why: '站在选择的关口', pos: 'present' },
      { name: '死神', ori: 'upright', why: '结束旧模式，腾出新空间', pos: 'future' },
    ],
  };

  const key = `${domain}_${emotion}`;
  const cards = cardPool[key] || [
    { name: '隐士', ori: 'upright', why: '内在探索阶段', pos: 'past' },
    { name: '命运之轮', ori: 'upright', why: '转变正在发生', pos: 'present' },
    { name: '星星', ori: 'upright', why: '希望引领方向', pos: 'future' },
  ];

  return cards.map(c => ({ name: c.name, orientation: c.ori, why: c.why }));
}

// ===== drawing：落牌 =====
function doDrawing(): void {
  setPhase('drawing');

  // C 档：seed 含 chosen_cards → 用指定牌
  // A 档：纯随机
  const seed = readingSeed;
  if (seed?.chosen_cards && seed.chosen_cards.length === 3) {
    drawnCards = seed.chosen_cards.map((c, i) => {
      const card = getCardByName(c.name);
      return {
        card: card || drawUniqueCards(1)[0],
        orientation: c.orientation,
        position: ['past', 'present', 'future'][i] as DrawnCard['position'],
      };
    });
  } else {
    // A 档：随机抽
    const randCards = drawUniqueCards(3);
    drawnCards = randCards.map((card, i) => ({
      card,
      orientation: randomOrientation(),
      position: ['past', 'present', 'future'][i] as DrawnCard['position'],
    }));
  }

  onCardsReady?.(drawnCards);
}

// ===== reading：seed 驱动解读 =====
export function getReadingForPhase(): ReturnType<typeof generateReading> | null {
  if (!readingSeed || drawnCards.length !== 3) return null;
  const theme = (readingSeed.domain === '感情' ? 'love' : readingSeed.domain === '事业' ? 'career' : readingSeed.domain === '财运' ? 'wealth' : readingSeed.domain === '健康' ? 'health' : 'general') as any;
  return generateReading(drawnCards, theme);
}

// ===== followup：带上下文追问 =====
export function generateFollowup(userQuestion: string): string {
  const seed = readingSeed;
  const cards = drawnCards;
  if (!seed || cards.length !== 3) return '可以再说一遍吗？';

  // 引用 specific card
  const cardNames = cards.map(c => c.card.name);
  const cardMatch = cardNames.find(n => userQuestion.includes(n));
  const domain = seed.domain;

  if (cardMatch) {
    const c = cards[cardNames.indexOf(cardMatch)];
    const posLabel = { past: '过去', present: '现在', future: '未来' }[c.position];
    return `你说到${cardMatch}这张牌。它在${posLabel}位置，核心是${c.orientation === 'upright' ? '正位' : '逆位'}的${c.card.keywordsUpright.slice(0,2).join('、')}能量。结合你说的${seed.focus.slice(0,20)}，这张牌在提醒你留意这个方向的信号。`;
  }

  // 通用 but contextual
  const refs = [`你刚说到的${seed.focus.slice(0,16)}`, `结合你提到的${domain}方面`, `回到你说的困惑`];
  return `${refs[Math.floor(Math.random() * refs.length)]}，${cardNames[1]}这张牌其实已经在回应你了——${cards[1].orientation === 'upright' ? '正位' : '逆位'}的${cards[1].card.keywordsUpright.slice(0,2).join('、')}能量，跟你当前的处境是对应的。`;
}

// ===== phase 进出通知 =====
export function enterReading(): void { setPhase('reading'); }
export function enterFollowup(): void { setPhase('followup'); }

// ===== 回退 =====
export function resetAll(): void {
  currentPhase = 'intake';
  readingSeed = null;
  history = [];
  drawnCards = [];
  currentCardsRaw = [];
  intakeRound = 0;
  accumulatedInfo = {};
}
