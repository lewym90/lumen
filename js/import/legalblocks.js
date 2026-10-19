// Tryb aktów prawnych dla źródeł innych niż PDF (HTML z internetu, DOCX, TXT, wklejony tekst):
// rozpoznaje artykuły, ustępy, punkty i litery w gotowych blokach tekstu i nadaje im tę samą strukturę co w PDF-ie.
// Treść nie jest zmieniana — z początku bloku zdejmowany jest tylko numer (np. „Art. 5.”, „2.”, „3)”),
// który trafia do osobnego pola i jest wyświetlany w tym samym miejscu.
import { ART_RE, HEAD_RE, UST_RE, PKT_RE, LIT_RE, DASH_RE, DZU_RE, legalEntries, cap } from './legal.js';

const plain = (b) => (b.t === 'p' || b.t === 'li' || b.t === 'quote' || b.t === 'h') && typeof b.x === 'string';

export function detectLegalBlocks(blocks) {
  let arts = 0, prev = 0, ordered = 0;
  for (const b of blocks) {
    if (!plain(b)) continue;
    const m = b.x.trim().match(ART_RE);
    if (m) { arts++; const n = parseInt(m[1], 10); if (n >= prev && n <= prev + 3) ordered++; prev = n; }
  }
  return arts >= 15 && arts / Math.max(1, blocks.length) >= 0.02 && ordered / arts >= 0.8;
}

// zdejmuje n znaków z początku tekstu bloku, przesuwając znaczniki formatowania
function strip(b, n) {
  const x = b.x;
  let k = n;
  while (k < x.length && /\s/.test(x[k])) k++;
  const nb = { ...b, x: x.slice(k) };
  if (b.m && b.m.length) {
    nb.m = b.m.map(([s, e, t, ...r]) => [Math.max(0, s - k), e - k, t, ...r]).filter(([s, e]) => e > s);
    if (!nb.m.length) delete nb.m;
  }
  return nb;
}

const MARK_RE = /^(\d{1,3}[a-z]{0,3}[.)]|[a-z]{1,2}\)|[–—-])$/;

// listy ze źródła (<ol>, numeracja DOCX): numer wraca na początek tekstu, żeby dalsze reguły działały tak samo jak dla PDF-a
function unlist(b) {
  if (b.t !== 'li' || !b.o || !MARK_RE.test(String(b.o).trim())) return b;
  const pre = String(b.o).trim() + ' ';
  const nb = { ...b, t: 'p', x: pre + b.x };
  delete nb.o; delete nb.d;
  if (b.m) nb.m = b.m.map(([s, e, t, ...r]) => [s + pre.length, e + pre.length, t, ...r]);
  return nb;
}

export function legalizeBlocks(input) {
  const src = input.filter((b) => b.t !== 'page').map(unlist);
  const out = [];
  const headings = [];
  const front = { kind: '', date: '', subject: [], ref: '', note: '' };
  let inFront = true, lastUst = 0, cur = null, wantBody = false;

  const push = (b) => { out.push(b); return b; };

  for (let i = 0; i < src.length; i++) {
    const b = src[i];
    if (!plain(b)) { inFront = false; wantBody = false; push({ ...b }); continue; }
    const text = b.x.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    if (inFront) {
      const u = text.replace(/\s/g, '');
      if (DZU_RE.test(text) && !front.ref) { front.ref = text; continue; }
      if (/^(USTAWA|ROZPORZĄDZENIE|KODEKS|DEKRET|OBWIESZCZENIE|UCHWAŁA|KONSTYTUCJA)$/i.test(u) && !front.kind) { front.kind = cap(u); continue; }
      if (/^z dnia\s/i.test(text) && !front.date && front.kind) { front.date = text; continue; }
      if (/^Opracowano na podstawie/i.test(text) && front.kind) { front.note = text; continue; }
      if (front.kind && !HEAD_RE.test(text) && !ART_RE.test(text) && front.subject.length < 3) { front.subject.push(text); continue; }
    }

    const hm = text.match(HEAD_RE);
    if (hm) {
      inFront = false; wantBody = false; cur = null; lastUst = 0;
      // tytuł działu: kolejne krótkie bloki bez numeracji (lub ten sam blok po znaku nowej linii)
      const ttl = [];
      let j = i + 1;
      while (j < src.length && ttl.length < 2) {
        const n = src[j];
        const nt = plain(n) ? n.x.replace(/\s+/g, ' ').trim() : '';
        if (!nt || HEAD_RE.test(nt) || ART_RE.test(nt) || nt.length > 160 || /[.;:]$/.test(nt) && nt.length > 90) break;
        if (n.t === 'h' || n.t === 'p') { ttl.push(nt); j++; } else break;
        if (n.t === 'h') break;
      }
      i = j - 1;
      const hn = `${cap(hm[1])} ${hm[2]}`;
      const ht = ttl.join(' ');
      push({ t: 'h', x: [hn, ht].filter(Boolean).join(' '), l: 1, hk: hm[1].toLowerCase(), hn, ht, ...(b.pg ? { pg: b.pg } : {}) });
      headings.push({ block: out.length - 1, kind: hm[1].toLowerCase(), text: out[out.length - 1].x });
      continue;
    }
    if (b.t === 'h' && inFront) { inFront = false; }
    inFront = false;
    if (b.t === 'h') { wantBody = false; push({ ...b }); continue; }

    const raw = b.x.replace(/^\s+/, '');
    const am = raw.match(ART_RE);
    if (am) {
      const label = am[2] ? `${am[1]}–${am[2]}` : am[1];
      let nb = strip(b, am[0].length);
      const art = { ...nb, t: 'p', art: label };
      delete art.o; delete art.d;
      lastUst = 0;
      const um1 = nb.x.match(UST_RE);
      if (um1 && um1[1] === '1' && !um1[2]) { const s2 = strip(nb, um1[0].length); art.x = s2.x; if (s2.m) art.m = s2.m; else delete art.m; art.u = '1.'; lastUst = 1; }
      cur = push(art);
      wantBody = !art.x.trim();
      continue;
    }
    if (wantBody && cur && !UST_RE.test(raw) && !PKT_RE.test(raw)) {
      // numer artykułu w osobnym bloku — dołącz treść do niego
      cur.x = b.x.replace(/^\s+/, ''); if (b.m) cur.m = b.m; wantBody = false;
      const um1 = cur.x.match(UST_RE);
      if (um1 && um1[1] === '1' && !um1[2] && !cur.u) { const s2 = strip(cur, um1[0].length); cur.x = s2.x; if (s2.m) cur.m = s2.m; else delete cur.m; cur.u = '1.'; lastUst = 1; }
      continue;
    }
    if (wantBody && cur) wantBody = false;

    const um = cur && raw.match(UST_RE);
    if (um && b.t !== 'li') {
      const n = +um[1];
      const ok = lastUst === 0 ? n === 1 && !um[2] : (n >= lastUst && n <= lastUst + 3) && !(n === lastUst && !um[2]);
      if (ok) {
        const nb = strip(b, um[0].length);
        cur = push({ ...nb, t: 'p', u: um[1] + um[2] + '.' });
        if (!um[2] || n > lastUst) lastUst = n;
        continue;
      }
    }
    // przypisy dolne tekstu jednolitego („1) Zmiany tekstu jednolitego wymienionej ustawy…”) zostają zwykłym tekstem
    if (/^\d{1,3}\)\s+Zmiany tekstu jednolitego/i.test(raw)) { cur = push({ ...b, t: 'p', sm: 1, fn: 1 }); continue; }
    const pm = cur && raw.match(PKT_RE);
    if (pm) { const nb = strip(b, pm[0].length); cur = push({ ...nb, t: 'li', o: pm[1] + ')', d: 1 }); continue; }
    const lm = cur && cur.t === 'li' && raw.match(LIT_RE);
    if (lm) { const nb = strip(b, lm[0].length); cur = push({ ...nb, t: 'li', o: lm[1] + ')', d: 2 }); continue; }
    const dm = cur && cur.t === 'li' && !cur.fn && raw.match(DASH_RE);
    if (dm) { const nb = strip(b, dm[0].length); cur = push({ ...nb, t: 'li', o: '–', d: cur.o === '–' ? cur.d : Math.min(3, (cur.d || 1) + 1) }); continue; }

    // część wspólna po wyliczeniu (zwykły akapit po średniku/przecinku, zaczyna się małą literą)
    if (cur && cur.t === 'li' && b.t === 'p' && /[;,]$/.test(cur.x.trim()) && /^[a-ząćęłńóśźż]/.test(raw)) { cur = push({ ...b, t: 'p', wc: 1 }); continue; }
    // pozostały tekst (przypisy, kontynuacje): zostaje dokładnie jak w źródle
    cur = push({ ...b });
  }

  // blok tytułowy
  const frontBlocks = [];
  const kindTxt = front.kind || 'Akt prawny';
  const subject = front.subject.join(' ');
  frontBlocks.push({ t: 'p', x: kindTxt, ctr: 1, ttl: 'k' });
  if (front.date) frontBlocks.push({ t: 'p', x: front.date, ctr: 1, ttl: 'd' });
  if (subject) frontBlocks.push({ t: 'p', x: subject, ctr: 1, ttl: 't' });
  if (front.ref) frontBlocks.push({ t: 'p', x: front.ref, ctr: 1, sm: 1 });
  if (front.note) frontBlocks.push({ t: 'p', x: front.note, ctr: 1, sm: 1, note: 1 });
  const shift = frontBlocks.length;
  const blocks = [...frontBlocks, ...out];
  headings.forEach((h) => { h.block += shift; });

  // poziomy nagłówków
  const entries = legalEntries(blocks, headings);
  for (const e of entries) e.legal = true;
  return {
    blocks, entries,
    meta: { title: [kindTxt, subject].filter(Boolean).join(' ') || 'Akt prawny', author: front.ref || '' },
  };
}
