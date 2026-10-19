// Podgląd oryginalnych stron PDF (dla diagramów, tabel i skanów)
import { h, ic, clamp } from '../util.js';
import { db } from '../db.js';
import { openPdf } from '../import/pdfjs.js';
import { openSheet } from '../ui.js';

const cache = { id: null, promise: null };

export function getPdf(docId) {
  if (cache.id === docId && cache.promise) return cache.promise;
  releasePdf();
  cache.id = docId;
  cache.promise = (async () => {
    const blob = await db.get('files', docId);
    if (!blob) throw new Error('Brak oryginalnego pliku');
    return openPdf(blob);
  })();
  return cache.promise;
}

export function releasePdf() {
  if (cache.promise) { cache.promise.then((p) => { try { p.destroy(); } catch { /* brak */ } }).catch(() => {}); }
  cache.id = null; cache.promise = null;
}

export async function renderPage(canvas, docId, pageNo, cssWidth) {
  const pdf = await getPdf(docId);
  const page = await pdf.getPage(pageNo);
  const vp0 = page.getViewport({ scale: 1 });
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const scale = (cssWidth * dpr) / vp0.width;
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.aspectRatio = `${vp0.width} / ${vp0.height}`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
  page.cleanup();
}

// Wycinek strony (diagram) w pozycji PDF: y0 = góra, y1 = dół (układ PDF: oś Y w górę)
export async function renderRegion(canvas, docId, pageNo, y0, y1, cssWidth) {
  const pdf = await getPdf(docId);
  const page = await pdf.getPage(pageNo);
  const vp0 = page.getViewport({ scale: 1 });
  const H = vp0.height;
  let top = y0 == null ? H * 0.06 : H - y0;
  let bot = y1 == null ? H * 0.94 : H - y1;
  top = clamp(top, 0, H); bot = clamp(bot, 0, H);
  if (bot - top < 30) { top = H * 0.06; bot = H * 0.94; }
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const scale = (cssWidth * dpr) / vp0.width;
  const vp = page.getViewport({ scale, offsetY: -top * scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.max(1, Math.floor((bot - top) * scale));
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
  page.cleanup();
}

export function observeFigures(container, docId) {
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      if (el.dataset.done) continue;
      el.dataset.done = '1';
      const num = (v) => (v === '' || v == null ? null : +v);
      const w = Math.max(320, el.clientWidth || 700);
      renderRegion(el.querySelector('canvas'), docId, +el.dataset.pg, num(el.dataset.y0), num(el.dataset.y1), w).then(() => el.classList.add('ready')).catch(() => { el.dataset.done = ''; });
    }
  }, { rootMargin: '1200px 0px' });
  container.querySelectorAll('.figpdf').forEach((el) => io.observe(el));
  return () => io.disconnect();
}

export function observeScanPages(container, docId) {
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      if (el.dataset.done) continue;
      el.dataset.done = '1';
      const canvas = el.querySelector('canvas');
      renderPage(canvas, docId, +el.dataset.pg, Math.max(300, el.clientWidth)).then(() => el.classList.add('ready')).catch(() => { el.dataset.done = ''; });
    }
  }, { rootMargin: '900px 0px' });
  container.querySelectorAll('.pgimg').forEach((el) => io.observe(el));
  return () => io.disconnect();
}

export function openPageViewer(meta, pageNo, total) {
  let pg = pageNo;
  const canvas = h('canvas', { class: 'pv-canvas' });
  const label = h('span', { class: 'pv-l' });
  const wrap = h('div', { class: 'pv-wrap' }, canvas);
  const prev = h('button', { class: 'icon-btn', 'aria-label': 'Poprzednia strona', html: ic('left'), onclick: () => go(pg - 1) });
  const next = h('button', { class: 'icon-btn', 'aria-label': 'Następna strona', html: ic('right'), onclick: () => go(pg + 1) });
  const body = h('div', { class: 'pv' }, wrap, h('div', { class: 'pv-bar' }, prev, label, next));
  const sheet = openSheet({ title: 'Oryginalna strona', body, wide: true, className: 'pv-sheet' });
  let token = 0;
  async function go(n) {
    pg = clamp(n, 1, total || 9999);
    const t = ++token;
    label.textContent = `Strona ${pg}${total ? ` z ${total}` : ''}`;
    wrap.classList.add('loading');
    try {
      await renderPage(canvas, meta.id, pg, Math.min(860, wrap.clientWidth || 700));
      if (t === token) wrap.classList.remove('loading');
    } catch (e) { wrap.textContent = 'Nie udało się wyświetlić strony.'; }
    prev.disabled = pg <= 1; next.disabled = total ? pg >= total : false;
  }
  setTimeout(() => go(pg), 60);
  return sheet;
}

// Powiększony diagram (dotknięcie diagramu w tekście): przewijany poziomo, w pełnej rozdzielczości
export function openFigureZoom(meta, el) {
  const num = (v) => (v === '' || v == null ? null : +v);
  const canvas = h('canvas', { class: 'fz-canvas' });
  const wrap = h('div', { class: 'fz-wrap loading' }, canvas);
  const w = Math.round(Math.min(1400, Math.max(640, innerWidth * 1.7)));
  const sheet = openSheet({ title: 'Diagram', body: wrap, wide: true, className: 'fz-sheet' });
  canvas.style.width = w + 'px';
  renderRegion(canvas, meta.id, +el.dataset.pg, num(el.dataset.y0), num(el.dataset.y1), w).then(() => { wrap.classList.remove('loading'); wrap.scrollLeft = 0; }).catch(() => { wrap.textContent = 'Nie udało się wyświetlić diagramu.'; });
  return sheet;
}
