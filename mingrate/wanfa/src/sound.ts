/**
 * sound.ts — 塔罗占卜大师 声音层旁路 sidecar
 *
 * 架构：单 AudioContext + 4 增益母线 → master
 * masterGain → ambientGain(氛围) / sfxGain(音效) / voiceGain(人声)
 *
 * 设计原则：
 * - 零外部素材依赖（全部程序化合成）
 * - 旁路接入：只挂事件钩子，不改原 TTS/预合成/状态机实现
 * - 全局总开关 + 总音量，关闭后 100% 回到纯 TTS 原状
 * - 念白时 ambient→bed 档 + 关闭活跃元素，不抢人声
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  /* 四条母线 */
  private masterGain!: GainNode;
  private ambientGain!: GainNode;
  private sfxGain!: GainNode;
  public voiceGain!: GainNode;

  /* 电平检测 */
  private masterAnalyser!: AnalyserNode;
  private masterData: Uint8Array = new Uint8Array(0);
  private micAnalyser: AnalyserNode | null = null;
  private micData: Uint8Array = new Uint8Array(0);
  private micLive = false;

  /* TTS 停止回调（由 voice-manager 注册） */
  private stopVoiceCb: (() => void) | null = null;

  /* 氛围层 */
  private droneNodes: OscillatorNode[] = [];
  private droneGain!: GainNode;
  private lfoGainNode!: GainNode;
  private activeInterval: ReturnType<typeof setInterval> | null = null;
  private ambientActivity = true;  // 活跃元素开关
  private currentLevel: 'full' | 'bed' | 'duck' = 'full';

  /* 混响 */
  private longReverb: ConvolverNode | null = null;

  private running = false;

  /* 配置集中 */
  static readonly CFG = {
    master: 1.0,
    voiceTargetDb: -10,
    ambient: { full: -16, bed: -23, duck: -30 },
    sfx: { normal: -18, accent: -14 },
    rampMs: 300,
    sparkleInterval: [3000, 6000] as [number, number],
    droneFreqs: [55, 66, 72],  // 低频 drone 基频
  };

  /** ===== 初始化 & 解锁 ===== */

  /** 用户首次点击时调用（绑到"触碰水晶/开始占卜"首次点击）。AudioContext 需用户手势解锁。 */
  unlock(): void {
    if (this.unlocked) return;
    this.ctx = new AudioContext();
    this.buildBuses();
    this.buildReverb();
    this.unlocked = true;
  }

  private buildBuses(): void {
    const ctx = this.ctx!;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = SoundManager.CFG.master;
    this.masterGain.connect(ctx.destination);

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = this.dbToGain(SoundManager.CFG.ambient.full);
    this.ambientGain.connect(this.masterGain);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.dbToGain(SoundManager.CFG.sfx.normal);
    this.sfxGain.connect(this.masterGain);

    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = this.dbToGain(SoundManager.CFG.voiceTargetDb);
    this.voiceGain.connect(this.masterGain);

    // 主输出 AnalyserNode（复用信号，不另开链路）
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    this.masterData = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterGain.connect(this.masterAnalyser);
  }

  /** 程序化短混响 impulse */
  private buildReverb(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = sr * 1.2;  // 1.2s decay
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.08));  // 80ms decay
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    this.longReverb = conv;
  }

  /** ===== 工具 ===== */
  private dbToGain(db: number): number { return Math.pow(10, db / 20); }
  private get ctxSafe(): AudioContext { return this.ctx!; }

  /** ===== 全局总控 ===== */

  setMasterVolume(v: number): void { if (this.masterGain) this.masterGain.gain.value = Math.max(0, v); }
  getMasterVolume(): number { return this.masterGain?.gain.value ?? 1; }

  /** 关闭所有氛围 + SFX，复位 ducking → 纯 TTS 原状 */
  muteAll(): void {
    this.setAmbientLevel('full');
    this.stopDrone();
    this.stopActivity();
    if (this.sfxGain) this.sfxGain.gain.value = 0;
    if (this.ambientGain) this.ambientGain.gain.value = 0;
  }

  /** 恢复默认 */
  unmuteAll(): void {
    if (this.sfxGain) this.sfxGain.gain.value = this.dbToGain(SoundManager.CFG.sfx.normal);
    this.setAmbientLevel('full');
  }

  /** ===== 三态 ducking 控制器 ===== */
  /**
   * full = -16dB（演出/CG，无人声）
   * bed  = -23dB（念白，退后排垫底，不抢话）
   * duck = -30dB（ASR 识别/极特殊）
   */
  setAmbientLevel(state: 'full' | 'bed' | 'duck'): void {
    this.currentLevel = state;
    if (!this.ctx || !this.ambientGain) return;
    const target = this.dbToGain(SoundManager.CFG.ambient[state]);
    const ramp = SoundManager.CFG.rampMs / 1000;
    this.ambientGain.gain.setTargetAtTime(target, this.ctx.currentTime, ramp);
  }

  /** 氛围活跃元素（星铃点缀）开关 — 念白时 off */
  setAmbientActivity(on: boolean): void {
    this.ambientActivity = on;
    if (on) this.startActivity();
    else this.stopActivity();
  }

  /** ===== 程序化氛围 drone ===== */
  startDrone(): void {
    if (!this.ctx || this.droneNodes.length) return;
    const ctx = this.ctx;
    const baseFreqs = SoundManager.CFG.droneFreqs;
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(this.ambientGain);

    // LFO 调制 filter cutoff
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08; // 极慢
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 600;
    lfo.connect(lfoGain);
    this.lfoGainNode = lfoGain;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.5;
    lfoGain.connect(filter.frequency);
    master.connect(filter);
    filter.connect(this.ambientGain);

    // 2-3 detuned osc
    const oscs: OscillatorNode[] = [];
    baseFreqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f + i * 0.3; // slight detune
      const g = ctx.createGain();
      g.gain.value = 0.06;
      osc.connect(g);
      g.connect(master);
      osc.start();
      oscs.push(osc);
    });
    lfo.start();

    this.droneNodes = oscs;
    this.droneGain = master;
  }

  private stopDrone(): void {
    this.droneNodes.forEach(o => { try { o.stop(); } catch (_) {} });
    this.droneNodes = [];
  }

  /** 星铃活跃元素：3-6s 随机触发一个高音 sine + 长混响 */
  private startActivity(): void {
    if (this.activeInterval) return;
    const tick = () => {
      if (!this.ambientActivity || !this.ctx) return;
      this.playStarChime();
      const next = SoundManager.CFG.sparkleInterval[0] + Math.random() *
        (SoundManager.CFG.sparkleInterval[1] - SoundManager.CFG.sparkleInterval[0]);
      this.activeInterval = setTimeout(tick, next);
    };
    tick();
  }

  private stopActivity(): void {
    if (this.activeInterval) { clearTimeout(this.activeInterval); this.activeInterval = null; }
  }

  /** ===== 情绪 → 音色参数映射 ===== */
  static moodFromDir(voiceDir?: string): 'bright' | 'dark' | 'neutral' {
    if (!voiceDir) return 'neutral';
    if (voiceDir.includes('笑意') || voiceDir.includes('温暖')) return 'bright';
    if (voiceDir.includes('沉') || voiceDir.includes('共情') || voiceDir.includes('柔和')) return 'dark';
    return 'neutral';
  }

  /** ===== 程序化 SFX ===== */

  /** 翻牌音效：sine+triangle "叮"，音高逐张递进，情绪联动 */
  playReveal(index: number, mood?: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const baseFreq = 520 + index * 130; // 逐张升高
    const isDark = mood === 'dark';
    const freq = isDark ? baseFreq * 0.7 : baseFreq;
    const dur = 0.3 + (isDark ? 0.15 : 0);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 1.005;

    const mix = ctx.createGain();
    mix.gain.setValueAtTime(this.dbToGain(-16), ctx.currentTime);
    mix.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc1.connect(mix);
    osc2.connect(mix);

    if (this.longReverb) {
      const revG = ctx.createGain();
      revG.gain.value = isDark ? 0.4 : 0.25;
      mix.connect(revG);
      revG.connect(this.longReverb);
      this.longReverb.connect(this.sfxGain);
    }
    mix.connect(this.sfxGain);

    osc1.start(); osc1.stop(ctx.currentTime + dur + 0.1);
    osc2.start(); osc2.stop(ctx.currentTime + dur + 0.1);
  }

  /** 洗牌音效：短噪声爆发 */
  playShuffle(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dur = 0.15;
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = this.dbToGain(-20);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2000;
    f.Q.value = 0.5;
    src.connect(g); g.connect(f); f.connect(this.sfxGain);
    src.start();
  }

  /** 开始占卜：sine sweep 低→高 */
  playStart(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-18), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.7);
  }

  /** 段落过渡：软 pad 膨起 */
  playTransition(mood?: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const isDark = mood === 'dark';
    const freq = isDark ? 160 : 280;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(this.dbToGain(-22), ctx.currentTime + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(g);
    if (this.longReverb) { g.connect(this.longReverb); this.longReverb.connect(this.sfxGain); }
    g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.7);
  }

  /** 麦克风按下：上升 sweep */
  playMicOn(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-20), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
  }

  /** 麦克风松开：下降 sweep */
  playMicOff(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-20), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  }

  /** 金句/星尘：3-5 个随机延迟高频 sine 颗粒 */
  playSparkle(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const delay = Math.random() * 0.15;
      const freq = 2000 + Math.random() * 3000;
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-22), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.connect(g);
        if (this.longReverb) { g.connect(this.longReverb); this.longReverb.connect(this.sfxGain); }
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      }, delay * 1000);
    }
  }

  /** CG 高光：由远及近 shimmer */
  playCgAccent(mood?: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const isDark = mood === 'dark';
    const baseFreq = isDark ? 180 : 440;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * 0.5, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(baseFreq, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(this.dbToGain(-16), ctx.currentTime + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(g);
    if (this.longReverb) { g.connect(this.longReverb); this.longReverb.connect(this.sfxGain); }
    g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.9);

    // 点缀 2 个高音
    for (let i = 0; i < 2; i++) {
      const d = 0.1 + i * 0.15;
      setTimeout(() => {
        if (!this.ctx) return;
        const o2 = ctx.createOscillator();
        o2.type = 'triangle';
        o2.frequency.value = baseFreq * 2.5;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(this.dbToGain(-20), ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        o2.connect(g2); g2.connect(this.sfxGain);
        o2.start(); o2.stop(ctx.currentTime + 0.25);
      }, d * 1000);
    }
  }

  /** 存入星盘 */
  playSave(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [523, 659, 784].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-18), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        o.connect(g); g.connect(this.sfxGain);
        o.start(); o.stop(ctx.currentTime + 0.3);
      }, i * 80);
    });
  }

  /** 分享 */
  playShare(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [784, 988].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-16), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        o.connect(g); g.connect(this.sfxGain);
        o.start(); o.stop(ctx.currentTime + 0.25);
      }, i * 100);
    });
  }

  /** 再抽一次 */
  playReset(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-18), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
  }

  /** 星铃点缀音（氛围活跃元素用） */
  private playStarChime(): void {
    if (!this.ctx || !this.ambientActivity) return;
    const ctx = this.ctx;
    const freq = 800 + Math.random() * 1800;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-26), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc.connect(g);
    if (this.longReverb) {
      const rg = ctx.createGain();
      rg.gain.value = 0.7;
      g.connect(rg); rg.connect(this.longReverb); this.longReverb.connect(this.ambientGain);
    }
    g.connect(this.ambientGain);
    osc.start(); osc.stop(ctx.currentTime + 1.5);
  }

  /** ===== voice-stage 接口 ===== */

  /** 注册 TTS 停止回调（由 voice-manager 在 speakReading 时注册） */
  setStopVoiceHandler(cb: (() => void) | null): void { this.stopVoiceCb = cb; }

  /** 停止当前 TTS 播放（barge-in 用） */
  stopVoice(): void { if (this.stopVoiceCb) this.stopVoiceCb(); }

  /** 获取主输出 RMS 电平（0-1），TTS 播放时即 voiceLevel，无 TTS 时 ≈0 */
  getVoiceLevel(): number {
    if (!this.masterAnalyser) return 0;
    this.masterAnalyser.getByteTimeDomainData(this.masterData as unknown as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.masterData.length; i++) {
      const v = (this.masterData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.masterData.length) * 2.5);
  }

  /** 获取麦克风 RMS 电平（0-1），未授权/未激活时返回 0 */
  getMicLevel(): number {
    if (!this.micAnalyser || !this.micLive) return 0;
    this.micAnalyser.getByteTimeDomainData(this.micData as unknown as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.micData.length; i++) {
      const v = (this.micData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.micData.length) * 3.2);
  }

  /** 启用麦克风授权 + 建立 AnalyserNode（由用户手势触发） */
  async enableMic(): Promise<boolean> {
    if (this.micLive) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = this.ctx;
      if (!ctx) return false;
      const src = ctx.createMediaStreamSource(stream);
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = 512;
      this.micData = new Uint8Array(this.micAnalyser.frequencyBinCount);
      src.connect(this.micAnalyser);
      this.micLive = true;
      return true;
    } catch (_) { return false; }
  }

  /** ===== 主动释放 ===== */
  dispose(): void {
    this.stopDrone();
    this.stopActivity();
    this.muteAll();
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
    this.unlocked = false;
  }
}

/** 全局单例 */
export const sound = new SoundManager();

/**
 * ===== 进阶 V2：sidechain 自动呼吸（默认不开启） =====
 *
 * 思路：把人声 createMediaElementSource 接入 ctx 做 sidechain，压缩 ambientGain。
 * 人声响起时 ambient 自动压低，人声缝隙背景微回升，更动态自然。
 *
 * ⚠️ 坑（接入前必读）：
 * 1. createMediaElementSource 每个元素只能接一次，接错或重复接入会报错且无声。
 * 2. TTS 的 HTMLAudioElement 是临时创建/销毁的（预合成中），每句新 audio 都要重新 connect。
 * 3. 这意味着 sidechain 链路必须在 playNext() 中每句重建，不能一次建好。
 * 4. 且 Audio 元素的 src 是 Blob URL，断开后 Blob 可能被回收，需确保引用。
 * 5. 当前三态 ducking（full/bed/duck）已覆盖核心场景，sidechain 边际收益有限。
 *
 * 建议 V2 再做，接入示例：
 * ```typescript
 * // 在 playNext() 中，audio.play() 之前：
 * const src = ctx.createMediaElementSource(audio);
 * const compressor = ctx.createDynamicsCompressor();
 * compressor.threshold.value = -24;
 * compressor.knee.value = 6;
 * compressor.ratio.value = 12;
 * compressor.attack.value = 0.05;
 * compressor.release.value = 0.3;
 * src.connect(compressor);
 * compressor.connect(voiceGain);   // 人声进 voice bus
 * // compressor 的 sidechain 输入接 ambientGain 前：
 * // 用 GainNode 在 compressor 输出时控制 ambientGain
 * ```
 */
