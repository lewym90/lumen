// DOCX → HTML (mammoth) → bloki
import { parseHtmlString } from './html.js';
import { loadScript } from './loader.js';

function dataUrlToBlob(url) {
  const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m[1] || 'image/png' });
}

export async function parseDocx(file, onProgress = () => {}) {
  await loadScript('vendor/mammoth.browser.min.js', 'mammoth');
  const mammoth = window.mammoth;
  onProgress({ frac: 0.2, phase: 'Konwertuję dokument' });
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Tytuł'] => h1:fresh",
      "p[style-name='Subtitle'] => p.subtitle:fresh",
      "p[style-name='Podtytuł'] => p.subtitle:fresh",
      "p[style-name='Nagłówek 1'] => h1:fresh",
      "p[style-name='Nagłówek 2'] => h2:fresh",
      "p[style-name='Nagłówek 3'] => h3:fresh",
      "p[style-name='Nagłówek 4'] => h4:fresh",
    ],
    convertImage: mammoth.images.imgElement((img) => img.read('base64').then((data) => ({ src: `data:${img.contentType};base64,${data}` }))),
  });
  onProgress({ frac: 0.6, phase: 'Układam strukturę' });
  const assets = [];
  const resolveImg = (src) => {
    if (!src.startsWith('data:')) return null;
    const blob = dataUrlToBlob(src);
    if (!blob) return null;
    const key = 'i' + assets.length;
    assets.push({ key, blob });
    return key;
  };
  const res = parseHtmlString(result.value, { resolveImg });
  // jeśli dokument nie ma nagłówków, ale ma wyraźnie pogrubione krótkie akapity — traktuj je jak nagłówki
  const hasHeads = res.blocks.some((b) => b.t === 'h');
  if (!hasHeads) {
    for (const b of res.blocks) {
      if (b.t === 'p' && b.x.length <= 80 && b.m && b.m.length === 1 && b.m[0][0] === 0 && b.m[0][1] >= b.x.length - 1 && !/[.,;:]$/.test(b.x)) { b.t = 'h'; b.l = 2; delete b.m; }
    }
  }
  return { meta: { title: res.title || '', author: '' }, blocks: res.blocks, entries: [], assets, cover: null };
}
