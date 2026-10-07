import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const dir = fileURLToPath(new URL(".", import.meta.url));
const pkgs = resolve(dir, "../pi/packages");

export default defineConfig({
  resolve: {
    // 顺序敏感:更具体的别名放前面
    alias: [
      { find: /^@earendil-works\/pi-agent-core\/types$/, replacement: resolve(pkgs, "agent/src/types.ts") },
      { find: /^@earendil-works\/pi-agent-core$/, replacement: resolve(pkgs, "agent/src/agent.ts") },
      { find: /^@earendil-works\/pi-ai\/providers\/anthropic$/, replacement: resolve(pkgs, "ai/src/providers/anthropic.ts") },
      { find: /^@earendil-works\/pi-ai$/, replacement: resolve(pkgs, "ai/src/index.ts") },
      // provider-env.ts 里 require("node:fs") 只在 bun 沙箱分支触发,浏览器永不执行,给个空桩即可
      { find: /^node:fs$/, replacement: resolve(dir, "src/stubs/node-fs.ts") },
    ],
  },
  // pi 源码在项目根之外,允许 Vite 读取上级目录
  server: {
    fs: { allow: [resolve(dir, "..")] },
    // 同源代理:浏览器直连 api.longcat.chat 会被 CORS 拦截,改为请求本地 /__anthropic/*,
    // 由 Vite 在服务端转发到真实接口(服务端请求不受 CORS 限制)。
    // 换其他 anthropic 兼容服务时,设置环境变量 VITE_ANTHROPIC_TARGET 即可。
    proxy: {
      "/__anthropic": {
        target: process.env.VITE_ANTHROPIC_TARGET || "https://api.longcat.chat",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__anthropic/, ""),
      },
    },
  },
  // 让 pi 包按源码打包,不走预构建
  optimizeDeps: { exclude: ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core"] },
});
