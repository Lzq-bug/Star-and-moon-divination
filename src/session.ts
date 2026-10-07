/**
 * session.ts — 塔罗 Agent 会话编排层
 *
 * 把真 Agent（tarot provider + 4 工具）接到主项目的水晶球界面：
 *   用户输入(语音/文字) → agent.prompt()
 *     → message_update 事件 → 流式文字渲染进 .chat-log
 *     → tool_execution_end 事件 → 抽牌/解读/藏品卡片渲染
 *   beforeToolCall 弹窗确认已在 agent/setup.ts 内接好。
 *
 * 不改水晶球 UI，只提供 send() 入口与事件渲染。
 */
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createTarotAgent, DEFAULT_MODEL_ID, DEFAULT_BASE_URL, DEFAULT_API_KEY } from "./agent/setup";
import { saveTarotCard } from "./horoscope";
import type { DrawDetails, MintDetails, OpeningDetails, SurveyDetails, CardReadingDetails, SelfNarrationDetails, ReportDetails } from "./tools";

type ToolDetails =
  | OpeningDetails
  | SurveyDetails
  | SelfNarrationDetails
  | DrawDetails
  | CardReadingDetails
  | ReportDetails
  | MintDetails;

const KEY_STORE = "tarot.apiKey";
const MODEL_STORE = "tarot.modelId";
const BASE_URL_STORE = "tarot.baseUrl";

export const majorArcanaGlyph = (nameCn: string): string => {
  const map: Record<string, string> = {
    愚者: "🃏", 魔术师: "🎩", 女祭司: "🌙", 皇后: "👑", 皇帝: "🏛", 教皇: "⛪",
    恋人: "💞", 战车: "🏇", 力量: "🦁", 隐士: "🏮", 命运之轮: "🎡", 正义: "⚖",
    倒吊人: "🙃", 死神: "💀", 节制: "🍶", 恶魔: "😈", 高塔: "🗼", 星星: "⭐",
    月亮: "🌕", 太阳: "☀", 审判: "📯", 世界: "🌍",
  };
  for (const k of Object.keys(map)) if (nameCn.includes(k)) return map[k];
  if (nameCn.includes("权杖")) return "🔥";
  if (nameCn.includes("圣杯")) return "💧";
  if (nameCn.includes("宝剑")) return "⚔";
  if (nameCn.includes("星币")) return "🪙";
  return "🔮";
};

export interface SessionCallbacks {
  /** 状态文案更新（接到主项目 chat-status） */
  onStatus?: (text: string, state: "idle" | "thinking" | "replying") => void;
  /** 星语想说的整段文本（可用于 TTS 朗读） */
  onSpeak?: (text: string) => void;
  /** 铸造藏品结果回调（用于播放音效） */
  onMint?: (kind: 'start' | 'success' | 'fail') => void;
  /** 开场题：把单个问题 + 选项交给主项目在中央水晶球上渲染 */
  onOpening?: (q: OpeningDetails) => void;
  /** 个性化问卷：把整份问卷交给主项目渲染表单 */
  onSurvey?: (s: SurveyDetails) => void;
  /** 自述邀请：把邀请语交给主项目在中央渲染自述环节(点水晶自述) */
  onSelfNarration?: (s: SelfNarrationDetails) => void;
  /** 专属报告：把报告内容交给主项目渲染富文本报告卡 */
  onReport?: (r: ReportDetails) => void;
  /** 用户点「继续」解读下一张牌：由主项目驱动发送 */
  onContinue?: () => void;
  /** 发牌由玩家点水晶触发：返回 Promise，true 放行发牌 */
  onDrawRequest?: (
    args: { spread: string; question: string },
    signal: AbortSignal | undefined,
  ) => Promise<boolean>;
  /** 发牌结果：在中央展示 78 张背面朝上的扇形牌阵,由玩家盲选 3 张 */
  onCardsDrawn?: (d: DrawDetails) => Promise<void> | void;
  /** 专属藏品：把铸造成的纪念藏品详情交给主项目做全屏翻转展示 */
  onMintCard?: (d: MintDetails) => void;
}

/**
 * 塔罗会话：封装 agent 生命周期 + 事件渲染。
 * 渲染目标为传入的 chatLog 容器（主项目 .chat-log）。
 */
export class TarotSession {
  private agent: Agent | null = null;
  private busy = false;
  private aborted = false; // 标记是否被外部中断，抑制错误提示
  private currentAssistantEl: HTMLElement | null = null;
  private currentTitleEl: HTMLElement | null = null;
  private currentBodyEl: HTMLElement | null = null;
  // 自动续跑安全网
  private minted = false;
  private streamErrored = false;
  private lastToolKind: string | null = null;
  /** 逐张解读计数：用于在解读卡上标注「第 N 张」 */
  private readingIndex = 0;
  /** 流式 TTS：已发送给朗读的字符偏移量（在当前 assistant 消息内） */
  private ttsSentLen = 0;

  constructor(
    private chatLog: HTMLElement,
    private cbs: SessionCallbacks = {},
  ) {
    ensureStyle();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** 取生效的 API Key:优先 localStorage,回退到 .env.local 注入的默认 key */
  private getApiKey(): string {
    return (localStorage.getItem(KEY_STORE) ?? "").trim() || DEFAULT_API_KEY;
  }

  /** 是否已配置 API Key */
  hasApiKey(): boolean {
    return Boolean(this.getApiKey());
  }

  saveConfig(cfg: { apiKey: string; baseUrl?: string; modelId?: string }): void {
    localStorage.setItem(KEY_STORE, cfg.apiKey.trim());
    localStorage.setItem(BASE_URL_STORE, (cfg.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL);
    localStorage.setItem(MODEL_STORE, (cfg.modelId ?? DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID);
    this.agent = null; // 配置变了，重新装配
  }

  private ensureAgent(): Agent | null {
    if (this.agent) return this.agent;
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.cbs.onStatus?.("请先配置 API Key", "idle");
      return null;
    }
    try {
      this.agent = createTarotAgent({
        apiKey,
        baseUrl: (localStorage.getItem(BASE_URL_STORE) ?? "").trim() || DEFAULT_BASE_URL,
        modelId: (localStorage.getItem(MODEL_STORE) ?? "").trim() || DEFAULT_MODEL_ID,
        requestDraw: (args, signal) => this.cbs.onDrawRequest?.(args, signal) ?? Promise.resolve(true),
      });
      this.agent.subscribe((ev) => this.onAgentEvent(ev));
    } catch (err) {
      this.cbs.onStatus?.(`装配失败：${err instanceof Error ? err.message : String(err)}`, "idle");
      return null;
    }
    return this.agent;
  }

  /** 中断当前正在进行的占卜流程 */
  abort(): void {
    this.aborted = true;
    this.agent?.abort();
    this.busy = false;
    this.currentAssistantEl = null;
    this.currentTitleEl = null;
    this.currentBodyEl = null;
    this.minted = false;
    this.streamErrored = false;
    this.readingIndex = 0;
    this.ttsSentLen = 0;
  }

  /** 发送一轮用户输入，驱动占卜流程 */
  async send(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    await this.deliver(clean, true);
  }

  /** 开场主动问候:进入主页后,星语先打招呼再自然开始了解诉求(不渲染用户气泡) */
  async greet(): Promise<void> {
    await this.deliver("咨询者已进入星月占卜,请先温暖地打招呼、欢迎 TA,然后自然地开始了解 TA 想占卜的事。", false);
  }

  /** 用户想继续倾诉:让星语继续倾听/交流,先别急着推进 */
  async continueChat(): Promise<void> {
    this.renderSubmissionCard("💬 继续倾诉", ["我还想再聊聊"]);
    await this.deliver("咨询者想再倾诉一会儿,请继续倾听、交流或提问,先不要急着发牌或结束。", false);
  }

  /** 用户暂时就聊这么多:推进占卜(发牌→解读→报告) */
  async proceedToDivine(): Promise<void> {
    this.renderSubmissionCard("🔮 就聊这么多", ["开始占卜"]);
    await this.deliver("咨询者表示暂时就聊这么多,请继续推进本次占卜(尚未发牌则发牌,已解读完则生成报告)。", false);
  }

  /**
   * 提交问卷答卷：把用户的每个回答整理成文本喂给 Agent(不在聊天里渲染用户气泡),
   * 而是在聊天里显示一张紧凑的「问卷已提交」卡。
   */
  async submitSurvey(answers: { question: string; answer: string }[]): Promise<void> {
    const text =
      "咨询者已统一提交问卷,回答如下:\n" +
      answers.map((a, i) => `${i + 1}. ${a.question}\n   答:${a.answer}`).join("\n") +
      "\n请据此继续,按你的节奏推进(可先邀请 TA 自述,或在了解足够后发牌)。";
    this.renderSubmissionCard("📝 问卷已提交", answers.map((a) => a.answer));
    await this.deliver(text, false);
  }

  /**
   * 提交自述：把用户的自述内容喂给 Agent(作为心理分析依据),
   * 在聊天里显示紧凑的「自述已记录」卡。
   */
  async submitSelfNarration(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    this.renderSubmissionCard("💬 自述已记录", [clean]);
    await this.deliver(`咨询者已完成自述,内容如下:\n${clean}\n\n请结合问卷与自述继续,在你觉得了解足够后发牌。`, false);
  }

  /**
   * 提交盲选结果：把用户选定的 3 张牌(含牌义)告知 Agent,令其逐张解读,减少幻觉。
   */
  async submitSelection(cards: { nameCn: string; reversed: boolean; meaningCn: string }[]): Promise<void> {
    const text =
      "咨询者已从 78 张牌的扇形牌阵中盲选出以下 3 张(附牌义供参考,避免解读出错):\n" +
      cards
        .map((c, i) => `${i + 1}. ${c.nameCn}(${c.reversed ? "逆位" : "正位"})——${c.meaningCn}`)
        .join("\n") +
      "\n请从第 1 张开始,逐张调用 reveal_card 解读;每解读完一张就暂停,等咨询者回应或表示继续后再解读下一张。";
    this.renderSubmissionCard("🃏 已选定 3 张牌", cards.map((c) => `${c.nameCn}·${c.reversed ? "逆" : "正"}`));
    await this.deliver(text, false);
  }

  /** 把一段文本送入 Agent 驱动流程;asUser=true 时在聊天里渲染用户气泡 */
  private async deliver(text: string, asUser: boolean): Promise<void> {
    if (this.busy) return;
    if (!text.trim()) return;
    const agent = this.ensureAgent();
    if (!agent) return;

    if (asUser) this.appendUser(text);
    this.busy = true;
    this.cbs.onStatus?.("星语正在凝神……", "thinking");
    try {
      await this.runFlow(agent, text);
      if (!this.aborted) this.cbs.onStatus?.("静候你的提问", "idle");
    } catch (err) {
      if (!this.aborted && !isAbortError(err)) {
        this.cbs.onStatus?.(`出错：${err instanceof Error ? err.message : String(err)}`, "idle");
      }
    } finally {
      // abort 时 busy 已被 abort() 释放，这里不再碰 busy，避免冲掉新会话
      if (!this.aborted) this.busy = false;
      this.currentAssistantEl = null;
      this.aborted = false;
    }
  }

  // 驱动一次占卜流程：模型正常应连锁 ask_opening → ask_survey → draw_cards → reveal_card(×3) → mint_collectible。
  // 每个工具都 terminate,调用后即暂停等用户输入;若某轮以纯文字结束,则自动推它继续。
  private async runFlow(agent: Agent, initialText: string): Promise<void> {
    this.minted = false;
    let text = initialText;
    let autoContinue = 0;
    const MAX_AUTO = 3;
    while (true) {
      this.lastToolKind = null;
      this.streamErrored = false;
      await agent.prompt(text);
      if (this.minted) break; // 已铸造藏品,流程收尾
      if (this.lastToolKind) break; // 调用了终止型工具(开场题/问卷/发牌/逐张解读),等待用户下一步输入
      if (this.streamErrored) break;
      if (autoContinue >= MAX_AUTO) break;
      if (!this.lastToolKind) {
        // 本轮没调任何工具 → 自动推进,避免纯闲聊后停在半路
        autoContinue++;
        this.cbs.onStatus?.("星语正在继续……", "thinking");
        text =
          "请继续自然地推进本次占卜:按你的判断,与咨询者交流或调用合适的工具(了解诉求、发牌、逐张解读、生成报告等),不要停在这里只空转。";
      }
    }
  }

  private onAgentEvent(ev: AgentEvent): void {
    if (ev.type === "message_start" && ev.message.role === "assistant") {
      this.currentAssistantEl = this.appendOracle("");
      this.currentAssistantEl?.classList.add("streaming"); // 流式输出中:显示光标
      this.currentTitleEl = this.currentAssistantEl?.querySelector(".reply-title") ?? null;
      this.currentBodyEl = this.currentAssistantEl?.querySelector(".reply-body") ?? null;
      this.ttsSentLen = 0; // 新消息，重置 TTS 流式偏移
    } else if (ev.type === "message_update" && ev.message.role === "assistant") {
      const text = extractText(ev.message);
      const { title, body } = splitConcise(text);
      if (this.currentTitleEl) this.currentTitleEl.textContent = title;
      if (this.currentBodyEl) this.currentBodyEl.textContent = body;
      this.scroll();
      // 流式 TTS：只朗读精简结论(title)，等完整句子或攒够字数再发，避免切碎拼接
      if (title && title.length > this.ttsSentLen) {
        const delta = title.slice(this.ttsSentLen);
        // 优先等到句子结尾（。！？）
        const sentMatch = delta.match(/^(.+?[。！？])/);
        if (sentMatch) {
          this.cbs.onSpeak?.(sentMatch[1]);
          this.ttsSentLen += sentMatch[1].length;
        } else if (delta.length >= 20) {
          // 没句号但字数够了也发，避免等太久
          this.cbs.onSpeak?.(delta);
          this.ttsSentLen = title.length;
        }
      }
    } else if (ev.type === "message_end" && ev.message.role === "assistant") {
      this.currentAssistantEl?.classList.remove("streaming"); // 输出结束:收起光标
      const errMsg = (ev.message as { errorMessage?: string }).errorMessage;
      const stopReason = (ev.message as { stopReason?: string }).stopReason;
      if (errMsg || stopReason === "error") {
        // 用户主动打断不弹错误卡片（底层 fetch 流的 abort 异常）
        if (this.aborted || isAbortError({ message: errMsg })) {
          this.currentAssistantEl = null;
        } else {
          this.streamErrored = true;
          if (this.currentAssistantEl && !this.currentAssistantEl.textContent) this.currentAssistantEl.remove();
          const box = this.card("card-error");
          box.textContent = `出错：${errMsg ?? "请求失败，请检查 API Key / 地址 / 模型名称"}`;
          this.scroll();
        }
      } else if (this.currentAssistantEl) {
        const finalTitle = this.currentTitleEl?.textContent ?? "";
        const finalBody = this.currentBodyEl?.textContent ?? "";
        if (!finalTitle && !finalBody) {
          this.currentAssistantEl.remove(); // 只有工具调用、无文字 → 移除空气泡
        } else {
          // 发送流式途中没来得及发的剩余文字（不足 3 字不发了，避免孤立标点）
          const remaining = finalTitle.slice(this.ttsSentLen);
          if (remaining.length >= 3) this.cbs.onSpeak?.(remaining);
        }
      }
      this.currentAssistantEl = null;
      this.currentTitleEl = null;
      this.currentBodyEl = null;
    } else if (ev.type === "tool_execution_end") {
      const details = (ev as { result?: { details?: ToolDetails } }).result?.details;
      if (details) {
        this.lastToolKind = details.kind;
        if (details.kind === "mint") {
          this.minted = true;
          this.cbs.onMint?.('success');
        }
        this.renderToolResult(details);
      }
    }
  }

  // ===== 渲染：复用主项目 chat 气泡结构 =====
  private appendUser(text: string): void {
    this.chatLog.querySelector(".chat-empty")?.remove();
    const row = document.createElement("div");
    row.className = "msg msg-user";
    row.innerHTML = `<div class="bubble"></div>`;
    row.querySelector(".bubble")!.textContent = text;
    this.chatLog.append(row);
    this.scroll();
  }

  private appendOracle(_text: string): HTMLElement {
    this.chatLog.querySelector(".chat-empty")?.remove();
    const row = document.createElement("div");
    row.className = "msg msg-oracle";
    row.innerHTML = `<span class="msg-avatar" aria-hidden="true">✦</span><div class="bubble"><div class="reply-title"></div><div class="reply-body"></div></div>`;
    const bubble = row.querySelector<HTMLElement>(".bubble")!;
    this.chatLog.append(row);
    this.scroll();
    return bubble;
  }

  private card(cls: string): HTMLElement {
    this.chatLog.querySelector(".chat-empty")?.remove();
    const el = document.createElement("div");
    el.className = `tc-panel ${cls}`;
    this.chatLog.append(el);
    return el;
  }

  /** 问卷提交 / 选牌结果的紧凑确认卡(替代用户气泡,保持聊天整洁) */
  private renderSubmissionCard(title: string, chips: string[]): void {
    const card = this.card("card-submit");
    card.innerHTML = `<div class="tc-card-title">${esc(title)}</div>
      <div class="tc-submit-chips">${chips.map((c) => `<span class="tc-submit-chip">${esc(c)}</span>`).join("")}</div>`;
    this.scroll();
  }

  private renderToolResult(d: ToolDetails): void {
    if (d.kind === "opening") {
      // 单个开场题 + 选项交给主项目在中央水晶球上渲染(见 main.ts onOpening)
      this.cbs.onOpening?.(d);
      const card = this.card("card-questions");
      card.innerHTML = `<div class="tc-card-title">🔮 占卜前，星语想先了解你</div>
        <div class="tc-card-hint">请看向中央水晶球，点选一个选项，或直接输入你的回答。</div>`;
    } else if (d.kind === "survey") {
      // 个性化问卷交给主项目渲染表单(见 main.ts onSurvey)
      this.cbs.onSurvey?.(d);
      const card = this.card("card-questions");
      card.innerHTML = `<div class="tc-card-title">📋 星语为你准备了一份问卷</div>
        <div class="tc-card-hint">请看向中央水晶球，逐题作答后统一提交。</div>`;
    } else if (d.kind === "self_narration") {
      // 自述邀请交给主项目渲染自述环节(见 main.ts onSelfNarration)
      this.cbs.onSelfNarration?.(d);
      const card = this.card("card-questions");
      card.innerHTML = `<div class="tc-card-title">🔮 星语想听你多说一点</div>
        <div class="tc-card-hint">请看向中央水晶球，点击它，说出你近期的状况或此刻心中的想法。</div>`;
    } else if (d.kind === "draw") {
      // 78 张牌在中央水晶球区域背面朝上扇形展开,由用户盲选 3 张(见 main.ts onCardsDrawn)
      this.readingIndex = 0; // 新一轮选牌 → 重置逐张解读计数
      this.cbs.onCardsDrawn?.(d);
      const card = this.card("card-draw");
      card.innerHTML = `<div class="tc-card-title">🎴 牌阵「${esc(d.spread)}」</div>
        <div class="tc-card-hint">已为你展开 78 张牌（背面朝上），请盲选其中 3 张。</div>`;
    } else if (d.kind === "card_reading") {
      this.readingIndex += 1;
      const n = this.readingIndex;
      const card = this.card("card-reading");
      card.innerHTML = `<div class="tc-card-title">📖 第 ${n} 张牌解读</div>`;
      const line = document.createElement("div");
      line.className = "tc-reading-line";
      line.innerHTML = `<span class="tc-rl-name">${esc(d.nameCn)}（${d.reversed ? "逆位" : "正位"}）</span>${esc(d.text)}`;
      card.appendChild(line);
      const foot = document.createElement("div");
      foot.className = "tc-reading-foot";
      foot.innerHTML = `<button class="tc-continue" type="button">继续 ▶</button>
        <div class="tc-continue-hint">也可以直接输入你的感受，星语会结合它继续。</div>`;
      card.appendChild(foot);
      card.querySelector<HTMLButtonElement>(".tc-continue")!.addEventListener("click", () => {
        this.cbs.onContinue?.();
      });
      this.cbs.onSpeak?.(d.text);
    } else if (d.kind === "report") {
      // 专属报告交给主项目渲染富文本报告卡(见 main.ts onReport)
      this.cbs.onReport?.(d);
      const card = this.card("card-report");
      card.innerHTML = `<div class="tc-card-title">📜 星语已为你生成专属报告</div>
        <div class="tc-card-hint">请看向中央水晶球，查看你的专属报告并分享。</div>`;
    } else if (d.kind === "mint") {
      this.cbs.onMintCard?.(d);
      this.renderMintCard(d);
    }
    this.scroll();
  }

  /**
   * 铸造卡片:展示占卜结尾的纪念藏品卡(纯本地展示,无链上动作),
   * 并自动存入「能量档案」。
   */
  private renderMintCard(d: MintDetails): void {
    saveTarotCard({ name: d.name, rarity: d.rarity, motif: d.motif, serial: d.serial, tokenId: d.tokenId });
    const card = this.card(`card-mint rarity-${rarityKey(d.rarity)}`);
    card.innerHTML = `
      <div class="tc-mint-badge">${esc(d.rarity)}</div>
      <div class="tc-mint-glyph">✨</div>
      <div class="tc-mint-name">${esc(d.name)}</div>
      <div class="tc-mint-motif">${esc(d.motif)}</div>
      <div class="tc-mint-meta"><span>编号 ${esc(d.serial)}</span><span>${esc(d.tokenId)}</span></div>
      <div class="tc-mint-foot">🎁 星语为你准备了一枚纪念藏品</div>
      <div class="tc-mint-status" style="color:#8fd8b8">✦ 已存入能量档案</div>`;
    this.scroll();
  }

  private scroll(): void {
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }
}

const DETAIL_MARKER = "[[详细]]";

/** 把流式文本按 [[详细]] 分隔符拆成精简结论(title)与详细解读(body)。 */
function splitConcise(text: string): { title: string; body: string } {
  const idx = text.indexOf(DETAIL_MARKER);
  if (idx === -1) return { title: text.trim(), body: "" };
  return {
    title: text.slice(0, idx).trim(),
    body: text.slice(idx + DETAIL_MARKER.length).trim(),
  };
}

function extractText(message: { content: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  }
  return "";
}

function rarityKey(r: string): string {
  return ({ 普通: "common", 稀有: "rare", 史诗: "epic", 传说: "legendary" } as Record<string, string>)[r] ?? "common";
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/** 判断错误是否是用户主动打断导致（Chrome 的 AbortError name 可能是 'TypeError'，message 也因浏览器而异） */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'AbortError' || /aborted|BodyStreamBuffer/i.test(e.message ?? '');
}

let styleInjected = false;
function ensureStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  .tc-panel{margin:10px 0;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.05);
    border:1px solid rgba(198,129,241,.2);color:#e7dfff;font-size:13.5px;line-height:1.6;
    animation:tcRise .4s cubic-bezier(.2,.8,.2,1) both}
  @keyframes tcRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .tc-card-title{font-size:15px;font-weight:600;margin-bottom:6px}
  .tc-card-sub{font-size:12px;color:#a99cc9;margin-bottom:8px}
  .tc-card-hint{font-size:12px;color:#a99cc9;margin-top:10px}
  .tc-q-item{margin:8px 0}
  .tc-q-text{margin-bottom:6px}
  .tc-q-options{display:flex;flex-wrap:wrap;gap:6px}
  .tc-q-chip{padding:5px 11px;border-radius:999px;border:1px solid rgba(198,129,241,.35);
    background:rgba(198,129,241,.08);color:#d7cdf3;font-size:12px;cursor:pointer;font-family:inherit}
  .tc-q-chip:hover{background:rgba(198,129,241,.2)}
  .tc-cards-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
  .tc-tarot-card{flex:1;min-width:92px;padding:12px 8px;border-radius:12px;text-align:center;
    background:linear-gradient(160deg,#2a1550,#1a0e34);border:1px solid rgba(198,129,241,.25);
    animation:tcRise .5s both}
  .tc-tarot-card.reversed .tc-glyph{transform:rotate(180deg)}
  .tc-glyph{font-size:26px}
  .tc-cn{font-weight:600;margin-top:4px}
  .tc-pos{font-size:11px;color:#c084fc;margin:2px 0}
  .tc-mean{font-size:11.5px;color:#b3a7d1;line-height:1.5}
  .tc-reading-line{margin:6px 0}
  .tc-rl-name{color:#c084fc;font-weight:600;margin-right:6px}
  .tc-reading-overall{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);color:#f0eaff}
  .tc-reading-foot{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}
  .tc-continue{padding:8px 16px;border-radius:12px;border:0;cursor:pointer;font-size:12.5px;font-weight:700;font-family:inherit;color:#fff;background:linear-gradient(135deg,#8b5cf6,#c084fc);transition:filter .2s,transform .1s}
  .tc-continue:hover{filter:brightness(1.1)}
  .tc-continue:active{transform:scale(.97)}
  .tc-continue-hint{margin-top:6px;font-size:11px;color:#a99cc9}
  .tc-submit-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .tc-submit-chip{padding:4px 11px;border-radius:999px;border:1px solid rgba(198,129,241,.35);background:rgba(198,129,241,.1);color:#d7cdf3;font-size:11.5px}
  .tc-panel.card-mint{text-align:center;background:linear-gradient(160deg,#2e1550,#1a0b38)}
  .tc-mint-badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:11px;
    background:rgba(240,200,80,.16);color:#f6c90e;margin-bottom:8px}
  .tc-mint-glyph{font-size:34px}
  .tc-mint-name{font-size:17px;font-weight:700;margin:4px 0}
  .tc-mint-motif{font-size:12.5px;color:#b3a7d1}
  .tc-mint-meta{display:flex;justify-content:center;gap:14px;font-size:11px;color:#8a7fa6;margin-top:8px}
  .tc-mint-foot{margin-top:8px;font-size:12px;color:#c084fc}
  .tc-mint-chain{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}
  .tc-mint-btn{width:100%;padding:11px 0;border-radius:12px;border:0;cursor:pointer;
    font-size:13.5px;font-weight:700;font-family:inherit;color:#fff;
    background:linear-gradient(135deg,#8b5cf6,#c084fc);transition:filter .2s,transform .1s}
  .tc-mint-btn:hover:not(:disabled){filter:brightness(1.1)}
  .tc-mint-btn:active:not(:disabled){transform:scale(.98)}
  .tc-mint-btn:disabled{cursor:not-allowed;opacity:.6}
  .tc-mint-status{margin-top:9px;font-size:11.5px;color:#a99cc9;line-height:1.5}
  .tc-mint-ok{color:#7ee0b8;font-size:12.5px;font-weight:600}
  .tc-mint-links{display:flex;justify-content:center;gap:16px;margin-top:8px}
  .tc-mint-links a,.tc-mint-link-btn{color:#c4b5fd;font-size:12px;font-weight:700;
    background:none;border:0;cursor:pointer;font-family:inherit;padding:0}
  .tc-mint-links a:hover,.tc-mint-link-btn:hover{color:#e9d5ff}
  .tc-panel.card-error{border-color:rgba(233,69,96,.4);color:#ffb3c0}
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}
