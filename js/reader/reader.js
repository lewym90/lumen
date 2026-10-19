// Czytnik: rozdział jako sesja, pozycja, zakreślenia, szukanie, czytanie na głos
import { h, ic, esc, clamp, debounce, throttleRaf, uid, foldText, fmtMinutes, fmtNum, plural, downloadBlob, raf, sleep } from '../util.js';
import { db } from '../db.js';
import { settings, setSetting, bus, loadDoc, saveMeta, chapterInfo, docProgress, addReading, stats, wordsToMinutes, defaultProg } from '../state.js';
import { chapterEnd, sectionsOf, chapterOfBlock, blockWords } from '../import/structure.js';
import { chapterKicker, chapterFull, partLabel, minutesFor } from '../course.js';
import { toast, openSheet, openMenu, ring, sparkBurst, closeMenu } from '../ui.js';
import { applyReadingVars, buildAppearance } from './appearance.js';
import { chapterBodyHtml, openerHtml, textHtml, blockHtml } from './render.js';
import { openPageViewer, openFigureZoom, observeScanPages, observeFigures, releasePdf } from './pageview.js';
import { Narrator, ttsSupported, loadVoices, pickVoice } from './tts.js';

const HL_COLORS = 5;
let R = null;

// ───────────── API ─────────────
export async function openReader(meta, params = {}) {
  if (R) closeReader(true);
  const doc = await loadDoc(meta.id);
  if (!doc) { toast('Nie udało się wczytać dokumentu', { error: true }); location.hash = '#/library'; return; }
  const marks = await db.byDoc(meta.id);
  R = {
    meta, doc, marks, ci: -1, pos: { bi: 0, frac: 0 }, hits: new Map(), hitList: [], hitIdx: -1, query: '',
    urls: [], idx2el: new Map(), blockEls: [], panel: null, focus: false, chromeOff: false,
    chSec: 0, sessSec: 0, lastAct: Date.now(), lastWordPos: null, accWords: 0, accSec: 0,
    lastScrollTop: 0, narrator: null, voices: [], cleanups: [], doneThis: false, destroyed: false,
    hasPdf: meta.type === 'pdf', scanned: !!meta.scanned,
  };
  buildDom();
  meta.openedAt = Date.now();
  saveMeta(meta);

  // pozycja startowa
  const prog = meta.prog || (meta.prog = defaultProg());
  let ci = clamp(+(params.c ?? prog.ch ?? 0) || 0, 0, doc.chapters.length - 1);
  let pos = null;
  if (params.b != null) pos = { bi: +params.b, frac: 0 };
  else pos = resumeFor(ci, params.c == null);
  if (params.b != null) ci = chapterOfBlock(doc, +params.b);
  await renderChapter(ci, pos, { first: true });
  requestAnimationFrame(() => R.root.classList.add('in'));
  if (!ttsSupported) R.root.querySelector('[data-tool="listen"]')?.setAttribute('hidden', '');
}

export function reopen(meta, params = {}) {
  if (!R || R.meta.id !== meta.id) { openReader(meta, params); return; }
  if (params.c != null || params.b != null) {
    let ci = clamp(+(params.c ?? R.ci) || 0, 0, R.doc.chapters.length - 1);
    let pos = params.b != null ? { bi: +params.b, frac: 0 } : resumeFor(ci, false);
    if (params.b != null) ci = chapterOfBlock(R.doc, +params.b);
    renderChapter(ci, pos);
  }
}

export function closeReader(immediate = false) {
  if (!R) return;
  const r = R;
  saveNow();
  r.destroyed = true;
  try { r.narrator?.stop(); } catch { /* brak */ }
  r.cleanups.forEach((f) => { try { f(); } catch { /* brak */ } });
  r.urls.forEach((u) => URL.revokeObjectURL(u));
  releasePdf();
  clearInterval(r.timer);
  document.body.classList.remove('reading');
  document.querySelector('.scrim')?.remove();
  R = null;
  if (immediate) { r.root.remove(); return; }
  r.root.classList.remove('in');
  r.root.classList.add('leaving');
  setTimeout(() => r.root.remove(), 420);
  bus.emit('library');
}

function resumeFor(ci, useSaved) {
  const { meta, doc } = R;
  const prog = meta.prog;
  const ch = doc.chapters[ci];
  // lustrzana kopia pozycji w localStorage (zapis synchroniczny przy zamknięciu karty)
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('lumen.pos.' + meta.id) || 'null'); } catch { /* brak */ }
  const best = saved && saved.t > (prog.t || 0) ? saved : prog;
  if (ci === best.ch || (useSaved && best.ch != null)) {
    if (useSaved || ci === best.ch) {
      if (best.blk != null && best.blk >= ch.start && best.blk < chapterEnd(doc, ci)) return { bi: best.blk, frac: best.frac || 0 };
    }
  }
  const far = prog.far[ch.start];
  if (far != null && !prog.done[ch.start] && far > ch.start + 3) return { bi: far, frac: 0 };
  return null;
}

// ───────────── DOM ─────────────
function buildDom() {
  const { meta } = R;
  const root = h('div', { class: 'reader', 'data-theme-scope': '' });
  applyReadingVars(root);
  R.root = root;

  const tool = (name, icon, label, onClick) => h('button', { class: 'icon-btn', 'data-tool': name, 'aria-label': label, title: label, onclick: onClick, html: ic(icon) });

  const back = h('button', { class: 'icon-btn r-back', 'aria-label': 'Wróć do spisu rozdziałów', title: 'Wróć', html: ic('left'), onclick: () => { location.hash = '#/doc/' + meta.id; } });
  R.titleKick = h('div', { class: 'r-kick' });
  R.titleMain = h('div', { class: 'r-ttl' });
  R.statEl = h('div', { class: 'r-stat' });
  R.progBar = h('i');

  const top = h('header', { class: 'r-top' },
    h('div', { class: 'r-top-in' },
      back,
      h('div', { class: 'r-title', role: 'button', tabindex: 0, onclick: () => togglePanel('toc'), 'aria-label': 'Spis treści' }, R.titleKick, R.titleMain),
      R.statEl,
      h('div', { class: 'r-tools' },
        tool('search', 'search', 'Szukaj w dokumencie (/)', () => togglePanel('search')),
        tool('bookmark', 'bookmark', 'Zakładka (B)', () => toggleBookmark()),
        tool('listen', 'headphones', 'Czytaj na głos (L)', () => toggleListen()),
        tool('type', 'type', 'Wygląd tekstu (A)', () => openAppearance()),
        tool('toc', 'list', 'Spis treści (T)', () => togglePanel('toc')),
        tool('notes', 'note', 'Notatki i zakładki (N)', () => togglePanel('notes')),
        (() => { const m = h('button', { class: 'icon-btn r-more', 'aria-label': 'Więcej', html: ic('dots'), onclick: () => openMenu(m, [
          { icon: 'bookmark', label: 'Zakładka', onClick: () => toggleBookmark() },
          { icon: 'note', label: 'Notatki i zakładki', onClick: () => togglePanel('notes') },
          { icon: 'type', label: 'Wygląd tekstu', onClick: () => openAppearance() },
          { icon: 'maximize', label: 'Tryb skupienia', onClick: () => toggleFocus() },
        ]) }); return m; })())),
    h('div', { class: 'r-prog' }, R.progBar));

  R.scroll = h('main', { class: 'r-scroll', tabindex: '-1' });
  R.text = h('article', { class: 'r-text' });
  R.scroll.append(R.text);

  R.tocPanel = h('aside', { class: 'r-panel r-toc', 'aria-label': 'Spis treści' });
  R.sidePanel = h('aside', { class: 'r-panel r-side', 'aria-label': 'Panel boczny' });
  R.panelScrim = h('div', { class: 'r-pscrim', onclick: () => togglePanel(null) });

  R.bottom = h('footer', { class: 'r-bottom' },
    h('div', { class: 'rb-in' },
      h('button', { class: 'icon-btn', 'aria-label': 'Poprzedni rozdział', html: ic('skip-prev'), onclick: () => gotoChapter(R.ci - 1) }),
      h('div', { class: 'rb-mid' }, R.bStat = h('div', { class: 'rb-stat' }), h('div', { class: 'rb-bar' }, R.bBar = h('i'))),
      h('button', { class: 'icon-btn', 'aria-label': 'Następny rozdział', html: ic('skip-next'), onclick: () => gotoChapter(R.ci + 1) })));

  R.listenBar = h('div', { class: 'r-listen', hidden: true });
  R.selBar = h('div', { class: 'sel-bar', hidden: true });

  root.append(h('div', { class: 'r-bg' }), top, h('div', { class: 'r-body' }, R.tocPanel, R.scroll, R.sidePanel, R.panelScrim), R.bottom, R.listenBar, R.selBar);
  document.body.append(root);
  document.body.classList.add('reading');

  // zdarzenia
  const onScroll = throttleRaf(handleScroll);
  R.scroll.addEventListener('scroll', onScroll, { passive: true });
  R.text.addEventListener('click', onTextClick);
  R.scroll.addEventListener('pointerdown', () => { R.lastAct = Date.now(); }, { passive: true });
  document.addEventListener('keydown', onKey);
  document.addEventListener('selectionchange', onSelChange);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', saveSync);
  const onSettings = (k) => {
    if (!R) return;
    if (['font', 'size', 'lh', 'width', 'gap', 'align'].includes(k)) {
      const p = currentPos();
      applyReadingVars(R.root);
      requestAnimationFrame(() => restorePos(p));
    }
  };
  const offS = bus.on('settings', onSettings);
  R.cleanups.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('selectionchange', onSelChange); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', saveSync); offS(); });
  R.timer = setInterval(tick, 1000);
  window.addEventListener('resize', onResize);
  R.cleanups.push(() => window.removeEventListener('resize', onResize));
}

function onResize() { if (R) updateDocking(); }
function updateDocking() { /* układ obsługuje CSS */ }

// ───────────── rozdział ─────────────
async function renderChapter(ci, pos = null, { first = false } = {}) {
  if (!R) return;
  const { doc, meta } = R;
  ci = clamp(ci, 0, doc.chapters.length - 1);
  stopListen();
  if (R.ci >= 0) saveNow();
  R.urls.forEach((u) => URL.revokeObjectURL(u));
  R.urls = [];
  R.ci = ci;
  R.doneThis = false;
  R.chSec = 0;
  R.lastWordPos = null;
  const info = chapterInfo(doc, meta)[ci];
  R.info = info;
  R.alreadyDone = info.done;
  const ctx = makeCtx(ci);
  const { html, first: firstBlock, end } = chapterBodyHtml(doc, ci, ctx);
  R.firstBlock = firstBlock; R.endBlock = end;
  const nextCh = doc.chapters[ci + 1];
  R.text.innerHTML = openerHtml(doc, ci, info) + `<div class="r-blocks">${html}</div><div class="r-sentinel"></div>` + finishHtml(ci, info, nextCh);
  R.text.classList.remove('enter'); void R.text.offsetWidth; R.text.classList.add('enter');
  indexBlocks();
  loadImages();
  if (R.scanned) R.cleanups.push(observeScanPages(R.text, meta.id));
  if (R.hasPdf) R.cleanups.push(observeFigures(R.text, meta.id));
  observeEnd();
  updateTitle();
  updateTools();
  history.replaceState(null, '', `#/read/${meta.id}?c=${ci}`);
  if (R.panel === 'toc') buildToc();
  if (R.panel === 'notes') buildNotes();
  R.scroll.scrollTop = 0;
  await (document.fonts?.ready || Promise.resolve());
  if (!R) return;
  if (pos) { await raf(); restorePos(pos); }
  R.lastScrollTop = R.scroll.scrollTop;
  setChrome(true);
  handleScroll();
  if (first) R.lastWordPos = null;
  meta.prog.ch = ci;
}

function makeCtx(ci) {
  const { doc, marks } = R;
  const start = doc.chapters[ci].start;
  const end = chapterEnd(doc, ci);
  const hlByBlock = new Map();
  const bmBlocks = new Set();
  for (const m of marks) {
    if (m.b < start || m.b >= end) continue;
    if (m.kind === 'hl') { if (!hlByBlock.has(m.b)) hlByBlock.set(m.b, []); hlByBlock.get(m.b).push({ s: m.s, e: m.e, c: m.c, id: m.id, n: !!m.note }); }
    else if (m.kind === 'bm') bmBlocks.add(m.b);
  }
  return { hlByBlock, hits: R.hits, bmBlocks, hasPdf: R.hasPdf };
}

function indexBlocks() {
  R.blockEls = [...R.text.querySelectorAll('.r-blocks [data-b]')];
  R.idx2el = new Map(R.blockEls.map((el) => [+el.dataset.b, el]));
}

function finishHtml(ci, info, next) {
  const { doc } = R;
  const last = !next;
  const p = docProgress(doc, R.meta);
  return `<footer class="finish" id="finish">
    <div class="fin-badge"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="fb-ring" cx="40" cy="40" r="34" /><path class="fb-check" d="M25 41.5 35.5 52 56 30"/></svg></div>
    <h3 class="fin-h">${last ? 'To był ostatni rozdział' : 'Koniec rozdziału'}</h3>
    <p class="fin-sub" data-fin-sub>${esc(finSub(p))}</p>
    ${next ? `<button class="fin-next" data-act="next"><span class="fn-k">Następny rozdział${next.num ? ' · ' + esc(((next.kw || 'Rozdział') + ' ' + next.num)) : ''}</span><span class="fn-t">${esc(next.title)}</span><span class="fn-m">${ic('clock')} ~${fmtMinutes(minutesFor(R.doc.cw[chapterEnd(doc, ci + 1)] - R.doc.cw[next.start]))}</span><span class="fn-go">${ic('arrow-right')}</span></button>` : ''}
    <div class="fin-actions">
      <button class="btn mark-done" data-act="markdone" hidden>${ic('check-circle')} Oznacz jako przeczytany</button>
      <button class="btn ghost" data-act="rest">${ic('moon')} Kończę na dziś</button>
      ${next ? '' : `<button class="btn primary" data-act="plan">${ic('layers')} Wróć do spisu rozdziałów</button>`}
    </div>
  </footer>`;
}

function finSub(p) {
  const { doc } = R;
  const n = doc.chapters.length;
  if (p.done >= n) return 'Przeczytałeś cały dokument. Gratulacje!';
  return `Przeczytano ${p.done} z ${n} ${plural(n, 'rozdziału', 'rozdziałów', 'rozdziałów')} · ${Math.round(p.pct * 100)}% dokumentu`;
}

function updateTitle() {
  const { doc, ci } = R;
  const ch = doc.chapters[ci];
  R.titleKick.textContent = [chapterKicker(ch), partLabel(ch)].filter(Boolean).join(' · ') || `${ci + 1} z ${doc.chapters.length}`;
  R.titleMain.textContent = ch.title;
  document.title = `${ch.title} · ${R.meta.title}`;
}

function updateTools() {
  const prevBtn = R.bottom.querySelector('.icon-btn');
  prevBtn.disabled = R.ci <= 0;
  R.bottom.querySelectorAll('.icon-btn')[1].disabled = R.ci >= R.doc.chapters.length - 1;
}

export function gotoChapter(ci, b = null) {
  if (!R) return;
  if (ci < 0 || ci >= R.doc.chapters.length) { if (ci >= R.doc.chapters.length) toast('To koniec dokumentu', { icon: 'trophy' }); return; }
  if (ci === R.ci && b == null) { R.scroll.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const out = R.text;
  out.classList.add('leave');
  setTimeout(async () => {
    out.classList.remove('leave');
    if (!R) return;
    await renderChapter(ci, b != null ? { bi: b, frac: 0 } : null);
  }, 160);
}

// ───────────── pozycja i postęp ─────────────
function scrollTopLine() { return R.scroll.getBoundingClientRect().top + (R.chromeOff ? 24 : 74); }

function currentPos() {
  const els = R.blockEls;
  if (!els.length) return { bi: R.firstBlock || 0, frac: 0 };
  const y = scrollTopLine();
  let lo = 0, hi = els.length - 1, ans = els.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = els[mid].getBoundingClientRect();
    if (r.bottom > y) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  const r = els[ans].getBoundingClientRect();
  const frac = clamp((y - r.top) / Math.max(1, r.height), 0, 1);
  // jeśli jesteśmy powyżej pierwszego bloku (opener) – pozycja = początek
  if (R.scroll.scrollTop < 4) return { bi: +els[0].dataset.b, frac: 0 };
  return { bi: +els[ans].dataset.b, frac };
}

function lastVisibleBlock() {
  const els = R.blockEls;
  if (!els.length) return R.firstBlock;
  const y = R.scroll.getBoundingClientRect().bottom - 6;
  let lo = 0, hi = els.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (els[mid].getBoundingClientRect().top < y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return +els[ans].dataset.b;
}

function restorePos(pos) {
  if (!pos || !R) return;
  let el = R.idx2el.get(pos.bi);
  if (!el) {
    // najbliższy następny blok
    for (let i = pos.bi; i < R.endBlock && !el; i++) el = R.idx2el.get(i);
    if (!el) el = R.blockEls[R.blockEls.length - 1];
  }
  if (!el) return;
  const r = el.getBoundingClientRect();
  const delta = r.top + (pos.frac || 0) * r.height - scrollTopLine();
  R.scroll.scrollTop += delta;
}

function wordPos(pos) {
  const { doc } = R;
  const b = doc.blocks[pos.bi];
  return doc.cw[pos.bi] + pos.frac * (b ? blockWords(b) : 0);
}

function handleScroll() {
  if (!R || R.destroyed) return;
  const sc = R.scroll;
  R.lastAct = Date.now();
  const pos = currentPos();
  R.pos = pos;
  const { doc, meta } = R;
  const ch = doc.chapters[R.ci];
  const cStart = doc.cw[ch.start], cEnd = doc.cw[chapterEnd(doc, R.ci)];
  const wp = wordPos(pos);
  const pct = clamp((wp - cStart) / Math.max(1, cEnd - cStart), 0, 1);
  R.chPct = pct;
  R.progBar.style.transform = `scaleX(${pct})`;
  R.bBar.style.transform = `scaleX(${pct})`;
  const left = Math.max(0, cEnd - wp);
  const txt = `${Math.round(pct * 100)}%  ·  ${left < 30 ? 'prawie koniec' : '~' + fmtMinutes(wordsToMinutes(left)) + ' do końca'}`;
  R.statEl.textContent = txt;
  R.bStat.textContent = `${R.ci + 1}/${doc.chapters.length}  ·  ${txt}`;

  // dalekość czytania
  const lb = lastVisibleBlock();
  const prog = meta.prog;
  const far = Math.max(prog.far[ch.start] ?? -1, Math.min(lb, R.endBlock - 1));
  prog.far[ch.start] = far;
  prog.ch = R.ci; prog.blk = pos.bi; prog.frac = pos.frac; prog.t = Date.now();
  mirrorPos();
  saveDebounced();

  // chowanie paska przy przewijaniu
  const st = sc.scrollTop;
  const d = st - R.lastScrollTop;
  if (Math.abs(d) > 10) {
    if (!R.panel) setChrome(d < 0 || st < 80);
    R.lastScrollTop = st;
  }
  updateBookmarkIcon();
}

function setChrome(on) {
  if (!R) return;
  if (R.focus) on = false;
  R.chromeOff = !on;
  R.root.classList.toggle('chrome-off', !on);
}

const mirrorPos = throttleRaf(() => {
  if (!R) return;
  try { localStorage.setItem('lumen.pos.' + R.meta.id, JSON.stringify({ ch: R.ci, blk: R.pos.bi, frac: R.pos.frac, t: Date.now() })); } catch { /* brak */ }
});

const saveDebounced = debounce(() => saveNow(), 1400);

function saveNow() {
  if (!R || R.ci < 0) return;
  const { meta, doc } = R;
  const p = docProgress(doc, meta);
  meta.pct = p.pct;
  meta.prog.t = Date.now();
  meta.openedAt = Date.now();
  saveMeta(meta);
}

function saveSync() {
  if (!R) return;
  mirrorPos();
  try { localStorage.setItem('lumen.pos.' + R.meta.id, JSON.stringify({ ch: R.ci, blk: R.pos.bi, frac: R.pos.frac, t: Date.now() })); } catch { /* brak */ }
  saveNow();
}

function onVis() { if (document.hidden) saveSync(); }

// czas aktywnego czytania
function tick() {
  if (!R || document.hidden) return;
  const active = Date.now() - R.lastAct < 45000 || R.narrator?.state === 'playing';
  if (!active) return;
  R.chSec++; R.sessSec++; R.accSec++;
  R.meta.prog.sec = (R.meta.prog.sec || 0) + 1;
  const wp = wordPos(R.pos);
  if (R.lastWordPos == null) R.lastWordPos = wp;
  if (R.accSec >= 5) {
    const dw = wp - R.lastWordPos;
    R.lastWordPos = wp;
    const words = dw > 0 && dw < 260 ? dw : 0;
    addReading(R.accSec, words);
    R.accSec = 0;
  }
}

// ───────────── koniec rozdziału ─────────────
function observeEnd() {
  const sent = R.text.querySelector('.r-sentinel');
  const io = new IntersectionObserver((es) => {
    for (const en of es) if (en.isIntersecting) onReachEnd();
  }, { root: R.scroll, threshold: 0, rootMargin: '0px 0px -12% 0px' });
  io.observe(sent);
  R.endIO?.disconnect();
  R.endIO = io;
  R.cleanups.push(() => io.disconnect());
}

function chapterReadEnough() {
  const { doc, meta, ci, info } = R;
  const ch = doc.chapters[ci];
  const words = info.words;
  const expectSec = (words / Math.max(100, stats.wpm)) * 60;
  const farNow = meta.prog.far[ch.start] ?? -1;
  const before = doc.cw[Math.min(chapterEnd(doc, ci), Math.max(0, farNow + 1))] - doc.cw[ch.start];
  // przeszedł przez większość wg pozycji i spędził sensowny czas — lub wcześniej już prawie skończył
  return R.alreadyDone || R.chSec >= Math.min(expectSec * 0.18, 150) || (info.pct > 0.7 && R.chSec >= 8) || words < 120 || before < 0;
}

function onReachEnd() {
  if (!R || R.doneThis) return;
  const { doc, meta, ci } = R;
  const ch = doc.chapters[ci];
  const fin = R.text.querySelector('#finish');
  const markBtn = fin?.querySelector('.mark-done');
  if (chapterReadEnough()) {
    markDone(true);
  } else if (markBtn) {
    markBtn.hidden = false;
    fin.classList.add('skipped');
    fin.querySelector('.fin-h').textContent = 'Doszedłeś do końca';
    fin.querySelector('[data-fin-sub]').textContent = 'Przewinąłeś ten rozdział bardzo szybko — czy oznaczyć go jako przeczytany?';
  }
  void ch; void meta;
}

function markDone(celebrate) {
  const { doc, meta, ci } = R;
  const ch = doc.chapters[ci];
  const wasDone = !!meta.prog.done[ch.start];
  R.doneThis = true;
  meta.prog.done[ch.start] = meta.prog.done[ch.start] || Date.now();
  meta.prog.far[ch.start] = chapterEnd(doc, ci) - 1;
  const p = docProgress(doc, meta);
  meta.pct = p.pct;
  saveNow();
  const fin = R.text.querySelector('#finish');
  if (!fin) return;
  fin.classList.remove('skipped');
  fin.classList.add('done');
  fin.querySelector('.mark-done')?.setAttribute('hidden', '');
  const last = ci === doc.chapters.length - 1 || p.done >= doc.chapters.length;
  fin.querySelector('.fin-h').textContent = p.done >= doc.chapters.length ? 'Dokument przeczytany!' : 'Rozdział przeczytany';
  fin.querySelector('[data-fin-sub]').textContent = finSub(p);
  if (celebrate && !wasDone) {
    sparkBurst(fin.querySelector('.fin-badge'), p.done >= doc.chapters.length ? 46 : 26);
    if (navigator.vibrate) try { navigator.vibrate(18); } catch { /* brak */ }
  }
  void last;
  if (R.panel === 'toc') buildToc();
}

// ───────────── obrazy ─────────────
async function loadImages() {
  const imgs = [...R.text.querySelectorAll('img[data-a]')];
  for (const img of imgs) {
    try {
      const blob = await db.get('assets', `${R.meta.id}/${img.dataset.a}`);
      if (!blob || !R) continue;
      const url = URL.createObjectURL(blob);
      R.urls.push(url);
      img.src = url;
    } catch { /* brak */ }
  }
}

// ───────────── zdarzenia tekstu ─────────────
function onTextClick(e) {
  const t = e.target;
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'next') gotoChapter(R.ci + 1);
    else if (a === 'rest') { saveNow(); location.hash = '#/'; }
    else if (a === 'plan') { location.hash = '#/doc/' + R.meta.id; }
    else if (a === 'markdone') markDone(true);
    else if (a === 'page') openPageViewer(R.meta, +act.dataset.pg, R.meta.pages);
    else if (a === 'goto') scrollToBlock(+act.dataset.b, true);
    return;
  }
  const fz = t.closest('.figpdf');
  if (fz) { openFigureZoom(R.meta, fz); return; }
  const hl = t.closest('.hl');
  if (hl && getSelection().isCollapsed) { openHighlight(hl.dataset.h); return; }
  // dotknięcie w tekst: pokaż/ukryj pasek (telefon)
  if (getSelection().isCollapsed && matchMedia('(hover: none)').matches && !t.closest('a,button,table')) setChrome(R.chromeOff);
}

function scrollToBlock(bi, smooth = false, flash = true) {
  const el = R.idx2el.get(bi);
  if (!el) return;
  const delta = el.getBoundingClientRect().top - scrollTopLine();
  R.scroll.scrollTo({ top: R.scroll.scrollTop + delta, behavior: smooth ? 'smooth' : 'auto' });
  if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }
}

function onKey(e) {
  if (!R) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) { if (e.key === 'Escape') { e.target.blur(); } return; }
  if (e.ctrlKey || e.metaKey || e.altKey) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); togglePanel('search', true); } return; }
  if (document.querySelector('.scrim')) return;
  switch (e.key) {
    case 'Escape': if (R.panel) togglePanel(null); else if (R.focus) toggleFocus(); else location.hash = '#/doc/' + R.meta.id; break;
    case '[': gotoChapter(R.ci - 1); break;
    case ']': gotoChapter(R.ci + 1); break;
    case 't': case 'T': togglePanel('toc'); break;
    case 'n': case 'N': togglePanel('notes'); break;
    case '/': e.preventDefault(); togglePanel('search', true); break;
    case 'a': case 'A': openAppearance(); break;
    case 'l': case 'L': toggleListen(); break;
    case 'f': case 'F': toggleFocus(); break;
    case 'b': case 'B': toggleBookmark(); break;
    case ' ': if (!e.shiftKey && !R.panel) { e.preventDefault(); R.scroll.scrollBy({ top: R.scroll.clientHeight * 0.85, behavior: 'smooth' }); } break;
    case 'ArrowDown': R.scroll.scrollBy({ top: 70, behavior: 'smooth' }); break;
    case 'ArrowUp': R.scroll.scrollBy({ top: -70, behavior: 'smooth' }); break;
    default: break;
  }
}

function toggleFocus() {
  R.focus = !R.focus;
  R.root.classList.toggle('focus', R.focus);
  setChrome(!R.focus);
  toast(R.focus ? 'Tryb skupienia · Esc lub F, aby wyjść' : 'Tryb skupienia wyłączony', { icon: R.focus ? 'minimize' : 'maximize', ms: 2200 });
}

// ───────────── panele ─────────────
function togglePanel(name, focusInput = false) {
  if (!R) return;
  const was = R.panel;
  R.panel = was === name ? null : name;
  R.root.classList.toggle('p-toc', R.panel === 'toc');
  R.root.classList.toggle('p-side', R.panel === 'notes' || R.panel === 'search');
  R.root.classList.toggle('has-panel', !!R.panel);
  ['toc', 'notes', 'search'].forEach((n) => R.root.querySelector(`[data-tool="${n}"]`)?.classList.toggle('on', R.panel === n));
  if (R.panel === 'toc') buildToc();
  if (R.panel === 'notes') buildNotes();
  if (R.panel === 'search') buildSearch(focusInput);
  if (!R.panel && was === 'search') clearSearch();
  if (R.panel) setChrome(true);
}

function buildToc() {
  const { doc, meta, ci } = R;
  const infos = chapterInfo(doc, meta);
  const p = docProgress(doc, meta);
  const head = h('div', { class: 'pn-head' },
    ring({ size: 46, stroke: 5, pct: p.pct, inner: h('span', { class: 'pr-n' }, Math.round(p.pct * 100) + '%') }),
    h('div', { class: 'pn-ht' }, h('b', {}, meta.title), h('small', {}, `${p.done} z ${doc.chapters.length} rozdziałów`)),
    h('button', { class: 'icon-btn', 'aria-label': 'Zamknij', html: ic('close'), onclick: () => togglePanel(null) }));
  const list = h('div', { class: 'toc-list' });
  let lastPart = null;
  infos.forEach((x, i) => {
    const part = x.c.part || '';
    if (part !== lastPart) { lastPart = part; if (part) list.append(h('div', { class: 'toc-part' }, partLabel(x.c))); }
    const state = x.done ? 'done' : x.started ? 'prog' : 'todo';
    const cur = i === ci;
    const row = h('button', { class: `toc-row state-${state}` + (cur ? ' cur' : ''), onclick: () => { gotoChapter(i); if (innerWidth < 1100) togglePanel(null); } },
      h('span', { class: 'toc-ind', html: state === 'done' ? ic('check') : '' }, state === 'done' ? null : h('i', {}, x.c.num || i + 1)),
      h('span', { class: 'toc-t' }, x.c.title, h('small', {}, `~${fmtMinutes(minutesFor(x.words))}` + (state === 'prog' ? ` · ${Math.round(x.pct * 100)}%` : ''))));
    list.append(row);
    if (cur) {
      const secs = sectionsOf(doc, i);
      if (secs.length) list.append(h('div', { class: 'toc-secs' }, secs.map((s) => h('button', { class: 'toc-sec l' + s.level, onclick: () => { scrollToBlock(s.block, true); if (innerWidth < 1100) togglePanel(null); } }, s.title))));
    }
  });
  R.tocPanel.replaceChildren(head, list);
  requestAnimationFrame(() => list.querySelector('.cur')?.scrollIntoView({ block: 'center' }));
}

function marksSorted(kind) {
  return R.marks.filter((m) => m.kind === kind).sort((a, b) => (a.b - b.b) || ((a.s || 0) - (b.s || 0)));
}

function buildNotes() {
  const { doc } = R;
  let tab = R.notesTab || 'hl';
  const head = h('div', { class: 'pn-head' },
    h('div', { class: 'pn-ht' }, h('b', {}, 'Notatki i zakładki'), h('small', {}, 'Twoje zakreślenia z całego dokumentu')),
    h('button', { class: 'icon-btn', 'aria-label': 'Eksportuj notatki', title: 'Eksportuj do Markdown', html: ic('download'), onclick: exportNotes }),
    h('button', { class: 'icon-btn', 'aria-label': 'Zamknij', html: ic('close'), onclick: () => togglePanel(null) }));
  const tabs = h('div', { class: 'seg pn-tabs' });
  const body = h('div', { class: 'pn-list' });
  const paint = () => {
    tabs.replaceChildren(...[['hl', 'Zakreślenia'], ['bm', 'Zakładki']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; R.notesTab = k; paint(); } }, l, h('i', {}, marksSorted(k).length))));
    const items = marksSorted(tab);
    body.replaceChildren();
    if (!items.length) {
      body.append(h('div', { class: 'pn-empty' }, h('span', { html: ic(tab === 'hl' ? 'highlighter' : 'bookmark') }), h('p', {}, tab === 'hl' ? 'Zaznacz fragment tekstu, aby go zakreślić lub dodać notatkę.' : 'Dotknij ikony zakładki (B), aby zapamiętać miejsce.')));
      return;
    }
    let lastCh = -1;
    for (const m of items) {
      const ci = chapterOfBlock(doc, m.b);
      if (ci !== lastCh) { lastCh = ci; body.append(h('div', { class: 'pn-ch' }, doc.chapters[ci].title)); }
      if (m.kind === 'hl') {
        body.append(h('div', { class: 'pn-item' },
          h('button', { class: 'pn-q hc' + m.c, onclick: () => { jumpTo(m.b); } }, h('span', { class: 'qdot' }), h('span', { class: 'qt' }, m.text)),
          m.note ? h('div', { class: 'pn-note' }, m.note) : null,
          h('div', { class: 'pn-act' },
            h('button', { class: 'icon-btn sm', 'aria-label': 'Edytuj', html: ic('edit'), onclick: () => openHighlight(m.id) }),
            h('button', { class: 'icon-btn sm', 'aria-label': 'Usuń', html: ic('trash'), onclick: async () => { await removeMark(m.id); paint(); } }))));
      } else {
        body.append(h('div', { class: 'pn-item bmk' },
          h('button', { class: 'pn-q', onclick: () => jumpTo(m.b) }, h('span', { class: 'qic', html: ic('bookmark-fill') }), h('span', { class: 'qt' }, m.text || 'Zakładka')),
          h('div', { class: 'pn-act' }, h('button', { class: 'icon-btn sm', 'aria-label': 'Usuń', html: ic('trash'), onclick: async () => { await removeMark(m.id); paint(); } }))));
      }
    }
  };
  paint();
  R.sidePanel.replaceChildren(head, tabs, body);
}

function jumpTo(bi) {
  const ci = chapterOfBlock(R.doc, bi);
  if (innerWidth < 1100) togglePanel(null);
  if (ci !== R.ci) gotoChapter(ci, bi);
  else scrollToBlock(bi, true);
}

function exportNotes() {
  const { doc, meta } = R;
  let md = `# Notatki — ${meta.title}\n\n`;
  let lastCh = -1;
  const all = R.marks.filter((m) => m.kind === 'hl' || m.kind === 'bm').sort((a, b) => a.b - b.b || (a.s || 0) - (b.s || 0));
  for (const m of all) {
    const ci = chapterOfBlock(doc, m.b);
    if (ci !== lastCh) { lastCh = ci; md += `\n## ${doc.chapters[ci].title}\n\n`; }
    if (m.kind === 'hl') md += `> ${m.text}\n${m.note ? `\n${m.note}\n` : ''}\n`;
    else md += `- 🔖 ${m.text || 'Zakładka'}\n`;
  }
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `notatki-${meta.title.slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-')}.md`);
  toast('Zapisano notatki jako Markdown', { icon: 'download' });
}

// ───────────── wyszukiwanie ─────────────
function foldedBlocks() {
  const { doc } = R;
  if (!doc._folded) doc._folded = doc.blocks.map((b) => (b.t === 'table' ? foldText((b.rows || []).flat().join(' · ')) : b.x ? foldText(b.x) : ''));
  return doc._folded;
}

function runSearch(q) {
  const { doc } = R;
  R.query = q;
  R.hits = new Map();
  R.hitList = [];
  R.hitIdx = -1;
  const fq = foldText(q.trim());
  if (fq.length >= 2) {
    const f = foldedBlocks();
    outer: for (let i = 0; i < f.length; i++) {
      const t = f[i];
      if (!t) continue;
      let from = 0, k;
      while ((k = t.indexOf(fq, from)) >= 0) {
        R.hitList.push({ b: i, s: k, e: k + fq.length });
        if (doc.blocks[i].t !== 'table') { if (!R.hits.has(i)) R.hits.set(i, []); R.hits.get(i).push([k, k + fq.length, false]); }
        from = k + fq.length;
        if (R.hitList.length >= 600) break outer;
      }
    }
  }
}

function rerenderBlocks(indices) {
  for (const bi of indices) rerenderBlock(bi);
}

function rerenderBlock(bi) {
  const el = R.idx2el.get(bi);
  if (!el) return;
  const b = R.doc.blocks[bi];
  if (!b || !b.x) return;
  const t = el.matches('[data-t]') ? el : el.querySelector('[data-t]');
  if (!t) return;
  const hls = R.marks.filter((m) => m.kind === 'hl' && m.b === bi).map((m) => ({ s: m.s, e: m.e, c: m.c, id: m.id, n: !!m.note }));
  t.innerHTML = textHtml(b.x, b.m, hls, R.hits.get(bi));
}

function applyHitsToView(prevKeys) {
  const keys = new Set([...(prevKeys || []), ...R.hits.keys()]);
  const inChapter = [...keys].filter((i) => R.idx2el.has(i));
  rerenderBlocks(inChapter);
}

function clearSearch() {
  const prev = [...R.hits.keys()];
  R.hits = new Map(); R.hitList = []; R.hitIdx = -1; R.query = '';
  applyHitsToView(prev);
}

function buildSearch(focus) {
  const { doc } = R;
  const input = h('input', { class: 'field', type: 'search', placeholder: 'Szukaj w całym dokumencie…', value: R.query, 'aria-label': 'Szukaj w dokumencie' });
  const info = h('div', { class: 'sr-info dim' });
  const list = h('div', { class: 'sr-list' });
  const head = h('div', { class: 'pn-head' },
    h('div', { class: 'pn-ht' }, h('b', {}, 'Szukaj')),
    h('button', { class: 'icon-btn', 'aria-label': 'Poprzedni wynik', html: ic('up'), onclick: () => step(-1) }),
    h('button', { class: 'icon-btn', 'aria-label': 'Następny wynik', html: ic('down'), onclick: () => step(1) }),
    h('button', { class: 'icon-btn', 'aria-label': 'Zamknij', html: ic('close'), onclick: () => togglePanel(null) }));

  const paintList = () => {
    list.replaceChildren();
    const n = R.hitList.length;
    info.textContent = !R.query.trim() ? '' : n ? `${n >= 600 ? '600+' : n} ${plural(n, 'wynik', 'wyniki', 'wyników')}` : 'Brak wyników';
    let lastCh = -1;
    const shown = R.hitList.slice(0, 200);
    shown.forEach((hit, idx) => {
      const ci = chapterOfBlock(doc, hit.b);
      if (ci !== lastCh) { lastCh = ci; list.append(h('div', { class: 'pn-ch' }, doc.chapters[ci].title)); }
      const b = doc.blocks[hit.b];
      const text = b.x || (b.rows ? b.rows.flat().join(' · ') : '');
      const a = Math.max(0, hit.s - 40), e = Math.min(text.length, hit.e + 70);
      const snippet = (a > 0 ? '…' : '') + esc(text.slice(a, hit.s)) + '<mark>' + esc(text.slice(hit.s, hit.e)) + '</mark>' + esc(text.slice(hit.e, e)) + (e < text.length ? '…' : '');
      list.append(h('button', { class: 'sr-item' + (idx === R.hitIdx ? ' cur' : ''), 'data-i': idx, onclick: () => goHit(idx), html: snippet }));
    });
  };

  const step = (d) => { if (!R.hitList.length) return; goHit(((R.hitIdx < 0 ? (d > 0 ? -1 : 0) : R.hitIdx) + d + R.hitList.length) % R.hitList.length); };
  const goHit = (idx) => {
    R.hitIdx = idx;
    const hit = R.hitList[idx];
    const ci = chapterOfBlock(doc, hit.b);
    // oznacz bieżące trafienie
    R.hits.forEach((arr) => arr.forEach((x) => { x[2] = false; }));
    const arr = R.hits.get(hit.b);
    if (arr) { const m = arr.find((x) => x[0] === hit.s); if (m) m[2] = true; }
    const go = async () => {
      if (ci !== R.ci) await renderChapter(ci, { bi: hit.b, frac: 0 });
      else { applyHitsToView(); }
      scrollToBlock(hit.b, true, false);
      list.querySelectorAll('.sr-item').forEach((el) => el.classList.toggle('cur', +el.dataset.i === idx));
      list.querySelector('.sr-item.cur')?.scrollIntoView({ block: 'nearest' });
      if (innerWidth < 1100) { R.root.classList.remove('has-panel'); R.root.classList.remove('p-side'); R.panel = null; R.root.querySelector('[data-tool="search"]')?.classList.remove('on'); }
    };
    go();
  };

  const run = debounce(() => {
    const prev = [...R.hits.keys()];
    runSearch(input.value);
    applyHitsToView(prev);
    paintList();
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } });
  R.sidePanel.replaceChildren(head, h('div', { class: 'sr-box' }, input, info), list);
  paintList();
  if (focus) setTimeout(() => { input.focus(); input.select(); }, 280);
}

// ───────────── zakreślenia, notatki, zakładki ─────────────
function offsetWithin(root, node, off) {
  const r = document.createRange();
  r.selectNodeContents(root);
  try { r.setEnd(node, off); } catch { return 0; }
  return r.toString().length;
}

function textRoot(el) { return el.matches('[data-t]') ? el : el.querySelector('[data-t]'); }

function selectionPieces() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  if (!R.text.contains(range.commonAncestorContainer)) return [];
  const out = [];
  for (const el of R.blockEls) {
    const tr = textRoot(el);
    if (!tr) continue;
    if (!range.intersectsNode(tr)) continue;
    const b = +el.dataset.b;
    const len = tr.textContent.length;
    const s = tr.contains(range.startContainer) ? offsetWithin(tr, range.startContainer, range.startOffset) : 0;
    const e = tr.contains(range.endContainer) ? offsetWithin(tr, range.endContainer, range.endOffset) : len;
    if (e - s >= 1) out.push({ b, s: Math.max(0, s), e: Math.min(len, e) });
  }
  return out;
}

async function addHighlights(color, withNote = false) {
  const pieces = selectionPieces();
  if (!pieces.length) return;
  const gid = uid();
  const created = [];
  pieces.forEach((p, k) => {
    const b = R.doc.blocks[p.b];
    const text = (b.x || '').slice(p.s, p.e).replace(/\s+/g, ' ').trim();
    if (!text) return;
    const m = { id: uid(), doc: R.meta.id, kind: 'hl', b: p.b, s: p.s, e: p.e, c: color, note: '', text: pieces.length > 1 ? text : text, g: gid, t: Date.now(), first: k === 0 };
    created.push(m);
  });
  if (!created.length) return;
  for (const m of created) { R.marks.push(m); await db.put('marks', m); }
  getSelection().removeAllRanges();
  hideSelBar();
  rerenderBlocks(created.map((m) => m.b));
  if (withNote) openHighlight(created[0].id);
  if (R.panel === 'notes') buildNotes();
}

async function removeMark(id) {
  const m = R.marks.find((x) => x.id === id);
  if (!m) return;
  R.marks = R.marks.filter((x) => x.id !== id);
  await db.del('marks', id);
  if (m.kind === 'hl') rerenderBlock(m.b);
  else { R.idx2el.get(m.b)?.classList.remove('bm'); updateBookmarkIcon(); }
}

function openHighlight(id) {
  const m = R.marks.find((x) => x.id === id);
  if (!m) return;
  const ta = h('textarea', { class: 'field note-ta', rows: 4, placeholder: 'Twoja notatka do tego fragmentu…', 'aria-label': 'Notatka' });
  ta.value = m.note || '';
  const colors = h('div', { class: 'hl-colors' });
  const paintC = () => colors.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === m.c));
  for (let i = 0; i < HL_COLORS; i++) colors.append(h('button', { class: 'hl-dot c' + i, 'aria-label': 'Kolor ' + (i + 1), onclick: async () => { m.c = i; await db.put('marks', m); rerenderBlock(m.b); paintC(); } }));
  paintC();
  const body = h('div', { class: 'hl-edit' },
    h('blockquote', { class: 'hl-quote hc' + m.c }, m.text),
    colors, ta,
    h('div', { class: 'hl-actions' },
      h('button', { class: 'btn danger', onclick: async () => { await removeMark(m.id); s.close(); if (R?.panel === 'notes') buildNotes(); } }, h('span', { html: ic('trash') }), 'Usuń'),
      h('button', { class: 'btn primary', onclick: async () => { m.note = ta.value.trim(); await db.put('marks', m); rerenderBlock(m.b); s.close(); if (R?.panel === 'notes') buildNotes(); } }, 'Zapisz')));
  const s = openSheet({ title: 'Zakreślenie', body });
  setTimeout(() => ta.focus(), 400);
}

function visibleBookmark() {
  const a = R.pos.bi, b = lastVisibleBlock();
  return R.marks.find((m) => m.kind === 'bm' && m.b >= a && m.b <= b);
}

function updateBookmarkIcon() {
  const btn = R.root.querySelector('[data-tool="bookmark"]');
  if (!btn) return;
  const on = !!visibleBookmark();
  btn.classList.toggle('on', on);
  btn.innerHTML = ic(on ? 'bookmark-fill' : 'bookmark');
}

async function toggleBookmark() {
  const ex = visibleBookmark();
  if (ex) { await removeMark(ex.id); toast('Zakładka usunięta', { icon: 'bookmark', ms: 1800 }); updateBookmarkIcon(); if (R.panel === 'notes') buildNotes(); return; }
  const bi = R.pos.bi;
  const b = R.doc.blocks[bi];
  const m = { id: uid(), doc: R.meta.id, kind: 'bm', b: bi, c: 0, text: ((b && b.x) || R.doc.chapters[R.ci].title).slice(0, 90), t: Date.now() };
  R.marks.push(m);
  await db.put('marks', m);
  R.idx2el.get(bi)?.classList.add('bm');
  updateBookmarkIcon();
  toast('Zakładka dodana', { icon: 'bookmark-fill', ms: 1800 });
  if (R.panel === 'notes') buildNotes();
}

// pasek zaznaczenia
let selTimer = null;
function onSelChange() {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    if (!R) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !R.text.contains(sel.anchorNode)) { hideSelBar(); return; }
    showSelBar(sel.getRangeAt(0));
  }, 140);
}

function hideSelBar() { if (R) R.selBar.hidden = true; }

function showSelBar(range) {
  const bar = R.selBar;
  const prev = (e) => e.preventDefault();
  bar.replaceChildren(
    ...Array.from({ length: HL_COLORS }, (_, i) => h('button', { class: 'hl-dot c' + i, 'aria-label': 'Zakreśl kolorem ' + (i + 1), onpointerdown: prev, onclick: () => addHighlights(i) })),
    h('span', { class: 'sb-sep' }),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Dodaj notatkę', title: 'Notatka', onpointerdown: prev, onclick: () => addHighlights(0, true), html: ic('note') }),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Kopiuj', title: 'Kopiuj', onpointerdown: prev, onclick: async () => { try { await navigator.clipboard.writeText(getSelection().toString()); toast('Skopiowano', { icon: 'copy', ms: 1400 }); } catch { /* brak */ } }, html: ic('copy') }));
  bar.hidden = false;
  const rect = range.getBoundingClientRect();
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let x = rect.left + rect.width / 2 - bw / 2;
  x = clamp(x, 10, innerWidth - bw - 10);
  const touch = matchMedia('(hover: none)').matches;
  let y = touch ? rect.bottom + 14 : rect.top - bh - 10;
  if (y < 70) y = rect.bottom + 12;
  if (y + bh > innerHeight - 10) y = Math.max(70, rect.top - bh - 12);
  bar.style.left = x + 'px';
  bar.style.top = y + 'px';
}

// ───────────── wygląd ─────────────
function openAppearance() {
  const body = buildAppearance({ showTheme: true, showPreview: false });
  const s = openSheet({ title: 'Wygląd tekstu', body, className: 'ap-sheet' });
  void s;
}

// ───────────── czytanie na głos ─────────────
function isSpeakable(i) {
  const b = R.doc.blocks[i];
  return !!b && !!b.x && ['p', 'li', 'h', 'quote'].includes(b.t);
}

function ensureNarrator() {
  if (R.narrator) return R.narrator;
  const n = new Narrator({
    isSpeakable, text: (i) => R.doc.blocks[i].x,
    onBlock: (i) => {
      R.root.querySelectorAll('.speaking').forEach((e) => e.classList.remove('speaking'));
      const el = R.idx2el.get(i);
      if (el) {
        el.classList.add('speaking');
        const r = el.getBoundingClientRect();
        const scr = R.scroll.getBoundingClientRect();
        if (r.top < scr.top + 80 || r.bottom > scr.bottom - 120) scrollToBlock(i, true, false);
      }
    },
    onSentence: (i, s, e) => highlightSentence(i, s, e),
    onState: (st) => { paintListen(st); },
    onFinish: () => { toast('Koniec rozdziału', { icon: 'headphones', ms: 2000 }); R.root.querySelectorAll('.speaking').forEach((x) => x.classList.remove('speaking')); },
  });
  R.narrator = n;
  loadVoices().then((v) => { R.voices = v; n.voice = pickVoice(v, settings.ttsVoice); });
  n.rate = settings.ttsRate;
  return n;
}

function rangeFor(el, s, e) {
  const tr = textRoot(el);
  if (!tr) return null;
  const walker = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
  let pos = 0, node, startN = null, startO = 0, endN = null, endO = 0;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (!startN && s < pos + len) { startN = node; startO = s - pos; }
    if (e <= pos + len) { endN = node; endO = e - pos; break; }
    pos += len;
  }
  if (!startN) return null;
  if (!endN) { endN = startN; endO = startN.nodeValue.length; }
  const r = document.createRange();
  try { r.setStart(startN, startO); r.setEnd(endN, endO); } catch { return null; }
  return r;
}

function highlightSentence(i, s, e) {
  if (!('highlights' in CSS)) return;
  if (i < 0) { CSS.highlights.delete('tts'); return; }
  const el = R.idx2el.get(i);
  const r = el && rangeFor(el, s, e);
  if (r) CSS.highlights.set('tts', new Highlight(r)); else CSS.highlights.delete('tts');
}

function paintListen(st) {
  const bar = R.listenBar;
  const btn = R.root.querySelector('[data-tool="listen"]');
  btn?.classList.toggle('on', st !== 'idle');
  if (st === 'idle') { bar.hidden = true; bar.replaceChildren(); R.root.classList.remove('listening'); return; }
  R.root.classList.add('listening');
  bar.hidden = false;
  const n = R.narrator;
  const rates = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const rateBtn = h('button', { class: 'btn sm rate', onclick: () => { const k = rates.indexOf(n.rate); const nr = rates[(k + 1) % rates.length] ?? 1; n.setRate(nr); setSetting('ttsRate', nr); rateBtn.textContent = nr.toString().replace('.', ',') + '×'; } }, n.rate.toString().replace('.', ',') + '×');
  const voiceBtn = h('button', { class: 'icon-btn sm', 'aria-label': 'Wybierz głos', title: 'Głos', html: ic('volume'), onclick: () => {
    const pl = R.voices.filter((v) => v.lang.toLowerCase().startsWith('pl'));
    const list = (pl.length ? pl : R.voices).slice(0, 14);
    if (!list.length) { toast('Brak dostępnych głosów w tym urządzeniu', { error: true }); return; }
    openMenu(voiceBtn, list.map((v) => ({ icon: n.voice === v ? 'check' : 'volume', label: `${v.name.replace(/Microsoft |Google /g, '')} (${v.lang})`, onClick: () => { n.setVoice(v); setSetting('ttsVoice', v.voiceURI); } })), { align: 'left' });
  } });
  bar.replaceChildren(h('div', { class: 'rl-in' },
    h('button', { class: 'icon-btn', 'aria-label': 'Poprzedni akapit', html: ic('skip-prev'), onclick: () => n.skip(-1) }),
    h('button', { class: 'rl-play', 'aria-label': st === 'playing' ? 'Pauza' : 'Wznów', html: ic(st === 'playing' ? 'pause-fill' : 'play-fill'), onclick: () => (st === 'playing' ? n.pause() : n.resume()) }),
    h('button', { class: 'icon-btn', 'aria-label': 'Następny akapit', html: ic('skip-next'), onclick: () => n.skip(1) }),
    rateBtn, voiceBtn,
    h('button', { class: 'icon-btn', 'aria-label': 'Zakończ czytanie', html: ic('close'), onclick: () => n.stop() })));
}

function toggleListen() {
  if (!ttsSupported) { toast('Ta przeglądarka nie obsługuje czytania na głos', { error: true }); return; }
  if (R.scanned) { toast('Czytanie na głos nie działa dla skanów bez tekstu', { error: true }); return; }
  const n = ensureNarrator();
  if (n.state === 'idle') n.start(R.pos.bi, R.endBlock);
  else if (n.state === 'playing') n.pause();
  else n.resume();
}

function stopListen() { try { R?.narrator?.stop(); } catch { /* brak */ } }

export { closeMenu, sleep, fmtNum, chapterFull };
