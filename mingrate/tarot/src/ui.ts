import type { AgentEvent } from "@earendil-works/pi-agent-core/types";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createTarotAgent, DEFAULT_MODEL_ID, DEFAULT_BASE_URL } from "./agent-setup";
import type { DrawDetails, MintDetails, QuestionsDetails, ReadingDetails } from "./tools";

type ToolDetails = QuestionsDetails | DrawDetails | ReadingDetails | MintDetails;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const KEY_STORE = "tarot.apiKey";
const MODEL_STORE = "tarot.modelId";
const BASE_URL_STORE = "tarot.baseUrl";

const majorArcanaGlyph = (nameCn: string): string => {
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

export class TarotUI {
  private agent: Agent | null = null;
  private messagesEl = $("#messages");
  private inputEl = $<HTMLTextAreaElement>("#chat-input");
  private sendBtn = $<HTMLButtonElement>("#send-btn");
  private apiKeyEl = $<HTMLInputElement>("#api-key");
  private baseUrlEl = $<HTMLInputElement>("#base-url");
  private modelEl = $<HTMLInputElement>("#model-id");
  private saveBtn = $<HTMLButtonElement>("#save-key");
  private statusEl = $("#status");
  private currentAssistantEl: HTMLElement | null = null;
  private busy = false;
  // 自动续跑安全网:追踪本轮流程状态,当模型只回复文字却没调用工具时自动推进
  private minted = false;
  private streamErrored = false;
  private lastToolKind: string | null = null;

  init(): void {
    this.apiKeyEl.value = localStorage.getItem(KEY_STORE) ?? "";
    this.baseUrlEl.value = localStorage.getItem(BASE_URL_STORE) ?? DEFAULT_BASE_URL;
    this.modelEl.value = localStorage.getItem(MODEL_STORE) ?? DEFAULT_MODEL_ID;

    this.saveBtn.addEventListener("click", () => {
      localStorage.setItem(KEY_STORE, this.apiKeyEl.value.trim());
      localStorage.setItem(BASE_URL_STORE, this.baseUrlEl.value.trim() || DEFAULT_BASE_URL);
      localStorage.setItem(MODEL_STORE, this.modelEl.value.trim() || DEFAULT_MODEL_ID);
      this.agent = null; // 重新装配
      this.setStatus("已保存。开始你的占卜吧。");
    });

    this.sendBtn.addEventListener("click", () => this.onSend());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.onSend();
      }
    });
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private ensureAgent(): Agent | null {
    if (this.agent) return this.agent;
    const apiKey = this.apiKeyEl.value.trim();
    if (!apiKey) {
      this.setStatus("请先在上方填入 Anthropic API Key。");
      return null;
    }
    try {
      this.agent = createTarotAgent({
        apiKey,
        baseUrl: this.baseUrlEl.value.trim() || DEFAULT_BASE_URL,
        modelId: this.modelEl.value.trim() || DEFAULT_MODEL_ID,
      });
      this.agent.subscribe((ev) => this.onAgentEvent(ev));
    } catch (err) {
      this.setStatus(`装配失败:${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    return this.agent;
  }

  private async onSend(): Promise<void> {
    if (this.busy) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    const agent = this.ensureAgent();
    if (!agent) return;

    this.inputEl.value = "";
    this.addBubble("user", text);
    this.busy = true;
    this.sendBtn.disabled = true;
    this.setStatus("星语正在凝神……");
    try {
      await this.runFlow(agent, text);
      this.setStatus("");
    } catch (err) {
      this.setStatus(`出错:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
      this.sendBtn.disabled = false;
      this.currentAssistantEl = null;
    }
  }

  // 驱动一次占卜流程:模型正常应连锁调用 draw_cards → reveal_reading → mint_collectible。
  // 若某轮以纯文字结束(没调用工具)且流程未走完,自动推它继续,直到铸造藏品或需要等待用户回答。
  private async runFlow(agent: Agent, initialText: string): Promise<void> {
    this.minted = false;
    let text = initialText;
    let autoContinue = 0;
    const MAX_AUTO = 3;
    while (true) {
      this.lastToolKind = null;
      this.streamErrored = false;
      await agent.prompt(text);
      if (this.minted) break; // 占卜完成
      if (this.lastToolKind === "questions") break; // 已展示问题,等待用户回答
      if (this.streamErrored) break; // 出错,错误面板已呈现,勿反复重试
      if (autoContinue >= MAX_AUTO) break; // 防止死循环
      autoContinue++;
      this.setStatus("星语正在继续……");
      text =
        "请继续本次占卜的下一步:若尚未抽牌请立即调用 draw_cards;若已抽牌请调用 reveal_reading;若已解读请调用 mint_collectible。只调用工具,不要只回复文字。";
    }
  }

  private onAgentEvent(ev: AgentEvent): void {
    if (ev.type === "message_start" && ev.message.role === "assistant") {
      this.currentAssistantEl = this.addBubble("assistant", "");
    } else if (ev.type === "message_update" && ev.message.role === "assistant") {
      const text = this.extractText(ev.message);
      if (this.currentAssistantEl) this.currentAssistantEl.textContent = text;
      this.scroll();
    } else if (ev.type === "message_end" && ev.message.role === "assistant") {
      // 流内错误不会抛异常,而是以 stopReason/errorMessage 形式返回,需显式呈现
      const errMsg = (ev.message as { errorMessage?: string; stopReason?: string }).errorMessage;
      const stopReason = (ev.message as { stopReason?: string }).stopReason;
      if (errMsg || stopReason === "error") {
        this.streamErrored = true;
        if (this.currentAssistantEl && !this.currentAssistantEl.textContent) this.currentAssistantEl.remove();
        const box = this.card("card-error");
        box.textContent = `出错:${errMsg ?? "请求失败,请检查 API Key / 地址 / 模型名称"}`;
        this.scroll();
      } else if (this.currentAssistantEl && !this.currentAssistantEl.textContent) {
        // 若助手消息没有文本(只有工具调用),移除空气泡
        this.currentAssistantEl.remove();
      }
      this.currentAssistantEl = null;
    } else if (ev.type === "tool_execution_end") {
      const details = ev.result?.details as ToolDetails | undefined;
      if (details) {
        this.lastToolKind = details.kind;
        if (details.kind === "mint") this.minted = true;
        this.renderToolResult(details);
      }
    }
  }

  private extractText(message: { content: unknown }): string {
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

  private renderToolResult(d: ToolDetails): void {
    if (d.kind === "questions") {
      const card = this.card("card-questions");
      card.innerHTML = `<div class="card-title">🔮 占卜前,星语想先了解你</div>`;
      // 记录每个问题当前选中的选项,点选后据此重组输入框内容(仍可自由编辑)
      const answers = new Map<number, string>();
      const composeInput = (): void => {
        const lines: string[] = [];
        d.questions.forEach((q, i) => {
          const a = answers.get(i);
          if (a) lines.push(`${q.text} —— ${a}`);
        });
        this.inputEl.value = lines.join("\n");
        this.inputEl.focus();
      };
      const list = document.createElement("div");
      list.className = "q-list";
      d.questions.forEach((q, i) => {
        const item = document.createElement("div");
        item.className = "q-item";
        const qtext = document.createElement("div");
        qtext.className = "q-text";
        qtext.textContent = `${i + 1}. ${q.text}`;
        item.appendChild(qtext);
        if (q.options?.length) {
          const opts = document.createElement("div");
          opts.className = "q-options";
          q.options.forEach((opt) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "q-chip";
            chip.textContent = opt;
            chip.addEventListener("click", () => {
              const isActive = answers.get(i) === opt;
              // 同一问题内单选:清除同组其它 active,再切换本项
              opts.querySelectorAll(".q-chip").forEach((c) => c.classList.remove("active"));
              if (isActive) {
                answers.delete(i);
              } else {
                answers.set(i, opt);
                chip.classList.add("active");
              }
              composeInput();
            });
            opts.appendChild(chip);
          });
          item.appendChild(opts);
        }
        list.appendChild(item);
      });
      card.appendChild(list);
      const hint = document.createElement("div");
      hint.className = "card-hint";
      hint.textContent = "点选下方选项快速作答,或直接在输入框补充,发送即可继续。";
      card.appendChild(hint);
    } else if (d.kind === "draw") {
      const card = this.card("card-draw");
      card.innerHTML = `<div class="card-title">🎴 牌阵「${this.esc(d.spread)}」</div>
        <div class="card-sub">聚焦:${this.esc(d.question)}</div>`;
      const row = document.createElement("div");
      row.className = "cards-row";
      d.cards.forEach((c, i) => {
        const el = document.createElement("div");
        el.className = `tarot-card${c.reversed ? " reversed" : ""}`;
        el.style.animationDelay = `${i * 120}ms`;
        el.innerHTML = `
          <div class="glyph">${majorArcanaGlyph(c.nameCn)}</div>
          <div class="cn">${this.esc(c.nameCn)}</div>
          <div class="pos">${c.reversed ? "逆位" : "正位"}</div>
          <div class="mean">${this.esc(c.meaningCn)}</div>`;
        row.appendChild(el);
      });
      card.appendChild(row);
    } else if (d.kind === "reading") {
      const card = this.card("card-reading");
      card.innerHTML = `<div class="card-title">📖 解读</div>`;
      for (const p of d.perCard) {
        const line = document.createElement("div");
        line.className = "reading-line";
        line.innerHTML = `<span class="rl-name">${this.esc(p.nameCn)}(${p.reversed ? "逆位" : "正位"})</span>${this.esc(p.text)}`;
        card.appendChild(line);
      }
      const overall = document.createElement("div");
      overall.className = "reading-overall";
      overall.textContent = d.overall;
      card.appendChild(overall);
    } else if (d.kind === "mint") {
      const card = this.card(`card-mint rarity-${this.rarityKey(d.rarity)}`);
      card.innerHTML = `
        <div class="mint-badge">${this.esc(d.rarity)}</div>
        <div class="mint-glyph">✨</div>
        <div class="mint-name">${this.esc(d.name)}</div>
        <div class="mint-motif">${this.esc(d.motif)}</div>
        <div class="mint-meta"><span>编号 ${this.esc(d.serial)}</span><span>${this.esc(d.tokenId)}</span></div>
        <div class="mint-foot">🎁 你获得了一枚数字藏品</div>`;
    }
    this.scroll();
  }

  private rarityKey(r: string): string {
    return { 普通: "common", 稀有: "rare", 史诗: "epic", 传说: "legendary" }[r] ?? "common";
  }

  private addBubble(role: "user" | "assistant", text: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = `bubble ${role}`;
    wrap.textContent = text;
    this.messagesEl.appendChild(wrap);
    this.scroll();
    return wrap;
  }

  private card(cls: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `panel ${cls}`;
    this.messagesEl.appendChild(el);
    return el;
  }

  private esc(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  private scroll(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
