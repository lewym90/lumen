// Własny zestaw ikon liniowych 24×24 (jedna grubość kreski, zaokrąglone zakończenia)
const I = {
  home: '<path d="M3.5 10.8 12 3.6l8.5 7.2V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.6H9.2v5.6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  library: '<rect x="3.5" y="3.5" width="4.6" height="17" rx="1.3"/><rect x="9.7" y="3.5" width="4.6" height="17" rx="1.3"/><path d="m16.3 5.6 3.4-.9 3.4 14.6-3.4.9z" transform="translate(-1.1 0)"/>',
  chart: '<path d="M5.5 20V11.5M12 20V4M18.5 20v-6.5" stroke-width="2.4"/>',
  sliders: '<path d="M4 7h9M17.5 7H20M4 17h3M11.5 17H20"/><circle cx="15.2" cy="7" r="2.2"/><circle cx="9.2" cy="17" r="2.2"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m15.8 15.8 4.7 4.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 15.5V4.5M7.6 8.8 12 4.4l4.4 4.4M5 15v3.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V15"/>',
  bookmark: '<path d="M7 3.8h10a1 1 0 0 1 1 1V20l-6-4.2L6 20V4.8a1 1 0 0 1 1-1z"/>',
  'bookmark-fill': '<path d="M7 3.8h10a1 1 0 0 1 1 1V20l-6-4.2L6 20V4.8a1 1 0 0 1 1-1z" fill="currentColor"/>',
  pen: '<path d="M4 20.2 5 16 16.4 4.6a2.2 2.2 0 0 1 3.1 3.1L8 19.2z"/><path d="m14.2 6.8 3 3"/>',
  highlighter: '<path d="m9.5 14.5 6.6-6.6 3 3-6.6 6.6z"/><path d="m15 8.6 2.4-2.4a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L17.4 11M9.5 14.5 6 18l-2 .2.2-2 3.5-3.5M12 19.5h8"/>',
  note: '<path d="M5.5 4.5h13a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.6v-3.6h-1A1.5 1.5 0 0 1 4 15V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 9h8M8 12.2h5"/>',
  list: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" stroke-width="2.6"/>',
  type: '<path d="m2.8 18.5 5-12.8 5 12.8M4.6 14.2h6.4M14.6 18.5l3.3-8.2 3.3 8.2M15.9 15.6h4"/>',
  play: '<path d="M7.5 4.8v14.4a.6.6 0 0 0 .9.5l11.4-7.2a.6.6 0 0 0 0-1L8.4 4.3a.6.6 0 0 0-.9.5z"/>',
  'play-fill': '<path d="M7.5 4.8v14.4a.6.6 0 0 0 .9.5l11.4-7.2a.6.6 0 0 0 0-1L8.4 4.3a.6.6 0 0 0-.9.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="4.8" width="3.8" height="14.4" rx="1.2"/><rect x="13.7" y="4.8" width="3.8" height="14.4" rx="1.2"/>',
  'pause-fill': '<rect x="6.5" y="4.8" width="3.8" height="14.4" rx="1.2" fill="currentColor"/><rect x="13.7" y="4.8" width="3.8" height="14.4" rx="1.2" fill="currentColor"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3.2v5H5.4A1.4 1.4 0 0 1 4 18.6zM20 15h-3.2v5h1.8a1.4 1.4 0 0 0 1.4-1.4z"/>',
  volume: '<path d="M4 9.6v4.8h3.4L13 19V5L7.4 9.6z"/><path d="M16.4 8.6a5 5 0 0 1 0 6.8M19.2 6a8.8 8.8 0 0 1 0 12"/>',
  left: '<path d="m14.8 5-7 7 7 7"/>',
  right: '<path d="m9.2 5 7 7-7 7"/>',
  down: '<path d="m5 9.2 7 7 7-7"/>',
  up: '<path d="m5 14.8 7-7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.6 4.6 4.6L19 7.6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.4 2.7 2.7 5-5.2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.3 2"/>',
  flame: '<path d="M12 3c.9 3.4 5.6 5.4 5.6 10.2a5.6 5.6 0 0 1-11.2 0c0-2.2 1-3.5 2.1-4.6.2 1.6.9 2.4 1.8 2.9C10 8.6 10.6 5.6 12 3z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  'book-open': '<path d="M12 6.6C10 5 7 4.6 3.5 5.1v13.1c3.5-.5 6.5 0 8.5 1.6 2-1.6 5-2.1 8.5-1.6V5.1C17 4.6 14 5 12 6.6z"/><path d="M12 6.6v13.2"/>',
  file: '<path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5v5h5"/>',
  'file-lines': '<path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h6"/>',
  dots: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.9 12.2a1 1 0 0 0 1 .9h6.6a1 1 0 0 0 1-.9L17.2 7M10.2 11v5.6M13.8 11v5.6"/>',
  download: '<path d="M12 4v11M7.6 10.6 12 15l4.4-4.4M5 19.2h14"/>',
  moon: '<path d="M20 14.6A8.2 8.2 0 0 1 9.4 4 8.2 8.2 0 1 0 20 14.6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
  sparkle: '<path d="m12 3 1.9 5.3L19.2 10l-5.3 1.9L12 17.2l-1.9-5.3L4.8 10l5.3-1.7z"/><path d="m19 16 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  sort: '<path d="M7 4v16M3.6 16.6 7 20l3.4-3.4M17 20V4M13.6 7.4 17 4l3.4 3.4"/>',
  grid: '<rect x="4" y="4" width="6.4" height="6.4" rx="1.6"/><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.6"/><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.6"/><rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.6"/>',
  rows: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  filter: '<path d="M4 5.5h16l-6.2 7.8v5.4l-3.6-1.8v-3.6z"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  scissors: '<circle cx="6" cy="6.8" r="2.6"/><circle cx="6" cy="17.2" r="2.6"/><path d="M8.2 8.2 20 18M8.2 15.8 20 6"/>',
  merge: '<path d="M12 4.5v9.5M8 8.4l4-4 4 4M5 19.5h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2M12 7.8h.01" stroke-width="2.2"/>',
  maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  minimize: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.2L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.2L20 15.5M20 20v-4.5h-4.5"/>',
  calendar: '<rect x="3.8" y="5" width="16.4" height="15.2" rx="2.2"/><path d="M8 3v4M16 3v4M3.8 10.2h16.4"/>',
  shield: '<path d="M12 3.2 19 6v5.6c0 4.2-2.9 7.9-7 9.2-4.1-1.3-7-5-7-9.2V6z"/><path d="m8.8 12.2 2.3 2.3 4.2-4.4"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  trophy: '<path d="M8 4h8v5.2a4 4 0 0 1-8 0z"/><path d="M8 6H4.8v1.6A3 3 0 0 0 8 10.6M16 6h3.2v1.6a3 3 0 0 1-3.2 3M12 13.2V17M8.4 20.4h7.2M9.8 17h4.4"/>',
  'skip-next': '<path d="M5.5 5.2 15 12l-9.5 6.8zM18.5 5v14"/>',
  'skip-prev': '<path d="M18.5 5.2 9 12l9.5 6.8zM5.5 5v14"/>',
  lightbulb: '<path d="M9.2 17.5h5.6M10 20.5h4M12 3.5a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3.5z"/>',
  warning: '<path d="M12 3.8 21 19.4H3z"/><path d="M12 10v4.4M12 17h.01" stroke-width="2.1"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7.5h14M5 7.5 2.8 13a3 3 0 0 0 4.4 0zM19 7.5 16.8 13a3 3 0 0 0 4.4 0z"/>',
  pin: '<path d="M12 21v-6M7.5 4h9l-1 6 3 3.5H5.5l3-3.5z"/>',
  edit: '<path d="M4 20.2 5 16 16.4 4.6a2.2 2.2 0 0 1 3.1 3.1L8 19.2z"/>',
  layers: '<path d="m12 3.8 9 4.7-9 4.7-9-4.7z"/><path d="m3 12.6 9 4.7 9-4.7M3 16.6l9 4.7 9-4.7"/>',
  zap: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  hash: '<path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15.5M4 15h15.5"/>',
  undo: '<path d="M9 6 4 11l5 5"/><path d="M4 11h9.5a6 6 0 0 1 0 12H11" transform="translate(0 -4)"/>',
  keyboard: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  smartphone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6"/><path d="M11 18h2"/>',
};

const NS = 'http://www.w3.org/2000/svg';

export function installIcons() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  let html = '<defs>';
  html += `<linearGradient id="lg-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe3a3"/><stop offset="1" stop-color="#f2a93b"/></linearGradient>`;
  html += `<linearGradient id="lg-night" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2f6b"/><stop offset="1" stop-color="#0d1030"/></linearGradient>`;
  html += `<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient>`;
  html += '</defs>';
  for (const [name, body] of Object.entries(I)) {
    html += `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`;
  }
  // znak aplikacji (kolorowy)
  html += `<symbol id="i-logo" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="16" fill="url(#lg-night)"/>
    <path d="M32 21.5c-4.6-3.4-10.5-4-16-3v24.4c5.5-1 11.4-.4 16 3 4.6-3.4 10.5-4 16-3V18.5c-5.5-1-11.4-.4-16 3z" fill="url(#lg-gold)"/>
    <path d="M32 21.5v24.4" stroke="#14173c" stroke-width="2" stroke-linecap="round"/>
    <circle cx="32" cy="12" r="3.2" fill="#ffe3a3"/>
    <path d="M32 5.2v1.6M24.2 8.2l1.1 1.1M39.8 8.2l-1.1 1.1" stroke="#ffe3a3" stroke-width="1.8" stroke-linecap="round"/>
  </symbol>`;
  svg.innerHTML = html;
  document.body.prepend(svg);
}

export const ICON_NAMES = Object.keys(I);
