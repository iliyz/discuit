/* biscuit · 前端逻辑（vanilla，无构建） */
'use strict';

const $ = (s) => document.querySelector(s);
const listEl = $('#list'), searchEl = $('#search'), lookupEl = $('#lookup'), emptyEl = $('#empty');

let words = [];
let dragMoved = false; // 本次 pointer 序列是否构成拖动（抑制 click）

/* ---------- 设置（存本机 localStorage） ---------- */
const BISCUIT_GREEN = '#36ab60';
const SETTINGS_KEY = 'biscuit_settings';
const DEFAULT_SETTINGS = {
  glyph: BISCUIT_GREEN,          // ▛/▟ 颜色
  zone1: 33,                     // 左|中 分界 %
  zone2: 67,                     // 中|右 分界 %
  fns: ['speak', 'flip', 'edit'],// 左/中/右 功能
  rowBg: BISCUIT_GREEN,          // 词条默认背景（biscuit 绿）
  rowText: '#ffffff',            // 词条默认文字
  panelBg: '#ffffff',            // 释义窗口背景
  redColor: '#e0524d',           // 红标记色块
  maxMarks: 3,                   // 最大标记次数：右滑大距离累计次数上限，深度 = red/(3*maxMarks)
  voice: 'native',               // 发音源：native=真人 mp3 优先，tts=设备合成
  maxMem: 1,                     // a：最大记忆次数单位，最深 3a 层
  apiProvider: 'azure',
  apiKey: '',
};
let S = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...saved, fns: [...(saved.fns || DEFAULT_SETTINGS.fns)] };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); applySettings(); }

// 颜色混合 a→b，t∈[0,1]
function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const q = (x, y) => Math.round(x + (y - x) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0');
  return `#${q(r1, r2)}${q(g1, g2)}${q(b1, b2)}`;
}

// 记忆层级 → 颜色：0=biscuit 绿底，2a 起白底；文字 浅灰→灰→黑
function memColors(mem) {
  const a = Math.max(1, S.maxMem);
  const m = Math.min(mem || 0, 3 * a);
  const bg = mixHex(S.rowBg, '#ffffff', m / (2 * a));
  let text;
  if (m <= a)          text = mixHex(S.rowText, '#bdbdbd', m / a);
  else if (m <= 2 * a) text = mixHex('#bdbdbd', '#8f8f8f', (m - a) / a);
  else                 text = mixHex('#8f8f8f', '#111111', (m - 2 * a) / a);
  return { bg, text };
}

function applySettings() {
  document.documentElement.style.setProperty('--glyph', S.glyph);
  document.documentElement.style.setProperty('--panel-bg', S.panelBg);
}

/* ---------- API ---------- */
function getToken() { return localStorage.getItem('biscuit_token') || ''; }

// 登录界面（<dialog> 全屏绿）：Promise 在提交时 resolve 输入值
// withError=true 时以红描边抖动打开（口令不对重开）；不显示任何文字提示
function askToken(withError = false) {
  return new Promise((resolve) => {
    const dlg = $('#token-dialog');
    const inp = $('#token-input');
    inp.value = '';
    if (withError) {
      // 重新触发动画：先移除类，下一帧再加回
      dlg.classList.remove('error');
      void dlg.offsetWidth;
      dlg.classList.add('error');
    }
    if (!dlg.open) dlg.showModal();
    inp.focus();
    inp.oninput = () => dlg.classList.remove('error');
    const onSubmit = (e) => {
      e.preventDefault();
      const t = inp.value.trim();
      if (!t) {
        dlg.classList.remove('error');
        void dlg.offsetWidth;
        dlg.classList.add('error');
        return;
      }
      localStorage.setItem('biscuit_token', t); // 立即持久化，刷新后免重登
      dlg.onsubmit = null;
      dlg.classList.remove('error');
      dlg.close();
      resolve(t);
    };
    dlg.onsubmit = onSubmit; // 用 onsubmit 覆盖式绑定，避免重复 askToken 时监听器叠加
  });
}

async function api(path, opts = {}, _retried = false) {
  if (!getToken()) await askToken();
  opts.headers = { Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) };
  if (opts.body) opts.headers['Content-Type'] = 'application/json';
  if (S.apiProvider === 'azure' && S.apiKey) opts.headers['X-Translator-Key'] = S.apiKey;
  const res = await fetch(path, opts);
  if (res.status === 401) {
    localStorage.removeItem('biscuit_token');
    if (_retried) throw new Error('unauthorized');
    await askToken(true);
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
  if (S.voice === 'tts') { trySynth(); return; }
  const url = audioUrl || `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(word)}`;
  const a = new Audio(url);
  a.play().catch(trySynth);
}

/* ---------- 渲染 ---------- */
// 与服务端 ORDER BY 一致：红标记浮顶 → 未移尾在前 → 记忆浅在前 → 最近更新在前
function sortWords() {
  words.sort((a, b) => {
    const ra = (a.red > 0 ? 0 : 1) - (b.red > 0 ? 0 : 1);
    if (ra) return ra;
    if ((a.tail || 0) !== (b.tail || 0)) return (a.tail || 0) - (b.tail || 0);
    if ((a.mem || 0) !== (b.mem || 0)) return (a.mem || 0) - (b.mem || 0);
    return b.updated_at - a.updated_at;
  });
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
    const card = el('li', 'card');
    card.dataset.id = w.id;

    // 行：word + 音标 + 红标块；背景/文字颜色由记忆层级决定
    const row = el('div', 'row');
    const c = memColors(w.mem);
    row.style.background = c.bg;
    row.style.color = c.text;
    const left = el('div');
    left.appendChild(el('span', 'w', w.word));
    if (w.phonetic) left.appendChild(el('span', 'p', w.phonetic));
    row.appendChild(left);
    if (w.red > 0) {
      // 红标块不显示数字，深度随标记量连续变化：maxMarks 次右滑到底 = 纯红，左轻滑逐级减淡
      const depth = Math.min(1, w.red / (3 * Math.max(1, S.maxMarks)));
      const rb = el('div', 'redblock');
      rb.style.background = mixHex('#ffffff', S.redColor, depth);
      row.appendChild(rb);
      row.style.paddingRight = '26px';
    }

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
const DRAG_MIN = 10;   // 触发拖动阈值
const LIGHT = 44;      // 轻滑阈值（大距离阈值 bigAt 在 bindCard 内按行宽自适应）

function bindCard(card, w) {
  const row = card.querySelector('.row');
  const hintL = card.querySelector('.hint.left');
  const hintR = card.querySelector('.hint.right');
  let startX = 0, startY = 0, dx = 0, active = false;
  let totalMove = 0; // 本次 pointer 序列累计位移（>8px 一律不算点击）
  let bigAt = 140;   // 「大距离」阈值：随行宽自适应，防止手机上普通轻滑被误判成移到底部

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.flip-panel')) return; // 浮层用于阅读/选择复制
    startX = e.clientX; startY = e.clientY; dx = 0; active = true; dragMoved = false;
    totalMove = 0;
    bigAt = Math.max(140, card.getBoundingClientRect().width * 0.5);
    try { card.setPointerCapture(e.pointerId); } catch {}
  });

  card.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    totalMove = Math.max(totalMove, Math.hypot(dx, dy));
    // 手指滑动普遍带垂直分量，阈值放宽到 0.9 倍
    if (!dragMoved && Math.abs(dx) > DRAG_MIN && Math.abs(dx) > Math.abs(dy) * 0.9) {
      dragMoved = true;
      row.classList.add('swiping');
    }
    if (!dragMoved) return;
    row.style.transform = `translateX(${dx}px)`;
    hintL.textContent = dx < -bigAt ? '⤓ 底部' : '＋1 记住';
    hintL.classList.toggle('show', dx < -LIGHT);
    hintR.textContent = dx > bigAt ? '⚑ 标记' : '－1';
    hintR.classList.toggle('show', dx > LIGHT);
  });

  const finish = async (ev) => {
    if (!active) return;
    active = false;
    // 用 pointerup 的最终坐标判定：快速甩动时最后一次 pointermove 的位移可能远落后于真实落点
    if (ev && ev.clientX) {
      dx = ev.clientX - startX;
      totalMove = Math.max(totalMove, Math.hypot(dx, ev.clientY - startY));
    }
    if (!dragMoved) { return; }
    row.classList.remove('swiping');
    hintL.classList.remove('show'); hintR.classList.remove('show');
    row.style.transform = '';

    if (dx <= -bigAt) {
      // 左滑大距离：移到列表尾部
      patchWord(w, { tail: 1 }).then(() => toast(`${w.word} 已移到底部`));
    } else if (dx <= -LIGHT) {
      // 左滑轻：先抵消红标记（3 次轻滑抵 1 次，红块随之逐级减淡），否则记忆 +1（颜色变浅）
      if (w.red > 0) {
        const nr = Math.max(0, w.red - 1);
        patchWord(w, { red: nr }).then(() => toast(nr === 0 ? '标记已清零' : `标记减淡（再 ${nr} 次轻滑抵完）`));
      } else {
        const nm = Math.min(3 * S.maxMem, (w.mem || 0) + 1);
        patchWord(w, { mem: nm }).then(() => toast(nm >= 3 * S.maxMem ? `${w.word} 已记满（${nm}/${3 * S.maxMem}）` : `${w.word} 记住 +1（${nm}/${3 * S.maxMem}）`));
      }
    } else if (dx >= bigAt) {
      // 右滑大距离：红标记 +1（服务端以 1/3 为单位存储），深度由 maxMarks 控制
      const nr = Math.min(3 * Math.max(1, S.maxMarks), (w.red || 0) + 3);
      patchWord(w, { red: nr }).then(() => toast(nr >= 3 * S.maxMarks ? `⚑ 标记已满（${S.maxMarks}/${S.maxMarks}）` : `⚑ 标记 ${Math.round(nr / 3)}/${S.maxMarks}`));
    } else if (dx >= LIGHT) {
      // 右滑轻：记忆 -1（颜色变深回绿）
      const nm = Math.max(0, (w.mem || 0) - 1);
      patchWord(w, { mem: nm }).then(() => toast(`记住 -1（${nm}/${3 * S.maxMem}）`));
    }
  };

  card.addEventListener('pointerup', finish);
  // 手机上手指带垂直分量时浏览器会接管滚动并触发 pointercancel：
  // 若拖动已成立则按最后位移完成手势，避免滑动被静默丢弃
  card.addEventListener('pointercancel', (e) => {
    if (active && dragMoved) finish(e);
    active = false;
    row.classList.remove('swiping');
    row.style.transform = '';
  });

  // 点击：浮层内不处理；行内按设置的比例和功能分区
  card.addEventListener('click', (e) => {
    if (dragMoved || totalMove > 8) { dragMoved = false; return; }
    if (e.target.closest('.flip-panel')) return; // 浮层有自己的点击逻辑
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const b1 = rect.width * S.zone1 / 100;
    const b2 = rect.width * S.zone2 / 100;
    const act = x < b1 ? S.fns[0] : x < b2 ? S.fns[1] : S.fns[2];
    if (act === 'speak') {
      speak(w.word, w.audio);
    } else if (act === 'flip') {
      togglePanel(card);
    } else {
      const note = prompt('自定义笔记/释义（留空清除）', w.note || '');
      if (note === null) return;
      patchWord(w, { note });
      if (note) toast('笔记已保存');
    }
  });
}

async function patchWord(w, patch) {
  const res = await api(`/api/words/${w.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
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

/* ---------- 设置界面交互 ---------- */
const settingsEl = $('#settings');
$('#menu-btn').addEventListener('click', () => { syncSettingsUI(); settingsEl.classList.remove('hidden'); });
$('#back-btn').addEventListener('click', () => settingsEl.classList.add('hidden'));

function syncSettingsUI() {
  document.querySelectorAll('#glyph-swatches .swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.v === S.glyph);
    b.onclick = () => { S.glyph = b.dataset.v; saveSettings(); syncSettingsUI(); };
  });
  [['#fn-left', 0], ['#fn-mid', 1], ['#fn-right', 2]].forEach(([sel, i]) => { $(sel).value = S.fns[i]; });
  $('#zone1').value = S.zone1; $('#zone1v').textContent = `左 ${S.zone1}%｜中 ${S.zone2 - S.zone1}%`;
  $('#zone2').value = S.zone2; $('#zone2v').textContent = `中 ${S.zone2 - S.zone1}%｜右 ${100 - S.zone2}%`;
  $('#c-rowbg').value = S.rowBg; $('#c-rowtext').value = S.rowText;
  $('#c-panel').value = S.panelBg; $('#c-red').value = S.redColor;
  $('#maxmem').value = S.maxMem;
  $('#maxmarks').value = S.maxMarks;
  $('#voice-src').value = S.voice;
  $('#api-provider').value = S.apiProvider;
  $('#api-key').value = S.apiKey;
}

function bindSettings() {
  [['#fn-left', 0], ['#fn-mid', 1], ['#fn-right', 2]].forEach(([sel, i]) => {
    $(sel).addEventListener('change', (e) => { S.fns[i] = e.target.value; saveSettings(); });
  });
  $('#zone1').addEventListener('input', (e) => {
    S.zone1 = Math.min(Number(e.target.value), S.zone2 - 10);
    e.target.value = S.zone1; saveSettings(); syncSettingsUI();
  });
  $('#zone2').addEventListener('input', (e) => {
    S.zone2 = Math.max(Number(e.target.value), S.zone1 + 10);
    e.target.value = S.zone2; saveSettings(); syncSettingsUI();
  });
  $('#c-rowbg').addEventListener('input', (e) => { S.rowBg = e.target.value; saveSettings(); render(); });
  $('#c-rowtext').addEventListener('input', (e) => { S.rowText = e.target.value; saveSettings(); render(); });
  $('#c-panel').addEventListener('input', (e) => { S.panelBg = e.target.value; saveSettings(); });
  $('#c-red').addEventListener('input', (e) => { S.redColor = e.target.value; saveSettings(); render(); });
  $('#maxmem').addEventListener('change', (e) => {
    S.maxMem = Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1)));
    e.target.value = S.maxMem; saveSettings(); render();
  });
  $('#maxmarks').addEventListener('change', (e) => {
    S.maxMarks = Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 3)));
    e.target.value = S.maxMarks; saveSettings(); render();
  });
  $('#voice-src').addEventListener('change', (e) => { S.voice = e.target.value === 'tts' ? 'tts' : 'native'; saveSettings(); });
  $('#api-provider').addEventListener('change', (e) => { S.apiProvider = e.target.value; saveSettings(); });
  $('#api-key').addEventListener('change', (e) => { S.apiKey = e.target.value.trim(); saveSettings(); });
  $('#save-token').addEventListener('click', async () => {
    const t1 = $('#new-token').value, t2 = $('#new-token2').value;
    if (t1.length < 6) return toast('口令至少 6 位');
    if (t1 !== t2) return toast('两次输入不一致');
    const res = await api('/api/password', { method: 'POST', body: JSON.stringify({ next: t1 }) });
    if (res.ok) {
      localStorage.setItem('biscuit_token', t1);
      $('#new-token').value = ''; $('#new-token2').value = '';
      toast('口令已修改，其他设备需用新口令重新登录');
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || '修改失败');
    }
  });
}
bindSettings();
applySettings();

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
