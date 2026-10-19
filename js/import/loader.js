// Leniwe ładowanie bibliotek UMD (JSZip, mammoth) z katalogu vendor
const loaded = new Map();
export function loadScript(path, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (loaded.has(path)) return loaded.get(path);
  const url = new URL('../../' + path, import.meta.url).href;
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => reject(new Error('Nie udało się załadować ' + path));
    document.head.append(s);
  });
  loaded.set(path, p);
  return p;
}
