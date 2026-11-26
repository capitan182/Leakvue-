/* Leakvue — list of pool tests, plus the data model. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, todayISO, fmtDate, fullAddress, uid, plural, toast } = LV.util;
  const C = LV.catalog;
  const K = LV.calc;

  LV.model = {
    newTest(fields, settings) {
      const now = Date.now();
      settings = settings || C.defaultSettings();
      return Object.assign({
        id: uid(),
        number: '',
        status: 'scheduled',
        createdAt: now,
        updatedAt: now,
        date: todayISO(),
        technician: '',
        customer: { name: '', phone: '', email: '' },
        property: { address: '', city: '', state: '', zip: '', access: '' },
        pool: { body: 'Pool', shape: 'rectangle', length: '', width: '', width2: '', diameter: '', area: '', spaArea: '' },
        conditions: { evaporation: String(settings.evaporation), weather: '', autofillOff: true },
        scans: [],
        diagnosis: '',
        message: '',
        notes: '',
        sample: false,
      }, fields || {});
    },

    newScan(fields, settings) {
      return Object.assign({
        id: uid(),
        pump: 'on',
        purpose: 'baseline',
        isolated: '',
        compareTo: '',
        durationMin: String((settings && settings.scanMinutes) || 15),
        dropIn: '',
        readings: null,
        timerStartedAt: null,
        createdAt: Date.now(),
      }, fields || {});
    },

    /** A clearly-labelled demo test with simulated LeakVue readings. */
    sampleTest(number, settings) {
      const t = LV.model.newTest({
        number,
        sample: true,
        status: 'completed',
        technician: settings.defaultTechnician || 'Sample Tech',
        customer: { name: 'Sample Homeowner', phone: '', email: '' },
        property: { address: '123 Example Street', city: 'Anytown', state: 'AZ', zip: '', access: '' },
        pool: { body: 'Pool', shape: 'rectangle', length: '32', width: '16', width2: '', diameter: '', area: '', spaArea: '' },
        conditions: { evaporation: '0.25', weather: '94°F, sunny, light breeze', autofillOff: true },
        message: 'We plugged the return lines and the pool stopped losing more than normal evaporation, so the leak is in the return plumbing. ' +
                 'Next step: pressure test each return line to pinpoint the break, then repair.',
        notes: 'Sample data. Delete this test whenever you like.',
      }, settings);
      const start = Date.now() - 3600 * 1000;
      const on = LV.model.newScan({ pump: 'on', readings: K.sampleReadings(1.1, 15, 11), createdAt: start }, settings);
      const off = LV.model.newScan({ pump: 'off', readings: K.sampleReadings(0.45, 15, 23), createdAt: start + 1200e3 }, settings);
      const iso = LV.model.newScan({
        pump: 'on', purpose: 'isolation', isolated: 'Return lines', compareTo: on.id,
        readings: K.sampleReadings(0.27, 15, 37), createdAt: start + 2400e3,
      }, settings);
      t.scans = [on, off, iso];
      return t;
    },
  };

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      sessionStorage.setItem(key, value);
    } catch (_) { /* not remembered; fine */ }
    return null;
  }

  function matches(t, q) {
    if (!q) return true;
    const hay = [t.number, t.customer && t.customer.name, t.customer && t.customer.phone,
      fullAddress(t.property), t.technician].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.indexOf(w) !== -1);
  }

  /** One-line outcome for the list. */
  function outcome(t, settings) {
    const a = K.analyze(t, settings);
    if (a.status === 'pending') return null;
    if (a.status === 'resolved') return { tone: 'ok', text: 'Leak isolated' };
    if (a.status === 'remaining') return { tone: 'warn', text: 'Still searching' };
    if (a.status === 'normal') return { tone: 'ok', text: 'No leak' };
    const w = a.worst.result;
    return { tone: 'danger', text: 'Leak · ' + (w.leakGal != null ? K.fmtGal(w.leakGal) + ' gal/day' : K.fmtIn(w.leakIn) + ' in/day') };
  }

  async function create(sample) {
    const settings = await LV.db.getSettings();
    const number = await LV.db.nextNumber();
    const t = sample
      ? LV.model.sampleTest(number, settings)
      : LV.model.newTest({ number, technician: settings.defaultTechnician || '' }, settings);
    await LV.db.saveTest(t);
    location.hash = '#/test/' + t.id + (sample ? '/report' : '');
  }

  LV.views.tests = async function (root) {
    const [tests, settings] = await Promise.all([LV.db.listTests(), LV.db.getSettings()]);
    tests.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    let query = session('lv.q') || '';
    let status = session('lv.status') || 'all';

    root.innerHTML = html`
      <div class="page-head">
        <div>
          <h1>Pool tests</h1>
          <p class="muted">${tests.length ? plural(tests.length, 'test') + ' on this device' : 'Nothing logged yet'}</p>
        </div>
        <button type="button" class="btn btn-primary" data-act="new">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
          New test
        </button>
      </div>
      ${tests.length ? html`
        <div class="toolbar">
          <label class="search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="search" placeholder="Search customer, address, test #" value="${query}" aria-label="Search tests" data-act="search">
          </label>
          <div class="chips" role="group" aria-label="Filter by status" data-role="chips"></div>
        </div>
        <div class="job-list" data-role="list"></div>` : html`
        <div class="empty">
          <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true"><path d="M32 6C24 18 14 28 14 40a18 18 0 0 0 36 0C50 28 40 18 32 6z" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round"/><path d="M22 41h20M25 46h14" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"/></svg>
          <h2>Run your first LeakVue test</h2>
          <p class="muted">Enter the pool size, record each scan with the pump on and off, and rescan after you isolate a line. Leakvue works out the gallons and builds a report the homeowner can actually understand.</p>
          <div class="btn-row center">
            <button type="button" class="btn btn-primary" data-act="new">Start a test</button>
            <button type="button" class="btn" data-act="sample">See a sample report</button>
          </div>
        </div>`}
    `;

    function renderList() {
      const listEl = $('[data-role="list"]', root);
      const chipsEl = $('[data-role="chips"]', root);
      if (!listEl) return;
      const searched = tests.filter((t) => matches(t, query));
      const counts = { all: searched.length };
      C.statuses.forEach((s) => { counts[s.id] = searched.filter((t) => t.status === s.id).length; });
      chipsEl.innerHTML = html`${[{ id: 'all', label: 'All' }].concat(C.statuses).map((s) => html`
        <button type="button" class="chip${status === s.id ? ' active' : ''}" data-status="${s.id}" aria-pressed="${status === s.id}">
          ${s.label} <span class="chip-count">${counts[s.id]}</span>
        </button>`)}`;
      const shown = searched.filter((t) => status === 'all' || t.status === status);
      if (!shown.length) {
        listEl.innerHTML = html`<p class="muted list-empty">No tests match${query ? html` “${query}”` : ''}.</p>`;
        return;
      }
      listEl.innerHTML = html`${shown.map((t) => {
        const o = outcome(t, settings);
        const scans = (t.scans || []).length;
        const meta = [fmtDate(t.date), t.pool && t.pool.body, scans ? plural(scans, 'scan') : ''].filter(Boolean).join(' · ');
        return html`
          <a class="job-card" href="#/test/${t.id}">
            <div class="job-card-top">
              <span class="job-no">${t.number || 'No number'}${t.sample ? html` <span class="pill pill-sample">Sample</span>` : ''}</span>
              <span class="pill status-${t.status}">${C.label(C.statuses, t.status)}</span>
            </div>
            <div class="job-cust">${(t.customer && t.customer.name) || 'Unnamed customer'}</div>
            <div class="job-addr">${fullAddress(t.property) || 'No address yet'}</div>
            <div class="job-meta">
              <span>${meta}</span>
              ${o ? html`<span class="result-tag tone-${o.tone}">${o.text}</span>` : ''}
            </div>
          </a>`;
      })}`;
    }

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="new"], [data-act="sample"]');
      if (btn) {
        btn.disabled = true;
        create(btn.dataset.act === 'sample').catch((err) => { btn.disabled = false; toast(err.message, 'error'); });
        return;
      }
      const chip = e.target.closest('[data-status]');
      if (chip) {
        status = chip.dataset.status;
        session('lv.status', status);
        renderList();
      }
    });
    root.addEventListener('input', (e) => {
      if (e.target.dataset.act !== 'search') return;
      query = e.target.value.trim();
      session('lv.q', query);
      renderList();
    });

    renderList();
    return {};
  };
})();
