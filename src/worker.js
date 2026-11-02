import { lookupWord } from './dict.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const STATUSES = new Set(['new', 'known', 'star']);

// ---- 鉴权：/api/* 全部要求 Bearer APP_TOKEN ----
function auth(req, env) {
  if (!env.APP_TOKEN) return { ok: false, res: json({ error: 'APP_TOKEN not configured' }, 500) };
  const auth = req.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.APP_TOKEN}`) return { ok: false, res: json({ error: 'unauthorized' }, 401) };
  return { ok: true };
}

// ---- 路由 ----
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(req); // 静态资源
    }

    const a = auth(req, env);
    if (!a.ok) return a.res;

    try {
      const m = url.pathname.match(/^\/api\/words\/(\d+)$/);
      if (url.pathname === '/api/words' && req.method === 'GET')  return listWords(env);
      if (url.pathname === '/api/words' && req.method === 'POST') return addWord(env, req);
      if (m && req.method === 'PATCH')  return patchWord(env, Number(m[1]), req);
      if (m && req.method === 'DELETE') return deleteWord(env, Number(m[1]));
      if (url.pathname === '/api/lookup' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q || q.length > 64) return json({ error: 'invalid q' }, 400);
        // 设置页填的 Azure key 优先（经 X-Translator-Key 头传入，仅存在内存中转发）
        const key = req.headers.get('X-Translator-Key');
        const env2 = key ? { ...env, AZURE_TRANSLATOR_KEY: key } : env;
        return json(await lookupWord(env2, q));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};

// ---- handlers ----
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
};

// 记忆模型排序：红标记浮顶 → 未移尾在前 → 记忆层级浅在前 → 最近更新在前
const ORDER_BY = 'ORDER BY (red > 0) ASC, tail ASC, mem ASC, updated_at DESC';

async function listWords(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM words ${ORDER_BY}`).all();
  return json({ words: results });
}

async function addWord(env, req) {
  const body = await req.json().catch(() => null);
  const word = String(body?.word || '').trim().toLowerCase();
  if (!word || word.length > 64 || /[<>]/.test(word)) return json({ error: 'invalid word' }, 400);

  const info = await env.DB.prepare(
    `INSERT INTO words (word, created_at, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(word) DO NOTHING`
  ).bind(word, Date.now()).run();

  if (info.meta.changes === 0) return json({ error: 'exists' }, 409);

  // 自动补全翻译/音标/发音，再写回（同样支持 X-Translator-Key 覆盖）
  const key = req.headers.get('X-Translator-Key');
  const env2 = key ? { ...env, AZURE_TRANSLATOR_KEY: key } : env;
  const lk = await lookupWord(env2, word);
  await env.DB.prepare(
    `UPDATE words SET translation = ?1, phonetic = ?2, audio = ?3, definition = ?4, updated_at = ?5 WHERE word = ?6`
  ).bind(lk.translation, lk.phonetic, lk.audio, lk.definition, Date.now(), word).run();

  const row = await env.DB.prepare('SELECT * FROM words WHERE word = ?1').bind(word).first();
  return json({ word: row, lookup: lk }, 201);
}

async function patchWord(env, id, req) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'invalid body' }, 400);

  const sets = [], vals = [];
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return json({ error: 'invalid status' }, 400);
    sets.push('status = ?' + (vals.length + 1)); vals.push(body.status);
  }
  if (body.note !== undefined)     { sets.push('note = ?' + (vals.length + 1));        vals.push(String(body.note).slice(0, 2000)); }
  if (body.translation !== undefined) { sets.push('translation = ?' + (vals.length + 1)); vals.push(String(body.translation).slice(0, 2000)); }
  if (body.mem !== undefined) {
    const v = clampInt(body.mem, 0, 99);
    if (v === null) return json({ error: 'invalid mem' }, 400);
    sets.push('mem = ?' + (vals.length + 1)); vals.push(v);
  }
  if (body.red !== undefined) {
    const v = clampInt(body.red, 0, 99);
    if (v === null) return json({ error: 'invalid red' }, 400);
    sets.push('red = ?' + (vals.length + 1)); vals.push(v);
  }
  if (body.tail !== undefined) {
    const v = clampInt(body.tail, 0, 1);
    if (v === null) return json({ error: 'invalid tail' }, 400);
    sets.push('tail = ?' + (vals.length + 1)); vals.push(v);
  }
  if (!sets.length) return json({ error: 'nothing to update' }, 400);

  sets.push('updated_at = ?' + (vals.length + 1)); vals.push(Date.now());
  vals.push(id);
  const info = await env.DB.prepare(`UPDATE words SET ${sets.join(', ')} WHERE id = ?${vals.length}`)
    .bind(...vals).run();
  if (info.meta.changes === 0) return json({ error: 'not found' }, 404);
  const row = await env.DB.prepare('SELECT * FROM words WHERE id = ?1').bind(id).first();
  return json({ word: row });
}

async function deleteWord(env, id) {
  const info = await env.DB.prepare('DELETE FROM words WHERE id = ?1').bind(id).run();
  if (info.meta.changes === 0) return json({ error: 'not found' }, 404);
  return json({ ok: true });
}
