// Postępy: czas czytania, seria, tempo, mapa aktywności, postęp w kursach
import { h, ic, plural, fmtMinutes, fmtNum, dayKey, addDays } from '../util.js';
import { stats, settings, listDocs, loadDoc, streak, todaySeconds, lastDays, docProgress, continueTarget, bus, wordsToMinutes } from '../state.js';
import { ring, countUp, coverEl } from '../ui.js';
import { chapterKicker } from '../course.js';
import { openPlan } from './shared.js';

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export async function mount(root) {
  const page = h('div', { class: 'page stats' });
  root.append(page);
  let range = 14;
  let destroyed = false;

  const tile = (icon, label, val, sub, fmt) => {
    const b = h('b', {}, '0');
    const t = h('div', { class: 'tile card' }, h('span', { class: 'tile-ic', html: ic(icon) }), h('div', { class: 'tile-l' }, label), b, h('small', {}, sub));
    countUp(b, val, { fmt: fmt || ((v) => fmtNum(v)) });
    return t;
  };

  async function render() {
    if (destroyed) return;
    const docs = listDocs();
    const s = streak();
    const totalMin = Math.round(stats.totalSec / 60);
    const todayMin = Math.floor(todaySeconds() / 60);
    const doneDocs = docs.filter((d) => (d.pct || 0) >= 0.99).length;

    // wykres słupkowy
    const days = lastDays(range);
    const maxS = Math.max(settings.goalMin * 60, ...days.map((d) => d.sec), 60);
    const goalPct = (settings.goalMin * 60 / maxS) * 100;
    const chart = h('div', { class: 'chart' + (range > 20 ? ' dense' : '') },
      h('div', { class: 'goal-line', style: { bottom: `calc(${goalPct}% * .86 + 22px)` } }, h('span', {}, `cel ${settings.goalMin} min`)),
      days.map((d, i) => {
        const min = Math.round(d.sec / 60);
        const lbl = range <= 14 ? d.date.toLocaleDateString('pl-PL', { weekday: 'narrow' }) : (d.date.getDate() === 1 || i === 0 ? MONTHS[d.date.getMonth()] : '');
        return h('div', { class: 'cb' + (d.sec >= settings.goalMin * 60 ? ' hit' : '') + (i === days.length - 1 ? ' today' : ''), title: `${d.date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}: ${min} min` },
          h('div', { class: 'cb-bar' }, h('i', { style: { height: Math.max(d.sec ? 5 : 2, Math.round((d.sec / maxS) * 100)) + '%', transitionDelay: i * 25 + 'ms' } })),
          h('span', {}, lbl));
      }));

    // mapa aktywności: 18 tygodni
    const weeks = 18;
    const end = new Date();
    const dow = (end.getDay() + 6) % 7; // pn=0
    const start = addDays(end, -(weeks * 7 - 1) - 0 + (6 - dow) * 0);
    const cells = [];
    const first = addDays(end, -((weeks - 1) * 7 + dow));
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const dt = addDays(first, w * 7 + d);
        if (dt > end) { col.push(h('i', { class: 'hc empty' })); continue; }
        const sec = stats.days[dayKey(dt)]?.s || 0;
        const lvl = sec === 0 ? 0 : sec < 600 ? 1 : sec < 1800 ? 2 : sec < 3600 ? 3 : 4;
        col.push(h('i', { class: 'hc l' + lvl, title: `${dt.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}: ${Math.round(sec / 60)} min` }));
      }
      cells.push(h('div', { class: 'hcol' }, col));
    }
    void start;

    const rows = [];
    for (const m of docs.slice().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))) {
      const doc = await loadDoc(m.id);
      if (!doc) continue;
      const p = docProgress(doc, m);
      const { ci } = continueTarget(doc, m);
      const left = wordsToMinutes(p.total - p.read);
      rows.push(h('button', { class: 'prog-row', onclick: () => openPlan(m.id) },
        h('div', { class: 'pr-cover' }, coverEl(m)),
        h('div', { class: 'pr-main' }, h('b', {}, m.title), h('small', {}, p.pct >= 0.99 ? 'Ukończono' : `${chapterKicker(doc.chapters[ci]) || 'Rozdział ' + (ci + 1)} · zostało ~${fmtMinutes(left)}`)),
        ring({ size: 52, stroke: 6, pct: p.pct, inner: h('span', { class: 'pr-n' }, Math.round(p.pct * 100) + '%') })));
    }

    page.replaceChildren(
      h('header', { class: 'page-head' }, h('div', {}, h('div', { class: 'kicker' }, 'Twoja nauka'), h('h1', { class: 'display big' }, 'Postępy'))),
      h('div', { class: 'tiles' },
        tile('flame', 'Seria', s, s === 1 ? 'dzień z rzędu' : 'dni z rzędu'),
        tile('clock', 'Dziś', todayMin, `min · cel ${settings.goalMin}`),
        tile('zap', 'Tempo', stats.wpm, 'słów na minutę'),
        tile('book-open', 'Łącznie', totalMin >= 60 ? Math.round(totalMin / 6) / 10 : totalMin, totalMin >= 60 ? 'godzin czytania' : 'minut czytania', totalMin >= 60 ? (v) => v.toFixed(1).replace('.', ',') : undefined)),
      h('section', { class: 'card chart-card' },
        h('div', { class: 'sec-h' }, h('h3', {}, 'Czas czytania'),
          h('div', { class: 'seg' }, [[7, '7 dni'], [14, '14 dni'], [30, '30 dni']].map(([r, l]) => h('button', { class: range === r ? 'on' : '', onclick: () => { range = r; render(); } }, l)))),
        chart),
      h('section', { class: 'card heat-card' }, h('div', { class: 'sec-h' }, h('h3', {}, 'Mapa regularności'), h('small', { class: 'dim' }, 'ostatnie 18 tygodni')), h('div', { class: 'heat' }, cells)),
      h('section', { class: 'prog-sec' },
        h('div', { class: 'sec-h' }, h('h3', {}, 'Twoje kursy'), h('small', { class: 'dim' }, `${doneDocs} z ${docs.length} ukończone`)),
        rows.length ? h('div', { class: 'prog-list' }, rows) : h('div', { class: 'empty small' }, h('p', {}, 'Po dodaniu dokumentu zobaczysz tu postęp w każdym kursie.'))));
  }

  await render();
  const off1 = bus.on('stats', () => { if (!destroyed) render(); });
  return { destroy() { destroyed = true; off1(); } };
}
