// Własne nazwy kolorów zakreśleń (np. „Do sprawdzenia”, „Ważne”) + eksport notatek do Markdown / Word
import { h, ic, esc, downloadBlob } from '../util.js';
import { settings, setSetting } from '../state.js';
import { openSheet, toast } from '../ui.js';

export const HL_COLORS = 5;
export const HL_HEX = ['#ffcf5c', '#ff80a0', '#61e2af', '#70beff', '#ad94ff'];
const DEF = ['Ważne', 'Do sprawdzenia', 'Definicja', 'Przykład', 'Pytanie'];

export function hlLabel(i) {
  const v = Array.isArray(settings.hlLabels) ? settings.hlLabels[i] : '';
  return (v && String(v).trim()) || DEF[i] || 'Kolor ' + (i + 1);
}

export function editLabels(onDone) {
  const inputs = [];
  const rows = Array.from({ length: HL_COLORS }, (_, i) => {
    const inp = h('input', { class: 'field', type: 'text', maxlength: 28, value: hlLabel(i), 'aria-label': 'Nazwa koloru ' + (i + 1), placeholder: DEF[i] });
    inputs.push(inp);
    return h('label', { class: 'lbl-row' }, h('span', { class: 'hl-dot c' + i }), inp);
  });
  const body = h('div', { class: 'lbl-edit' },
    h('p', { class: 'muted' }, 'Nadaj kolorom własne znaczenie. Nazwy działają w całej aplikacji i pojawiają się w notatkach oraz w eksporcie.'),
    ...rows,
    h('div', { class: 'hl-actions' },
      h('button', { class: 'btn', onclick: () => inputs.forEach((x, i) => { x.value = DEF[i]; }) }, 'Przywróć domyślne'),
      h('button', { class: 'btn primary', onclick: () => {
        setSetting('hlLabels', inputs.map((x, i) => x.value.trim().slice(0, 28) || DEF[i]));
        s.close(); toast('Zapisano nazwy kolorów', { icon: 'check' }); onDone && onDone();
      } }, 'Zapisz')));
  const s = openSheet({ title: 'Etykiety zakreśleń', body });
}

// marks: tablica znaczników, chapters: funkcja (blok → tytuł rozdziału)
export function buildExport({ title, marks, chapterOf, group }) {
  const items = marks.filter((m) => m.kind === 'hl' || m.kind === 'bm').sort((a, b) => a.b - b.b || (a.s || 0) - (b.s || 0));
  const sections = [];
  if (group) {
    for (let i = 0; i < HL_COLORS; i++) {
      const list = items.filter((m) => m.kind === 'hl' && m.c === i);
      if (list.length) sections.push({ head: hlLabel(i), color: i, list });
    }
    const bms = items.filter((m) => m.kind === 'bm');
    if (bms.length) sections.push({ head: 'Zakładki', color: -1, list: bms });
  } else {
    let last = null;
    for (const m of items) {
      const c = chapterOf(m.b);
      if (c !== last) { sections.push({ head: c, color: -1, list: [] }); last = c; }
      sections[sections.length - 1].list.push(m);
    }
  }
  const lab = (m) => (m.kind === 'hl' ? hlLabel(m.c) : 'Zakładka');
  let md = `# Notatki — ${title}\n`;
  for (const sec of sections) {
    md += `\n## ${sec.head}\n\n`;
    for (const m of sec.list) {
      const where = group ? ` _(${chapterOf(m.b)})_` : '';
      if (m.kind === 'hl') md += `> ${m.text}\n${!group ? `> — _${lab(m)}_\n` : ''}${where ? `\n${where.trim()}\n` : ''}${m.note ? `\n**Notatka:** ${m.note}\n` : ''}\n`;
      else md += `- 🔖 ${m.text || 'Zakładka'}${where}\n`;
    }
  }
  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}h1{font-size:20pt}h2{font-size:14pt;margin-top:18pt;border-bottom:1px solid #999}blockquote{margin:6pt 0 2pt 0;padding:4pt 10pt;border-left:4px solid #ccc}.n{margin:2pt 0 10pt 14pt;color:#333}.l{font-size:9pt;color:#666}</style></head><body><h1>Notatki — ${esc(title)}</h1>`;
  const HEX = ['#fff2c4', '#ffd9e2', '#d3f6e7', '#d8ecff', '#e6ddff'];
  for (const sec of sections) {
    html += `<h2>${esc(sec.head)}</h2>`;
    for (const m of sec.list) {
      if (m.kind === 'hl') {
        html += `<blockquote style="border-left-color:${HL_HEX[m.c]};background:${HEX[m.c]}">${esc(m.text)}<br><span class="l">${esc(lab(m))} · ${esc(chapterOf(m.b))}</span></blockquote>${m.note ? `<p class="n"><b>Notatka:</b> ${esc(m.note).replace(/\n/g, '<br>')}</p>` : ''}`;
      } else html += `<p>🔖 ${esc(m.text || 'Zakładka')} <span class="l">· ${esc(chapterOf(m.b))}</span></p>`;
    }
  }
  html += '</body></html>';
  return { md, html, count: items.length };
}

export function saveExport(kind, title, data) {
  const base = 'notatki-' + title.slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-');
  if (kind === 'doc') downloadBlob(new Blob(['\ufeff', data.html], { type: 'application/msword;charset=utf-8' }), base + '.doc');
  else downloadBlob(new Blob([data.md], { type: 'text/markdown;charset=utf-8' }), base + '.md');
  toast(kind === 'doc' ? 'Zapisano notatki dla Worda (.doc)' : 'Zapisano notatki jako Markdown', { icon: 'download' });
}
