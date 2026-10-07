import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  // 读取 .env.local(如 VITE_DEEPSEEK_TARGET),换服务商不用改代码。
  const env = loadEnv(mode, dir, '');

  return {
    resolve: {
      alias: [
        // pi-ai 的 provider-env.ts 在 Bun 沙箱分支里 require("node:fs").
        // 浏览器永远不触发该分支,此桩只为让打包解析通过。
        { find: /^node:fs$/, replacement: resolve(dir, 'src/stubs/node-fs.ts') },
      ],
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.loca.lt', '.lhr.life'],
      // 同源代理:浏览器直连 OpenAI 兼容网关会被 CORS 拦截,
      // 改为请求本地 /__api/*,由 Vite 在服务端转发。
      proxy: {
        '/api/tts': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/api/asr': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/__api': {
          target: env.VITE_DEEPSEEK_TARGET || 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__api/, ''),
        },
      },
    },
  };
});
