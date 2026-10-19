// Czytanie na głos (Web Speech API) z podświetlaniem zdań
const synth = window.speechSynthesis;
export const ttsSupported = !!synth && 'SpeechSynthesisUtterance' in window;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('pl', { granularity: 'sentence' }) : null;

export function sentences(text) {
  const out = [];
  if (segmenter) {
    for (const s of segmenter.segment(text)) out.push({ s: s.index, e: s.index + s.segment.length, t: s.segment });
  } else {
    const re = /[^.!?…]+[.!?…]+["”»)]*\s*|[^.!?…]+$/g;
    let m;
    while ((m = re.exec(text))) out.push({ s: m.index, e: m.index + m[0].length, t: m[0] });
  }
  const clean = out.filter((x) => x.t.trim().length);
  // zdania nie kończą się na skrótach (art., ust., pkt, Dz. U. …) ani na liczbach porządkowych
  const ABBR_ALWAYS = /(?:\b(?:art|ust|pkt|poz|lit|nr|zm|tzw|np|ok|godz|ul|al|im|dz|prof|dr|mgr|inż|św|woj|str|rozdz|zał|tj|ww|ob|par|cz|pl)|\bDz\.\s*U|\bm\.in|\bt\.j|\bz późn\. zm)\.\s*$/i;
  const ABBR_SOFT = /\b(?:r|w|zł|tys|mln|mld|ha|km|kg|ur|s|t)\.\s*$/i;
  const merged = [];
  for (const x of clean) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const nextCh = x.t.trim()[0] || '';
      const soft = /[a-ząćęłńóśźż0-9(]/.test(nextCh);
      if (ABBR_ALWAYS.test(prev.t) || (soft && ABBR_SOFT.test(prev.t)) || (/\d\.\s*$/.test(prev.t) && /^[a-ząćęłńóśźż]/.test(nextCh))) {
        prev.t += x.t; prev.e = x.e; continue;
      }
    }
    merged.push({ ...x });
  }
  return merged;
}

// Rozwijanie skrótów na potrzeby syntezatora (tylko dla polskiego). Podświetlany jest oryginalny tekst.
const EXPAND = [
  [/\bart\.\s*/gi, 'artykuł '], [/\bust\.\s*/gi, 'ustęp '], [/\bpkt\.?\s*/gi, 'punkt '], [/\blit\.\s*/gi, 'litera '],
  [/\bpoz\.\s*/gi, 'pozycja '], [/\bDz\.\s*U\.\s*/g, 'Dziennik Ustaw '], [/\bnr\s*(?=\d)/gi, 'numer '],
  [/\bz późn\.\s*zm\./gi, 'z późniejszymi zmianami'], [/\bt\.\s*j\./gi, 'tekst jednolity'], [/\bm\.in\./gi, 'między innymi'],
  [/\bnp\./gi, 'na przykład'], [/\btzw\./gi, 'tak zwany'], [/\btzn\./gi, 'to znaczy'], [/\bitd\./gi, 'i tak dalej'],
  [/\bitp\./gi, 'i tym podobne'], [/\bww\./gi, 'wyżej wymienionych'], [/\bok\.\s*(?=\d)/gi, 'około '], [/\brozdz\.\s*/gi, 'rozdział '],
  [/\bgodz\.\s*/gi, 'godzina '], [/§\s*/g, 'paragraf '], [/\bul\.\s*/g, 'ulica '], [/\bal\.\s*(?=[A-ZŁŚŻ])/g, 'aleja '],
  [/(\d)\s*r\.(?=\s|$|[,;)])/g, '$1 roku'], [/(\d)\s*zł(?![A-Za-ząćęłńóśźż])/g, '$1 złotych'], [/(\d)\s*%/g, '$1 procent'],
  [/(\d)\s*(?:m2|m²)/g, '$1 metrów kwadratowych'], [/\bmln\b\.?/gi, 'milionów'], [/\btys\./gi, 'tysięcy'],
  [/(\d+[a-z]?)\s*[–—]\s*(\d+)/g, 'od $1 do $2'],
  [/\s*\((?:uchylony|pominięty|pominięte)\)/gi, ' uchylony'],
];
export function expandSpeech(t, lang = 'pl') {
  if (!lang.toLowerCase().startsWith('pl')) return t;
  let r = t;
  for (const [re, to] of EXPAND) r = r.replace(re, to);
  return r.replace(/\s{2,}/g, ' ').trim();
}

// Chrome przerywa zbyt długie wypowiedzi — tnij je na kawałki przy znakach interpunkcyjnych
function chunkSpeech(t, max = 220) {
  if (t.length <= max) return [t];
  const out = [];
  let rest = t;
  while (rest.length > max) {
    let cut = -1;
    for (const re of [/[;:]\s/g, /,\s/g, /\s/g]) {
      let m, last = -1;
      re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index < max) last = m.index + m[0].length;
      if (last > max * 0.4) { cut = last; break; }
    }
    if (cut < 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

export function loadVoices() {
  return new Promise((resolve) => {
    if (!ttsSupported) return resolve([]);
    const v = synth.getVoices();
    if (v.length) return resolve(v);
    const on = () => { resolve(synth.getVoices()); };
    synth.addEventListener('voiceschanged', on, { once: true });
    setTimeout(() => resolve(synth.getVoices()), 1200);
  });
}

export function pickVoice(voices, pref, lang = 'pl') {
  if (pref) { const v = voices.find((x) => x.voiceURI === pref || x.name === pref); if (v) return v; }
  const pl = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return pl.find((v) => /google|natural|neural|premium|enhanced/i.test(v.name)) || pl[0] || voices.find((v) => v.default) || voices[0] || null;
}

export class Narrator {
  constructor(host) {
    this.host = host; // { blocks(): [], isSpeakable(i), onSentence(i,s,e), onBlock(i), onState(st), onFinish() }
    this.state = 'idle';
    this.rate = 1;
    this.voice = null;
    this.cur = -1;
    this.sents = [];
    this.si = 0;
    this.end = 0;
    this.token = 0;
    this.errs = 0;
  }

  setRate(r) { this.rate = r; if (this.state === 'playing') this._restartSentence(); }
  setVoice(v) { this.voice = v; if (this.state === 'playing') this._restartSentence(); }

  start(fromBlock, endBlock) {
    this.stop(true);
    this.end = endBlock;
    this.token++;
    this._setState('playing');
    this._enterBlock(this._nextSpeakable(fromBlock));
  }

  _nextSpeakable(i) {
    while (i < this.end && !this.host.isSpeakable(i)) i++;
    return i;
  }

  _enterBlock(i) {
    if (i >= this.end) { this._finish(); return; }
    this.cur = i;
    this.sents = sentences(this.host.text(i));
    const pre = this.host.pre ? this.host.pre(i) : '';
    if (pre) this.sents.unshift({ s: 0, e: 0, t: pre, pre: true });
    this.si = 0;
    this.host.onBlock(i);
    this._speakSentence();
  }

  _speakSentence() {
    if (this.state !== 'playing') return;
    if (this.si >= this.sents.length) { this._enterBlock(this._nextSpeakable(this.cur + 1)); return; }
    const sn = this.sents[this.si];
    const lang = (this.voice && this.voice.lang) || 'pl-PL';
    const chunks = chunkSpeech(expandSpeech(sn.t.trim(), lang));
    const tk = this.token;
    if (sn.pre) this.host.onSentence(-1, 0, 0); else this.host.onSentence(this.cur, sn.s, sn.e);
    const next = () => { if (tk !== this.token || this.state !== 'playing') return; this.si++; this._speakSentence(); };
    const speak = (k) => {
      if (k >= chunks.length) { next(); return; }
      const u = new SpeechSynthesisUtterance(chunks[k]);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'pl-PL';
      u.rate = this.rate;
      u.onend = () => { if (tk !== this.token || this.state !== 'playing') return; this.errs = 0; speak(k + 1); };
      u.onerror = (e) => {
        if (tk !== this.token) return;
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        // syntezator nie działa (brak głosu, brak zgody) — nie przewijaj całego rozdziału w ciszy
        if (++this.errs >= 2) { this.stop(); this.host.onError && this.host.onError(e.error); return; }
        speak(k + 1);
      };
      synth.speak(u);
    };
    speak(0);
  }

  _restartSentence() {
    this.token++;
    synth.cancel();
    this._speakSentence();
  }

  pause() { if (this.state === 'playing') { synth.pause(); this._setState('paused'); this._paused = true; } }
  resume() {
    if (this.state === 'paused') {
      this._setState('playing');
      // część przeglądarek gubi stan wstrzymania – wznów zdanie od nowa
      synth.resume();
      if (!synth.speaking) this._restartSentence();
    }
  }
  toggle(fromBlock, endBlock) {
    if (this.state === 'idle') this.start(fromBlock, endBlock);
    else if (this.state === 'playing') this.pause();
    else this.resume();
  }

  skip(delta) {
    if (this.state === 'idle') return;
    this.token++;
    synth.cancel();
    if (delta > 0) this._enterBlock(this._nextSpeakable(this.cur + 1));
    else {
      let i = this.cur - 1;
      while (i >= 0 && !this.host.isSpeakable(i)) i--;
      this._enterBlock(Math.max(0, i));
    }
    if (this.state === 'paused') { this._setState('playing'); }
  }

  stop(silent) {
    this.token++;
    try { synth.cancel(); } catch { /* brak */ }
    if (!silent) this._setState('idle');
    else this.state = 'idle';
    this.cur = -1;
    this.host.onSentence(-1, 0, 0);
  }

  _finish() {
    this.state = 'idle';
    this.host.onState('idle');
    this.host.onSentence(-1, 0, 0);
    this.host.onFinish();
  }

  _setState(s) { this.state = s; this.host.onState(s); }
}
