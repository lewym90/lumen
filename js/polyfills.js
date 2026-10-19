// Uzupełnienia dla starszych przeglądarek (głównie Safari/iOS), potrzebne pdf.js i aplikacji.
(function () {
  const g = typeof self !== 'undefined' ? self : globalThis;
  if (g.ReadableStream && !g.ReadableStream.prototype[Symbol.asyncIterator]) {
    g.ReadableStream.prototype.values = function ({ preventCancel = false } = {}) {
      const reader = this.getReader();
      return {
        async next() {
          try { const r = await reader.read(); if (r.done) reader.releaseLock(); return r; } catch (e) { try { reader.releaseLock(); } catch (_) { /* brak */ } throw e; }
        },
        async return(value) {
          if (!preventCancel) { const p = reader.cancel(value); try { reader.releaseLock(); } catch (_) { /* brak */ } await p; } else { try { reader.releaseLock(); } catch (_) { /* brak */ } }
          return { done: true, value };
        },
        [Symbol.asyncIterator]() { return this; },
      };
    };
    g.ReadableStream.prototype[Symbol.asyncIterator] = g.ReadableStream.prototype.values;
  }
  if (!Promise.withResolvers) {
    Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  }
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', { value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; }, writable: true, configurable: true });
  if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (!Array.prototype.findLast) Object.defineProperty(Array.prototype, 'findLast', { value(f, t) { for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; }, writable: true, configurable: true });
})();
