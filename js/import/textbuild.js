// Budowanie tekstu z kawałków (runs) z zaznaczeniem pogrubień, kursyw, indeksów górnych.

const LIG = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

export function cleanStr(s) {
  return s
    .replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, (c) => LIG[c])
    .replace(/[     ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export class TextBuilder {
  constructor() { this.text = ''; this.marks = []; }

  _mark(st, s, e) {
    if (e <= s) return;
    const last = this.marks[this.marks.length - 1];
    if (last && last[2] === st && last[1] === s) { last[1] = e; return; }
    // połącz z poprzednim, jeśli przylega
    for (let i = this.marks.length - 1; i >= Math.max(0, this.marks.length - 3); i--) {
      const m = this.marks[i];
      if (m[2] === st && m[1] === s) { m[1] = e; return; }
    }
    this.marks.push([s, e, st]);
  }

  addRun(str, styles) {
    if (!str) return;
    const s = this.text.length;
    this.text += str;
    const e = this.text.length;
    if (styles) for (const st of styles) this._mark(st, s, e);
  }

  endsWithSpace() { return /\s$/.test(this.text); }

  trimEndChars(n) {
    if (n <= 0) return;
    this.text = this.text.slice(0, this.text.length - n);
    const L = this.text.length;
    this.marks = this.marks.filter((m) => m[0] < L).map((m) => [m[0], Math.min(m[1], L), m[2]]);
  }

  // Dołącz kolejną linię (tablicę runów) z obsługą dzielenia wyrazów
  addLine(runs) {
    const first = runs.find((r) => r.t.length);
    if (!first) return;
    if (this.text) {
      const t = this.text;
      const nextCh = first.t.replace(/^\s+/, '')[0] || '';
      const lower = /^[a-ząćęłńóśźżäöüßéèêàâîôûçñ]/.test(nextCh);
      const lastCh = t[t.length - 1];
      if (lastCh === '­') { this.trimEndChars(1); }
      else if ((lastCh === '‐' || lastCh === '‑') && lower) { this.trimEndChars(1); }
      else if (lastCh === '‐' || lastCh === '‑') { this.trimEndChars(1); this.addRun('-', null); }
      else if (lastCh === '-' && lower && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{2}-$/.test(t)) { this.trimEndChars(1); }
      else if (lastCh === '-' ) { /* łącznik bez spacji */ }
      else if (!/\s$/.test(t)) this.addRun(' ', null);
    }
    let started = this.text.length > 0;
    for (const r of runs) {
      let s = r.t;
      if (!started) { s = s.replace(/^\s+/, ''); if (s) started = true; }
      if (s) this.addRun(s, r.st);
    }
  }

  toRuns() {
    const pts = new Set([0, this.text.length]);
    this.marks.forEach((m) => { pts.add(m[0]); pts.add(m[1]); });
    const arr = [...pts].sort((a, b) => a - b);
    const runs = [];
    for (let i = 0; i + 1 < arr.length; i++) {
      const s = arr[i], e = arr[i + 1];
      if (e <= s) continue;
      runs.push({ t: this.text.slice(s, e), st: this.marks.filter((m) => m[0] <= s && m[1] >= e).map((m) => m[2]) });
    }
    return runs;
  }

  finish() {
    const orig = this.text;
    let t = orig.replace(/[ \t]+$/, '');
    const L = t.length;
    const marks = this.marks.filter((m) => m[0] < L).map((m) => [m[0], Math.min(m[1], L), m[2]]);
    return { x: t, m: marks };
  }
}

export function mergeBuilders(a, b, sep = ' ') {
  const off = a.text.length + sep.length;
  a.text += sep + b.text;
  for (const m of b.marks) a.marks.push([m[0] + off, m[1] + off, m[2]]);
}
