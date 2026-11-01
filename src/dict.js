// 词典聚合：dictionaryapi.dev（英英/音标/发音）+ 翻译链 Azure → 百度 → MyMemory + D1 缓存

import md5 from 'js-md5';

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

// Azure AI Translator F0：200 万字符/月永久免费，超额拒绝请求不产生费用
// 全局端点 + Ocp-Apim-Subscription-Region 头；简体中文为 zh-Hans
async function azureTranslate(env, q) {
  const res = await fetch('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=zh-Hans', {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env.AZURE_TRANSLATOR_KEY,
      'Ocp-Apim-Subscription-Region': env.AZURE_TRANSLATOR_REGION,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify([{ Text: q }]),
  });
  if (!res.ok) throw new Error(`azure ${res.status}`);
  const data = await res.json();
  return data?.[0]?.translations?.[0]?.text || '';
}

// 百度翻译开放平台：标准版免费 5 万字符/月，个人认证后 100 万字符/月
// 签名 = md5(appid + q + salt + secret)，MD5 由 js-md5 提供（Web Crypto 不支持 MD5）
async function baiduTranslate(env, q) {
  const salt = String(Date.now());
  const sign = md5(`${env.BAIDU_APPID}${q}${salt}${env.BAIDU_SECRET}`);
  const res = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q, from: 'en', to: 'zh', appid: env.BAIDU_APPID, salt, sign }),
  });
  const data = await res.json();
  if (data.error_code) throw new Error(`baidu ${data.error_code}: ${data.error_msg}`);
  return (data.trans_result || []).map(r => r.dst).join('\n');
}

// MyMemory 兜底（无 key）
async function myMemoryTranslate(word) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = await res.json();
  return data?.responseData?.translatedText || '';
}

// 翻译引擎链：按已配置的 key 自动选择，全部失败用 MyMemory
async function translate(env, word) {
  if (env.AZURE_TRANSLATOR_KEY) {
    try { return { translation: await azureTranslate(env, word), engine: 'azure' }; } catch { /* 下一级 */ }
  }
  if (env.BAIDU_APPID && env.BAIDU_SECRET) {
    try {
      return { translation: await baiduTranslate(env, word), engine: 'baidu' };
    } catch { /* 落到 MyMemory */ }
  }
  return { translation: await myMemoryTranslate(word), engine: 'mymemory' };
}

// 英英词典：释义/音标/真人发音 mp3
async function enDict(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) return null; // 404 = 词典未收录（生僻词/专名），不算错误
  const arr = await res.json();
  const first = Array.isArray(arr) ? arr[0] : null;
  if (!first) return null;
  const audio = (first.phonetics || []).find(p => p.audio)?.audio || '';
  const definition = (first.meanings || [])
    .map(m => `${m.partOfSpeech}. ${(m.definitions || []).map(d => d.definition).join('; ')}`)
    .join('\n')
    .slice(0, 2000);
  return { phonetic: first.phonetic || (first.phonetics || []).find(p => p.text)?.text || '', audio, definition };
}

// 主入口：查词（带 D1 缓存），始终返回对象，不抛异常
export async function lookupWord(env, rawWord) {
  const word = rawWord.trim().toLowerCase();
  if (!word) return { word, phonetic: '', audio: '', translation: '', definition: '', cached: false };

  const cached = await env.DB.prepare('SELECT payload, fetched_at FROM dict_cache WHERE word = ?1')
    .bind(word).first();
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return { ...JSON.parse(cached.payload), cached: true };
  }

  const [en, tr] = await Promise.all([enDict(word).catch(() => null), translate(env, word)]);

  const result = {
    word,
    phonetic: en?.phonetic || '',
    audio: en?.audio || '',
    definition: en?.definition || '',
    translation: tr.translation || '',
    engine: tr.engine,
    cached: false,
  };

  await env.DB.prepare(
    'INSERT INTO dict_cache (word, payload, fetched_at) VALUES (?1, ?2, ?3) ON CONFLICT(word) DO UPDATE SET payload = ?2, fetched_at = ?3'
  ).bind(word, JSON.stringify(result), Date.now()).run();

  return result;
}
