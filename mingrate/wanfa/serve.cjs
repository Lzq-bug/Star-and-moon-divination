/** 塔罗占卜大师 - 本地静态服务器 + Aliyun TTS 代理
 *  启动：node serve.cjs → http://localhost:3000
 *  TTS 代理 POST /api/tts { text } → 音频
 *  模型：qwen-audio-3.0-tts-flash | 音色：longanhuan_v3.6
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DIST = path.join(__dirname, 'dist');
const PORT = 3000;
const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// ===== 阿里云百炼 =====
// 从仓库根目录 .env / .env.local 读取(已 gitignore,不提交),键名见 .env.example。
function loadEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}
const ROOT = path.join(__dirname, '..', '..');
loadEnv(path.join(ROOT, '.env'));
loadEnv(path.join(ROOT, '.env.local'));
const ALIYUN_KEY = process.env.ALIYUN_KEY || '';
const WS_ID = process.env.ALIYUN_WS_ID || ''; // 你的工作空间 ID

// HTTP 端点
const EP = [
  { host: `${WS_ID}.cn-beijing.maas.aliyuncs.com`, path: '/api/v1/services/audio/tts/SpeechSynthesizer' },
  { host: 'dashscope.aliyuncs.com', path: '/api/v1/services/audio/text-to-speech/text-to-speech' },
];

// WebSocket 支持
let WebSocket = null;
try { WebSocket = require('ws'); } catch (_) {}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/tts') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { text, voice_direction, speech_rate, pitch } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end('{"error":"text required"}'); return; }

        // 改动三：文本清洗兜底——删残留【】/emoji/——/括号等（即使前端没洗干净也不卡碎）
        let cleanText = text
          .replace(/[【】\[\]《》「」""（）()]/g, '')
          .replace(/——/g, '，')
          .replace(/…{2,}/g, '。')
          .replace(/[""]/g, '')
          .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
          .replace(/关键词[：:]\s*/g, '')
          .trim();

        // 改动三（test_voice.cjs 验证结论）：longanhuan_v3.6 不吃纯情绪 instruction
        // B≈A → 放弃 instruction，纯靠减法文本 + speech_rate 已足够自然
        const finalRate = speech_rate ?? 1.0;
        const finalPitch = pitch ?? 0.95;

        const ttsInput = {
          text: cleanText, voice: 'longanhuan_v3.6', format: 'mp3', sample_rate: 24000,
          speech_rate: finalRate, pitch: finalPitch,
        };

        const payload = JSON.stringify({
          model: 'qwen-audio-3.0-tts-flash',
          input: ttsInput,
        });

        let idx = 0;
        function tryHTTP() {
          if (idx >= EP.length) { tryWS(); return; }
          const ep = EP[idx++];
          const opts = {
            hostname: ep.host, path: ep.path, method: 'POST',
            headers: { Authorization: `Bearer ${ALIYUN_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          };
          const pr = https.request(opts, (prRes) => {
            const ct = prRes.headers['content-type'] || '';
            if (ct.includes('audio') || ct.includes('octet-stream')) {
              res.writeHead(200, { 'Content-Type': ct }); prRes.pipe(res);
            } else {
              // JSON 响应 → 提取 audio URL
              let data = '';
              prRes.on('data', c => data += c);
              prRes.on('end', () => {
                try {
                  const j = JSON.parse(data);
                  const url = j?.output?.audio?.url;
                  if (url) {
                    const getter = url.startsWith('https') ? https.get : http.get;
                    getter(url, (aRes) => {
                      if (aRes.statusCode === 200) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); aRes.pipe(res); }
                      else { prRes.destroy(); tryHTTP(); }
                    }).on('error', () => tryHTTP());
                  } else { prRes.destroy(); tryHTTP(); }
                } catch (_) { prRes.destroy(); tryHTTP(); }
              });
            }
          });
          pr.on('error', () => tryHTTP());
          pr.write(payload); pr.end();
        }

        function tryWS() {
          if (!WebSocket) { res.writeHead(500); res.end('{"error":"all_failed"}'); return; }
          try {
            const ws = new WebSocket(`wss://${WS_ID}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`, {
              headers: { Authorization: `Bearer ${ALIYUN_KEY}` },
            });
            const chunks = [];
            const t = setTimeout(() => { ws.close(); res.writeHead(500); res.end('{"error":"timeout"}'); }, 12000);
            ws.on('open', () => ws.send(JSON.stringify({
              header: { action: 'run-task' },
              payload: { model: 'qwen-audio-3.0-tts-flash', task: 'tts', input: { text }, parameters: { voice: 'longanhuan_v3.6', format: 'mp3', sample_rate: 24000 } },
            })));
            ws.on('message', (d) => {
              if (Buffer.isBuffer(d)) chunks.push(d);
              else {
                try {
                  const m = JSON.parse(d.toString());
                  if (m?.header?.name === 'TaskFinished') {
                    clearTimeout(t); ws.close();
                    if (chunks.length) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.concat(chunks)); }
                    else { res.writeHead(500); res.end('{"error":"no_audio"}'); }
                  }
                } catch (_) {}
              }
            });
            ws.on('error', () => { clearTimeout(t); res.writeHead(500); res.end('{"error":"ws_error"}'); });
            ws.on('close', () => {
              clearTimeout(t);
              if (chunks.length && !res.headersSent) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.concat(chunks)); }
            });
          } catch (e) { res.writeHead(500); res.end('{"error":"ws_fail"}'); }
        }

        tryHTTP();
      } catch (e) { res.writeHead(400); res.end('{"error":"bad_request"}'); }
    });
    return;
  }

  let fp = path.join(DIST, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (_, d) => {
        if (d) { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(d); }
        else { res.writeHead(404); res.end('Not found'); }
      }); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`🔮 塔罗占卜大师 → http://localhost:${PORT}`);
  console.log(`🎙️ TTS: qwen-audio-3.0-tts-flash / longanhuan_v3.6`);
});
