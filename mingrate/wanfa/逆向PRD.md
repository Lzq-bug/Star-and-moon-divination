# 塔罗占卜大师 — 逆向 PRD（基于实际代码）

> **文档性质：** 从 `src/` 源码逆向还原的产品需求文档
> **还原日期：** 2026-07-25
> **还原依据：** `main.ts` / `phase.ts` / `voice-manager.ts` / `voice-stage.ts` / `vad.ts` / `prompts.ts` / `readings.ts` / `sound.ts` / `types.ts`

---

## 0. 一句话定位

**一个「先陪你聊，再为你抽牌解读」的语音陪伴式 AI 塔罗占卜 Web 应用。**
核心不是抽卡，而是「被听见 → 被回应 → 被指引」的情绪疗愈闭环。

> **重要说明：** 仓库里另有一份 `玩法设计文档.md`，那是黑客松筹备期的 Web3 愿景稿（钱包 / NFT / Chainlink VRF / 代币经济）。但**实际代码里这些均未实现**——VRF 只是纯前端动画模拟，没有钱包、没有合约、没有 NFT。真正落地并反复打磨的是「语音陪伴层」。**本 PRD 以代码事实为准。**

---

## 1. 双流程架构：一个被另一个「接管」

代码里存在**两条并行的状态流**，理解它们的关系是理解整个玩法的关键。

| 流程 | 定义位置 | 性质 | 驱动方式 |
|------|---------|------|---------|
| **GameState 视觉流** | `main.ts` | 8 个仪式化屏幕 | 点击驱动 |
| **Phase 对话流** | `phase.ts` | 4 个阶段 | 语音驱动 |

**GameState（视觉仪式）：**
```
LANDING → THEME_SELECT → CUTTING → SPINNING → VRF_WAIT → REVEALING → READING → COMPLETE
```

**Phase（对话编排）：**
```
intake（倾诉）→ drawing（落牌）→ reading（解读）→ followup（追问）
```

### 关键设计事实：语音流会「短路」掉手动仪式

在 `showLanding()` 里，点击水晶球 **不进入** 选主题页，而是直接调用 `startIntake()` 并打开全屏语音界面。当 intake 判定「聊够了」，`doDrawing()` 触发 → `onPhaseChange('drawing')` → 直接调用 `reallyShowReveal()`。

也就是说：**「选主题 / 切牌 / 命运之轮停牌 / VRF 等待」这几个手动屏幕在语音主线里被跳过了。** 它们是早期「纯手动占卜」版本的遗留路径——代码仍在，但主入口不再经过。

> **产品含义：** 当前主打体验 = 语音对话主线；手动仪式屏是可复用的降级/备用素材。逆向出的「主要玩法」应以语音线为准。

---

## 2. 主线交互玩法（语音陪伴流）

### 阶段 0 · 落地页（LANDING）

- 星空视差背景（60 颗程序生成星点 + 鼠标视差），水晶球带双轨光环。
- 文案：「将你的疑问交给星辰……当你准备好时触碰水晶。」
- **触碰水晶** = 唯一 CTA。点击即触发：
  1. 解锁 `AudioContext`（浏览器要求用户手势）
  2. 播放启动音 + 低频 drone 环境音
  3. `startIntake()` 进入 intake 阶段
  4. 弹出全屏「星灵」语音舞台

### 阶段 1 · intake（倾诉 / 建档）— **玩法灵魂**

全屏「星灵语音在场界面」（`voice-stage.ts`）：一颗会呼吸、会随声音律动的流体光球，代替传统表单。

**界面 5 层结构：**
```
L0 退场解读页（blur + scale）
L1 星尘 canvas
L2 星灵律动球（4 个加光融合流体 blob）
L3 星灵神情（耳朵 / 口型 / 外环）
L4 流式文字
L5 控制栏 + 微交互
```

**交互模型（半双工 + 连续对话）：**
- 进界面即自动 continuous 模式、自动请求麦克风、自动进入 listening。
- 三种说话方式：
  1. 点星灵球开始/结束
  2. 按住下方「按住 说话」
  3. 连续通话（VAD 自动断句，`vad.ts`）
- 球体 4 态：`idle`（呼吸）/ `listening`（随麦克风电平膨胀）/ `thinking` / `speaking`（口型开合）。
- **Barge-in（抢话）：** 星灵说话时用户开口 → VAD 检测到语音 start → 立即停 TTS 回到 listening。这是「像真人对话」的关键细节。
- **VAD 参数：** startFrames=9、silenceMs=700、threshold=0.04、minSpeechMs=250、gateMs=250（speaking 期间及结束后 250ms 门控防自激）。

**对话引擎设计（`phase.ts` 核心创新）—— 共情与判断解耦：**

每一轮用户输入并行走两条「LLM 调用」（当前是规则引擎模拟，prompts 已备好待接入）：

1. **共情调用（`generateEmpathy` / `EMPATHY_PROMPT`）** — 只负责「陪」。
   - Prompt 明令**禁止**出现「抽牌 / 占卜 / 准备好了吗 / ready」等收敛词。
   - 四种回合姿态随机、节奏不规则：
     - 纯陪伴：「嗯，我在听。」「这样啊。」
     - 轻猜测：「是不是有点像……」
     - **具象共鸣：** 不说「你压力很大」，而说「像心里一直绷着一根弦，晚上躺下也松不了」
     - 温柔追问：一次只问一个方向
   - 会**回扣用户原话**（「你刚说『……』，我记住了」）证明「在听、在记着」。

2. **判断调用（`generateJudgment` / `JUDGMENT_PROMPT`）** — 对用户不可见。
   - 独立决定 `ready_to_read` 与情绪 `weight`，并沉淀出 `ReadingSeed`。

**「聊够了」判定规则（ready=true）：**
- 用户主动说「看看 / 抽牌 / 占卜 / 算算」→ 立即就绪；
- 满 3 轮且信息清晰（有 focus + domain）；
- 单句 >40 字且情绪已落地。

就绪后走**「起身回合」**（`STANDUP_TEMPLATE`）：先说一句郑重而不催的过渡（「我大概了解了。让我为你看看牌。」），600ms 后落牌。

**ReadingSeed（对话沉淀的结构化档案）：**
```typescript
{
  focus: string,        // 核心困惑（1-2 句）
  emotion: string,      // 情绪基调
  domain: string,       // 领域
  keywords: string[],   // 3-5 关键词
  energy_tags: string[],// 2-3 能量标签
  chosen_cards?: [...]  // 可选：引导牌（C 档）
}
```
- `emotion` 五档：`anxious` / `sad` / `confused` / `hopeful` / `neutral`，对应不同 `weight`（sad 最重 = 1.4，影响 thinking 时长）与后续叙事语调。
- `domain` 从关键词提取：感情 / 事业 / 财运 / 健康 / 综合。

### 阶段 2 · drawing（落牌）— A 档 / C 档双模式

- **C 档（引导抽牌）：** 若 seed 带 `chosen_cards`（按「领域_情绪」组合从预设牌池选 3 张），则**用指定牌**。
  - 例：`感情_anxious` → 恋人(正) / 圣杯二(逆) / 星星(正)
  - 例：`健康_anxious` → 节制(逆) / 权杖二(正) / 死神(正)
  - 这让「牌面呼应刚才的倾诉」，是情绪价值的核心手法。
- **A 档（纯随机）：** 无 chosen_cards 时随机抽 3 张、随机正逆位。
- 牌阵固定为 **过去 / 现在 / 未来** 三张。

### 阶段 3 · REVEALING（翻牌揭示）

- 三张牌背朝上，**逐张翻转**（每张间隔 1.4s），配递进升调「叮」音效 + 粒子爆发 + 牌间金色连线。
- 逐句旁白：「第一张牌，诉说着你的过去……」→「第二张牌，映照你的当下……」→「第三张牌，预示着你的未来……」

### 阶段 4 · reading（解读）— 双文本架构

`readings.ts` 生成结构化解读，`simulateStreaming` 以打字机 SSE 效果逐字输出。

**解读结构：**
| 部分 | 内容 |
|------|------|
| 🌌 总览 | 三张牌整体能量概括（按主题模板） |
| 📜 单牌解析 ×3 | 关键词 + 正/逆位牌义 + 主题映射 |
| 🔗 联动解读 | 元素流 + 大阿卡纳数量 + 正逆位比例 + 特殊组合 |
| 💡 建议 | 3 条可操作行动指引 |
| 💝 情绪寄语 | 一句温暖收尾 |
| ✨ 能量肯定语 | 一句正向暗示 |

**联动智能（`generateConnection`）：**
- 检测元素流（火→水→土）、大阿卡纳数量（3 张 = 人生转折）、正逆位比例。
- **特殊组合彩蛋（`detectSpecialCombo`）：**
  - 命运之轮 + 死神 + 审判 = ⚡ 命运三部曲
  - 星星 + 月亮 + 太阳 = 🌟 星月日全能量
  - 恶魔 + 高塔 + 审判 = 🔥 觉醒三部曲
  - 恋人 + 女皇 + 星星 = 💖 爱与丰盛
  - 愚人 + 魔术师 + 世界 = 🌀 完整旅程

**情绪着色（`determineSentiment`）：**
- 按吉牌/凶牌打分定 `dark` / `bright` / `neutral`。
- 决定：寄语库选择、音效冷暖色、逆位「永远给台阶」（不说「不好」，说「能量还不够顺」「还在转化中」）。

**双文本解耦（display vs narration）— 治「机器念稿感」：**
- **display：** 页面看的 markdown 富文本（含【】高亮、emoji、分段）。
- **narration：** TTS 专用「减法口语」，与 display 完全解耦：
  - 已按句切好，不含【】/ emoji / 破折号 /（）/「关键词：」
  - 每段最多 1 个语气词，且只能在句首
  - 逐段用连接词滑入（「先看过去这张牌」「那现在呢」「至于未来」）
  - 每段至少一句呼应 `seed.focus` 或 `seed.keywords`，让用户感到被听懂

**语音播报（`voice-manager.ts`）：**
- TTS 优先走本地代理（`localhost:3000/api/tts`）→ 阿里云百炼 CosyVoice「龙嫱」音色；失败回退浏览器 `SpeechSynthesis`。
- **并发预合成 + 顺序无缝播放：** 所有句子 `Promise.all` 并行合成，全就绪后靠 `onended` 链式播放，零空窗。
- **发送前文本清洗（`sanitize`）：** 删除各类括号、破折号转逗号、省略号归一。
- 念白期间环境音自动降到 `bed` 档、关闭星铃点缀，避免抢人声。

### 阶段 5 · followup（追问）+ COMPLETE（完成）

- 解读念完 → 进入 followup 阶段，语音浮球变「可用」态（提示「想问什么就说吧」）。
- **带上下文追问（`generateFollowup` / `FOLLOWUP_PROMPT`）：**
  - 能识别用户问句里提到的具体牌名，引用「它在过去位置、逆位的 XX 能量，结合你说的 XX……」
  - 禁止「好问题 / 让我想想」这类兜底模板。
  - 不引入新牌，只联系已有牌面。
- **底部操作栏：**
  - 🌙 **存入星盘** — 写 localStorage 历史（最多 50 条）
  - 📤 **分享** — 复制结果文案到剪贴板
  - 🔄 **再来一次** — 回落地页
- **三个预设追问气泡**（深入分析 / 更多建议 / 对我意味着什么），点击后**锁定**（🔒 已使用）——模拟免费版限次。
- **情绪兜底：** sad/anxious 用户额外显示「不管今天的牌面如何，你已经足够好了。我就在这儿。」

---

## 3. 声音设计（独立的沉浸维度）

`sound.ts` 是完全**程序化合成、零素材依赖**的旁路音频层。

**架构：** 单 `AudioContext` + 4 增益母线（master / ambient / sfx / voice）。

- **环境层：** 3 个失谐锯齿波 drone + 极慢 LFO（0.08Hz）调制低通滤波 + 随机星铃点缀（3-6s）+ 1.2s 程序混响。
- **音效清单：** 洗牌（带通噪声爆发）、翻牌（递进升调，dark 情绪降频加混响）、开始 sweep、段落过渡 pad、存档三音、分享双音、重置降调、麦克风起停 sweep、金句 sparkle、CG 高光。
- **三态 ducking：**
  - `full` (-16dB)：演出 / CG，无人声
  - `bed` (-23dB)：念白，退后垫底不抢话
  - `duck` (-30dB)：ASR 识别
- **驱动可视化：** `AnalyserNode` 提供 mic/voice RMS 电平，同时喂给语音球的膨胀与口型——**声音与画面同源**。

---

## 4. 状态互斥规则（防串台）

`phase.ts` 明确了三条界面互斥铁律，是把「对话」和「占卜」两层缝合好的关键：

- **intake 阶段：** 禁止渲染牌阵/解读 DOM（`contentEl` 隐藏，只留全屏星灵）。
- **drawing/reading 阶段：** 关闭全屏语音舞台，星灵退化为角落浮球。
- **followup 阶段：** 携带 seed + 牌阵 + 历史上下文。

---

## 5. 数据模型速查

```typescript
Phase       = 'intake' | 'drawing' | 'reading' | 'followup'
Theme       = 'career' | 'love' | 'wealth' | 'health' | 'general'
Orientation = 'upright' | 'reversed'
Position    = 'past' | 'present' | 'future'

DrawnCard   = { card: TarotCard, orientation, position }
AIReading   = { overview, cards[], connection, advice[], blessing,
                energyTip, specialCombo?, sentimentTag?, narration[] }
ReadingSeed = { focus, emotion, domain, keywords[], energy_tags[], chosen_cards? }
IntakeTurn  = { user, assistant: { say, ready_to_read, seed } }
```

---

## 6. 逆向出的产品主张（与原愿景稿的差异）

| 维度 | 原 `玩法设计文档.md` 宣称 | 实际代码 |
|------|--------------------------|---------|
| 核心玩法 | 钱包连接 + 链上抽卡 + NFT | **语音对话陪伴 + 本地抽卡** |
| 抽卡公平性 | Chainlink VRF 上链 | 前端**动画模拟** VRF，无链 |
| 随机性 | 链上随机数 | `Math.random` + C 档引导牌池 |
| 解读 | 云端大模型 + RAG | **本地规则引擎模拟** LLM（prompts 已备好，待接入） |
| 数据留存 | NFT / IPFS | localStorage |
| 差异化亮点 | AI×Web3×情绪三位一体 | **情绪价值 + 语音在场感**（唯一真正打磨的护城河） |

---

## 7. 结论

这个项目真正的产品内核不是「Web3 塔罗」，而是 **「一个会先耐心听你说话、再温柔为你解牌的语音伴侣」**。

所有工程精力——共情/判断解耦、双文本 TTS、barge-in 抢话、并发预合成、三态 ducking、律动球——都投在同一个目标上：**让一次占卜像一次被理解的对话。**

Web3 是路演叙事，语音陪伴才是落地玩法。

---

## 附录：待接入真实服务的 TODO（代码中已留接口）

| 待接入 | 现状 | 接入点 |
|--------|------|--------|
| intake 共情 LLM | 规则引擎模拟 | `phase.ts` `generateEmpathy` → `EMPATHY_PROMPT` |
| intake 判断 LLM | 规则引擎模拟 | `phase.ts` `generateJudgment` → `JUDGMENT_PROMPT` |
| reading 解读 LLM | 模板拼接 | `readings.ts` `generateReading` → `READING_SYSTEM_PROMPT` |
| followup 追问 LLM | 规则引擎模拟 | `phase.ts` `generateFollowup` → `FOLLOWUP_PROMPT` |
| 阿里云 TTS | 已接入（走本地代理） | `voice-manager.ts` `TTS_PROXY_URL` |
| 链上 VRF / NFT | 纯动画模拟，未接入 | `main.ts` `showVRFWait`（备用路径） |
