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
        return json(await lookupWord(env, q));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};

// ---- handlers ----
const ORDER_BY = `ORDER BY CASE status WHEN 'star' THEN 0 WHEN 'new' THEN 1 ELSE 2 END, updated_at DESC`;

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

  // 自动补全翻译/音标/发音，再写回
  const lk = await lookupWord(env, word);
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
