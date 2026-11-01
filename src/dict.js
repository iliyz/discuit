// 词典聚合：dictionaryapi.dev（英英/音标/发音）+ 腾讯云 TMT 或 MyMemory（中译）+ D1 缓存

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(str) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}
async function hmacBin(keyStr, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(msg));
}
const hmacHex = async (keyStr, msg) => hex(await hmacBin(keyStr, msg));

// 腾讯云 TMT（TC3-HMAC-SHA256 签名，Web Crypto 原生支持）
async function tmtTranslate(secretId, secretKey, text) {
  const service = 'tmt', host = 'tmt.tencentcloudapi.com';
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({ SourceText: text, Source: 'en', Target: 'zh', ProjectId: 0 });

  const canonicalReq = [
    'POST', '/', '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    await sha256Hex(payload),
  ].join('\n');

  const stringToSign = [
    'TC3-HMAC-SHA256', String(ts),
    `${date}/${service}/tc3_request`,
    await sha256Hex(canonicalReq),
  ].join('\n');

  const signature = await hmacHex(
    await hmacBin(await hmacBin(await hmacBin('TC3' + secretKey, date), service), 'tc3_request'),
    stringToSign
  );

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': 'TranslateText',
      'X-TC-Version': '2018-03-21',
      'X-Timestamp': String(ts),
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
    },
    body: payload,
  });
  const data = await res.json();
  const target = data?.Response?.Target;
  if (!target) throw new Error(data?.Response?.Error?.Message || 'TMT no target');
  return target;
}

// MyMemory 兜底（无 key）
async function myMemoryTranslate(word) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = await res.json();
  return data?.responseData?.translatedText || '';
}

async function translate(env, word) {
  if (env.TMT_SECRET_ID && env.TMT_SECRET_KEY) {
    try {
      return { translation: await tmtTranslate(env.TMT_SECRET_ID, env.TMT_SECRET_KEY, word), engine: 'tmt' };
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
