/** 塔罗占卜大师 - 语音陪伴层 (Voice Manager)
 *  半双工架构：按钮起停，一轮一轮对话。
 *  TTS: 本地代理 (localhost:3000/api/tts) → 阿里云百炼 CosyVoice「龙嫱」
 *        回退: 浏览器 SpeechSynthesis
 *  ASR: Web Speech API (SpeechRecognition)
 */

import type { AIReading } from './types';
import { sound } from './sound';

type VoiceBtnState = 'hidden' | 'idle' | 'available' | 'listening' | 'speaking';
type GameState = string;

// ===== TTS 代理配置（本地 serve.cjs 提供） =====
const TTS_PROXY_URL = 'http://localhost:3000/api/tts';

// ===== 备用阿里云直连配置（用于 serve.cjs 内部，前端不直接使用） =====
// 注意：前端不承载 API Key，全部走本地代理

export class VoiceManager {
  private btn: HTMLElement | null = null;
  private btnState: VoiceBtnState = 'hidden';
  private tooltip: HTMLElement | null = null;
  private waveEl: HTMLElement | null = null;

  private recognition: any = null;          // SpeechRecognition
  private synthesis: SpeechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isSpeakingBrowser = false;
  private isListening = false;

  private currentGameState: GameState = 'LANDING';
  private readingText: string = '';
  private onUserSpeech: ((text: string) => void) | null = null;
  private voicesLoaded = false;
  private aliyunAvailable = true;            // 阿里云 TTS 可用标记
  private currentAudio: HTMLAudioElement | null = null;  // 当前阿里云 TTS 播放器

  // ===== 队列播放支持 =====
  private speakQueue: Array<{ text: string; dir?: string; rate: number }> = [];
  private isQueuePlaying = false;

  constructor() {
    this.synthesis = window.speechSynthesis;
    this.initRecognition();
    if (this.synthesis) {
      this.synthesis.addEventListener('voiceschanged', () => { this.voicesLoaded = true; });
      this.synthesis.getVoices();
    }
  }

  /** =================== ASR =================== */
  private initRecognition(): void {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { console.warn('[Voice] 浏览器不支持 SpeechRecognition'); return; }
    this.recognition = new SR();
    this.recognition.lang = 'zh-CN';
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
  }

  /** =================== 按钮 UI =================== */
  createButton(parent: HTMLElement): void {
    if (this.btn) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'voice-btn-wrapper';
    wrapper.innerHTML = `
      <div class="voice-tooltip" id="voiceTooltip">🎙️ 按住说话</div>
      <div class="voice-wave" id="voiceWave"></div>
      <button class="voice-btn" id="voiceBtn" aria-label="语音">
        <span class="voice-btn-icon">🎤</span>
      </button>
    `;
    parent.appendChild(wrapper);
    this.btn = wrapper.querySelector('.voice-btn')!;
    this.tooltip = wrapper.querySelector('#voiceTooltip')!;
    this.waveEl = wrapper.querySelector('#voiceWave')!;
    this.btn.addEventListener('mousedown', (e) => { e.preventDefault(); this.handlePress(); });
    this.btn.addEventListener('mouseup', () => this.handleRelease());
    this.btn.addEventListener('mouseleave', () => { if (this.isListening) this.handleRelease(); });
    this.btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.handlePress(); }, { passive: false });
    this.btn.addEventListener('touchend', () => this.handleRelease());
    this.setState('hidden');
  }

  setState(state: VoiceBtnState): void {
    this.btnState = state;
    if (!this.btn) return;
    this.btn.className = 'voice-btn';
    if (this.waveEl) this.waveEl.className = 'voice-wave';
    if (this.tooltip) this.tooltip.className = 'voice-tooltip';
    switch (state) {
      case 'hidden':
        this.btn.classList.add('voice-hidden'); break;
      case 'idle':
        this.btn.classList.add('voice-idle');
        if (this.tooltip) this.tooltip.textContent = '🎤 语音'; break;
      case 'available':
        this.btn.classList.add('voice-available');
        if (this.tooltip) {
          this.tooltip.textContent = this.currentGameState === 'COMPLETE' ? '🎙️ 想问什么就说吧' : '🎙️ 按住说话';
          this.tooltip.classList.add('visible');
        } break;
      case 'listening':
        this.btn.classList.add('voice-listening');
        if (this.waveEl) this.waveEl.classList.add('active');
        if (this.tooltip) { this.tooltip.textContent = '🎤 听着呢……'; this.tooltip.classList.add('visible'); } break;
      case 'speaking':
        this.btn.classList.add('voice-speaking');
        if (this.waveEl) this.waveEl.classList.add('speaking');
        if (this.tooltip) { this.tooltip.textContent = '🔊 朗读中'; this.tooltip.classList.add('visible'); } break;
    }
  }

  /** =================== 阿里云百炼 TTS =================== */

  /** 尝试从本地代理获取阿里云 TTS 音频 */
  private async tryAliyunProxy(text: string, voiceDir?: string, rate?: number): Promise<Blob | null> {
    try {
      const body: any = { text };
      if (voiceDir) body.voice_direction = voiceDir;
      if (rate) { body.speech_rate = rate; body.pitch = 0.95; }
      const resp = await fetch(TTS_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) return null;
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('audio') || ct.includes('octet-stream')) return resp.blob();
      return null;
    } catch (_) { return null; }
  }

  /** 用阿里云 TTS 朗读 */
  private async speakWithAliyun(text: string, voiceDir?: string, rate?: number): Promise<boolean> {
    const blob = await this.tryAliyunProxy(text, voiceDir, rate);
    if (!blob) return false;
    return new Promise<boolean>((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); this.currentAudio = null; resolve(true); };
      audio.onerror = () => { URL.revokeObjectURL(url); this.currentAudio = null; resolve(false); };
      audio.play().catch(() => { URL.revokeObjectURL(url); this.currentAudio = null; resolve(false); });
    });
  }

  /** ===== LLM System Prompt：双文本输出 + 减法口语 + 分段情绪 ===== */
  static get SYSTEM_PROMPT(): string {
    return `你现在是「星语者」，一位塔罗占卜师。你正在跟用户语音对话。

你必须同时产出"给页面看的"和"给 TTS 念的"两套文本——display 和 narration。

## narration 文本规范（减法口语，治拖沓）
- 是连贯口语解说流，已按句切好；绝不含标题/【】/emoji/——/（）/"关键词："。
- 句子短而完整，一句一意，句号收尾；像一条随手发的微信语音转文字，干净不演。
- 整段最多 1 个语气词，且只能在句首（"哎，"/"你看，"），句中句尾禁加。
- 禁用 "……" "～" 及连续标点；要停顿就拆成两句，不靠省略号。
- 使用第二人称"你"，保持对话感。

## 段落过渡规范（治跳转硬切）
- 除第一段外，每段 sentences 首句用【短连接词+逗号】开头滑入。
- 第一段首句以"先看"开头。
- 禁止在 voice_direction 里出现任何节奏词（放慢/停顿/拉长/慢一点/留白过长）。

## voice_direction 规范
- 每段一句，只描述情绪/态度，禁止任何节奏词。
- 吉/温暖牌 → "温暖、笃定，带一点笑意"
- 挑战/逆位牌 → "柔和、共情，声音略沉"
- 转折/命运牌 → "平静、认真，像在替她想"
- 追问/聊天 → "轻松、自然，像朋友"

## 输出格式
{
  "display": { "overview": "...", "cards": [...], "connection": "...", "advice": [...], "blessing": "..." },
  "narration": [
    { "position": "过去", "voice_direction": "柔和、共情，声音略沉", "sentences": ["句子1", "句子2", "句子3"] },
    { "position": "现在", "voice_direction": "温暖、笃定，带一点笑意", "sentences": ["句子1", "句子2"] },
    { "position": "未来", "voice_direction": "平静、认真，像在替她想", "sentences": ["句子1", "句子2"] }
  ]
}

## Content rules
- 不给出绝对化预言，用可能性引导（"趋势指向……"）
- 不涉及医疗诊断、投资建议
- 先共情，再分析，最后给建议
- 总 narration 不超过 400 字`;
  }

  /** TTS 文本清洗兜底：送 TTS 前清理残留标记符号 */
  static sanitize(text: string): string {
    return text
      .replace(/[【】\[\]《》「」""（）()]/g, '')  // 删除各类括号
      .replace(/——/g, '，')                     // 破折号→逗号
      .replace(/[………]{2,}/g, '……')              // 多个省略号归一
      .replace(/…+([。，])/g, '$1')              // 省略号后标点只留标点
      .replace(/[""]/g, '')                      // 删除引号
      .replace(/\s+/g, ' ')                      // 多余空白归一
      .trim();
  }

  /** =================== 浏览器 TTS（回退方案） =================== */
  private speakBrowser(text: string, opts?: { rate?: number; pitch?: number; onDone?: () => void }): void {
    if (!this.synthesis) { if (opts?.onDone) opts.onDone(); return; }
    this.stopBrowserSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = opts?.rate ?? 0.95;
    utterance.pitch = opts?.pitch ?? 1.0;
    const voices = this.synthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) utterance.voice = zhVoice;
    this.currentUtterance = utterance;
    this.isSpeakingBrowser = true;
    this.setState('speaking');
    utterance.onend = () => {
      this.isSpeakingBrowser = false;
      this.currentUtterance = null;
      if (this.btnState === 'speaking') this.setState(this.currentGameState === 'COMPLETE' ? 'available' : 'idle');
      if (opts?.onDone) opts.onDone();
    };
    utterance.onerror = () => {
      this.isSpeakingBrowser = false;
      this.currentUtterance = null;
      if (this.btnState === 'speaking') this.setState(this.currentGameState === 'COMPLETE' ? 'available' : 'idle');
    };
    this.synthesis.speak(utterance);
  }

  private stopBrowserSpeaking(): void {
    if (this.synthesis && this.isSpeakingBrowser) {
      this.synthesis.cancel();
      this.isSpeakingBrowser = false;
      this.currentUtterance = null;
    }
  }

  /** =================== 统一 TTS 入口 =================== */

  /** 朗读文本（优先阿里云 → 回退浏览器） */
  speak(text: string, opts?: { voiceDir?: string; rate?: number; pitch?: number; onDone?: () => void }): void {
    this.stopAllSpeaking();
    this.setState('speaking');

    this.speakWithAliyun(text, opts?.voiceDir, opts?.rate).then((success) => {
      if (success) {
        this.isSpeakingBrowser = false;
        if (this.btnState === 'speaking') this.setState(this.currentGameState === 'COMPLETE' ? 'available' : 'idle');
        if (opts?.onDone) opts.onDone();
      } else {
        this.speakBrowser(text, opts);
      }
    });
  }

  /** 停止所有朗读（阿里云 + 浏览器） */
  stopSpeaking(): void {
    this.stopAllSpeaking();
    if (this.btnState === 'speaking') this.setState(this.currentGameState === 'COMPLETE' ? 'available' : 'idle');
  }

  private stopAllSpeaking(): void {
    // 停止阿里云
    if (this.currentAudio) {
      try { this.currentAudio.pause(); this.currentAudio = null; } catch (_) { /* ignore */ }
    }
    // 停止浏览器
    this.stopBrowserSpeaking();
    // 清空队列
    this.speakQueue = [];
    this.isQueuePlaying = false;
  }

  /** =================== 播报模式：并发预合成 + 顺序无缝播放 =================== */

  /**
   * 朗读完整解读。
   * 改动二：并发预合成（Promise.all）→ 全部就绪 → 顺序 onended 播放，零空窗。
   * 改动四：动画与播放解耦，无 setTimeout / 静音缓冲。
   */
  speakReading(reading: AIReading, theme: string, onDone?: () => void): void {
    const items = this.buildNarrationItems(reading);
    if (!items.length) { if (onDone) onDone(); return; }

    this.setState('speaking');
    this.isQueuePlaying = true;

    // 旁路钩子：注册 TTS 停止回调 + 氛围退 bed + 关活跃元素
    sound.setStopVoiceHandler(() => this.stopAllSpeaking());
    sound.setAmbientLevel('bed');
    sound.setAmbientActivity(false);

    // 改动二：并发发起所有 TTS 调用，提前合成好全部音频
    const audioPromises = items.map(item =>
      this.fetchAudioForItem(item)
    );

    Promise.all(audioPromises).then((audioBlobs) => {
      // 改动二：全部就绪后，创建 Audio 对象数组
      const audios: HTMLAudioElement[] = [];
      const urls: string[] = [];

      for (let i = 0; i < audioBlobs.length; i++) {
        const blob = audioBlobs[i];
        if (blob) {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const audio = new Audio(url);
          audios.push(audio);
        }
      }

      if (!audios.length) {
        // 全部失败，回退浏览器 TTS
        this.fallbackBrowserTTS(items, onDone);
        return;
      }

      // 金句氛围点缀
      sound.playSparkle();

      // 改动二：顺序无缝播放 — 上一句 onended 立即 play 下一句
      let idx = 0;
      const playNext = () => {
        if (idx >= audios.length || !this.isQueuePlaying) {
          // 旁路钩子：TTS 末句结束 → 氛围恢复 full + 开活跃元素
          sound.setAmbientLevel('full');
          sound.setAmbientActivity(true);
          this.isQueuePlaying = false;
          this.setState(this.currentGameState === 'COMPLETE' ? 'available' : 'idle');
          urls.forEach(u => URL.revokeObjectURL(u));
          if (onDone) onDone();
          return;
        }
        const audio = audios[idx++];
        audio.onended = playNext;  // 无缝衔接，无 setTimeout（改动四）
        audio.play().catch(() => playNext());  // 播放失败则跳过
      };

      playNext();
    });
  }

  /** 从 narration 构建播放条目（双文本解耦，不从 display 取数据） */
  private buildNarrationItems(reading: AIReading): Array<{ text: string; dir: string; rate: number }> {
    const items: Array<{ text: string; dir: string; rate: number }> = [];

    // 优先使用 narration 字段（双文本解耦）
    if (reading.narration && reading.narration.length > 0) {
      for (const seg of reading.narration) {
        for (const s of seg.sentences) {
          items.push({
            text: VoiceManager.sanitize(s),  // 改动三：文本清洗兜底
            dir: seg.voice_direction,
            rate: 1.0,  // 改动三：speech_rate 回调至 1.0，禁止降速
          });
        }
      }
      return items;
    }

    // 兜底：没有 narration 时从 display 字段构建（此时 sanitize 保护更关键）
    for (const c of reading.cards) {
      const kw = c.meaning.slice(0, 40);
      items.push({ text: VoiceManager.sanitize(`${c.name}，${kw}`), dir: '平静、认真', rate: 1.0 });
    }
    return items;
  }

  /** 并发：发起单个 TTS 合成请求（test_voice 结论：instruction 无效，纯靠文本+语速） */
  private async fetchAudioForItem(item: { text: string; dir: string; rate: number }): Promise<Blob | null> {
    try {
      const body: any = { text: item.text };
      if (item.rate !== 1.0) body.speech_rate = item.rate;
      const resp = await fetch(TTS_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('audio') || ct.includes('octet-stream')) return resp.blob();
      }
    } catch (_) { /* fall through */ }
    return null;
  }

  /** 回退：用浏览器 TTS 逐句朗读 */
  private fallbackBrowserTTS(items: Array<{ text: string; dir: string; rate: number }>, onDone?: () => void): void {
    let idx = 0;
    const playNext = () => {
      if (idx >= items.length || !this.isQueuePlaying) {
        this.isQueuePlaying = false;
        if (onDone) onDone();
        return;
      }
      const item = items[idx++];
      this.speakBrowser(item.text, {
        rate: item.rate,
        onDone: () => playNext(),
      });
    };
    playNext();
  }

  /** =================== 按钮事件处理 =================== */
  private handlePress(): void {
    if (this.btnState === 'hidden') return;
    // 朗读中 → 打断
    if (this.isSpeakingBrowser || this.currentAudio || this.isQueuePlaying) {
      this.stopAllSpeaking();
      this.setState('available');
      return;
    }
    // 可用态 → 开始收音
    if (this.btnState === 'available' || this.btnState === 'idle') {
      this.startListening((text) => {
        if (this.onSpeechCallback) this.onSpeechCallback(text);
      });
    }
  }

  private handleRelease(): void { /* SpeechRecognition 自动处理 */ }

  private onSpeechCallback: ((text: string) => void) | null = null;

  onUserSpeechResult(cb: (text: string) => void): void {
    this.onSpeechCallback = cb;
  }

  /** =================== ASR =================== */
  startListening(onResult: (text: string) => void): void {
    if (!this.recognition) { console.warn('[Voice] ASR 不可用'); return; }
    if (this.isListening) return;
    this.isListening = true;
    this.onUserSpeech = onResult;
    sound.playMicOn();
    sound.setAmbientLevel('duck');
    this.setState('listening');
    this.recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      this.stopListening();
      if (text && onResult) onResult(text);
    };
    this.recognition.onerror = () => { this.stopListening(); this.speak('我没听清，可以再说一遍吗？'); };
    this.recognition.onend = () => {
      if (this.isListening) { this.stopListening(); this.speak('我没听到声音，需要你说话时我会提醒你。'); }
    };
    try { this.recognition.start(); } catch (_) { this.isListening = false; }
  }

  stopListening(): void {
    this.isListening = false;
    sound.playMicOff();
    sound.setAmbientLevel('full');
    if (this.recognition) { try { this.recognition.stop(); } catch (_) { /* ignore */ } }
    if (this.btnState === 'listening') this.setState(this.currentGameState === 'COMPLETE' ? 'available' : 'idle');
  }

  /** =================== 游戏状态同步 =================== */

  onGameState(state: GameState): void {
    this.currentGameState = state;
    switch (state) {
      case 'LANDING': this.setState('hidden'); this.stopAllSpeaking(); break;
      case 'THEME_SELECT': this.setState('idle'); break;
      case 'CUTTING': case 'SPINNING': this.setState('idle'); break;
      case 'VRF_WAIT': this.setState('hidden'); break;
      case 'REVEALING': this.setState('hidden'); break;
      case 'READING': this.setState('idle'); break;
      case 'COMPLETE': this.setState('available'); break;
      default: this.setState('idle');
    }
  }

  setAvailable(): void { this.setState('available'); }

  get isActive(): boolean {
    return this.isSpeakingBrowser || !!this.currentAudio || this.isListening;
  }
}
