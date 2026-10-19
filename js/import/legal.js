// Tryb aktów prawnych (ustawy, rozporządzenia, kodeksy): działy, rozdziały, artykuły, ustępy, punkty, litery.
// Działa na liniach wyciągniętych z PDF-a (patrz pdf.js → extractLines).
import { TextBuilder } from './textbuild.js';

export const ART_RE = /^Art\.\s*(\d+[a-z]{0,3})(?:\s*[–-]\s*(\d+[a-z]{0,3}))?\.(?:\s+|$)/;
export const HEAD_RE = /^(KSIĘGA|Księga|TYTUŁ|Tytuł|CZĘŚĆ|Część|DZIAŁ|Dział|ROZDZIAŁ|Rozdział|ODDZIAŁ|Oddział|ZAŁĄCZNIK|Załącznik)\s+(?:[Nn][Rr]\s+)?([IVXLCDM]+[a-z]{0,3}|\d+[a-z]{0,3})\.?$/;
const RANK = { załącznik: -1, księga: 0, tytuł: 1, część: 2, dział: 3, rozdział: 4, oddział: 5 };
export const UST_RE = /^(\d{1,3})([a-z]{0,3})\.(?:\s+(?=\S)|(?=\d{1,3}\)\s))/;
export const PKT_RE = /^(\d{1,3}[a-z]{0,3})\)\s+(?=\S)/;
export const LIT_RE = /^([a-z]{1,2})\)\s+(?=\S)/;
export const DASH_RE = /^[–—-]\s+(?=\S)/;
export const DZU_RE = /^Dz\.\s*U\./;
export const PAR_RE = /^§\s*(\d+[a-z]{0,3})(?:\s*[–-]\s*(\d+[a-z]{0,3}))?\.(?:\s+|$)/;
// ustęp z dopiskiem „§” (kodeksy: „§ 1.”) oraz punkt poprzedzony odnośnikiem („3)3) tekst”)
const UST2_RE = /^(§\s*)?(\d{1,3})([a-z]{0,3})\.(?:\s+(?=\S)|(?=\d{1,3}\)\s))/;
const PKT2_RE = /^(\d{1,3}[a-z]{0,3})\)(?:\s+(?=\S)|(?=\d{1,3}\)\s))/;
export const KIND_RE = /^(USTAWA|ROZPORZĄDZENIE|KODEKS|DEKRET|OBWIESZCZENIE|UCHWAŁA|KONSTYTUCJA|ZARZĄDZENIE|POSTANOWIENIE|DECYZJA|KONWENCJA|UMOWA|PROTOKÓŁ|TRAKTAT|STATUT|REGULAMIN|KARTA)$/i;
const LET = 'A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż';

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const unspace = (s) => (/^(\S\s){3,}\S$/.test(s.trim()) ? s.replace(/\s+/g, '') : s);
const keyOf = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

// Który znak jednostki redakcyjnej (Art. / §) dominuje w tekście i ile takich linii jest.
export function unitStats(pages) {
  let arts = 0, pars = 0, lines = 0, prevA = 0, ordA = 0, prevP = 0, ordP = 0;
  for (const p of pages) for (const l of p.lines) {
    lines++;
    let m = l.text.match(ART_RE);
    if (m) { arts++; const k = parseInt(m[1], 10); if (k >= prevA && k <= prevA + 4) ordA++; prevA = k; continue; }
    m = l.text.match(PAR_RE);
    if (m) { pars++; const k = parseInt(m[1], 10); if (k >= prevP && k <= prevP + 4) ordP++; prevP = k; }
  }
  const sym = pars > arts ? '§' : 'Art.';
  const units = sym === '§' ? pars : arts, ord = sym === '§' ? ordP : ordA;
  return { sym, units, ord, lines };
}

export function detectLegal(pages, n = pages.length) {
  const { units, ord, lines } = unitStats(pages);
  if (units >= 15 && units / Math.max(1, n) >= 0.25 && units / Math.max(1, lines) > 0.004) return true;
  // krótkie akty (rozporządzenia, małe ustawy): mniej jednostek, ale gęsto i po kolei
  return units >= 5 && units / Math.max(1, n) >= 0.6 && units / Math.max(1, lines) >= 0.012 && ord / units >= 0.8;
}

// linia → runy (przerwy między segmentami zamieniamy na pojedynczą spację)
function lineRuns(l) {
  const runs = [];
  l.segs.forEach((s, k) => {
    if (k > 0) runs.push({ t: ' ', st: [] });
    for (const r of s.runs) runs.push({ t: r.t.replace(/\s{2,}/g, ' '), st: r.st });
  });
  while (runs.length && !runs[0].t.trim()) runs.shift();
  if (runs.length) runs[0] = { t: runs[0].t.replace(/^\s+/, ''), st: runs[0].st };
  return runs;
}
const joinRuns = (runs) => runs.map((r) => r.t).join('');

function sliceRuns(runs, n) {
  const out = [];
  let skip = n;
  for (const r of runs) {
    if (skip <= 0) { out.push(r); continue; }
    if (r.t.length <= skip) { skip -= r.t.length; continue; }
    out.push({ t: r.t.slice(skip), st: r.st });
    skip = 0;
  }
  while (out.length && !out[0].t.trim()) out.shift();
  if (out.length) out[0] = { t: out[0].t.replace(/^\s+/, ''), st: out[0].st };
  return out;
}


// Tytuły składane rozstrzelonymi literami („U S TAWA”, „OB W IE S ZC ZE N I E”): PDF wstawia odstępy w środku słów.
// Odtwarzamy słowa na podstawie słownika z samego dokumentu; znaki zostają te same, zmieniają się tylko odstępy.
const SHORT_OK = new Set(['i', 'w', 'z', 'o', 'a', 'u', 'do', 'na', 'od', 'po', 'za', 'ze', 'we', 'nr', 'to', 'ku', 'by', 'że', 'się', 'oraz']);
function looksSpaced(t) {
  const tk = t.trim().split(/\s+/);
  if (tk.length < 3) return false;
  const letters = t.replace(new RegExp(`[^${LET}]`, 'g'), '');
  if (letters.length < 5 || letters !== letters.toUpperCase()) return false;
  const short = tk.filter((w) => w.replace(new RegExp(`[^${LET}]`, 'g'), '').length <= 2).length;
  return short / tk.length >= 0.5;
}
function respace(t, vocab) {
  const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0];
  const core = t.trim();
  const tk = core.split(/\s+/);
  const s = tk.join('');
  const low = s.toLowerCase();
  const n = s.length;
  const INF = 1e9;
  const cost = new Array(n + 1).fill(INF), back = new Array(n + 1).fill(-1), kind = new Array(n + 1).fill(0);
  cost[0] = 0;
  for (let i = 0; i < n; i++) {
    if (cost[i] >= INF) continue;
    // nieznany znak
    if (cost[i] + 4 < cost[i + 1]) { cost[i + 1] = cost[i] + 4; back[i + 1] = i; kind[i + 1] = 0; }
    for (let j = i + 1; j <= Math.min(n, i + 24); j++) {
      const w = low.slice(i, j);
      const ok = j - i === 1 ? SHORT_OK.has(w) : (j - i === 2 ? SHORT_OK.has(w) : vocab.has(w));
      if (!ok) continue;
      const c = cost[i] + 1 + (j - i === 1 ? 2 : 0);
      if (c < cost[j]) { cost[j] = c; back[j] = i; kind[j] = 1; }
    }
  }
  const parts = [];
  let i = n;
  while (i > 0) { const b = back[i]; parts.push({ w: s.slice(b, i), known: kind[i] === 1 }); i = b; }
  parts.reverse();
  // sklej sąsiednie nieznane znaki
  const out = [];
  for (const p of parts) {
    if (!p.known && out.length && !out[out.length - 1].known) out[out.length - 1].w += p.w; else out.push({ ...p });
  }
  if (out.length >= tk.length) return t;       // nic nie zyskaliśmy — zostaw
  return lead + out.map((p) => p.w).join(' ') + trail;
}
function fixSpaced(pages, kinds) {
  const vocab = new Set(kinds.map((k) => k.toLowerCase()));
  let any = false;
  for (const p of pages) for (const l of p.lines) for (const sg of l.segs) {
    if (sg.runs.some((r) => looksSpaced(r.t))) { any = true; continue; }
    for (const w of sg.text.split(/\s+/)) { const c = w.toLowerCase().replace(new RegExp(`[^${LET}]`, 'g'), ''); if (c.length >= 3) vocab.add(c); }
  }
  if (!any) return;
  for (const p of pages) for (const l of p.lines) {
    let changed = false;
    for (const sg of l.segs) for (const r of sg.runs) {
      if (looksSpaced(r.t)) { const n = respace(r.t, vocab); if (n !== r.t) { r.t = n; changed = true; } }
    }
    if (changed) {
      for (const sg of l.segs) sg.text = sg.runs.map((r) => r.t).join('');
      l.text = l.segs.map((sg) => sg.text.trim()).join('  ');
    }
  }
}

// oddziel kolumnę uwag redakcyjnych na marginesie od właściwej linii.
// Uwaga: ostatnie słowo wyjustowanej linii też leży daleko po prawej — takie słowo MUSI zostać w tekście.
function segSize(segs, dflt) {
  const w = new Map();
  for (const sg of segs) { if (sg.size == null) return dflt; w.set(sg.size, (w.get(sg.size) || 0) + (sg.chars || sg.text.length)); }
  let b = -1, r = dflt;
  for (const [k, v] of w) if (v > b) { b = v; r = k; }
  return r;
}
const NOTE_RE = /Opracowano na podstawie|Przepis|Nowe brzmienie|wejdzie w życie|wchodzi w życie|wejd[ąz]|Dodany|Dodan[eo]|Skreślon|\(Dz\. U\.|Dz\. U\. z \d{4}/i;
function splitMargin(lines, W, body) {
  // kolumny marginesu tej strony: początki linii składających się wyłącznie z uwag
  const mxs = [];
  for (const l of lines) if (l.segs.every((s) => s.x0 > W * 0.72) && (l.size < body - 0.8 || l.segs.every((s) => s.isBold))) mxs.push(l.segs[0].x0);
  const cand = lines.map((l) => {
    const right = l.segs.filter((s) => s.x0 > W * 0.72);
    if (!right.length) return null;
    const left = l.segs.filter((s) => s.x0 <= W * 0.72);
    let margin;
    if (!left.length) margin = l.size < body - 0.8 || l.segs.every((s) => s.isBold);
    else {
      margin = right.every((s) => s.isBold) && !left.every((s) => s.isBold) && l.size >= body - 0.8 && right.every((s) => s.x0 > W * 0.78);
      // tytuł (np. „USTAWA”) w tym samym wierszu co uwaga na marginesie
      if (!margin && mxs.length && mxs.some((x) => Math.abs(x - right[0].x0) <= 3) && right[0].x0 - left[left.length - 1].x1 >= 14) margin = true;
    }
    return margin ? { l, right, left } : null;
  });
  const side = [];
  // grupy sąsiednich wierszy marginesu; tylko grupy wyglądające na uwagi redakcyjne wychodzą z tekstu (reszta to treść, np. „Załącznik nr 2”)
  const ok = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!cand[i] || ok[i]) continue;
    let j = i;
    const idx = [i];
    for (let k = i + 1; k < lines.length; k++) {
      if (!cand[k]) { if (cand[k] === null && lines[k].y < lines[idx[idx.length - 1]].y - 40) break; continue; }
      if (lines[idx[idx.length - 1]].y - lines[k].y > 26) break;
      idx.push(k);
    }
    const txt = idx.map((k) => cand[k].right.map((s) => s.text.trim()).join(' ')).join(' ');
    if (NOTE_RE.test(txt)) { for (const k of idx) ok[k] = true; side.push({ y: lines[i].y, text: txt }); }
    else for (const k of idx) cand[k] = undefined;
    void j;
  }
  const out = [];
  lines.forEach((l, i) => {
    const c = cand[i];
    if (!c || !ok[i]) { out.push(l); return; }
    if (c.left.length) out.push({ ...l, size: segSize(c.left, l.size), segs: c.left, x0: c.left[0].x0, x1: c.left[c.left.length - 1].x1, text: c.left.map((s) => s.text.trim()).join('  ') });
  });
  return { body: out, side };
}


// poziomy nagłówków + wybór podziału na rozdziały (wspólne dla PDF-a i tekstów HTML/DOCX/TXT)
export function legalEntries(blocks, headings) {
  // ── poziomy nagłówków i podział na rozdziały ──
  const kinds = [...new Set(headings.filter((h) => h.kind !== 'załącznik').map((h) => h.kind))].sort((a, b) => RANK[a] - RANK[b]);
  const lvlOf = new Map(kinds.map((k, i) => [k, i + 1]));
  lvlOf.set('załącznik', 1);
  for (const h of headings) blocks[h.block].l = Math.min(4, lvlOf.get(h.kind));

  const words = (a, b) => { let n = 0; for (let i = a; i < b; i++) n += (blocks[i].x || '').split(/\s+/).length; return n; };
  const total = words(0, blocks.length);
  const stat = kinds.map((k) => {
    const hs = headings.filter((h) => h.kind === k);
    let mxw = 0;
    for (let i = 0; i < hs.length; i++) {
      // rozmiar sekcji: do następnego nagłówka tego samego lub wyższego rzędu
      let end = blocks.length;
      for (let j = headings.indexOf(hs[i]) + 1; j < headings.length; j++) if (RANK[headings[j].kind] <= RANK[k]) { end = headings[j].block; break; }
      mxw = Math.max(mxw, words(hs[i].block, end));
    }
    return { k, n: hs.length, avg: total / Math.max(1, hs.length), max: mxw };
  });
  const chosen = stat.find((s) => s.n >= 3 && s.max <= 8000) || [...stat].reverse().find((s) => s.n >= 3);
  const entries = [];
  if (chosen) {
    const cl = lvlOf.get(chosen.k);
    const hs = headings.map((h) => ({ ...h, lv: lvlOf.get(h.kind) }));
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (h.lv > cl) continue;
      if (h.lv === cl) { entries.push({ title: h.text, level: 2, block: h.block }); continue; }
      let hasChild = false;
      for (let k = i + 1; k < hs.length && hs[k].lv > h.lv; k++) if (hs[k].lv <= cl) { hasChild = true; break; }
      entries.push({ title: h.text, level: hasChild ? 1 : 2, block: h.block, solo: !hasChild });
    }
  } else {
    const arts = [];
    blocks.forEach((b, i) => { if (b.art) arts.push(i); });
    let acc = 0, firstArt = null;
    for (let k = 0; k < arts.length; k++) {
      const i = arts[k];
      const nextI = k + 1 < arts.length ? arts[k + 1] : blocks.length;
      if (firstArt == null) firstArt = i;
      acc += words(i, nextI);
      if (acc >= 3000 || k === arts.length - 1) {
        const a = blocks[firstArt].art.split('–')[0], z = blocks[i].art.split('–').pop();
        entries.push({ title: a === z ? `Art. ${a}` : `Art. ${a}–${z}`, level: 2, block: entries.length ? firstArt : 0 });
        firstArt = null; acc = 0;
      }
    }
  }
  return entries;
}

export function parseLegal(pages, nPages = pages.length) {
  const ocr = !!pages.ocr;
  fixSpaced(pages, ['ustawa', 'rozporządzenie', 'kodeks', 'dekret', 'obwieszczenie', 'uchwała', 'konstytucja', 'zarządzenie', 'postanowienie', 'decyzja', 'konwencja', 'umowa', 'protokół', 'traktat', 'statut', 'regulamin', 'karta']);
  const { sym } = unitStats(pages);
  const UNIT_RE = sym === '§' ? PAR_RE : ART_RE;
  // ── wielkości globalne: tekst podstawowy, lewy margines ──
  const sizeW = new Map(), xW = new Map();
  const hy = new Set();
  for (const p of pages) {
    for (const l of p.lines) {
      if (l.y > p.H * 0.94 || l.y < p.H * 0.06) continue;
      if (l.text.length >= 30) {
        const k = Math.round(l.size * 2) / 2;
        sizeW.set(k, (sizeW.get(k) || 0) + l.text.length);
      }
      const m = l.text.match(new RegExp(`[${LET}]{2,}-[${LET}]{2,}`, 'g'));
      if (m) m.forEach((w) => hy.add(w.toLowerCase()));
    }
  }
  const known = new Set();
  for (const p of pages) for (const l of p.lines) {
    const tk = l.text.replace(/\s+/g, ' ').trim().split(' ');
    tk.forEach((w, i) => { if (!(i === tk.length - 1 && w.endsWith('-'))) known.add(w.toLowerCase().replace(/^[^A-Za-ząćęłńóśźż]+|[^A-Za-ząćęłńóśźż-]+$/g, '')); });
  }
  let body = 12, best = -1;
  for (const [k, v] of sizeW) if (v > best) { best = v; body = k; }
  for (const p of pages) for (const l of p.lines) {
    if (l.text.length >= 40 && Math.abs(l.size - body) < 0.6 && l.y < p.H * 0.94 && l.y > p.H * 0.06 && l.x0 < p.W * 0.4) {
      const k = Math.round(l.x0 / 2) * 2; xW.set(k, (xW.get(k) || 0) + 1);
    }
  }
  let mx = 0;
  for (const v of xW.values()) mx = Math.max(mx, v);
  let left = 70;
  { let bx = Infinity; for (const [k, v] of xW) if (v >= mx * 0.2 && k < bx) bx = k; if (bx < Infinity) left = bx; }

  // prawa krawędź tekstu (do rozpoznawania akapitów wyrównanych do prawej)
  let rightEdge = 0;
  { const xs = []; for (const p of pages) for (const l of p.lines) if (l.text.length >= 60 && Math.abs(l.size - body) < 0.6 && l.x0 < p.W * 0.4) xs.push(l.x1); xs.sort((a, b) => a - b); rightEdge = xs.length ? xs[Math.floor(xs.length * 0.9)] : 1e9; }

  // powtarzające się nagłówki/stopki
  const rep = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if (!(l.y > p.H * 0.9 || l.y < p.H * 0.1)) continue;
      for (const k of [keyOf(l.text), ...l.segs.map((s) => keyOf(s.text))]) if (k.length > 1 && !seen.has(k)) { seen.add(k); rep.set(k, (rep.get(k) || 0) + 1); }
    }
  }
  const thr = Math.max(4, nPages * 0.3);

  const blocks = [];
  const headings = [];
  const notes = [];
  const title = { kind: '', ref: '', items: [] };   // pierwszy blok tytułowy (items w kolejności z pliku)
  const cover = [];                                  // baner przed tytułem („DZIENNIK USTAW …”)
  let grp = null, grpN = 0, units = 0;               // bieżąca grupa tytułowa; liczba napotkanych jednostek
  const titles = [];                                 // wszystkie bloki tytułowe (do nazwy dokumentu)
  let cur = null;
  let lastUst = 0, inFront = true;
  let pendingFn = [];
  let fnCur = null;

  const flushFn = () => {
    for (const f of pendingFn) { if (finishTb(f)) blocks.push(f); }
    pendingFn = [];
  };
  const finishTb = (b) => {
    const f = b.tb.finish();
    b.x = f.x; if (f.m.length) b.m = f.m;
    delete b.tb; delete b.lk; delete b.cp; if (b.ctr === 0) delete b.ctr;
    return !!b.x.trim();
  };
  const pushBlock = () => {
    if (!cur) return;
    if (finishTb(cur)) blocks.push(cur);
    cur = null;
  };
  const open = (t, pg, extra = {}) => { pushBlock(); cur = { t, tb: new TextBuilder(), pg, ...extra }; return cur; };

  const append = (runs) => {
    const tb = cur.tb;
    const t = tb.text;
    if (new RegExp(`[${LET}]-$`).test(t)) {
      const lw = (t.match(new RegExp(`([${LET}]+)-$`)) || [])[1] || '';
      const jt = joinRuns(runs).trim();
      const first = (jt.replace(/^-/, '').match(new RegExp(`^[${LET}]+`)) || [])[0] || '';
      const startsDash = jt.startsWith('-');
      const add = (rs, keepHy) => {
        if (!keepHy) tb.trimEndChars(1);
        let started = false, dashCut = startsDash;
        for (const r of rs) {
          let x = r.t;
          if (!started) { x = x.replace(/^\s+/, ''); if (dashCut && x.startsWith('-')) { x = x.slice(1); dashCut = false; } if (x) started = true; }
          if (x) tb.addRun(x, r.st);
        }
      };
      if (lw && first) {
        const comp = (lw + '-' + first).toLowerCase(), joined = (lw + first).toLowerCase();
        let keep;
        if (startsDash) keep = true;                       // „publiczno-” + „-prywatnego”: jeden łącznik
        else if (known.has(comp)) keep = true;             // złożenie występujące w tekście w całości
        else if (known.has(joined)) keep = false;          // zwykłe dzielenie wyrazu
        else keep = /o$/i.test(lw) && lw.length >= 6 && first.length >= 8; // „opiekuńczo-wychowawczych”
        add(runs, keep);
        return;
      }
    }
    tb.addLine(runs);
  };

  for (const p of pages) {
    const W = p.W;
    const kept = p.lines.filter((l) => {
      if (l.y > p.H * 0.945 || l.y < p.H * 0.055) return false;
      if ((l.y > p.H * 0.9 || l.y < p.H * 0.1) && l.size < body * 1.5) { const ks = [keyOf(l.text), ...l.segs.map((s) => keyOf(s.text))]; if (ks.some((k) => (rep.get(k) || 0) >= thr)) return false; }
      return true;
    }).sort((a, b) => b.y - a.y);
    const { body: lines, side } = splitMargin(kept, W, body);
    if (side.length) {
      side.sort((a, b) => b.y - a.y);
      for (const cl of side) {
        const text = cl.text.replace(/\s+/g, ' ').trim();
        const parts = text.split(/(?<=\.)\s+(?=(?:Opracowano|Nowe brzmienie|Zmian[ay]|Dodan[yea]|Przepis|Skreślon|Uchylon|Treść)\b)/);
        for (const part of parts) {
          if (!part.trim()) continue;
          if (p.no === pages[0].no && /^Opracowano na podstawie/.test(part)) { notes.push({ pg: p.no, text: part }); continue; }
          // uwaga redakcyjna o przepisach, które dopiero wejdą w życie
          const nb = { t: 'p', tb: new TextBuilder(), pg: p.no, sm: 1, fn: 1, note: 1 };
          nb.tb.addRun(part, ['i']);
          pendingFn.push(nb);
        }
      }
    }

    fnCur = null;
    let coverUntil = 0;
    if (p === pages[0]) {
      for (let k = 0; k < Math.min(lines.length, 30); k++) {
        const tx = joinRuns(lineRuns(lines[k])).replace(/\s+/g, ' ').trim();
        if (ART_RE.test(tx) || PAR_RE.test(tx) || HEAD_RE.test(tx)) break;
        const u2 = unspace(tx);
        if (KIND_RE.test(u2) && u2 === u2.toUpperCase()) { coverUntil = k; break; }
      }
    }
    let lastBodyY = Infinity;
    for (const l of lines) if (!(l.size <= Math.min(body - 0.95, body * 0.93)) && l.y < lastBodyY) lastBodyY = l.y;
    const emitGroup = (g, pg) => {
      pushBlock(); flushFn();
      for (const it of mergeItems(g.items)) blocks.push({ t: 'p', x: it.x, pg, ctr: 1, ttl: it.ttl, ...supTail(it.x) });
      g.emitted = true;
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let runs = lineRuns(l);
      let text = joinRuns(runs).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      let op = '';

      // przypisy dolne
      const small = l.size <= Math.min(body - 0.95, body * 0.93);
      if (small && l.y < lastBodyY - 0.5 && (fnCur || l.x0 <= left + 24 || /^\d{1,3}\)\s/.test(text))) {
        if (/^\d{1,3}\)\s/.test(text) || !fnCur) {
          fnCur = { t: 'p', tb: new TextBuilder(), pg: p.no, sm: 1, fn: 1 };
          pendingFn.push(fnCur);
        }
        fnCur.tb.addLine(runs);
        continue;
      }
      fnCur = null;
      // tytuł aktu (kolejność wierszy zachowana jak w pliku); drugi tytuł w treści (np. rozporządzenie w załączniku do obwieszczenia)
      {
        const u = unspace(text);
        const kindOk = KIND_RE.test(u) && (!grp || grp.closed) && ((inFront && !title.kind) || (units === 0 && u === u.toUpperCase() && (l.segs.every((s) => s.isBold) || l.size > body + 1)));
        if (inFront && DZU_RE.test(text)) { title.ref = text; continue; }
        if (!kindOk && grp && !grp.closed) {
          const centered = l.x0 > left + 40;
          if (/^z dnia\s/i.test(text) && !grp.date) { grp.date = true; grp.items.push({ x: text, ttl: 'd' }); grp.runs.push(runs); continue; }
          if (grp.items.length < 5 && !HEAD_RE.test(text) && !ART_RE.test(text) && !PAR_RE.test(text) && !/^\d{1,3}[.)]\s/.test(text) && (l.segs.every((s) => s.isBold) || (grp.date && centered && grp.subj < 3 && !/[.;:]$/.test(text)))) {
            grp.items.push({ x: text, ttl: 't' }); grp.runs.push(runs); grp.subj++; continue;
          }
          grp.closed = true;
        }
        if (kindOk) {
          grp = { items: [{ x: cap(u), ttl: 'k' }], runs: [null], date: false, subj: 0, closed: false, first: !title.kind };
          grpN++;
          titles.push(grp);
          if (grp.first) { title.kind = cap(u); title.items = grp.items; } else { pushBlock(); flushFn(); }
          continue;
        }
        // baner z numerem Dziennika Ustaw itp. przed pierwszym tytułem
        if (inFront && !title.kind && p.no === pages[0].no && i < coverUntil) { cover.push({ x: text, pg: p.no }); continue; }
      }
      if (grp && grp.closed && !grp.first && !grp.emitted) emitGroup(grp, p.no);

      // nagłówki: Dział / Rozdział / Oddział …
      const hOp = /^[\[<]/.test(text) && HEAD_RE.test(text.slice(1)) ? text[0] : '';
      const hm = text.slice(hOp.length).match(HEAD_RE);
      if (hm && l.x0 > left + Math.min(40, body * 3.2)) {
        op = hOp;
        inFront = false;
        pushBlock();
        flushFn();
        const kind = hm[1].toLowerCase();
        const ttl = [];
        let j = i + 1;
        while (j < lines.length && ttl.length < 3) {
          const n = lines[j];
          const nt = joinRuns(lineRuns(n)).replace(/\s+/g, ' ').trim();
          if ((ocr ? (n.x0 > left + 25 && !/[;,:]$/.test(nt) && nt.length < 140 && !/^\d+[.)]/.test(nt)) : (n.segs.every((s) => s.isBold) && n.size >= body - 0.6)) && !HEAD_RE.test(nt) && !ART_RE.test(nt) && !PAR_RE.test(nt)) { ttl.push(nt); j++; } else break;
        }
        i = j - 1;
        const hn = `${op}${cap(hm[1])} ${/\snr\s/i.test(text) ? 'nr ' : ''}${hm[2]}`;
        const txt = [hn, ttl.join(' ')].filter(Boolean).join(' ');
        blocks.push({ t: 'h', x: txt, pg: p.no, l: 1, hk: kind, hn, ht: ttl.join(' ') });
        headings.push({ block: blocks.length - 1, kind, text: txt });
        lastUst = 0;
        continue;
      }
      inFront = false;

      // wiersze w rodzaju „…………” oraz podpisy pod nimi (wzory formularzy) i bloki wyrównane do prawej — osobne akapity
      const dots = /^[.…_\s]{10,}$/.test(text);
      const rightAl = !dots && l.x0 > p.W * 0.4 && l.x1 >= rightEdge - 8 && text.length < 160 && !/^(Art\.|§)\s*\d/.test(text);
      if (dots || small || rightAl) {
        const kind = dots ? 'dots' : rightAl ? 'ra' : 'cap';
        const ctr = !rightAl && l.x0 > left + 60;
        if (!(cur && cur.lk === kind && cur.ctr === (ctr ? 1 : 0) && kind !== 'dots' && !cur.art && !cur.u && !cur.o)) {
          if (kind === 'ra' || (pendingFn.length && pendingFn[0].pg < p.no)) { pushBlock(); flushFn(); }
          open('p', p.no, kind === 'ra' ? { ra: 1, lk: kind, ctr: 0, ...(small ? { sm: 1 } : {}) } : kind === 'dots' ? { lk: kind, ctr: 0 } : { sm: 1, lk: kind, ctr: ctr ? 1 : 0 });
        }
        cur.tb.addLine(runs);
        continue;
      }
      // przepis ujęty w nawias ([…] — dawne brzmienie, <…> — brzmienie, które dopiero wejdzie w życie): otwarcie stoi przed numerem
      if (/^[\[<]/.test(text) && /^(?:Art\.\s*\d|§\s*\d|\d{1,3}[a-z]{0,3}[.)]|[a-z]{1,2}\))/.test(text.slice(1))) {
        op = text[0];
        runs = sliceRuns(runs, 1);
        text = joinRuns(runs).replace(/\s+/g, ' ').trim();
      }
      const indented = l.x0 > left + Math.min(15, body * 0.9);

      // artykuł
      const am = indented ? text.match(UNIT_RE) : null;
      if (am) {
        pushBlock();
        flushFn();
        units++;
        const label = am[2] ? `${am[1]}–${am[2]}` : am[1];
        let rest = sliceRuns(runs, joinRuns(runs).match(UNIT_RE)[0].length);
        open('p', p.no, { art: label, ...(sym === '§' ? { sg: '§' } : {}), ...(op ? { ob: op } : {}) });
        lastUst = 0;
        const um1 = joinRuns(rest).match(UST2_RE);
        if (um1 && um1[2] === '1' && !um1[3] && (sym === 'Art.' || !um1[1])) { cur.u = (um1[1] ? '§ ' : '') + '1.'; rest = sliceRuns(rest, um1[0].length); lastUst = 1; }
        cur.tb.addLine(rest);
        continue;
      }

      // ustęp
      const um = indented ? text.match(UST2_RE) : null;
      if (um && (cur || +um[2] === 1) && (sym === 'Art.' || !um[1])) {
        const n = +um[2];
        const ok = lastUst === 0 ? n === 1 && !um[3] : (n >= lastUst && n <= lastUst + 3) && !(n === lastUst && !um[3]);
        if (ok) {
          open('p', p.no, { u: op + (um[1] ? '§ ' : '') + um[2] + um[3] + '.' });
          cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(UST2_RE)[0].length));
          if (!um[3] || n > lastUst) lastUst = n;
          continue;
        }
      }
      // punkt
      const pm = text.match(PKT2_RE);
      if (pm && cur) {
        open('li', p.no, { o: op + pm[1] + ')', d: 1 });
        cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(PKT2_RE)[0].length));
        continue;
      }
      // litera
      const lm = text.match(LIT_RE);
      if (lm && cur && cur.t === 'li') {
        open('li', p.no, { o: op + lm[1] + ')', d: 2 });
        cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(LIT_RE)[0].length));
        continue;
      }
      if (op) { runs = [{ t: op, st: [] }, ...runs]; text = op + text; op = ''; }
      // tiret
      const dm = text.match(DASH_RE);
      if (dm && cur && cur.t === 'li' && indented) {
        open('li', p.no, { o: '–', d: Math.min(3, (cur.d || 1) + 1) });
        cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(DASH_RE)[0].length));
        continue;
      }

      // „część wspólna” po wyliczeniu: tekst wraca do lewego marginesu po średniku/przecinku
      if (cur && cur.t === 'li' && !indented && ((/[;,]$/.test(cur.tb.text) && /^[a-ząćęłńóśźż]/.test(text)) || DASH_RE.test(text))) {
        open('p', p.no, { wc: 1 });
        cur.tb.addLine(runs);
        continue;
      }
      if (!cur || cur.lk) open('p', p.no);
      append(runs);
    }
  }
  pushBlock();
  flushFn();

  // ── blok tytułowy ──
  const front = [];
  for (const c of cover) front.push({ t: 'p', x: c.x, pg: c.pg, ctr: 1, sm: 1 });
  for (const it of mergeItems(title.items)) front.push({ t: 'p', x: it.x, pg: 1, ctr: 1, ttl: it.ttl, ...supTail(it.x) });
  if (title.ref) front.push({ t: 'p', x: title.ref, pg: 1, ctr: 1, sm: 1 });
  const nt = notes.filter((n) => n.text);
  if (nt.length) front.push({ t: 'p', x: nt.map((n) => n.text).join(' · '), pg: nt[0].pg, ctr: 1, sm: 1, note: 1 });
  const shift = front.length;
  blocks.unshift(...front);
  headings.forEach((h) => { h.block += shift; });

  const entries = legalEntries(blocks, headings);
  for (const e of entries) e.legal = true;

  // nazwa dokumentu: dla obwieszczenia o tekście jednolitym — sam akt z załącznika
  const tg = titles.length > 1 && /^obwieszczenie$/i.test(titles[0].items[0].x) ? titles[1] : titles[0];
  const tt = tg ? tg.items.filter((it) => it.ttl !== 'd').map((it, i) => { const x = it.x.replace(/\s*\d{1,2}\)$/, ''); return i > 0 && x === x.toUpperCase() ? titleCase(x) : x; }).join(' ') : '';
  let author = title.ref || '';
  if (!author) {
    const poz = cover.map((c) => c.x.match(/^Poz\.\s*(\d+)/)).find(Boolean);
    const yr = cover.map((c) => c.x.match(/(\d{4})\s*r\./)).find(Boolean);
    if (poz && yr) author = `Dz. U. ${yr[1]} poz. ${poz[1]}`;
  }
  const meta = { title: tt, author };
  return { blocks, entries, meta, dateLine: tg && tg.items.find((it) => it.ttl === 'd')?.x };
}

// odnośnik do przypisu na końcu tytułu („…terroryzmu1)”) — jako indeks górny
function supTail(x) {
  const m = x.match(/(?<=[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])\d{1,2}\)$/);
  return m ? { m: [[m.index, x.length, 'u']] } : {};
}
const SMALLW = new Set(['i', 'w', 'z', 'o', 'a', 'u', 'na', 'do', 'od', 'po', 'za', 'ze', 'we', 'oraz', 'albo', 'lub']);
function titleCase(x) {
  return x.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && SMALLW.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
// kolejne wiersze tematu łączymy w jeden blok (jak w pliku: kilka linii jednego tytułu)
function mergeItems(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.ttl === 't' && it.ttl === 't') last.x += ' ' + it.x; else out.push({ ...it });
  }
  return out;
}
