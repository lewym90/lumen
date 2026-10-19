// TXT i Markdown → bloki
import { TextBuilder } from './textbuild.js';

const HEAD_WORD = /^(rozdział|rozdzial|chapter|część|czesc|part|lekcja|lesson|moduł|module|unit|dział)\s+[\divxlc]+\b/i;
const NUMBERED = /^\d{1,2}(\.\d{1,2}){0,3}\.?\s+\S/;

function inlineMd(src) {
  // **b**, __b__, *i*, _i_, `c`, [t](u), ![a](u)
  const tb = new TextBuilder();
  let i = 0;
  const n = src.length;
  const stack = [];
  const open = {};
  const push = (txt, st) => { if (txt) tb.addRun(txt, st.length ? st : null); };
  let buf = '';
  const styles = [];
  const flush = () => { push(buf, styles); buf = ''; };
  while (i < n) {
    const c = src[i];
    if (c === '\\' && i + 1 < n) { buf += src[i + 1]; i += 2; continue; }
    if (c === '`') {
      const j = src.indexOf('`', i + 1);
      if (j > i) { flush(); push(src.slice(i + 1, j), [...styles, 'c']); i = j + 1; continue; }
    }
    if ((c === '*' || c === '_') && src[i + 1] === c) {
      const j = src.indexOf(c + c, i + 2);
      if (j > i + 2 && (c === '*' || !/\w/.test(src[i - 1] || ' '))) { flush(); const inner = inlineMd(src.slice(i + 2, j)); const off = tb.text.length; tb.text += inner.text; inner.marks.forEach((m) => tb.marks.push([m[0] + off, m[1] + off, m[2]])); tb._mark('b', off, tb.text.length); i = j + 2; continue; }
    }
    if ((c === '*' || c === '_') && src[i + 1] !== ' ' && src[i + 1] !== c) {
      const j = src.indexOf(c, i + 1);
      if (j > i + 1 && src[j - 1] !== ' ' && (c === '*' || (!/\w/.test(src[i - 1] || ' ') && !/\w/.test(src[j + 1] || ' ')))) { flush(); const inner = inlineMd(src.slice(i + 1, j)); const off = tb.text.length; tb.text += inner.text; inner.marks.forEach((m) => tb.marks.push([m[0] + off, m[1] + off, m[2]])); tb._mark('i', off, tb.text.length); i = j + 1; continue; }
    }
    if (c === '!' && src[i + 1] === '[') {
      const m = src.slice(i).match(/^!\[([^\]]*)\]\(([^)]*)\)/);
      if (m) { flush(); i += m[0].length; if (m[1]) buf += m[1]; continue; }
    }
    if (c === '[') {
      const m = src.slice(i).match(/^\[([^\]]+)\]\(([^)]*)\)/);
      if (m) { flush(); const inner = inlineMd(m[1]); const off = tb.text.length; tb.text += inner.text; inner.marks.forEach((mm) => tb.marks.push([mm[0] + off, mm[1] + off, mm[2]])); i += m[0].length; continue; }
    }
    buf += c;
    i++;
  }
  flush();
  void stack; void open;
  return tb;
}

export function parseMarkdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const tb = inlineMd(para.join(' ').replace(/\s+/g, ' ').trim());
    const f = tb.finish();
    if (f.x) blocks.push({ t: 'p', x: f.x, ...(f.m.length ? { m: f.m } : {}) });
    para = [];
  };
  // front matter
  let i = 0;
  let title = '';
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      const fm = lines.slice(1, end).join('\n');
      const m = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (m) title = m[1];
      i = end + 1;
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      flushPara();
      const fence = line.trim().slice(0, 3);
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      if (code.length) blocks.push({ t: 'code', x: code.join('\n') });
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      flushPara();
      const f = inlineMd(m[2]).finish();
      if (f.x) blocks.push({ t: 'h', l: m[1].length, x: f.x });
      continue;
    }
    if (lines[i + 1] && /^=+\s*$/.test(lines[i + 1]) && line.trim() && !para.length) { flushPara(); blocks.push({ t: 'h', l: 1, x: inlineMd(line.trim()).finish().x }); i++; continue; }
    if (lines[i + 1] && /^-{3,}\s*$/.test(lines[i + 1]) && line.trim() && !para.length && !/^\s*[-*+]\s/.test(line)) { flushPara(); blocks.push({ t: 'h', l: 2, x: inlineMd(line.trim()).finish().x }); i++; continue; }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { flushPara(); continue; }
    if ((m = line.match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/))) {
      flushPara();
      const depth = Math.min(3, Math.floor(m[1].replace(/\t/g, '    ').length / 2 / 2));
      let text = m[3];
      while (lines[i + 1] && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d{1,3}[.)])\s+/.test(lines[i + 1])) text += ' ' + lines[++i].trim();
      const f = inlineMd(text).finish();
      if (f.x) blocks.push({ t: 'li', x: f.x, o: /\d/.test(m[2]) ? m[2] : '', ...(depth ? { d: depth } : {}), ...(f.m.length ? { m: f.m } : {}) });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const q = [line.replace(/^\s*>\s?/, '')];
      while (lines[i + 1] && /^\s*>/.test(lines[i + 1])) q.push(lines[++i].replace(/^\s*>\s?/, ''));
      const f = inlineMd(q.join(' ').trim()).finish();
      if (f.x) blocks.push({ t: 'quote', x: f.x, ...(f.m.length ? { m: f.m } : {}) });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara();
      const rows = [];
      const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inlineMd(c.trim()).finish().x);
      rows.push(split(line));
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(split(lines[i++]));
      i--;
      blocks.push({ t: 'table', rows, hdr: true });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  if (!title) { const h = blocks.find((b) => b.t === 'h'); if (h) title = h.x; }
  return { blocks, title };
}

export function parsePlainText(src) {
  const text = src.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const rawLines = text.split('\n');
  // blokowanie na pustych liniach
  const paras = [];
  let cur = [];
  for (const l of rawLines) {
    if (!l.trim()) { if (cur.length) paras.push(cur); cur = []; } else cur.push(l);
  }
  if (cur.length) paras.push(cur);

  // czy tekst jest „twardo zawinięty”? (wiele linii w akapicie, podobnej długości)
  const multi = paras.filter((p) => p.length > 1);
  let wrapped = false;
  if (multi.length >= 3) {
    const lens = multi.flatMap((p) => p.slice(0, -1).map((l) => l.trim().length)).sort((a, b) => a - b);
    const med = lens[lens.length >> 1] || 0;
    const mx = lens[Math.floor(lens.length * 0.95)] || 0;
    wrapped = med >= 40 && med <= 110 && mx - med < 25;
  }
  const noBlank = paras.length <= 2 && rawLines.length > 20;

  const blocks = [];
  const bullet = /^\s*([-*•●▪–—]|\d{1,3}[.)])\s+(.*)$/;
  const pushPara = (lines) => {
    if (!lines.length) return;
    // wszystkie linie to punkty listy?
    if (lines.every((l) => bullet.test(l)) && lines.length >= 1) {
      lines.forEach((l) => { const m = l.match(bullet); blocks.push({ t: 'li', x: m[2].trim(), o: /\d/.test(m[1]) ? m[1] : '' }); });
      return;
    }
    if (lines.length === 1) {
      const t = lines[0].trim();
      const letters = t.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '');
      const isHead = t.length <= 90 && !/[.,;:!?]$/.test(t) && (HEAD_WORD.test(t) || NUMBERED.test(t) || (letters.length >= 4 && t === t.toUpperCase()) || /^#+\s/.test(t));
      if (isHead) {
        let lvl = 1;
        const m = t.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})/);
        if (m && !HEAD_WORD.test(t)) lvl = Math.min(4, m[1].split('.').length);
        blocks.push({ t: 'h', l: lvl, x: t.replace(/^#+\s*/, '') });
        return;
      }
    }
    if (lines.length >= 2 && /^[=\-*~]{3,}\s*$/.test(lines[1].trim()) && lines.length === 2) {
      blocks.push({ t: 'h', l: /=/.test(lines[1]) ? 1 : 2, x: lines[0].trim() });
      return;
    }
    const joinMode = wrapped || lines.length === 1;
    if (joinMode) {
      const tb = new TextBuilder();
      lines.forEach((l) => tb.addLine([{ t: l.trim(), st: null }]));
      const f = tb.finish();
      if (f.x) blocks.push({ t: 'p', x: f.x });
    } else {
      // każda linia osobnym akapitem (poezja, listy, logi)
      lines.forEach((l) => { const t = l.trim(); if (t) blocks.push({ t: 'p', x: t }); });
    }
  };
  if (noBlank) {
    rawLines.forEach((l) => { if (l.trim()) pushPara([l]); });
  } else paras.forEach(pushPara);
  return { blocks, title: '' };
}
