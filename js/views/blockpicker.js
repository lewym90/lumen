// Okno wyboru miejsca w dokumencie (do dzielenia rozdziałów i przesuwania ich początku)
import { h } from '../util.js';
import { openSheet } from '../ui.js';

const label = (b) => {
  if (b.t === 'table') return '▦ tabela';
  if (b.t === 'img' || b.t === 'fig' || b.t === 'page') return b.t === 'page' ? `strona ${b.pg}` : (b.x || 'ilustracja');
  const pre = b.art ? `Art. ${b.art}. ` : (b.o ? b.o + ' ' : '');
  return (pre + (b.x || '')).replace(/\s+/g, ' ').trim();
};

// Zwraca indeks bloku albo null. from..to (bez to) — zakres bloków do wyboru.
export function pickBlock(doc, from, to, { title, hint, cur = -1 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const search = h('input', { type: 'search', placeholder: 'Szukaj w tym rozdziale…', 'aria-label': 'Szukaj' });
    const list = h('div', { class: 'bp-list' });
    const rows = [];
    for (let i = from; i < to; i++) {
      const b = doc.blocks[i];
      const t = label(b);
      if (!t) continue;
      const btn = h('button', { class: 'bp-row' + (b.t === 'h' ? ' hd' : '') + (b.art ? ' art' : '') + (i === cur ? ' cur' : ''), onclick: () => finish(i) },
        h('span', { class: 'bp-pg' }, b.pg ? `s. ${b.pg}` : ''),
        h('span', { class: 'bp-t' }, t.length > 150 ? t.slice(0, 150) + '…' : t));
      rows.push({ el: btn, k: t.toLowerCase(), i });
      list.append(btn);
    }
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const r of rows) r.el.hidden = !!q && !r.k.includes(q);
    });
    const body = h('div', { class: 'bp' }, hint ? h('p', { class: 'muted bp-hint' }, hint) : null, search, list);
    const sheet = openSheet({ title, body, wide: true, className: 'bp-sheet', onClose: () => finish(null) });
    setTimeout(() => (list.querySelector('.cur') || list.firstChild)?.scrollIntoView({ block: 'center' }), 280);
  });
}
