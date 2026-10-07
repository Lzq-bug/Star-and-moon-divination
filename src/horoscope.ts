/**
 * horoscope.ts — 今日星象 agent
 *
 * 使用「配置 API Key」里保存的同一套配置(localStorage tarot.*,
 * 回退 .env.local 注入的默认值)调用大模型,生成今日星座运势卡片。
 *  - 每个星座每天只算一次,结果缓存当日复用(不重复扣量)。
 *  - 生成的卡片自动存入「能量档案」(localStorage horoscope.archive)。
 */
import { DEFAULT_MODEL_ID, DEFAULT_BASE_URL, DEFAULT_API_KEY, resolveBaseUrl } from "./agent/setup";

export interface HoroscopeCard {
  kind?: "horoscope";
  date: string; // YYYY-MM-DD
  sign: string; // 星座名
  title: string;
  symbol: string;
  keywords: string[];
  message: string;
  luckyColor: string;
  luckyNumber: number | string;
  advice: string;
  generatedAt: number;
}

/** 塔罗占卜结尾生成的纪念藏品卡(本地展示,无链上动作) */
export interface TarotArchiveCard {
  kind: "tarot";
  date: string;
  name: string;
  rarity: string;
  motif: string;
  serial: string;
  tokenId: string;
  generatedAt: number;
}

export type ArchiveEntry = HoroscopeCard | TarotArchiveCard;

export const ZODIAC_SIGNS: { name: string; symbol: string; range: string }[] = [
  { name: "白羊座", symbol: "♈", range: "3.21-4.19" },
  { name: "金牛座", symbol: "♉", range: "4.20-5.20" },
  { name: "双子座", symbol: "♊", range: "5.21-6.21" },
  { name: "巨蟹座", symbol: "♋", range: "6.22-7.22" },
  { name: "狮子座", symbol: "♌", range: "7.23-8.22" },
  { name: "处女座", symbol: "♍", range: "8.23-9.22" },
  { name: "天秤座", symbol: "♎", range: "9.23-10.23" },
  { name: "天蝎座", symbol: "♏", range: "10.24-11.22" },
  { name: "射手座", symbol: "♐", range: "11.23-12.21" },
  { name: "摩羯座", symbol: "♑", range: "12.22-1.19" },
  { name: "水瓶座", symbol: "♒", range: "1.20-2.18" },
  { name: "双鱼座", symbol: "♓", range: "2.19-3.20" },
];

const CACHE_PREFIX = "horoscope.cache.";
const ARCHIVE_KEY = "horoscope.archive";
const ARCHIVE_LIMIT = 60;

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 与 TarotSession 相同的取 key 逻辑:localStorage 优先,回退 .env.local 默认值 */
function getConfig(): { apiKey: string; baseUrl: string; modelId: string } {
  const apiKey = (localStorage.getItem("tarot.apiKey") ?? "").trim() || DEFAULT_API_KEY;
  const baseUrl = (localStorage.getItem("tarot.baseUrl") ?? "").trim() || DEFAULT_BASE_URL;
  const modelId = (localStorage.getItem("tarot.modelId") ?? "").trim() || DEFAULT_MODEL_ID;
  return { apiKey, baseUrl, modelId };
}

/** 当日缓存:同一星座当天直接复用,不再请求 */
export function getCachedHoroscope(sign: string): HoroscopeCard | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + todayKey() + "." + sign);
    return raw ? (JSON.parse(raw) as HoroscopeCard) : null;
  } catch {
    return null;
  }
}

/** 能量档案:新卡插到最前,超出上限裁掉最旧的 */
export function loadArchive(): ArchiveEntry[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    const list = raw ? (JSON.parse(raw) as ArchiveEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function pushArchive(entry: ArchiveEntry, dedupeKey: string | null): void {
  try {
    let list = loadArchive();
    if (dedupeKey) {
      list = list.filter((c) => {
        const key =
          c.kind === "tarot" || !("sign" in c)
            ? null
            : `${(c.kind ?? "horoscope")}:${c.date}:${c.sign}`;
        return key !== dedupeKey;
      });
    }
    list.unshift(entry);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, ARCHIVE_LIMIT)));
  } catch {
    /* 存储满了等异常静默 */
  }
}

function saveToArchive(card: HoroscopeCard): void {
  const withKind: HoroscopeCard = { ...card, kind: "horoscope" };
  pushArchive(withKind, `horoscope:${card.date}:${card.sign}`);
}

/** 塔罗占卜纪念卡入档(每次占卜都会新增一条) */
export function saveTarotCard(input: {
  name: string;
  rarity: string;
  motif: string;
  serial: string;
  tokenId: string;
}): void {
  pushArchive(
    { kind: "tarot", date: todayKey(), generatedAt: Date.now(), ...input },
    null,
  );
}

export function clearArchive(): void {
  localStorage.removeItem(ARCHIVE_KEY);
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 调用大模型生成今日星象。缓存命中直接返回;
 * 失败抛错(由调用方展示"重新观测"等提示)。
 */
export async function generateHoroscope(sign: string): Promise<HoroscopeCard> {
  const cached = getCachedHoroscope(sign);
  if (cached) return cached;

  const { apiKey, baseUrl, modelId } = getConfig();
  if (!apiKey) throw new Error("未配置 API Key:请点右上角 ✧ 菜单 → 配置 API Key");

  const date = todayKey();
  const meta = ZODIAC_SIGNS.find((z) => z.name === sign);
  const systemPrompt =
    "你是「星语」占星馆的占星师,温柔、睿智、有仪式感,全程使用中文。" +
    "根据今天的日期与用户星座推算今日运势,必须只输出一个 JSON 对象(禁止 markdown 代码块、禁止多余解释)," +
    '格式:{"title":"今日运势标题,12字内","symbol":"一个占星符号或 emoji",' +
    '"keywords":["关键词1","关键词2","关键词3"],' +
    '"message":"80-150字的今日运势解读,第二人称,结合星象给出具体指引,温柔神秘", ' +
    '"luckyColor":"今日幸运色","luckyNumber":一个1到9的整数,' +
    '"advice":"20字内的一句行动建议"}';
  const userPrompt = `今天是 ${date}。我的星座是 ${sign}${meta ? `(${meta.range})` : ""}。请推算我的今日星象运势。`;

  const url = resolveBaseUrl(baseUrl) + "/chat/completions";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 60000);
  let content = "";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      let msg = `星象观测失败(${resp.status})`;
      try {
        const j = await resp.json();
        if (j?.error?.message) msg = `星象观测失败:${j.error.message}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const j = await resp.json();
    content = String(j?.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("观测超时了,星象云层太厚,请重试一次");
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    window.clearTimeout(timer);
  }

  const parsed = extractJson(content);
  const card: HoroscopeCard = parsed
    ? {
        date,
        sign,
        title: String(parsed.title ?? `${sign}·今日星象`).slice(0, 30),
        symbol: String(parsed.symbol ?? "☾").slice(0, 4) || "☾",
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.map((k) => String(k)).slice(0, 3)
          : [],
        message: String(parsed.message ?? content).slice(0, 400),
        luckyColor: String(parsed.luckyColor ?? "星尘银").slice(0, 12),
        luckyNumber: typeof parsed.luckyNumber === "number" ? parsed.luckyNumber : String(parsed.luckyNumber ?? "✦"),
        advice: String(parsed.advice ?? "").slice(0, 60),
        generatedAt: Date.now(),
      }
    : {
        date,
        sign,
        title: `${sign}·今日星象`,
        symbol: "☾",
        keywords: [],
        message: content.slice(0, 400) || "星象朦胧,今天适合静心感受,答案会自己浮现。",
        luckyColor: "星尘银",
        luckyNumber: "✦",
        advice: "静观其变。",
        generatedAt: Date.now(),
      };

  localStorage.setItem(CACHE_PREFIX + date + "." + sign, JSON.stringify(card));
  saveToArchive(card);
  return card;
}
