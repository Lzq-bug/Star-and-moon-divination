# 星月占卜 · Star & Moon Divination

> 基于智谱 GLM 大模型 Agent 的 AI 塔罗占卜 Web 应用——一位温柔而睿智的 AI 占卜师「星语」,陪你完成一场有仪式感的塔罗旅程。

![主界面](public/crystal-sanctum.png)

## ✨ 功能特性

- **AI 占卜师「星语」**:由大模型驱动的对话式 Agent,主动问候、共情追问、自然引导,全程有仪式感的中文占卜体验。
- **完整占卜流程**:开场破冰 → 个性化问卷(所在地区 / 天气等) → 水晶球自述 → 78 张塔罗牌扇形盲选 3 张 → 逐张解读(结合牌义、正逆位与你的自述) → 综合指引与贴合当地天气的散心方案 → 生成专属纪念卡。
- **防幻觉一致性检查**:Agent 内置一致性规则,发现前后矛盾会先温和澄清,不强行自洽、不编造事实。
- **今日星象**:选择星座,由agent生成当日运势卡片,每个星座每天缓存一次。
- **能量档案**:自动归档历史星象卡与塔罗纪念卡,随时回看。
- **语音交互**(可选):语音输入走语言模型,回复播报优先浏览器语音合成,本地代理一键启动。
- **纪念卡导出**:占卜结束生成专属纪念藏品卡,支持导出图片保存。

## 🧰 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Vite 6 · TypeScript 5.7 · Bootstrap 5 · 原生 CSS 动效 |
| AI | (OpenAI 兼容端点 `open.bigmodel.cn`) · pi-agent-core / pi-ai Agent 框架 |
| 语音 | GLM-ASR 语音识别(经本地 Node 代理) · 浏览器 SpeechSynthesis 播报 |
| 部署 | Docker 多阶段构建 · Nginx |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18(推荐 22)
- npm 或 pnpm
-  API Key

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

复制 `.env.example` 为 `.env.local`,填入你的 Key:

```bash
#  API Key(对话 + 语音识别)
ZHIPU_KEY=your-zhipu-api-key

# 前端预填的默认 Key(可选,浏览器未保存 Key 时生效)
VITE_ZHIPU_API_KEY=your-zhipu-api-key

# LLM 代理目标(Vite /__api 转发地址)
VITE_DEEPSEEK_TARGET=https://open.bigmodel.cn
```

> 也可以不建配置文件:首次打开页面后,点击右上角 **✦ 菜单 →「配置 API Key」** 在界面内填写(Key 保存在浏览器 localStorage)。

### 3. 启动

```bash
# 仅前端(对话占卜、今日星象即可用)
npm run dev
```

浏览器访问 <http://localhost:5173>。

**Windows 一键启动**(前端 + 语音代理一起拉起):

```bat
启动.bat
```

**语音交互**(可选,单独启动):

```bash
node tts-proxy.cjs   # 本地语音代理,监听 3000 端口
```

Vite 开发服务器会自动把 `/api/asr`、`/api/tts`、`/health` 转发到该代理。

## ⚙️ 配置项一览

| 环境变量 | 说明 |
| --- | --- |
| `ZHIPU_KEY` | API Key,语音代理(`tts-proxy.cjs`)的无头回退 Key |
| `VITE_ZHIPU_API_KEY` | 前端预填的默认 Key(可选) |
| `VITE_DEEPSEEK_TARGET` | `/__api` 代理目标,默认智谱 OpenAI 兼容端点 |
| `ZHIPU_ASR_MODEL` | 语音识别模型,默认 `glm-asr-2512` |
| `ALIYUN_KEY` / `ALIYUN_WS_ID` |  工作空间 ID(可选,TTS 播报与识别兜底) |

API 地址与模型名均可在页面 ✦ 菜单中随时修改,便于切换服务商。

## 🐳 Docker 部署

```bash
docker compose up -d --build
```

启动后:

- 前端:`http://localhost:3349`(Nginx 托管构建产物,并转发 `/api/tts`、`/__api`)
- 语音代理:容器内 3000 端口,由 compose 编排

## 📁 项目结构

```
├── index.html               # 入口页面
├── src/
│   ├── main.ts              # 界面与交互主逻辑
│   ├── session.ts           # 占卜会话与 Agent 生命周期
│   ├── agent/setup.ts       # GLM 模型接入与「星语」系统提示词
│   ├── tools/               # Agent 工具(发牌、解读、报告、纪念卡等)
│   ├── horoscope.ts         # 今日星象
│   ├── asr.ts               # 语音识别(浏览器端 WAV 编码 + GLM-ASR)
│   ├── stage/               # 语音舞台层(视觉与声音)
│   └── style.css
├── tts-proxy.cjs            # 本地语音代理(ASR 转发,端口 3000)
├── vite.config.ts           # Vite 配置(/__api 同源转发绕过 CORS)
├── 启动.bat                  # Windows 一键启动
├── Dockerfile               # 多阶段构建(构建 → Nginx)
├── docker-compose.yml       # 前端 + 语音代理编排
└── mingrate/                # 实验性子项目(玩法设计、早期塔罗原型)
```



## 📄 许可证

[MIT](https://opensource.org/licenses/MIT)
