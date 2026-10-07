import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// 工具返回的 details 结构,供 UI 通过 tool_execution_end 事件渲染
export interface DrawDetails {
  kind: "draw";
  spread: string;
  question: string;
  cards: { name: string; nameCn: string; reversed: boolean; meaningCn: string }[];
}
export interface OpeningDetails {
  kind: "opening";
  question: { text: string; options?: string[] };
}
export interface SurveyQuestion {
  text: string;
  type: "choice" | "text" | "scale";
  options?: string[];
}
export interface SurveyDetails {
  kind: "survey";
  questions: SurveyQuestion[];
}
export interface SelfNarrationDetails {
  kind: "self_narration";
  prompt: string;
}
export interface CardReadingDetails {
  kind: "card_reading";
  nameCn: string;
  reversed: boolean;
  text: string;
}
export interface ReportCard {
  nameCn: string;
  reversed: boolean;
  text: string;
}
export interface ReportDetails {
  kind: "report";
  title: string;
  summary: string;
  context: string;
  cards: ReportCard[];
  advice: string;
  /** 散心方案:基于咨询者所在地区与天气给出的具体散心/打卡建议 */
  relax: string;
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

// 1. 开场题:单个定制问题,答完后据此生成个性化问卷
const openingParams = Type.Object({
  question: Type.Object({
    text: Type.String({ description: "一个开场问题,须基于咨询者一开始的诉求定制" }),
    options: Type.Optional(
      Type.Array(Type.String({ description: "一个备选答案,供咨询者点选" }), {
        minItems: 2,
        maxItems: 4,
        description: "该问题的 2-4 个代表性备选项;咨询者可点选,也可自由补充。",
      }),
    ),
  }),
});
export const askOpeningTool: AgentTool<typeof openingParams, OpeningDetails> = {
  name: "ask_opening",
  label: "开场提问",
  description:
    "欢迎咨询者后,提出 1 个开场问题以快速了解其处境。问题必须贴合咨询者一开始的诉求,不要套用模板;尽量附 2-4 个备选项供点选。调用后暂停,等待咨询者回答;整个流程只调用一次。",
  parameters: openingParams,
  execute: async (_id, params) => {
    const details: OpeningDetails = { kind: "opening", question: params.question };
    return {
      content: [
        {
          type: "text",
          text: `已向咨询者提出开场问题:${params.question.text}${params.question.options?.length ? `(备选:${params.question.options.join(" / ")})` : ""}\n请等待其回答。`,
        },
      ],
      details,
      terminate: true, // 停止本轮,等待用户回答开场题
    };
  },
};

// 2. 个性化问卷:根据开场题答案生成 3-6 个问题(选择 + 填空混合)
const surveyParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      text: Type.String({ description: "一个问卷问题" }),
      type: Type.Union(
        [Type.Literal("choice"), Type.Literal("text"), Type.Literal("scale")],
        {
          description:
            "choice=选择题(须附 options);text=填空题(供自由填写,不要附 options);scale=程度分级题(1-5 分量表,可附 5 档文案作为 options,缺省则前端显示 1-5 数字)",
        },
      ),
      options: Type.Optional(
        Type.Array(Type.String({ description: "一个备选答案或一档程度文案" }), {
          minItems: 2,
          maxItems: 5,
          description: "choice 题的 2-5 个备选项;scale 题可附 1-5 档程度文案(由轻到重);text 题请省略此项",
        }),
      ),
    }),
    {
      minItems: 3,
      maxItems: 6,
      description: "个性化问卷的问题列表",
    },
  ),
});
export const askSurveyTool: AgentTool<typeof surveyParams, SurveyDetails> = {
  name: "ask_survey",
  label: "问卷",
  description:
    "根据咨询者的开场题答案,生成一份 3-6 题的个性化问卷。问题要创新、贴合其具体处境,避免通用套话;选择题、填空题、程度分级题(scale,1-5 分量表)混合使用。可加入地点、天气、时间、所处场景等环境题,也可让用户为其情绪/处境打分。调用后会把整份问卷一次性展示给咨询者,并暂停等待其统一提交;每题允许跳过,底部可重新生成问卷。每次占卜流程只调用一次(用户要求重新出题时除外)。",
  parameters: surveyParams,
  execute: async (_id, params) => {
    const details: SurveyDetails = { kind: "survey", questions: params.questions };
    const typeLabel = (t: string) => (t === "choice" ? "选择" : t === "scale" ? "分级" : "填空");
    return {
      content: [
        {
          type: "text",
          text: `已向咨询者展示个性化问卷:\n${params.questions
            .map((q, i) => `${i + 1}. [${typeLabel(q.type)}] ${q.text}${q.options?.length ? `(备选:${q.options.join(" / ")})` : ""}`)
            .join("\n")}\n\n请等待其提交答卷(可能包含跳过项)。`,
        },
      ],
      details,
      terminate: true, // 停止本轮,等待用户统一提交问卷
    };
  },
};

// 2.5 自述:问卷之后邀请用户点击水晶球,自由说出近期状况或此刻想法
const selfNarrationParams = Type.Object({
  prompt: Type.String({ description: "自述邀请语,引导用户说出近期状况或此刻心中的想法(结合问卷答案定制)" }),
});
export const askSelfNarrationTool: AgentTool<typeof selfNarrationParams, SelfNarrationDetails> = {
  name: "ask_self_narration",
  label: "自述邀请",
  description:
    "问卷提交后,邀请咨询者点击水晶球自述(语音或文字):可以讲近期的状况,也可以讲此刻心中的想法。结合问卷答案定制邀请语,让用户放松、自由表达。调用后暂停,等待用户提交自述;自述内容会与问卷一起作为后续心理分析的依据。每次流程只调用一次。",
  parameters: selfNarrationParams,
  execute: async (_id, params) => {
    const details: SelfNarrationDetails = { kind: "self_narration", prompt: params.prompt };
    return {
      content: [
        {
          type: "text",
          text: `已向咨询者发出自述邀请:「${params.prompt}」\n请等待其点击水晶球并提交自述(语音或文字)。`,
        },
      ],
      details,
      terminate: true, // 停止本轮,等待用户提交自述
    };
  },
};

// 3. 发牌:扇形盲选信号 —— 牌堆由前端本地洗 78 张并扇形展开,不在模型上下文里塞 78 张牌义
const drawCardsParams = Type.Object({
  spread: Type.String({ description: "牌阵名称,如 三张(过去-现在-未来) / 扇形盲选三张阵" }),
  question: Type.String({ description: "本次占卜聚焦的核心问题(结合问卷与自述信息概括)" }),
});
export const drawCardsTool: AgentTool<typeof drawCardsParams, DrawDetails> = {
  name: "draw_cards",
  label: "发牌",
  description:
    "发出扇形盲选的指令:前端会把 78 张莱德-韦特塔罗牌(含正逆位)洗匀后背面朝上扇形展开,由咨询者盲选其中 3 张。本工具只返回空 cards(牌堆由前端本地生成),不要尝试描述具体牌面。调用后暂停;等咨询者选定 3 张后,再逐张调用 reveal_card 解读。",
  parameters: drawCardsParams,
  execute: async (_id, params) => {
    const details: DrawDetails = { kind: "draw", spread: params.spread, question: params.question, cards: [] };
    return {
      content: [
        {
          type: "text",
          text: `已发出「${params.spread}」扇形盲选指令。前端将本地洗 78 张牌并扇形展开,咨询者将盲选 3 张;选定后前端会把所选牌名与正逆位告知你,届时请从第 1 张开始逐张调用 reveal_card 解读。`,
        },
      ],
      details,
      terminate: true, // 发完即暂停,等待用户盲选 3 张
    };
  },
};

// 4. 逐张解读:一次只解读一张牌,解读后暂停等用户回应
const revealCardParams = Type.Object({
  nameCn: Type.String({ description: "牌名(中文)" }),
  reversed: Type.Boolean({ description: "是否逆位" }),
  text: Type.String({ description: "该牌在此情境下的解读(1-2 句,精炼)" }),
});
export const revealCardTool: AgentTool<typeof revealCardParams, CardReadingDetails> = {
  name: "reveal_card",
  label: "逐张解读",
  description:
    "对一张已选定的牌进行解读,在界面上渲染该牌的解读卡。一次只解读一张,调用后暂停,等咨询者回应或表示继续后再解读下一张。三张牌依次调用本工具,不要在一轮里连调多次。",
  parameters: revealCardParams,
  execute: async (_id, params) => {
    const details: CardReadingDetails = {
      kind: "card_reading",
      nameCn: params.nameCn,
      reversed: params.reversed,
      text: params.text,
    };
    return {
      content: [{ type: "text", text: `第「${params.nameCn}」张牌解读已呈现。请暂停,等待咨询者回应或表示继续后再解读下一张。` }],
      details,
      terminate: true, // 停止本轮,等待用户回应或点「继续」
    };
  },
};

// 4.5 专属报告:三张牌解读 + 整体指引之后生成,非终止(随后紧跟 mint_collectible)
const reportParams = Type.Object({
  title: Type.String({ description: "报告标题,呼应本次占卜主题,简短有仪式感" }),
  summary: Type.String({ description: "现状概括:用 2-4 句话总结咨询者的处境与核心诉求,必须引用其问卷与自述为依据" }),
  context: Type.String({ description: "背景说明:本次占卜的聚焦问题、关键信息(地点/天气/情绪等)的简要回顾" }),
  cards: Type.Array(
    Type.Object({
      nameCn: Type.String({ description: "牌名(中文)" }),
      reversed: Type.Boolean({ description: "是否逆位" }),
      text: Type.String({ description: "该牌在此情境下的解读(精炼,与前面逐张解读一致)" }),
    }),
    { minItems: 3, maxItems: 3, description: "三张已解读的牌及其解读" },
  ),
  advice: Type.String({ description: "整体指引/建议:给出完整逻辑链(依据→推理→结论)的总结性建议" }),
  relax: Type.String({ description: "散心方案:严格基于咨询者所在地区与当天气候,推荐 2-4 个当地具体可去的散心/打卡地(如南京→玄武湖、紫金山、中山陵),并给出简短理由;若咨询者未提供地区/天气,则给出通用的室内外放松建议" }),
});
export const generateReportTool: AgentTool<typeof reportParams, ReportDetails> = {
  name: "generate_report",
  label: "专属报告",
  description:
    "三张牌全部解读完并给出整体指引后,生成一份专属报告。报告须完整覆盖:标题、现状概括、背景回顾、三张牌及解读、整体建议、以及结合咨询者所在地区与天气的「散心方案」。每条结论都要有「依据→推理→结论」的完整逻辑链条,严禁凭空臆断。本工具不暂停;调用后应紧接着调用 mint_collectible 铸造藏品收尾。",
  parameters: reportParams,
  execute: async (_id, params) => {
    const details: ReportDetails = {
      kind: "report",
      title: params.title,
      summary: params.summary,
      context: params.context,
      cards: params.cards,
      advice: params.advice,
      relax: params.relax,
    };
    return {
      content: [
        {
          type: "text",
          text: `已生成专属报告「${params.title}」:现状概括、三张牌解读与整体建议均已呈现。接下来请调用 mint_collectible 铸造纪念藏品收尾。`,
        },
      ],
      details,
      terminate: false, // 不暂停,紧接着铸造藏品
    };
  },
};

// 5. 数字藏品(结尾自动触发,terminate 由 afterToolCall 处理)
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
    "占卜结尾,为咨询者铸造一枚专属纪念数字藏品。根据本次占卜的主题命名并赋予寓意与稀有度。这是整个占卜流程的最后一步,必须在三张牌解读完成后调用。",
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
  askOpeningTool,
  askSurveyTool,
  askSelfNarrationTool,
  drawCardsTool,
  revealCardTool,
  generateReportTool,
  mintCollectibleTool,
];
