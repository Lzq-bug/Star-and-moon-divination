// src/asr.ts — 语音识别(智谱 GLM-ASR / 兼容阿里云 Paraformer)
//
// 浏览器录音(WAV PCM)→ 本地 /api/asr 代理 → 智谱 GLM-ASR(回退阿里云百炼 Paraformer)→ 转写文本。
// 识别使用「配置 API Key」菜单里保存的 Key(与占卜对话同一份配置);
// 菜单未填时代理回退 .env.local 的 ZHIPU_KEY。识别模型固定为智谱语音模型
// glm-asr-2512(菜单里的模型是聊天模型,不能做语音识别)。
// 同时通过 onLevel 回调驱动光环语音电平,统一占用唯一的麦克风流,避免与识别互相争抢。
//
// 为什么不用 Web Speech API(webkitSpeechRecognition)?
// 它在 Chrome 里把音频发到 Google 语音服务,国内网络不可达,表现为「识别不上去 / 用不了」。
// 为什么录 WAV 而不是 webm/opus?
// MediaRecorder 出的 webm/opus 部分云端识别接口不收;WAV(16k 单声道 PCM)是各家识别接口的
// 通用格式,在浏览器内直接编码即可,无需额外依赖。
import { DEFAULT_API_KEY } from './agent/setup';

export type AsrMode = 'tap' | 'hold' | 'continuous';

export interface AsrResult {
  text: string;
  /** 失败原因(权限被拒 / 无声音 / 代理未运行 / 网络错误等) */
  error?: string;
}

export interface AsrOptions {
  mode: AsrMode;
  /** 连续静音多少毫秒后自动停止并转写(0 = 不检测静音,由外部手动停止) */
  silenceMs?: number;
  /** 最长录音时长(ms),超时自动停止(0 = 不限时) */
  maxMs?: number;
  /** 语音电平 0..1,用于光环可视化 */
  onLevel?: (level: number) => void;
  /** 录音结束并转写完成后的回调(成功给 text,失败给 error) */
  onEnd: (result: AsrResult) => void;
}

let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let pcmChunks: Float32Array[] = [];
let recordSampleRate = 16000;
let rafId = 0;
let maxTimer: number | undefined;
let active = false;
let sawSpeech = false;
let silenceAccum = 0;
let displayedLevel = 0;
let opts: AsrOptions | null = null;

export function isAsrActive(): boolean {
  return active;
}

function cleanup() {
  window.cancelAnimationFrame(rafId);
  if (maxTimer !== undefined) {
    window.clearTimeout(maxTimer);
    maxTimer = undefined;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  void audioCtx?.close().catch(() => {});
  audioCtx = null;
  analyser = null;
  pcmChunks = [];
  active = false;
  sawSpeech = false;
  silenceAccum = 0;
  displayedLevel = 0;
  opts = null;
}

/** 把 PCM 采样块编码成 16bit 单声道 WAV */
function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  let samples = 0;
  for (const c of chunks) samples += c.length;
  const buf = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // 线性 PCM
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeStr(36, 'data');
  view.setUint32(40, samples * 2, true);
  let off = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, c[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** 识别专用 Key:「配置 API Key」里的语音识别 Key 优先,留空回退主 Key,再回退 .env.local 默认值 */
function getConfiguredKey(): string {
  return (
    (localStorage.getItem('tarot.asrApiKey') ?? '').trim() ||
    (localStorage.getItem('tarot.apiKey') ?? '').trim() ||
    DEFAULT_API_KEY
  );
}

/** 识别模型:配置弹窗里的「语音识别模型」优先,留空用默认 glm-asr-2512 */
function getConfiguredAsrModel(): string {
  return (localStorage.getItem('tarot.asrModel') ?? '').trim() || 'glm-asr-2512';
}

async function transcribe() {
  // 先取出回调和音频,再 cleanup 释放麦克风,避免网络请求期间一直占着麦。
  const cb = opts?.onEnd;
  const wav = encodeWav(pcmChunks, recordSampleRate);
  cleanup();
  if (!wav.size) {
    cb?.({ text: '', error: 'no-audio' });
    return;
  }
  try {
    const key = getConfiguredKey();
    const resp = await fetch('/api/asr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Asr-Model': getConfiguredAsrModel(),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: wav,
    });
    if (!resp.ok) {
      let msg = `识别服务异常(${resp.status})`;
      try {
        const j = await resp.json();
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      cb?.({ text: '', error: msg });
      return;
    }
    const j = await resp.json();
    const text = String(j?.text ?? '').trim();
    cb?.(text ? { text } : { text: '', error: 'no-text' });
  } catch {
    cb?.({ text: '', error: '语音识别代理未运行，请先启动本地代理(node tts-proxy.cjs)' });
  }
}

/** 开始录音:打开麦克风、驱动电平、采集 PCM,并按静音/超时自动停止转写。 */
export async function beginAsr(o: AsrOptions): Promise<void> {
  if (active) return;
  opts = o;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // 被动监听用原始信号,不做通话级处理,避免与识别采集冲突。
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    o.onEnd({ text: '', error: 'not-allowed' });
    return;
  }

  // 16kHz 单声道:识别接口的通用采样率,主流浏览器支持创建时指定并自动重采样。
  try {
    audioCtx = new AudioContext({ sampleRate: 16000 });
  } catch {
    audioCtx = new AudioContext();
  }
  recordSampleRate = audioCtx.sampleRate;
  try {
    await audioCtx.resume();
  } catch {
    /* ignore */
  }
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.78;
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  // PCM 采集:ScriptProcessor 的输出接一个零增益节点到扬声器,既保证回调持续触发又不外放。
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  pcmChunks = [];
  processor.onaudioprocess = (ev) => {
    if (!active) return;
    pcmChunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  const silent = audioCtx.createGain();
  silent.gain.value = 0;
  processor.connect(silent);
  silent.connect(audioCtx.destination);

  active = true;
  const samples = new Uint8Array(analyser.frequencyBinCount);

  const loop = () => {
    if (!active || !analyser) return;
    analyser.getByteFrequencyData(samples);
    let energy = 0;
    for (const s of samples) energy += s * s;
    const rms = Math.sqrt(energy / samples.length) / 255;
    const raw = Math.min(1, Math.max(0, (rms - 0.025) * 4.8));
    // 电平平滑:上升快、下降慢,光环更柔和
    displayedLevel += (raw - displayedLevel) * (raw > displayedLevel ? 0.34 : 0.12);
    o.onLevel?.(displayedLevel);

    if (o.silenceMs && o.silenceMs > 0) {
      if (raw > 0.08) {
        // 检测到语音后才开始累计静音,避免「还没开口就先超时」。
        sawSpeech = true;
        silenceAccum = 0;
      } else if (sawSpeech) {
        silenceAccum += 17; // 约每帧 17ms
        if (silenceAccum >= o.silenceMs) {
          finishAsr();
          return;
        }
      }
    }
    rafId = window.requestAnimationFrame(loop);
  };
  rafId = window.requestAnimationFrame(loop);

  if (o.maxMs && o.maxMs > 0) {
    maxTimer = window.setTimeout(() => finishAsr(), o.maxMs);
  }
}

/** 停止录音并转写(结果经 onEnd 回调返回) */
export function finishAsr(): void {
  if (!active) return;
  if (maxTimer !== undefined) {
    window.clearTimeout(maxTimer);
    maxTimer = undefined;
  }
  active = false; // 先停止 PCM 采集,再转写已录内容
  void transcribe();
}

/** 取消录音(不转写),立即释放麦克风 */
export function cancelAsr(): void {
  if (!active) return;
  cleanup();
}
