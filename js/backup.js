// Kopia zapasowa: postęp, zakreślenia, notatki, statystyki (bez samych plików)
import { db, kv } from './db.js';
import { listDocs, stats, settings, saveMeta, bus, defaultProg, lib } from './state.js';
import { downloadBlob, uid, dayKey } from './util.js';

export async function exportBackup() {
  const docs = listDocs();
  const out = { app: 'lumen', v: 1, at: Date.now(), docs: [], stats: { days: stats.days, wpm: stats.wpm, totalSec: stats.totalSec, totalWords: stats.totalWords }, settings };
  for (const m of docs) {
    const marks = await db.byDoc(m.id);
    out.docs.push({ fp: m.fp, title: m.title, pct: m.pct, prog: m.prog, deadline: m.deadline, marks });
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  downloadBlob(blob, `lumen-kopia-${dayKey()}.json`);
  return out.docs.length;
}

export async function applyOrphan(meta, entry) {
  meta.prog = { ...defaultProg(), ...(entry.prog || {}) };
  meta.pct = entry.pct || 0;
  meta.deadline = entry.deadline || null;
  for (const m of entry.marks || []) await db.put('marks', { ...m, id: uid(), doc: meta.id });
  await saveMeta(meta);
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'lumen') throw new Error('To nie jest kopia zapasowa Lumen.');
  const orphans = await kv.get('orphans', {});
  let applied = 0, pending = 0;
  for (const d of data.docs || []) {
    const meta = [...lib.docs.values()].find((m) => m.fp === d.fp);
    if (meta) { await applyOrphan(meta, d); applied++; } else { orphans[d.fp] = d; pending++; }
  }
  await kv.set('orphans', orphans);
  // statystyki: weź większą wartość z każdego dnia
  for (const [k, v] of Object.entries(data.stats?.days || {})) {
    const cur = stats.days[k];
    if (!cur || cur.s < v.s) stats.days[k] = v;
  }
  stats.totalSec = Math.max(stats.totalSec, data.stats?.totalSec || 0);
  stats.totalWords = Math.max(stats.totalWords, data.stats?.totalWords || 0);
  await kv.set('stats', { days: stats.days, wpm: stats.wpm, totalSec: stats.totalSec, totalWords: stats.totalWords });
  bus.emit('library');
  bus.emit('stats');
  return { applied, pending };
}
