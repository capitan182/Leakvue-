/* Leakvue — on-device storage (IndexedDB). Tests and settings stay on this device
   unless the tech exports a backup. */
(function () {
  'use strict';
  const LV = window.LV;
  const DB_NAME = 'leakvue';
  const DB_VERSION = 2;
  const SETTINGS_KEY = 'app';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('This browser does not support on-device storage (IndexedDB).'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // v1 was an early prototype with jobs/photos stores; nothing in them is carried over.
        ['jobs', 'photos'].forEach((n) => { if (db.objectStoreNames.contains(n)) db.deleteObjectStore(n); });
        if (!db.objectStoreNames.contains('tests')) db.createObjectStore('tests', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Close other Leakvue tabs and reload.'));
    });
    return dbPromise;
  }

  /** Run fn(stores) inside one transaction; resolves after the transaction commits. */
  async function tx(storeNames, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const t = db.transaction(names, mode);
      const stores = {};
      names.forEach((n) => { stores[n] = t.objectStore(n); });
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
      try {
        result = fn(stores, t);
      } catch (e) {
        try { t.abort(); } catch (_) { /* already finished */ }
        reject(e);
      }
    });
  }

  function capture(req) {
    const box = { value: undefined };
    req.onsuccess = () => { box.value = req.result; };
    return box;
  }

  async function rawSettings() {
    const box = await tx('settings', 'readonly', (s) => capture(s.settings.get(SETTINGS_KEY)));
    return box.value;
  }

  const store = {
    async listTests() {
      const box = await tx('tests', 'readonly', (s) => capture(s.tests.getAll()));
      return box.value || [];
    },
    async getTest(id) {
      const box = await tx('tests', 'readonly', (s) => capture(s.tests.get(id)));
      return box.value;
    },
    async saveTest(test) {
      test.updatedAt = Date.now();
      await tx('tests', 'readwrite', (s) => { s.tests.put(test); });
      return test;
    },
    async deleteTest(id) {
      await tx('tests', 'readwrite', (s) => { s.tests.delete(id); });
    },

    async getSettings() {
      return Object.assign({}, LV.catalog.defaultSettings(), (await rawSettings()) || {});
    },
    async saveSettings(settings) {
      await tx('settings', 'readwrite', (s) => { s.settings.put(settings, SETTINGS_KEY); });
      return settings;
    },

    /** Reserve the next test number, e.g. "LV-2026-0007". */
    async nextNumber() {
      let number = '';
      await tx('settings', 'readwrite', (s) => {
        const req = s.settings.get(SETTINGS_KEY);
        req.onsuccess = () => {
          const cur = Object.assign({}, LV.catalog.defaultSettings(), req.result || {});
          const seq = (Number(cur.jobSeq) || 0) + 1;
          cur.jobSeq = seq;
          const prefix = (cur.jobPrefix || '').trim();
          number = (prefix ? prefix + '-' : '') + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
          s.settings.put(cur, SETTINGS_KEY);
        };
      });
      return number;
    },

    async exportAll() {
      const [tests, settings] = await Promise.all([store.listTests(), store.getSettings()]);
      return { app: 'leakvue', version: 2, exportedAt: new Date().toISOString(), settings, tests };
    },
    async importAll(data) {
      if (!data || data.app !== 'leakvue' || !Array.isArray(data.tests)) {
        throw new Error('That file is not a Leakvue backup.');
      }
      const stored = await rawSettings();
      const current = Object.assign({}, LV.catalog.defaultSettings(), stored || {});
      await tx(['tests', 'settings'], 'readwrite', (s) => {
        data.tests.forEach((t) => { if (t && t.id) s.tests.put(t); });
        if (data.settings) {
          let merged;
          if (!stored) {
            merged = Object.assign({}, current, data.settings); // fresh device: take the backup's details
          } else {
            merged = Object.assign({}, current); // keep this device's settings, fill blanks from the backup
            Object.keys(data.settings).forEach((k) => {
              if ((merged[k] === '' || merged[k] == null) && data.settings[k]) merged[k] = data.settings[k];
            });
          }
          merged.jobSeq = Math.max(Number(current.jobSeq) || 0, Number(data.settings.jobSeq) || 0);
          s.settings.put(merged, SETTINGS_KEY);
        }
      });
      return { tests: data.tests.length };
    },
    async eraseAll() {
      await tx(['tests', 'settings'], 'readwrite', (s) => { s.tests.clear(); s.settings.clear(); });
    },
  };

  LV.db = store;
})();
