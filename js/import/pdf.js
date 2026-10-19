// Parser PDF → ustrukturyzowane bloki (nagłówki, akapity, listy, tabele, ramki).
// Nie zakłada niczego o konkretnym dokumencie: używa statystyk samego pliku.
import { openPdf } from './pdfjs.js';
import { TextBuilder, cleanStr } from './textbuild.js';
import { normKey, yieldUI } from '../util.js';

const BOLD_RE = /bold|black|heavy|semibold|demi|extrabold|[-_,]bd\b/i;
const ITAL_RE = /italic|oblique|[-_,]it\b|slanted/i;
const MEDIUM_RE = /medium|semi|demi/i;
const MONO_RE = /mono|courier|consolas|menlo|typewriter|lucida console|\bcode\b/i;

const GLYPH_RE = /^[•●○◦▪▫■□◆◇◘‣∙·▶►➤➢✓✔✗→-]\s*/;
const DASH_RE = /^[–—−-]\s+/;
const NUM_RE = /^(\(?\d{1,3}[.)])\s+/;
const ALPHA_RE = /^(\(?[a-z][.)])\s+/;
const HEADNUM_RE = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+\S/;
const PAGENUM_RE = /^(\d{1,4}|[ivxlcdm]{1,7}|[-–—]\s*\d+\s*[-–—]|(?:strona|str\.|page|s\.)\s*\d+(?:\s*(?:z|of|\/)\s*\d+)?|\d+\s*(?:z|of|\/)\s*\d+)$/i;
const LEADER_RE = /(\.{4,}|(?:\.\s){4,}|…{2,}|[·•]{4,})\s*[\divxlc]+\s*$/i;
const TERMINAL_RE = /[.!?…:;)"”»'’\]]$/;

const CALLOUT_KINDS = [
  [/przepis|artyku|ustaw|kodeks|law|rule|regulation|definicj|definition/i, 'law'],
  [/przykład|przyklad|example|case|studium|scenariusz/i, 'example'],
  [/pułapk|pulapk|uwaga|ostrzeż|ostrzez|warning|caution|ryzyk|błąd|blad|danger|uwaga/i, 'warn'],
  [/zapamiętaj|zapamietaj|ważne|wazne|pamiętaj|pamietaj|remember|key|kluczow|wniosk|important|najważniejsze|podsumowanie/i, 'key'],
  [/wskazówk|wskazowk|porada|tip|hint|rada|praktyk|checklist|lista kontrolna/i, 'tip'],
  [/projekt|draft|propozycj|proposal|nie obowiązuje/i, 'draft'],
];

function calloutKind(label) {
  for (const [re, k] of CALLOUT_KINDS) if (re.test(label)) return k;
  return 'note';
}

// Segmentacja zlepionych wersalików („PUŁAPKAWPRAKTYCE”) słownikiem zbudowanym z samego dokumentu
function buildVocab(blocks) {
  const v = new Map();
  for (const b of blocks) {
    if (b.t !== 'p' && b.t !== 'li') continue;
    for (const w of (b.x || '').toLowerCase().match(/[a-ząćęłńóśźż]+/g) || []) v.set(w, (v.get(w) || 0) + 1);
  }
  return v;
}

function segmentWords(str, vocab) {
  const s = str.toLowerCase();
  const n = s.length;
  const best = new Array(n + 1).fill(-Infinity);
  const prev = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === -Infinity) continue;
    for (let j = i + 1; j <= Math.min(n, i + 24); j++) {
      const w = s.slice(i, j);
      const c = vocab.get(w);
      if (c) {
        const sc = best[i] + w.length * w.length + Math.min(3, Math.log2(c + 1)) - 0.5;
        if (sc > best[j]) { best[j] = sc; prev[j] = i; }
      }
    }
    // nieznany znak jako osobne „słowo” z karą
    const sc2 = best[i] - 6;
    if (sc2 > best[i + 1]) { best[i + 1] = sc2; prev[i + 1] = i; }
  }
  const out = [];
  let k = n;
  while (k > 0) { out.unshift(str.slice(prev[k], k)); k = prev[k]; }
  // sklej pojedyncze nieznane litery sąsiadujące ze sobą
  const merged = [];
  for (const w of out) {
    const known = vocab.has(w.toLowerCase());
    if (!known && merged.length && !vocab.has(merged[merged.length - 1].toLowerCase())) merged[merged.length - 1] += w;
    else merged.push(w);
  }
  return merged.join(' ');
}

function isLetterSpaced(t) {
  const toks = t.split(/\s+/).filter((x) => /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]/.test(x));
  if (toks.length < 5) return false;
  return toks.filter((x) => x.length === 1).length / toks.length >= 0.85;
}

function unspace(t, vocab) {
  // zachowaj znaki rozdzielające (·, –, §, ⚠ …) i cyfry
  const parts = t.split(/(\s[·•|–—-]\s|^[^A-Za-zĄĆĘŁŃÓŚŹŻ]+\s)/);
  return parts.map((part) => {
    if (!/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(part) || !isLetterSpaced(part) && !/^(\S ){2,}\S$/.test(part.trim())) return part;
    const glued = part.replace(/\s+/g, '');
    const seg = glued.replace(/(\d+)/g, ' $1 ').split(/\s+/).filter(Boolean).map((chunk) => (/\d/.test(chunk) ? chunk : segmentWords(chunk, vocab))).join(' ');
    return seg;
  }).join('').replace(/\s+/g, ' ').trim();
}

const CAPTION_RE = /^(schemat|rysunek|rys\.|wykres|figure|fig\.|diagram|infografika|ilustracja|zdjęcie|mapa)\s+[\dIVX]+([.\-–]\d+)*/i;

// Diagramy wektorowe dają „śmieciowy” tekst; zamieniamy je na jeden blok z podpisem
function markFigures(blocks) {
  const isCand = (b) => b && b.t === 'p' && !b.g && (Math.abs(b._dx || 0) > 10 || b.sm);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (isCand(b)) {
      let j = i;
      while (j < blocks.length && isCand(blocks[j]) && blocks[j].pg === b.pg) j++;
      const run = blocks.slice(i, j);
      const capIdx = run.findIndex((r) => CAPTION_RE.test(r.x) && r.x.length < 200);
      if (run.length >= 3 && capIdx >= 0) {
        // dołącz poprzedzające strzępy diagramu: wszystko po ostatnim „solidnym” bloku (nagłówek, długi akapit, tabela)
        const narrative = (r) => r.x && (r.x.length > 140 || /[.;:!?]["”»)]?$/.test(r.x.trim()));
        const solid = (r) => r.t === 'h' || r.t === 'quote' || r.t === 'code' || (r.t === 'table' && (r.rows || []).flat().join('').length >= 140) || ((r.t === 'p' || r.t === 'li') && !r.sm && Math.abs(r._dx || 0) <= 10 && narrative(r));
        let guard = 0;
        while (guard++ < 40 && out.length && out[out.length - 1].pg === b.pg && !solid(out[out.length - 1])) out.pop();
        const prev = out[out.length - 1];
        const next = blocks[j];
        const f = { t: 'fig', x: run[capIdx].x, pg: b.pg, _y: b._y };
        if (prev && prev.pg === b.pg && prev._y1 != null) f.y0 = Math.round(prev._y1 - 5);
        if (capIdx >= run.length - 2 && run[capIdx]._y != null) f.y1 = Math.round(run[capIdx]._y - 7);
        else if (next && next.pg === b.pg && next._y != null) f.y1 = Math.round(next._y + (next.t === 'table' || next.g ? 34 : 11));
        out.push(f);
        i = j - 1;
        continue;
      }
    }
    if (b.t === 'p' && !b.g && CAPTION_RE.test(b.x) && b.x.length < 160) b.cap = 1;
    out.push(b);
  }
  blocks.length = 0;
  blocks.push(...out);
}

function fixSpacedBlocks(blocks) {
  const vocab = buildVocab(blocks);
  for (const b of blocks) {
    if (b.x && b.t !== 'code' && b.x.length < 140 && isLetterSpaced(b.x)) { b.x = unspace(b.x, vocab); delete b.m; }
    if (b.ti && !/\s/.test(b.ti) && b.ti.length >= 8) b.ti = segmentWords(b.ti, vocab).toUpperCase();
    else if (b.ti && isLetterSpaced(b.ti)) b.ti = unspace(b.ti, vocab).toUpperCase();
  }
}

const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const r05 = (v) => Math.round(v * 2) / 2;

function readFont(page, id) {
  try {
    const f = page.commonObjs.get(id);
    const name = String(f?.name || f?.fallbackName || '');
    return { bold: BOLD_RE.test(name) || !!f?.bold, heavy: BOLD_RE.test(name) || MEDIUM_RE.test(name) || !!f?.bold, italic: ITAL_RE.test(name) || !!f?.italic, mono: MONO_RE.test(name) || !!f?.isMonospace, name };
  } catch { return { bold: false, italic: false, mono: false, name: '' }; }
}

// ───────── Krok 1: pozycje tekstu → linie ─────────
function extractLines(items, fonts, W, H) {
  const its = [];
  for (const it of items) {
    if (!it.str) continue;
    const t = it.transform;
    const size = Math.hypot(t[0], t[1]);
    if (!(size > 0.5)) continue;
    if (Math.abs(t[1]) > 0.3 * Math.abs(t[0])) continue; // tekst obrócony (znaki wodne itp.)
    const s = cleanStr(it.str);
    if (!s) continue;
    its.push({ s, x: t[4], y: t[5], w: it.width || 0, size, f: fonts.get(it.fontName) || {} });
  }
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of its) {
    let row = null;
    for (let k = rows.length - 1; k >= 0 && k >= rows.length - 6; k--) {
      const L = rows[k];
      const dy = Math.abs(L.y - it.y);
      const mx = Math.max(L.size, it.size), mn = Math.min(L.size, it.size);
      if (dy <= 0.35 * mx || (dy <= 0.7 * mx && mn <= 0.8 * mx)) { row = L; break; }
    }
    if (!row) { row = { y: it.y, size: it.size, items: [] }; rows.push(row); }
    row.items.push(it);
    if (it.size > row.size) { row.size = it.size; row.y = it.y; }
  }
  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    // dominująca wielkość (po liczbie znaków), bez indeksów
    const cnt = new Map();
    for (const it of row.items) { const k = r05(it.size); cnt.set(k, (cnt.get(k) || 0) + it.s.trim().length); }
    let dsize = row.size, best = -1;
    for (const [k, v] of cnt) if (v > best) { best = v; dsize = k; }
    const baseY = row.items.filter((i) => Math.abs(r05(i.size) - dsize) < 0.6).reduce((a, i) => a + i.y, 0) / Math.max(1, row.items.filter((i) => Math.abs(r05(i.size) - dsize) < 0.6).length) || row.y;

    const segs = [];
    let seg = null, prevEnd = null, prevItem = null;
    const nonWs = row.items.filter((i) => i.s.trim());
    const singles = nonWs.filter((i) => i.s.trim().length === 1).length;
    const spaced = nonWs.length >= 5 && singles / nonWs.length >= 0.8;
    const spaceGap = spaced ? 0.34 * dsize : 0.14 * dsize;
    for (const it of row.items) {
      const ws = !it.s.trim();
      if (ws) continue; // spacje wynikają z odstępów
      const gap = prevEnd == null ? 0 : it.x - prevEnd;
      const gapLimit = Math.max(1.25 * dsize, 11);
      if (!seg || (!ws && gap > gapLimit)) {
        seg = { x0: it.x, x1: it.x + it.w, runs: [], chars: 0, bold: 0, mono: 0 };
        segs.push(seg);
        prevItem = null;
      }
      let str = it.s;
      if (prevItem && !ws) {
        const prevEndsSpace = /\s$/.test(seg.runs[seg.runs.length - 1]?.t || ' ');
        const needSpace = gap > spaceGap && !prevEndsSpace && !/^\s/.test(str);
        if (needSpace) str = ' ' + str;
      }
      const styles = [];
      const sup = it.size < 0.8 * dsize && it.y > baseY + 0.18 * dsize;
      const sub = it.size < 0.8 * dsize && it.y < baseY - 0.18 * dsize;
      if (sup) styles.push('u'); else if (sub) styles.push('s');
      if (it.f.bold && !sup) styles.push('b');
      if (it.f.italic) styles.push('i');
      const last = seg.runs[seg.runs.length - 1];
      if (last && last.st.join() === styles.join()) last.t += str; else seg.runs.push({ t: str, st: styles });
      const n = str.trim().length;
      seg.chars += n;
      if (it.f.heavy || it.f.bold) seg.bold += n;
      if (it.f.mono) seg.mono += n;
      seg.x1 = Math.max(seg.x1, it.x + it.w);
      prevEnd = Math.max(prevEnd ?? -1e9, it.x + it.w);
      prevItem = it;
    }
    for (const sg of segs) {
      sg.text = sg.runs.map((r) => r.t).join('');
      sg.isBold = sg.chars > 0 && sg.bold / sg.chars >= 0.88;
      sg.isMono = sg.chars > 0 && sg.mono / sg.chars >= 0.88;
    }
    const clean = segs.filter((s) => s.text.trim());
    if (!clean.length) continue;
    lines.push({
      y: baseY, size: dsize, segs: clean,
      x0: clean[0].x0, x1: clean[clean.length - 1].x1,
      text: clean.map((s) => s.text.trim()).join('  '),
    });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

const pageKey = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

// ───────── Krok 2: analiza globalna ─────────
function analyze(pages, H) {
  const total = pages.length;
  const zoneTop = (p, l) => l.y >= p.H * 0.9;
  const zoneBot = (p, l) => l.y <= p.H * 0.1;

  // powtarzające się nagłówki/stopki
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if (!(zoneTop(p, l) || zoneBot(p, l))) continue;
      const keys = [pageKey(l.text), ...l.segs.map((s) => pageKey(s.text))];
      for (const k of keys) if (k.length > 1 && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); }
    }
  }
  const thr = total >= 8 ? Math.max(4, Math.round(total * 0.18)) : Infinity;
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      const inZone = zoneTop(p, l) || zoneBot(p, l);
      if (!inZone) return true;
      if (l.segs.every((s) => PAGENUM_RE.test(s.text.trim()))) return false;
      if (PAGENUM_RE.test(l.text.trim())) return false;
      const keys = [pageKey(l.text), ...l.segs.map((s) => pageKey(s.text))];
      if (keys.some((k) => (counts.get(k) || 0) >= thr)) return false;
      return true;
    });
  }

  // strony spisu treści (kropki prowadzące)
  const tocPages = new Set();
  for (const p of pages) {
    const lead = p.lines.filter((l) => LEADER_RE.test(l.text)).length;
    if (lead >= 5 && lead >= 0.3 * p.lines.length) tocPages.add(p.no);
  }
  // strony „pośrednie” spisu: bez kropek, ale sąsiadujące i z samą numeracją na końcu linii — nie ruszamy.

  // wielkość tekstu podstawowego i marginesy
  const sizeW = new Map();
  for (const p of pages) {
    if (tocPages.has(p.no)) continue;
    for (const l of p.lines) {
      const len = l.text.length;
      if (len < 14 || l.segs.length > 1) continue;
      const k = r05(l.size);
      sizeW.set(k, (sizeW.get(k) || 0) + len);
    }
  }
  let body = 11, best = -1;
  for (const [k, v] of sizeW) if (v > best) { best = v; body = k; }

  const xW = new Map(), rightList = [];
  const leadBuckets = new Map();
  for (const p of pages) {
    if (tocPages.has(p.no)) continue;
    let prev = null;
    for (const l of p.lines) {
      if (l.segs.length === 1 && Math.abs(l.size - body) <= 0.6 && l.text.length >= 25) {
        const k = Math.round(l.x0);
        xW.set(k, (xW.get(k) || 0) + l.text.length);
        if (l.text.length >= 45) rightList.push(l.x1);
      }
      if (prev && l.segs.length === 1 && prev.segs.length === 1 && Math.abs(prev.size - l.size) < 0.5 && Math.abs(prev.x0 - l.x0) < 3) {
        const dy = prev.y - l.y;
        if (dy > 0.95 * l.size && dy < 2.4 * l.size) {
          const k = Math.round(l.size);
          if (!leadBuckets.has(k)) leadBuckets.set(k, []);
          leadBuckets.get(k).push(dy);
        }
      }
      prev = l;
    }
  }
  let left = 0; best = -1;
  for (const [k, v] of xW) if (v > best) { best = v; left = k; }
  rightList.sort((a, b) => a - b);
  const right = rightList.length ? rightList[Math.floor(rightList.length * 0.9)] : left + 400;
  const leadMap = new Map();
  for (const [k, arr] of leadBuckets) if (arr.length >= 5) leadMap.set(k, median(arr));
  const fullCnt = rightList.filter((x) => x >= right - 3).length;
  const justified = rightList.length > 30 && fullCnt / rightList.length > 0.5;

  return {
    body, left, right, justified, tocPages,
    leadFor: (size) => leadMap.get(Math.round(size)) || size * 1.38,
  };
}

// ───────── Krok 3: linie → jednostki (kolumny, tabele) ─────────
function mkLine(seg, y, size, pg) {
  return {
    kind: 'line', y, size, x0: seg.x0, x1: seg.x1, runs: seg.runs, text: seg.runs.map((r) => r.t).join('').trim(),
    bold: seg.isBold, mono: seg.isMono, pg,
  };
}

function buildUnits(p, ctx) {
  const lines = p.lines;
  const W = p.W;
  const mid = W / 2;
  const allSegs = [];
  for (const l of lines) for (const s of l.segs) allSegs.push({ s, l });
  const cross = [], leftS = [], rightS = [];
  for (const o of allSegs) {
    const { s } = o;
    if (s.x0 < mid - 12 && s.x1 > mid + 12) cross.push(o);
    else if (s.x1 <= mid + 12) leftS.push(o);
    else rightS.push(o);
  }
  const widths = allSegs.map((o) => o.s.x1 - o.s.x0);
  const twoCol = allSegs.length >= 12 && leftS.length >= 5 && rightS.length >= 5 &&
    cross.length <= 0.15 * allSegs.length && median(widths) >= 0.28 * W &&
    median(leftS.map((o) => o.s.chars)) >= 25 && median(rightS.map((o) => o.s.chars)) >= 25;

  const units = [];
  if (twoCol) {
    const sorted = allSegs.slice().sort((a, b) => b.l.y - a.l.y);
    let lb = [], rb = [];
    const flush = () => {
      lb.sort((a, b) => b.l.y - a.l.y); rb.sort((a, b) => b.l.y - a.l.y);
      for (const o of lb) units.push(mkLine(o.s, o.l.y, o.l.size, p.no));
      for (const o of rb) units.push(mkLine(o.s, o.l.y, o.l.size, p.no));
      lb = []; rb = [];
    };
    for (const o of sorted) {
      if (cross.includes(o)) { flush(); units.push(mkLine(o.s, o.l.y, o.l.size, p.no)); }
      else if (leftS.includes(o)) lb.push(o); else rb.push(o);
    }
    flush();
    return units;
  }

  // układ jednokolumnowy: wiersze wielosegmentowe = tabele
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.segs.length === 1) { units.push(mkLine(l.segs[0], l.y, l.size, p.no)); i++; continue; }
    // zbierz grupę wierszy tabeli
    const rowsL = [];
    let j = i;
    while (j < lines.length) {
      const m = lines[j];
      if (m.segs.length >= 2) { rowsL.push(m); j++; continue; }
      // kontynuacja komórki: pojedynczy segment w tej samej tabeli tuż pod wierszem
      const last = rowsL[rowsL.length - 1];
      if (last && last.y - m.y <= 1.55 * m.size) {
        const anchors = new Set();
        rowsL.forEach((r) => r.segs.forEach((s) => anchors.add(Math.round(s.x0))));
        const near = [...anchors].some((a) => Math.abs(a - m.x0) <= 8);
        if (near && m.text.length < 140) { rowsL.push(m); j++; continue; }
      }
      break;
    }
    const multi = rowsL.filter((r) => r.segs.length >= 2);
    if (multi.length >= 2) {
      units.push(tableUnit(rowsL, p.no, ctx.leadFor));
      i = j;
    } else {
      // pojedynczy wiersz wielosegmentowy: zwykła linia
      const joined = { x0: l.x0, x1: l.x1, runs: [], isBold: l.segs.every((s) => s.isBold), isMono: false };
      l.segs.forEach((s, k) => {
        if (k) joined.runs.push({ t: '  ', st: [] });
        joined.runs.push(...s.runs);
      });
      units.push(mkLine(joined, l.y, l.size, p.no));
      i++;
    }
  }
  return units;
}

function joinCell(a, b) {
  b = b.trim();
  if (!a) return b;
  if (/[\u2010\u2011\u00AD]$/.test(a)) return /^[a-ząćęłńóśźż]/.test(b) ? a.slice(0, -1) + b : a.slice(0, -1) + '-' + b;
  return a + ' ' + b;
}

function tableUnit(rowsL, pg, leadFor) {
  // kotwice kolumn po x0
  const xs = [];
  rowsL.forEach((r) => r.segs.forEach((s) => xs.push(s.x0)));
  xs.sort((a, b) => a - b);
  const anchors = [];
  for (const x of xs) {
    const last = anchors[anchors.length - 1];
    if (last && x - last.sum / last.n <= 9) { last.sum += x; last.n++; } else anchors.push({ sum: x, n: 1 });
  }
  const A = anchors.map((a) => a.sum / a.n);
  const rows = [];
  let lastY = null;
  const colOf = (x) => {
    let c = 0;
    for (let k = 0; k < A.length; k++) if (x >= A[k] - 9) c = k;
    return c;
  };
  let hdr = false;
  let prevRow = null;
  rowsL.forEach((r) => {
    const cells = new Array(A.length).fill('');
    // zawinięty ciąg dalszy komórek (ciasny odstęp jak w akapicie) – dołącz do poprzedniego wiersza
    if (prevRow && rows.length && prevRow.y - r.y <= 1.22 * leadFor(r.size) && r.segs.length >= 1) {
      const prev = rows[rows.length - 1];
      r.segs.forEach((sg) => { const c = colOf(sg.x0); prev[c] = joinCell(prev[c], sg.text); });
      prevRow = r;
      return;
    }
    if (r.segs.length === 1 && rows.length) {
      // kontynuacja
      const c = colOf(r.segs[0].x0);
      const prev = rows[rows.length - 1];
      prev[c] = joinCell(prev[c], r.segs[0].text);
      return;
    }
    r.segs.forEach((s) => { const c = colOf(s.x0); cells[c] = joinCell(cells[c], s.text); });
    if (!rows.length) hdr = r.segs.every((s) => s.isBold);
    rows.push(cells);
    prevRow = r;
    lastY = r.y;
  });
  // usuń puste kolumny
  const keep = A.map((_, c) => rows.some((r) => r[c]));
  const rows2 = rows.map((r) => r.filter((_, c) => keep[c]).map((c) => c.replace(/\u00AD/g, '').replace(/[\u2010\u2011]/g, '-')));
  const y = rowsL[0].y;
  return { kind: 'table', rows: rows2, hdr, y, y1: lastY ?? y, pg, size: rowsL[0].size };
}

// ───────── Krok 4: jednostki → bloki ─────────
function stripPrefix(runs, n) {
  const out = [];
  let left = n;
  for (const r of runs) {
    if (left <= 0) { out.push(r); continue; }
    if (r.t.length <= left) { left -= r.t.length; continue; }
    out.push({ t: r.t.slice(left), st: r.st });
    left = 0;
  }
  return out;
}

function lineText(ln) { return ln.runs.map((r) => r.t).join(''); }

function collapseSpaced(s) {
  const t = s.trim();
  if (/^(\S ){3,}\S$/.test(t)) return t.replace(/ /g, '');
  return t;
}

function endsTerminal(s) { return TERMINAL_RE.test(s.trim()); }

const LETTERS_RE = /[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g;

// Czy linia wygląda jak etykieta ramki (np. „PRZYKŁAD”)? Zwraca tekst etykiety albo null.
function labelCandidate(ln, nextU, ctx) {
  if (!ln || ln.kind === 'table' || !nextU) return null;
  const r = ln.size / ctx.body;
  if (r > 1.08 || ln.x0 < ctx.left + 0.55 * ctx.body) return null;
  const lab = collapseSpaced(ln.text);
  const letters = lab.replace(LETTERS_RE, '');
  if (letters.length < 3 || lab.length > 60 || lab !== lab.toUpperCase() || /[.!?]$/.test(lab)) return null;
  if (ctx.labelCount) {
    const key = lab.replace(/\s+/g, '');
    const known = calloutKind(lab) !== 'note';
    if (!known && (ctx.labelCount.get(key) || 0) < 3) return null;
  }
  return lab;
}

function assemblePage(units, ctx, pageNo, out) {
  let cur = null;
  const flush = () => { if (cur) { cur.pg = cur.pg || pageNo; out.push(cur); cur = null; } };
  const { body, left } = ctx;

  const mkBlock = (t, ln, extra = {}) => ({
    t, tb: new TextBuilder(), pg: pageNo, _y: ln.y, x0: ln.x0, size: ln.size, last: ln, lines: 0,
    g: ctx.callout ? ctx.callout.g : 0, ...extra,
  });

  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    if (u.kind === 'table') {
      flush();
      out.push({ t: 'table', rows: u.rows, hdr: u.hdr, pg: pageNo, _y: u.y, _y1: u.y1 - 2, g: ctx.callout ? ctx.callout.g : 0 });
      continue;
    }
    const ln = u;
    const text = ln.text;
    if (!text) continue;
    const r = ln.size / body;
    const numbered = HEADNUM_RE.test(text);

    // etykieta ramki (krótki napis WERSALIKAMI, wcięty względem tekstu)
    {
      const lab = labelCandidate(ln, units[ui + 1], ctx);
      if (lab) {
        flush();
        ctx.callout = { x0: ln.x0, g: ++ctx.gid, k: calloutKind(lab), ti: lab.replace(/^[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/, '').trim() || lab, fresh: true };
        continue;
      }
    }

    // koniec ramki?
    if (ctx.callout) {
      const bigHead = r >= 1.13 && text.length <= 160;
      if (bigHead || ln.x0 < ctx.callout.x0 - 3) { flush(); ctx.callout = null; }
    }

    // nagłówek?
    let isHead = !ctx.callout && (r >= 1.13 && text.length <= 110 && text.split(/\s+/).length <= 18 && !(text.length > 70 && /[.!?]$/.test(text)));
    if (!isHead && !ctx.callout && ln.bold && numbered && text.length <= 110 && r >= 0.95 && !/[,;:]$/.test(text) && !/\.$/.test(text.replace(/^\d+(\.\d+)*\./, ''))) isHead = true;
    if (isHead) {
      if (cur && cur.t === 'h' && Math.abs(ln.size - cur.size) < 0.6 && cur.last.y - ln.y <= 1.75 * ln.size && !(numbered && cur.numbered)) {
        cur.tb.addLine(ln.runs.map((x) => ({ t: x.t, st: null })));
        cur.last = ln; cur.lines++;
      } else {
        flush();
        cur = mkBlock('h', ln, { numbered, g: 0 });
        cur.tb.addLine(ln.runs.map((x) => ({ t: x.t, st: null })));
        cur.hs = r05(ln.size);
        const m = text.match(HEADNUM_RE);
        cur.hd = m ? m[1].split('.').length : 0;
      }
      continue;
    }

    // kod
    if (ln.mono && text.length > 2) {
      if (cur && cur.t === 'code') { cur.code.push(lineText(ln)); cur.last = ln; }
      else { flush(); cur = mkBlock('code', ln); cur.code = [lineText(ln)]; }
      continue;
    }
    if (cur && cur.t === 'code') flush();

    // lista?
    let bullet = null, prefLen = 0, ordered = '';
    const fullText = lineText(ln).replace(/^\s+/, '');
    let mm;
    if ((mm = fullText.match(GLYPH_RE))) { bullet = 'g'; prefLen = mm[0].length; }
    else if ((mm = fullText.match(DASH_RE))) { bullet = 'd'; prefLen = mm[0].length; }
    else if ((mm = fullText.match(NUM_RE))) { bullet = 'n'; prefLen = mm[0].length; ordered = mm[1]; }
    else if ((mm = fullText.match(ALPHA_RE))) { bullet = 'a'; prefLen = mm[0].length; ordered = mm[1]; }
    if (bullet && fullText.length - prefLen < 1) bullet = null;
    // „1.2 Tekst” nie jest listą
    if (bullet === 'n' && /^\d+\.\d/.test(fullText)) bullet = null;

    const lead = ctx.leadFor(ln.size);
    let startNew = false;
    if (!cur || cur.t === 'h') startNew = true;
    else {
      const dy = cur.last.y - ln.y;
      const prevText = cur.tb.text;
      const prevTerm = endsTerminal(prevText);
      if (bullet) startNew = true;
      else if (dy > lead * 1.42) startNew = true;
      else if (Math.abs(ln.size - cur.size) > 0.7) startNew = true;
      else if (cur.t === 'p' && ln.x0 - cur.last.x0 > 0.85 * ln.size && prevTerm) startNew = true;
      else if (cur.t === 'li' && ln.x0 < cur.x0 - 4) startNew = true;
      else if (cur.t === 'p' && Math.abs(ln.x0 - cur.last.x0) > 1.6 * ln.size && ln.x0 < cur.last.x0) startNew = !(ln.x0 > left - 3 && cur.last.x0 > ln.x0);
      else if (ctx.justified && prevTerm && cur.t === 'p' && cur.last.x1 < ctx.right - 0.22 * (ctx.right - left) && !ctx.callout) startNew = true;
      else if (ctx.justified && prevTerm && cur.t === 'li' && cur.last.x1 < ctx.right - 0.3 * (ctx.right - left) && ln.x0 <= cur.x0 + 2) startNew = true;
    }

    if (startNew) {
      flush();
      const sm = !ctx.callout && r <= 0.86;
      cur = mkBlock(bullet ? 'li' : 'p', ln, { sm });
      if (ctx.callout && ctx.callout.fresh) { cur.callTitle = ctx.callout.ti; cur.callKind = ctx.callout.k; ctx.callout.fresh = false; }
      if (bullet) { cur.ord = ordered; cur.bx = ln.x0; }
      cur.firstIndent = !bullet && (ln.x0 - left) > 0.85 * ln.size && !ctx.callout && false;
      cur.tb.addLine(bullet ? stripPrefix(ln.runs, ln.runs.map((x) => x.t).join('').length - fullText.length + prefLen).map((x) => ({ t: x.t, st: x.st })) : ln.runs);
    } else {
      cur.tb.addLine(ln.runs);
    }
    cur.last = ln; cur.lines++;
  }
  flush();
}

function finalizeBlocks(raw, ctx, pagesInfo) {
  // scalanie akapitów przez granice stron
  const merged = [];
  for (const b of raw) {
    const prevIdx = (() => { for (let i = merged.length - 1; i >= 0; i--) { if (!merged[i].sm) return i; } return -1; })();
    const prev = prevIdx >= 0 ? merged[prevIdx] : null;
    if (prev && b.pg > prev.pg && (b.t === 'p' || b.t === 'li') && (prev.t === 'p' || prev.t === 'li') && b.t === 'p' && prev.g === b.g && !b.sm === !prev.sm) {
      const pt = prev.tb.text;
      const term = endsTerminal(pt);
      const lastFull = prev.last && prev.last.x1 >= ctx.right - 2.5 * prev.size;
      const open = !term || (ctx.justified && lastFull);
      const firstCh = (b.tb.text.trim()[0]) || '';
      const startsLower = /[a-ząćęłńóśźż]/.test(firstCh);
      const indentNew = b.x0 - ctx.left > 0.85 * b.size && !b.g;
      if (open && (startsLower || !term) && !indentNew && !b.callTitle) {
        // wstaw ewentualne bloki `sm` pomiędzy (przypisy) bez zmian — scal do prev
        prev.tb.addLine(b.tb.toRuns());
        prev.last = b.last;
        continue;
      }
    }
    merged.push(b);
  }
  return merged;
}

function levelsFromHeadings(blocks) {
  const heads = blocks.filter((b) => b.t === 'h');
  const clusters = new Map();
  for (const h of heads) {
    const k = h.hs || 0;
    if (!clusters.has(k)) clusters.set(k, { size: k, items: [], depths: [] });
    const c = clusters.get(k);
    c.items.push(h);
    if (h.hd) c.depths.push(h.hd);
  }
  const arr = [...clusters.values()].sort((a, b) => b.size - a.size);
  arr.forEach((c) => {
    c.level = c.depths.length >= Math.max(1, c.items.length * 0.3) ? Math.min(4, median(c.depths)) : null;
  });
  const firstNum = arr.findIndex((c) => c.level != null);
  if (firstNum < 0) {
    arr.forEach((c, i) => { c.level = Math.min(4, i + 1); });
  } else {
    // klastry większe niż pierwszy numerowany: schodzą w górę od jego poziomu
    for (let i = firstNum - 1, lvl = arr[firstNum].level - 1; i >= 0; i--, lvl--) arr[i].level = Math.max(1, lvl);
    // klastry mniejsze bez numeracji: o poziom głębiej niż poprzedni
    for (let i = firstNum + 1; i < arr.length; i++) {
      if (arr[i].level == null) arr[i].level = Math.min(4, arr[i - 1].level + 1);
    }
  }
  for (const c of arr) for (const h of c.items) h.l = h.hd ? Math.min(4, h.hd) : c.level;
}

function isLabelish(b) {
  if (b.t !== 'p' && b.t !== 'h') return false;
  const t = (b.x || '').trim();
  if (!t || t.length > 42) return false;
  if (/^(rozdział|rozdzial|chapter|część|czesc|part|lekcja|lesson|moduł|module|unit|dział)\s+[\divxlc]+\b/i.test(t)) return true;
  const letters = t.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '');
  return letters.length >= 3 && t === t.toUpperCase() && !/[.!?]$/.test(t);
}

async function resolveOutline(pdf, blocks) {
  let outline;
  try { outline = await pdf.getOutline(); } catch { outline = null; }
  if (!outline || !outline.length) return [];
  const flat = [];
  const walk = (items, level) => {
    for (const it of items) {
      flat.push({ title: (it.title || '').replace(/\s+/g, ' ').trim(), level, dest: it.dest });
      if (it.items && it.items.length) walk(it.items, level + 1);
    }
  };
  walk(outline, 1);

  const byPage = new Map();
  blocks.forEach((b, i) => { if (!byPage.has(b.pg)) byPage.set(b.pg, []); byPage.get(b.pg).push(i); });

  const entries = [];
  for (const f of flat) {
    if (!f.title) continue;
    let dest = f.dest;
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) continue;
      let pg;
      if (typeof dest[0] === 'object' && dest[0] !== null) pg = (await pdf.getPageIndex(dest[0])) + 1;
      else pg = Number(dest[0]) + 1;
      const destY = typeof dest[3] === 'number' ? dest[3] : null;
      const key = normKey(f.title);
      const key2 = normKey(f.title.replace(/^(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+/, ''));
      let cand = byPage.get(pg) || [];
      // jeżeli na stronie brak bloków (np. strona graficzna), idź do następnej
      let pp = pg;
      while (!cand.length && pp < pg + 3) { pp++; cand = byPage.get(pp) || []; }
      let chosen = -1;
      for (const bi of cand) {
        const b = blocks[bi];
        if (b.t !== 'h' && b.t !== 'p') continue;
        const bk = normKey(b.x);
        if (!bk) continue;
        if (bk === key || bk === key2 || (key2.length >= 6 && bk.startsWith(key2)) || (key.length >= 6 && bk.startsWith(key)) || (bk.length >= 6 && key.startsWith(bk))) { chosen = bi; break; }
      }
      let title = f.title;
      if (chosen < 0) {
        // fallback po współrzędnej
        if (destY != null) {
          for (const bi of cand) { if (blocks[bi]._y <= destY + 4) { chosen = bi; break; } }
        }
        if (chosen < 0 && cand.length) chosen = cand[0];
      } else if (blocks[chosen].t === 'h') {
        title = blocks[chosen].x;
        // wielowierszowy nagłówek: dołącz kolejne nagłówki, jeśli klucz je zawiera
      }
      if (chosen < 0) continue;
      // etykiety nad tytułem („ROZDZIAŁ 3”, „CZĘŚĆ II”) należą do rozdziału
      while (chosen > 0 && blocks[chosen - 1].pg === blocks[chosen].pg && isLabelish(blocks[chosen - 1])) chosen--;
      entries.push({ title, rawTitle: f.title, level: f.level, block: chosen });
    } catch { /* pomiń uszkodzony wpis */ }
  }
  // usuń duplikaty tego samego bloku na tym samym poziomie
  const seen = new Set();
  return entries.filter((e) => { const k = e.block + ':' + e.level; if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function parsePdf(file, onProgress = () => {}) {
  const pdf = await openPdf(file);
  const n = pdf.numPages;
  const fonts = new Map();
  const pages = [];
  let chars = 0;
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const unknown = new Set();
    for (const it of tc.items) if (it.fontName && !fonts.has(it.fontName)) unknown.add(it.fontName);
    if (unknown.size) {
      try { await page.getOperatorList(); } catch { /* ignoruj */ }
      for (const f of unknown) fonts.set(f, readFont(page, f));
    }
    const lines = extractLines(tc.items, fonts, vp.width, vp.height);
    for (const l of lines) chars += l.text.length;
    pages.push({ no: p, W: vp.width, H: vp.height, lines });
    page.cleanup();
    if (p % 2 === 0) { onProgress({ page: p, pages: n, frac: (p / n) * 0.85 }); await yieldUI(); }
  }
  onProgress({ page: n, pages: n, frac: 0.88, phase: 'Układam strukturę' });
  await yieldUI();

  let info = {};
  try { info = (await pdf.getMetadata()).info || {}; } catch { /* brak */ }
  const meta = { title: (info.Title || '').trim(), author: (info.Author || '').trim(), pages: n };

  // pliki skanów: prawie brak tekstu
  if (chars / Math.max(1, n) < 90) {
    const blocks = [];
    for (let p = 1; p <= n; p++) blocks.push({ t: 'page', pg: p, x: '', w: 220 });
    const entries = await resolveOutlineScanned(pdf, n);
    return { meta, blocks, entries, scanned: true };
  }

  const ctx = analyze(pages);
  ctx.callout = null;
  ctx.gid = 0;
  const raw = [];
  const allUnits = [];
  ctx.labelCount = null;
  for (const p of pages) {
    if (ctx.tocPages.has(p.no)) continue;
    const units = buildUnits(p, ctx);
    allUnits.push([p.no, units]);
    if (p.no % 40 === 0) await yieldUI();
  }
  // etykiety niewiadomego rodzaju uznajemy za ramki dopiero, gdy powtarzają się w dokumencie
  const counts = new Map();
  for (const [, units] of allUnits) {
    units.forEach((u, i) => {
      const lab = labelCandidate(u, units[i + 1], ctx);
      if (lab) { const k = lab.replace(/\s+/g, ''); counts.set(k, (counts.get(k) || 0) + 1); }
    });
  }
  ctx.labelCount = counts;
  for (const [no, units] of allUnits) {
    assemblePage(units, ctx, no, raw);
    onProgress({ page: no, pages: n, frac: 0.88 + 0.08 * (no / n), phase: 'Układam strukturę' });
    if (no % 25 === 0) await yieldUI();
  }
  const merged = finalizeBlocks(raw, ctx);

  levelsFromHeadings(merged);

  // końcowe bloki
  const blocks = [];
  let ginfo = new Map();
  for (const b of merged) {
    let x, m = [];
    if (b.t === 'table') {
      blocks.push({ t: 'table', rows: b.rows, hdr: b.hdr, pg: b.pg, _y: b._y, _y1: b._y1, g: b.g || 0 });
      continue;
    }
    if (b.t === 'code') { x = b.code.join('\n'); }
    else { const f = b.tb.finish(); x = f.x; m = f.m; }
    if (!x.trim()) continue;
    const o = { t: b.t, x, pg: b.pg, _y: b._y, _y1: b.last ? b.last.y : b._y, _dx: (b.x0 ?? ctx.left) - ctx.left };
    if (b.t === 'h' && (x.length > 130 || x.split(/\s+/).length > 22)) { o.t = 'p'; o.ld = 1; }
    else if (b.t === 'h') { o.l = b.l || 1; }
    else if (m.length) {
      // pogrubienie całego akapitu nie niesie informacji — zachowaj tylko częściowe
      o.m = m;
    }
    if (b.t === 'li') { o.o = b.ord || ''; o._x0 = b.bx; o._size = b.size; }
    if (b.g) o.g = b.g;
    if (b.callTitle) { o.ti = b.callTitle; o.k = b.callKind; }
    if (b.sm) o.sm = 1;
    blocks.push(o);
  }
  // przypisz rodzaj ramki do wszystkich bloków w grupie; głębokość list
  const gk = new Map();
  blocks.forEach((b) => { if (b.g && b.k) gk.set(b.g, b.k); });
  blocks.forEach((b) => { if (b.g && !b.k && gk.has(b.g)) b.k = gk.get(b.g); });
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].t !== 'li') continue;
    let j = i;
    let minx = Infinity;
    while (j < blocks.length && blocks[j].t === 'li') { minx = Math.min(minx, blocks[j]._x0 ?? 0); j++; }
    for (let k = i; k < j; k++) {
      const d = Math.round(((blocks[k]._x0 ?? 0) - minx) / (1.5 * (blocks[k]._size || 11)));
      if (d > 0) blocks[k].d = Math.min(3, d);
      delete blocks[k]._x0; delete blocks[k]._size;
    }
    i = j - 1;
  }

  markFigures(blocks);
  fixSpacedBlocks(blocks);
  blocks.forEach((b) => { delete b._dx; });
  const entries = await resolveOutline(pdf, blocks);
  const firstH = blocks.find((b) => b.t === 'h');
  if (!meta.title || /^(untitled|bez tytułu|microsoft word|document)/i.test(meta.title)) meta.title = firstH ? firstH.x : '';
  onProgress({ page: n, pages: n, frac: 1, phase: 'Gotowe' });
  return { meta, blocks, entries, scanned: false, pdf };
}

async function resolveOutlineScanned(pdf, n) {
  let outline;
  try { outline = await pdf.getOutline(); } catch { return []; }
  if (!outline) return [];
  const res = [];
  const walk = async (items, level) => {
    for (const it of items) {
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest)) {
          const pg = typeof dest[0] === 'object' && dest[0] ? (await pdf.getPageIndex(dest[0])) + 1 : Number(dest[0]) + 1;
          res.push({ title: it.title, level, block: pg - 1 });
        }
      } catch { /* pomiń */ }
      if (it.items?.length) await walk(it.items, level + 1);
    }
  };
  await walk(outline, 1);
  return res;
}
