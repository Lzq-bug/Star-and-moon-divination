/** 塔罗占卜大师 - 类型定义 */

export type Phase = 'intake' | 'drawing' | 'reading' | 'followup';
export type Theme = 'career' | 'love' | 'wealth' | 'health' | 'general';
export type Orientation = 'upright' | 'reversed';
export type Position = 'past' | 'present' | 'future';
export type GameState =
  | 'LANDING'
  | 'THEME_SELECT'
  | 'CUTTING'
  | 'SPINNING'
  | 'VRF_WAIT'
  | 'REVEALING'
  | 'READING'
  | 'COMPLETE';

export const THEME_LABELS: Record<Theme, { icon: string; label: string; color: string }> = {
  career: { icon: '💼', label: '事业', color: '#6C3CF8' },
  love: { icon: '❤️', label: '爱情', color: '#E94560' },
  wealth: { icon: '💰', label: '财运', color: '#F6C90E' },
  health: { icon: '🏥', label: '健康', color: '#4ECDC4' },
  general: { icon: '🌈', label: '综合', color: '#C681F1' },
};

export interface TarotCard {
  id: string;
  name: string;
  nameEn: string;
  arcana: 'major' | 'minor';
  suit?: 'wands' | 'cups' | 'swords' | 'pentacles';
  number?: number;
  court?: string;
  element?: string;
  keywordsUpright: string[];
  keywordsReversed: string[];
  meaningUpright: string;
  meaningReversed: string;
  symbolism?: Record<string, string>;
  themeMappings?: Partial<Record<Theme, string>>;
}

export interface DrawnCard {
  card: TarotCard;
  orientation: Orientation;
  position: Position;
}

export interface AIReading {
  overview: string;
  cards: Array<{ name: string; position: string; meaning: string; orientation: string }>;
  connection: string;
  advice: string[];
  blessing: string;
  energyTip: string;
  specialCombo?: string;
  sentimentTag?: 'dark' | 'bright' | 'neutral';
  narration?: NarrationSegment[];  // TTS 专用：口语化解说流，跟 display 完全解耦
}

export interface NarrationSegment {
  position: string;          // "过去"/"现在"/"未来"
  voice_direction: string;   // 情绪描述，无节奏词
  sentences: string[];       // 已按句切好的口语文本，无标记符号
}

export interface ReadingSeed {
  focus: string;           // 用户核心困惑（1-2句）
  emotion: string;         // 情绪基调：anxious/sad/confused/hopeful/neutral
  domain: string;          // 领域：感情/事业/自我成长/等
  keywords: string[];      // 3-5 个关键词
  energy_tags: string[];   // 2-3 个能量标签
  chosen_cards?: Array<{ name: string; orientation: 'upright' | 'reversed'; why: string }>;
}

export interface IntakeTurn {
  user: string;
  assistant: { say: string; ready_to_read: boolean; seed: ReadingSeed | null };
}

export const SUIT_INFO: Record<string, { element: string; icon: string; meaning: string }> = {
  wands: { element: '火', icon: '🔥', meaning: '行动、激情、创造力' },
  cups: { element: '水', icon: '💧', meaning: '情感、直觉、关系' },
  swords: { element: '风', icon: '🌪️', meaning: '思维、挑战、真相' },
  pentacles: { element: '土', icon: '🪨', meaning: '物质、事业、财富' },
};

export const POSITION_LABELS: Record<Position, { label: string; desc: string; color: string }> = {
  past: { label: '过去', desc: '影响现状的过往因素', color: '#F6C90E' },
  present: { label: '现在', desc: '当下的能量与处境', color: '#C681F1' },
  future: { label: '未来', desc: '趋势与可能性指引', color: '#4ECDC4' },
};
