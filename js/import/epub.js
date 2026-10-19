// EPUB → bloki, spis treści z nawigacji (nav.xhtml / toc.ncx)
import { parseHtmlDoc } from './html.js';
import { loadScript } from './loader.js';

function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); }
function resolvePath(base, rel) {
  rel = decodeURIComponent(rel.split('#')[0]);
  if (!rel) return base;
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = (dirname(base) + rel).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}

const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const mimeOf = (p, fallback) => {
  const e = p.split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[e] || fallback || 'application/octet-stream';
};

export async function parseEpub(file, onProgress = () => {}) {
  await loadScript('vendor/jszip.min.js', 'JSZip');
  const zip = await window.JSZip.loadAsync(file);
  const text = async (path) => { const f = zip.file(path) || zip.file(decodeURIComponent(path)); return f ? f.async('string') : null; };

  const container = await text('META-INF/container.xml');
  if (!container) throw new Error('To nie jest poprawny plik EPUB (brak container.xml).');
  const opfPath = parseXml(container).querySelector('rootfile')?.getAttribute('full-path');
  const opfSrc = await text(opfPath);
  const opf = parseXml(opfSrc);

  const q1 = (sel) => opf.querySelector(sel);
  const meta = {
    title: (q1('metadata > title, metadata > *|title')?.textContent || '').trim(),
    author: [...opf.querySelectorAll('metadata > creator, metadata > *|creator')].map((e) => e.textContent.trim()).filter(Boolean).join(', '),
    lang: (q1('metadata > language, metadata > *|language')?.textContent || '').trim(),
  };
  const manifest = new Map();
  for (const it of opf.querySelectorAll('manifest > item')) {
    manifest.set(it.getAttribute('id'), { href: resolvePath(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type'), props: it.getAttribute('properties') || '' });
  }
  const spine = [...opf.querySelectorAll('spine > itemref')].map((r) => manifest.get(r.getAttribute('idref'))).filter(Boolean);

  // okładka
  let coverPath = null;
  for (const m of manifest.values()) if (m.props.split(/\s+/).includes('cover-image')) coverPath = m.href;
  if (!coverPath) {
    const cm = opf.querySelector('metadata meta[name="cover"]');
    if (cm) { const m = manifest.get(cm.getAttribute('content')); if (m) coverPath = m.href; }
  }
  let cover = null;
  if (coverPath && zip.file(coverPath)) cover = new Blob([await zip.file(coverPath).async('uint8array')], { type: mimeOf(coverPath) });

  // obrazy
  const assets = [];
  const imgKey = new Map();
  const resolveFor = (file) => (src) => {
    if (!src) return null;
    if (src.startsWith('data:')) return null;
    const path = resolvePath(file, src);
    if (imgKey.has(path)) return imgKey.get(path);
    const f = zip.file(path);
    if (!f) return null;
    const key = 'i' + assets.length;
    imgKey.set(path, key);
    assets.push({ key, path, f });
    return key;
  };

  const blocks = [];
  const idMap = new Map(); // "plik#id" -> blok
  for (let si = 0; si < spine.length; si++) {
    const item = spine[si];
    const src = await text(item.href);
    if (!src) continue;
    let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(src, 'text/html');
    doc.querySelectorAll('script,style').forEach((e) => e.remove());
    const startIdx = blocks.length;
    idMap.set(item.href, startIdx);
    const res = parseHtmlDoc(doc, { resolveImg: resolveFor(item.href) });
    for (const [id, bi] of res.idMap) idMap.set(`${item.href}#${id}`, startIdx + bi);
    for (const b of res.blocks) blocks.push(b);
    if (si % 4 === 0) onProgress({ frac: 0.1 + 0.7 * (si / spine.length), phase: 'Czytam rozdziały' });
    await new Promise((r) => setTimeout(r, 0));
  }

  // spis treści
  const entries = [];
  const lookup = (base, href) => {
    const [pathPart, frag] = href.split('#');
    const p = resolvePath(base, pathPart || '');
    if (frag && idMap.has(`${p}#${frag}`)) return idMap.get(`${p}#${frag}`);
    if (idMap.has(p)) return idMap.get(p);
    return -1;
  };
  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  if (navItem) {
    const nsrc = await text(navItem.href);
    if (nsrc) {
      let nd = new DOMParser().parseFromString(nsrc, 'application/xhtml+xml');
      if (nd.querySelector('parsererror')) nd = new DOMParser().parseFromString(nsrc, 'text/html');
      const navs = [...nd.querySelectorAll('nav')];
      const toc = navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
      const walk = (ol, level) => {
        for (const li of ol.children) {
          const a = li.querySelector(':scope > a, :scope > span > a');
          if (a) {
            const bi = lookup(navItem.href, a.getAttribute('href') || '');
            if (bi >= 0) entries.push({ title: a.textContent.replace(/\s+/g, ' ').trim(), level, block: bi });
          }
          const sub = li.querySelector(':scope > ol');
          if (sub) walk(sub, level + 1);
        }
      };
      const ol = toc?.querySelector('ol');
      if (ol) walk(ol, 1);
    }
  }
  if (!entries.length) {
    const ncxItem = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml') || (opf.querySelector('spine')?.getAttribute('toc') ? manifest.get(opf.querySelector('spine').getAttribute('toc')) : null);
    if (ncxItem) {
      const nsrc = await text(ncxItem.href);
      if (nsrc) {
        const nd = parseXml(nsrc);
        const walk = (parent, level) => {
          for (const np of parent.children) {
            if (np.localName !== 'navPoint') continue;
            const label = np.querySelector(':scope > navLabel > text')?.textContent?.replace(/\s+/g, ' ').trim();
            const src2 = np.querySelector(':scope > content')?.getAttribute('src');
            if (label && src2) { const bi = lookup(ncxItem.href, src2); if (bi >= 0) entries.push({ title: label, level, block: bi }); }
            walk(np, level + 1);
          }
        };
        const nm = nd.querySelector('navMap');
        if (nm) walk(nm, 1);
      }
    }
  }

  // wczytaj obrazy do blobów
  const assetBlobs = [];
  for (const a of assets) {
    try {
      const u8 = await a.f.async('uint8array');
      assetBlobs.push({ key: a.key, blob: new Blob([u8], { type: mimeOf(a.path) }) });
    } catch { /* pomiń */ }
  }
  const valid = new Set(assetBlobs.map((a) => a.key));
  blocks.forEach((b) => { if (b.t === 'img' && !valid.has(b.a)) b.t = 'skip'; });
  const clean = blocks.filter((b) => b.t !== 'skip');
  // przesunięcia indeksów po usunięciu pominiętych
  if (clean.length !== blocks.length) {
    const map = new Array(blocks.length + 1);
    let k = 0;
    for (let i = 0; i < blocks.length; i++) { map[i] = k; if (blocks[i].t !== 'skip') k++; }
    map[blocks.length] = k;
    entries.forEach((e) => { e.block = map[e.block]; });
  }
  return { meta, blocks: clean, entries, assets: assetBlobs, cover };
}
