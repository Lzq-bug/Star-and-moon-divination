/**
 * tts-proxy.cjs — 阿里云百炼 TTS 代理服务器
 *
 * 音色：longanhuan_v3.6（龙嫱）
 * 模型：qwen-audio-3.0-tts-flash
 * 用法：node tts-proxy.cjs
 * 前端 POST /api/tts { text, speech_rate?, pitch? } → 返回 audio/mpeg
 */
const http = require('http');
const https = require('https');

const PORT = 3000;

// ===== 阿里云百炼 凭证 =====
// 从 .env / .env.local 读取(这两个文件已被 .gitignore 忽略,不会提交到仓库),键名见 .env.example。
const fs = require('fs');
const path = require('path');
function loadEnv(file) {
  try {
    const txt = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}
loadEnv('.env');
loadEnv('.env.local');

const ALIYUN_KEY = process.env.ALIYUN_KEY || '';
const WS_ID = process.env.ALIYUN_WS_ID || ''; // 工作空间 ID

// ===== 智谱 GLM(OpenAI 兼容端点) =====
// 配置 ZHIPU_KEY 后,语音识别 /api/asr 优先走智谱 GLM-ASR;未配置则回退阿里云百炼 Paraformer。
const ZHIPU_KEY = process.env.ZHIPU_KEY || process.env.GLM_KEY || '';
// glm-asr-2512 是智谱当前线上可用的 ASR 模型(旧名 glm-asr 部分账户无资源包会报 1113)。
const ZHIPU_ASR_MODEL = process.env.ZHIPU_ASR_MODEL || 'glm-asr-2512';

function zhipuTranscribe(audioBuf, cb, keyOverride, modelOverride) {
  const key = keyOverride || ZHIPU_KEY;
  if (!key) { cb(new Error('未配置语音识别 Key:请在页面右上角 ✧ 菜单 → 配置 API Key')); return; }
  const model = modelOverride || ZHIPU_ASR_MODEL;
  const boundary = '----zhipu' + Date.now() + Math.floor(Math.random() * 1e6);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n${model}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, audioBuf, tail]);
  const r = https.request(
    {
      hostname: 'open.bigmodel.cn',
      path: '/api/paas/v4/audio/transcriptions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          cb(new Error(`GLM-ASR ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          cb(null, String(JSON.parse(data)?.text || '').trim());
        } catch (_) {
          cb(new Error('GLM-ASR 返回解析失败: ' + data.slice(0, 200)));
        }
      });
    }
  );
  r.on('error', (e) => cb(new Error('GLM-ASR 请求失败: ' + (e.message || e))));
  r.write(body);
  r.end();
}

// HTTP 端点（优先用带 workspace 的，回退 dashscope）
const EP = [
  { host: `${WS_ID}.cn-beijing.maas.aliyuncs.com`, path: '/api/v1/services/audio/tts/SpeechSynthesizer' },
  { host: 'dashscope.aliyuncs.com', path: '/api/v1/services/audio/text-to-speech/text-to-speech' },
];

// WebSocket（兜底方案）
let WebSocket = null;
try { WebSocket = require('ws'); } catch (_) {}

// ===== 阿里云百炼 Paraformer 录音文件识别(ASR) =====
// 流程:浏览器录音 → /api/asr 上传 → 上传到 DashScope 文件接口 → 提交转写任务 → 轮询 → 下载结果 → 返回 { text }

const ASR_MAAS_HOST = `${WS_ID}.cn-beijing.maas.aliyuncs.com`;
const ASR_FILE_HOSTS = ['dashscope.aliyuncs.com', ASR_MAAS_HOST];

function asrJsonRequest(host, path, method, headers, body, cb) {
  const opts = {
    hostname: host,
    path,
    method,
    headers: {
      Authorization: `Bearer ${ALIYUN_KEY}`,
      ...headers,
    },
  };
  const r = https.request(opts, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => cb(null, res.statusCode, data));
  });
  r.on('error', cb);
  if (body) r.write(body);
  r.end();
}

function asrGetFileUrl(host, fileId, cb) {
  // 上传只回 file_id(UUID);转写接口要可访问的 URL,故再查一次文件元信息拿 data.url(带签名的 OSS 链接)。
  asrJsonRequest(host, `/api/v1/files/${fileId}`, 'GET', {}, null, (err, status, data) => {
    if (err) { cb(err); return; }
    if (status >= 400) { cb(new Error(`get file meta ${status}: ${data.slice(0, 200)}`)); return; }
    try {
      const url = JSON.parse(data)?.data?.url;
      if (!url) { cb(new Error('file metadata has no url: ' + data.slice(0, 200))); return; }
      cb(null, url);
    } catch (e) { cb(e); }
  });
}

function asrUploadFile(audioBuf, cb) {
  const boundary = '----dashscope' + Date.now() + Math.floor(Math.random() * 1e6);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="purpose"\r\n\r\nfile-extract\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, audioBuf, tail]);

  function tryHost(i) {
    if (i >= ASR_FILE_HOSTS.length) { cb(new Error('all file hosts failed')); return; }
    const host = ASR_FILE_HOSTS[i];
    asrJsonRequest(
      host,
      '/api/v1/files',
      'POST',
      {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'X-DashScope-OssResourceResolve': 'enable',
      },
      body,
      (err, status, data) => {
        if (err) { tryHost(i + 1); return; }
        if (status >= 400) { cb(new Error(`upload ${status}: ${data.slice(0, 200)}`)); return; }
        try {
          const j = JSON.parse(data);
          const d = j?.data || {};
          // 新版 /api/v1/files 返回 data.uploaded_files[0].file_id(UUID);旧版可能直接回 data.url/oss_uri。
          const fileId = d.uploaded_files?.[0]?.file_id || d.id;
          const directUrl = d.url || d.oss_uri;
          if (directUrl) { cb(null, directUrl); return; }
          if (!fileId) { cb(new Error('upload returned no file ref: ' + data.slice(0, 200))); return; }
          // 拿到的若已是可直接访问的 URL 则直接用;否则查文件元信息取 data.url。
          if (typeof fileId === 'string' && /^https?:\/\//.test(fileId)) { cb(null, fileId); return; }
          asrGetFileUrl(host, fileId, cb);
        } catch (e) { cb(e); }
      }
    );
  }
  tryHost(0);
}

function asrSubmitTask(fileRef, cb) {
  const body = JSON.stringify({
    model: 'paraformer-v2',
    input: { file_urls: [fileRef] },
    parameters: { channel_id: [0] },
  });
  asrJsonRequest(
    ASR_MAAS_HOST,
    '/api/v1/services/audio/asr/transcription',
    'POST',
    {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    },
    body,
    (err, status, data) => {
      if (err) { cb(err); return; }
      if (status >= 400) { cb(new Error(`submit ${status}: ${data.slice(0, 300)}`)); return; }
      try {
        const j = JSON.parse(data);
        const taskId = j?.output?.task_id || j?.data?.task_id;
        if (!taskId) { cb(new Error('submit returned no task_id: ' + data.slice(0, 300))); return; }
        cb(null, taskId);
      } catch (e) { cb(e); }
    }
  );
}

function asrPollTask(taskId, cb) {
  asrJsonRequest(ASR_MAAS_HOST, `/api/v1/tasks/${taskId}`, 'GET', {}, null, (err, status, data) => {
    if (err) { cb(err); return; }
    if (status >= 400) { cb(new Error(`poll ${status}: ${data.slice(0, 300)}`)); return; }
    let j;
    try { j = JSON.parse(data); } catch (e) { cb(e); return; }
    const out = j?.output || {};
    const st = out.task_status || j?.status;
    // 无有效语音(静音/无内容)时,云端以 FAILED + code=SUCCESS_WITH_NO_VALID_RESULT 收尾;
    // 这不是错误,视为「没听清」→ 回传空文本,由前端提示重说。
    const code = String(out.code || out.results?.[0]?.code || '');
    const noVoice = code.includes('NO_VALID_RESULT') || code.includes('SUCCESS_WITH_NO');
    if (st === 'SUCCEEDED') {
      const results = out.results || [];
      const url = results?.[0]?.transcription_url || out.transcription_url || out.result?.transcription_url;
      if (!url) {
        if (noVoice) { cb(null, null); return; }
        cb(new Error('succeeded but no transcription_url: ' + data.slice(0, 300)));
        return;
      }
      cb(null, url);
    } else if (st === 'FAILED' || st === 'CANCELED') {
      if (noVoice) { cb(null, null); return; }
      cb(new Error('task ' + st + ': ' + data.slice(0, 300)));
    } else {
      // PENDING / RUNNING → 1s 后轮询
      setTimeout(() => asrPollTask(taskId, cb), 1000);
    }
  });
}

function asrExtractText(j) {
  const join = (arr) => (Array.isArray(arr) ? arr.map((t) => t?.text || t?.content?.text || '').filter(Boolean).join('') : '');
  if (Array.isArray(j?.sentences)) return join(j.sentences);
  if (Array.isArray(j?.transcripts)) return join(j.transcripts);
  if (j?.results) {
    const tr = Array.isArray(j.results) ? j.results : j.results.transcripts;
    const s = join(tr);
    if (s) return s;
  }
  if (typeof j?.text === 'string') return j.text;
  // 递归兜底:找第一个非空 text 字段
  const find = (o) => {
    if (typeof o === 'string') return o;
    if (Array.isArray(o)) { for (const x of o) { const v = find(x); if (v) return v; } return ''; }
    if (o && typeof o === 'object') {
      if (typeof o.text === 'string' && o.text.trim()) return o.text;
      for (const k of Object.keys(o)) { const v = find(o[k]); if (v) return v; }
    }
    return '';
  };
  return find(j);
}

function asrFetchResult(url, cb) {
  const getter = url.startsWith('https') ? https : http;
  getter.get(url, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      try { cb(null, asrExtractText(JSON.parse(data))); } catch (e) { cb(e); }
    });
  }).on('error', cb);
}

function asrTranscribe(audioBuf, cb) {
  asrUploadFile(audioBuf, (err, fileRef) => {
    if (err) { cb(new Error('文件上传失败: ' + (err.message || err))); return; }
    asrSubmitTask(fileRef, (err2, taskId) => {
      if (err2) { cb(new Error('识别任务提交失败: ' + (err2.message || err2))); return; }
      asrPollTask(taskId, (err3, url) => {
        if (err3) { cb(new Error('识别任务查询失败: ' + (err3.message || err3))); return; }
        if (url === null) { cb(null, ''); return; } // 无有效语音 → 空文本
        asrFetchResult(url, (err4, text) => {
          if (err4) { cb(new Error('识别结果获取失败: ' + (err4.message || err4))); return; }
          cb(null, text || '');
        });
      });
    });
  });
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/tts') {
    let responded = false;
    function done(code, ct, data) {
      if (responded) return;
      responded = true;
      res.writeHead(code, { 'Content-Type': ct });
      res.end(data);
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { text, speech_rate, pitch } = JSON.parse(body);
        if (!text) { done(400, 'application/json', '{"error":"text required"}'); return; }

        // 文本清洗：删除残留标记符号、emoji
        const cleanText = text
          .replace(/[【】\[\]《》「」""（）()]/g, '')
          .replace(/——/g, '，')
          .replace(/…{2,}/g, '。')
          .replace(/[""]/g, '')
          .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
          .replace(/关键词[：:]\s*/g, '')
          .trim();

        if (!cleanText) { done(400, 'application/json', '{"error":"empty after clean"}'); return; }

        const finalRate = speech_rate ?? 1.0;
        const finalPitch = pitch ?? 0.95;

        const ttsInput = {
          text: cleanText,
          voice: 'longanhuan_v3.6',
          format: 'mp3',
          sample_rate: 24000,
          speech_rate: finalRate,
          pitch: finalPitch,
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
            hostname: ep.host,
            path: ep.path,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${ALIYUN_KEY}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          };
          const pr = https.request(opts, (prRes) => {
            const ct = prRes.headers['content-type'] || '';
            if (ct.includes('audio') || ct.includes('octet-stream')) {
              if (responded) { prRes.destroy(); return; }
              responded = true;
              res.writeHead(200, { 'Content-Type': ct });
              prRes.pipe(res);
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
                      if (aRes.statusCode === 200) {
                        if (responded) { aRes.destroy(); return; }
                        responded = true;
                        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
                        aRes.pipe(res);
                      } else {
                        prRes.destroy();
                        tryHTTP();
                      }
                    }).on('error', () => tryHTTP());
                  } else {
                    prRes.destroy();
                    tryHTTP();
                  }
                } catch (_) {
                  prRes.destroy();
                  tryHTTP();
                }
              });
            }
          });
          pr.on('error', () => tryHTTP());
          pr.write(payload);
          pr.end();
        }

        function tryWS() {
          if (!WebSocket) {
            done(500, 'application/json', '{"error":"all_failed"}');
            return;
          }
          try {
            const ws = new WebSocket(
              `wss://${WS_ID}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`,
              { headers: { Authorization: `Bearer ${ALIYUN_KEY}` } }
            );
            const chunks = [];
            const timeout = setTimeout(() => {
              ws.close();
              done(500, 'application/json', '{"error":"timeout"}');
            }, 12000);
            ws.on('open', () =>
              ws.send(JSON.stringify({
                header: { action: 'run-task' },
                payload: {
                  model: 'qwen-audio-3.0-tts-flash',
                  task: 'tts',
                  input: { text: cleanText },
                  parameters: {
                    voice: 'longanhuan_v3.6',
                    format: 'mp3',
                    sample_rate: 24000,
                  },
                },
              }))
            );
            ws.on('message', (d) => {
              if (Buffer.isBuffer(d)) chunks.push(d);
              else {
                try {
                  const m = JSON.parse(d.toString());
                  if (m?.header?.name === 'TaskFinished') {
                    clearTimeout(timeout);
                    ws.close();
                    if (chunks.length) {
                      done(200, 'audio/mpeg', Buffer.concat(chunks));
                    } else {
                      done(500, 'application/json', '{"error":"no_audio"}');
                    }
                  }
                } catch (_) {}
              }
            });
            ws.on('error', () => {
              clearTimeout(timeout);
              done(500, 'application/json', '{"error":"ws_error"}');
            });
            ws.on('close', () => {
              clearTimeout(timeout);
              if (chunks.length && !responded) {
                responded = true;
                res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
                res.end(Buffer.concat(chunks));
              }
            });
          } catch (e) {
            res.writeHead(500);
            res.end('{"error":"ws_fail"}');
          }
        }

        tryHTTP();
      } catch (e) {
        res.writeHead(400);
        res.end('{"error":"bad_request"}');
      }
    });
    return;
  }

  // 语音识别:接收录音 blob → Paraformer 转写 → 返回 { text }
  if (req.method === 'POST' && req.url === '/api/asr') {
    let responded = false;
    function done(code, obj) {
      if (responded) return;
      responded = true;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const audioBuf = Buffer.concat(chunks);
      if (!audioBuf.length) { done(400, { error: '空音频' }); return; }
      // 浏览器带来的 Key/模型(「配置 API Key」菜单保存的)优先;未带时回退 .env.local 配置。
      const auth = String(req.headers.authorization || '');
      const browserKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const browserModel = String(req.headers['x-asr-model'] || '').trim();
      const finish = (err, text) => {
        if (err) { done(500, { error: (err.message || String(err)).slice(0, 300) }); return; }
        done(200, { text });
      };
      if (browserKey || ZHIPU_KEY) { zhipuTranscribe(audioBuf, finish, browserKey, browserModel); return; }
      asrTranscribe(audioBuf, finish);
    });
    return;
  }

  // 健康检查
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('{"ok":true}');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, () => {
  console.log(`🔮 本地语音代理 → http://localhost:${PORT}`);
  console.log(`🎙️ 语音识别: ${ZHIPU_KEY ? `智谱 GLM-ASR (${ZHIPU_ASR_MODEL})` : '阿里云百炼 Paraformer(未配置 ZHIPU_KEY)'}`);
  console.log(`🔊 语音播报: ${ALIYUN_KEY ? '阿里云百炼 qwen-audio-3.0-tts-flash' : '未配置 ALIYUN_KEY,前端自动回退浏览器朗读'}`);
});
