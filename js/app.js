/* Leakvue — router and startup. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, $$, toast } = LV.util;

  const routes = [
    { re: /^#\/tests\/?$/, view: 'tests', nav: 'tests' },
    { re: /^#\/test\/([\w-]+)\/report\/?$/, view: 'report', nav: 'tests', bare: true },
    { re: /^#\/test\/([\w-]+)\/?$/, view: 'test', nav: 'tests' },
    { re: /^#\/settings\/?$/, view: 'settings', nav: 'settings' },
    { re: /^#\/lab\/?$/, view: 'lab', nav: 'lab' },
  ];

  let current = null;
  let renderSeq = 0;

  async function route() {
    const hash = location.hash || '#/tests';
    let match = null;
    let params = [];
    for (const r of routes) {
      const m = hash.match(r.re);
      if (m) { match = r; params = m.slice(1); break; }
    }
    if (!match) { location.replace('#/tests'); return; }

    const seq = ++renderSeq;
    if (current && current.destroy) {
      try { await current.destroy(); } catch (err) { console.error(err); }
    }
    current = null;
    if (seq !== renderSeq) return;

    // Swap in a fresh container so listeners from the previous view are dropped.
    const old = $('#app');
    const root = old.cloneNode(false);
    old.replaceWith(root);
    document.body.classList.toggle('is-report', !!match.bare);
    $$('[data-nav]').forEach((a) => {
      if (a.dataset.nav === match.nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    try {
      const view = await LV.views[match.view].apply(null, [root].concat(params));
      if (seq !== renderSeq) { if (view && view.destroy) view.destroy(); return; }
      current = view || {};
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      root.innerHTML = html`<div class="empty"><h2>Something went wrong</h2>
        <p class="muted">${err.message}</p><a class="btn" href="#/tests">Back to tests</a></div>`;
    }
  }

  async function refreshBrand(settings) {
    try {
      const s = settings || (await LV.db.getSettings());
      const el = $('#brand-co');
      if (el) el.textContent = s.companyName || '';
    } catch (_) { /* ignore */ }
  }

  function flushCurrent() {
    // Save anything still waiting on its debounce. The view stays usable afterwards.
    if (current && current.flush) Promise.resolve(current.flush()).catch(() => {});
  }

  LV.app = { refreshBrand };

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushCurrent(); });
  window.addEventListener('pagehide', flushCurrent);

  async function start() {
    try {
      await LV.db.getSettings(); // opens the database
    } catch (err) {
      $('#app').innerHTML = html`<div class="empty"><h2>Storage unavailable</h2>
        <p class="muted">${err.message}</p>
        <p class="muted">Private browsing modes can block on-device storage. Open Leakvue in a regular window.</p></div>`;
      return;
    }
    refreshBrand();
    // The Device Lab needs Bluetooth, which only the native iPhone/iPad app has.
    if (LV.native.isNative()) {
      document.documentElement.classList.add('is-native');
      $$('[data-nav="lab"]').forEach((a) => { a.hidden = false; });
    }
    route();

    // Ask the browser not to evict saved tests under storage pressure.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist(); }).catch(() => {});
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable:', err));
    }
  }

  window.addEventListener('error', (e) => { if (e.message) toast(e.message, 'error'); });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason && e.reason.message;
    if (msg) toast(msg, 'error');
  });

  start();
})();
