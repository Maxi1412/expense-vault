const DB = (() => {
  const NAME = 'expense-vault';
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('transactions')) {
          const s = db.createObjectStore('transactions', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('category', 'category');
          s.createIndex('merchant', 'merchant');
        }
        if (!db.objectStoreNames.contains('receipts')) db.createObjectStore('receipts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function withStore(name, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'));
    });
  }

  async function all(name) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(name, 'readonly').objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(name, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(name, 'readonly').objectStore(name).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(name, value) {
    await withStore(name, 'readwrite', store => store.put(value));
    return value;
  }

  async function remove(name, key) {
    await withStore(name, 'readwrite', store => store.delete(key));
  }

  async function clear(name) {
    await withStore(name, 'readwrite', store => store.clear());
  }

  async function getMeta(key, fallback = null) {
    const row = await get('meta', key);
    return row ? row.value : fallback;
  }

  async function setMeta(key, value) {
    return put('meta', { key, value });
  }

  async function exportAll() {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      transactions: await all('transactions'),
      receipts: await all('receipts'),
      meta: await all('meta')
    };
  }

  async function importAll(payload) {
    if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.transactions) || !Array.isArray(payload.meta)) {
      throw new Error('This is not a valid Expense Vault backup.');
    }
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['transactions', 'receipts', 'meta'], 'readwrite');
      const t = tx.objectStore('transactions');
      const r = tx.objectStore('receipts');
      const m = tx.objectStore('meta');
      t.clear(); r.clear(); m.clear();
      payload.transactions.forEach(x => t.put(x));
      (payload.receipts || []).forEach(x => r.put(x));
      payload.meta.forEach(x => m.put(x));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Restore failed'));
    });
  }

  return { open, all, get, put, remove, clear, getMeta, setMeta, exportAll, importAll };
})();