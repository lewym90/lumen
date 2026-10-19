// Tagi i półki: własne etykiety dokumentów (meta.tags) + okno edycji
import { h, ic, foldText } from '../util.js';
import { listDocs, saveMeta } from '../state.js';
import { openSheet, toast } from '../ui.js';

export function normTag(t) { return String(t || '').replace(/\s+/g, ' ').replace(/^#+/, '').trim().slice(0, 28); }

// wszystkie tagi z licznikami (alfabetycznie)
export function allTags() {
  const map = new Map();
  for (const d of listDocs()) for (const t of d.tags || []) {
    const k = foldText(t);
    const e = map.get(k) || { name: t, n: 0 };
    e.n++; map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export function hasTag(meta, name) { const k = foldText(name); return (meta.tags || []).some((t) => foldText(t) === k); }

export function openTagEditor(meta, onChange) {
  let cur = [...(meta.tags || [])];
  const input = h('input', { class: 'field', type: 'text', maxlength: 28, placeholder: 'Nowa półka lub tag, np. „Prawo”, „Do egzaminu”', 'aria-label': 'Nowy tag' });
  const mine = h('div', { class: 'chips tag-cur' });
  const sugg = h('div', { class: 'chips tag-sugg' });
  const add = (raw) => {
    const t = normTag(raw);
    if (!t) return;
    if (cur.some((x) => foldText(x) === foldText(t))) { input.value = ''; return; }
    if (cur.length >= 12) { toast('Maksymalnie 12 tagów na dokument', { icon: 'tag' }); return; }
    cur.push(t); input.value = ''; paint();
  };
  const paint = () => {
    mine.replaceChildren(...(cur.length ? cur.map((t) => h('button', { class: 'chip on tg', 'aria-label': 'Usuń tag ' + t, onclick: () => { cur = cur.filter((x) => x !== t); paint(); } }, t, h('span', { html: ic('close') }))) : [h('span', { class: 'dim' }, 'Brak tagów — dodaj pierwszy poniżej.')]));
    const others = allTags().filter((t) => !cur.some((x) => foldText(x) === foldText(t.name)));
    sugg.replaceChildren(...others.map((t) => h('button', { class: 'chip tg', onclick: () => add(t.name) }, '+ ' + t.name)));
    sugg.hidden = !others.length;
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } });
  const body = h('div', { class: 'tag-edit' },
    h('div', { class: 'kicker' }, 'Przypisane'), mine,
    h('div', { class: 'tag-add' }, input, h('button', { class: 'btn', onclick: () => add(input.value) }, 'Dodaj')),
    h('div', { class: 'kicker' }, 'Istniejące półki'), sugg,
    h('div', { class: 'hl-actions' }, h('button', { class: 'btn primary', onclick: async () => {
      add(input.value);
      meta.tags = cur;
      await saveMeta(meta);
      s.close(); toast('Zapisano tagi', { icon: 'tag' }); onChange && onChange();
    } }, 'Zapisz')));
  paint();
  const s = openSheet({ title: 'Tagi i półki', body });
}
