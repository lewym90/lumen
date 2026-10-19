// Spis treści i rozdziały: przegląd dokumentu, rozdziały, korekta podziału, termin
import { h, ic, plural, fmtMinutes, fmtNum, fmtDate, addDays, dayKey } from '../util.js';
import { getMeta, loadDoc, saveMeta, saveContent, docProgress, continueTarget, chapterInfo, stats, settings, bus, wordsToMinutes } from '../state.js';
import { sectionsOf, chapterEnd, buildWordIndex } from '../import/structure.js';
import { coverEl, ring, progressBar, openMenu, openSheet, toast, confirmDialog, promptDialog, typeLabel, attachTilt, countUp } from '../ui.js';
import { chapterKicker, partLabel, minutesFor, pageRange, planFor, finishEstimate } from '../course.js';
import { openDoc, renameDoc, deleteDoc, startOver } from './shared.js';
import { pickBlock } from './blockpicker.js';
import { openTagEditor } from './tags.js';
import { PARSER_V } from '../import/importer.js';
import { parseLabel } from '../import/structure.js';

export async function mount(root, { id }) {
  const meta = getMeta(id);
  const page = h('div', { class: 'page detail' });
  root.append(page);
  if (!meta) { page.append(h('div', { class: 'empty' }, h('h3', {}, 'Nie znaleziono dokumentu'), h('a', { class: 'btn', href: '#/library' }, 'Wróć do biblioteki'))); return; }
  const doc = await loadDoc(id);
  if (!doc) { page.append(h('div', { class: 'empty' }, h('h3', {}, 'Nie udało się wczytać treści'))); return; }
  let editing = false;
  const expanded = new Set();
  let destroyed = false;

  const toRead = (ci, b) => { location.hash = `#/read/${id}?c=${ci}` + (b != null ? `&b=${b}` : ''); };

  async function persistStructure() {
    doc.cw = buildWordIndex(doc);
    await saveContent(doc);
    const p = docProgress(doc, meta);
    meta.pct = p.pct;
    meta.chapterCount = doc.chapters.length;
    meta.auto = false;
    await saveMeta(meta);
  }

  function renumber() { doc.chapters.forEach((c, i) => { c.id = 'c' + i; }); }

  async function splitAt(blockIdx, ci) {
    const ch = doc.chapters[ci];
    const b = doc.blocks[blockIdx];
    const title = await promptDialog({ title: 'Nowy rozdział', label: 'Tytuł nowego rozdziału', value: b.t === 'h' ? b.x : '' , ok: 'Utwórz' });
    if (!title || !title.trim()) return;
    const prog = meta.prog;
    const far = prog.far[ch.start];
    doc.chapters.splice(ci + 1, 0, { id: '', title: title.trim(), kw: '', num: '', start: blockIdx, level: ch.level, part: ch.part, manual: true });
    if (prog.done[ch.start]) prog.done[blockIdx] = prog.done[ch.start];
    if (far != null && far >= blockIdx) prog.far[blockIdx] = far;
    renumber();
    await persistStructure();
    toast('Podzielono rozdział', { icon: 'scissors' });
    render();
  }

  async function splitPick(ci) {
    const end = chapterEnd(doc, ci);
    const bi = await pickBlock(doc, doc.chapters[ci].start + 1, end, { title: 'Gdzie zacząć nowy rozdział?', hint: 'Wybierz akapit, od którego ma się zaczynać nowy rozdział.' });
    if (bi != null) await splitAt(bi, ci);
  }

  async function moveStart(ci) {
    const ch = doc.chapters[ci];
    const lo = ci > 0 ? doc.chapters[ci - 1].start + 1 : 0;
    const hi = Math.min(chapterEnd(doc, ci), ch.start + 400);
    const bi = await pickBlock(doc, lo, hi, { title: 'Nowy początek rozdziału', hint: 'Wybierz miejsce, od którego rozdział ma się zaczynać. Poprzedni rozdział zostanie odpowiednio skrócony lub wydłużony.', cur: ch.start });
    if (bi == null || bi === ch.start) return;
    const prog = meta.prog;
    const f = prog.far[ch.start], d = prog.done[ch.start];
    delete prog.far[ch.start]; delete prog.done[ch.start];
    ch.start = bi;
    if (f != null && f >= bi) prog.far[bi] = f;
    if (d) prog.done[bi] = d;
    renumber();
    await persistStructure();
    toast('Przesunięto początek rozdziału', { icon: 'scissors' });
    render();
  }

  async function mergeWithPrev(ci) {
    if (ci <= 0) return;
    const prev = doc.chapters[ci - 1], cur = doc.chapters[ci];
    const prog = meta.prog;
    const f = Math.max(prog.far[prev.start] ?? -1, prog.far[cur.start] ?? -1);
    if (f >= 0) prog.far[prev.start] = f;
    if (!(prog.done[prev.start] && prog.done[cur.start])) delete prog.done[prev.start];
    delete prog.far[cur.start]; delete prog.done[cur.start];
    doc.chapters.splice(ci, 1);
    renumber();
    await persistStructure();
    toast('Scalono z poprzednim rozdziałem', { icon: 'merge' });
    render();
  }

  async function renameCh(ci) {
    const t = await promptDialog({ title: 'Zmień nazwę rozdziału', value: doc.chapters[ci].title, label: 'Tytuł' });
    if (!t || !t.trim()) return;
    const lab = parseLabel(t);
    const c = doc.chapters[ci];
    if (lab.kw && lab.num) { c.kw = lab.kw; c.num = lab.num; c.title = lab.title || t.trim(); }
    else { c.title = t.trim(); }
    await persistStructure();
    render();
  }

  async function toggleDone(ci) {
    const ch = doc.chapters[ci];
    const end = chapterEnd(doc, ci);
    if (meta.prog.done[ch.start]) { delete meta.prog.done[ch.start]; delete meta.prog.far[ch.start]; }
    else { meta.prog.done[ch.start] = Date.now(); meta.prog.far[ch.start] = end - 1; }
    const p = docProgress(doc, meta);
    meta.pct = p.pct;
    await saveMeta(meta);
    render();
  }

  async function reprocess() {
    const ok = await confirmDialog({ title: 'Przetworzyć plik ponownie?', text: 'Aplikacja jeszcze raz przeczyta oryginalny plik nowszą wersją rozpoznawania struktury. Postęp, zakładki i zakreślenia zostaną przeniesione (dopasowanie po treści). Ręczne zmiany podziału na rozdziały zostaną zastąpione podziałem automatycznym.', ok: 'Przetwórz' });
    if (!ok) return;
    const { reimportDocument } = await import('../import/importer.js');
    const bar = progressBar(0);
    const ph = h('div', { class: 'ocr-ph' }, 'Czytam plik…');
    const sheet = openSheet({ title: 'Przetwarzanie pliku', body: h('div', {}, ph, bar) });
    try {
      const r = await reimportDocument(meta, (p) => { ph.textContent = p.phase || ''; const i = bar.querySelector('i'); if (i) i.style.width = Math.round((p.frac || 0) * 100) + '%'; });
      sheet.close();
      const nd = await loadDoc(id);
      doc.blocks = nd.blocks; doc.chapters = nd.chapters; doc.auto = nd.auto; doc.cw = nd.cw;
      toast(r.lost ? `Gotowe. Nie udało się przenieść ${r.lost} zakreśleń lub zakładek.` : 'Gotowe — plik przetworzony ponownie', { icon: 'check-circle', ms: 4000 });
      render();
    } catch (e) { sheet.close(); toast(e.message || 'Nie udało się przetworzyć pliku', { error: true }); }
  }

  async function startOcr() {
    const { ocrDocument, ocrSupported } = await import('../import/ocr.js');
    if (!ocrSupported()) { toast('Ta przeglądarka nie obsługuje rozpoznawania tekstu', { error: true }); return; }
    const ctl = new AbortController();
    const bar = progressBar(0);
    const ph = h('div', { class: 'ocr-ph' }, 'Przygotowuję…');
    const dt = h('div', { class: 'dim ocr-dt' }, '');
    const cancel = h('button', { class: 'btn', onclick: () => { ctl.abort(); cancel.disabled = true; ph.textContent = 'Przerywam… (postęp zostanie zapamiętany)'; } }, 'Przerwij');
    const body = h('div', { class: 'ocr-body' },
      h('p', { class: 'muted', style: { margin: '0 0 16px', lineHeight: 1.5 } }, 'Czytam strony skanu i zamieniam je na tekst. Pierwsze uruchomienie pobiera silnik (~12 MB), potem działa offline. Zostaw tę kartę otwartą — duże dokumenty mogą potrwać kilkanaście minut.'),
      ph, bar, dt, h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '18px' } }, cancel));
    const sheet = openSheet({ title: 'Rozpoznawanie tekstu', body });
    const setBar = (f) => { const i = bar.querySelector('i'); if (i) i.style.width = Math.round(f * 100) + '%'; };
    try {
      const words = await ocrDocument(meta, { signal: ctl.signal, onProgress: (p) => { ph.textContent = p.phase || ''; dt.textContent = p.detail || ''; setBar(p.frac || 0); } });
      sheet.close();
      const nd = await loadDoc(id);
      doc.blocks = nd.blocks; doc.chapters = nd.chapters; doc.auto = nd.auto; doc.cw = nd.cw;
      toast(`Gotowe — rozpoznano ${fmtNum(words)} słów`, { icon: 'check-circle' });
      render();
    } catch (e) {
      sheet.close();
      if (e.aborted) toast('Przerwano — kolejne uruchomienie dokończy od tego miejsca');
      else toast(e.message || 'Nie udało się rozpoznać tekstu', { error: true });
    }
  }

  async function resetStructure() {
    if (!doc.auto) { toast('Brak zapisanego automatycznego podziału', { error: true }); return; }
    const ok = await confirmDialog({ title: 'Przywrócić podział automatyczny?', text: 'Twoje ręczne zmiany w podziale na rozdziały zostaną odrzucone. Postęp czytania zostanie zachowany tam, gdzie to możliwe.', ok: 'Przywróć' });
    if (!ok) return;
    doc.chapters = JSON.parse(JSON.stringify(doc.auto));
    renumber();
    // usuń wpisy postępu dla nieistniejących początków rozdziałów
    const starts = new Set(doc.chapters.map((c) => c.start));
    for (const k of Object.keys(meta.prog.far)) if (!starts.has(+k)) delete meta.prog.far[k];
    for (const k of Object.keys(meta.prog.done)) if (!starts.has(+k)) delete meta.prog.done[k];
    await persistStructure();
    meta.auto = true; await saveMeta(meta);
    render();
  }

  function chapterRow(info, ci) {
    const { c } = info;
    const state = info.done ? 'done' : info.started ? 'prog' : 'todo';
    const secs = sectionsOf(doc, ci);
    const open = expanded.has(ci);
    const kick = chapterKicker(c);
    const ind = h('div', { class: 'ch-ind' });
    if (state === 'done') ind.innerHTML = ic('check');
    else if (state === 'prog') ind.append(ring({ size: 38, stroke: 4, pct: info.pct, inner: h('span', { class: 'ch-n' }, c.num || (c.front || c.manual ? '·' : ci + 1)) }));
    else ind.append(h('span', { class: 'ch-n' }, c.num || (c.front || c.manual ? '·' : ci + 1)));
    const more = h('button', { class: 'icon-btn ch-more', 'aria-label': 'Opcje rozdziału', html: ic('dots'), onclick: (e) => {
      e.stopPropagation();
      openMenu(more, [
        { icon: 'play', label: info.started && !info.done ? 'Kontynuuj ten rozdział' : 'Czytaj ten rozdział', onClick: () => toRead(ci) },
        { icon: info.done ? 'circle' : 'check-circle', label: info.done ? 'Oznacz jako nieprzeczytany' : 'Oznacz jako przeczytany', onClick: () => toggleDone(ci) },
        'hr',
        { icon: 'edit', label: 'Zmień nazwę lub numer', onClick: () => renameCh(ci) },
        { icon: 'scissors', label: 'Podziel w wybranym miejscu…', onClick: () => splitPick(ci) },
        ...(ci > 0 ? [{ icon: 'merge', label: 'Scal z poprzednim', onClick: () => mergeWithPrev(ci) }, { icon: 'down', label: 'Przesuń początek rozdziału…', onClick: () => moveStart(ci) }] : []),
        ...(ci + 1 < doc.chapters.length ? [{ icon: 'merge', label: 'Scal z następnym', onClick: () => mergeWithPrev(ci + 1) }] : []),
        ...(doc.auto ? ['hr', { icon: 'refresh', label: 'Przywróć podział automatyczny', onClick: resetStructure }] : []),
      ]);
    } });
    const row = h('div', { class: `ch-row state-${state}` + (open ? ' open' : ''), style: { '--i': Math.min(ci, 20) } },
      h('div', { class: 'ch-head', role: 'button', tabindex: 0, onclick: () => toRead(ci), onkeydown: (e) => { if (e.key === 'Enter') toRead(ci); } },
        ind,
        h('div', { class: 'ch-main' },
          kick ? h('div', { class: 'ch-k' }, kick) : null,
          h('div', { class: 'ch-t' }, c.title),
          h('div', { class: 'ch-m' }, [`~${fmtMinutes(minutesFor(info.words))}`, pageRange(doc, ci), `${fmtNum(info.words)} słów`].filter(Boolean).join(' · ')),
          state === 'prog' ? h('div', { class: 'ch-bar' }, progressBar(info.pct)) : null),
        h('div', { class: 'ch-act' },
          secs.length ? h('button', { class: 'icon-btn ch-exp', 'aria-label': 'Pokaż podrozdziały', html: ic('down'), onclick: (e) => { e.stopPropagation(); if (expanded.has(ci)) expanded.delete(ci); else expanded.add(ci); render(true); } }) : null,
          more)));
    if (open && secs.length) {
      row.append(h('div', { class: 'ch-secs' }, secs.map((s) => h('div', { class: 'sec-row l' + s.level },
        h('button', { class: 'sec-t', onclick: () => toRead(ci, s.block) }, s.title),
        editing ? h('button', { class: 'btn sm ghost', title: 'Utwórz nowy rozdział od tego miejsca', onclick: () => splitAt(s.block, ci) }, h('span', { html: ic('scissors') }), 'Nowy rozdział') : null))));
    }
    return row;
  }

  function render(keepScroll) {
    if (destroyed) return;
    const y = keepScroll ? page.parentElement.scrollTop : 0;
    const p = docProgress(doc, meta);
    const { ci: cIdx, info } = continueTarget(doc, meta);
    const plan = planFor(doc, meta);
    const started = p.read > 0;
    const finished = p.pct >= 0.995;
    const cover = coverEl(meta, { tilt: true });

    // Pierścień
    const num = h('b', {}, '0');
    const rg = ring({ size: 132, stroke: 11, pct: p.pct, inner: h('div', { class: 'rg-in' }, num, h('small', {}, 'przeczytano')) });
    countUp(num, Math.round(p.pct * 100), { fmt: (v) => Math.round(v) + '%' });

    const stat = (icon, val, label) => h('div', { class: 'stat' }, h('span', { class: 'stat-ic', html: ic(icon) }), h('b', {}, val), h('small', {}, label));

    const back = h('a', { class: 'btn ghost sm back', href: '#/library' }, h('span', { html: ic('left') }), 'Biblioteka');
    const menuBtn = h('button', { class: 'icon-btn', 'aria-label': 'Więcej', html: ic('dots'), onclick: () => openMenu(menuBtn, [
      { icon: 'edit', label: 'Zmień tytuł', onClick: async () => { await renameDoc(meta); render(true); } },
      { icon: 'tag', label: 'Tagi i półki…', onClick: () => openTagEditor(meta, () => render(true)) },
      { icon: 'scissors', label: editing ? 'Zakończ poprawianie podziału' : 'Popraw podział na rozdziały', onClick: () => { editing = !editing; render(true); } },
      { icon: 'refresh', label: 'Przywróć podział automatyczny', onClick: resetStructure },
      ...(meta.type !== 'unknown' ? [{ icon: 'refresh', label: 'Przetwórz plik ponownie', onClick: reprocess }] : []),
      'hr',
      { icon: 'trash', label: 'Usuń z biblioteki', danger: true, onClick: async () => { if (await deleteDoc(meta)) location.hash = '#/library'; } },
    ]) });

    const cta = finished
      ? h('button', { class: 'btn primary lg', onclick: () => toRead(0) }, h('span', { html: ic('refresh') }), 'Przeczytaj jeszcze raz')
      : h('button', { class: 'btn primary lg', onclick: () => toRead(cIdx) }, started ? 'Kontynuuj' : 'Zacznij czytać', h('span', { html: ic('arrow-right') }));

    // planer
    const pick = h('input', { class: 'field', type: 'date', value: meta.deadline || '', min: dayKey(), 'aria-label': 'Chcę skończyć do',
      onchange: async (e) => { meta.deadline = e.target.value || null; await saveMeta(meta); render(true); } });
    const quick = [7, 14, 30].map((d) => h('button', { class: 'chip', onclick: async () => { meta.deadline = dayKey(addDays(new Date(), d)); await saveMeta(meta); render(true); } }, `${d} dni`));
    const per = finishEstimate(plan.minLeft, settings.goalMin);
    const planBody = meta.deadline
      ? h('div', { class: 'plan-out' },
        plan.late ? h('div', { class: 'warnline' }, 'Termin już minął — ustaw nowy.') : h('div', { class: 'plan-big' }, h('b', {}, plan.minPerDay), ' min dziennie'),
        h('div', { class: 'muted' }, plan.late ? '' : `Aby skończyć do ${fmtDate(new Date(meta.deadline + 'T12:00:00'))}${plan.chPerDay >= 1 ? ` — około ${plan.chPerDay.toFixed(1).replace('.', ',')} rozdziału dziennie` : ` — jeden rozdział co ${Math.max(1, Math.round(1 / Math.max(plan.chPerDay, 0.01)))} ${plural(Math.round(1 / Math.max(plan.chPerDay, 0.01)), 'dzień', 'dni', 'dni')}`}.`),
        h('button', { class: 'btn ghost sm', onclick: async () => { meta.deadline = null; await saveMeta(meta); render(true); } }, 'Usuń termin'))
      : h('div', { class: 'plan-out' },
        h('div', { class: 'plan-big' }, h('b', {}, per.days), ` ${plural(per.days, 'dzień', 'dni', 'dni')}`),
        h('div', { class: 'muted' }, finished ? 'Dokument przeczytany.' : `Tyle zajmie dokończenie przy ${settings.goalMin} min dziennie i Twoim tempie ${fmtNum(stats.wpm)} słów/min (do ${fmtDate(per.date)}).`));

    const planCard = h('section', { class: 'card plan-card' },
      h('div', { class: 'kicker' }, 'Plan'),
      planBody,
      h('div', { class: 'plan-set' }, h('label', { class: 'dim sm' }, 'Chcę skończyć do'), pick, h('div', { class: 'chips' }, quick)));

    // lista rozdziałów, pogrupowana w części
    const list = h('div', { class: 'ch-list' + (editing ? ' editing' : '') });
    let lastPart = null;
    info.length; // referencja
    const infos = chapterInfo(doc, meta);
    infos.forEach((x, i) => {
      const part = x.c.part || '';
      if (part !== lastPart) {
        lastPart = part;
        if (part) {
          const members = infos.filter((y) => (y.c.part || '') === part);
          const done = members.filter((y) => y.done).length;
          list.append(h('div', { class: 'part-h' }, h('span', { class: 'ph-t' }, h('b', {}, x.c.part.split('|')[0]), x.c.part.includes('|') ? h('em', {}, x.c.part.split('|').slice(1).join(' ')) : null), h('small', {}, `${done}/${members.length}`)));
        } else if (i > 0) list.append(h('div', { class: 'part-h plain' }));
      }
      list.append(chapterRow(x, i));
    });

    const notice = [];
    if (meta.scanned) notice.push(h('div', { class: 'notice acc' }, h('span', { html: ic('info') }), 'To skan bez warstwy tekstowej — strony są obrazami. Rozpoznanie tekstu (OCR) zamieni je na zwykły tekst z rozdziałami, zakreślaniem, szukaniem i czytaniem na głos. Działa na Twoim urządzeniu, offline.', h('button', { class: 'btn sm primary', onclick: startOcr }, 'Rozpoznaj tekst')));
    if (meta.type === 'pdf' && !meta.scanned && (meta.pv || 0) < 2) notice.push(h('div', { class: 'notice acc' }, h('span', { html: ic('info') }), 'Ten dokument został zaimportowany starszą wersją aplikacji. Nowa wersja dokładniej rozpoznaje strukturę i treść (m.in. artykuły, ustępy, dzielenie wyrazów). Przetworzenie zachowa Twój postęp i zakreślenia.', h('button', { class: 'btn sm primary', onclick: reprocess }, 'Przetwórz ponownie')));
    if (editing) notice.push(h('div', { class: 'notice acc' }, h('span', { html: ic('scissors') }), 'Poprawianie podziału: w menu rozdziału (⋯) zmienisz nazwę, podzielisz go w dowolnym miejscu, przesuniesz początek albo scalisz z sąsiednim. Rozwiń rozdział strzałką, by utworzyć nowy od nagłówka.', h('button', { class: 'btn sm', onclick: () => { editing = false; render(true); } }, 'Gotowe')));

    page.replaceChildren(
      h('div', { class: 'detail-top' }, back, menuBtn),
      h('section', { class: 'detail-hero', style: { '--h': meta.hue ?? 220 } },
        h('div', { class: 'dh-glow' }),
        h('div', { class: 'dh-cover' }, cover),
        h('div', { class: 'dh-body' },
          h('div', { class: 'kicker' }, typeLabel(meta.type), meta.pages ? ` · ${meta.pages} ${plural(meta.pages, 'strona', 'strony', 'stron')}` : ''),
          h('h1', { class: 'display dh-title' }, meta.title),
          meta.author ? h('div', { class: 'muted dh-author' }, meta.author) : null,
          h('div', { class: 'stats-row' },
            stat('layers', fmtNum(doc.chapters.length), plural(doc.chapters.length, 'rozdział', 'rozdziały', 'rozdziałów')),
            stat('clock', fmtMinutes(wordsToMinutes(p.total)), 'czytania'),
            stat('check-circle', `${p.done}/${doc.chapters.length}`, 'przeczytane')),
          h('div', { class: 'dh-actions' }, cta, finished ? null : h('span', { class: 'dim next-hint' }, `${chapterKicker(doc.chapters[cIdx]) || 'Dalej'}: ${doc.chapters[cIdx].title}`),
            started && !finished ? h('button', { class: 'start-over', onclick: () => startOver(meta, () => toRead(0)) }, h('span', { html: ic('refresh') }), 'Zacznij od początku') : null)),
        h('div', { class: 'dh-ring' }, rg)),
      ...notice,
      h('div', { class: 'detail-cols' },
        h('div', { class: 'detail-main' },
          h('div', { class: 'sec-h' }, h('h3', {}, 'Rozdziały'), h('button', { class: 'btn ghost sm', onclick: () => { editing = !editing; render(true); } }, h('span', { html: ic('scissors') }), editing ? 'Gotowe' : 'Popraw podział')),
          list),
        h('aside', { class: 'detail-side' }, planCard)));
    attachTilt(cover);
    if (keepScroll) page.parentElement.scrollTop = y;
  }

  render();
  // przewiń do bieżącego rozdziału
  setTimeout(() => {
    const cur = page.querySelector('.ch-row.state-prog') || null;
    if (cur && settings && matchMedia('(min-width: 700px)').matches === false) { /* na telefonie zostaw górę */ }
  }, 0);
  const off = bus.on('library', () => { if (!destroyed && getMeta(id)) render(true); });
  return { destroy() { destroyed = true; off(); } };
}
