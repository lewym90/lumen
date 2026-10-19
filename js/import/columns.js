// Strony dwukolumnowe: zamienia stronę na „strony wirtualne” w kolejności czytania
// (nagłówek na całą szerokość → lewa kolumna → prawa kolumna → …), żeby tekst nie mieszał się między kolumnami.
// Strony jednokolumnowe przechodzą bez zmian (ten sam obiekt).

const BIN = 2;

function lineText(segs) { return segs.map((s) => s.text.trim()).join('  '); }

function makeLine(l, segs, dx) {
  const sg = segs.map((s) => (dx ? { ...s, x0: s.x0 - dx, x1: s.x1 - dx } : s));
  return { ...l, segs: sg, x0: sg[0].x0, x1: sg[sg.length - 1].x1, text: lineText(sg) };
}

// zwraca { g0, g1 } (pas pustki między kolumnami) albo null
export function findGutter(page) {
  const W = page.W;
  const body = page.lines.filter((l) => l.text.length >= 12 && l.y < page.H * 0.93 && l.y > page.H * 0.06);
  if (body.length < 24) return null;
  const nb = Math.ceil(W / BIN);
  const cover = new Array(nb).fill(0);
  for (const l of body) {
    const seen = new Set();
    for (const s of l.segs) for (let b = Math.max(0, Math.floor(s.x0 / BIN)); b <= Math.min(nb - 1, Math.floor(s.x1 / BIN)); b++) seen.add(b);
    seen.forEach((b) => { cover[b]++; });
  }
  const lim = Math.max(2, body.length * 0.07);
  let best = null, runStart = -1;
  const from = Math.floor(W * 0.36 / BIN), to = Math.floor(W * 0.64 / BIN);
  for (let b = from; b <= to + 1; b++) {
    const free = b <= to && cover[b] <= lim;
    if (free && runStart < 0) runStart = b;
    if (!free && runStart >= 0) {
      const w = (b - runStart) * BIN;
      if (!best || w > best.w) best = { w, g0: runStart * BIN, g1: b * BIN };
      runStart = -1;
    }
  }
  if (!best || best.w < 9) return null;
  // obie strony muszą zawierać sporo tekstu, a jedna linia zwykle ma segmenty po obu stronach (lub po jednej)
  let L = 0, Rr = 0, both = 0;
  for (const l of body) {
    const gcc = (best.g0 + best.g1) / 2;
    const hasL = l.segs.some((s) => s.x1 <= gcc), hasR = l.segs.some((s) => s.x0 >= gcc);
    if (hasL) L++;
    if (hasR) Rr++;
    if (hasL && hasR) both++;
  }
  if (L < body.length * 0.3 || Rr < body.length * 0.3) return null;
  // typowy tekst jednokolumnowy z szerokim marginesem notatek (kolumna uwag) nie jest dwiema kolumnami:
  // druga kolumna musi mieć szerokość porównywalną z pierwszą
  let lx0 = Infinity, lx1 = 0, rx0 = Infinity, rx1 = 0;
  for (const l of body) for (const s of l.segs) {
    const gcc = (best.g0 + best.g1) / 2;
    if (s.x1 <= gcc) { lx0 = Math.min(lx0, s.x0); lx1 = Math.max(lx1, s.x1); }
    else if (s.x0 >= gcc) { rx0 = Math.min(rx0, s.x0); rx1 = Math.max(rx1, s.x1); }
  }
  const lw = lx1 - lx0, rw = rx1 - rx0;
  if (!(lw > W * 0.25 && rw > W * 0.25 && Math.min(lw, rw) / Math.max(lw, rw) > 0.6)) return null;
  return { ...best, gc: (best.g0 + best.g1) / 2, lx0, rx0, rx1, lx1 };
}

export function splitColumns(pages) {
  const out = [];
  let any = false;
  // wykrywamy raz dla całego dokumentu: dokument jest dwukolumnowy, jeśli taka jest większość stron z tekstem
  const gs = pages.map((p) => findGutter(p));
  const withText = pages.filter((p) => p.lines.length > 24).length;
  const colPages = gs.filter(Boolean).length;
  if (!withText || colPages < Math.max(2, withText * 0.5)) return { pages, columns: false };
  // strony z małą ilością tekstu (np. ostatnia) dostają podział z dokumentu, jeśli pasuje do ich układu
  const ref = gs.filter(Boolean).sort((a, b) => a.gc - b.gc)[gs.filter(Boolean).length >> 1];
  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi];
    let g = gs[pi];
    if (!g && p.lines.length >= 2) {
      const body = p.lines.filter((l) => l.text.length >= 8 && l.y < p.H * 0.93 && l.y > p.H * 0.06);
      const cross = body.filter((l) => l.segs.some((sg) => sg.x0 < ref.gc && sg.x1 > ref.gc)).length;
      const withR = body.filter((l) => l.segs.some((sg) => sg.x0 >= ref.gc)).length;
      if (body.length && cross <= body.length * 0.1 && withR >= body.length * 0.2) g = ref;
    }
    if (!g) { out.push(p); continue; }
    any = true;
    const lines = p.lines.slice().sort((a, b) => b.y - a.y);
    const shift = g.rx0 - g.lx0;
    const W2 = Math.max(g.lx1, g.rx1 - shift) + g.lx0;
    const mk = (arr, tag) => ({ ...p, W: tag === 'span' ? p.W : W2, lines: arr, _col: tag });
    let left = [], right = [], span = [];
    const flush = () => {
      if (span.length) out.push(mk(span, 'span')); span = [];
      if (left.length) out.push(mk(left, 'L')); left = [];
      if (right.length) out.push(mk(right, 'R')); right = [];
    };
    for (const l of lines) {
      const crosses = l.segs.some((s) => s.x0 < g.gc && s.x1 > g.gc);
      if (crosses) {
        // pełna szerokość: zamyka bieżące kolumny
        if (left.length || right.length) flush();
        span.push(l);
        continue;
      }
      if (span.length && (left.length || right.length)) flush();
      const ls = l.segs.filter((s) => s.x1 <= g.gc), rs = l.segs.filter((s) => s.x0 >= g.gc);
      if (span.length && !left.length && !right.length && (ls.length || rs.length)) {
        // pierwsza linia kolumn po nagłówku: nagłówek zostaje osobno
        out.push(mk(span, 'span')); span = [];
      }
      if (ls.length) left.push(makeLine(l, ls, 0));
      if (rs.length) right.push(makeLine(l, rs, shift));
    }
    flush();
  }
  return { pages: any ? out : pages, columns: any };
}
