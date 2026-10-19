// Pulpit: kontynuacja czytania, cel dnia, następne rozdziały
import { h, ic, greeting, plural, fmtMinutes, dayKey, fmtNum } from '../util.js';
import { listDocs, loadDoc, stats, settings, streak, todaySeconds, lastDays, bus, docProgress, continueTarget, wordsToMinutes } from '../state.js';
import { coverEl, ring, progressBar, attachTilt, countUp } from '../ui.js';
import { chapterKicker, partLabel, minutesFor, planFor } from '../course.js';
import { docCard, openDoc, openPlan, startOver } from './shared.js';
import { pickFiles, openAdd } from '../main.js';

const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

function emptyState() {
  const feats = [['book-open', 'Rozdziały i spis treści rozpoznawane automatycznie'], ['clock', 'Pamięta, gdzie skończyłeś — co do akapitu'], ['target', 'Czytasz rozdział po rozdziale i nigdy nie gubisz miejsca'], ['shield', 'Wszystko zostaje na Twoim urządzeniu']];
  return h('section', { class: 'hero-empty' },
    h('div', { class: 'he-art', 'aria-hidden': 'true' },
      h('div', { class: 'floatbook b1' }, h('span', { html: ic('file-lines') })),
      h('div', { class: 'floatbook b2' }, h('span', { html: ic('book-open') })),
      h('div', { class: 'floatbook b3' }, h('span', { html: ic('bookmark') })),
      h('svg', { class: 'he-logo', viewBox: '0 0 64 64', html: '<use href="#i-logo"/>' })),
    h('div', { class: 'he-txt' },
      h('div', { class: 'kicker' }, 'Zacznijmy'),
      h('h1', { class: 'display' }, 'Wrzuć swój pierwszy dokument'),
      h('p', { class: 'muted lead' }, 'Książka, raport, skrypt, podręcznik, notatki. Lumen podzieli go na rozdziały, zapamięta miejsce, w którym skończyłeś, i pomoże Ci dotrzeć do końca.'),
      h('div', { class: 'he-actions' },
        h('button', { class: 'btn primary lg', onclick: () => pickFiles() }, h('span', { html: ic('upload') }), 'Wybierz plik'),
        h('button', { class: 'btn lg', onclick: () => openAdd('url') }, h('span', { html: ic('link') }), 'Z adresu lub wklejony tekst')),
      h('div', { class: 'he-formats' }, ['PDF', 'EPUB', 'DOCX', 'TXT', 'MD', 'HTML'].map((f) => h('span', { class: 'fmt' }, f))),
      h('ul', { class: 'he-feats' }, feats.map(([i, t]) => h('li', {}, h('span', { html: ic(i) }), t)))));
}

function goalCard() {
  const goal = settings.goalMin;
  const min = Math.floor(todaySeconds() / 60);
  const pct = Math.min(1, todaySeconds() / (goal * 60));
  const inner = h('div', { class: 'goal-in' }, h('b', { class: 'goal-num' }, '0'), h('span', {}, `/ ${goal} min`));
  const r = ring({ size: 148, stroke: 12, pct, inner });
  countUp(inner.querySelector('b'), min);
  const days = lastDays(7);
  const maxS = Math.max(goal * 60, ...days.map((d) => d.sec));
  const week = h('div', { class: 'week' }, days.map((d, i) => {
    const isToday = i === days.length - 1;
    return h('div', { class: 'wd' + (isToday ? ' today' : '') + (d.sec >= goal * 60 ? ' hit' : '') },
      h('div', { class: 'wbar' }, h('i', { style: { height: Math.max(4, Math.round((d.sec / maxS) * 100)) + '%', transitionDelay: i * 60 + 'ms' } })),
      h('span', {}, WEEKDAYS[d.date.getDay()]));
  }));
  const s = streak();
  return h('section', { class: 'card goal-card' },
    h('div', { class: 'kicker' }, 'Cel na dziś'),
    h('div', { class: 'goal-row' }, r,
      h('div', { class: 'goal-side' },
        h('div', { class: 'streak' }, h('span', { class: 'flame', html: ic('flame') }), h('b', {}, s), h('span', { class: 'muted' }, ` ${plural(s, 'dzień', 'dni', 'dni')} z rzędu`)),
        h('div', { class: 'dim sm' }, pct >= 1 ? 'Cel dnia osiągnięty. Świetna robota.' : `Zostało ${Math.max(1, goal - min)} min do celu.`))),
    week);
}

async function heroCard(meta) {
  const doc = await loadDoc(meta.id);
  const wrap = h('section', { class: 'hero-card', style: { '--h': meta.hue ?? 220 } });
  if (!doc) return wrap;
  const { ci, info } = continueTarget(doc, meta);
  const ch = doc.chapters[ci];
  const x = info[ci];
  const p = docProgress(doc, meta);
  const started = (meta.prog?.done && Object.keys(meta.prog.done).length) || x.started;
  const minsLeft = minutesFor(x.words - x.read);
  const plan = planFor(doc, meta);
  const cover = coverEl(meta, { tilt: true });
  const kick = chapterKicker(ch);

  wrap.append(
    h('div', { class: 'hero-glow' }),
    h('div', { class: 'hero-cover' }, cover),
    h('div', { class: 'hero-body' },
      h('div', { class: 'kicker acc' }, started ? 'Kontynuuj czytanie' : 'Zacznij czytać'),
      h('div', { class: 'hero-doc dim' }, meta.title),
      h('div', { class: 'hero-ch' }, kick ? h('span', { class: 'hk' }, kick, ch.part ? ` · ${partLabel(ch)}` : '') : (ch.part ? h('span', { class: 'hk' }, partLabel(ch)) : null)),
      h('h2', { class: 'display hero-title' }, ch.title),
      h('div', { class: 'hero-meta' },
        h('span', { html: `${ic('clock')} ${x.read > 0 ? `jeszcze ~${fmtMinutes(minsLeft)}` : `~${fmtMinutes(minutesFor(x.words))}`}` }),
        h('span', { html: `${ic('layers')} ${ci + 1} z ${doc.chapters.length}` }),
        plan.minPerDay ? h('span', { class: 'plan', html: `${ic('calendar')} ${plan.minPerDay} min dziennie do ${new Date(meta.deadline).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}` }) : null),
      h('div', { class: 'hero-prog' }, progressBar(x.pct), h('span', {}, `${Math.round(p.pct * 100)}% przeczytane`)),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn primary lg', onclick: () => openDoc(meta.id) }, started ? 'Czytaj dalej' : 'Zaczynamy', h('span', { html: ic('arrow-right') })),
        h('button', { class: 'btn lg', onclick: () => openPlan(meta.id) }, h('span', { html: ic('layers') }), 'Spis rozdziałów')),
      started ? h('button', { class: 'start-over', onclick: () => startOver(meta, () => { location.hash = '#/read/' + meta.id + '?c=0'; }) }, h('span', { html: ic('refresh') }), 'Zacznij od początku') : null));
  attachTilt(cover);
  return wrap;
}

async function upNext(meta) {
  const doc = await loadDoc(meta.id);
  if (!doc) return null;
  const { ci, info } = continueTarget(doc, meta);
  const rows = [];
  for (let i = ci + 1; i < doc.chapters.length && rows.length < 3; i++) {
    if (info[i].done) continue;
    rows.push(i);
  }
  if (!rows.length) return null;
  return h('section', { class: 'upnext' },
    h('div', { class: 'sec-h' }, h('h3', {}, 'Dalej w dokumencie'), h('button', { class: 'btn ghost sm', onclick: () => openPlan(meta.id) }, 'Wszystkie rozdziały', h('span', { html: ic('arrow-right') }))),
    h('div', { class: 'un-list' }, rows.map((i, k) => {
      const ch = doc.chapters[i];
      return h('button', { class: 'un-row', style: { '--d': k * 70 + 'ms' }, onclick: () => { location.hash = `#/read/${meta.id}?c=${i}`; } },
        h('span', { class: 'un-num' }, ch.num || (i + 1)),
        h('span', { class: 'un-t' }, h('b', {}, ch.title), h('small', {}, [partLabel(ch), `~${fmtMinutes(minutesFor(info[i].words))}`].filter(Boolean).join(' · '))),
        h('span', { class: 'un-go', html: ic('right') }));
    })));
}

export async function mount(root) {
  const page = h('div', { class: 'page home' });
  root.append(page);
  let destroyed = false;
  const unsub = [];

  const build = async () => {
    const docs = listDocs();
    const frag = h('div', {});
    const now = new Date();
    frag.append(h('header', { class: 'page-head' },
      h('div', {}, h('div', { class: 'kicker' }, now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })), h('h1', { class: 'display big' }, greeting())),
      docs.length ? h('button', { class: 'btn primary head-add', onclick: () => openAdd() }, h('span', { html: ic('plus') }), 'Dodaj dokument') : null));

    if (!docs.length) { frag.append(emptyState()); return frag; }

    const sorted = docs.slice().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0) || b.addedAt - a.addedAt);
    const active = sorted.find((d) => (d.pct || 0) < 0.99) || sorted[0];
    const hero = await heroCard(active);
    const grid = h('div', { class: 'home-grid' }, hero, goalCard());
    frag.append(grid);
    const nxt = await upNext(active);
    if (nxt) frag.append(nxt);
    const others = sorted.filter((d) => d.id !== active.id);
    if (others.length) {
      frag.append(h('section', { class: 'shelf' },
        h('div', { class: 'sec-h' }, h('h3', {}, 'Twoje dokumenty'), h('a', { class: 'btn ghost sm', href: '#/library' }, 'Biblioteka', h('span', { html: ic('arrow-right') }))),
        h('div', { class: 'shelf-row' }, others.slice(0, 8).map((m) => docCard(m, { onChange: refresh })))));
    }
    return frag;
  };

  const refresh = async () => {
    if (destroyed) return;
    const content = await build();
    if (destroyed) return;
    page.replaceChildren(content);
  };
  await refresh();
  unsub.push(bus.on('library', () => { if (!destroyed) refresh(); }));
  return { destroy() { destroyed = true; unsub.forEach((u) => u()); } };
}
