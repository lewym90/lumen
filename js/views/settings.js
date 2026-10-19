// Ustawienia: wygląd, cele, dane, instalacja
import { h, ic, fmtNum } from '../util.js';
import { settings, setSetting, listDocs, stats } from '../state.js';
import { toast, confirmDialog } from '../ui.js';
import { buildAppearance } from '../reader/appearance.js';
import { exportBackup, importBackup } from '../backup.js';
import { requestPersistence, storageEstimate } from '../db.js';

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function section(title, icon, ...kids) {
  return h('section', { class: 'card set-sec' }, h('div', { class: 'set-h' }, h('span', { class: 'set-ic', html: ic(icon) }), h('h3', {}, title)), ...kids);
}

export async function mount(root) {
  const page = h('div', { class: 'page settings' });
  root.append(page);

  // cel dnia
  const goalOut = h('output', {}, settings.goalMin + ' min');
  const goalIn = h('input', { type: 'range', min: 5, max: 180, step: 5, value: settings.goalMin, 'aria-label': 'Cel dzienny', oninput: (e) => { setSetting('goalMin', +e.target.value); goalOut.textContent = e.target.value + ' min'; paint(); } });
  const paint = () => goalIn.style.setProperty('--p', ((goalIn.value - 5) / 175) * 100 + '%');
  paint();

  const motionToggle = h('button', { class: 'switch' + (settings.motion === 'reduce' ? ' on' : ''), role: 'switch', 'aria-checked': settings.motion === 'reduce', onclick: (e) => {
    const on = settings.motion !== 'reduce';
    setSetting('motion', on ? 'reduce' : 'auto');
    e.currentTarget.classList.toggle('on', on); e.currentTarget.setAttribute('aria-checked', on);
  } }, h('i'));

  // dane
  const storageLine = h('div', { class: 'dim sm' }, 'Obliczam zajęte miejsce…');
  storageEstimate().then((e) => { if (e) storageLine.textContent = `Zajęte miejsce: ${(e.usage / 1048576).toFixed(1).replace('.', ',')} MB z dostępnych ${(e.quota / 1073741824).toFixed(1).replace('.', ',')} GB.`; else storageLine.textContent = ''; });
  const impInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const r = await importBackup(f); toast(`Wczytano kopię: ${r.applied} dokumentów zaktualizowano${r.pending ? `, ${r.pending} czeka na dodanie pliku` : ''}.`, { ms: 6000 }); } catch (err) { toast(err.message, { error: true }); }
  } });

  const installBtn = h('button', { class: 'btn primary', onclick: async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; render(); }
  } }, h('span', { html: ic('smartphone') }), 'Zainstaluj aplikację');

  const installBody = () => {
    if (isStandalone()) return h('p', { class: 'muted' }, 'Lumen działa jako zainstalowana aplikacja. Pliki i postęp zostają na tym urządzeniu.');
    if (deferredPrompt) return h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Dodaj Lumen do ekranu głównego, aby otwierał się jak zwykła aplikacja — na pełnym ekranie i bez internetu.'), installBtn);
    if (isIOS()) return h('p', { class: 'muted' }, 'Na iPhonie i iPadzie: otwórz tę stronę w Safari, dotknij ', h('b', {}, 'Udostępnij'), ' (kwadrat ze strzałką), a potem ', h('b', {}, 'Do ekranu początkowego'), '.');
    return h('p', { class: 'muted' }, 'W menu przeglądarki wybierz „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”. Lumen otworzy się wtedy jak zwykła aplikacja.');
  };

  const render = () => {
    page.replaceChildren(
      h('header', { class: 'page-head' }, h('div', {}, h('div', { class: 'kicker' }, 'Dopasuj Lumen do siebie'), h('h1', { class: 'display big' }, 'Ustawienia'))),
      h('div', { class: 'set-grid' },
        h('div', { class: 'set-col' },
          section('Wygląd i czytanie', 'sparkle', buildAppearance({ showTheme: true, showPreview: true }),
            h('div', { class: 'ap-row sw-row' }, h('label', {}, 'Ogranicz animacje'), motionToggle)),
        ),
        h('div', { class: 'set-col' },
          section('Cel dzienny', 'target', h('p', { class: 'muted' }, 'Ile minut dziennie chcesz czytać? Pierścień na pulpicie zapełnia się, gdy go osiągniesz.'),
            h('div', { class: 'ap-row' }, h('label', {}, 'Minuty dziennie'), h('div', { class: 'ap-slide' }, goalIn, goalOut))),
          section('Instalacja', 'smartphone', installBody()),
          section('Dane i prywatność', 'shield',
            h('p', { class: 'muted' }, 'Wszystkie dokumenty, notatki i postępy są zapisane wyłącznie w tej przeglądarce. Nic nie jest wysyłane na żaden serwer.'),
            storageLine,
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn', onclick: async () => { const ok = await requestPersistence(); toast(ok ? 'Pamięć oznaczona jako trwała' : 'Przeglądarka nie potwierdziła trwałej pamięci', { icon: ok ? 'shield' : 'info' }); } }, h('span', { html: ic('shield') }), 'Chroń dane przed czyszczeniem'),
              h('button', { class: 'btn', onclick: async () => { const n = await exportBackup(); toast(`Zapisano kopię (${n} dokumentów)`, { icon: 'download' }); } }, h('span', { html: ic('download') }), 'Eksportuj postęp i notatki'),
              h('button', { class: 'btn', onclick: () => impInput.click() }, h('span', { html: ic('upload') }), 'Wczytaj kopię'),
              impInput),
            h('p', { class: 'dim sm' }, 'Kopia zawiera postęp, zakreślenia i notatki, ale nie same pliki. Po dodaniu tego samego dokumentu na drugim urządzeniu postęp wróci automatycznie.')),
          section('Skróty klawiaturowe', 'keyboard',
            h('div', { class: 'keys' }, [
              ['[  ]', 'poprzedni / następny rozdział'], ['T', 'spis treści'], ['N', 'notatki i zakładki'], ['/', 'szukaj w dokumencie'],
              ['A', 'wygląd tekstu'], ['L', 'czytaj na głos'], ['F', 'tryb skupienia'], ['B', 'zakładka'], ['Esc', 'zamknij panel / wyjdź'],
            ].map(([k, d]) => h('div', { class: 'key-row' }, h('kbd', {}, k), h('span', {}, d))))),
          h('div', { class: 'about dim' }, h('svg', { class: 'logo', viewBox: '0 0 64 64', width: 34, height: 34, html: '<use href="#i-logo"/>' }), h('div', {}, h('b', {}, 'Lumen 1.0'), h('div', {}, 'Czytnik dokumentów i książek · działa offline'))))));
  };
  render();
  void listDocs; void stats; void fmtNum; void confirmDialog;
}
