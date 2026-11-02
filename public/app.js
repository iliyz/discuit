/* biscuit · 前端逻辑（vanilla，无构建） */
'use strict';

const $ = (s) => document.querySelector(s);
const listEl = $('#list'), searchEl = $('#search'), lookupEl = $('#lookup'), emptyEl = $('#empty');

let words = [];
let dragMoved = false; // 本次 pointer 序列是否构成拖动（抑制 click）

/* ---------- API ---------- */
function getToken() { return localStorage.getItem('biscuit_token') || ''; }

// 口令对话框（<dialog>）：Promise 在提交时 resolve 输入值
function askToken() {
  return new Promise((resolve) => {
    const dlg = $('#token-dialog');
    const inp = $('#token-input');
    const err = $('#token-error');
    inp.value = '';
    err.classList.add('hidden');
    if (!dlg.open) dlg.showModal();
    inp.focus();
    const onSubmit = (e) => {
      e.preventDefault();
      const t = inp.value.trim();
      if (!t) { err.textContent = '口令不能为空'; err.classList.remove('hidden'); return; }
      localStorage.setItem('biscuit_token', t);
      dlg.removeEventListener('submit', onSubmit);
      dlg.close();
      resolve(t);
    };
    dlg.addEventListener('submit', onSubmit);
  });
}

async function api(path, opts = {}, _retried = false) {
  if (!getToken()) await askToken();
  opts.headers = { Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) };
  if (opts.body) opts.headers['Content-Type'] = 'application/json';
  const res = await fetch(path, opts);
  if (res.status === 401) {
    localStorage.removeItem('biscuit_token');
    if (_retried) throw new Error('unauthorized');
    await askToken();
    return api(path, opts, true); // 最多重试一次
  }
  return res;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- 发音 ---------- */
function speak(word, audioUrl) {
  const trySynth = () => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  const url = audioUrl || `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(word)}`;
  const a = new Audio(url);
  a.play().catch(trySynth);
}

/* ---------- 渲染 ---------- */
const ORDER = { star: 0, new: 1, known: 2 };
function sortWords() {
  words.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.updated_at - a.updated_at));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function closePanel(card) {
  card.classList.remove('open');
  card.querySelector('.flip-panel')?.classList.add('hidden');
}

function togglePanel(card) {
  const panel = card.querySelector('.flip-panel');
  const isOpen = !panel.classList.contains('hidden');
  // 同一时间只展开一个
  document.querySelectorAll('.card.open').forEach(c => closePanel(c));
  if (isOpen) return; // 再点一次=收起
  card.classList.add('open');
  panel.classList.remove('hidden');
}

function render() {
  listEl.textContent = '';
  emptyEl.classList.toggle('hidden', words.length > 0);

  for (const w of words) {
    const card = el('li', `card ${w.status}`);
    card.dataset.id = w.id;

    // 行：word + 音标 + 状态徽标
    const row = el('div', 'row');
    const left = el('div');
    left.appendChild(el('span', 'w', w.word));
    if (w.phonetic) left.appendChild(el('span', 'p', w.phonetic));
    row.appendChild(left);
    row.appendChild(el('span', 'badge', w.status === 'star' ? '⭐' : w.status === 'known' ? '✓' : ''));

    const hintL = el('div', 'hint left');
    const hintR = el('div', 'hint right');
    row.append(hintL, hintR);

    // 翻转浮层：锚在行顶、同宽、覆盖在列表之上（不挤压列表）
    const panel = el('div', 'flip-panel hidden');
    const head = el('div', 'fp-head');
    const hLeft = el('div');
    hLeft.appendChild(el('span', 'w', w.word));
    if (w.phonetic) hLeft.appendChild(el('span', 'p', w.phonetic));
    head.appendChild(hLeft);
    head.appendChild(el('span', 'badge', '收起 ▲'));
    head.addEventListener('click', () => closePanel(card)); // 点回单词行的位置 → 翻回

    const body = el('div', 'fp-body');
    if (w.translation) {
      const t = el('div', 't', w.translation);
      t.title = '单击修改译文；长按/拖选可复制';
      t.addEventListener('click', () => {
        const sel = String(window.getSelection() || '');
        if (sel.length) return; // 正在选中文本，不触发编辑
        editTranslation(w);
      });
      body.appendChild(t);
    }
    if (w.definition)  body.appendChild(el('div', 'd', w.definition));
    if (w.note)        body.appendChild(el('div', 'n', `📝 ${w.note}`));
    if (!w.translation && !w.definition && !w.note) {
      const d = el('div', 'd', '暂无译文，点击添加');
      d.addEventListener('click', () => editTranslation(w));
      body.appendChild(d);
    }

    panel.append(head, body);
    card.append(row, panel);
    bindCard(card, w);
    listEl.appendChild(card);
  }
}

/* ---------- 手势 + 点击（Pointer Events 统一触摸/鼠标） ---------- */
const DRAG_MIN = 10;        // 触发拖动阈值
const MARK = 44;            // 标记阈值
const DELETE_AT = 130;      // 左滑删除阈值

function bindCard(card, w) {
  const row = card.querySelector('.row');
  const hintL = card.querySelector('.hint.left');
  const hintR = card.querySelector('.hint.right');
  let startX = 0, startY = 0, dx = 0, active = false;

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.flip-panel')) return; // 浮层用于阅读/选择复制
    startX = e.clientX; startY = e.clientY; dx = 0; active = true; dragMoved = false;
    card.setPointerCapture(e.pointerId);
  });

  card.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragMoved && Math.abs(dx) > DRAG_MIN && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dragMoved = true;
      row.classList.add('swiping');
    }
    if (!dragMoved) return;
    row.style.transform = `translateX(${dx}px)`;
    const del = dx < -DELETE_AT;
    hintL.textContent = del ? '🗑 删除' : '✓ 认识';
    hintL.classList.toggle('show', dx < -MARK);
    hintR.textContent = '⭐ 重点';
    hintR.classList.toggle('show', dx > MARK);
  });

  const finish = async () => {
    if (!active) return;
    active = false;
    if (!dragMoved) { return; }
    row.classList.remove('swiping');
    hintL.classList.remove('show'); hintR.classList.remove('show');
    row.style.transform = '';

    if (dx < -DELETE_AT) {
      card.classList.add('removing');
      const res = await api(`/api/words/${w.id}`, { method: 'DELETE' });
      if (res.ok) {
        words = words.filter(x => x.id !== w.id);
        toast(`已删除 ${w.word} 🍪`);
        setTimeout(render, 250);
      } else { card.classList.remove('removing'); toast('删除失败'); }
    } else if (dx < -MARK) {
      setStatus(w, w.status === 'known' ? 'new' : 'known');
    } else if (dx > MARK) {
      setStatus(w, w.status === 'star' ? 'new' : 'star');
    }
  };

  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', () => {
    active = false;
    row.classList.remove('swiping');
    row.style.transform = '';
  });

  // 点击：浮层内不处理；行内左 1/3 发音、中翻转、右 1/3 笔记
  card.addEventListener('click', (e) => {
    if (dragMoved) { dragMoved = false; return; }
    if (e.target.closest('.flip-panel')) return; // 浮层有自己的点击逻辑
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) {
      speak(w.word, w.audio);
    } else if (x < rect.width * 2 / 3) {
      togglePanel(card);
    } else {
      const note = prompt('自定义笔记/释义（留空清除）', w.note || '');
      if (note === null) return;
      api(`/api/words/${w.id}`, { method: 'PATCH', body: JSON.stringify({ note }) })
        .then(r => r.json()).then(({ word: nw }) => {
          if (!nw) return;
          Object.assign(w, nw);
          render();
          if (note) toast('笔记已保存');
        });
    }
  });
}

async function setStatus(w, status) {
  const res = await api(`/api/words/${w.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (res.ok) {
    const { word: nw } = await res.json();
    Object.assign(w, nw);
    sortWords();
    render();
  } else toast('更新失败');
}

async function editTranslation(w) {
  const t = prompt('修改译文', w.translation || '');
  if (t === null) return;
  const res = await api(`/api/words/${w.id}`, { method: 'PATCH', body: JSON.stringify({ translation: t }) });
  if (res.ok) {
    const { word: nw } = await res.json();
    Object.assign(w, nw);
    render();
    toast('译文已更新');
  } else toast('更新失败');
}

/* ---------- 搜索 / 自动补全 / 添加 ---------- */
let debounceTimer, lastQuery = '';

searchEl.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = searchEl.value.trim().toLowerCase();
  if (!q || q === lastQuery) { if (!q) hideLookup(); return; }
  debounceTimer = setTimeout(() => doLookup(q), 350);
});

async function doLookup(q) {
  const res = await api(`/api/lookup?q=${encodeURIComponent(q)}`);
  if (!res.ok) return;
  const data = await res.json();
  lastQuery = q;
  lookupEl.textContent = '';

  const item = el('div', 'item');
  item.setAttribute('role', 'option');
  const head = el('div');
  head.appendChild(el('span', 'w', data.word));
  if (data.phonetic) head.appendChild(el('span', 'p', data.phonetic));
  item.appendChild(head);
  if (data.translation) item.appendChild(el('div', 't', data.translation));
  if (data.definition)  item.appendChild(el('div', 'd', data.definition));
  item.addEventListener('click', () => addWord(data.word));
  lookupEl.appendChild(item);
  lookupEl.classList.remove('hidden');
}

function hideLookup() { lookupEl.classList.add('hidden'); lookupEl.textContent = ''; }

document.addEventListener('click', (e) => {
  if (!e.target.closest('header')) hideLookup();
});

searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchEl.value.trim()) {
    addWord(searchEl.value.trim().toLowerCase());
  }
});

async function addWord(raw) {
  const word = raw.trim().toLowerCase();
  if (!word) return;
  const res = await api('/api/words', { method: 'POST', body: JSON.stringify({ word }) });
  if (res.status === 409) {
    toast(`「${word}」已在饼干盒里`);
    const i = words.findIndex(w => w.word === word);
    if (i >= 0) listEl.children[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hideLookup(); searchEl.value = ''; lastQuery = '';
    return;
  }
  if (!res.ok) { toast('添加失败'); return; }
  const { word: nw } = await res.json();
  words.unshift(nw);
  sortWords();
  render();
  hideLookup(); searchEl.value = ''; lastQuery = '';
  toast(`已收入 ${word} 🍪`);
}

/* ---------- 启动 ---------- */
async function boot() {
  const cached = localStorage.getItem('biscuit_words');
  if (cached) { try { words = JSON.parse(cached); render(); } catch {} }

  try {
    const res = await api('/api/words');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    words = data.words;
    render();
    localStorage.setItem('biscuit_words', JSON.stringify(words));
  } catch (e) {
    if (e.message === 'unauthorized') emptyEl.textContent = '口令不正确，刷新页面重试';
    else if (words.length) toast('离线中，显示缓存数据');
    else emptyEl.textContent = '加载失败，检查网络后重试';
  }
}

// Service Worker 注册（仅 https/localhost）
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
