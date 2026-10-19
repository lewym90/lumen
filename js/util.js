// Drobne narzędzia współdzielone w całej aplikacji

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
export const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function throttleRaf(fn) {
  let queued = false;
  return (...a) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...a); });
  };
}

export function countWords(s) {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}

// Klucz porównawczy tekstu: małe litery, bez znaków niealfanumerycznych
export function normKey(s) {
  return String(s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

// Tekst do wyszukiwania: bez ogonków, małe litery, ta sama długość co oryginał (1:1 po znaku)
export function foldText(s) {
  let out = '';
  for (const ch of s) {
    if (ch === 'ł') out += 'l';
    else if (ch === 'Ł') out += 'l';
    else {
      const d = ch.normalize('NFD');
      out += d.length > 1 ? d[0].toLowerCase() : ch.toLowerCase();
    }
  }
  return out;
}

export function fmtMinutes(min) {
  min = Math.max(0, Math.round(min));
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} s`;
  return fmtMinutes(sec / 60);
}

export function fmtNum(n) {
  return new Intl.NumberFormat('pl-PL').format(Math.round(n));
}

export function plural(n, one, few, many) {
  const a = Math.abs(n);
  if (a === 1) return one;
  const last = a % 10, tens = a % 100;
  if (last >= 2 && last <= 4 && !(tens >= 12 && tens <= 14)) return few;
  return many;
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Dobrej nocy';
  if (hr < 12) return 'Dzień dobry';
  if (hr < 18) return 'Miłego popołudnia';
  return 'Dobry wieczór';
}

export const isTouch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;

export function ic(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export async function fingerprint(file) {
  try {
    const size = file.size;
    const head = await file.slice(0, 1 << 20).arrayBuffer();
    const tail = size > (1 << 21) ? await file.slice(size - (1 << 20)).arrayBuffer() : new ArrayBuffer(0);
    const buf = new Uint8Array(head.byteLength + tail.byteLength + 8);
    buf.set(new Uint8Array(head), 0);
    buf.set(new Uint8Array(tail), head.byteLength);
    new DataView(buf.buffer).setFloat64(head.byteLength + tail.byteLength, size);
    const dig = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(dig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${file.name}:${file.size}`;
  }
}
