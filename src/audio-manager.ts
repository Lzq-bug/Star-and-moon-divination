/**
 * audio-manager.ts — 星月占卜 音频管理器
 *
 * 三总线架构（独立于 aliyun-tts.ts 的 TTS 语音通道）：
 *   masterGain → bgmGain (BGM 背景音乐)
 *              → sfxGain (SFX 交互音效)
 *   TTS 语音由 aliyun-tts.ts 独立管理，集合物理分离。
 *
 * 设计原则：
 * - 合成优先：零外部素材（除 BGM 采样），全部 Web Audio 合成
 * - 集合分离：stopAllAudio 只停语音，BGM/SFX 不受影响
 * - 打断时停转动音，不停 BGM
 * - 音量持久化 localStorage
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  /* 三总线 */
  private masterGain!: GainNode;
  private bgmGain!: GainNode;
  private sfxGain!: GainNode;

  /* BGM */
  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmGainNode: GainNode | null = null; // per-source fade gain
  private bgmReady = false;
  private bgmFading = false;

  /* 活跃 SFX 集合（播完自动移除） */
  private activeSfx = new Set<{ src: AudioScheduledSourceNode; cleanup: () => void }>();

  /* 程序化混响 */
  private reverbNode: ConvolverNode | null = null;

  /* 命运之轮转动音 */
  private spinOscs: OscillatorNode[] = [];
  private spinGain: GainNode | null = null;
  private spinLfo: OscillatorNode | null = null;

  /* 节流 */
  private lastSfxTime = new Map<string, number>();

  /* Ducking 状态 */
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private bgmBaseLevel = -18;

  /* 音量 */
  private sfxVolume = -14;
  private masterMuted = false;

  static readonly CFG = {
    bgm: { defaultDb: -18, duckedDb: -30, duckMs: 500, restoreMs: 1500 },
    sfx: { defaultDb: -14 },
    reverb: { decayMs: 1200, decayDb: -60 },
  };

  // ── 初始化 ──────────────────────────────────

  /** 用户首次手势调用（触碰水晶/开始）。AudioContext 需用户手势解锁。 */
  unlock(): void {
    if (this.unlocked) return;
    this.ctx = new AudioContext();
    this.buildBuses();
    this.buildReverb();
    this.loadVolumes();
    this.unlocked = true;
  }

  private ensureCtx(): AudioContext {
    // 懒解锁:首次播放音效时若尚未在「触碰水晶」手势里 unlock,就在这里补建 AudioContext。
    // 否则开场题选项等首个交互点会因 AudioContext 未解锁而抛错,导致提交逻辑被打断。
    if (!this.ctx) this.unlock();
    if (!this.ctx) throw new Error('AudioManager not unlocked');
    return this.ctx;
  }

  private buildBuses(): void {
    const ctx = this.ctx!;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterMuted ? 0 : 1;
    this.masterGain.connect(ctx.destination);

    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = this.dbToGain(this.bgmBaseLevel);
    this.bgmGain.connect(this.masterGain);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.dbToGain(this.sfxVolume);
    this.sfxGain.connect(this.masterGain);
  }

  private buildReverb(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const decaySec = AudioManager.CFG.reverb.decayMs / 1000;
    const len = sr * decaySec;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const env = Math.exp(-i / (sr * 0.15)); // 150ms decay
        data[i] = (Math.random() * 2 - 1) * env * 0.6;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    this.reverbNode = conv;
  }

  // ── 工具 ────────────────────────────────────

  private dbToGain(db: number): number {
    return Math.pow(10, db / 20);
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastSfxTime.get(key) ?? 0;
    if (now - last < ms) return true;
    this.lastSfxTime.set(key, now);
    return false;
  }

  private trackSfx(src: AudioScheduledSourceNode, durationMs: number): void {
    const entry = { src, cleanup: () => {} };
    entry.cleanup = () => {
      this.activeSfx.delete(entry);
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
    };
    this.activeSfx.add(entry);
    src.onended = () => this.activeSfx.delete(entry);
    setTimeout(() => this.activeSfx.delete(entry), durationMs + 200);
  }

  private playTone(
    type: OscillatorType,
    freq: number,
    duration: number,
    gainDb: number,
    dest?: AudioNode,
  ): OscillatorNode {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(gainDb), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(dest ?? this.sfxGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration + 0.05);
    this.trackSfx(osc, duration * 1000);
    return osc;
  }

  private playSweep(
    type: OscillatorType,
    freqFrom: number,
    freqTo: number,
    duration: number,
    gainDb: number,
  ): OscillatorNode {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(freqTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(gainDb), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration + 0.05);
    this.trackSfx(osc, duration * 1000);
    return osc;
  }

  // ── BGM ─────────────────────────────────────

  /**
   * 启动 BGM 循环。首次自动生成背景氛围垫音。
   * 可在首次用户手势后调用。
   */
  startBGM(): void {
    if (this.bgmReady || !this.ctx) return;
    const ctx = this.ensureCtx();
    this.bgmReady = true;

    // 程序化生成环境垫音：多个 detuned sawtooth → 低通滤波 → 极慢 LFO
    const masterG = ctx.createGain();
    masterG.gain.value = 0;
    this.bgmGainNode = masterG;
    masterG.connect(this.bgmGain);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 0.8;
    masterG.connect(filter);
    filter.connect(this.bgmGain);

    // LFO 调制 filter cutoff
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG);
    lfoG.connect(filter.frequency);
    lfo.start();
    // track LFO for cleanup but don't add to sfx set
    this.trackSfx(lfo, 999999);

    // 多层 detuned 振荡器
    const baseFreqs = [55, 66, 73, 82];
    baseFreqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f + i * 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      osc.connect(g);
      g.connect(masterG);
      osc.start();
      this.trackSfx(osc, 999999);
    });

    // 添加一层空气感 sine
    const air = ctx.createOscillator();
    air.type = 'sine';
    air.frequency.value = 4400;
    const airG = ctx.createGain();
    airG.gain.value = 0.008;
    air.connect(airG);
    airG.connect(filter);
    air.start();
    this.trackSfx(air, 999999);

    // 淡入
    masterG.gain.setValueAtTime(0, ctx.currentTime);
    masterG.gain.linearRampToValueAtTime(this.dbToGain(this.bgmBaseLevel), ctx.currentTime + 1.5);
    this.bgmFading = false;
  }

  stopBGM(): void {
    if (!this.bgmGainNode || !this.ctx) return;
    const ctx = this.ctx;
    this.bgmFading = true;
    this.bgmGainNode.gain.setValueAtTime(this.bgmGainNode.gain.value, ctx.currentTime);
    this.bgmGainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    setTimeout(() => {
      this.bgmReady = false;
      this.bgmFading = false;
    }, 1600);
  }

  // ── Ducking ─────────────────────────────────

  /** TTS/录音开始时调用：BGM 降音量 */
  duckBGM(): void {
    if (!this.bgmGainNode || !this.ctx) return;
    if (this.duckTimer) { clearTimeout(this.duckTimer); this.duckTimer = null; }
    const target = this.dbToGain(AudioManager.CFG.bgm.duckedDb);
    this.bgmGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bgmGainNode.gain.setValueAtTime(this.bgmGainNode.gain.value, this.ctx.currentTime);
    this.bgmGainNode.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.5);
  }

  /** TTS/录音结束后调用：BGM 回升 */
  restoreBGM(delayMs = 200): void {
    if (!this.bgmGainNode || !this.ctx) return;
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      if (!this.bgmGainNode || !this.ctx) return;
      const target = this.dbToGain(this.bgmBaseLevel);
      this.bgmGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.bgmGainNode.gain.setValueAtTime(this.bgmGainNode.gain.value, this.ctx.currentTime);
      this.bgmGainNode.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1.5);
    }, delayMs);
  }

  // ── SFX 触碰水晶球 ────────────────────────

  playCrystalTouch(): void {
    if (this.throttle('crystal', 200)) return;
    const ctx = this.ensureCtx();
    // 双音层叠：主音 528Hz + 泛音 1056Hz + 混响
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(this.dbToGain(-16), ctx.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(528, ctx.currentTime);
    osc1.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.3);
    osc1.connect(g1);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(this.dbToGain(-22), ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1056, ctx.currentTime);
    osc2.frequency.linearRampToValueAtTime(1320, ctx.currentTime + 0.25);
    osc2.connect(g2);

    // 混响发送
    if (this.reverbNode) {
      const revG = ctx.createGain();
      revG.gain.value = 0.5;
      g1.connect(revG);
      revG.connect(this.reverbNode);
      this.reverbNode.connect(this.sfxGain);
      g2.connect(revG);
    }

    g1.connect(this.sfxGain);
    g2.connect(this.sfxGain);
    osc1.start(); osc1.stop(ctx.currentTime + 1.1);
    osc2.start(); osc2.stop(ctx.currentTime + 0.8);
    this.trackSfx(osc1, 1100);
    this.trackSfx(osc2, 800);
  }

  /** 星光"叮"扩散：高频 shimmer 颗粒 */
  playSparkle(count = 4): void {
    if (this.throttle('sparkle', 100)) return;
    const ctx = this.ensureCtx();
    for (let i = 0; i < count; i++) {
      const delay = i * (30 + Math.random() * 50);
      setTimeout(() => {
        if (!this.ctx) return;
        const freq = 2000 + Math.random() * 3000;
        const d = ctx.createOscillator();
        d.type = 'sine';
        d.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-24), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        d.connect(g);
        if (this.reverbNode) {
          const rg = ctx.createGain();
          rg.gain.value = 0.3;
          g.connect(rg);
          rg.connect(this.reverbNode);
          this.reverbNode.connect(this.sfxGain);
        }
        g.connect(this.sfxGain);
        d.start(); d.stop(ctx.currentTime + 0.2);
      }, delay);
    }
  }

  // ── SFX 命运之轮 ──────────────────────────

  playSpinStart(): void {
    this.playSpinStop(); // 停旧的
    const ctx = this.ensureCtx();
    const spinG = ctx.createGain();
    spinG.gain.setValueAtTime(0, ctx.currentTime);
    spinG.gain.linearRampToValueAtTime(this.dbToGain(-22), ctx.currentTime + 0.8);
    this.spinGain = spinG;
    spinG.connect(this.sfxGain);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 120;
    filter.Q.value = 1.5;

    // LFO 调制 filter
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 2.5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 80;
    lfo.connect(lfoG);
    lfoG.connect(filter.frequency);
    lfo.start();
    this.spinLfo = lfo;
    spinG.connect(filter);
    filter.connect(this.sfxGain);

    const oscs: OscillatorNode[] = [];
    [55, 62, 73].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f + i * 2;
      const g = ctx.createGain();
      g.gain.value = 0.04;
      osc.connect(g);
      g.connect(spinG);
      osc.start();
      oscs.push(osc);
    });
    this.spinOscs = oscs;
  }

  playSpinStop(): void {
    this.spinOscs.forEach(o => { try { o.stop(); o.disconnect(); } catch { /* ok */ } });
    this.spinOscs = [];
    if (this.spinLfo) { try { this.spinLfo.stop(); this.spinLfo.disconnect(); } catch { /* ok */ } this.spinLfo = null; }
    if (this.spinGain) {
      if (this.ctx) {
        this.spinGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.spinGain.gain.setValueAtTime(this.spinGain.gain.value, this.ctx.currentTime);
        this.spinGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
      }
      setTimeout(() => {
        try { this.spinGain?.disconnect(); } catch { /* ok */ }
        this.spinGain = null;
      }, 900);
    }
  }

  /** 轮盘落定音 */
  playSpinSettle(): void {
    const ctx = this.ensureCtx();
    [880, 660, 440].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(f === 440 ? -22 : -18), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.3);
        this.trackSfx(osc, 300);
      }, i * 80);
    });
  }

  // ── SFX 卡片揭晓 ──────────────────────────

  playCardReveal(rarity?: string): void {
    if (this.throttle('cardReveal', 300)) return;
    const isRare = rarity === '稀有' || rarity === '史诗' || rarity === '传说';
    const baseFreq = isRare ? 660 : 440;
    const count = isRare ? 4 : 3;
    const ctx = this.ensureCtx();
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (!this.ctx) return;
        const freq = baseFreq * (1 + i * 0.5);
        const osc = ctx.createOscillator();
        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(isRare ? -16 : -18), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(g);
        if (this.reverbNode && isRare) {
          const rg = ctx.createGain();
          rg.gain.value = 0.3;
          g.connect(rg);
          rg.connect(this.reverbNode);
          this.reverbNode.connect(this.sfxGain);
        }
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.35);
        this.trackSfx(osc, 350);
      }, i * 100);
    }
    if (isRare) this.playSparkle(2);
  }

  // ── SFX 麦克风 ────────────────────────────

  playMicPress(): void {
    if (this.throttle('micPress', 150)) return;
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-22), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
    this.trackSfx(osc, 100);
  }

  playRecogSuccess(): void {
    if (this.throttle('recogSucc', 300)) return;
    const ctx = this.ensureCtx();
    [660, 880].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-18), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.15);
        this.trackSfx(osc, 150);
      }, i * 60);
    });
  }

  playRecogFail(): void {
    if (this.throttle('recogFail', 500)) return;
    const ctx = this.ensureCtx();
    [440, 330].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-20), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.25);
        this.trackSfx(osc, 250);
      }, i * 100);
    });
  }

  // ── SFX 按钮 / 交互 ───────────────────────

  playBtnHover(): void {
    if (this.throttle('btnHover', 80)) return;
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-28), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.05);
  }

  playInterrupt(): void {
    if (this.throttle('interrupt', 200)) return;
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-18), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.18);
    this.trackSfx(osc, 180);
  }

  playWhoosh(): void {
    if (this.throttle('whoosh', 300)) return;
    const ctx = this.ensureCtx();
    const dur = 0.3;
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(800, ctx.currentTime + dur);
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.dbToGain(-22), ctx.currentTime);
    g.gain.linearRampToValueAtTime(this.dbToGain(-30), ctx.currentTime + dur);
    src.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    src.start(); src.stop(ctx.currentTime + dur + 0.05);
    this.trackSfx(src, dur * 1000);
  }

  // ── SFX 铸造 ──────────────────────────────

  playMintConfirm(): void {
    const ctx = this.ensureCtx();
    [523, 659].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-16), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.22);
        this.trackSfx(osc, 220);
      }, i * 80);
    });
  }

  playMintSuccess(): void {
    const ctx = this.ensureCtx();
    // 钟琴琶音 5 音上行
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(i === notes.length - 1 ? this.dbToGain(-14) : this.dbToGain(-16), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.connect(g);
        if (this.reverbNode) {
          const rg = ctx.createGain();
          rg.gain.value = 0.6;
          g.connect(rg);
          rg.connect(this.reverbNode);
          this.reverbNode.connect(this.sfxGain);
        }
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.45);
        this.trackSfx(osc, 450);
      }, i * 120);
    });
    // 叠星光绽放
    setTimeout(() => this.playSparkle(6), 300);
  }

  playMintFail(): void {
    const ctx = this.ensureCtx();
    [440, 370, 293].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.dbToGain(-20), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(); osc.stop(ctx.currentTime + 0.4);
        this.trackSfx(osc, 400);
      }, i * 120);
    });
  }

  // ── 音量控制 ──────────────────────────────

  setBGMVolume(db: number): void {
    this.bgmBaseLevel = db;
    if (this.bgmGain) this.bgmGain.gain.value = this.dbToGain(db);
    localStorage.setItem('audio.bgmVolume', String(db));
  }

  setSFXVolume(db: number): void {
    this.sfxVolume = db;
    if (this.sfxGain) this.sfxGain.gain.value = this.dbToGain(db);
    localStorage.setItem('audio.sfxVolume', String(db));
  }

  toggleMute(): boolean {
    this.masterMuted = !this.masterMuted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.masterMuted ? 0 : 1;
    }
    localStorage.setItem('audio.muted', String(this.masterMuted));
    return this.masterMuted;
  }

  get isMuted(): boolean { return this.masterMuted; }

  private loadVolumes(): void {
    try {
      const bgm = localStorage.getItem('audio.bgmVolume');
      if (bgm) this.bgmBaseLevel = Number(bgm);
      const sfx = localStorage.getItem('audio.sfxVolume');
      if (sfx) this.sfxVolume = Number(sfx);
      this.masterMuted = localStorage.getItem('audio.muted') === 'true';
    } catch { /* ignore */ }
  }

  // ── 资源释放 ──────────────────────────────

  dispose(): void {
    this.playSpinStop();
    this.activeSfx.forEach(e => e.cleanup());
    this.activeSfx.clear();
    if (this.bgmGainNode) {
      try { this.bgmGainNode.disconnect(); } catch { /* ok */ }
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.unlocked = false;
    this.bgmReady = false;
  }
}

/** 全局单例 */
export const audioManager = new AudioManager();
