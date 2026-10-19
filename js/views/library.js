// Biblioteka: siatka dokumentów z filtrami i sortowaniem
import { h, ic, foldText, plural } from '../util.js';
import { listDocs, bus } from '../state.js';
import { openMenu } from '../ui.js';
import { docCard } from './shared.js';
import { pickFiles, openAdd } from '../main.js';
import { allTags, hasTag } from './tags.js';

const SORTS = [
  ['recent', 'Ostatnio czytane'],
  ['title', 'Tytuł A–Z'],
  ['progress', 'Postęp'],
  ['added', 'Ostatnio dodane'],
];
const FILTERS = [['all', 'Wszystkie'], ['active', 'W trakcie'], ['new', 'Nieprzeczytane'], ['done', 'Przeczytane']];

const pref = (() => { try { return JSON.parse(localStorage.getItem('lumen.lib') || '{}'); } catch { return {}; } })();
const savePref = () => { try { localStorage.setItem('lumen.lib', JSON.stringify(pref)); } catch { /* brak */ } };

export async function mount(root) {
  const state = { q: '', filter: pref.filter || 'all', sort: pref.sort || 'recent', tag: pref.tag || '', view: pref.view || 'grid' };
  const page = h('div', { class: 'page library' });
  root.append(page);
  let destroyed = false;

  const gridHost = h('div', {});
  const countEl = h('span', { class: 'dim' });
  const search = h('input', { class: 'field search', type: 'search', placeholder: 'Szukaj w bibliotece…', 'aria-label': 'Szukaj w bibliotece', oninput: (e) => { state.q = e.target.value; const l = page.querySelector('#gs-link'); if (l) l.href = '#/search' + (state.q.trim() ? '?q=' + encodeURIComponent(state.q.trim()) : ''); renderGrid(); } });
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const shelves = h('div', { class: 'chips shelves' });
  const sortBtn = h('button', { class: 'btn sm', onclick: () => openMenu(sortBtn, SORTS.map(([k, l]) => ({ icon: state.sort === k ? 'check' : 'sort', label: l, onClick: () => { state.sort = k; pref.sort = k; savePref(); renderHead(); renderGrid(); } }))) });
  const viewBtn = h('button', { class: 'icon-btn', 'aria-label': 'Zmień widok', onclick: () => { state.view = state.view === 'grid' ? 'list' : 'grid'; pref.view = state.view; savePref(); renderHead(); renderGrid(); } });

  const renderHead = () => {
    chips.replaceChildren(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (state.filter === k ? ' on' : ''), role: 'tab', 'aria-selected': state.filter === k, onclick: () => { state.filter = k; pref.filter = k; savePref(); renderHead(); renderGrid(); } }, l)));
    sortBtn.replaceChildren(h('span', { html: ic('sort') }), SORTS.find(([k]) => k === state.sort)[1]);
    const tags = allTags();
    const legalN = listDocs().filter((d) => d.legal).length;
    if (state.tag && state.tag !== '@legal' && !tags.some((t) => t.name === state.tag)) { state.tag = ''; pref.tag = ''; savePref(); }
    if (state.tag === '@legal' && !legalN) { state.tag = ''; pref.tag = ''; savePref(); }
    const setTag = (k) => { state.tag = state.tag === k ? '' : k; pref.tag = state.tag; savePref(); renderHead(); renderGrid(); };
    shelves.hidden = !tags.length && !legalN;
    shelves.replaceChildren(
      ...(legalN ? [h('button', { class: 'chip sm' + (state.tag === '@legal' ? ' on' : ''), onclick: () => setTag('@legal') }, h('span', { html: ic('scale') }), 'Akty prawne', h('i', {}, legalN))] : []),
      ...tags.map((t) => h('button', { class: 'chip sm' + (state.tag === t.name ? ' on' : ''), onclick: () => setTag(t.name) }, h('span', { html: ic('tag') }), t.name, h('i', {}, t.n))));
    viewBtn.innerHTML = ic(state.view === 'grid' ? 'rows' : 'grid');
  };

  const filtered = () => {
    let docs = listDocs();
    const q = foldText(state.q.trim());
    if (q) docs = docs.filter((d) => foldText(d.title + ' ' + (d.author || '') + ' ' + (d.tags || []).join(' ')).includes(q));
    if (state.tag === '@legal') docs = docs.filter((d) => d.legal);
    else if (state.tag) docs = docs.filter((d) => hasTag(d, state.tag));
    docs = docs.filter((d) => {
      const pct = d.pct || 0;
      if (state.filter === 'active') return pct > 0 && pct < 0.99;
      if (state.filter === 'new') return pct === 0;
      if (state.filter === 'done') return pct >= 0.99;
      return true;
    });
    const s = state.sort;
    docs.sort((a, b) => {
      if (s === 'title') return a.title.localeCompare(b.title, 'pl');
      if (s === 'progress') return (b.pct || 0) - (a.pct || 0);
      if (s === 'added') return b.addedAt - a.addedAt;
      return (b.openedAt || 0) - (a.openedAt || 0) || b.addedAt - a.addedAt;
    });
    return docs;
  };

  const renderGrid = () => {
    const docs = filtered();
    const total = listDocs().length;
    countEl.textContent = `${docs.length} ${plural(docs.length, 'dokument', 'dokumenty', 'dokumentów')}`;
    if (!total) {
      gridHost.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'empty-ic', html: ic('library') }), h('h3', {}, 'Biblioteka jest pusta'),
        h('p', {}, 'Dodaj pierwszy dokument — PDF, EPUB, DOCX, tekst lub Markdown.'),
        h('button', { class: 'btn primary lg', onclick: () => openAdd() }, h('span', { html: ic('plus') }), 'Dodaj dokument')));
      return;
    }
    if (!docs.length) {
      gridHost.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-ic', html: ic('search') }), h('h3', {}, 'Nic nie znaleziono'), h('p', {}, 'Zmień filtr albo frazę wyszukiwania.'), state.q.trim() ? h('a', { class: 'btn', href: '#/search?q=' + encodeURIComponent(state.q.trim()) }, h('span', { html: ic('search') }), 'Szukaj w treści dokumentów') : null));
      return;
    }
    const grid = h('div', { class: 'doc-grid ' + state.view });
    docs.forEach((d, i) => { const c = docCard(d, { onChange: () => { renderHead(); renderGrid(); } }); c.style.setProperty('--i', Math.min(i, 14)); grid.append(c); });
    gridHost.replaceChildren(grid);
  };

  page.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('div', { class: 'kicker' }, 'Twoje dokumenty'), h('h1', { class: 'display big' }, 'Biblioteka')),
      h('div', { class: 'head-btns' }, h('a', { class: 'btn', href: '#/search' + (state.q ? '?q=' + encodeURIComponent(state.q) : ''), id: 'gs-link' }, h('span', { html: ic('search') }), 'Szukaj w treści'),
      h('button', { class: 'btn primary head-add', onclick: () => openAdd() }, h('span', { html: ic('plus') }), 'Dodaj dokument'))),
    h('div', { class: 'lib-tools' }, search, h('div', { class: 'lib-row' }, chips, h('div', { class: 'lib-right' }, countEl, sortBtn, viewBtn)), shelves),
    gridHost);
  renderHead();
  renderGrid();
  const off = bus.on('library', () => { if (!destroyed) { renderHead(); renderGrid(); } });
  return { destroy() { destroyed = true; off(); } };
}
