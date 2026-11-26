/* Leakvue — on-device storage (IndexedDB). Jobs, photos and settings never leave the device
   unless the user exports a backup. */
(function () {
  'use strict';
  const LV = window.LV;
  const DB_NAME = 'leakvue';
  const DB_VERSION = 1;
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
        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('jobId', 'jobId', { unique: false });
        }
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

  /** Run fn(stores) inside one transaction; resolves with fn's result after the transaction commits. */
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

  /** Helper: capture a request's result into an object so it is available after commit. */
  function capture(req) {
    const box = { value: undefined };
    req.onsuccess = () => { box.value = req.result; };
    return box;
  }

  const store = {
    async getAll(name) {
      const box = await tx(name, 'readonly', (s) => capture(s[name].getAll()));
      return box.value || [];
    },
    async get(name, key) {
      const box = await tx(name, 'readonly', (s) => capture(s[name].get(key)));
      return box.value;
    },
    async put(name, value) {
      await tx(name, 'readwrite', (s) => { s[name].put(value); });
      return value;
    },
    async del(name, key) {
      await tx(name, 'readwrite', (s) => { s[name].delete(key); });
    },

    /* ----- jobs ----- */
    listJobs() { return store.getAll('jobs'); },
    getJob(id) { return store.get('jobs', id); },
    saveJob(job) {
      job.updatedAt = Date.now();
      return store.put('jobs', job);
    },
    async deleteJob(jobId) {
      await tx(['jobs', 'photos'], 'readwrite', (s) => {
        s.jobs.delete(jobId);
        const req = s.photos.index('jobId').openKeyCursor(IDBKeyRange.only(jobId));
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) { s.photos.delete(cur.primaryKey); cur.continue(); }
        };
      });
    },

    /* ----- photos ----- */
    async photosForJob(jobId) {
      const box = await tx('photos', 'readonly', (s) => capture(s.photos.index('jobId').getAll(IDBKeyRange.only(jobId))));
      return (box.value || []).sort((a, b) => a.createdAt - b.createdAt);
    },
    savePhoto(photo) { return store.put('photos', photo); },
    deletePhoto(id) { return store.del('photos', id); },
    async countPhotosByJob() {
      // Walk the jobId index with a key cursor: cur.key is the jobId, no photo data is loaded.
      const counts = {};
      await tx('photos', 'readonly', (s) => {
        const req = s.photos.index('jobId').openKeyCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) { counts[cur.key] = (counts[cur.key] || 0) + 1; cur.continue(); }
        };
      });
      return counts;
    },

    /* ----- settings ----- */
    async getSettings() {
      const box = await tx('settings', 'readonly', (s) => capture(s.settings.get(SETTINGS_KEY)));
      return Object.assign({}, LV.catalog.defaultSettings(), box.value || {});
    },
    async saveSettings(settings) {
      await tx('settings', 'readwrite', (s) => { s.settings.put(settings, SETTINGS_KEY); });
      return settings;
    },

    /** Reserve the next job number, e.g. "LV-2026-0007". */
    async nextJobNumber() {
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

    /* ----- backup ----- */
    async exportAll() {
      const [jobs, photos, settings] = await Promise.all([
        store.getAll('jobs'), store.getAll('photos'), store.getSettings(),
      ]);
      return { app: 'leakvue', version: 1, exportedAt: new Date().toISOString(), settings, jobs, photos };
    },
    async importAll(data, opts) {
      if (!data || data.app !== 'leakvue' || !Array.isArray(data.jobs)) {
        throw new Error('That file is not a Leakvue backup.');
      }
      const replaceSettings = opts && opts.replaceSettings;
      const storedBox = await tx('settings', 'readonly', (s) => capture(s.settings.get(SETTINGS_KEY)));
      const stored = storedBox.value;
      const current = Object.assign({}, LV.catalog.defaultSettings(), stored || {});
      await tx(['jobs', 'photos', 'settings'], 'readwrite', (s) => {
        data.jobs.forEach((j) => { if (j && j.id) s.jobs.put(j); });
        (data.photos || []).forEach((p) => { if (p && p.id && p.jobId) s.photos.put(p); });
        if (data.settings) {
          let merged;
          if (replaceSettings || !stored) {
            // Fresh device: take the backup's company details as-is.
            merged = Object.assign({}, current, data.settings);
          } else {
            // Keep this device's settings; only fill in fields that are blank here.
            merged = Object.assign({}, current);
            Object.keys(data.settings).forEach((k) => {
              if ((merged[k] === '' || merged[k] == null) && data.settings[k]) merged[k] = data.settings[k];
            });
          }
          // Never move the job counter backwards.
          merged.jobSeq = Math.max(Number(current.jobSeq) || 0, Number(data.settings.jobSeq) || 0);
          s.settings.put(merged, SETTINGS_KEY);
        }
      });
      return { jobs: data.jobs.length, photos: (data.photos || []).length };
    },
    async eraseAll() {
      await tx(['jobs', 'photos', 'settings'], 'readwrite', (s) => {
        s.jobs.clear(); s.photos.clear(); s.settings.clear();
      });
    },
  };

  LV.db = store;
})();
