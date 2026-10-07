# 🔮 塔罗占卜大师 - 玩法模块

> 武汉 Web3 黑客松项目 · 核心抽卡玩法 + AI 解读模块

## 📁 目录结构

```
玩法/
├── src/               # 源代码
│   ├── main.ts        # 核心应用逻辑（状态机 + 所有屏幕）
│   ├── style.css      # 完整样式表
│   ├── cards.ts       # 78张塔罗牌完整数据库
│   ├── readings.ts    # AI解读生成器
│   └── types.ts       # 类型定义
├── dist/              # 构建产物（可直接运行）
├── serve.cjs          # 本地静态服务器
├── 玩法设计文档.md     # 玩法设计文档
├── package.json       # 依赖配置
├── index.html         # 入口页
├── tsconfig.json
└── vite.config.ts
```

## 🚀 快速启动

### 方式一：双击运行（最简单）
```
1. 安装 Node.js (v18+)
2. 在「玩法」文件夹内打开终端
3. 运行：
   npm install
   node serve.cjs
4. 浏览器打开 http://localhost:3000
```

### 方式二：开发模式（热更新）
```
npm install
npm run dev
# 浏览器打开 http://localhost:5173
```

### 方式三：构建后预览
```
npm install
npm run build
npx vite preview
```

## 🎮 完整体验流程

1. 点击「触碰水晶」→ 进入占卜
2. 选择占卜主题（事业/爱情/财运/健康/综合）
3. 可选填问题 → 点击「开始洗牌」
4. 点击牌堆「切牌」
5. 按「停！」按钮
6. 观看命运之轮旋转（模拟 VRF 等待）
7. 三张牌逐张翻转揭示
8. AI 解读以打字机效果输出
9. 可点击追问气泡深入探索

## 🛠 定制指引

| 想改什么 | 改哪个文件 |
|---------|-----------|
| 卡牌含义 | `src/cards.ts` |
| 解读风格 | `src/readings.ts` |
| 交互流程 | `src/main.ts` |
| 颜色/动效 | `src/style.css` |
