// Cienka warstwa nad IndexedDB: biblioteka, treść, pliki, zakreślenia
const DB_NAME = 'lumen';
const DB_VER = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('content')) db.createObjectStore('content');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
      if (!db.objectStoreNames.contains('marks')) {
        const s = db.createObjectStore('marks', { keyPath: 'id' });
        s.createIndex('doc', 'doc');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  get: (store, key) => tx(store, 'readonly', (t) => req2p(t.objectStore(store).get(key))),
  put: (store, val, key) => tx(store, 'readwrite', (t) => req2p(key === undefined ? t.objectStore(store).put(val) : t.objectStore(store).put(val, key))),
  del: (store, key) => tx(store, 'readwrite', (t) => req2p(t.objectStore(store).delete(key))),
  all: (store) => tx(store, 'readonly', (t) => req2p(t.objectStore(store).getAll())),
  keys: (store) => tx(store, 'readonly', (t) => req2p(t.objectStore(store).getAllKeys())),
  byDoc: (docId) => tx('marks', 'readonly', (t) => req2p(t.objectStore('marks').index('doc').getAll(docId))),
  async delDocAll(docId) {
    await tx(['meta', 'content', 'files', 'marks', 'assets'], 'readwrite', async (t) => {
      t.objectStore('meta').delete(docId);
      t.objectStore('content').delete(docId);
      t.objectStore('files').delete(docId);
      const m = t.objectStore('marks').index('doc');
      const keys = await req2p(m.getAllKeys(docId));
      keys.forEach((k) => t.objectStore('marks').delete(k));
      const aKeys = await req2p(t.objectStore('assets').getAllKeys(IDBKeyRange.bound(docId + '/', docId + '/￿')));
      aKeys.forEach((k) => t.objectStore('assets').delete(k));
    });
  },
};

export const kv = {
  async get(key, def) {
    try { const v = await db.get('kv', key); return v === undefined ? def : v; } catch { return def; }
  },
  set: (key, val) => db.put('kv', val, key),
};

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch { /* ignore */ }
  return null;
}
