// Globalny stan aplikacji: biblioteka, ustawienia, statystyki, postępy
import { db, kv } from './db.js';
import { buildWordIndex, chapterEnd, blockWords } from './import/structure.js';
import { dayKey, addDays, debounce } from './util.js';

const listeners = new Map();
export const bus = {
  on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); },
  emit(evt, data) { (listeners.get(evt) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },
};

// ───── Ustawienia ─────
const DEFAULTS = {
  theme: 'night', accent: 'amber',
  font: 'serif', size: 19, lh: 1.72, width: 680, align: 'left', gap: 1,
  goalMin: 30, deadlineMode: true,
  ttsRate: 1, ttsNext: false, ttsVoice: '',
  motion: 'auto',
  hlLabels: ['Ważne', 'Do sprawdzenia', 'Definicja', 'Przykład', 'Pytanie'],
};
export const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('lumen.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
})();
export function setSetting(key, val) {
  settings[key] = val;
  try { localStorage.setItem('lumen.settings', JSON.stringify(settings)); } catch { /* prywatny tryb */ }
  bus.emit('settings', key);
}

// Ustawienia wyglądu per dokument: meta.ap (obiekt) istnieje tylko, gdy włączono „tylko dla tego dokumentu”
export const AP_KEYS = ['theme', 'font', 'size', 'lh', 'width', 'gap', 'align'];
export const scope = { meta: null };
export function getVal(key) {
  const ap = scope.meta && scope.meta.ap;
  return ap && ap[key] !== undefined ? ap[key] : settings[key];
}
let apTimer = null;
export function setVal(key, val) {
  const m = scope.meta;
  if (m && m.ap && AP_KEYS.includes(key)) {
    m.ap[key] = val;
    clearTimeout(apTimer);
    apTimer = setTimeout(() => { saveMeta(m).catch(() => {}); }, 400);
    bus.emit('settings', key);
  } else setSetting(key, val);
}
export function setDocScope(meta, on) {
  if (!meta) return;
  if (on) meta.ap = Object.fromEntries(AP_KEYS.map((k) => [k, getVal(k)]));
  else delete meta.ap;
  clearTimeout(apTimer);
  saveMeta(meta).catch(() => {});
  bus.emit('settings', 'ap');
}

// ───── Biblioteka ─────
export const lib = { docs: new Map() };

export async function loadLibrary() {
  const all = await db.all('meta');
  lib.docs.clear();
  all.forEach((m) => lib.docs.set(m.id, m));
  return all;
}

// jednorazowo: dokumenty dodane starszą wersją nie mają znacznika aktu prawnego
export async function migrateLegal() {
  let changed = false;
  for (const m of [...lib.docs.values()]) {
    if (m.legal !== undefined) continue;
    try {
      const c = await db.get('content', m.id);
      m.legal = !!(c && c.blocks.some((b) => b.art));
      await db.put('meta', m);
      changed = true;
    } catch { /* pomiń */ }
    await new Promise((r) => setTimeout(r, 0));
  }
  if (changed) bus.emit('library');
}

export function listDocs() { return [...lib.docs.values()]; }
export function getMeta(id) { return lib.docs.get(id); }

export function defaultProg() { return { ch: 0, blk: 0, frac: 0, far: {}, done: {}, sec: 0, words: 0 }; }

export async function saveMeta(meta) {
  lib.docs.set(meta.id, meta);
  await db.put('meta', meta);
  bus.emit('library', meta.id);
}

// Treść (z pamięcią podręczną jednej książki)
let cache = { id: null, doc: null };
export async function loadDoc(id) {
  if (cache.id === id && cache.doc) return cache.doc;
  const c = await db.get('content', id);
  if (!c) return null;
  c.cw = buildWordIndex(c);
  c.id = id;
  const m0 = lib.docs.get(id);
  if (m0 && m0.legal === undefined) { m0.legal = c.blocks.some((b) => b.art); db.put('meta', m0).catch(() => {}); }
  cache = { id, doc: c };
  return c;
}
export function dropDocCache() { cache = { id: null, doc: null }; }

export async function saveContent(doc) {
  const { blocks, chapters, auto } = doc;
  await db.put('content', { blocks, chapters, auto, v: 1 }, doc.id);
}

// ───── Obliczanie postępu ─────
export function chapterInfo(doc, meta) {
  const prog = meta.prog || defaultProg();
  return doc.chapters.map((c, i) => {
    const end = chapterEnd(doc, i);
    const words = doc.cw[end] - doc.cw[c.start];
    const far = prog.far[c.start];
    const done = !!prog.done[c.start];
    let read = 0;
    if (done) read = words;
    else if (far != null) read = Math.max(0, Math.min(words, doc.cw[Math.min(end, far + 1)] - doc.cw[c.start]));
    return { i, c, words, read, done, started: done || far != null, pct: words ? read / words : 0, end };
  });
}

export function docProgress(doc, meta) {
  const info = chapterInfo(doc, meta);
  const total = doc.cw[doc.blocks.length] || 1;
  const read = info.reduce((s, x) => s + x.read, 0);
  return { info, total, read, pct: Math.min(1, read / total), done: info.filter((x) => x.done).length };
}

export function currentChapter(doc, meta) {
  const prog = meta.prog || defaultProg();
  return Math.min(Math.max(0, prog.ch || 0), doc.chapters.length - 1);
}

// Dokąd prowadzi „Kontynuuj”: bieżący rozdział, a jeśli ukończony – pierwszy nieukończony po nim
export function continueTarget(doc, meta) {
  const info = chapterInfo(doc, meta);
  let ci = currentChapter(doc, meta);
  if (info[ci]?.done) {
    const nxt = info.findIndex((x, i) => i > ci && !x.done);
    if (nxt >= 0) ci = nxt;
    else { const any = info.findIndex((x) => !x.done); ci = any >= 0 ? any : ci; }
  }
  return { ci, info };
}

export function remainingWords(doc, meta) {
  const p = docProgress(doc, meta);
  return Math.max(0, p.total - p.read);
}

// ───── Statystyki ─────
export const stats = { days: {}, wpm: 200, totalSec: 0, totalWords: 0 };
export async function loadStats() {
  const s = await kv.get('stats', null);
  if (s) Object.assign(stats, s);
}
const persistStats = debounce(() => kv.set('stats', { days: stats.days, wpm: stats.wpm, totalSec: stats.totalSec, totalWords: stats.totalWords }), 800);

export function addReading(sec, words) {
  const k = dayKey();
  const d = stats.days[k] || { s: 0, w: 0 };
  d.s += sec; d.w += words;
  stats.days[k] = d;
  stats.totalSec += sec;
  stats.totalWords += words;
  if (words >= 25 && sec >= 15) {
    const sample = Math.min(700, Math.max(70, words / (sec / 60)));
    stats.wpm = Math.round(stats.wpm * 0.82 + sample * 0.18);
  }
  persistStats();
  bus.emit('stats');
}

export function todaySeconds() { return stats.days[dayKey()]?.s || 0; }

export function streak() {
  let n = 0;
  let d = new Date();
  // jeśli dziś jeszcze nic – licz od wczoraj
  if ((stats.days[dayKey(d)]?.s || 0) < 60) d = addDays(d, -1);
  while ((stats.days[dayKey(d)]?.s || 0) >= 60) { n++; d = addDays(d, -1); }
  return n;
}

export function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    out.push({ key: dayKey(d), date: d, sec: stats.days[dayKey(d)]?.s || 0 });
  }
  return out;
}

export function wordsToMinutes(words) { return words / Math.max(80, stats.wpm || 200); }

export { blockWords };
