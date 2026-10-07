import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { TAROT_TOOLS } from "./tools";

export const DEFAULT_MODEL_ID = "LongCat-2.0";
export const DEFAULT_BASE_URL = "https://api.longcat.chat/anthropic";

const SYSTEM_PROMPT = `你是「星语」——一位温柔、睿智、富有神秘感的塔罗占卜师。你为咨询者提供塔罗指引,全程使用中文,语气亲切而有仪式感。

你必须严格按以下流程进行,每一步都通过调用对应的工具完成,不要跳步,也不要一次性做完:

1. 开场:先用 1-2 句温暖的话欢迎咨询者。然后**调用 ask_intake_questions 工具**,提出 2-4 个开放式问题以了解其处境(如:最近最挂心的领域、当前心境、希望从这次占卜得到什么)。为了方便咨询者作答,请尽量为每个问题附带 2-4 个有代表性的备选项(options),咨询者可以点选,也可以自由补充。调用后你会暂停,等待咨询者回答。整个流程只调用这个工具一次。

2. 咨询者回答后:根据其回答,用 1 句话共情并概括其关切,然后**在同一次回复里立即调用 draw_cards 工具**为其抽牌(通常单张或三张牌阵,可根据问题复杂度决定 count 与 spread)。

3. 抽牌结果返回后:结合每张牌的正逆位牌义与咨询者的具体问题,进行有深度、有温度的解读。随后**调用 reveal_reading 工具**,以结构化方式呈现:逐张牌的解读 + 一段整体指引。

4. 最后:**调用 mint_collectible 工具**,为咨询者铸造一枚呼应本次占卜主题的专属纪念数字藏品(取一个有诗意的名字、赋予寓意与稀有度)。这是流程的收尾,调用后占卜结束。

【至关重要的执行纪律】除了第 1 步(ask_intake_questions 之后需要暂停等待用户回答)以外,你在任何一步说完过渡性的话之后,都**必须在同一次回复中紧接着调用对应的工具**,绝不允许只输出一两句文字就结束本轮而不调用任何工具。例如:说完"让我为你抽牌"就必须立刻调用 draw_cards;说完"让我为你解读"就必须立刻调用 reveal_reading。如果你发现自己只写了文字却还没调用本步该调用的工具,请立即补上工具调用。

注意:不要在没有调用工具的情况下自行"假装"抽牌或发藏品;所有关键动作都必须通过工具实现。解读要具体、贴合咨询者的问题,避免空泛套话。`;

export interface TarotAgentOptions {
  apiKey: string;
  modelId?: string;
  baseUrl?: string;
}

// 开发环境下把绝对 API 地址改写成 Vite 同源代理路径,绕过浏览器 CORS 限制。
// 生产构建保持原始地址(需服务端自带 CORS 或另配代理)。
function resolveBaseUrl(raw?: string): string {
  const url = raw?.trim() || DEFAULT_BASE_URL;
  const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  if (!isDev) return url;
  try {
    const u = new URL(url);
    const suffix = u.pathname === "/" ? "" : u.pathname;
    // Anthropic SDK 内部用 `new URL(baseURL)` 解析,必须是绝对地址,
    // 因此拼上当前页面 origin,指向 Vite 同源代理路径。
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/__anthropic${suffix}`;
  } catch {
    return url; // 已经是相对路径,直接用
  }
}

export function createTarotAgent(opts: TarotAgentOptions): Agent {
  const models = createModels();
  models.setProvider(anthropicProvider());

  // 从目录取一个基准 anthropic 模型,再把 id/name 换成用户选择的,避免 id 不在目录时取不到
  const base =
    models.getModel("anthropic", DEFAULT_MODEL_ID) ?? models.getModel("anthropic", "claude-3-5-sonnet-latest");
  if (!base) throw new Error("未能加载 Anthropic 模型目录");
  const modelId = opts.modelId?.trim() || DEFAULT_MODEL_ID;
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const model = { ...base, id: modelId, name: modelId, baseUrl };

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel: "off",
      tools: TAROT_TOOLS,
    },
    // 浏览器直连:把用户填入的 API key 注入每次请求(pi-ai 的 anthropic-messages 已内置浏览器直连所需 header)。
    // 同时以 Authorization: Bearer 形式带上 key —— LongCat 等 Anthropic 兼容网关只认 Bearer,
    // 官方 Anthropic 认 x-api-key(由 apiKey 提供),两个头都发,各取所需。
    streamFn: (m, ctx, options) =>
      models.streamSimple(m, ctx, {
        ...options,
        apiKey: opts.apiKey,
        headers: { ...(options?.headers ?? {}), Authorization: `Bearer ${opts.apiKey}` },
      }),
    // 铸造藏品后结束整个占卜流程
    afterToolCall: async ({ toolCall }) =>
      toolCall.name === "mint_collectible" ? { terminate: true } : undefined,
  });

  return agent;
}
