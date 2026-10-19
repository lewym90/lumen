// Logika „kursu”: etykiety rozdziałów, czasy, plan dnia
import { stats, wordsToMinutes, chapterInfo, docProgress, continueTarget, currentChapter } from './state.js';
import { fmtMinutes, fmtNum, plural, addDays } from './util.js';

export function chapterKicker(ch) {
  if (!ch) return '';
  if (ch.num) return `${(ch.kw || 'Rozdział').toUpperCase()} ${ch.num}`;
  return '';
}

export function chapterName(ch) {
  return ch.title || 'Rozdział';
}

export function chapterFull(ch) {
  const k = chapterKicker(ch);
  return k ? `${k.charAt(0)}${k.slice(1).toLowerCase()} · ${ch.title}` : ch.title;
}

export function partLabel(ch) {
  if (!ch.part) return '';
  const [a, b] = ch.part.split('|');
  return b ? `${a} · ${b}` : a;
}

export function minutesFor(words) { return Math.max(1, Math.round(wordsToMinutes(words))); }

export function pageRange(doc, ci) {
  const ch = doc.chapters[ci];
  const end = ci + 1 < doc.chapters.length ? doc.chapters[ci + 1].start : doc.blocks.length;
  let a = null, b = null;
  for (let i = ch.start; i < end; i++) { const p = doc.blocks[i].pg; if (p) { if (a == null) a = p; b = p; } }
  return a ? (a === b ? `str. ${a}` : `str. ${a}–${b}`) : '';
}

export function remainingText(words) {
  const m = wordsToMinutes(words);
  return fmtMinutes(m);
}

// Plan do terminu
export function planFor(doc, meta) {
  const p = docProgress(doc, meta);
  const wordsLeft = p.total - p.read;
  const minLeft = wordsToMinutes(wordsLeft);
  const out = { wordsLeft, minLeft, pct: p.pct, done: p.done, total: doc.chapters.length };
  if (meta.deadline) {
    const end = new Date(meta.deadline + 'T23:59:59');
    const days = Math.max(1, Math.ceil((end - new Date()) / 86400000));
    out.days = days;
    out.minPerDay = Math.ceil(minLeft / days);
    out.chPerDay = (doc.chapters.length - p.done) / days;
    out.late = end < new Date();
  }
  // przy dziennym celu
  return out;
}

export function finishEstimate(minLeft, perDayMin) {
  const days = Math.max(1, Math.ceil(minLeft / Math.max(5, perDayMin)));
  return { days, date: addDays(new Date(), days - 1) };
}

export function sessionHint(doc, meta) {
  const { ci, info } = continueTarget(doc, meta);
  const x = info[ci];
  return { ci, ch: doc.chapters[ci], info: x, minutes: minutesFor(x.words - x.read || x.words) };
}

export function wpmLabel() { return `${fmtNum(stats.wpm)} słów/min`; }

export { currentChapter, chapterInfo, docProgress, continueTarget, plural };
