// Wspólna logika: z bloków tekstu + (opcjonalnych) zakładek budujemy rozdziały.
import { countWords, normKey } from '../util.js';

const KW = 'rozdział|rozdzial|chapter|lekcja|lesson|moduł|modul|module|unit|temat|lekcje|część|czesc|part|księga|ksiega|book|dział|dzial|section|tom|volume|etap|sesja|day|dzień';
const PART_KW = /^(część|czesc|part|księga|ksiega|book|tom|volume|dział|dzial)$/i;
const LABEL_RE = new RegExp(`^(${KW})\\s+([IVXLCDM]+|\\d+(?:\\.\\d+)*|[A-Z])\\b[\\s.:–—-]*(.*)$`, 'i');
const NUM_RE = /^(\d{1,3}(?:\.\d{1,3}){0,3})[.)]?\s+(\S.*)$/;

export function isPartTitle(t) {
  const m = t.trim().match(LABEL_RE);
  return !!(m && PART_KW.test(m[1]));
}

// "3 Etyka i standardy" -> {num:'3', kw:'', title:'Etyka i standardy'}
export function parseLabel(raw) {
  const t = raw.replace(/\s+/g, ' ').trim();
  let m = t.match(LABEL_RE);
  if (m) {
    const kw = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return { kw, num: m[2], title: m[3] || '' };
  }
  m = t.match(NUM_RE);
  if (m && !m[1].includes('.') ) return { kw: '', num: m[1], title: m[2] };
  if (m) return { kw: '', num: m[1], title: m[2] };
  return { kw: '', num: '', title: t };
}

export function blockWords(b) {
  if (b.w != null) return b.w;
  let w;
  if (b.t === 'table') w = countWords((b.rows || []).flat().join(' '));
  else if (b.t === 'img') w = 25;
  else if (b.t === 'page') w = 250;
  else w = countWords(b.x || '') + (b.ti ? countWords(b.ti) : 0);
  b.w = w;
  return w;
}

export function wordsBetween(blocks, a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += blockWords(blocks[i]);
  return s;
}

function mkChapter(entry, i) {
  const lab = parseLabel(entry.rawTitle || entry.title);
  const own = parseLabel(entry.title);
  const full = entry.title;
  return {
    id: 'c' + i,
    title: own.title || lab.title || full,
    kw: lab.kw,
    num: lab.num,
    start: entry.block,
    level: entry.level || 1,
    part: entry.part || '',
  };
}

function chunkByWords(blocks, target = 3200) {
  const total = blocks.reduce((s, b) => s + blockWords(b), 0);
  const n = Math.max(1, Math.round(total / target));
  const per = total / n;
  const entries = [];
  let acc = 0, next = per, idx = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) { entries.push({ title: `Część 1`, level: 1, block: 0 }); idx = 1; }
    acc += blockWords(blocks[i]);
    if (acc >= next && idx < n) {
      // przesuń do najbliższego nagłówka w oknie +-20%, jeśli jest
      let j = i + 1;
      for (let k = i + 1; k < Math.min(blocks.length, i + 40); k++) { if (blocks[k].t === 'h') { j = k; break; } }
      if (j >= blocks.length) break;
      idx++;
      entries.push({ title: `Część ${idx}`, level: 1, block: j });
      next += per;
    }
  }
  return entries;
}

function headingEntries(blocks) {
  const heads = [];
  blocks.forEach((b, i) => { if (b.t === 'h') heads.push({ title: b.x, level: b.l || 1, block: i }); });
  return heads;
}

function chooseByHeadings(blocks) {
  const heads = headingEntries(blocks);
  const total = blocks.reduce((s, b) => s + blockWords(b), 0);
  const strong = heads.filter((h) => LABEL_RE.test(h.title.trim()));
  if (strong.length >= 2) {
    // Jeśli są nagłówki typu "Część" i "Rozdział", zostaw rozdziały, a części jako grupy
    return strong;
  }
  // wybierz najpłytszy poziom, który daje sensowną liczbę rozdziałów
  for (let lvl = 1; lvl <= 4; lvl++) {
    const at = heads.filter((h) => h.level === lvl);
    if (at.length >= 3 && at.length <= 250 && total / at.length >= 250) return at;
  }
  // kolejny wariant: dopuszczamy 2 rozdziały
  for (let lvl = 1; lvl <= 3; lvl++) {
    const at = heads.filter((h) => h.level === lvl);
    if (at.length >= 2 && total / at.length >= 400) return at;
  }
  return null;
}

// entries: [{title, level, block}] — może być puste
export function buildChapters(blocks, entries, docTitle = '') {
  if (!blocks.length) return [];
  let list = entries && entries.length >= 2 ? entries.slice() : null;
  if (list) {
    // poprawność: block musi być w zakresie
    list = list.filter((e) => e.block >= 0 && e.block < blocks.length);
    list.sort((a, b) => a.block - b.block || (a.level - b.level));
  }
  if (!list || list.length < 2) {
    list = chooseByHeadings(blocks);
    if (!list) list = chunkByWords(blocks);
  }

  // wybór poziomu rozdziałów
  const byLevel = new Map();
  list.forEach((e) => byLevel.set(e.level, (byLevel.get(e.level) || 0) + 1));
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const explicit = list.some((e) => e.legal);
  let L = explicit ? Math.max(...levels) : levels.find((l) => byLevel.get(l) >= 3);
  if (L == null) L = levels.slice().sort((a, b) => byLevel.get(b) - byLevel.get(a))[0];

  const chapters = [];
  let pendingPart = '', pendingPartStart = null;
  for (const e of list) {
    const partLike = isPartTitle(e.title);
    if (e.level < L || (!explicit && e.level === L && partLike && list.some((x) => x !== e && x.level === L && !isPartTitle(x.title)))) {
      const lab = parseLabel(e.title);
      pendingPart = [lab.kw && lab.num ? `${lab.kw} ${lab.num}` : '', lab.title].filter(Boolean).join('|') || e.title;
      pendingPartStart = e.block;
      continue;
    }
    if (e.level > L) continue;
    const c = mkChapter({ ...e, part: e.solo ? '' : pendingPart }, chapters.length);
    if (pendingPartStart != null && pendingPartStart <= c.start) {
      const between = chapters.length && chapters[chapters.length - 1].start >= pendingPartStart;
      if (!between) c.start = Math.min(c.start, pendingPartStart);
      pendingPartStart = null;
    }
    chapters.push(c);
  }
  // część bez rozdziału po niej – pomiń; sortuj i dedupe
  chapters.sort((a, b) => a.start - b.start);
  const dedup = [];
  for (const c of chapters) {
    if (dedup.length && dedup[dedup.length - 1].start === c.start) continue;
    dedup.push(c);
  }
  let res = dedup;

  // treść przed pierwszym rozdziałem
  if (res.length && res[0].start > 0) {
    const w = wordsBetween(blocks, 0, res[0].start);
    if (w >= 60) res.unshift({ id: 'c-1', title: docTitle || 'Wprowadzenie', kw: '', num: '', start: 0, level: 1, part: '', front: true });
    else res[0].start = 0;
  }

  // sklej bardzo krótkie rozdziały z następnym (np. strony tytułowe/przekładki)
  const merged = [];
  for (let i = 0; i < res.length; i++) {
    const end = i + 1 < res.length ? res[i + 1].start : blocks.length;
    const w = wordsBetween(blocks, res[i].start, end);
    if (w < 45 && i + 1 < res.length) {
      const nxt = res[i + 1];
      nxt.start = res[i].start;
      if (!nxt.part && res[i].part) nxt.part = res[i].part;
      continue;
    }
    merged.push(res[i]);
  }
  res = merged.length ? merged : res;
  res.forEach((c, i) => { c.id = 'c' + i; });
  return res;
}

// Podrozdziały: nagłówki wewnątrz rozdziału
export function sectionsOf(doc, ci) {
  const ch = doc.chapters[ci];
  if (!ch) return [];
  const end = ci + 1 < doc.chapters.length ? doc.chapters[ci + 1].start : doc.blocks.length;
  const out = [];
  const base = Math.max(1, ch.level || 1);
  for (let i = ch.start; i < end; i++) {
    const b = doc.blocks[i];
    if (b.t !== 'h' || i === ch.start) continue;
    if ((b.l || 1) <= base && i <= ch.start + 2) continue;
    if ((b.l || 1) > base + 2) continue;
    out.push({ block: i, title: b.x, level: Math.max(1, (b.l || 1) - base) });
  }
  return out;
}

export function chapterEnd(doc, ci) {
  return ci + 1 < doc.chapters.length ? doc.chapters[ci + 1].start : doc.blocks.length;
}

export function chapterOfBlock(doc, bi) {
  const ch = doc.chapters;
  let lo = 0, hi = ch.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ch[mid].start <= bi) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// cumulative words per block: cw[i] = words before block i
export function buildWordIndex(doc) {
  const cw = new Array(doc.blocks.length + 1);
  let s = 0;
  for (let i = 0; i < doc.blocks.length; i++) { cw[i] = s; s += blockWords(doc.blocks[i]); }
  cw[doc.blocks.length] = s;
  return cw;
}

export function matchKey(a) { return normKey(a); }
