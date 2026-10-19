/* Lumen — service worker: działanie offline, aktualizacje i przyjmowanie plików z „Udostępnij” */
const VERSION = 'lumen-v1.3.2';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const SHARE = 'lumen-share';

const PRECACHE = [
 "./",
 "css/base.css",
 "css/fonts.css",
 "css/reader.css",
 "css/views.css",
 "fonts/atkinson-hyperlegible-latin-400-italic.woff2",
 "fonts/atkinson-hyperlegible-latin-400-normal.woff2",
 "fonts/atkinson-hyperlegible-latin-700-italic.woff2",
 "fonts/atkinson-hyperlegible-latin-700-normal.woff2",
 "fonts/atkinson-hyperlegible-latin-ext-400-italic.woff2",
 "fonts/atkinson-hyperlegible-latin-ext-400-normal.woff2",
 "fonts/atkinson-hyperlegible-latin-ext-700-italic.woff2",
 "fonts/atkinson-hyperlegible-latin-ext-700-normal.woff2",
 "fonts/fraunces-latin-ext-wght-italic.woff2",
 "fonts/fraunces-latin-ext-wght-normal.woff2",
 "fonts/fraunces-latin-wght-italic.woff2",
 "fonts/fraunces-latin-wght-normal.woff2",
 "fonts/inter-latin-ext-wght-normal.woff2",
 "fonts/inter-latin-wght-normal.woff2",
 "fonts/literata-latin-ext-wght-italic.woff2",
 "fonts/literata-latin-ext-wght-normal.woff2",
 "fonts/literata-latin-wght-italic.woff2",
 "fonts/literata-latin-wght-normal.woff2",
 "index.html",
 "js/backup.js",
 "js/course.js",
 "js/db.js",
 "js/icons.js",
 "js/import/docx.js",
 "js/import/epub.js",
 "js/import/html.js",
 "js/import/importer.js",
 "js/import/loader.js",
 "js/import/pdf.js",
 "js/import/pdfjs.js",
 "js/import/structure.js",
 "js/import/text.js",
 "js/import/textbuild.js",
 "js/import/legal.js",
 "js/import/legalblocks.js",
 "js/import/columns.js",
 "js/reader/labels.js",
 "js/reader/selection.js",
 "js/views/tags.js",
 "js/views/search.js",
 "js/import/ocr.js",
 "js/views/blockpicker.js",
 "js/main.js",
 "js/polyfills.js",
 "js/reader/appearance.js",
 "js/reader/pageview.js",
 "js/reader/reader.js",
 "js/reader/render.js",
 "js/reader/tts.js",
 "js/state.js",
 "js/ui.js",
 "js/util.js",
 "js/views/detail.js",
 "js/views/home.js",
 "js/views/library.js",
 "js/views/settings.js",
 "js/views/shared.js",
 "js/views/stats.js",
 "manifest.webmanifest",
 "vendor/jszip.min.js",
 "vendor/mammoth.browser.min.js",
 "vendor/pdfjs/LICENSE",
 "vendor/pdfjs/pdf.min.mjs",
 "vendor/pdfjs/pdf.worker.min.mjs",
 "vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
 "vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
 "vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
 "vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
 "vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
 "vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
 "vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
 "vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
 "vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
 "vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
 "vendor/pdfjs/standard_fonts/LICENSE_FOXIT",
 "vendor/pdfjs/standard_fonts/LICENSE_LIBERATION",
 "vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
 "vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
 "vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
 "vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
 "vendor/pdfjs/wasm/jbig2.wasm",
 "vendor/pdfjs/wasm/openjpeg.wasm",
 "vendor/pdfjs/wasm/qcms_bg.wasm",
 "vendor/pdfjs/wasm/quickjs-eval.wasm",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-512.png",
 "icons/apple-touch-icon.png",
 "icons/favicon-32.png",
 "icons/icon.svg"
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // pojedyncze błędy nie mogą zablokować instalacji
    await Promise.all(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== SHELL && k !== RUNTIME && k !== SHARE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Udostępnianie plików do aplikacji (Web Share Target)
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const cache = await caches.open(SHARE);
        for (const k of await cache.keys()) await cache.delete(k);
        let i = 0;
        for (const f of form.getAll('files')) {
          if (!(f instanceof File)) continue;
          await cache.put(`/shared/${Date.now()}-${i++}`, new Response(f, { headers: { 'x-filename': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' } }));
        }
      } catch (err) { /* ignoruj */ }
      return Response.redirect(new URL('./#/shared', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // Nawigacja: powłoka aplikacji (działa offline)
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh.ok) cache.put(new URL('./index.html', self.registration.scope).href, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(new URL('./index.html', self.registration.scope).href)) || (await cache.match(new URL('./', self.registration.scope).href)) || Response.error();
      }
    })());
    return;
  }

  // Zasoby: najpierw pamięć podręczna, potem sieć (i dopisanie do pamięci)
  e.respondWith((async () => {
    const hit = (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(RUNTIME); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});
