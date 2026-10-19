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
  return out.filter((x) => x.t.trim().length);
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
    this.si = 0;
    this.host.onBlock(i);
    this._speakSentence();
  }

  _speakSentence() {
    if (this.state !== 'playing') return;
    if (this.si >= this.sents.length) { this._enterBlock(this._nextSpeakable(this.cur + 1)); return; }
    const sn = this.sents[this.si];
    const u = new SpeechSynthesisUtterance(sn.t.trim());
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'pl-PL';
    u.rate = this.rate;
    const tk = this.token;
    this.host.onSentence(this.cur, sn.s, sn.e);
    u.onend = () => { if (tk !== this.token || this.state !== 'playing') return; this.si++; this._speakSentence(); };
    u.onerror = (e) => { if (tk !== this.token) return; if (e.error === 'canceled' || e.error === 'interrupted') return; this.si++; this._speakSentence(); };
    synth.speak(u);
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
