// Wspólne elementy interfejsu: arkusze, menu, toasty, pierścienie, okładki
import { h, ic, esc, clamp, sleep } from './util.js';

// ───── toasty ─────
let toastBox;
export function toast(msg, opts = {}) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const el = h('div', { class: 'toast' + (opts.error ? ' err' : '') },
    h('span', { html: ic(opts.icon || (opts.error ? 'warning' : 'check-circle')) }),
    h('span', {}, msg),
    opts.action ? h('button', { class: 'btn sm primary', onclick: () => { opts.action.onClick(); close(); } }, opts.action.label) : null);
  toastBox.append(el);
  let closed = false;
  const close = () => { if (closed) return; closed = true; el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  setTimeout(close, opts.ms || (opts.action ? 7000 : 3600));
  return close;
}

// ───── arkusz ─────
export function openSheet({ title, body, wide = false, onClose, actions, className = '' }) {
  const scrim = h('div', { class: 'scrim', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });
  const sheet = h('div', { class: `sheet ${wide ? 'wide' : ''} ${className}` });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Zamknij', html: ic('close') });
  if (title !== undefined) sheet.append(h('div', { class: 'sheet-h' }, h('h3', {}, title), closeBtn));
  const b = h('div', { class: 'sheet-b' });
  b.append(body);
  sheet.append(b);
  if (actions) sheet.append(actions);
  scrim.append(sheet);
  document.body.append(scrim);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    scrim.classList.add('out');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { scrim.remove(); onClose && onClose(result); }, 240);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', () => close());
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  return { close, el: sheet, body: b, scrim };
}

export function confirmDialog({ title, text, ok = 'Potwierdź', cancel = 'Anuluj', danger = false }) {
  return new Promise((resolve) => {
    const body = h('div', {}, h('p', { class: 'muted', style: { margin: '0 0 22px', lineHeight: 1.55 } }, text),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: () => s.close(false) }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => s.close(true) }, ok)));
    const s = openSheet({ title, body, onClose: (r) => resolve(!!r) });
  });
}

export function promptDialog({ title, label, value = '', ok = 'Zapisz', placeholder = '', type = 'text' }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'field', type, value, placeholder, 'aria-label': label || title });
    const body = h('div', { style: { display: 'grid', gap: '14px' } },
      label ? h('label', { class: 'muted', style: { fontSize: '13.5px' } }, label) : null, input,
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: () => s.close(null) }, 'Anuluj'),
        h('button', { class: 'btn primary', onclick: () => s.close(input.value) }, ok)));
    const s = openSheet({ title, body, onClose: (r) => resolve(r ?? null) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') s.close(input.value); });
    setTimeout(() => { input.focus(); input.select(); }, 350);
  });
}

// ───── menu kontekstowe ─────
let openMenuEl = null;
export function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
export function openMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  items.forEach((it) => {
    if (it === 'hr') { m.append(h('hr')); return; }
    m.append(h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', onclick: (e) => { e.stopPropagation(); closeMenu(); it.onClick(); } },
      it.icon ? h('span', { html: ic(it.icon) }) : null, it.label));
  });
  document.body.append(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = (opts.align === 'left' ? r.left : r.right - mw);
  left = clamp(left, 10, innerWidth - mw - 10);
  let top = r.bottom + 8;
  if (top + mh > innerHeight - 10) top = Math.max(10, r.top - mh - 8);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  openMenuEl = m;
  const off = (e) => { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  const esc2 = (e) => { if (e.key === 'Escape') { closeMenu(); document.removeEventListener('keydown', esc2, true); } };
  document.addEventListener('keydown', esc2, true);
  return m;
}

// ───── pierścień postępu ─────
export function ring({ size = 120, stroke = 10, pct = 0, inner = null, animate = true }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const wrap = h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } });
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;
  const bar = wrap.querySelector('.bar');
  const inn = h('div', { class: 'in' });
  if (inner) inn.append(inner.nodeType ? inner : document.createTextNode(inner));
  wrap.append(inn);
  const set = (p) => { bar.style.strokeDashoffset = String(C * (1 - clamp(p, 0, 1))); };
  if (animate) { requestAnimationFrame(() => requestAnimationFrame(() => set(pct))); } else { bar.style.transition = 'none'; set(pct); }
  wrap.set = set;
  return wrap;
}

export function progressBar(pct) {
  const i = h('i');
  const el = h('div', { class: 'bar-line' }, i);
  requestAnimationFrame(() => requestAnimationFrame(() => { i.style.width = Math.round(clamp(pct, 0, 1) * 100) + '%'; }));
  return el;
}

// ───── okładki ─────
const coverUrls = new Map();
export function coverUrl(meta) {
  if (!meta.cover) return null;
  let u = coverUrls.get(meta.id);
  if (!u || u.blob !== meta.cover) {
    if (u) URL.revokeObjectURL(u.url);
    u = { blob: meta.cover, url: URL.createObjectURL(meta.cover) };
    coverUrls.set(meta.id, u);
  }
  return u.url;
}

const TYPE_LABEL = { pdf: 'PDF', epub: 'EPUB', docx: 'DOCX', txt: 'TXT', md: 'MD', html: 'HTML' };
export function typeLabel(t) { return TYPE_LABEL[t] || t.toUpperCase(); }

// długie wyrazy i długie tytuły dostają mniejszą czcionkę na okładce, żeby słowa nie łamały się w środku
function titleScale(t) {
  const L = Math.max(...String(t || '').split(/\s+/).map((w) => w.length), 1);
  const a = Math.min(1, 11.5 / L), b = t && t.length > 70 ? 0.9 : 1;
  return Math.max(0.7, a * b).toFixed(2);
}

export function coverEl(meta, { tilt = false } = {}) {
  const el = h('div', { class: 'cover', style: { '--h': meta.hue ?? 220 } });
  const url = coverUrl(meta);
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
    el.append(img);
  } else {
    el.append(h('div', { class: 'gen' },
      h('span', { class: 'badge' }, typeLabel(meta.type)),
      h('div', {},
        h('div', { class: 't', style: { '--ts': titleScale(meta.title) } }, meta.title),
        meta.author ? h('div', { class: 'a' }, meta.author) : null),
      h('span', { class: 'glyph', html: ic('book-open') })));
  }
  if (tilt) attachTilt(el);
  return el;
}

export function attachTilt(el) {
  if (matchMedia('(hover: none)').matches) return;
  const host = el;
  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    host.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 12}deg) translateZ(0) scale(1.02)`;
  });
  host.addEventListener('pointerleave', () => { host.style.transform = ''; });
}

export function countUp(el, to, { dur = 900, fmt = (v) => String(Math.round(v)) } = {}) {
  const from = 0;
  const t0 = performance.now();
  const step = (t) => {
    const k = clamp((t - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function empty({ icon = 'book-open', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-ic', html: ic(icon) }),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    action || null);
}

// konfetti złotych iskier
export function sparkBurst(host, n = 26) {
  const box = h('div', { class: 'sparks' });
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const d = 70 + Math.random() * 120;
    const s = h('i', { style: { '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d - 30 + 'px', '--r': (Math.random() * 360) + 'deg', '--s': (0.5 + Math.random() * 0.9), '--dl': (Math.random() * 0.15) + 's' } });
    box.append(s);
  }
  host.append(box);
  setTimeout(() => box.remove(), 1800);
}

export { esc, sleep };
