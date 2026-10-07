/** stage 表现层类型（从 wanfa 精简，仅保留 TTS 播报所需） */

export interface NarrationSegment {
  position: string;          // "过去"/"现在"/"未来"
  voice_direction: string;   // 情绪描述，无节奏词
  sentences: string[];       // 已按句切好的口语文本，无标记符号
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
