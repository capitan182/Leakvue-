/* Leakvue — job editor. Every change autosaves to the device. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, $$, debounce, toast, fmtDateTime, fullAddress, telHref } = LV.util;
  const { field } = LV.form;
  const C = LV.catalog;

  /** Fill in anything missing (older or imported jobs). */
  function normalize(job) {
    const base = LV.model.newJob();
    Object.keys(base).forEach((k) => { if (job[k] === undefined) job[k] = base[k]; });
    ['customer', 'property', 'signature'].forEach((k) => {
      job[k] = Object.assign({}, base[k], job[k] || {});
    });
    ['methods', 'tests', 'findings'].forEach((k) => { if (!Array.isArray(job[k])) job[k] = []; });
    return job;
  }

  function mapsHref(job) {
    const addr = fullAddress(job.property);
    return addr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr) : null;
  }

  LV.views.job = async function (root, id) {
    const found = await LV.db.getJob(id);
    if (!found) {
      root.innerHTML = html`<div class="empty"><h2>Job not found</h2>
        <p class="muted">It may have been deleted on this device.</p>
        <a class="btn" href="#/jobs">Back to jobs</a></div>`;
      return {};
    }
    const job = normalize(found);
    const allPhotos = await LV.db.photosForJob(id);
    let deleted = false;

    /* ---------- saving ---------- */
    const saveState = () => $('[data-role="save"]', root);
    function setSaveState(state) {
      const el = saveState();
      if (!el) return;
      el.dataset.state = state;
      el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Saved';
    }
    const save = debounce(async () => {
      if (deleted) return;
      try {
        await LV.db.saveJob(job);
        setSaveState('saved');
      } catch (err) {
        console.error(err);
        setSaveState('error');
        toast('Could not save: ' + err.message, 'error');
      }
    }, 450);
    function touch() { setSaveState('saving'); save(); }

    /* ---------- templates ---------- */
    const f = (label, path, o) => field(job, label, path, o);
    const methodOptions = C.methods.map((m) => ({ id: m.id, label: m.label }));

    function testsTpl() {
      if (!job.tests.length) {
        return html`<p class="muted small">No tests recorded yet. Add meter checks, pressure tests, dye or bucket tests and their readings.</p>`;
      }
      return html`<div class="test-rows">
        <div class="test-row test-head" aria-hidden="true"><span>Test</span><span>Reading / result</span><span>Outcome</span><span></span></div>
        ${job.tests.map((t, i) => html`
          <div class="test-row" data-test="${t.id}">
            <input data-field="tests.${i}.name" value="${t.name}" list="lv-test-suggestions" placeholder="Test" aria-label="Test ${i + 1} name">
            <input data-field="tests.${i}.reading" value="${t.reading}" placeholder="e.g. 60 psi → 42 psi in 15 min" aria-label="Test ${i + 1} reading">
            <select data-field="tests.${i}.outcome" aria-label="Test ${i + 1} outcome">
              ${C.testOutcomes.map((o) => html`<option value="${o.id}" ${o.id === t.outcome ? 'selected' : ''}>${o.label}</option>`)}
            </select>
            <button type="button" class="icon-btn" data-act="remove-test" data-index="${i}" aria-label="Remove test ${i + 1}" title="Remove">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
            </button>
          </div>`)}
      </div>`;
    }

    function findingsTpl() {
      if (!job.findings.length) {
        return html`<p class="muted small">No leaks recorded. Add one for each leak you locate.</p>`;
      }
      return html`${job.findings.map((fd, i) => html`
        <article class="finding" data-finding="${fd.id}">
          <header class="finding-head">
            <h3><span class="finding-num">${i + 1}</span> Leak ${i + 1}</h3>
            <button type="button" class="btn btn-quiet btn-sm" data-act="remove-finding" data-index="${i}">Remove</button>
          </header>
          <div class="grid">
            ${f('Location', 'findings.' + i + '.location', { full: true, placeholder: 'e.g. Kitchen slab, 4 ft from north wall, under dishwasher' })}
            ${f('System', 'findings.' + i + '.system', { type: 'select', options: C.systems })}
            ${f('Severity', 'findings.' + i + '.severity', { type: 'select', options: C.severities })}
            ${f('Located with', 'findings.' + i + '.method', { type: 'select', options: methodOptions })}
            ${f('Location marked on site', 'findings.' + i + '.marked', { type: 'checkbox' })}
            ${f('Details', 'findings.' + i + '.description', { type: 'textarea', full: true, rows: 3, placeholder: 'What you observed, readings at the spot, depth, line size…' })}
          </div>
          <div class="sub-label">Photos of this leak</div>
          <div data-finding-photos="${fd.id}"></div>
        </article>`)}`;
    }

    const sigTime = () => (job.signature.signedAt ? 'Signed ' + fmtDateTime(job.signature.signedAt) : 'Not signed yet');

    root.innerHTML = html`
      <div class="job-head">
        <a class="back" href="#/jobs" aria-label="Back to jobs">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <div class="job-head-title">
          <h1 data-role="title">${job.customer.name || 'New job'}</h1>
          <div class="muted small">${job.number}</div>
        </div>
        <span class="save-state" data-role="save" data-state="saved" aria-live="polite">Saved</span>
        <a class="btn btn-primary" href="#/job/${job.id}/report">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span>Report</span>
        </a>
      </div>

      <datalist id="lv-test-suggestions">${C.testSuggestions.map((s) => html`<option value="${s}"></option>`)}</datalist>

      <section class="card">
        <h2>Job</h2>
        <div class="grid">
          ${f('Status', 'status', { type: 'select', options: C.statuses, blankLabel: false })}
          ${f('Service', 'serviceType', { type: 'select', options: C.serviceTypes })}
          ${f('Date', 'date', { type: 'date' })}
          ${f('Arrival time', 'time', { type: 'time' })}
          ${f('Technician', 'technician', { autocomplete: 'off' })}
        </div>
      </section>

      <section class="card">
        <h2>Customer & property</h2>
        <div class="grid">
          ${f('Customer name', 'customer.name', { autocomplete: 'off' })}
          <div class="field">
            <label for="f-customer-phone">Phone</label>
            <div class="input-action">
              <input id="f-customer-phone" type="tel" data-field="customer.phone" value="${job.customer.phone}" inputmode="tel" autocomplete="off">
              <a class="btn btn-quiet btn-sm" data-role="call" href="${telHref(job.customer.phone) || '#'}" ${telHref(job.customer.phone) ? '' : 'hidden'}>Call</a>
            </div>
          </div>
          ${f('Email', 'customer.email', { type: 'email', inputmode: 'email', autocomplete: 'off' })}
          ${f('Street address', 'property.address', { full: true, autocomplete: 'off' })}
          ${f('City', 'property.city', { autocomplete: 'off' })}
          ${f('State', 'property.state', { autocomplete: 'off' })}
          ${f('ZIP', 'property.zip', { inputmode: 'numeric', autocomplete: 'off' })}
          ${f('Property type', 'property.type', { type: 'select', options: C.propertyTypes })}
          ${f('Access notes', 'property.access', { full: true, placeholder: 'Gate code, meter location, pets… (not shown on the report)' })}
        </div>
        <a class="link-row" data-role="maps" target="_blank" rel="noopener" href="${mapsHref(job) || '#'}" ${mapsHref(job) ? '' : 'hidden'}>Open address in Maps ↗</a>
      </section>

      <section class="card">
        <h2>Reason for call</h2>
        ${f("Customer's concern", 'complaint', { type: 'textarea', full: true, rows: 3, placeholder: 'e.g. Water bill doubled, warm spot on living room floor, sound of running water with all fixtures off' })}
      </section>

      <section class="card">
        <h2>Detection methods</h2>
        <div class="method-grid" role="group" aria-label="Detection methods used">
          ${C.methods.map((m) => html`
            <label class="method">
              <input type="checkbox" data-method="${m.id}" ${job.methods.indexOf(m.id) !== -1 ? 'checked' : ''}>
              <span>${m.label}</span>
            </label>`)}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Tests & readings</h2>
          <button type="button" class="btn btn-sm" data-act="add-test">+ Add test</button>
        </div>
        <div data-role="tests">${testsTpl()}</div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Findings</h2>
          <button type="button" class="btn btn-sm" data-act="add-finding">+ Add leak</button>
        </div>
        <div class="grid">
          ${f('Overall result', 'result', { type: 'select', options: C.results, full: true })}
        </div>
        <div data-role="findings">${findingsTpl()}</div>
      </section>

      <section class="card">
        <h2>Recommendations</h2>
        ${f('Recommended repairs and next steps', 'recommendations', { type: 'textarea', full: true, rows: 4, placeholder: 'e.g. Reroute hot water line overhead; spot repair at marked location; retest after repair' })}
      </section>

      <section class="card">
        <h2>Site photos</h2>
        <p class="muted small">Meter, equipment, overview shots. Photos of a specific leak go under that leak above.</p>
        <div data-role="general-photos"></div>
      </section>

      <section class="card">
        <h2>Customer sign-off</h2>
        <div class="grid">
          ${f('Printed name', 'signature.name', { placeholder: job.customer.name || 'Customer name', autocomplete: 'off' })}
        </div>
        <div class="sig-wrap">
          <canvas class="sig-pad" aria-label="Signature pad. Sign with your finger, stylus or mouse."></canvas>
          <span class="sig-hint" data-role="sig-hint" ${job.signature.dataUrl ? 'hidden' : ''}>Sign here</span>
        </div>
        <div class="sig-actions">
          <span class="muted small" data-role="sig-time">${sigTime()}</span>
          <button type="button" class="btn btn-quiet btn-sm" data-act="clear-sig">Clear signature</button>
        </div>
      </section>

      <section class="card">
        <h2>Internal notes</h2>
        ${f('Notes for the office (not shown on the report)', 'notes', { type: 'textarea', full: true, rows: 3 })}
      </section>

      <section class="card danger-zone">
        <div>
          <h2>Delete job</h2>
          <p class="muted small">Removes this job and its photos from this device.</p>
        </div>
        <button type="button" class="btn btn-danger" data-act="delete-job">Delete job</button>
      </section>
    `;

    /* ---------- photo grids ---------- */
    const grids = {};
    function mountGeneralPhotos() {
      grids.general = LV.photos.mount($('[data-role="general-photos"]', root), {
        jobId: job.id,
        findingId: null,
        photos: allPhotos.filter((p) => !p.findingId),
      });
    }
    function mountFindingPhotos() {
      Object.keys(grids).forEach((k) => { if (k !== 'general') delete grids[k]; });
      $$('[data-finding-photos]', root).forEach((el) => {
        const fid = el.dataset.findingPhotos;
        grids[fid] = LV.photos.mount(el, {
          jobId: job.id,
          findingId: fid,
          photos: allPhotos.filter((p) => p.findingId === fid),
          onChange(list) {
            // Keep allPhotos in sync so re-rendering findings shows the latest set.
            for (let i = allPhotos.length - 1; i >= 0; i--) if (allPhotos[i].findingId === fid) allPhotos.splice(i, 1);
            Array.prototype.push.apply(allPhotos, list);
          },
        });
      });
    }
    async function flushGrids() {
      await Promise.all(Object.keys(grids).map((k) => grids[k].flush()));
    }
    function renderFindings() {
      flushGrids();
      $('[data-role="findings"]', root).innerHTML = findingsTpl();
      mountFindingPhotos();
    }
    function renderTests() {
      $('[data-role="tests"]', root).innerHTML = testsTpl();
    }
    mountGeneralPhotos();
    mountFindingPhotos();

    /* ---------- signature ---------- */
    const pad = LV.signature.attach($('.sig-pad', root), {
      value: job.signature.dataUrl,
      onChange(dataUrl) {
        job.signature.dataUrl = dataUrl;
        job.signature.signedAt = dataUrl ? Date.now() : null;
        $('[data-role="sig-time"]', root).textContent = sigTime();
        $('[data-role="sig-hint"]', root).hidden = !!dataUrl;
        touch();
      },
    });

    /* ---------- events ---------- */
    LV.form.bind(root, () => job, (path) => {
      touch();
      if (path === 'customer.name') {
        $('[data-role="title"]', root).textContent = job.customer.name || 'New job';
        const sig = $('#f-signature-name', root);
        if (sig) sig.placeholder = job.customer.name || 'Customer name';
      } else if (path === 'customer.phone') {
        const a = $('[data-role="call"]', root);
        const href = telHref(job.customer.phone);
        a.hidden = !href;
        if (href) a.href = href;
      } else if (path.indexOf('property.') === 0) {
        const a = $('[data-role="maps"]', root);
        const href = mapsHref(job);
        a.hidden = !href;
        if (href) a.href = href;
      } else if (/^findings\.\d+\.method$/.test(path)) {
        // Using a method to locate a leak implies it was used: tick it.
        const fd = job.findings[Number(path.split('.')[1])];
        if (fd && fd.method && job.methods.indexOf(fd.method) === -1) {
          job.methods.push(fd.method);
          job.methods = C.methods.map((m) => m.id).filter((m) => job.methods.indexOf(m) !== -1);
          const box = $('[data-method="' + fd.method + '"]', root);
          if (box) box.checked = true;
        }
      }
    });

    root.addEventListener('change', (e) => {
      const m = e.target.dataset && e.target.dataset.method;
      if (!m) return;
      const set = new Set(job.methods);
      if (e.target.checked) set.add(m); else set.delete(m);
      job.methods = C.methods.map((x) => x.id).filter((x) => set.has(x));
      touch();
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !root.contains(btn)) return;
      const act = btn.dataset.act;

      if (act === 'add-test') {
        job.tests.push(LV.model.newTest());
        renderTests();
        touch();
        const rows = $$('.test-row[data-test] input', root);
        if (rows.length) rows[rows.length - 2].focus();
      } else if (act === 'remove-test') {
        job.tests.splice(Number(btn.dataset.index), 1);
        renderTests();
        touch();
      } else if (act === 'add-finding') {
        job.findings.push(LV.model.newFinding());
        if (!job.result) {
          job.result = 'leak_found';
          const sel = $('#f-result', root);
          if (sel) sel.value = 'leak_found';
        }
        renderFindings();
        touch();
        const last = $$('.finding', root).pop();
        if (last) {
          last.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const loc = $('input[data-field$=".location"]', last);
          if (loc) loc.focus({ preventScroll: true });
        }
      } else if (act === 'remove-finding') {
        const i = Number(btn.dataset.index);
        const fd = job.findings[i];
        const photos = allPhotos.filter((p) => p.findingId === fd.id);
        const msg = 'Remove leak ' + (i + 1) + (photos.length ? ' and its ' + photos.length + ' photo(s)?' : '?');
        if (!confirm(msg)) return;
        await Promise.all(photos.map((p) => LV.db.deletePhoto(p.id)));
        for (let k = allPhotos.length - 1; k >= 0; k--) if (allPhotos[k].findingId === fd.id) allPhotos.splice(k, 1);
        job.findings.splice(i, 1);
        renderFindings();
        touch();
      } else if (act === 'clear-sig') {
        if (job.signature.dataUrl && !confirm('Clear the signature?')) return;
        pad.clear();
      } else if (act === 'delete-job') {
        if (!confirm('Delete job ' + job.number + ' and all of its photos? This cannot be undone.')) return;
        deleted = true;
        await LV.db.deleteJob(job.id);
        toast('Job deleted');
        location.hash = '#/jobs';
      }
    });

    async function flush() {
      await flushGrids();
      await save.flush();
    }
    return { flush, destroy: flush };
  };
})();
