/**
 * aliyun-tts.ts — 阿里云百炼 TTS 朗读模块
 *
 * 通过本地代理 (localhost:3000/api/tts) 调用阿里云百炼 CosyVoice「龙嫱」音色，
 * 回退到浏览器 SpeechSynthesis。
 *
 * 用法：
 *   import { speakOracleAliyun } from './aliyun-tts';
 *   speakOracleAliyun('你好，星辰在倾听……', () => console.log('完毕'));
 */

const TTS_PROXY_URL = '/api/tts';

/** 当前正在播放的阿里云音频 */
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

/** 有序播放队列：按请求序号排队，保证句子顺序 */
interface PendingItem { blob: Blob; resolve: (ok: boolean) => void; gen: number }
let pendingMap = new Map<number, PendingItem>();
let nextSeq = 0;      // 下一个 chunk 的序号
let playSeq = 0;      // 下一个要播的序号
let ttsGen = 0;       // generation，打断后递增，跳过旧请求残留
let isPlaying = false;
let playAborted = false; // 打断标志，tryPlayNext / speakBrowser 入口守卫

function stopCurrentAudio(): void {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.onended = null; currentAudio.onerror = null; } catch { /* ignore */ }
    currentAudio = null;
  }
  if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; }
}

/** 尝试播放下一个期望序号的音频 */
function tryPlayNext(): void {
  if (isPlaying || playAborted) return;
  const item = pendingMap.get(playSeq);
  if (!item) return; // 还没取回来，等
  if (item.gen !== ttsGen) {
    // 来自旧 generation（打断前的残留），跳过
    pendingMap.delete(playSeq);
    playSeq++;
    item.resolve(false);
    tryPlayNext();
    return;
  }
  pendingMap.delete(playSeq);
  playSeq++;
  isPlaying = true;
  const url = URL.createObjectURL(item.blob);
  currentAudioUrl = url;
  const audio = new Audio(url);
  currentAudio = audio;
  const next = () => { stopCurrentAudio(); isPlaying = false; item.resolve(true); tryPlayNext(); };
  const err = () => { stopCurrentAudio(); isPlaying = false; item.resolve(false); tryPlayNext(); };
  audio.onended = next;
  audio.onerror = err;
  audio.play().catch(err);
}

/** 检查 TTS 代理是否可用 */
let proxyChecked = false;
let proxyAvailable = true;

async function checkProxy(): Promise<boolean> {
  if (proxyChecked) return proxyAvailable;
  proxyChecked = true;
  try {
    const resp = await fetch(`${TTS_PROXY_URL.replace('/api/tts', '/health')}`, {
      signal: AbortSignal.timeout(3000),
    });
    proxyAvailable = resp.ok;
  } catch {
    proxyAvailable = false;
  }
  return proxyAvailable;
}

/** 通过代理获取阿里云 TTS 音频 Blob */
async function fetchAliyunAudio(text: string): Promise<Blob | null> {
  try {
    const resp = await fetch(TTS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speech_rate: 1.0, pitch: 0.95 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('audio') || ct.includes('octet-stream')) return resp.blob();
    return null;
  } catch {
    return null;
  }
}

/** 使用阿里云 TTS 朗读，成功返回 true */
async function speakAliyun(text: string): Promise<boolean> {
  const seq = nextSeq++;
  const myGen = ttsGen;
  const blob = await fetchAliyunAudio(text);
  if (!blob) return false;
  // 如果 fetch 回来后已被打断，丢弃（防止旧 blob 入 pendingMap 永不释放）
  if (myGen !== ttsGen || playAborted) return false;
  return new Promise<boolean>((resolve) => {
    pendingMap.set(seq, { blob, resolve, gen: myGen });
    if (seq === playSeq) tryPlayNext(); // 正好是下一个要播的
  });
}

/** 浏览器 TTS 回退（打断后 playAborted 时静默，防止 Chrome cancel() 后 onend 仍触发） */
function speakBrowser(text: string, onEnd: () => void): void {
  const synth = window.speechSynthesis;
  if (!synth || !text || playAborted) { onEnd(); return; }
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 0.96;
  utter.pitch = 1.04;
  let settled = false;
  const finish = () => {
    if (settled || playAborted) return;
    settled = true;
    onEnd();
  };
  utter.onend = finish;
  utter.onerror = finish;
  synth.speak(utter);
}

/**
 * 统一 TTS 入口：阿里云百炼 CosyVoice「龙嫱」，不降级到浏览器语音
 */
export async function speakOracleAliyun(text: string, onEnd?: () => void): Promise<void> {
  const callback = onEnd ?? (() => {});
  if (!text) { callback(); return; }
  // 新一轮朗读，解除打断封锁
  playAborted = false;

  // 检查代理（仅首次）
  const ok = await checkProxy();
  if (ok) {
    const success = await speakAliyun(text);
    if (success) { callback(); return; }
  }

  // 不降级到浏览器语音，直接静默结束
  callback();
}

/** 停止当前所有 TTS 播放（阿里云音频 + 浏览器回退） */
export function stopAliyunTTS(): void {
  playAborted = true;  // 最先置位，封锁所有播放入口
  stopCurrentAudio();
  pendingMap.forEach((item) => item.resolve(false));
  pendingMap.clear();
  ttsGen++;            // 递增 generation，跳过旧请求残留
  nextSeq = 0;
  playSeq = 0;
  isPlaying = false;
  window.speechSynthesis?.cancel();
  // Chrome bug 兜底：cancel() 后立即再 cancel() 一次
  window.speechSynthesis?.cancel();
}
