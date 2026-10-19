// Wyszukiwanie we wszystkich dokumentach naraz (pełny tekst, bez uwzględniania wielkości liter i polskich znaków)
import { h, ic, esc, foldText, debounce, plural, fmtNum } from '../util.js';
import { listDocs } from '../state.js';
import { db } from '../db.js';
import { chapterOfBlock } from '../import/structure.js';
import { allTags, hasTag } from './tags.js';

const MAX_PER_DOC = 400;

export async function mount(root, params = {}) {
  const page = h('div', { class: 'page search-page' });
  root.append(page);
  let destroyed = false;
  const idx = new Map(); // id → { folded[], doc }
  let scope = '';        // '' = wszystkie, inaczej tag
  let token = 0;

  const input = h('input', { class: 'field search', type: 'search', placeholder: 'Szukaj we wszystkich dokumentach…', 'aria-label': 'Szukaj we wszystkich dokumentach', value: params.q || '' });
  const info = h('div', { class: 'sr-info dim' });
  const scopes = h('div', { class: 'chips' });
  const out = h('div', { class: 'gs-results' });

  const paintScopes = () => {
    const tags = allTags();
    scopes.hidden = !tags.length;
    scopes.replaceChildren(h('button', { class: 'chip' + (!scope ? ' on' : ''), onclick: () => { scope = ''; paintScopes(); run(); } }, 'Wszystkie dokumenty'),
      ...tags.map((t) => h('button', { class: 'chip' + (scope === t.name ? ' on' : ''), onclick: () => { scope = scope === t.name ? '' : t.name; paintScopes(); run(); } }, h('span', { html: ic('tag') }), t.name)));
  };

  async function load(meta) {
    if (idx.has(meta.id)) return idx.get(meta.id);
    const c = await db.get('content', meta.id);
    if (!c) { idx.set(meta.id, null); return null; }
    const folded = c.blocks.map((b) => (b.t === 'table' ? foldText((b.rows || []).flat().join(' · ')) : b.x ? foldText(b.x) : ''));
    const e = { folded, doc: c };
    idx.set(meta.id, e);
    return e;
  }

  const run = async () => {
    const my = ++token;
    const raw = input.value.trim();
    const fq = foldText(raw);
    out.replaceChildren();
    if (fq.length < 2) { info.textContent = raw ? 'Wpisz co najmniej 2 znaki.' : 'Przeszukam treść wszystkich dokumentów w bibliotece — lokalnie, na Twoim urządzeniu.'; return; }
    const docs = listDocs().filter((d) => !scope || hasTag(d, scope)).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    if (!docs.length) { info.textContent = 'Brak dokumentów w tym zakresie.'; return; }
    info.textContent = 'Szukam…';
    let totalHits = 0, docsHit = 0;
    for (let i = 0; i < docs.length; i++) {
      const meta = docs[i];
      const e = await load(meta);
      if (destroyed || my !== token) return;
      if (!e) continue;
      const hits = [];
      let capped = false;
      outer: for (let b = 0; b < e.folded.length; b++) {
        const t = e.folded[b];
        if (!t) continue;
        let from = 0, k;
        while ((k = t.indexOf(fq, from)) >= 0) {
          hits.push({ b, s: k, e: k + fq.length });
          from = k + fq.length;
          if (hits.length >= MAX_PER_DOC) { capped = true; break outer; }
        }
      }
      if (hits.length) { docsHit++; totalHits += hits.length; out.append(docBlock(meta, e, hits, capped, raw)); }
      info.textContent = `Szukam… ${i + 1} z ${docs.length}`;
      if (i % 2) await new Promise((r) => setTimeout(r, 0));
    }
    if (destroyed || my !== token) return;
    info.textContent = totalHits ? `${fmtNum(totalHits)}${totalHits >= MAX_PER_DOC ? '+' : ''} ${plural(totalHits, 'wynik', 'wyniki', 'wyników')} w ${docsHit} ${plural(docsHit, 'dokumencie', 'dokumentach', 'dokumentach')}` : 'Brak wyników.';
    if (!totalHits) out.append(h('div', { class: 'empty' }, h('div', { class: 'empty-ic', html: ic('search') }), h('h3', {}, 'Nic nie znaleziono'), h('p', {}, 'Spróbuj krótszej frazy albo innego zakresu.')));
  };

  function docBlock(meta, e, hits, capped, raw) {
    const box = h('section', { class: 'gs-doc card' });
    const list = h('div', { class: 'gs-list' });
    const more = h('button', { class: 'btn sm gs-more' });
    let shown = 0;
    const addMore = (step = 5) => {
      const upto = Math.min(hits.length, shown + step);
      for (; shown < upto; shown++) {
        const hit = hits[shown];
        const b = e.doc.blocks[hit.b];
        const text = b.x || (b.rows ? b.rows.flat().join(' · ') : '');
        const a = Math.max(0, hit.s - 50), z = Math.min(text.length, hit.e + 90);
        const snippet = (a > 0 ? '…' : '') + esc(text.slice(a, hit.s)) + '<mark>' + esc(text.slice(hit.s, hit.e)) + '</mark>' + esc(text.slice(hit.e, z)) + (z < text.length ? '…' : '');
        const ci = chapterOfBlock(e.doc, hit.b);
        const where = (b.art ? `Art. ${b.art}${b.u ? ' ust. ' + b.u.replace(/\.$/, '') : ''} · ` : '') + (e.doc.chapters[ci]?.title || '');
        list.append(h('a', { class: 'gs-hit', href: `#/read/${meta.id}?b=${hit.b}&q=${encodeURIComponent(raw)}` }, h('small', {}, where), h('span', { html: snippet })));
      }
      more.hidden = shown >= hits.length;
      more.textContent = `Pokaż więcej (${hits.length - shown}${capped ? '+' : ''})`;
    };
    more.onclick = () => addMore(25);
    addMore();
    box.append(h('header', { class: 'gs-head' },
      h('a', { class: 'gs-title', href: '#/doc/' + meta.id }, meta.title),
      h('span', { class: 'dim' }, `${hits.length}${capped ? '+' : ''} ${plural(hits.length, 'trafienie', 'trafienia', 'trafień')}`)), list, more);
    return box;
  }

  const debounced = debounce(run, 260);
  input.addEventListener('input', debounced);
  page.append(
    h('header', { class: 'page-head' }, h('div', {}, h('div', { class: 'kicker' }, 'Cała biblioteka'), h('h1', { class: 'display big' }, 'Szukaj'))),
    h('div', { class: 'lib-tools' }, input, scopes), info, out);
  paintScopes();
  if (params.q) run(); else info.textContent = 'Przeszukam treść wszystkich dokumentów w bibliotece — lokalnie, na Twoim urządzeniu.';
  setTimeout(() => { if (!params.q && !destroyed) input.focus(); }, 300);
  return { destroy() { destroyed = true; token++; idx.clear(); } };
}
