// 莱德-韦特塔罗 78 张牌:22 大阿卡纳 + 56 小阿卡纳(四花色各 14 张)
export interface TarotCard {
  id: string;
  name: string;
  nameCn: string;
  arcana: "major" | "minor";
  suit?: "wands" | "cups" | "swords" | "pentacles";
  uprightCn: string;
  reversedCn: string;
}

const major: TarotCard[] = [
  { id: "m0", name: "The Fool", nameCn: "愚者", arcana: "major", uprightCn: "新的开始、自由、纯真、冒险", reversedCn: "鲁莽、逃避、盲目、犹豫不决" },
  { id: "m1", name: "The Magician", nameCn: "魔术师", arcana: "major", uprightCn: "创造力、意志、行动、资源整合", reversedCn: "操纵、才能未展、拖延、欺骗" },
  { id: "m2", name: "The High Priestess", nameCn: "女祭司", arcana: "major", uprightCn: "直觉、潜意识、神秘、内在智慧", reversedCn: "秘密被隐藏、忽视直觉、表里不一" },
  { id: "m3", name: "The Empress", nameCn: "皇后", arcana: "major", uprightCn: "丰饶、母性、滋养、感官愉悦", reversedCn: "依赖、创造力受阻、过度保护" },
  { id: "m4", name: "The Emperor", nameCn: "皇帝", arcana: "major", uprightCn: "权威、结构、稳定、掌控", reversedCn: "专制、僵化、失去控制、固执" },
  { id: "m5", name: "The Hierophant", nameCn: "教皇", arcana: "major", uprightCn: "传统、信仰、指引、体制", reversedCn: "叛逆、教条束缚、打破常规" },
  { id: "m6", name: "The Lovers", nameCn: "恋人", arcana: "major", uprightCn: "爱、结合、选择、价值一致", reversedCn: "失衡、错误选择、关系裂痕" },
  { id: "m7", name: "The Chariot", nameCn: "战车", arcana: "major", uprightCn: "意志胜利、前进、掌控方向", reversedCn: "失控、方向迷失、内在冲突" },
  { id: "m8", name: "Strength", nameCn: "力量", arcana: "major", uprightCn: "内在勇气、温柔的力量、耐心", reversedCn: "自我怀疑、失去信心、被情绪支配" },
  { id: "m9", name: "The Hermit", nameCn: "隐士", arcana: "major", uprightCn: "内省、独处、寻求真理、指引", reversedCn: "孤立、逃避、迷失、拒绝帮助" },
  { id: "m10", name: "Wheel of Fortune", nameCn: "命运之轮", arcana: "major", uprightCn: "转机、循环、机遇、命运转折", reversedCn: "厄运、失控循环、抗拒改变" },
  { id: "m11", name: "Justice", nameCn: "正义", arcana: "major", uprightCn: "公正、因果、真相、责任", reversedCn: "不公、逃避责任、偏见" },
  { id: "m12", name: "The Hanged Man", nameCn: "倒吊人", arcana: "major", uprightCn: "臣服、换位思考、暂停、牺牲", reversedCn: "拖延、无谓牺牲、固执抵抗" },
  { id: "m13", name: "Death", nameCn: "死神", arcana: "major", uprightCn: "结束与新生、转化、放下", reversedCn: "抗拒改变、停滞、无法放手" },
  { id: "m14", name: "Temperance", nameCn: "节制", arcana: "major", uprightCn: "平衡、调和、耐心、中庸", reversedCn: "失衡、极端、缺乏耐心" },
  { id: "m15", name: "The Devil", nameCn: "恶魔", arcana: "major", uprightCn: "欲望、束缚、执念、诱惑", reversedCn: "挣脱枷锁、觉醒、重获自由" },
  { id: "m16", name: "The Tower", nameCn: "高塔", arcana: "major", uprightCn: "剧变、崩塌、觉醒、突发真相", reversedCn: "避免灾难、缓慢瓦解、恐惧改变" },
  { id: "m17", name: "The Star", nameCn: "星星", arcana: "major", uprightCn: "希望、疗愈、灵感、信念", reversedCn: "失望、信心缺失、灵感枯竭" },
  { id: "m18", name: "The Moon", nameCn: "月亮", arcana: "major", uprightCn: "潜意识、幻象、不安、直觉", reversedCn: "释放恐惧、真相浮现、走出迷惑" },
  { id: "m19", name: "The Sun", nameCn: "太阳", arcana: "major", uprightCn: "喜悦、成功、活力、光明", reversedCn: "暂时受挫、过度乐观、延迟的快乐" },
  { id: "m20", name: "Judgement", nameCn: "审判", arcana: "major", uprightCn: "觉醒、重生、召唤、自我评估", reversedCn: "自我怀疑、逃避、错失召唤" },
  { id: "m21", name: "The World", nameCn: "世界", arcana: "major", uprightCn: "圆满、完成、整合、成就", reversedCn: "未完成、停滞、缺乏收尾" },
];

const suitMeta: Record<string, { cn: string; theme: string }> = {
  wands: { cn: "权杖", theme: "行动、激情、创造与事业" },
  cups: { cn: "圣杯", theme: "情感、关系、直觉与心灵" },
  swords: { cn: "宝剑", theme: "思想、冲突、沟通与真相" },
  pentacles: { cn: "星币", theme: "物质、金钱、工作与现实" },
};

const rankNames = ["王牌(Ace)", "二", "三", "四", "五", "六", "七", "八", "九", "十", "侍从(Page)", "骑士(Knight)", "王后(Queen)", "国王(King)"];

// 每花色 14 张的正逆位关键词(按数字/宫廷牌通用义 + 花色主题微调)
const minorUpright: Record<string, string[]> = {
  wands: ["灵感萌芽、新机遇", "规划、抉择、展望", "扩展、远见、初步成果", "庆祝、稳定、归属", "竞争、冲突、活力", "胜利、认可、凯旋", "坚守、防御、挑战", "迅速行动、进展", "韧性、警觉、坚持", "重担、责任、超负荷", "热情探索、好奇", "冒险、行动派、热忱", "自信、魅力、决断", "领导、远见、格局"],
  cups: ["情感涌现、新恋情", "结合、伙伴、和谐", "友谊、庆祝、社群", "冷漠、厌倦、错失", "失落、遗憾、悲伤", "怀旧、纯真、善意", "幻想、选择、白日梦", "离开、寻找更深意义", "满足、愿望成真", "圆满、家庭幸福", "情感讯息、创意", "浪漫、追寻、理想主义", "情感成熟、共情", "情感掌控、慈悲" ],
  swords: ["清晰、突破、真相", "僵局、抉择、回避", "心碎、痛苦、背叛", "休息、恢复、退避", "冲突、失败、羞辱", "过渡、离开、疗愈之旅", "策略、欺瞒、独行", "受限、焦虑、自我设限", "焦虑、噩梦、忧思", "结束、背叛、谷底", "好奇、警觉、直言", "果断、雄心、直接", "理性、独立、坦率", "权威、真理、严明" ],
  pentacles: ["新机遇、显化、繁荣种子", "平衡、取舍、灵活", "协作、技艺、认可", "掌控、储蓄、保守", "困顿、匮乏、忧虑", "给予与接受、慷慨", "耐心、评估、投资", "勤勉、精进、专注", "自足、丰盛、独立", "财富、传承、稳固", "务实学习、专注", "可靠、勤恳、坚持", "务实、丰饶、安全感", "富足、事业成功、稳健" ],
};
const minorReversed: Record<string, string[]> = {
  wands: ["延迟、缺乏方向", "犹豫、恐惧未知", "受挫、计划受阻", "不稳、家庭紧张", "内耗、无谓争斗", "自负、失去支持", "退缩、被压垮", "受阻、混乱、延误", "疲惫、固执防御", "卸下重担或被压垮", "分心、坏消息", "冲动、鲁莽、拖延", "专横、嫉妒、急躁", "独断、冷酷、专制" ],
  cups: ["情感封闭、单恋", "关系失衡、分离", "过度放纵、孤立", "错失机会觉醒、接纳", "接受与放下、复原", "困于过去、天真受骗", "沉迷幻想、看清现实", "犹豫是否离开、逃避", "贪婪、不满足", "破裂、家庭失和", "情绪不成熟、封闭", "情绪化、不切实际", "情感依赖、失衡", "情感操控、冷漠" ],
  swords: ["混乱、误解、迷雾", "直面现实、被迫抉择", "复原、宽恕、释怀", "倦怠、无法休息", "和解、放下争斗", "停滞、抗拒离开", "坦白、良心发现", "解脱、突破限制", "走出焦虑、面对恐惧", "复苏、走出低谷", "冷嘲、恶意、多言", "鲁莽、专横、失控", "冷酷、苛刻、封闭", "滥权、专断、冷血" ],
  pentacles: ["投机失败、错失良机", "失衡、力不从心", "不合、返工、质量差", "过度执着、贪婪或松手", "复苏、走出困境", "债务、有条件的给予", "急躁、投资失利", "完美主义、单调乏味", "过度追求物质、空虚", "财务不稳、家族纷争", "分心、缺乏进展", "懒散、停滞、无聊", "物质焦虑、缺乏安全感", "贪婪、固执、赌徒心态" ],
};

const minor: TarotCard[] = [];
for (const suit of ["wands", "cups", "swords", "pentacles"] as const) {
  for (let i = 0; i < 14; i++) {
    minor.push({
      id: `${suit}${i + 1}`,
      name: `${rankNames[i].replace(/\(.*\)/, "").trim()} of ${suit}`,
      nameCn: `${suitMeta[suit].cn}${rankNames[i]}`,
      arcana: "minor",
      suit,
      uprightCn: minorUpright[suit][i],
      reversedCn: minorReversed[suit][i],
    });
  }
}

export const DECK: TarotCard[] = [...major, ...minor];

export interface DrawnCard {
  card: TarotCard;
  reversed: boolean;
}

// 无重复随机抽 count 张,每张随机正逆位
export function drawCards(count: number): DrawnCard[] {
  const pool = [...DECK];
  const result: DrawnCard[] = [];
  const n = Math.max(1, Math.min(count, pool.length));
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const [card] = pool.splice(idx, 1);
    result.push({ card, reversed: Math.random() < 0.5 });
  }
  return result;
}
