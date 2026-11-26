/* Leakvue — job list. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, todayISO, fmtDate, fmtTime, fullAddress, uid, plural } = LV.util;
  const C = LV.catalog;

  LV.model = {
    newJob(fields) {
      const now = Date.now();
      return Object.assign({
        id: uid(),
        number: '',
        status: 'scheduled',
        createdAt: now,
        updatedAt: now,
        date: todayISO(),
        time: '',
        technician: '',
        serviceType: '',
        customer: { name: '', phone: '', email: '' },
        property: { address: '', city: '', state: '', zip: '', type: '', access: '' },
        complaint: '',
        methods: [],
        tests: [],
        result: '',
        findings: [],
        recommendations: '',
        notes: '',
        signature: { name: '', dataUrl: null, signedAt: null },
      }, fields || {});
    },
    newFinding() {
      return { id: uid(), location: '', system: '', severity: '', method: '', marked: false, description: '' };
    },
    newTest() {
      return { id: uid(), name: '', reading: '', outcome: '' };
    },
  };

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      sessionStorage.setItem(key, value);
    } catch (_) { /* storage unavailable: filters just won't be remembered */ }
    return null;
  }

  function matches(job, q) {
    if (!q) return true;
    const hay = [
      job.number, job.customer && job.customer.name, job.customer && job.customer.phone,
      job.customer && job.customer.email, fullAddress(job.property), job.serviceType, job.technician,
    ].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every((t) => hay.indexOf(t) !== -1);
  }

  function sortJobs(a, b) {
    if ((b.date || '') !== (a.date || '')) return (b.date || '').localeCompare(a.date || '');
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  async function createJob() {
    const settings = await LV.db.getSettings();
    const number = await LV.db.nextJobNumber();
    const job = LV.model.newJob({ number, technician: settings.defaultTechnician || '' });
    await LV.db.saveJob(job);
    location.hash = '#/job/' + job.id;
  }

  LV.views.jobs = async function (root) {
    const [jobs, photoCounts] = await Promise.all([LV.db.listJobs(), LV.db.countPhotosByJob()]);
    jobs.sort(sortJobs);

    let query = session('lv.q') || '';
    let status = session('lv.status') || 'all';

    root.innerHTML = html`
      <div class="page-head">
        <div>
          <h1>Jobs</h1>
          <p class="muted">${jobs.length ? plural(jobs.length, 'job') + ' on this device' : 'Nothing logged yet'}</p>
        </div>
        <button type="button" class="btn btn-primary" data-act="new">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
          New job
        </button>
      </div>
      ${jobs.length ? html`
        <div class="toolbar">
          <label class="search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="search" placeholder="Search customer, address, job #" value="${query}" aria-label="Search jobs" data-act="search">
          </label>
          <div class="chips" role="group" aria-label="Filter by status" data-role="chips"></div>
        </div>
        <div class="job-list" data-role="list"></div>` : html`
        <div class="empty">
          <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true"><path d="M32 6C24 18 14 28 14 40a18 18 0 0 0 36 0C50 28 40 18 32 6z" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 42a8 8 0 0 0 8 8" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"/></svg>
          <h2>Log your first leak detection job</h2>
          <p class="muted">Record the customer, the methods and tests you ran, each leak you found with photos, and get the customer's signature. Leakvue turns it into a report you can print or save as a PDF.</p>
          <button type="button" class="btn btn-primary" data-act="new">Start a job</button>
        </div>`}
    `;

    function renderList() {
      const listEl = $('[data-role="list"]', root);
      const chipsEl = $('[data-role="chips"]', root);
      if (!listEl) return;
      const searched = jobs.filter((j) => matches(j, query));
      const counts = { all: searched.length };
      C.statuses.forEach((s) => { counts[s.id] = searched.filter((j) => j.status === s.id).length; });

      chipsEl.innerHTML = html`${[{ id: 'all', label: 'All' }].concat(C.statuses).map((s) => html`
        <button type="button" class="chip${status === s.id ? ' active' : ''}" data-status="${s.id}" aria-pressed="${status === s.id}">
          ${s.label} <span class="chip-count">${counts[s.id]}</span>
        </button>`)}`;

      const shown = searched.filter((j) => status === 'all' || j.status === status);
      if (!shown.length) {
        listEl.innerHTML = html`<p class="muted list-empty">No jobs match${query ? html` “${query}”` : ''}.</p>`;
        return;
      }
      listEl.innerHTML = html`${shown.map((j) => {
        const res = C.results.find((r) => r.id === j.result);
        const findings = (j.findings || []).length;
        const photos = photoCounts[j.id] || 0;
        const meta = [
          fmtDate(j.date) + (j.time ? ' ' + fmtTime(j.time) : ''),
          j.serviceType,
          findings ? plural(findings, 'finding') : '',
          photos ? plural(photos, 'photo') : '',
        ].filter(Boolean).join(' · ');
        return html`
          <a class="job-card" href="#/job/${j.id}">
            <div class="job-card-top">
              <span class="job-no">${j.number || 'No number'}</span>
              <span class="pill status-${j.status}">${C.label(C.statuses, j.status)}</span>
            </div>
            <div class="job-cust">${(j.customer && j.customer.name) || 'Unnamed customer'}</div>
            <div class="job-addr">${fullAddress(j.property) || 'No address yet'}</div>
            <div class="job-meta">
              <span>${meta}</span>
              ${res ? html`<span class="result-tag tone-${res.tone}">${res.label}</span>` : ''}
            </div>
          </a>`;
      })}`;
    }

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="new"]');
      if (btn) {
        btn.disabled = true;
        createJob().catch((err) => { btn.disabled = false; LV.util.toast(err.message, 'error'); });
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
