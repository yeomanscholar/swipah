// Tiny IndexedDB wrapper. Two stores:
//   kv  - session state, the saved folder handle, misc
//   log - every tag-log record (mirrors .swipah/log.jsonl)

const DB_NAME = 'swipah';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('log')) {
          const log = db.createObjectStore('log', { autoIncrement: true });
          log.createIndex('session_id', 'session_id');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const result = fn(t.objectStore(store));
        t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const kv = {
  get: (key) => tx('kv', 'readonly', (s) => s.get(key)),
  set: (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key)),
  del: (key) => tx('kv', 'readwrite', (s) => s.delete(key)),
};

export const logStore = {
  addMany: (records) => tx('log', 'readwrite', (s) => records.forEach((r) => s.add(r))),
  all: () => tx('log', 'readonly', (s) => s.getAll()),
  bySession: (id) => tx('log', 'readonly', (s) => s.index('session_id').getAll(id)),
};
