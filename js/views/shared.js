// Elementy wspólne dla widoków: karta dokumentu, akcje na dokumencie
import { h, ic, plural, fmtNum } from '../util.js';
import { coverEl, openMenu, confirmDialog, promptDialog, toast, typeLabel } from '../ui.js';
import { saveMeta, lib, bus, dropDocCache } from '../state.js';
import { db } from '../db.js';
import { openTagEditor } from './tags.js';

export function openDoc(id) { location.hash = '#/read/' + id; }
export function openPlan(id) { location.hash = '#/doc/' + id; }

export async function renameDoc(meta) {
  const t = await promptDialog({ title: 'Zmień tytuł', value: meta.title, label: 'Tytuł dokumentu' });
  if (t && t.trim()) { meta.title = t.trim(); meta.titleEdited = true; await saveMeta(meta); toast('Zapisano nowy tytuł'); }
}

export async function deleteDoc(meta) {
  const ok = await confirmDialog({
    title: 'Usunąć dokument?',
    text: `„${meta.title}” zostanie usunięty z biblioteki razem z postępem, zakreśleniami i notatkami. Tej operacji nie można cofnąć.`,
    ok: 'Usuń', danger: true,
  });
  if (!ok) return false;
  await db.delDocAll(meta.id);
  lib.docs.delete(meta.id);
  dropDocCache();
  bus.emit('library');
  toast('Dokument usunięty', { icon: 'trash' });
  return true;
}

export function docMenu(anchor, meta, { onChange } = {}) {
  openMenu(anchor, [
    { icon: 'book-open', label: 'Czytaj', onClick: () => openDoc(meta.id) },
    { icon: 'layers', label: 'Spis treści i rozdziały', onClick: () => openPlan(meta.id) },
    'hr',
    { icon: 'tag', label: 'Tagi i półki…', onClick: () => openTagEditor(meta, onChange) },
    { icon: 'edit', label: 'Zmień tytuł', onClick: async () => { await renameDoc(meta); onChange && onChange(); } },
    { icon: 'trash', label: 'Usuń z biblioteki', danger: true, onClick: async () => { if (await deleteDoc(meta)) onChange && onChange(); } },
  ]);
}

export function docCard(meta, { onChange, compact = false } = {}) {
  const pct = Math.round((meta.pct || 0) * 100);
  const total = meta.chapterCount || 0;
  const p = meta.prog || {};
  const doneCount = Object.keys(p.done || {}).length;
  const finished = pct >= 99 || (total && doneCount >= total);
  const sub = finished ? 'Przeczytano' : pct > 0 ? `${doneCount} z ${total} ${plural(total, 'rozdziału', 'rozdziałów', 'rozdziałów')}` : `${total} ${plural(total, 'rozdział', 'rozdziały', 'rozdziałów')}`;
  const card = h('a', { class: 'doc-card' + (compact ? ' compact' : ''), href: '#/doc/' + meta.id, 'aria-label': meta.title });
  const cv = coverEl(meta);
  const ringWrap = h('div', { class: 'dc-cover' }, cv);
  if (pct > 0) ringWrap.append(h('div', { class: 'dc-pct' + (finished ? ' done' : '') }, finished ? h('span', { html: ic('check') }) : `${pct}%`));
  const more = h('button', { class: 'dc-more icon-btn', 'aria-label': 'Więcej', html: ic('dots'), onclick: (e) => { e.preventDefault(); e.stopPropagation(); docMenu(more, meta, { onChange }); } });
  card.append(ringWrap, h('div', { class: 'dc-body' },
    h('div', { class: 'dc-title' }, meta.title),
    h('div', { class: 'dc-sub' }, h('span', { class: 'dc-type' }, typeLabel(meta.type)), sub),
    (meta.tags && meta.tags.length) || meta.legal ? h('div', { class: 'dc-tags' }, meta.legal ? h('span', { class: 'dc-tag legal' }, 'Akt prawny') : null, ...(meta.tags || []).slice(0, 1).map((t) => h('span', { class: 'dc-tag' }, t)), (meta.tags || []).length > 1 ? h('span', { class: 'dc-tag more' }, '+' + ((meta.tags || []).length - 1)) : null) : null,
    h('div', { class: 'bar-line thin' }, h('i', { style: { width: pct + '%' } }))), more);
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); docMenu({ x: e.clientX, y: e.clientY }, meta, { onChange }); });
  return card;
}

export function fmtWords(n) { return `${fmtNum(n)} ${plural(n, 'słowo', 'słowa', 'słów')}`; }

// „Zacznij od początku”: wraca do początku dokumentu; postęp rozdziałów, zakreślenia i zakładki zostają
export async function startOver(meta, go) {
  const ok = await confirmDialog({
    title: 'Zacząć od początku?',
    text: 'Otworzę dokument na pierwszym rozdziale. Zakreślenia, notatki i oznaczone jako przeczytane rozdziały zostaną, ale miejsce, w którym skończyłeś, przesunie się na początek.',
    ok: 'Zacznij od początku',
  });
  if (!ok) return;
  const p = meta.prog || (meta.prog = { ch: 0, blk: 0, frac: 0, far: {}, done: {}, sec: 0, words: 0 });
  p.ch = 0; p.blk = null; p.frac = 0; p.far = {}; p.t = Date.now();
  try { localStorage.removeItem('lumen.pos.' + meta.id); } catch { /* brak */ }
  await saveMeta(meta);
  go();
}
