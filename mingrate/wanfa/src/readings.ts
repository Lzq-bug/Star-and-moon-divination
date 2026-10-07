/** 塔罗占卜大师 - AI解读生成器（模拟版） */
import type { AIReading, DrawnCard, Theme, NarrationSegment } from './types';
import { SUIT_INFO } from './types';

// ===== 能量肯定语库 =====
const ENERGY_TIPS = [
  '你比自己想象的更完整。',
  '裂缝，是光照进来的地方。',
  '你的直觉比任何牌都更准——相信它。',
  '宇宙不会给你承受不了的问题。',
  '你此刻呼吸的空气里，有无限的可能性。',
  '放下不是放弃，是选择了更重要的。',
  '放松，你不是在"等待"什么——你已经在"成为"的路上了。',
  '今天，你值得被温柔对待。',
  '你的过去不等于你的未来。',
  '你正在成为你本该成为的人。',
  '每一次呼吸，都是一个新的开始。',
  '你的心知道方向，让头脑跟上它。',
];

// ===== 寄语库（按情绪分类） =====
const BLESSINGS = {
  dark: [
    '即使夜再深，星星也从未离开。它们只是在等待云散。',
    '伤疤是光进入你身体的地方。',
    '风暴会过去，而你会比风暴更强地站着。',
    '最深的痛会变成你最深厚的力量。',
  ],
  bright: [
    '你正在闪耀，别低头，光会倾斜。',
    '宇宙在为你鼓掌。你听见了吗？',
    '愿这份能量像阳光一样，洒满你接下来的一整天。',
  ],
  neutral: [
    '记住，牌只是镜子，真正的力量在你手中。',
    '愿你带着这份指引，笃定地走向明天。',
    '你的故事正在展开，而你是唯一的作者。',
  ],
};

// ===== 总览模板 =====
const OVERVIEW_TEMPLATES: Record<Theme, string[]> = {
  career: [
    '你在职业生涯中正处在一个关键的节点。这三张牌揭示了你的工作能量场——过去的积累、当下的挑战和未来的可能性。不要只盯着眼前的困难，整体来看，趋势在告诉你什么。',
    '关于你的事业之路，牌面带来了清晰的信息。工作不仅仅是谋生，也是你实现自我价值的场域。看看这些牌在如何描述你的职业状态。',
  ],
  love: [
    '你的心在问什么，这些牌就在回应什么。感情的能量是流动而微妙的——过去造就了你爱的方式，当下映射着你心的状态，未来则在邀请你做出选择。',
    '爱情是宇宙给我们最美好的课题。这三张牌映照出你内心真正渴望的连接，以及你现在需要面对的课题。',
  ],
  wealth: [
    '财富不只是数字，更是一种能量。它流向被珍惜的地方。这三张牌揭示了你与金钱的关系模式——过去的信念如何影响现在的决定，未来的财富之路在向你招手。',
    '关于你的财务能量场，牌面给出了清晰的提示。丰盛是你与生俱来的权利，但要看到是什么在阻挡这份丰盛流向你。',
  ],
  health: [
    '身心灵的平衡是一生的功课。这三张牌不只是关于身体状况，更是在诉说你的整体能量状态——情绪、压力、生活方式都在交织影响着你。',
    '你的身体在用它的方式与你对话。牌面揭示了哪些能量在支持你的健康，哪些在消耗你。倾听它们，就是对自己最大的温柔。',
  ],
  general: [
    '这是一次全面的能量扫描。每一张牌都是一个信使，从不同的维度为你带来指引。整体的能量图景比单张牌更加重要——看看故事在如何展开。',
    '宇宙通过这三张牌向你传递一个完整的信息。没有偶然，每一张牌的出现都是为你而来的。整体来看，你会发现一个清晰的叙事弧线。',
  ],
};

// ===== 牌面解说模板（按位置） =====
function generateCardMeaning(card: DrawnCard, theme: Theme): string {
  const { card: c, orientation, position } = card;
  const posLabels = { past: '过去', present: '现在', future: '未来' };
  const pos = posLabels[position];

  const meaning = orientation === 'upright' ? c.meaningUpright : c.meaningReversed;
  const kw = orientation === 'upright' ? c.keywordsUpright : c.keywordsReversed;

  // 注入主题相关
  let themeLine = '';
  if (c.themeMappings?.[theme]) {
    themeLine = `从${theme === 'career' ? '事业' : theme === 'love' ? '感情' : theme === 'wealth' ? '财运' : theme === 'health' ? '健康' : '综合'}的角度来看，${c.themeMappings[theme]}。`;
  } else if (c.suit && SUIT_INFO[c.suit]) {
    const suitInfo = SUIT_INFO[c.suit];
    themeLine = `这张牌属于${suitInfo.icon} ${suitInfo.element}元素的${suitInfo.meaning}领域。`;
  }

  const kwStr = kw.join('、');
  return `【${pos}】${c.name}（${orientation === 'upright' ? '正位' : '逆位'}）——关键词：${kwStr}。${meaning} ${themeLine}`;
}

// ===== 联动解读生成 =====
function generateConnection(cards: DrawnCard[], theme: Theme): string {
  const names = cards.map(c => c.card.name);
  const orientations = cards.map(c => c.orientation);
  const elements = cards.map(c => c.card.element || '?');

  // 元素流
  const elementFlow = elements.filter(e => e !== '?').join('→');

  let flowLine = '';
  if (elementFlow.length > 2) {
    flowLine = `从能量元素来看，这是一条「${elementFlow}」的能量流动路径。`;
  }

  const majorCount = cards.filter(c => c.card.arcana === 'major').length;

  let arcanaLine = '';
  if (majorCount === 3) {
    arcanaLine = '三张全是大阿卡纳——你正处于人生重要的转折期，命运在强烈地介入你的故事。';
  } else if (majorCount >= 2) {
    arcanaLine = '有两张大阿卡纳，说明当前的能量深受命运力量的影响，这些变化值得你认真对待。';
  } else {
    arcanaLine = '三张都是日常生活的能量，聚焦在你当下具体的领域——改变从微小的行动开始。';
  }

  // 特殊组合
  const comboLines: string[] = [];
  const nameSet = new Set(names);
  const COMBOS: [string[], string][] = [
    [['命运之轮', '死神', '审判'], '⚡ 命运三部曲——这是一场深刻的命运转折，旧的已经死去，新的正在诞生，而你正在觉醒。'],
    [['星星', '月亮', '太阳'], '🌟 星月日全能量——灵性觉醒的高光组合！从恐惧到希望再到喜悦，你在完成一次完整的内心穿越。'],
    [['恶魔', '高塔', '审判'], '🔥 觉醒三部曲——你正在挣脱束缚，幻象被打破，然后迎来重生。过程虽痛，但值得。'],
    [['恋人', '女皇', '星星'], '💖 爱与丰盛的组合——你被爱和美的能量包围着。你的心在开放，美好正在流入。'],
    [['愚人', '魔术师', '世界'], '🌀 完整的旅程——从勇敢的开始到掌握技能再到圆满完成。你在一个完整的生命周期中。'],
    [['隐士', '倒吊人', '节制'], '🌙 内在之旅——你在经历深度的内在转化：独处寻找答案→暂停换个视角→找到平衡。'],
    [['战车', '力量', '太阳'], '☀️ 胜利组合——强大的意志+内在的力量+成功的喜悦。没有什么能阻挡你！'],
  ];

  for (const [combo, desc] of COMBOS) {
    if (combo.every(n => nameSet.has(n))) {
      comboLines.push(desc);
    }
  }

  // 叙事拼接
  const stories = [
    `这三张牌共同讲述了一个关于「${theme === 'career' ? '成长与成就' : theme === 'love' ? '爱与连接' : theme === 'wealth' ? '价值与丰盛' : theme === 'health' ? '平衡与治愈' : '自我发现'}」的故事。${flowLine}`,
    `从${names[0]}到${names[1]}再到${names[2]}——可以看出你正在经历的能量变化轨迹。${arcanaLine}`,
    `整体来看，${orientationDesc(orientations)}。过去为现在奠定了基础，现在在塑造未来，而未来在回应你此刻的选择。`,
  ];

  const special = comboLines.length > 0 ? `\n\n${comboLines[0]}` : '';

  return stories[cards.length % stories.length] + special;
}

function orientationDesc(orientations: ('upright' | 'reversed')[]): string {
  const upCount = orientations.filter(o => o === 'upright').length;
  if (upCount === 3) return '三张都是正位，能量流通顺畅——这是一个非常和谐的信号';
  if (upCount === 2) return '大部分牌正位，整体能量积极向上，但有一张逆位牌提醒你需要留意的地方';
  if (upCount === 1) return '逆位牌较多，意味着你当前可能面临较多挑战——但这些挑战正是成长的契机';
  return '全部逆位——这是一个深度翻转的信号，不要害怕，有时最大的突破来自推倒重来';
}

// ===== 建议生成 =====
function generateAdvice(cards: DrawnCard[], theme: Theme): string[] {
  const pool: string[] = [];

  // 基于占卜主题
  const themeAdvice: Record<Theme, string[]> = {
    career: ['花时间梳理你过去3个月的职业收获和瓶颈', '下周主动约一位行业前辈聊聊你的想法', '在你当前岗位上找到一件可以精进的小技能'],
    love: ['给自己一周的时间观察感受，不急于下结论', '写一封不会寄出的信，写下你所有真实的感受', '做一件你一直想和伴侣/心仪对象一起做的事'],
    wealth: ['记录接下来7天的每一笔支出，找到可以优化的地方', '了解一下你感兴趣的一个理财工具', '清理一件你不需要的物品，让能量流动起来'],
    health: ['每天花5分钟做一次深呼吸练习', '在接下来的一周增加一次30分钟的身体活动', '留意你的睡眠质量，睡前1小时远离屏幕'],
    general: ['找一本笔记本写下你最近的三个困惑', '每天给自己10分钟完全安静的时间', '联系一个你很久没联系但挂念的人'],
  };

  const ta = themeAdvice[theme];
  pool.push(ta[Math.floor(Math.random() * ta.length)]);
  pool.push(ta[(Math.floor(Math.random() * ta.length) + 1) % ta.length]);

  // 基于首张牌建议
  const firstCard = cards[0].card;
  if (firstCard.suit) {
    const suitAdvice: Record<string, string> = {
      wands: '点燃你的行动力——从最小的一步开始，不要等完美时机',
      cups: '倾听你的情感需求——给自己一个安全的空间去感受',
      swords: '清晰你的思路——把困扰写下来，你会发现答案在变得清晰',
      pentacles: '关注你的基础——花时间整理你的财务或生活环境',
    };
    pool.push(suitAdvice[firstCard.suit]);
  } else {
    pool.push('相信你的直觉——它比任何分析都更早看到了方向');
  }

  return pool.slice(0, 3);
}

// ===== 主题判断（凶/吉/中性） =====
function determineSentiment(cards: DrawnCard[]): 'dark' | 'bright' | 'neutral' {
  const darkCards = ['高塔', '死神', '恶魔', '宝剑三', '宝剑五', '宝剑九', '宝剑十', '星币五'];
  const brightCards = ['星星', '太阳', '世界', '女皇', '星币九', '星币十', '圣杯十', '权杖六'];

  let darkScore = 0, brightScore = 0;
  for (const dc of darkCards) {
    const match = cards.find(c => c.card.name === dc);
    if (match) darkScore += match.orientation === 'upright' ? 2 : 1;
  }
  for (const bc of brightCards) {
    const match = cards.find(c => c.card.name === bc);
    if (match) brightScore += match.orientation === 'upright' ? 2 : 1;
  }

  if ((darkScore - brightScore) >= 2) return 'dark';
  if ((brightScore - darkScore) >= 2) return 'bright';
  return 'neutral';
}

// ===== 特殊组合检测 =====
function detectSpecialCombo(cards: DrawnCard[]): string | undefined {
  const nameSet = new Set(cards.map(c => c.card.name));
  const COMBOS: [string[], string][] = [
    [['命运之轮', '死神', '审判'], '⚡ 命运三部曲'],
    [['星星', '月亮', '太阳'], '🌟 星月日全能量'],
    [['恶魔', '高塔', '审判'], '🔥 觉醒三部曲'],
    [['恋人', '女皇', '星星'], '💖 爱与丰盛'],
    [['愚人', '魔术师', '世界'], '🌀 完整旅程'],
  ];
  for (const [combo, label] of COMBOS) {
    if (combo.every(n => nameSet.has(n))) return label;
  }
  return undefined;
}

// ===== 主入口：生成完整解读 =====
export function generateReading(cards: DrawnCard[], theme: Theme): AIReading {
  const overviews = OVERVIEW_TEMPLATES[theme];
  const overview = overviews[Math.floor(Math.random() * overviews.length)];

  const sentiment = determineSentiment(cards);

  const reading: AIReading = {
    overview,
    cards: cards.map(c => ({
      name: c.card.name,
      position: c.position,
      orientation: c.orientation === 'upright' ? '正位' : '逆位',
      meaning: generateCardMeaning(c, theme),
    })),
    connection: generateConnection(cards, theme),
    advice: generateAdvice(cards, theme),
    blessing: BLESSINGS[sentiment][Math.floor(Math.random() * BLESSINGS[sentiment].length)],
    energyTip: ENERGY_TIPS[Math.floor(Math.random() * ENERGY_TIPS.length)],
    sentimentTag: sentiment,
    specialCombo: detectSpecialCombo(cards),
    narration: buildNarration(cards, sentiment),
  };

  return reading;
}

/** 构建 TTS 专用 narration（减法口语流，双文本解耦） */
function buildNarration(cards: DrawnCard[], sentiment: string): NarrationSegment[] {
  const dirMap: Record<string, string> = {
    bright: '温暖、笃定，带一点笑意',
    dark: '柔和、共情，声音略沉',
  };
  if (!cards.length) return [];

  return cards.map((c, i) => {
    const posNames = ['过去', '现在', '未来'];
    const pos = posNames[i];
    const ori = c.orientation === 'upright' ? '' : '逆了位';
    const name = c.card.name;
    const kw = (c.orientation === 'upright' ? c.card.keywordsUpright : c.card.keywordsReversed).slice(0, 2).join('、');

    // 每段 2-3 句，减法口语——不多于 1 个语气词，无省略号
    let s1: string, s2: string, s3: string;

    if (i === 0) {
      s1 = `先看过去这张牌，${name}${ori ? '，' + ori : ''}。`;
      s2 = `${kw}，那阵子这个能量在影响你。`;
    } else {
      const bridge = ['那现在呢，', '至于未来，'][i - 1];
      s1 = `${bridge}${name}${ori ? '，' + ori : ''}。`;
      s2 = `关键词是${kw}。`;
    }

    // 第三句根据不同情况生成
    if (sentiment === 'dark' && (['高塔', '死神', '恶魔', '宝剑'].some(x => name.includes(x)))) {
      s3 = '这张牌不一定代表坏事，更像是在提醒你面对。';
    } else if (sentiment === 'bright' && (['星星', '太阳', '女皇', '世界', '星币'].some(x => name.includes(x)))) {
      s3 = '这个能量在帮你往好的方向走。';
    } else {
      s3 = '这个位置的能量值得你留意一下。';
    }

    return {
      position: pos,
      voice_direction: dirMap[sentiment] || '平静、认真，像在替她想',
      sentences: [s1, s2, s3],
    };
  });
}

/** 模拟 SSE 流式输出 */
export function simulateStreaming(
  reading: AIReading,
  onChunk: (text: string, section: string) => void,
  onDone: () => void,
): void {
  const sections: [string, string][] = [
    ['overview', `🌌 总览\n${reading.overview}\n\n`],
    ...reading.cards.map(c => ['card', `📜 ${c.name}·${c.orientation}\n${c.meaning}\n\n`] as [string, string]),
    ['connection', `🔗 联动解读\n${reading.connection}\n\n`],
    ['advice', `💡 给你的建议\n${reading.advice.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n\n`],
    ['blessing', `💝 ${reading.blessing}\n\n`],
    ['energy', `✨ 能量肯定语：${reading.energyTip}`],
  ];

  let i = 0;
  let charIdx = 0;
  let delay = 30; // ms per character

  function streamNext() {
    if (i >= sections.length) { onDone(); return; }
    const [section, text] = sections[i];

    if (charIdx < text.length) {
      const chunkSize = Math.min(3, text.length - charIdx);
      const chunk = text.slice(charIdx, charIdx + chunkSize);
      charIdx += chunkSize;
      onChunk(chunk, section);
      setTimeout(streamNext, delay);
    } else {
      i++;
      charIdx = 0;
      // 段间间隔稍长
      if (i < sections.length) {
        delay = 25;
        setTimeout(streamNext, 300);
      } else {
        onDone();
      }
    }
  }

  streamNext();
}
