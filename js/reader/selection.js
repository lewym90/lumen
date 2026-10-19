// Własne zaznaczanie tekstu na ekranach dotykowych (zamiast systemowego paska iOS/Android):
// długie przytrzymanie zaznacza słowo, przeciągnięcie palcem rozszerza je, uchwyty pozwalają poprawić początek i koniec
// z lupą (powiększony fragment tekstu nad palcem). Zakreślenia i notatki używają tych samych pozycji co natywne zaznaczenie.
import { h, clamp } from '../util.js';

const LONG = 380;      // ms do rozpoznania przytrzymania
const MOVE = 9;        // px — większy ruch to przewijanie
const isLetter = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
const cmp = (p, q) => p.b - q.b || p.o - q.o;

export function initOwnSelection(R, hooks) {
  let sel = null;                // { a, f } — kotwica i punkt ruchomy
  let word = null;               // słowo, od którego zaczęto (przy rozszerzaniu palcem)
  let press = null, drag = null, auto = 0, lastPt = null, scrollT = 0;
  const layer = h('div', { class: 'cs-layer', 'aria-hidden': 'true' });
  const rects = h('div', { class: 'cs-rects' });
  const hS = h('div', { class: 'cs-handle start', 'data-h': 'start' }, h('i', { class: 'stem' }), h('i', { class: 'knob' }));
  const hE = h('div', { class: 'cs-handle end', 'data-h': 'end' }, h('i', { class: 'stem' }), h('i', { class: 'knob' }));
  layer.append(rects, hS, hE);
  const loupe = h('div', { class: 'cs-loupe', hidden: true },
    h('div', { class: 'cs-lp-line' }, h('span', { class: 'half before' }, h('span', {})), h('i', { class: 'cs-caret' }), h('span', { class: 'half after' }, h('span', {}))));
  R.root.append(loupe);

  const textRoot = (el) => (el.matches('[data-t]') ? el : el.querySelector('[data-t]'));
  const blockText = (b) => { const el = R.idx2el.get(b); const tr = el && textRoot(el); return tr ? tr.textContent : ''; };
  const norm = () => (cmp(sel.a, sel.f) <= 0 ? [sel.a, sel.f] : [sel.f, sel.a]);

  function offsetWithin(root, node, off) {
    const r = document.createRange();
    r.selectNodeContents(root);
    try { r.setEnd(node, off); } catch { return 0; }
    return r.toString().length;
  }
  function domPoint(tr, off) {
    const w = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
    let n, acc = 0, last = null;
    while ((n = w.nextNode())) {
      const l = n.nodeValue.length;
      if (off <= acc + l) return [n, off - acc];
      acc += l; last = n;
    }
    return last ? [last, last.nodeValue.length] : [tr, 0];
  }

  // pozycja (blok, znak) pod punktem ekranu
  function charScan(tr, x, y) {
    const w = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    let n, acc = 0, best = null;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      for (let i = 0; i < len; i++) {
        r.setStart(n, i); r.setEnd(n, i + 1);
        const rc = r.getClientRects()[0];
        if (!rc || !rc.width) continue;
        if (y < rc.top - 3 || y > rc.bottom + 3) continue;
        const d = x < rc.left ? rc.left - x : x > rc.right ? x - rc.right : 0;
        if (!best || d < best.d) best = { d, o: acc + i + (x > (rc.left + rc.right) / 2 ? 1 : 0) };
      }
      acc += len;
    }
    return best ? best.o : tr.textContent.length;
  }
  function nearest(x, y) {
    let best = null;
    for (const el of R.blockEls) {
      const tr = textRoot(el);
      if (!tr) continue;
      const rc = tr.getBoundingClientRect();
      if (!rc.height) continue;
      const d = y < rc.top ? rc.top - y : y > rc.bottom ? y - rc.bottom : 0;
      if (!best || d < best.d) best = { d, el, tr, rc };
      if (d === 0) break;
    }
    if (!best) return null;
    const b = +best.el.dataset.b;
    const len = best.tr.textContent.length;
    if (y < best.rc.top) return { b, o: 0 };
    if (y > best.rc.bottom) return { b, o: len };
    return { b, o: charScan(best.tr, x, y) };
  }
  function posAt(x, y) {
    let node = null, off = 0;
    try {
      if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
      else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
    } catch { node = null; }
    const host = node && (node.nodeType === 1 ? node : node.parentElement);
    const tr = host && host.closest && host.closest('[data-t]');
    if (tr && R.text.contains(tr)) {
      const el = tr.closest('[data-b]');
      if (el) return { b: +el.dataset.b, o: offsetWithin(tr, node, off) };
    }
    return nearest(x, y);
  }
  function wordAt(p) {
    const t = blockText(p.b);
    let s = p.o, e = p.o;
    if (!isLetter(t[s]) && isLetter(t[s - 1])) { s--; e = s; }
    if (!isLetter(t[s])) return null;
    while (s > 0 && isLetter(t[s - 1])) s--;
    while (e < t.length && isLetter(t[e])) e++;
    return { s: { b: p.b, o: s }, e: { b: p.b, o: e } };
  }
  function snapWord(p, forward) {
    const t = blockText(p.b);
    let o = p.o;
    if (forward) { if (isLetter(t[o - 1])) while (o < t.length && isLetter(t[o])) o++; }
    else if (isLetter(t[o])) while (o > 0 && isLetter(t[o - 1])) o--;
    return { b: p.b, o };
  }

  // ───── rysowanie ─────
  function ensureLayer() { if (layer.parentNode !== R.text) R.text.append(layer); }
  function draw() {
    if (!sel) return;
    ensureLayer();
    const [s, e] = norm();
    const base = R.text.getBoundingClientRect();
    const seen = new Set();
    const frag = document.createDocumentFragment();
    let firstR = null, lastR = null;
    for (const el of R.blockEls) {
      const b = +el.dataset.b;
      if (b < s.b || b > e.b) continue;
      const tr = textRoot(el);
      if (!tr) continue;
      const len = tr.textContent.length;
      const so = b === s.b ? s.o : 0, eo = b === e.b ? e.o : len;
      if (eo <= so) continue;
      const [n1, o1] = domPoint(tr, so), [n2, o2] = domPoint(tr, eo);
      const r = document.createRange();
      try { r.setStart(n1, o1); r.setEnd(n2, o2); } catch { continue; }
      const list = [];
      for (const rc of r.getClientRects()) {
        if (rc.width < 0.5 || rc.height < 2) continue;
        const k = [rc.left, rc.top, rc.width, rc.height].map(Math.round).join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        list.push(rc);
        const d = h('div', { class: 'cs-rect' });
        d.style.cssText = `left:${rc.left - base.left}px;top:${rc.top - base.top}px;width:${rc.width}px;height:${rc.height}px`;
        frag.append(d);
      }
      if (!list.length) continue;
      if (!firstR) { firstR = list.slice().sort((p, q) => p.top - q.top || p.left - q.left)[0]; }
      lastR = list.slice().sort((p, q) => q.bottom - p.bottom || q.right - p.right)[0];
    }
    rects.replaceChildren(frag);
    if (!firstR || !lastR) { hS.hidden = hE.hidden = true; return; }
    hS.hidden = hE.hidden = false;
    hS.style.cssText = `left:${firstR.left - base.left}px;top:${firstR.top - base.top - 22}px;height:${firstR.height + 22}px`;
    hE.style.cssText = `left:${lastR.right - base.left}px;top:${lastR.top - base.top}px;height:${lastR.height + 22}px`;
    hS._rect = firstR; hE._rect = lastR;
  }
  function unionRect() {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const d of rects.children) { const rc = d.getBoundingClientRect(); l = Math.min(l, rc.left); t = Math.min(t, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom); }
    if (!isFinite(l)) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }
  const announce = () => hooks.onShow({ getBoundingClientRect: unionRect });

  function setSel(a, f) { sel = { a, f }; draw(); }

  // lupa: powiększony fragment tekstu wokół znaku pod palcem
  function showLoupe(x, y, p) {
    const t = blockText(p.b);
    const N = 18;
    const a = Math.max(0, p.o - N), z = Math.min(t.length, p.o + N);
    const [s, e] = sel ? norm() : [p, p];
    const wrap = (from, to) => {
      const frag = document.createDocumentFragment();
      let cur = from;
      const inSel = (i) => (cmp({ b: p.b, o: i }, s) >= 0 && cmp({ b: p.b, o: i }, e) < 0);
      while (cur < to) {
        const on = inSel(cur);
        let k = cur;
        while (k < to && inSel(k) === on) k++;
        const span = document.createElement(on ? 'mark' : 'span');
        span.textContent = t.slice(cur, k);
        frag.append(span);
        cur = k;
      }
      return frag;
    };
    const [bef, aft] = loupe.querySelectorAll('.half > span');
    bef.replaceChildren(wrap(a, p.o)); aft.replaceChildren(wrap(p.o, z));
    loupe.hidden = false;
    const w = loupe.offsetWidth, hh = loupe.offsetHeight;
    const top = y - hh - 74 > 8 ? y - hh - 74 : y + 74;
    loupe.style.left = clamp(x - w / 2, 8, innerWidth - w - 8) + 'px';
    loupe.style.top = top + 'px';
  }
  const hideLoupe = () => { loupe.hidden = true; };

  // ───── automatyczne przewijanie przy krawędzi ─────
  function autoLoop() {
    auto = 0;
    if (!(press?.fired || drag) || !lastPt) return;
    const rc = R.scroll.getBoundingClientRect();
    const top = rc.top + 96, bot = rc.bottom - 150;
    let v = 0;
    if (lastPt.y < top) v = -Math.min(9, (top - lastPt.y) / 8 + 1.5);
    else if (lastPt.y > bot) v = Math.min(9, (lastPt.y - bot) / 8 + 1.5);
    if (v) {
      R.scroll.scrollTop += v;
      applyMove(lastPt.x, lastPt.y);
      auto = requestAnimationFrame(autoLoop);
    }
  }
  const kickAuto = () => { if (!auto) auto = requestAnimationFrame(autoLoop); };

  // ───── ruch palca ─────
  function applyMove(x, y) {
    if (drag) {
      const p = posAt(x - drag.ox, y - drag.oy);
      if (!p) return;
      sel = { a: drag.fixed, f: p };
      draw();
      showLoupe(x, y, p);
    } else if (press && press.fired && word) {
      let p = posAt(x, y);
      if (!p) return;
      if (cmp(p, word.s) < 0) { p = snapWord(p, false); setSel(word.e, p); }
      else { p = snapWord(p, true); if (cmp(p, word.e) < 0) p = word.e; setSel(word.s, p); }
      showLoupe(x, y, sel.f);
    }
  }

  function cancelPress() { if (press) { clearTimeout(press.timer); press = null; } }

  function onDown(e) {
    if (!enabled() || e.pointerType === 'mouse') return;
    if (e.target.closest('.cs-handle')) return;
    if (e.target.closest('a,button,table,.figpdf,[data-act],input,textarea')) return;
    cancelPress();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
    press.timer = setTimeout(fire, LONG);
  }
  function fire() {
    if (!press) return;
    const p = posAt(press.x, press.y);
    const w = p && wordAt(p);
    if (!w) { press = null; return; }
    press.fired = true;
    word = w;
    setSel(w.s, w.e);
    try { navigator.vibrate && navigator.vibrate(8); } catch { /* brak */ }
    showLoupe(press.x, press.y, w.e);
    lastPt = { x: press.x, y: press.y };
    hooks.onHide();
  }
  function onMovePtr(e) {
    if (drag && e.pointerId === drag.id) { lastPt = { x: e.clientX, y: e.clientY }; applyMove(e.clientX, e.clientY); kickAuto(); return; }
    if (!press || e.pointerId !== press.id) return;
    if (!press.fired) { if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE) cancelPress(); return; }
    lastPt = { x: e.clientX, y: e.clientY };
    applyMove(e.clientX, e.clientY);
    kickAuto();
  }
  function onUp(e) {
    if (drag && e.pointerId === drag.id) { drag = null; hideLoupe(); announce(); return; }
    if (!press || e.pointerId !== press.id) return;
    const fired = press.fired;
    cancelPress();
    if (fired) {
      hideLoupe(); announce();
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 400);
    }
  }
  function onCancel(e) {
    if (drag && e.pointerId === drag.id) { drag = null; hideLoupe(); if (sel) announce(); return; }
    if (press && e.pointerId === press.id) {
      if (press.fired) { hideLoupe(); if (sel) announce(); }
      cancelPress();
    }
  }

  // uchwyty
  function onHandleDown(e) {
    const which = e.currentTarget.dataset.h;
    if (!sel) return;
    e.preventDefault(); e.stopPropagation();
    const [s, en] = norm();
    const rc = e.currentTarget._rect;
    const moving = which === 'start' ? s : en;
    const fixed = which === 'start' ? en : s;
    // palec leży pod linią tekstu — celujemy w środek linii nad palcem
    const cy = rc ? (rc.top + rc.bottom) / 2 : e.clientY;
    const cx = rc ? (which === 'start' ? rc.left : rc.right) : e.clientX;
    drag = { id: e.pointerId, fixed, oy: e.clientY - cy, ox: e.clientX - cx };
    void moving;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* brak */ }
    hooks.onHide();
    lastPt = { x: e.clientX, y: e.clientY };
    applyMove(e.clientX, e.clientY);
  }
  for (const hd of [hS, hE]) {
    hd.addEventListener('pointerdown', onHandleDown);
    hd.addEventListener('pointermove', onMovePtr);
    hd.addEventListener('pointerup', onUp);
    hd.addEventListener('pointercancel', onCancel);
    hd.addEventListener('click', (e) => e.stopPropagation());
  }

  let suppressClick = false;
  const enabled = () => hooks.enabled();
  const onTouchMove = (e) => { if ((press && press.fired) || drag) e.preventDefault(); };
  const onCtx = (e) => { if (enabled() && matchMedia('(pointer: coarse)').matches) e.preventDefault(); };
  const onClickCap = (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } };
  const onScroll = () => {
    if (!sel || drag || (press && press.fired)) return;
    hooks.onHide();
    clearTimeout(scrollT);
    scrollT = setTimeout(() => { if (sel) announce(); }, 180);
  };

  R.text.addEventListener('pointerdown', onDown);
  R.text.addEventListener('pointermove', onMovePtr);
  R.text.addEventListener('pointerup', onUp);
  R.text.addEventListener('pointercancel', onCancel);
  R.text.addEventListener('touchmove', onTouchMove, { passive: false });
  R.text.addEventListener('contextmenu', onCtx);
  R.text.addEventListener('click', onClickCap, true);
  R.scroll.addEventListener('scroll', onScroll, { passive: true });

  function clear() {
    sel = null; word = null; drag = null;
    cancelPress(); hideLoupe();
    rects.replaceChildren();
    layer.remove();
    hooks.onHide();
  }
  function pieces() {
    if (!sel) return [];
    const [s, e] = norm();
    const out = [];
    for (const el of R.blockEls) {
      const b = +el.dataset.b;
      if (b < s.b || b > e.b) continue;
      const tr = textRoot(el);
      if (!tr) continue;
      const len = tr.textContent.length;
      const so = b === s.b ? s.o : 0, eo = b === e.b ? e.o : len;
      if (eo - so >= 1) out.push({ b, s: Math.max(0, so), e: Math.min(len, eo) });
    }
    return out;
  }
  function text() {
    return pieces().map((p) => blockText(p.b).slice(p.s, p.e)).join('\n');
  }
  function destroy() {
    cancelPress(); cancelAnimationFrame(auto); clearTimeout(scrollT);
    R.text.removeEventListener('pointerdown', onDown);
    R.text.removeEventListener('pointermove', onMovePtr);
    R.text.removeEventListener('pointerup', onUp);
    R.text.removeEventListener('pointercancel', onCancel);
    R.text.removeEventListener('touchmove', onTouchMove);
    R.text.removeEventListener('contextmenu', onCtx);
    R.text.removeEventListener('click', onClickCap, true);
    R.scroll.removeEventListener('scroll', onScroll);
    layer.remove(); loupe.remove();
  }
  return {
    clear, pieces, text, destroy, redraw: () => { if (sel) { draw(); announce(); } },
    active: () => !!sel,
    busy: () => !!(drag || (press && press.fired)),
    // do testów
    _select: (a, f) => { setSel(a, f); announce(); },
  };
}
