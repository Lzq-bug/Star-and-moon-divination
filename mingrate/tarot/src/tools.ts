import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core/types";
import { drawCards, type DrawnCard } from "./deck";

// 工具返回的 details 结构,供 UI 通过 tool_execution_end 事件渲染
export interface DrawDetails {
  kind: "draw";
  spread: string;
  question: string;
  cards: { name: string; nameCn: string; reversed: boolean; meaningCn: string }[];
}
export interface QuestionsDetails {
  kind: "questions";
  questions: { text: string; options?: string[] }[];
}
export interface ReadingDetails {
  kind: "reading";
  overall: string;
  perCard: { nameCn: string; reversed: boolean; text: string }[];
}
export interface MintDetails {
  kind: "mint";
  name: string;
  rarity: string;
  motif: string;
  serial: string;
  tokenId: string;
}

function serialFromSeed(seed: string): { serial: string; tokenId: string } {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
  const serial = `#${(h >>> 0) % 10000}`.padEnd(5, "0");
  return { serial, tokenId: `TARO-${hex}` };
}

// 1. 提问:展示问题并让 agent 停下等待用户回答(terminate)
const askIntakeParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      text: Type.String({ description: "一个开放式问题" }),
      options: Type.Optional(
        Type.Array(Type.String({ description: "一个备选答案,供咨询者点选" }), {
          minItems: 2,
          maxItems: 4,
          description: "该问题的 2-4 个代表性备选项;咨询者可点选,也可自由补充。可省略。",
        }),
      ),
    }),
    {
      minItems: 2,
      maxItems: 4,
      description: "要向咨询者提出的问题列表",
    },
  ),
});
export const askIntakeQuestions: AgentTool<typeof askIntakeParams, QuestionsDetails> = {
  name: "ask_intake_questions",
  label: "提问",
  description:
    "在正式占卜前,向咨询者提出 2-4 个开放式问题以了解其处境(如关注领域、当前心境、希望得到的指引)。可为每个问题附带 2-4 个备选项供咨询者点选。调用后会把问题展示给用户,并暂停等待用户回答。每次占卜流程只应调用一次。",
  parameters: askIntakeParams,
  execute: async (_id, params) => {
    const details: QuestionsDetails = { kind: "questions", questions: params.questions };
    return {
      content: [
        {
          type: "text",
          text: `已向咨询者展示以下问题,请等待其回答:\n${params.questions
            .map((q, i) => `${i + 1}. ${q.text}${q.options?.length ? `(备选:${q.options.join(" / ")})` : ""}`)
            .join("\n")}`,
        },
      ],
      details,
      terminate: true, // 停止本轮,等待用户输入答案
    };
  },
};

// 2. 抽卡
const drawCardsParams = Type.Object({
  count: Type.Integer({ minimum: 1, maximum: 10, description: "抽取的牌数,常用 1/3/5" }),
  spread: Type.String({ description: "牌阵名称,如 单张指引 / 三张(过去-现在-未来) / 凯尔特十字" }),
  question: Type.String({ description: "本次占卜聚焦的核心问题(用你的话概括)" }),
});
export const drawCardsTool: AgentTool<typeof drawCardsParams, DrawDetails> = {
  name: "draw_cards",
  label: "抽卡",
  description:
    "为咨询者从 78 张莱德-韦特塔罗牌中随机抽取指定数量的牌(含正逆位)。仅在已了解咨询者问题后调用。返回的牌面与牌义供你随后进行解读。",
  parameters: drawCardsParams,
  execute: async (_id, params) => {
    const drawn: DrawnCard[] = drawCards(params.count);
    const cards = drawn.map((d) => ({
      name: d.card.name,
      nameCn: d.card.nameCn,
      reversed: d.reversed,
      meaningCn: d.reversed ? d.card.reversedCn : d.card.uprightCn,
    }));
    const details: DrawDetails = { kind: "draw", spread: params.spread, question: params.question, cards };
    const lines = cards.map(
      (c, i) => `${i + 1}. ${c.nameCn}(${c.reversed ? "逆位" : "正位"})— ${c.meaningCn}`,
    );
    return {
      content: [
        {
          type: "text",
          text: `牌阵「${params.spread}」抽牌结果:\n${lines.join("\n")}\n\n请结合咨询者的问题逐张解读,再给出整体指引,最后调用 reveal_reading 呈现结构化解读。`,
        },
      ],
      details,
    };
  },
};

// 3. 解读(结构化呈现)
const revealReadingParams = Type.Object({
  overall: Type.String({ description: "结合所有牌与咨询者问题的整体指引(2-4 句)" }),
  perCard: Type.Array(
    Type.Object({
      nameCn: Type.String({ description: "牌名(中文)" }),
      reversed: Type.Boolean({ description: "是否逆位" }),
      text: Type.String({ description: "该牌在此情境下的解读(1-3 句)" }),
    }),
    { description: "逐张牌的解读" },
  ),
});
export const revealReadingTool: AgentTool<typeof revealReadingParams, ReadingDetails> = {
  name: "reveal_reading",
  label: "解读",
  description:
    "在抽牌后,以结构化方式呈现你的解读:每张牌的含义 + 一段整体指引。调用此工具会在界面上渲染精美的解读面板。抽牌后必须调用一次。",
  parameters: revealReadingParams,
  execute: async (_id, params) => {
    const details: ReadingDetails = { kind: "reading", overall: params.overall, perCard: params.perCard };
    return {
      content: [{ type: "text", text: "解读面板已呈现给咨询者。现在请调用 mint_collectible 赠予其一枚纪念数字藏品作为结尾。" }],
      details,
    };
  },
};

// 4. 数字藏品(结尾自动触发,terminate 由 afterToolCall 处理)
const mintParams = Type.Object({
  name: Type.String({ description: "藏品名称,呼应本次占卜主题" }),
  rarity: Type.Union(
    [Type.Literal("普通"), Type.Literal("稀有"), Type.Literal("史诗"), Type.Literal("传说")],
    { description: "稀有度" },
  ),
  motif: Type.String({ description: "藏品的视觉/象征意象描述(1 句)" }),
});
export const mintCollectibleTool: AgentTool<typeof mintParams, MintDetails> = {
  name: "mint_collectible",
  label: "数字藏品",
  description:
    "占卜结尾,为咨询者铸造一枚专属纪念数字藏品。根据本次占卜的主题命名并赋予寓意与稀有度。这是整个占卜流程的最后一步,必须在解读之后调用。",
  parameters: mintParams,
  execute: async (_id, params) => {
    const { serial, tokenId } = serialFromSeed(`${params.name}|${params.motif}|${Date.now()}`);
    const details: MintDetails = {
      kind: "mint",
      name: params.name,
      rarity: params.rarity,
      motif: params.motif,
      serial,
      tokenId,
    };
    return {
      content: [{ type: "text", text: `已为咨询者铸造数字藏品「${params.name}」(${params.rarity},编号 ${tokenId})。` }],
      details,
      terminate: true,
    };
  },
};

export const TAROT_TOOLS: AgentTool<any, any>[] = [
  askIntakeQuestions,
  drawCardsTool,
  revealReadingTool,
  mintCollectibleTool,
];
