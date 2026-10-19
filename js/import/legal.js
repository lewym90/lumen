// Tryb aktów prawnych (ustawy, rozporządzenia, kodeksy): działy, rozdziały, artykuły, ustępy, punkty, litery.
// Działa na liniach wyciągniętych z PDF-a (patrz pdf.js → extractLines).
import { TextBuilder } from './textbuild.js';

const ART_RE = /^Art\.\s*(\d+[a-z]{0,3})(?:\s*[–-]\s*(\d+[a-z]{0,3}))?\.(?:\s+|$)/;
const HEAD_RE = /^(KSIĘGA|Księga|TYTUŁ|Tytuł|CZĘŚĆ|Część|DZIAŁ|Dział|ROZDZIAŁ|Rozdział|ODDZIAŁ|Oddział)\s+([IVXLCDM]+|\d+[a-z]{0,3})\.?$/;
const RANK = { księga: 0, tytuł: 1, część: 2, dział: 3, rozdział: 4, oddział: 5 };
const UST_RE = /^(\d{1,3})([a-z]{0,3})\.\s+(?=\S)/;
const PKT_RE = /^(\d{1,3}[a-z]{0,3})\)\s+(?=\S)/;
const LIT_RE = /^([a-z]{1,2})\)\s+(?=\S)/;
const DASH_RE = /^[–—-]\s+(?=\S)/;
const DZU_RE = /^Dz\.\s*U\./;
const LET = 'A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const unspace = (s) => (/^(\S\s){3,}\S$/.test(s.trim()) ? s.replace(/\s+/g, '') : s);
const keyOf = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

export function detectLegal(pages) {
  let arts = 0, lines = 0;
  for (const p of pages) for (const l of p.lines) { lines++; if (ART_RE.test(l.text)) arts++; }
  return arts >= 15 && arts / Math.max(1, pages.length) >= 0.25 && arts / Math.max(1, lines) > 0.004;
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

// oddziel kolumnę uwag na marginesie od właściwej linii
function splitMargin(lines, W) {
  const body = [], side = [];
  for (const l of lines) {
    const mSegs = l.segs.filter((s) => s.x0 > W * 0.72);
    if (!mSegs.length) { body.push(l); continue; }
    const rest = l.segs.filter((s) => s.x0 <= W * 0.72);
    side.push({ y: l.y, text: mSegs.map((s) => s.text.trim()).join(' ') });
    if (rest.length) {
      body.push({ ...l, segs: rest, x0: rest[0].x0, x1: rest[rest.length - 1].x1, text: rest.map((s) => s.text.trim()).join('  ') });
    }
  }
  return { body, side };
}

export function parseLegal(pages) {
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

  // powtarzające się nagłówki/stopki
  const rep = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if (!(l.y > p.H * 0.9 || l.y < p.H * 0.1)) continue;
      for (const k of [keyOf(l.text), ...l.segs.map((s) => keyOf(s.text))]) if (k.length > 1 && !seen.has(k)) { seen.add(k); rep.set(k, (rep.get(k) || 0) + 1); }
    }
  }
  const thr = Math.max(4, pages.length * 0.3);

  const blocks = [];
  const headings = [];
  const notes = [];
  const title = { kind: '', date: '', subject: [], ref: '' };
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
    delete b.tb;
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
      const first = joinRuns(runs).trim().match(new RegExp(`^[${LET}]+`));
      if (lw && first && hy.has((lw + '-' + first[0]).toLowerCase())) {
        let started = false;
        for (const r of runs) { let s = r.t; if (!started) { s = s.replace(/^\s+/, ''); if (s) started = true; } if (s) tb.addRun(s, r.st); }
        return;
      }
    }
    tb.addLine(runs);
  };

  for (const p of pages) {
    const W = p.W;
    const kept = p.lines.filter((l) => {
      if (l.y > p.H * 0.945 || l.y < p.H * 0.055) return false;
      if (l.y > p.H * 0.9 || l.y < p.H * 0.1) { const ks = [keyOf(l.text), ...l.segs.map((s) => keyOf(s.text))]; if (ks.some((k) => (rep.get(k) || 0) >= thr)) return false; }
      return true;
    }).sort((a, b) => b.y - a.y);
    const { body: lines, side } = splitMargin(kept, W);
    if (side.length) {
      side.sort((a, b) => b.y - a.y);
      const st = side.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      if (p.no === 1) {
        const mm = st.match(/Opracowano na podstawie:.*?poz\.[\d, i]+\./);
        if (mm) notes.push({ pg: 1, text: mm[0] });
      }
      // uwagi redakcyjne o przepisach, które dopiero wejdą w życie
      const ed = st.match(/(?:Przepis|Nowe brzmienie)[^]*?\(Dz\. U\.[^)]*\)\./g);
      if (ed) for (const t of ed) {
        const nb = { t: 'p', tb: new TextBuilder(), pg: p.no, sm: 1, fn: 1, note: 1 };
        nb.tb.addRun(t, ['i']);
        pendingFn.push(nb);
      }
    }

    fnCur = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const runs = lineRuns(l);
      const text = joinRuns(runs).replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // przypisy dolne
      if (l.size <= body - 1.2 && l.y < p.H * 0.45) {
        if (/^\d{1,3}\)\s/.test(text) || !fnCur) {
          fnCur = { t: 'p', tb: new TextBuilder(), pg: p.no, sm: 1, fn: 1 };
          pendingFn.push(fnCur);
        }
        fnCur.tb.addLine(runs);
        continue;
      }
      fnCur = null;

      // tytuł aktu
      if (inFront) {
        const u = unspace(text);
        if (DZU_RE.test(text)) { title.ref = text; continue; }
        if (/^(USTAWA|ROZPORZĄDZENIE|KODEKS|DEKRET|OBWIESZCZENIE|UCHWAŁA|KONSTYTUCJA)$/i.test(u) && !title.kind) { title.kind = cap(u); continue; }
        if (/^z dnia\s/i.test(text) && !title.date && title.kind) { title.date = text; continue; }
        if (title.kind && !HEAD_RE.test(text) && !ART_RE.test(text) && title.subject.length < 3 && (l.segs.every((s) => s.isBold) || title.date)) { title.subject.push(text); continue; }
      }

      // nagłówki: Dział / Rozdział / Oddział …
      const hm = text.match(HEAD_RE);
      if (hm && l.x0 > left + 40) {
        inFront = false;
        flushFn();
        pushBlock();
        const kind = hm[1].toLowerCase();
        const ttl = [];
        let j = i + 1;
        while (j < lines.length && ttl.length < 3) {
          const n = lines[j];
          const nt = joinRuns(lineRuns(n)).replace(/\s+/g, ' ').trim();
          if (n.segs.every((s) => s.isBold) && n.size >= body - 0.6 && !HEAD_RE.test(nt) && !ART_RE.test(nt)) { ttl.push(nt); j++; } else break;
        }
        i = j - 1;
        const txt = [`${cap(hm[1])} ${hm[2]}`, ttl.join(' ')].filter(Boolean).join(' ');
        blocks.push({ t: 'h', x: txt, pg: p.no, l: 1, hk: kind, hn: `${cap(hm[1])} ${hm[2]}`, ht: ttl.join(' ') });
        headings.push({ block: blocks.length - 1, kind, text: txt });
        lastUst = 0;
        continue;
      }
      inFront = false;

      const indented = l.x0 > left + 15;

      // artykuł
      const am = indented ? text.match(ART_RE) : null;
      if (am) {
        flushFn();
        const label = am[2] ? `${am[1]}–${am[2]}` : am[1];
        let rest = sliceRuns(runs, joinRuns(runs).match(ART_RE)[0].length);
        open('p', p.no, { art: label });
        lastUst = 0;
        const um1 = joinRuns(rest).match(UST_RE);
        if (um1 && um1[1] === '1' && !um1[2]) { cur.u = '1.'; rest = sliceRuns(rest, um1[0].length); lastUst = 1; }
        cur.tb.addLine(rest);
        continue;
      }

      // ustęp
      const um = indented ? text.match(UST_RE) : null;
      if (um && cur) {
        const n = +um[1];
        const ok = lastUst === 0 ? n === 1 && !um[2] : (n >= lastUst && n <= lastUst + 3) && !(n === lastUst && !um[2]);
        if (ok) {
          open('p', p.no, { u: um[1] + um[2] + '.' });
          cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(UST_RE)[0].length));
          if (!um[2] || n > lastUst) lastUst = n;
          continue;
        }
      }
      // punkt
      const pm = text.match(PKT_RE);
      if (pm && cur) {
        open('li', p.no, { o: pm[1] + ')', d: 1 });
        cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(PKT_RE)[0].length));
        continue;
      }
      // litera
      const lm = text.match(LIT_RE);
      if (lm && cur && cur.t === 'li') {
        open('li', p.no, { o: lm[1] + ')', d: 2 });
        cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(LIT_RE)[0].length));
        continue;
      }
      // tiret
      const dm = text.match(DASH_RE);
      if (dm && cur && cur.t === 'li') {
        open('li', p.no, { o: '–', d: Math.min(3, (cur.d || 1) + 1) });
        cur.tb.addLine(sliceRuns(runs, joinRuns(runs).match(DASH_RE)[0].length));
        continue;
      }

      // „część wspólna” po wyliczeniu: tekst wraca do lewego marginesu po średniku/przecinku
      if (cur && cur.t === 'li' && !indented && /[;,]$/.test(cur.tb.text) && /^[a-ząćęłńóśźż]/.test(text)) {
        open('p', p.no, { wc: 1 });
        cur.tb.addLine(runs);
        continue;
      }
      if (!cur) open('p', p.no);
      append(runs);
    }
  }
  pushBlock();
  flushFn();

  // ── blok tytułowy ──
  const front = [];
  const kindTxt = title.kind || 'Akt prawny';
  const subject = title.subject.join(' ');
  front.push({ t: 'p', x: kindTxt, pg: 1, ctr: 1, ttl: 'k' });
  if (title.date) front.push({ t: 'p', x: title.date, pg: 1, ctr: 1, ttl: 'd' });
  if (subject) front.push({ t: 'p', x: subject, pg: 1, ctr: 1, ttl: 't' });
  if (title.ref) front.push({ t: 'p', x: title.ref, pg: 1, ctr: 1, sm: 1 });
  const nt = notes.filter((n) => n.text);
  if (nt.length) front.push({ t: 'p', x: nt.map((n) => n.text).join(' · '), pg: nt[0].pg, ctr: 1, sm: 1, note: 1 });
  const shift = front.length;
  blocks.unshift(...front);
  headings.forEach((h) => { h.block += shift; });

  // ── poziomy nagłówków i podział na rozdziały ──
  const kinds = [...new Set(headings.map((h) => h.kind))].sort((a, b) => RANK[a] - RANK[b]);
  const lvlOf = new Map(kinds.map((k, i) => [k, i + 1]));
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
  for (const e of entries) e.legal = true;

  const meta = {
    title: [kindTxt, subject].filter(Boolean).join(' ') || 'Akt prawny',
    author: title.ref || '',
  };
  return { blocks, entries, meta, dateLine: title.date };
}
