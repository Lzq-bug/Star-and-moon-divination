/**
 * tool-confirm.ts — 工具调用确认弹窗
 *
 * 接到 Agent 的 beforeToolCall 钩子：每次工具执行前弹出模态框，
 * 显示工具名 + 参数摘要，用户「同意」放行、「拒绝退出」则 block 该工具。
 *
 * 用法：
 *   beforeToolCall: async ({ toolCall, args }, signal) => {
 *     const ok = await confirmToolCall(toolCall.name, args, signal);
 *     return ok ? undefined : { block: true, reason: "用户拒绝了此操作" };
 *   }
 */

// 工具名 → 中文标签 + 图标
const TOOL_META: Record<string, { label: string; icon: string; verb: string }> = {
  ask_opening: { label: "开场提问", icon: "🔮", verb: "提出一个开场问题" },
  ask_survey: { label: "问卷", icon: "📋", verb: "准备一份个性化问卷" },
  draw_cards: { label: "发牌", icon: "🎴", verb: "为你发出六张塔罗牌" },
  reveal_card: { label: "逐张解读", icon: "📖", verb: "解读一张牌" },
  mint_collectible: { label: "数字藏品", icon: "✨", verb: "铸造纪念数字藏品" },
};

/** 把工具参数渲染成人类可读的摘要行 */
function summarizeArgs(toolName: string, args: unknown): string[] {
  const a = (args ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  switch (toolName) {
    case "ask_opening": {
      const q = (a.question ?? {}) as { text?: string };
      if (q.text) lines.push(q.text);
      break;
    }
    case "ask_survey": {
      const qs = Array.isArray(a.questions) ? a.questions : [];
      lines.push(`共 ${qs.length} 个问题`);
      qs.slice(0, 4).forEach((q: any, i: number) => lines.push(`${i + 1}. ${q?.text ?? ""}`));
      break;
    }
    case "draw_cards": {
      lines.push(`牌阵：${a.spread ?? "—"}`);
      if (a.question) lines.push(`聚焦：${a.question}`);
      break;
    }
    case "reveal_card": {
      lines.push(`牌：${a.nameCn ?? "—"}（${a.reversed ? "逆位" : "正位"}）`);
      break;
    }
    case "mint_collectible": {
      lines.push(`名称：${a.name ?? "—"}`);
      lines.push(`稀有度：${a.rarity ?? "—"}`);
      if (a.motif) lines.push(`意象：${a.motif}`);
      break;
    }
    default:
      lines.push(JSON.stringify(a).slice(0, 200));
  }
  return lines;
}

let styleInjected = false;
function ensureStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  .tc-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
    background:rgba(10,4,26,.62);backdrop-filter:blur(6px);opacity:0;transition:opacity .28s ease}
  .tc-mask.tc-show{opacity:1}
  .tc-modal{width:min(92vw,420px);border-radius:20px;padding:26px 24px 22px;
    background:linear-gradient(160deg,#241246,#160a2e);border:1px solid rgba(198,129,241,.28);
    box-shadow:0 24px 80px rgba(0,0,0,.5),0 0 40px rgba(140,90,240,.18) inset;
    color:#ede7ff;font-family:'Noto Sans SC',system-ui,sans-serif;transform:translateY(14px) scale(.97);
    transition:transform .3s cubic-bezier(.2,.8,.2,1)}
  .tc-mask.tc-show .tc-modal{transform:translateY(0) scale(1)}
  .tc-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .tc-icon{font-size:30px;line-height:1}
  .tc-title{font-size:17px;font-weight:600;letter-spacing:.02em}
  .tc-sub{font-size:12.5px;color:#a99cc9;margin-top:2px}
  .tc-body{background:rgba(255,255,255,.04);border-radius:12px;padding:12px 14px;margin-bottom:18px;
    font-size:13.5px;line-height:1.7;color:#d7cdf3;max-height:40vh;overflow:auto}
  .tc-body div{white-space:pre-wrap;word-break:break-word}
  .tc-actions{display:flex;gap:12px}
  .tc-btn{flex:1;padding:11px 0;border-radius:12px;border:0;cursor:pointer;font-size:14px;font-weight:600;
    font-family:inherit;transition:filter .2s,transform .1s}
  .tc-btn:active{transform:scale(.97)}
  .tc-ok{background:linear-gradient(135deg,#8b5cf6,#c084fc);color:#fff}
  .tc-ok:hover{filter:brightness(1.1)}
  .tc-no{background:rgba(255,255,255,.08);color:#c9bfe6}
  .tc-no:hover{filter:brightness(1.2)}
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * 弹出确认框。resolve(true)=同意放行，resolve(false)=拒绝退出。
 * signal 被 abort 时自动视为拒绝并关闭。
 */
export function confirmToolCall(
  toolName: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<boolean> {
  ensureStyle();
  const meta = TOOL_META[toolName] ?? { label: toolName, icon: "🛠️", verb: `执行 ${toolName}` };
  const lines = summarizeArgs(toolName, args);

  return new Promise<boolean>((resolve) => {
    const mask = document.createElement("div");
    mask.className = "tc-mask";
    mask.innerHTML = `
      <div class="tc-modal" role="dialog" aria-modal="true">
        <div class="tc-head">
          <span class="tc-icon">${meta.icon}</span>
          <div>
            <div class="tc-title">星语想${meta.verb}</div>
            <div class="tc-sub">工具调用 · ${meta.label}</div>
          </div>
        </div>
        <div class="tc-body">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>
        <div class="tc-actions">
          <button class="tc-btn tc-no" type="button">拒绝退出</button>
          <button class="tc-btn tc-ok" type="button">同意</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    requestAnimationFrame(() => mask.classList.add("tc-show"));

    let settled = false;
    const close = (result: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      mask.classList.remove("tc-show");
      setTimeout(() => mask.remove(), 280);
      resolve(result);
    };
    const onAbort = () => close(false);
    signal?.addEventListener("abort", onAbort, { once: true });

    mask.querySelector<HTMLButtonElement>(".tc-ok")!.addEventListener("click", () => close(true));
    mask.querySelector<HTMLButtonElement>(".tc-no")!.addEventListener("click", () => close(false));
    // 点遮罩空白处 = 拒绝
    mask.addEventListener("click", (e) => {
      if (e.target === mask) close(false);
    });
  });
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
