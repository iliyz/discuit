/* biscuit · 前端逻辑（vanilla，无构建） */
'use strict';

const $ = (s) => document.querySelector(s);
const listEl = $('#list'), searchEl = $('#search'), lookupEl = $('#lookup'), emptyEl = $('#empty');

let words = [];
let dragMoved = false; // 本次 pointer 序列是否构成拖动（抑制 click）

/* ---------- 设置（存本机 localStorage） ---------- */
const BISCUIT_GREEN = '#36ab60';
const SETTINGS_KEY = 'biscuit_settings';
const RED_PER_MARK = 2;          // 1 次右滑大距离 = 2 个 red 单位 = 1 个标记次数（2 次左轻滑抵 1 次）
const MAX_MARKS_CAP = 5;         // 最大标记次数上限（原来是 10，收紧到 5）
const MAX_MEM_CAP = 10;          // 最大记忆次数上限
const ZONE_MIN = 10;             // 相邻点击区域分界之间至少保留的宽度（%）
const DEFAULT_SETTINGS = {
  glyph: BISCUIT_GREEN,          // ▛/▟ 颜色
  zone1: 33,                     // 左|中 分界 %
  zone2: 67,                     // 中|右 分界 %
  fns: ['speak', 'flip', 'edit'],// 左/中/右 功能
  rowBg: BISCUIT_GREEN,          // 词条默认背景（biscuit 绿）
  rowText: '#ffffff',            // 词条默认文字
  panelBg: '#ffffff',            // 释义窗口背景
  redColor: '#e0524d',           // 红标记色块
  maxMarks: 3,                   // 最大标记次数：深度 = red / (RED_PER_MARK * maxMarks)
  voice: 'native',               // 发音源：native=真人 mp3 优先，tts=设备合成
  maxMem: 1,                     // 最大记忆次数单位 a，最深 3a 层
  apiProvider: 'azure',
  apiKey: '',
};
let S = loadSettings();

// 取整并夹在 [lo, hi] 内，非法值回落到 dflt
function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function loadSettings() {
  let s;
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    s = { ...DEFAULT_SETTINGS, ...saved, fns: [...(saved.fns || DEFAULT_SETTINGS.fns)] };
  } catch {
    s = { ...DEFAULT_SETTINGS, fns: [...DEFAULT_SETTINGS.fns] };
  }
  // 老版本存下的值可能越界（如 maxMarks 曾允许到 10、分界值互相穿越），统一夹一次再回显
  s.maxMem = clampInt(s.maxMem, 1, MAX_MEM_CAP, DEFAULT_SETTINGS.maxMem);
  s.maxMarks = clampInt(s.maxMarks, 1, MAX_MARKS_CAP, DEFAULT_SETTINGS.maxMarks);
  s.zone1 = clampInt(s.zone1, ZONE_MIN, 100 - 2 * ZONE_MIN, DEFAULT_SETTINGS.zone1);
  s.zone2 = clampInt(s.zone2, s.zone1 + ZONE_MIN, 100 - ZONE_MIN, DEFAULT_SETTINGS.zone2);
  if (!Array.isArray(s.fns) || s.fns.length !== 3) s.fns = [...DEFAULT_SETTINGS.fns];
  return s;
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
    const form = dlg.querySelector('form');
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
      // 隐私安全诊断：只记长度和哈希前 8 位，不记录口令本身（正确值 len=11 sha=ea531c75）
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(b => {
        const h = [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
        console.log(`口令诊断: 长度=${t.length} sha=${h.slice(0, 8)}（正确: 长度=11 sha=ea531c75）`);
      }).catch(() => {});
      form.onsubmit = null;
      dlg.classList.remove('error');
      dlg.close();
      resolve(t);
    };
    form.onsubmit = onSubmit; // 直接绑在 form 上，杜绝监听器叠加
  });
}

async function api(path, opts = {}, _retried = false) {
  if (!getToken()) await askToken();
  // 注意：Authorization 必须放在展开之后，否则 401 重试时旧 headers 会把新口令盖掉
  opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${getToken()}` };
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
      const depth = Math.min(1, w.red / (RED_PER_MARK * Math.max(1, S.maxMarks)));
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
      // 左滑轻：先抵消红标记（2 次轻滑抵 1 次右滑，红块随之逐级减淡），否则记忆 +1（颜色变浅）
      if (w.red > 0) {
        const nr = Math.max(0, w.red - 1);
        patchWord(w, { red: nr }).then(() => toast(nr === 0 ? '标记已清零' : `标记减淡（再 ${nr} 次轻滑抵完）`));
      } else {
        const nm = Math.min(3 * S.maxMem, (w.mem || 0) + 1);
        patchWord(w, { mem: nm }).then(() => toast(nm >= 3 * S.maxMem ? `${w.word} 已记满（${nm}/${3 * S.maxMem}）` : `${w.word} 记住 +1（${nm}/${3 * S.maxMem}）`));
      }
    } else if (dx >= bigAt) {
      // 右滑大距离：红标记 +1（服务端按 1/RED_PER_MARK 的原始整数存储），深度由 maxMarks 控制
      const marks = Math.max(1, S.maxMarks);
      const nr = Math.min(RED_PER_MARK * marks, (w.red || 0) + RED_PER_MARK);
      patchWord(w, { red: nr }).then(() => toast(nr >= RED_PER_MARK * marks ? `⚑ 标记已满（${marks}/${marks}）` : `⚑ 标记 ${Math.round(nr / RED_PER_MARK)}/${marks}`));
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
  // 角标颜色
  document.querySelectorAll('#glyph-swatches .swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.v === S.glyph);
    b.onclick = () => { S.glyph = b.dataset.v; saveSettings(); syncSettingsUI(); };
  });
  // 点击区域功能：分段按钮选中态 + aria-pressed
  document.querySelectorAll('#fn-seg .seg').forEach(seg => {
    const i = Number(seg.dataset.i);
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      const on = btn.dataset.v === S.fns[i];
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
  // 点击区域比例
  syncZoneUI();
  // 颜色
  $('#c-rowbg').value = S.rowBg; $('#c-rowtext').value = S.rowText;
  $('#c-panel').value = S.panelBg; $('#c-red').value = S.redColor;
  // 记忆
  $('#maxmem').value = String(S.maxMem);
  $('#maxmemv').textContent = `${S.maxMem}（最深 ${3 * S.maxMem} 层）`;
  $('#maxmarks').value = String(S.maxMarks);
  $('#maxmarksv').textContent = `${S.maxMarks} 次`;
  // 其余控件
  $('#voice-src').value = S.voice;
  $('#api-provider').value = S.apiProvider;
  $('#api-key').value = S.apiKey;
}

/* 点击区域比例：三段色块宽度、手柄位置、百分比文字一起回显 */
function syncZoneUI() {
  const z1 = S.zone1, z2 = S.zone2;
  const p1 = z1, p2 = z2 - z1, p3 = 100 - z2; // 三者相加恒为 100
  $('#zp1').textContent = `${p1}%`;
  $('#zp2').textContent = `${p2}%`;
  $('#zp3').textContent = `${p3}%`;
  $('#zs1').style.width = `${p1}%`;
  $('#zs2').style.width = `${p2}%`;
  $('#zs3').style.width = `${p3}%`;
  const h1 = $('#zh1'), h2 = $('#zh2');
  h1.style.left = `${z1}%`;
  h2.style.left = `${z2}%`;
  h1.setAttribute('aria-valuenow', String(z1));
  h2.setAttribute('aria-valuenow', String(z2));
}

/*
 * 比例条拖拽（自定义 pointer 事件，不用 input[type=range] 叠加，避免轨道与手指错位）
 * 关键：手柄 left = zone%，条宽 = 屏宽 → 手柄中心 x / 条宽 天然等于生效百分比。
 * 约束：左手柄 ≤ 右手柄 - ZONE_MIN，两个分界之间至少保留 10%。
 */
function bindZoneBar() {
  const bar = $('#zone-bar');
  const h1 = $('#zh1'), h2 = $('#zh2');
  let idx = 0; // 0=未拖动，1=左手柄（zone1），2=右手柄（zone2）

  // 指针 x → 百分比（0~100），与色块、手柄共用同一坐标系
  const pctAt = (clientX) => {
    const r = bar.getBoundingClientRect();
    if (!r.width) return 0;
    return ((clientX - r.left) / r.width) * 100;
  };

  // 写入生效值：取整后夹紧，保证 x%+y%+z% 正好 100 且分界不穿越
  const setHandle = (i, pct) => {
    if (i === 1) {
      const hi = Math.min(100 - 2 * ZONE_MIN, S.zone2 - ZONE_MIN);
      S.zone1 = clampInt(pct, ZONE_MIN, hi, S.zone1);
    } else {
      S.zone2 = clampInt(pct, S.zone1 + ZONE_MIN, 100 - ZONE_MIN, S.zone2);
    }
  };

  const commit = () => { saveSettings(); syncZoneUI(); };

  bar.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pct = pctAt(e.clientX);
    // 直接抓起某个手柄就用它，否则吸附到最近的那条分界线
    idx = e.target === h1 ? 1
        : e.target === h2 ? 2
        : (Math.abs(pct - S.zone1) <= Math.abs(pct - S.zone2) ? 1 : 2);
    try { bar.setPointerCapture(e.pointerId); } catch {}
    setHandle(idx, pct);
    commit();
    e.preventDefault();
  });

  bar.addEventListener('pointermove', (e) => {
    if (!idx) return;
    setHandle(idx, pctAt(e.clientX));
    commit();
  });

  const end = () => {
    if (!idx) return;
    idx = 0;
    commit(); // 收手时再存一次，确保 localStorage 是最终值
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);

  // 键盘也能调（左右方向键各 1%）
  const onKey = (i) => (e) => {
    let d = 0;
    if (e.key === 'ArrowLeft') d = -1;
    else if (e.key === 'ArrowRight') d = 1;
    else return;
    e.preventDefault();
    setHandle(i, (i === 1 ? S.zone1 : S.zone2) + d);
    saveSettings(); syncSettingsUI();
  };
  h1.addEventListener('keydown', onKey(1));
  h2.addEventListener('keydown', onKey(2));
}

function bindSettings() {
  // 点击区域功能：三个分段按钮，点完立即生效
  document.querySelectorAll('#fn-seg .seg').forEach(seg => {
    const i = Number(seg.dataset.i);
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        S.fns[i] = btn.dataset.v;
        saveSettings(); syncSettingsUI();
      });
    });
  });
  bindZoneBar();
  $('#c-rowbg').addEventListener('input', (e) => { S.rowBg = e.target.value; saveSettings(); render(); });
  $('#c-rowtext').addEventListener('input', (e) => { S.rowText = e.target.value; saveSettings(); render(); });
  $('#c-panel').addEventListener('input', (e) => { S.panelBg = e.target.value; saveSettings(); });
  $('#c-red').addEventListener('input', (e) => { S.redColor = e.target.value; saveSettings(); render(); });
  // 记忆：滑杆 input 实时生效（记忆层数仍是 3 × maxMem）
  $('#maxmem').addEventListener('input', (e) => {
    S.maxMem = clampInt(e.target.value, 1, MAX_MEM_CAP, DEFAULT_SETTINGS.maxMem);
    saveSettings(); render(); syncSettingsUI();
  });
  $('#maxmarks').addEventListener('input', (e) => {
    S.maxMarks = clampInt(e.target.value, 1, MAX_MARKS_CAP, DEFAULT_SETTINGS.maxMarks);
    saveSettings(); render(); syncSettingsUI();
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
    if (e.message === 'unauthorized') {
      emptyEl.textContent = '口令不正确，刷新页面重试';
      emptyEl.classList.remove('hidden'); // 无痕模式无缓存时 body 不能留白
    } else if (words.length) toast('离线中，显示缓存数据');
    else {
      emptyEl.textContent = '加载失败，检查网络后重试';
      emptyEl.classList.remove('hidden');
    }
  }
}

// Service Worker 注册（仅 https/localhost）
const SW_VERSION = 'v1103d';
console.log(`biscuit 前端版本 ${SW_VERSION}`); // 诊断用：控制台可见当前版本
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // 自愈：清掉所有旧版本缓存（只保留当前 biscuit-v10），防止老 SW 反复喂旧代码
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('biscuit-') && k !== 'biscuit-v12').map(k => caches.delete(k)))
  ).catch(() => {});
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
}

boot();
