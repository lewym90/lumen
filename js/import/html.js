// Parser HTML → bloki (wspólny dla EPUB, DOCX i zwykłych plików HTML)
import { TextBuilder } from './textbuild.js';

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'FIGURE', 'FIGCAPTION', 'IMG', 'HR', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY', 'NAV', 'FORM', 'FIELDSET', 'CENTER', 'BODY', 'ADDRESS', 'SVG']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'TEMPLATE', 'IFRAME', 'OBJECT', 'CANVAS', 'AUDIO', 'VIDEO']);

function styleFor(el) {
  const t = el.tagName;
  if (t === 'B' || t === 'STRONG') return 'b';
  if (t === 'I' || t === 'EM' || t === 'CITE' || t === 'DFN' || t === 'VAR') return 'i';
  if (t === 'SUP') return 'u';
  if (t === 'SUB') return 's';
  if (t === 'CODE' || t === 'KBD' || t === 'TT' || t === 'SAMP') return 'c';
  const st = (el.getAttribute && el.getAttribute('style')) || '';
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) return 'b';
  if (/font-style\s*:\s*italic/i.test(st)) return 'i';
  return null;
}

function collectInline(node, tb, styles, opts, state) {
  for (const ch of node.childNodes) {
    if (ch.nodeType === 3) {
      let s = ch.nodeValue.replace(/[\s ]+/g, ' ');
      if (!tb.text || /\s$/.test(tb.text)) s = s.replace(/^\s+/, '');
      if (s) tb.addRun(s, styles.length ? styles : null);
    } else if (ch.nodeType === 1) {
      const tag = ch.tagName;
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === 'BR') { if (tb.text && !/\s$/.test(tb.text)) tb.addRun(' ', null); continue; }
      if (tag === 'IMG') { state.inlineImgs.push(ch); continue; }
      if (ch.id) state.ids.push(ch.id);
      const st = styleFor(ch);
      collectInline(ch, tb, st ? [...styles, st] : styles, opts, state);
    }
  }
}

function hasBlockChild(el) {
  for (const c of el.children) if (BLOCK_TAGS.has(c.tagName) && c.tagName !== 'IMG' && c.tagName !== 'SVG') return true;
  return false;
}

export function parseHtmlDoc(doc, opts = {}) {
  const blocks = [];
  const idMap = new Map();
  const state = { inlineImgs: [], ids: [] };
  const noteIds = (el) => { if (el.id) idMap.set(el.id, blocks.length); };

  function pushText(t, tb, extra = {}) {
    const f = tb.finish();
    if (!f.x.trim()) return null;
    const b = { t, x: f.x, ...extra };
    if (f.m.length && t !== 'h') b.m = f.m;
    blocks.push(b);
    return b;
  }

  function emitImg(img) {
    if (!opts.resolveImg) return;
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('xlink:href') || '';
    const key = opts.resolveImg(src, img);
    if (key) blocks.push({ t: 'img', a: key, alt: (img.getAttribute('alt') || '').trim() });
  }

  function flushInline(tb, kind = 'p', extra = {}) {
    const b = pushText(kind, tb, extra);
    tb.text = ''; tb.marks = [];
    if (state.inlineImgs.length) { state.inlineImgs.splice(0).forEach(emitImg); }
    return b;
  }

  function doList(el, depth, ordered, extra) {
    let n = 0;
    for (const li of el.children) {
      if (li.tagName !== 'LI') { walk(li, extra); continue; }
      noteIds(li);
      n++;
      const tb = new TextBuilder();
      const nested = [];
      for (const ch of li.childNodes) {
        if (ch.nodeType === 1 && (ch.tagName === 'UL' || ch.tagName === 'OL')) { nested.push(ch); continue; }
        if (ch.nodeType === 1 && ch.tagName === 'P') {
          if (tb.text) tb.addRun(' ', null);
          collectInline(ch, tb, [], opts, state);
          continue;
        }
        if (ch.nodeType === 3) { collectInline({ childNodes: [ch] }, tb, [], opts, state); continue; }
        if (ch.nodeType === 1) {
          if (BLOCK_TAGS.has(ch.tagName) && ch.tagName !== 'IMG') {
            if (hasBlockChild(ch) || ch.tagName === 'DIV') { collectInline(ch, tb, [], opts, state); } else collectInline(ch, tb, [], opts, state);
          } else {
            const st = styleFor(ch);
            collectInline({ childNodes: [ch] }, tb, st ? [st] : [], opts, state);
          }
        }
      }
      const b = pushText('li', tb, { o: ordered ? `${n}.` : '', ...(depth ? { d: Math.min(3, depth) } : {}), ...extra });
      if (state.inlineImgs.length) state.inlineImgs.splice(0).forEach(emitImg);
      void b;
      nested.forEach((nl) => doList(nl, depth + 1, nl.tagName === 'OL', extra));
    }
  }

  function doTable(el) {
    const rows = [];
    let hdr = false;
    for (const tr of el.querySelectorAll('tr')) {
      const cells = [];
      let allTh = true;
      for (const c of tr.children) {
        if (c.tagName !== 'TD' && c.tagName !== 'TH') continue;
        if (c.tagName !== 'TH') allTh = false;
        cells.push((c.textContent || '').replace(/\s+/g, ' ').trim());
      }
      if (cells.length) { if (!rows.length) hdr = allTh; rows.push(cells); }
    }
    if (!rows.length) return;
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((r) => { while (r.length < w) r.push(''); });
    blocks.push({ t: 'table', rows, hdr });
  }

  function walk(el, extra = {}) {
    let pending = new TextBuilder();
    const flushP = () => { if (pending.text.trim() || state.inlineImgs.length) flushInline(pending, 'p', extra); pending = new TextBuilder(); };
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) {
        if (ch.nodeValue.trim()) collectInline({ childNodes: [ch] }, pending, [], opts, state);
        continue;
      }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName;
      if (SKIP_TAGS.has(tag)) continue;
      if (!BLOCK_TAGS.has(tag)) {
        if (ch.id) state.ids.push(ch.id);
        const st = styleFor(ch);
        collectInline({ childNodes: [ch] }, pending, st ? [st] : [], opts, state);
        continue;
      }
      flushP();
      noteIds(ch);
      if (/^H[1-6]$/.test(tag)) {
        const tb = new TextBuilder();
        collectInline(ch, tb, [], opts, state);
        state.ids.forEach((id) => idMap.set(id, blocks.length)); state.ids = [];
        const f = tb.finish();
        if (f.x.trim()) blocks.push({ t: 'h', l: +tag[1], x: f.x.replace(/\s+/g, ' ') });
        if (state.inlineImgs.length) state.inlineImgs.splice(0).forEach(emitImg);
      } else if (tag === 'P' || tag === 'DT' || tag === 'DD' || tag === 'SUMMARY' || tag === 'FIGCAPTION' || tag === 'ADDRESS') {
        if (hasBlockChild(ch)) { walk(ch, extra); continue; }
        const tb = new TextBuilder();
        collectInline(ch, tb, [], opts, state);
        state.ids.forEach((id) => idMap.set(id, blocks.length)); state.ids = [];
        const cls = (ch.getAttribute('class') || '').toLowerCase();
        const kind = tag === 'FIGCAPTION' ? 'p' : 'p';
        pushText(kind, tb, { ...extra, ...(tag === 'FIGCAPTION' ? { cap: 1, sm: 1 } : {}), ...(/subtitle|lead/.test(cls) ? { ld: 1 } : {}) });
        if (state.inlineImgs.length) state.inlineImgs.splice(0).forEach(emitImg);
      } else if (tag === 'UL' || tag === 'OL') {
        doList(ch, 0, tag === 'OL', extra);
      } else if (tag === 'LI') {
        doList({ children: [ch] }, 0, false, extra);
      } else if (tag === 'BLOCKQUOTE') {
        const n0 = blocks.length;
        walk(ch, extra);
        for (let i = n0; i < blocks.length; i++) if (blocks[i].t === 'p') blocks[i].t = 'quote';
      } else if (tag === 'PRE') {
        const x = (ch.textContent || '').replace(/\s+$/, '').replace(/^\n+/, '');
        if (x.trim()) blocks.push({ t: 'code', x });
      } else if (tag === 'TABLE') {
        doTable(ch);
      } else if (tag === 'IMG') {
        emitImg(ch);
      } else if (tag === 'SVG') {
        const im = ch.querySelector('image');
        if (im) emitImg(im);
      } else if (tag === 'HR') {
        /* pomijamy */
      } else {
        // kontenery
        if (!hasBlockChild(ch) && ch.textContent.trim().length) {
          const tb = new TextBuilder();
          collectInline(ch, tb, [], opts, state);
          state.ids.forEach((id) => idMap.set(id, blocks.length)); state.ids = [];
          pushText('p', tb, extra);
          if (state.inlineImgs.length) state.inlineImgs.splice(0).forEach(emitImg);
        } else walk(ch, extra);
      }
    }
    flushP();
  }

  const root = doc.body || doc.documentElement;
  const mark0 = blocks.length;
  walk(root);
  // identyfikatory z nieobsłużonych inline
  return { blocks, idMap, start: mark0 };
}

export function parseHtmlString(html, opts = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template').forEach((e) => e.remove());
  if (opts.web) doc.querySelectorAll('nav,footer,aside,form,[role=navigation],[role=banner],[aria-hidden=true]').forEach((e) => e.remove());
  const title = (doc.querySelector('title')?.textContent || '').trim();
  const main = doc.querySelector('article, main');
  const target = main && main.textContent.length > doc.body.textContent.length * 0.5 ? main : doc.body;
  const wrapper = document.implementation.createHTMLDocument('x');
  wrapper.body.append(wrapper.importNode(target, true));
  const res = parseHtmlDoc(wrapper, opts);
  return { ...res, title };
}
