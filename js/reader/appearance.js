// Panel wyglądu (motyw, akcent, czcionka, rozmiar…) — używany w czytniku i w ustawieniach
import { h, ic } from '../util.js';
import { settings, setSetting, bus } from '../state.js';

export const THEMES = [
  ['night', 'Noc', '#0b0e22', '#e8eaf8'],
  ['oled', 'OLED', '#000000', '#dfe2f2'],
  ['paper', 'Papier', '#f7f3ea', '#25221b'],
  ['sepia', 'Sepia', '#f1e4c8', '#34281a'],
  ['auto', 'Auto', 'linear-gradient(135deg,#0b0e22 50%,#f7f3ea 50%)', '#888'],
];
export const ACCENTS = [['amber', '#f6b94c'], ['sky', '#62bcff'], ['mint', '#4fdcaa'], ['rose', '#ff86a6'], ['violet', '#ab95ff']];
export const FONTS = [
  ['serif', 'Literata', 'Szeryfowa'],
  ['sans', 'Inter', 'Bezszeryfowa'],
  ['hyper', 'Atkinson Hyperlegible', 'Czytelna'],
  ['system', 'system-ui', 'Systemowa'],
];

export function applyReadingVars(el) {
  const fam = { serif: "'Literata', Georgia, serif", sans: "'Inter', system-ui, sans-serif", hyper: "'Atkinson Hyperlegible', system-ui, sans-serif", system: 'system-ui, -apple-system, Segoe UI, sans-serif' }[settings.font] || 'serif';
  el.style.setProperty('--rfont', fam);
  el.style.setProperty('--rs', settings.size + 'px');
  el.style.setProperty('--rlh', String(settings.lh));
  el.style.setProperty('--rw', settings.width + 'px');
  el.style.setProperty('--rgap', String(settings.gap));
  el.dataset.align = settings.align;
}

function slider({ label, key, min, max, step, fmt, onInput }) {
  const out = h('output', {}, fmt(settings[key]));
  const input = h('input', { type: 'range', min, max, step, value: settings[key], 'aria-label': label,
    oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); setSetting(key, v); onInput && onInput(v); paintTrack(); } });
  const paintTrack = () => { const p = ((input.value - min) / (max - min)) * 100; input.style.setProperty('--p', p + '%'); };
  paintTrack();
  return h('div', { class: 'ap-row' }, h('label', {}, label), h('div', { class: 'ap-slide' }, input, out));
}

export function buildAppearance({ showTheme = true, showPreview = true } = {}) {
  const wrap = h('div', { class: 'appearance' });

  if (showTheme) {
    const themeRow = h('div', { class: 'ap-themes' });
    const paint = () => { themeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === settings.theme)); };
    THEMES.forEach(([k, label, bg, fg]) => {
      themeRow.append(h('button', { class: 'ap-theme', 'data-k': k, 'aria-label': label, onclick: () => { setSetting('theme', k); paint(); } },
        h('span', { class: 'sw', style: { background: bg, color: fg } }, h('b', {}, 'Aa')), h('small', {}, label)));
    });
    paint();
    const accRow = h('div', { class: 'ap-accents' });
    const paintA = () => { accRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === settings.accent)); };
    ACCENTS.forEach(([k, c]) => accRow.append(h('button', { class: 'ap-acc', 'data-k': k, 'aria-label': 'Akcent ' + k, style: { background: c }, onclick: () => { setSetting('accent', k); paintA(); } }, h('span', { html: ic('check') }))));
    paintA();
    wrap.append(h('div', { class: 'ap-sec' }, h('div', { class: 'kicker' }, 'Motyw'), themeRow), h('div', { class: 'ap-sec' }, h('div', { class: 'kicker' }, 'Kolor akcentu'), accRow));
  }

  const fontRow = h('div', { class: 'ap-fonts' });
  const paintF = () => fontRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === settings.font));
  FONTS.forEach(([k, fam, label]) => fontRow.append(h('button', { class: 'ap-font', 'data-k': k, onclick: () => { setSetting('font', k); paintF(); } }, h('b', { style: { fontFamily: fam } }, 'Aa'), h('small', {}, label))));
  paintF();

  const alignRow = h('div', { class: 'seg' },
    ['left', 'Do lewej'].map ? null : null);
  const seg = h('div', { class: 'seg' });
  [['left', 'Do lewej'], ['justify', 'Wyjustowany']].forEach(([k, l]) => seg.append(h('button', { class: settings.align === k ? 'on' : '', onclick: () => { setSetting('align', k); seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['left', 'justify'][i] === k)); } }, l)));
  void alignRow;

  wrap.append(
    h('div', { class: 'ap-sec' }, h('div', { class: 'kicker' }, 'Czcionka'), fontRow),
    h('div', { class: 'ap-sec' },
      slider({ label: 'Rozmiar tekstu', key: 'size', min: 14, max: 32, step: 1, fmt: (v) => v + ' px' }),
      slider({ label: 'Interlinia', key: 'lh', min: 1.3, max: 2.2, step: 0.05, fmt: (v) => (+v).toFixed(2).replace('.', ',') }),
      slider({ label: 'Szerokość kolumny', key: 'width', min: 460, max: 920, step: 20, fmt: (v) => v + ' px' }),
      slider({ label: 'Odstęp akapitów', key: 'gap', min: 0.4, max: 2, step: 0.1, fmt: (v) => (+v).toFixed(1).replace('.', ',') + '×' }),
      h('div', { class: 'ap-row' }, h('label', {}, 'Wyrównanie'), seg)));

  if (showPreview) {
    const prev = h('div', { class: 'ap-preview reader-vars' },
      h('h4', {}, 'Cicha lektura'),
      h('p', {}, 'Dobre czytanie zaczyna się od światła, rytmu i spokoju. Ustaw tekst tak, żeby oczy zapomniały, że czytają.'));
    const upd = () => applyReadingVars(prev);
    upd();
    const off = bus.on('settings', upd);
    prev.addEventListener('DOMNodeRemoved', off, { once: true });
    wrap.append(h('div', { class: 'ap-sec' }, h('div', { class: 'kicker' }, 'Podgląd'), prev));
  }
  return wrap;
}
