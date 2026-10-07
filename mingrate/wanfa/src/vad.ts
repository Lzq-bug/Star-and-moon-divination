/**
 * vad.ts — 语音活动检测（Voice Activity Detection）
 *
 * 基于 sound.ts 的 AnalyserNode RMS，驱动连续对话状态机。
 * 复用 sound.ts 信号，不新增采集。
 *
 * 门控防自激：speaking 态屏蔽 VAD，TTS onended 后 gateMs 静默窗。
 * Barge-in：speaking 时 speech start → 停 TTS + 回 listening。
 */
import { sound } from './sound';

export const VAD_CONFIG = {
  startFrames: 9,       // 连续多少帧 RMS>threshold 判 speech start
  silenceMs: 700,       // 连续低于 threshold 多少 ms 判 speech end
  threshold: 0.04,      // RMS 阈值
  minSpeechMs: 250,     // 最短语音时长（防误触）
  gateMs: 250,          // speaking 结束后不检测时长
};

type VadState = 'idle' | 'speech' | 'waiting';

let vadState: VadState = 'idle';
let active = false;

/* 帧计数器 */
let aboveCount = 0;
let belowStart = 0;
let speechStartTime = 0;
let lastAboveTime = 0;

/* 门控 */
let speakingGateUntil = 0;          // 改动③标注：speaking 防护闸
let isSpeaking = false;

/* 回调 */
let onSpeechStart: (() => void) | null = null;
let onSpeechEnd: ((durationMs: number) => void) | null = null;
let onBargeIn: (() => void) | null = null;

export function setVadCallbacks(cbs: {
  onSpeechStart?: () => void;
  onSpeechEnd?: (durationMs: number) => void;
  onBargeIn?: () => void;
}): void {
  if (cbs.onSpeechStart) onSpeechStart = cbs.onSpeechStart;
  if (cbs.onSpeechEnd) onSpeechEnd = cbs.onSpeechEnd;
  if (cbs.onBargeIn) onBargeIn = cbs.onBargeIn;
}

/** 通知 VAD：TTS 正在播放（门控开关） */
export function setSpeaking(on: boolean): void {
  isSpeaking = on;
  if (on) {
    speakingGateUntil = performance.now() + VAD_CONFIG.gateMs;  // ← 门控行：speaking 期间 + gate 不检测
  }
  if (!on) {
    speakingGateUntil = performance.now() + VAD_CONFIG.gateMs;  // onended 后 gateMs 静默窗
  }
}

/** 重置 VAD 状态 */
export function resetVad(): void {
  vadState = 'idle';
  aboveCount = 0;
  belowStart = 0;
  speechStartTime = 0;
  lastAboveTime = 0;
  speakingGateUntil = 0;
  isSpeaking = false;
  active = false;
}

/** 启动 VAD 循环 */
export function startVad(): void {
  if (active) return;
  active = true;
  loop();
}

/** 停止 VAD 循环 */
export function stopVad(): void {
  active = false;
}

function loop(): void {
  if (!active) return;
  const now = performance.now();

  // 门控：speaking 期间不检测（门控行）
  if (isSpeaking || now < speakingGateUntil) {
    requestAnimationFrame(loop);
    return;
  }

  const rms = sound.getMicLevel();
  const above = rms > VAD_CONFIG.threshold;

  if (above) {
    lastAboveTime = now;
    aboveCount++;
    // Barge-in：speaking 时检测到 speech start → 打断
    if (isSpeaking && aboveCount >= VAD_CONFIG.startFrames) {
      onBargeIn?.();
      aboveCount = 0;
      requestAnimationFrame(loop);
      return;
    }
  }

  switch (vadState) {
    case 'idle':
      if (above && aboveCount >= VAD_CONFIG.startFrames) {
        vadState = 'speech';
        speechStartTime = now;
        onSpeechStart?.();
      }
      break;

    case 'speech':
      if (!above) {
        if (belowStart === 0) belowStart = now;
        const silenceDur = now - belowStart;
        if (silenceDur >= VAD_CONFIG.silenceMs) {
          const dur = speechStartTime > 0 ? lastAboveTime - speechStartTime : 0;
          if (dur >= VAD_CONFIG.minSpeechMs) {
            onSpeechEnd?.(dur);
          }
          vadState = 'idle';
          aboveCount = 0;
          belowStart = 0;
        }
      } else {
        belowStart = 0; // 重新说话，重置静音计时
      }
      break;

    case 'waiting':
      break;
  }

  requestAnimationFrame(loop);
}
