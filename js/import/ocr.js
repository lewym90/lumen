// OCR skanów: tesseract.js działa lokalnie (vendor/tesseract), bez wysyłania czegokolwiek do sieci.
// Rozpoznane linie trafiają do tego samego potoku, co tekst z PDF-a (rozdziały, akty prawne, listy…).
import { db, kv } from '../db.js';
import { openPdf } from './pdfjs.js';
import { loadScript } from './loader.js';
import { structurePages } from './pdf.js';
import { buildChapters, blockWords, buildWordIndex } from './structure.js';
import { defaultProg, saveMeta, dropDocCache, bus } from '../state.js';
import { yieldUI } from '../util.js';

const base = (p) => new URL('../../vendor/tesseract/' + p, import.meta.url).href;

async function makeWorkers(n, langs, logger) {
  await loadScript('vendor/tesseract/tesseract.min.js', 'Tesseract');
  const T = window.Tesseract;
  const ws = [];
  for (let i = 0; i < n; i++) {
    ws.push(await T.createWorker(langs, 1, {
      workerPath: base('worker.min.js'),
      corePath: base(''),
      langPath: base('lang'),
      gzip: true,
      cacheMethod: 'none',
      logger: logger || (() => {}),
    }));
  }
  return ws;
}

// wynik tesseracta (linie ze słowami) → linie w formacie parsera PDF (układ PDF: oś Y w górę)
function toPdfLines(data, W, H, scale) {
  const out = [];
  for (const ln of data.lines || []) {
    const words = (ln.words || []).filter((w) => w.text && w.text.trim() && w.confidence > 25);
    if (!words.length) continue;
    const conf = words.reduce((a, w) => a + w.confidence, 0) / words.length;
    const txt = words.map((w) => w.text).join(' ');
    if (conf < 40 && txt.length < 12) continue;
    if (!/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]/.test(txt)) continue;
    const hs = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const hpx = hs[hs.length >> 1] || (ln.bbox.y1 - ln.bbox.y0);
    const size = Math.max(6, (hpx / scale) * 1.2);
    const baseY = H - (ln.bbox.y1 - hpx * 0.18) / scale;
    words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const segs = [];
    let seg = null, prevX1 = null;
    for (const w of words) {
      const gap = prevX1 == null ? 0 : w.bbox.x0 - prevX1;
      if (!seg || gap > hpx * 2.6) {
        seg = { x0: w.bbox.x0 / scale, x1: w.bbox.x1 / scale, runs: [{ t: '', st: [] }], chars: 0, bold: 0, mono: 0 };
        segs.push(seg);
      }
      const r = seg.runs[0];
      r.t += (r.t ? ' ' : '') + w.text.trim();
      seg.chars += w.text.trim().length;
      seg.x1 = w.bbox.x1 / scale;
      prevX1 = w.bbox.x1;
    }
    for (const s of segs) { s.text = s.runs.map((r) => r.t).join(''); s.isBold = false; s.isMono = false; }
    out.push({ y: baseY, size, segs, x0: segs[0].x0, x1: segs[segs.length - 1].x1, text: segs.map((s) => s.text).join('  ') });
  }
  out.sort((a, b) => b.y - a.y);
  return out;
}

export function ocrSupported() { return typeof WebAssembly === 'object' && typeof Worker === 'function'; }

// Rozpoznaje cały dokument i podmienia jego treść. Zwraca nową liczbę słów.
export async function ocrDocument(meta, { onProgress = () => {}, signal } = {}) {
  const blob = await db.get('files', meta.id);
  if (!blob) throw new Error('Brak oryginalnego pliku PDF — nie mam z czego rozpoznać tekstu.');
  const pdf = await openPdf(blob);
  const n = pdf.numPages;
  const key = 'ocr.' + meta.id;
  let saved = await kv.get(key, null);
  if (!saved || saved.n !== n) saved = { n, pages: {} };
  const todo = [];
  for (let p = 1; p <= n; p++) if (!saved.pages[p]) todo.push(p);

  let done = n - todo.length;
  const report = (phase, extra = {}) => onProgress({ page: done, pages: n, frac: Math.min(0.96, (done / n) * 0.96), phase, ...extra });
  report('Przygotowuję silnik rozpoznawania');
  const hw = navigator.hardwareConcurrency || 2;
  const nWorkers = todo.length ? Math.max(1, Math.min(3, Math.floor(hw / 2), todo.length)) : 0;
  let workers = [];
  try {
    if (todo.length) workers = await makeWorkers(nWorkers, 'pol+eng', undefined);
    let next = 0, failed = null, sinceSave = 0;
    const lane = async (w) => {
      while (!failed) {
        if (signal?.aborted) return;
        const i = next++;
        if (i >= todo.length) return;
        const pno = todo[i];
        try {
          const page = await pdf.getPage(pno);
          const vp1 = page.getViewport({ scale: 1 });
          const scale = Math.min(3.2, Math.max(1.6, 2300 / vp1.width));
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          page.cleanup();
          const { data } = await w.recognize(canvas);
          saved.pages[pno] = { W: vp1.width, H: vp1.height, lines: toPdfLines(data, vp1.width, vp1.height, scale) };
          canvas.width = canvas.height = 0;
        } catch (e) { failed = e; return; }
        done++;
        report('Rozpoznaję tekst', { detail: `strona ${done} z ${n}` });
        if (++sinceSave >= 6) { sinceSave = 0; kv.set(key, saved).catch(() => {}); }
        await yieldUI();
      }
    };
    await Promise.all(workers.map(lane));
    if (failed) throw failed;
    if (signal?.aborted) { await kv.set(key, saved).catch(() => {}); const e = new Error('Przerwano'); e.aborted = true; throw e; }
  } finally {
    for (const w of workers) { try { await w.terminate(); } catch { /* brak */ } }
  }

  report('Układam strukturę dokumentu');
  await yieldUI();
  const pages = [];
  for (let p = 1; p <= n; p++) { const r = saved.pages[p]; pages.push({ no: p, W: r.W, H: r.H, lines: r.lines }); }
  // wysokość linii z OCR jest zaszumiona (wąsy liter, cyfry) — ujednolicamy ją do tekstu podstawowego,
  // zostawiając tylko wyraźnie większe nagłówki
  {
    const all = pages.flatMap((p) => p.lines.filter((l) => l.text.length > 25).map((l) => l.size)).sort((a, b) => a - b);
    const M = all.length ? all[all.length >> 1] : 12;
    for (const p of pages) for (const l of p.lines) l.size = l.size > M * 1.32 ? l.size : M;
  }
  pages.ocr = true;
  const chars = pages.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.text.length, 0), 0);
  if (chars / n < 60) { try { await kv.del?.(key); } catch { /* brak */ } throw new Error('Nie udało się rozpoznać tekstu na tych stronach (zbyt słaba jakość skanu?).'); }

  const res = await structurePages(pdf, pages, { title: meta.title, author: meta.author, pages: n }, n, () => {});
  const blocks = res.blocks.filter((b) => b.t === 'img' || b.t === 'table' || (b.x && b.x.trim()));
  const map = new Map();
  { let k = 0; res.blocks.forEach((b, i) => { map.set(i, k); if (blocks[k] === b) k++; }); }
  const entries = (res.entries || []).map((e) => ({ ...e, block: map.get(e.block) ?? 0 }));
  blocks.forEach((b) => { delete b._y; delete b._y1; blockWords(b); });
  const chapters = buildChapters(blocks, entries, meta.title);
  const doc = { blocks, chapters };
  const cw = buildWordIndex(doc);

  await db.put('content', { blocks, chapters, auto: JSON.parse(JSON.stringify(chapters)), v: 1 }, meta.id);
  // stare zakładki dotyczyły obrazów stron – po zmianie treści są nieaktualne
  try { for (const m of await db.byDoc(meta.id)) await db.del('marks', m.id); } catch { /* brak */ }
  meta.scanned = false;
  meta.ocr = true;
  meta.legal = !!res.legal;
  meta.words = cw[blocks.length];
  meta.chapterCount = chapters.length;
  meta.pct = 0;
  meta.prog = defaultProg();
  meta.auto = true;
  await saveMeta(meta);
  try { await kv.set(key, null); } catch { /* brak */ }
  try { pdf.destroy(); } catch { /* brak */ }
  dropDocCache();
  bus.emit('library');
  onProgress({ page: n, pages: n, frac: 1, phase: 'Gotowe' });
  return meta.words;
}
