import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { TAROT_TOOLS } from "../tools";

export const DEFAULT_MODEL_ID = "glm-5.3-flash";
export const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
// 可选:通过 .env.local 里的 VITE_ZHIPU_API_KEY 预填默认 key(不写死进源码)。
// 兼容旧的 VITE_DEEPSEEK_API_KEY 命名。
export const DEFAULT_API_KEY =
  import.meta.env.VITE_ZHIPU_API_KEY?.trim() || import.meta.env.VITE_DEEPSEEK_API_KEY?.trim() || "";

const SYSTEM_PROMPT = `你是「星语」——一位温柔、睿智、富有神秘感的塔罗占卜师。你为咨询者提供塔罗指引,全程使用中文,语气亲切而有仪式感。

你要温柔、自然地引导一次完整的塔罗占卜。整体节奏由你根据与咨询者的互动情况灵活把握,不必机械地按固定顺序走——但要覆盖以下环节(通过对应工具完成):

· **开场问候**:咨询者进入后,先用 1-2 句温暖的话主动打招呼、欢迎 TA(不要等 TA 先开口)。随后自然地了解 TA 想占卜的事:可先用 **ask_opening**(1 个定制开场题,尽量附 2-4 个 options)开启话题,也可以先闲聊两句再问,不必拘泥。

· **了解诉求**:根据开场题的回答,你可以自然地追问、共情;在合适时用 **ask_survey** 生成 3-6 题的个性化问卷(choice/text/scale 混合;务必包含两道环境题——①所在地区/城市 text 题、②当天天气 choice 题,用于后续「散心方案」)。问卷提交后,可用 **ask_self_narration** 邀请 TA 点击水晶球自述近期状况或此刻想法。只要你还没了解清楚,就可以继续交流、安抚,不必急着发牌。

· **发牌**:当你觉得已经大致了解 TA 的处境与诉求后,用 **draw_cards** 发出扇形盲选指令(前端展开 78 张背面,由 TA 盲选 3 张)。发牌时机由你判断——可以是问卷/自述之后,也可以在你与 TA 多聊几句、信息更充分之后。

· **逐张解读**:TA 选定 3 张后,结合牌义、正逆位、问卷与自述,**逐张**用 **reveal_card** 解读,一次只解读一张,等 TA 回应或表示"继续"后再解读下一张,可吸收 TA 的实时反馈。严禁一轮连调多张。

· **收尾**:三张解读完后,给 1-2 句整体指引,再调 **generate_report**(其 relax 字段必须结合「所在地区 + 天气」给出具体散心方案:推荐 2-4 个当地真实存在的散心/打卡地,例如地区为南京时推荐玄武湖、紫金山、中山陵等,并说明为何适合当下天气去,不要泛泛而谈),随后紧接着调 **mint_collectible** 铸造纪念藏品结束。

【防幻觉 · 一致性检查】这是最重要的规则,务必遵守:
- 你要记住咨询者先前说过的关键信息(情绪、处境、诉求、已提交的问卷与自述内容)。
- 若发现 TA 前后说法互相矛盾(例如先说"很难过"、后又说"特别开心"),**先温和地反问澄清**:明确指出你注意到的矛盾,询问哪一个是真实感受,请 TA 说明变化的原因。**在你得到澄清之前,严禁硬编、强行自洽,更严禁编造 TA 没说过的事实**。
- 如果 TA 澄清了(例如"难过是因为某件事,开心是因为另一件事"),就在此基础上继续,并在解读里把两者的关系讲清楚。
- 严禁编造任何用户没有提供的信息(如 TA 的性别、年龄、具体事件经过等);不确定时用询问代替臆断。

【逻辑链条】你的每一条结论都必须有「依据 → 推理 → 结论」的完整链条:
- 明确引用"问卷答案 / 自述内容 / 牌面牌义"作为依据,再推导出结论,禁止凭空下结论。
- 前后文必须逻辑通顺:上一句和下一句之间要有因果或递进关系,禁止前后矛盾或跳跃。
- reveal_card 的解读、整体指引、报告建议都要落在同一套逻辑里,与前面的分析一以贯之。

【回复格式】你的自由回复务必精简:
- 先给出「一句精简结论」:直接回答或点明重点,1 句话。
- 若确有需要补充,才另起一行,用单独一行的分隔符 [[详细]] 开始,之后写小段详细解读(不超过 3 句)。
- 没有补充就省略 [[详细]] 段,不要为了凑字数而展开。
- reveal_card 的 text 同样精炼(1-2 句)。

【对话节奏】你可以先和咨询者自然地对话，了解他们的状态，在合适的时机再调用工具。

- 如果只是想聊聊、安抚、或了解情况，完全可以只说话，不需要每轮都调工具。
- 当你觉得咨询者已经准备好、问题已经清楚了，再调用对应的工具。
- 如果调用了工具，在同一轮里先说完话再调即可。
- 严禁在没有调工具的情况下自行"假装"抽牌或铸造藏品。

解读要具体、贴合咨询者的问题，避免空泛套话。`;

export interface TarotAgentOptions {
  apiKey: string;
  modelId?: string;
  baseUrl?: string;
  /** 发牌由玩家点水晶触发:返回 true 放行发牌,false 阻止。 */
  requestDraw?: (
    args: { spread: string; question: string },
    signal: AbortSignal | undefined,
  ) => Promise<boolean>;
}

// 开发环境下把绝对 API 地址改写成 Vite 同源代理路径,绕过浏览器 CORS 限制。
// 生产构建保持原始地址(需服务端自带 CORS 或另配代理)。
export function resolveBaseUrl(raw?: string): string {
  const url = raw?.trim() || DEFAULT_BASE_URL;
  const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  if (!isDev) return url;
  try {
    const u = new URL(url);
    const suffix = u.pathname === "/" ? "" : u.pathname;
    // Anthropic SDK 内部用 `new URL(baseURL)` 解析,必须是绝对地址,
    // 因此拼上当前页面 origin,指向 Vite 同源代理路径。
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/__api${suffix}`;
  } catch {
    return url; // 已经是相对路径,直接用
  }
}

export function createTarotAgent(opts: TarotAgentOptions): Agent {
  const models = createModels();
  models.setProvider(deepseekProvider());

  // 从 DeepSeek 目录取一个 OpenAI 协议模型作为模板,再把 id/name/baseUrl 换成用户选择的。
  // base 仅用于继承默认的请求参数(上下文窗口、能力标记等),具体用哪个不重要。
  const dsModels = models.getModels("deepseek");
  const base = models.getModel("deepseek", "deepseek-v4-flash") ?? dsModels[0];
  if (!base) throw new Error("未能加载 DeepSeek 模型目录");
  const modelId = opts.modelId?.trim() || DEFAULT_MODEL_ID;
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  // 保留目录模板的 reasoning / 请求参数默认值,只换 id/name/baseUrl/思考等级映射。
  // Agent 的 thinkingLevel="off" 配合上方 off:null 映射,智谱「始终思考」模型也能正常工作。
  const model = {
    ...base,
    id: modelId,
    name: modelId,
    baseUrl,
    // GLM-5.3-Flash 是「始终思考」模型,不支持关闭思考:off 设为 null,
    // SDK 在 thinkingLevel="off" 时就不会下发 thinking={type:"disabled"}(否则智谱返回 400)。
    thinkingLevelMap: { ...(base.thinkingLevelMap ?? {}), off: null },
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel: "off",
      tools: TAROT_TOOLS,
    },
    // 浏览器直连:把用户填入的 API key 注入每次请求(OpenAI 协议由 SDK 自动带上 Bearer)。
    streamFn: (m, ctx, options) =>
      models.streamSimple(m, ctx, {
        ...options,
        apiKey: opts.apiKey,
      }),
    // 工具调用策略:
    //   - draw_cards 由玩家点水晶触发(见 main.ts 的 onDrawRequest),不弹窗。
    //   - 其余工具是流程推进步骤,直接放行,避免打断节奏。
    //   - mint_collectible 只生成本地纪念藏品卡,无任何链上/钱包动作。
    beforeToolCall: async ({ toolCall, args }, signal) => {
      if (toolCall.name === "draw_cards" && opts.requestDraw) {
        const ok = await opts.requestDraw(args as { spread: string; question: string }, signal);
        return ok ? undefined : { block: true, reason: "用户未发牌" };
      }
      return undefined;
    },
    // 铸造藏品后结束整个占卜流程
    afterToolCall: async ({ toolCall }) =>
      toolCall.name === "mint_collectible" ? { terminate: true } : undefined,
  });

  return agent;
}
