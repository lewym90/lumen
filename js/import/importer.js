// Import pliku do biblioteki: rozpoznanie formatu, parsowanie, podział na rozdziały, zapis
import { db, kv } from '../db.js';
import { buildChapters, blockWords, buildWordIndex } from './structure.js';
import { fingerprint, uid, hashStr, yieldUI } from '../util.js';
import { defaultProg, saveMeta, lib, bus } from '../state.js';

export const ACCEPT = '.pdf,.epub,.docx,.txt,.md,.markdown,.html,.htm,.xhtml,.text,application/pdf,application/epub+zip,text/plain,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function sniff(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (isPdf) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    if (ext === 'docx') return 'docx';
    if (ext === 'epub') return 'epub';
    // zip bez rozszerzenia – zajrzyj do środka
    try {
      const { loadScript } = await import('./loader.js');
      await loadScript('vendor/jszip.min.js', 'JSZip');
      const zip = await window.JSZip.loadAsync(file);
      if (zip.file('META-INF/container.xml')) return 'epub';
      if (zip.file('word/document.xml')) return 'docx';
    } catch { /* ignoruj */ }
    return 'unknown';
  }
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html';
  if (['txt', 'text', ''].includes(ext)) return 'txt';
  if (ext === 'pdf') return 'pdf';
  if (file.type === 'text/html') return 'html';
  if (file.type.startsWith('text/')) return 'txt';
  return 'unknown';
}

function readText(file) {
  return file.text().then((t) => t.replace(/^﻿/, ''));
}

async function makeCoverFromPdf(pdf) {
  try {
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = 420 / vp.width;
    const v = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(v.width);
    canvas.height = Math.floor(v.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: v, canvas }).promise;
    return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  } catch { return null; }
}

async function shrinkImage(blob, maxW = 420) {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, maxW / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.84));
  } catch { return blob; }
}

export async function importFile(file, onProgress = () => {}) {
  const report = (o) => onProgress({ name: file.name, ...o });
  report({ frac: 0.02, phase: 'Sprawdzam plik' });
  await yieldUI();
  const type = await sniff(file);
  if (type === 'unknown') throw new Error('Nieobsługiwany format pliku. Obsługuję PDF, EPUB, DOCX, TXT, Markdown i HTML.');

  const fp = await fingerprint(file);
  const existing = [...lib.docs.values()].find((m) => m.fp === fp);
  if (existing) return { meta: existing, duplicate: true };

  let parsed;
  const fileTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  let pdfObj = null;
  if (type === 'pdf') {
    const { parsePdf } = await import('./pdf.js');
    parsed = await parsePdf(file, (p) => report({ frac: 0.05 + 0.85 * p.frac, phase: p.phase || 'Czytam strony', detail: p.page ? `strona ${p.page} z ${p.pages}` : '' }));
    pdfObj = parsed.pdf;
  } else if (type === 'epub') {
    const { parseEpub } = await import('./epub.js');
    parsed = await parseEpub(file, (p) => report({ frac: p.frac, phase: p.phase }));
  } else if (type === 'docx') {
    const { parseDocx } = await import('./docx.js');
    parsed = await parseDocx(file, (p) => report({ frac: p.frac, phase: p.phase }));
  } else if (type === 'html') {
    const { parseHtmlString } = await import('./html.js');
    const src = await readText(file);
    report({ frac: 0.4, phase: 'Układam strukturę' });
    const r = parseHtmlString(src, {});
    parsed = { meta: { title: r.title, author: '' }, blocks: r.blocks, entries: [], assets: [] };
  } else if (type === 'md') {
    const { parseMarkdown } = await import('./text.js');
    const r = parseMarkdown(await readText(file));
    parsed = { meta: { title: r.title, author: '' }, blocks: r.blocks, entries: [], assets: [] };
  } else {
    const { parsePlainText } = await import('./text.js');
    const r = parsePlainText(await readText(file));
    parsed = { meta: { title: r.title, author: '' }, blocks: r.blocks, entries: [], assets: [] };
  }

  report({ frac: 0.92, phase: 'Wykrywam rozdziały' });
  await yieldUI();
  const blocks = parsed.blocks.filter((b) => b.t === 'img' || b.t === 'page' || b.t === 'table' || (b.x && b.x.trim()));
  // indeksy zakładek mogły się przesunąć po filtrze – zmapuj
  let entries = parsed.entries || [];
  if (blocks.length !== parsed.blocks.length) {
    const map = new Map();
    let k = 0;
    parsed.blocks.forEach((b, i) => { map.set(i, k); if (blocks[k] === b) k++; });
    entries = entries.map((e) => ({ ...e, block: map.get(e.block) ?? 0 }));
  }
  blocks.forEach((b) => { delete b._y; delete b._y1; blockWords(b); });
  if (!blocks.length) throw new Error('Nie znalazłem w tym pliku tekstu. Jeśli to skan, otwórz go w trybie stron po zaimportowaniu.');

  const title = (parsed.meta.title || '').trim() || fileTitle;
  const chapters = buildChapters(blocks, entries, title);
  const doc = { blocks, chapters };
  const cw = buildWordIndex(doc);
  const words = cw[blocks.length];

  const id = uid();
  // okładka
  let cover = null;
  if (parsed.cover) cover = await shrinkImage(parsed.cover);
  else if (pdfObj) {
    const firstPageChars = blocks.filter((b) => b.pg === 1).reduce((s, b) => s + (b.x ? b.x.length : 0), 0);
    if (parsed.scanned || firstPageChars < 700) cover = await makeCoverFromPdf(pdfObj);
  }

  report({ frac: 0.96, phase: 'Zapisuję w bibliotece' });
  await db.put('files', file, id);
  await db.put('content', { blocks, chapters, auto: JSON.parse(JSON.stringify(chapters)), v: 1 }, id);
  for (const a of parsed.assets || []) await db.put('assets', a.blob, `${id}/${a.key}`);

  const meta = {
    id, fp, title, author: parsed.meta.author || '', type, size: file.size,
    pages: parsed.meta.pages || 0, words, chapterCount: chapters.length,
    addedAt: Date.now(), openedAt: 0, hue: hashStr(title) % 360,
    cover, scanned: !!parsed.scanned, pct: 0, prog: defaultProg(), deadline: null, auto: true,
    fileName: file.name,
  };
  await saveMeta(meta);

  // zastosuj zaległe postępy z kopii zapasowej (po odcisku pliku)
  try {
    const orphans = await kv.get('orphans', {});
    if (orphans[fp]) {
      const { applyOrphan } = await import('../backup.js');
      await applyOrphan(meta, orphans[fp]);
      delete orphans[fp];
      await kv.set('orphans', orphans);
    }
  } catch { /* brak */ }

  try { pdfObj?.destroy(); } catch { /* brak */ }
  report({ frac: 1, phase: 'Gotowe' });
  bus.emit('library');
  return { meta, duplicate: false };
}
