/**
 * test_voice.cjs — longanhuan_v3.6 A/B 第二次
 * A = 默认 (speech_rate 1.0)
 * B = 带 instruction="温暖、笃定，带一点笑意"
 * C = 口语化文本 + speech_rate 1.0（无 instruction）
 *
 * 结论写回 serve.cjs 注释
 */
const https = require('https');
const http = require('http');
const fs = require('fs');

const path = require('path');
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
const KEY = process.env.ALIYUN_KEY || '';
const WS_ID = process.env.ALIYUN_WS_ID || '';
const HOST = `${WS_ID}.cn-beijing.maas.aliyuncs.com`;
const PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const T = '先看过去这张牌，宝剑王牌逆了位，那阵子你被一些看不清的东西困住了。';

function syn(label, body, cb) {
  const p = JSON.stringify(body);
  const req = https.request({ hostname: HOST, path: PATH, method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) },
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(d);
        const url = j?.output?.audio?.url;
        if (url) {
          const g = url.startsWith('https') ? https.get : http.get;
          g(url, (a) => { const c = []; a.on('data', x => c.push(x)); a.on('end', () => { fs.writeFileSync(`${label}.mp3`, Buffer.concat(c)); console.log(`  ${label}.mp3 ${Buffer.concat(c).length} bytes`); cb(); }); });
        } else { console.log(`  ${label}:`, d.slice(0, 100)); cb(); }
      } catch (_) { console.log(`  ${label} err`); cb(); }
    });
  });
  req.on('error', e => { console.log(`  ${label}:`, e.message); cb(); });
  req.write(p); req.end();
}

console.log('=== longanhuan_v3.6 A/B ===\n');
const base = { model: 'qwen-audio-3.0-tts-flash', input: { text: T, voice: 'longanhuan_v3.6', format: 'mp3', sample_rate: 24000 } };
syn('A', base, () => {
  syn('B', { ...base, input: { ...base.input, instruction: '温暖、笃定，带一点笑意' } }, () => {
    syn('C', { ...base, input: { ...base.input, speech_rate: 1.0 } }, () => {
      console.log('\n✅ 生成完毕');
    });
  });
});
