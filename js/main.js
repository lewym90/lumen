// Lumen — start aplikacji, powłoka, router, import
import { $, h, ic, sleep, plural } from './util.js';
import { installIcons } from './icons.js';
import { settings, setSetting, getVal, bus, loadLibrary, loadStats, migrateLegal, listDocs, getMeta, streak, todaySeconds, lib } from './state.js';
import { toast, openSheet, closeMenu } from './ui.js';
import { requestPersistence } from './db.js';
import { ACCEPT, importFile, fetchSource, textToFile, FetchError } from './import/importer.js';

// ───── motyw ─────
const mqDark = matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const root = document.documentElement;
  let t = getVal('theme');
  if (t === 'auto') t = mqDark.matches ? 'night' : 'paper';
  root.dataset.theme = t;
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.motion === 'reduce' ? 'reduce' : 'auto';
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}
bus.on('settings', (k) => { if (['theme', 'accent', 'motion', 'ap'].includes(k)) applyTheme(); });
mqDark.addEventListener?.('change', () => { if (getVal('theme') === 'auto') applyTheme(); });

// ───── routing ─────
const routes = {
  '': () => import('./views/home.js'),
  library: () => import('./views/library.js'),
  search: () => import('./views/search.js'),
  stats: () => import('./views/stats.js'),
  settings: () => import('./views/settings.js'),
  doc: () => import('./views/detail.js'),
};

let current = null;       // aktualny widok (obiekt z destroy)
let readerMod = null;
let readerOpen = false;
let navToken = 0;

export function go(path, { replace = false } = {}) {
  const url = '#/' + path.replace(/^#?\/?/, '');
  if (replace) location.replace(url); else location.hash = url;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { name: parts[0] || '', id: parts[1] || '', params };
}

async function route() {
  const token = ++navToken;
  closeMenu();
  const { name, id, params } = parseHash();
  const view = $('#view');

  if (name === 'read') {
    const meta = getMeta(id);
    if (!meta) { go('library', { replace: true }); return; }
    if (!readerMod) readerMod = await import('./reader/reader.js');
    if (token !== navToken) return;
    if (!readerOpen) {
      readerOpen = true;
      await readerMod.openReader(meta, params);
    } else {
      readerMod.reopen(meta, params);
    }
    setActiveNav('');
    return;
  }

  if (readerOpen) { readerOpen = false; readerMod?.closeReader(); }
  if (name === 'shared') { await handleShared(); go('', { replace: true }); return; }

  const loader = routes[name];
  if (!loader) { go('', { replace: true }); return; }
  setActiveNav(name);
  const mod = await loader();
  if (token !== navToken) return;

  const old = view.firstElementChild;
  if (old && old.classList.contains('page')) { old.classList.add('out'); await sleep(140); }
  if (token !== navToken) return;
  if (current?.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
  view.replaceChildren();
  view.scrollTop = 0;
  current = (await mod.mount(view, { id, ...params })) || null;
}

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const on = el.dataset.nav === name || (name === 'doc' && el.dataset.nav === 'library');
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

// ───── powłoka ─────
function buildShell() {
  const items = [
    ['', 'home', 'Pulpit'],
    ['library', 'library', 'Biblioteka'],
    ['stats', 'chart', 'Postępy'],
    ['settings', 'sliders', 'Ustawienia'],
  ];
  const navItem = ([path, icon, label]) => h('a', { class: 'nav-item', href: '#/' + path, 'data-nav': path }, h('span', { html: ic(icon) }), h('span', { class: 'lbl' }, label));

  const side = h('nav', { class: 'nav nav-side', 'aria-label': 'Główna nawigacja' },
    h('div', { class: 'brand' }, h('span', { class: 'logo', html: `<svg class="logo" viewBox="0 0 64 64" width="40" height="40"><use href="#i-logo"/></svg>` }),
      h('div', { class: 'txt' }, h('div', { class: 'name' }, 'Lumen'), h('div', { class: 'tag' }, 'czytaj · ucz się'))),
    ...items.slice(0, 2).map(navItem),
    navItem(['search', 'search', 'Szukaj']),
    ...items.slice(2).map(navItem),
    h('div', { class: 'nav-spacer' }),
    h('div', { class: 'nav-mini', id: 'nav-mini' }),
    h('button', { class: 'btn primary nav-add', onclick: () => openAdd() }, h('span', { html: ic('plus') }), h('span', {}, 'Dodaj dokument')));

  const bottom = h('nav', { class: 'nav nav-bottom', 'aria-label': 'Główna nawigacja' },
    h('div', { class: 'bar' },
      navItem(items[0]), navItem(items[1]),
      h('button', { class: 'fab', 'aria-label': 'Dodaj dokument', onclick: () => openAdd(), html: ic('plus') }),
      navItem(items[2]), navItem(items[3])));

  const app = $('#app');
  app.append(side, h('main', { class: 'main' }, h('div', { id: 'view' })), bottom);
  updateNavMini();
  bus.on('stats', updateNavMini);
}

function updateNavMini() {
  const el = $('#nav-mini');
  if (!el) return;
  const s = streak();
  const min = Math.floor(todaySeconds() / 60);
  el.replaceChildren(
    h('div', { class: 'row' }, h('span', { class: 'flame', html: ic('flame') }), h('span', {}, h('b', {}, s), ` ${plural(s, 'dzień', 'dni', 'dni')} z rzędu`)),
    h('div', { class: 'row' }, h('span', { html: ic('clock') }), h('span', {}, h('b', {}, min), ` min dziś · cel ${settings.goalMin}`)));
}

// ───── wybór i import plików ─────
// okno „Dodaj dokument”: plik, adres internetowy albo wklejony tekst
export function openAdd(tab = 'file') {
  let cur = tab;
  const tabs = h('div', { class: 'seg add-tabs' });
  const pane = h('div', { class: 'add-pane' });
  let sheet;
  const TABS = [['file', 'Plik', 'upload'], ['url', 'Adres WWW', 'link'], ['paste', 'Wklej tekst', 'note']];
  const paint = () => {
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { class: cur === k ? 'on' : '', onclick: () => { cur = k; paint(); } }, l)));
    pane.replaceChildren();
    if (cur === 'file') {
      pane.append(
        h('p', { class: 'muted' }, 'PDF (także skany — rozpoznam tekst), EPUB, DOCX, TXT, Markdown i HTML. Możesz też przeciągnąć plik na okno aplikacji.'),
        h('button', { class: 'btn primary lg', onclick: () => { sheet.close(); setTimeout(pickFiles, 50); } }, h('span', { html: ic('upload') }), 'Wybierz pliki'));
    } else if (cur === 'url') {
      const inp = h('input', { class: 'field', type: 'url', inputmode: 'url', placeholder: 'https://…  (np. strona ustawy w ISAP albo plik PDF)', 'aria-label': 'Adres strony lub pliku', autocapitalize: 'off', spellcheck: 'false' });
      const go2 = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } sheet.close(); runImportUrl(v); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go2(); } });
      pane.append(
        h('p', { class: 'muted' }, 'Wklej adres strony z tekstem (HTML) albo bezpośredni link do PDF-a. Adresy aktów z ISAP i ELI (Sejm) zamienię na tekst jednolity z serwisu Sejmu.'),
        inp,
        h('p', { class: 'dim sm' }, 'Przeglądarka pozwala pobrać tylko strony, które same na to zezwalają. Gdy się nie uda, skopiuj tekst ze strony i użyj zakładki „Wklej tekst” albo zapisz stronę jako PDF/HTML i dodaj plik.'),
        h('div', { class: 'hl-actions' }, h('button', { class: 'btn primary', onclick: go2 }, h('span', { html: ic('download') }), 'Pobierz i dodaj')));
      setTimeout(() => inp.focus(), 250);
    } else {
      const ttl = h('input', { class: 'field', type: 'text', maxlength: 120, placeholder: 'Tytuł (opcjonalnie)', 'aria-label': 'Tytuł' });
      const ta = h('textarea', { class: 'field paste-ta', rows: 9, placeholder: 'Wklej tutaj tekst — np. skopiowaną ustawę ze strony internetowej…', 'aria-label': 'Wklejony tekst' });
      pane.append(
        h('p', { class: 'muted' }, 'Tekst zostanie dodany do biblioteki dokładnie tak, jak go wkleisz. Akty prawne (Art., ust., pkt) są rozpoznawane automatycznie.'),
        ttl, ta,
        h('div', { class: 'hl-actions' }, h('button', { class: 'btn primary', onclick: () => {
          if (ta.value.trim().length < 20) { toast('Wklej dłuższy fragment tekstu', { icon: 'note' }); ta.focus(); return; }
          sheet.close(); runImportText(ta.value, ttl.value);
        } }, 'Dodaj do biblioteki')));
    }
  };
  paint();
  sheet = openSheet({ title: 'Dodaj dokument', body: h('div', { class: 'add-sheet' }, tabs, pane) });
}

let fileInput;
export function pickFiles() {
  if (!fileInput) {
    fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
    fileInput.addEventListener('change', () => { const f = [...fileInput.files]; fileInput.value = ''; if (f.length) runImport(f); });
    document.body.append(fileInput);
  }
  fileInput.click();
}

let importing = false;
export function runImport(files) {
  return runJobs(files.map((f) => ({ name: f.name, run: (cb) => importFile(f, cb) })));
}

export function runImportUrl(url) {
  return runJobs([{ name: url, run: async (cb) => {
    const { file, href } = await fetchSource(url, cb);
    return importFile(file, cb, { src: href });
  } }]);
}

export function runImportText(text, title) {
  const f = textToFile(text, title);
  return runJobs([{ name: f.name, run: (cb) => importFile(f, cb) }]);
}

async function runJobs(files) {
  if (importing) { toast('Poczekaj, kończę poprzedni import…', { icon: 'clock' }); return; }
  importing = true;
  const visual = h('div', { class: 'import-visual' }, h('i', { class: 'pg' }), h('i', { class: 'pg' }), h('i', { class: 'pg' }));
  const title = h('h3', {}, 'Przygotowuję dokument');
  const fname = h('div', { class: 'fname' });
  const phase = h('div', { class: 'phase' });
  const detail = h('div', { class: 'detail' });
  const barFill = h('i');
  const bar = h('div', { class: 'bar-line', style: { width: '100%' } }, barFill);
  const body = h('div', { class: 'import-card' }, visual, title, fname, bar, phase, detail);
  const sheet = openSheet({ body, className: 'import', wide: false });
  sheet.scrim.onpointerdown = null;
  const added = [];
  let dup = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      title.textContent = files.length > 1 ? `Dokument ${i + 1} z ${files.length}` : 'Przygotowuję dokument';
      try {
        const res = await f.run((p) => {
          fname.textContent = p.name || f.name;
          phase.textContent = p.phase || '';
          detail.textContent = p.detail || '';
          barFill.style.width = Math.round((p.frac || 0) * 100) + '%';
        });
        if (res.duplicate) dup++; else added.push(res.meta);
        if (res.duplicate && files.length === 1) added.push(res.meta);
      } catch (e) {
        console.error(e);
        toast(e instanceof FetchError ? e.message : `${f.name}: ${e.message || 'nie udało się wczytać pliku'}`, { error: true, ms: 7000 });
        if (e instanceof FetchError && e.kind === 'cors') setTimeout(() => openAdd('paste'), 600);
      }
    }
  } finally {
    importing = false;
    sheet.close();
  }
  requestPersistence();
  if (added.length === 1) {
    const m = added[0];
    toast(dup && files.length === 1 ? 'Ten dokument już jest w bibliotece' : `Dodano „${m.title}” · ${m.chapterCount} ${plural(m.chapterCount, 'rozdział', 'rozdziały', 'rozdziałów')}`, { icon: 'sparkle' });
    go('doc/' + m.id);
  } else if (added.length > 1) {
    toast(`Dodano ${added.length} dokumentów`, { icon: 'sparkle' });
    go('library');
  }
  bus.emit('library');
}

// przeciągnij i upuść
function setupDrop() {
  let depth = 0, overlay = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    if (!overlay) { overlay = h('div', { class: 'dropzone-overlay' }, h('div', { class: 'in' }, h('span', { html: ic('upload') }), h('b', {}, 'Upuść, aby dodać do biblioteki'), h('span', { class: 'muted' }, 'PDF · EPUB · DOCX · TXT · MD · HTML'))); document.body.append(overlay); }
  });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth && overlay) { overlay.remove(); overlay = null; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    if (overlay) { overlay.remove(); overlay = null; }
    const f = [...e.dataTransfer.files];
    if (f.length) runImport(f);
  });
}

async function handleShared() {
  try {
    const cache = await caches.open('lumen-share');
    const keys = await cache.keys();
    const files = [];
    for (const k of keys) {
      const res = await cache.match(k);
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-filename') || 'dokument');
      files.push(new File([blob], name, { type: blob.type }));
      await cache.delete(k);
    }
    if (files.length) runImport(files);
  } catch (e) { console.error(e); }
}

// ───── start ─────
async function boot() {
  applyTheme();
  installIcons();
  const splash = h('div', { class: 'splash' },
    h('div', { class: 'box' }, h('svg', { class: 'logo', viewBox: '0 0 64 64', html: '<use href="#i-logo"/>' }), h('div', { class: 'nm' }, 'Lumen')));
  document.body.append(splash);
  const t0 = performance.now();

  const aurora = h('div', { class: 'aurora' }, h('i'), h('i'), h('i'));
  document.body.prepend(aurora);
  buildShell();

  await Promise.all([loadLibrary(), loadStats()]);
  setupDrop();
  migrateLegal();

  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (p) => {
      const files = [];
      for (const fh of p.files || []) { try { files.push(await fh.getFile()); } catch { /* ignoruj */ } }
      if (files.length) runImport(files);
    });
  }

  window.addEventListener('hashchange', route);
  await route();
  const wait = Math.max(0, 1100 - (performance.now() - t0));
  setTimeout(() => { splash.classList.add('gone'); setTimeout(() => splash.remove(), 900); }, wait);

  registerSW();
  window.addEventListener('keydown', (e) => {
    if (readerOpen) return;
    if ((e.key === 'o' || e.key === 'O') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pickFiles(); }
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Dostępna nowa wersja Lumen', { icon: 'refresh', action: { label: 'Odśwież', onClick: () => location.reload() }, ms: 12000 });
        }
      });
    });
  }).catch(() => { /* offline lub brak HTTPS */ });
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:0;z-index:999;background:#200;color:#fcc;padding:20px;overflow:auto">${String(e.stack || e)}</pre>`); });

export { lib, listDocs };
