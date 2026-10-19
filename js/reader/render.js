// Renderowanie bloków dokumentu do HTML (z zakreśleniami, trafieniami wyszukiwania i znacznikami)
import { esc, ic, fmtMinutes, fmtNum } from '../util.js';
import { chapterKicker, partLabel, minutesFor, pageRange } from '../course.js';
import { sectionsOf } from '../import/structure.js';

const TAG = { b: 'b', i: 'i', u: 'sup', s: 'sub', c: 'code' };

const KIND_ICON = { law: 'scale', example: 'file-lines', warn: 'warning', key: 'pin', tip: 'lightbulb', draft: 'edit', note: 'info' };

// ranges: highlights [{s,e,c,id,n}], hits [[s,e,cur?]]
export function textHtml(text, marks, hls, hits) {
  const hasMarks = marks && marks.length, hasH = hls && hls.length, hasHits = hits && hits.length;
  if (!hasMarks && !hasH && !hasHits) return esc(text);
  const pts = new Set([0, text.length]);
  const add = (s, e) => { if (s > 0 && s < text.length) pts.add(s); if (e > 0 && e < text.length) pts.add(e); };
  if (hasMarks) marks.forEach((m) => add(m[0], m[1]));
  if (hasH) hls.forEach((m) => add(m.s, m.e));
  if (hasHits) hits.forEach((m) => add(m[0], m[1]));
  const arr = [...pts].sort((a, b) => a - b);
  let out = '';
  for (let k = 0; k + 1 < arr.length; k++) {
    const a = arr[k], b = arr[k + 1];
    let seg = esc(text.slice(a, b));
    if (hasMarks) {
      const act = marks.filter((m) => m[0] <= a && m[1] >= b).map((m) => m[2]);
      for (const st of new Set(act)) { const t = TAG[st]; if (t) seg = `<${t}>${seg}</${t}>`; }
    }
    if (hasHits) {
      const hit = hits.find((m) => m[0] <= a && m[1] >= b);
      if (hit) seg = `<mark class="hit${hit[2] ? ' cur' : ''}">${seg}</mark>`;
    }
    if (hasH) {
      let hl = null;
      for (const m of hls) if (m.s <= a && m.e >= b) hl = m;
      if (hl) seg = `<span class="hl hc${hl.c}${hl.n ? ' has-note' : ''}" data-h="${hl.id}">${seg}</span>`;
    }
    out += seg;
  }
  return out;
}

function tableHtml(b) {
  const rows = b.rows || [];
  let html = '<table>';
  rows.forEach((r, ri) => {
    const th = ri === 0 && b.hdr;
    html += '<tr>' + r.map((c) => `<${th ? 'th' : 'td'}>${esc(c)}</${th ? 'th' : 'td'}>`).join('') + '</tr>';
  });
  return html + '</table>';
}

export function blockHtml(b, i, ctx) {
  const hls = ctx.hlByBlock.get(i);
  const hits = ctx.hits.get(i);
  const bm = ctx.bmBlocks.has(i) ? ' bm' : '';
  const txt = () => textHtml(b.x, b.m, hls, hits);
  switch (b.t) {
    case 'h': {
      const l = Math.min(4, Math.max(1, b.l || 2));
      const tag = l <= 2 ? 'h2' : l === 3 ? 'h3' : 'h4';
      if (b.hk && b.ht && !hls && !hits) return `<${tag} class="hd lg-h l${l}${bm}" data-b="${i}" data-t><span class="lg-hk">${esc(b.hn)}</span> <span class="lg-ht">${esc(b.ht)}</span></${tag}>`;
      return `<${tag} class="hd l${l}${bm}" data-b="${i}" data-t>${txt()}</${tag}>`;
    }
    case 'li':
      return `<div class="li${b.d ? ' d' + b.d : ''}${(b.o || '').length > 2 ? ' wide' : ''}${/\)$/.test(b.o || '') ? ' pk' : ''}${bm}" data-b="${i}"><span class="bul" aria-hidden="true">${esc(b.o || '•')}</span><span class="lt" data-t>${txt()}</span></div>`;
    case 'quote':
      return `<blockquote class="${bm.trim()}" data-b="${i}" data-t>${txt()}</blockquote>`;
    case 'code':
      return `<pre class="${bm.trim()}" data-b="${i}"><code data-t>${esc(b.x)}</code></pre>`;
    case 'table':
      return `<div class="tbl-wrap${bm}" data-b="${i}">${tableHtml(b)}</div>`;
    case 'img':
      return `<figure class="img${bm}" data-b="${i}"><img data-a="${esc(b.a)}" alt="${esc(b.alt || '')}" loading="lazy">${b.alt ? `<figcaption>${esc(b.alt)}</figcaption>` : ''}</figure>`;
    case 'fig':
      if (ctx.hasPdf && b.pg)
        return `<figure class="figpdf${bm}" data-b="${i}" data-pg="${b.pg}" data-y0="${b.y0 ?? ''}" data-y1="${b.y1 ?? ''}" aria-label="${esc(b.x)}"><div class="fpp"><canvas></canvas></div></figure>`;
      return `<figure class="figph${bm}" data-b="${i}"><div class="fp-in"><span class="fp-ic">${ic('layers')}</span><div class="fp-t">${esc(b.x)}</div>${b.pg && ctx.hasPdf ? `<button class="btn sm" data-act="page" data-pg="${b.pg}">${ic('eye')} Zobacz oryginał, str. ${b.pg}</button>` : ''}</div></figure>`;
    case 'page':
      return `<div class="pgimg" data-b="${i}" data-pg="${b.pg}"><canvas></canvas><span class="pgn">${b.pg}</span></div>`;
    default: {
      if (b.art || b.u) {
        const lab = `${b.art ? `<b class="lg-an">Art.&nbsp;${esc(b.art)}.</b>` : ''}${b.u ? `<span class="lg-u">${esc(b.u)}</span>` : ''}`;
        return `<p class="lg-p${b.art ? ' lg-art' : ''}${bm}" data-b="${i}"><span class="lg-lab" aria-hidden="true">${lab}</span><span data-t>${txt()}</span></p>`;
      }
      const cls = [b.ctr ? 'ctr' + (b.ttl ? ' ttl-' + b.ttl : '') : '', b.wc ? 'wc' : '', b.fn ? 'fn' : '', b.note ? 'note' : '', b.ld ? 'ld' : '', b.sm ? 'sm' : '', b.cap ? 'cap' : '', bm.trim()].filter(Boolean).join(' ');
      const btn = b.cap && ctx.hasPdf && b.pg ? `<button class="cap-btn" data-act="page" data-pg="${b.pg}" aria-label="Zobacz oryginalną stronę ${b.pg}" title="Zobacz oryginał, str. ${b.pg}">${ic('eye')}</button>` : '';
      return `<p class="${cls}" data-b="${i}" data-t>${txt()}</p>${btn}`;
    }
  }
}

// Zwraca HTML wnętrza rozdziału (bloki z opakowaniem ramek)
export function chapterBodyHtml(doc, ci, ctx) {
  const ch = doc.chapters[ci];
  const start = ch.start;
  const end = ci + 1 < doc.chapters.length ? doc.chapters[ci + 1].start : doc.blocks.length;
  let html = '';
  let i = start;
  // pomiń nagłówki, które powtarzają tytuł (zastępuje je „opener”)
  const norm = (s) => s.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/g, '');
  const skipKeys = new Set([norm(ch.title), norm(`${ch.num} ${ch.title}`), norm(`${ch.kw} ${ch.num} ${ch.title}`)]);
  if (ch.part) { const pl = partLabel(ch); skipKeys.add(norm(pl)); skipKeys.add(norm(pl.replace(' · ', '. '))); skipKeys.add(norm(pl.replace(' · ', ' '))); }
  while (i < end) {
    const b = doc.blocks[i];
    if (b.t === 'h' && (skipKeys.has(norm(b.x)) || (ch.part && norm(b.x).startsWith(norm(ch.part.split('|')[0] || 'zzzz')) && i < start + 3))) { i++; continue; }
    if (b.t === 'p' && i < start + 4 && b.x.length < 40 && /^(rozdział|rozdzial|chapter|część|czesc|part|lekcja|lesson)\s+[\divxlc]+$/i.test(b.x.trim())) { i++; continue; }
    break;
  }
  const first = i;
  for (; i < end; i++) {
    const b = doc.blocks[i];
    if (b.g) {
      let j = i;
      while (j < end && doc.blocks[j].g === b.g) j++;
      const title = doc.blocks[i].ti || (() => { for (let k = i; k < j; k++) if (doc.blocks[k].ti) return doc.blocks[k].ti; return ''; })();
      const kind = doc.blocks[i].k || 'note';
      html += `<aside class="callout k-${kind}" data-g="${b.g}">${title ? `<header class="co-h"><span class="co-i">${ic(KIND_ICON[kind] || 'info')}</span><span>${esc(title)}</span></header>` : ''}`;
      for (let k = i; k < j; k++) html += blockHtml(doc.blocks[k], k, ctx);
      html += '</aside>';
      i = j - 1;
      continue;
    }
    html += blockHtml(b, i, ctx);
  }
  return { html, first, end };
}

export function openerHtml(doc, ci, info) {
  const ch = doc.chapters[ci];
  const nk = (t) => String(t).toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/g, '');
  const secs = sectionsOf(doc, ci).filter((s) => s.level === 1).filter((s) => !(s.block < ch.start + 12 && nk(s.title).includes(nk(ch.title))));
  const kick = chapterKicker(ch);
  const part = partLabel(ch);
  const mins = minutesFor(info.words);
  const pr = pageRange(doc, ci);
  return `<header class="opener">
    ${part ? (() => { const [pa, pb] = ch.part.split('|'); return pb && pb.length > 28 ? `<div class="op-part long"><b>${esc(pa)}</b><span>${esc(pb)}</span></div>` : `<div class="op-part">${esc(part)}</div>`; })() : ''}
    <div class="op-main">
      ${ch.num ? `<div class="op-num" aria-hidden="true">${esc(ch.num)}</div>` : `<div class="op-num glyph" aria-hidden="true">${ic('book-open')}</div>`}
      <div class="op-txt">
        ${kick ? `<div class="op-kick">${esc(kick)}</div>` : `<div class="op-kick">${ci + 1} / ${doc.chapters.length}</div>`}
        <h1 class="op-title">${esc(ch.title)}</h1>
      </div>
    </div>
    <div class="op-meta"><span>${ic('clock')} ~${fmtMinutes(mins)}</span><span>${ic('file-lines')} ${fmtNum(info.words)} słów</span>${pr ? `<span>${ic('hash')} ${pr}</span>` : ''}<span>${ic('layers')} ${ci + 1} z ${doc.chapters.length}</span></div>
    ${secs.length ? `<div class="op-secs"><div class="kicker">W tym rozdziale</div><ol>${secs.slice(0, 14).map((s, k) => `<li><button data-act="goto" data-b="${s.block}"><i>${k + 1}</i>${esc(s.title.replace(/^\d+(\.\d+)*\.?\s*/, ''))}</button></li>`).join('')}</ol></div>` : ''}
  </header>`;
}
