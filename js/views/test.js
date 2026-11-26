/* Leakvue — the tech's test screen. Everything autosaves to the device. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, $$, debounce, toast, fullAddress, telHref, plural } = LV.util;
  const { field } = LV.form;
  const C = LV.catalog;
  const K = LV.calc;
  const S = LV.story;

  function normalize(t, settings) {
    const base = LV.model.newTest({}, settings);
    Object.keys(base).forEach((k) => { if (t[k] === undefined) t[k] = base[k]; });
    ['customer', 'property', 'pool', 'conditions'].forEach((k) => { t[k] = Object.assign({}, base[k], t[k] || {}); });
    if (!Array.isArray(t.scans)) t.scans = [];
    t.scans = t.scans.map((s) => Object.assign(LV.model.newScan({}, settings), s));
    return t;
  }

  function mapsHref(t) {
    const addr = fullAddress(t.property);
    return addr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr) : null;
  }

  /* ---------- audio + wake lock for the scan timer ---------- */
  let audio = null;
  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audio && Ctx) audio = new Ctx();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (_) { /* no audio */ }
  }
  function chime() {
    if (!audio) return;
    try {
      [0, 0.25, 0.5].forEach((d, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = [880, 1175, 1568][i];
        g.gain.setValueAtTime(0.0001, audio.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d + 0.22);
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + d);
        o.stop(audio.currentTime + d + 0.25);
      });
    } catch (_) { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (_) { wakeLock = null; }
  }

  LV.views.test = async function (root, id) {
    const [found, settings] = await Promise.all([LV.db.getTest(id), LV.db.getSettings()]);
    if (!found) {
      root.innerHTML = html`<div class="empty"><h2>Test not found</h2>
        <p class="muted">It may have been deleted on this device.</p>
        <a class="btn" href="#/tests">Back to tests</a></div>`;
      return {};
    }
    const t = normalize(found, settings);
    let deleted = false;

    /* ---------- saving ---------- */
    function setSaveState(state) {
      const el = $('[data-role="save"]', root);
      if (!el) return;
      el.dataset.state = state;
      el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Saved';
    }
    const save = debounce(async () => {
      if (deleted) return;
      try {
        await LV.db.saveTest(t);
        setSaveState('saved');
      } catch (err) {
        console.error(err);
        setSaveState('error');
        toast('Could not save: ' + err.message, 'error');
      }
    }, 450);
    function touch() { setSaveState('saving'); save(); }

    const f = (label, path, o) => field(t, label, path, o);
    const analysis = () => K.analyze(t, settings);

    /* ---------- pool ---------- */
    function poolDimsTpl() {
      const p = t.pool;
      const ft = { inputmode: 'decimal', type: 'text' };
      const dims = [];
      if (p.shape === 'rectangle' || p.shape === 'oval') {
        dims.push(f('Length (ft)', 'pool.length', ft), f('Width (ft)', 'pool.width', ft));
      } else if (p.shape === 'round') {
        dims.push(f('Diameter (ft)', 'pool.diameter', ft));
      } else if (p.shape === 'kidney') {
        dims.push(f('Length (ft)', 'pool.length', ft), f('Width, wide end (ft)', 'pool.width', ft), f('Width, narrow end (ft)', 'pool.width2', ft));
      } else if (p.shape === 'area') {
        dims.push(f('Surface area (sq ft)', 'pool.area', ft));
      }
      if (/spa/i.test(p.body) && /pool/i.test(p.body)) {
        dims.push(f('Attached spa surface (sq ft)', 'pool.spaArea', Object.assign({ hint: 'Add it if the spa shares water with the pool.' }, ft)));
      }
      return html`${dims}`;
    }
    function poolSummaryTpl() {
      const area = K.surfaceArea(t.pool);
      if (area == null) return html`<span class="muted">Enter the size to turn inches into gallons.</span>`;
      const gpi = K.gallonsPerInch(area);
      return html`Surface ≈ <strong>${Math.round(area).toLocaleString()} sq ft</strong> · 1 inch of water ≈ <strong>${K.fmtGal(gpi)} gallons</strong>`;
    }

    /* ---------- scans ---------- */
    function compareOptions(i) {
      const opts = [{ id: '', label: 'Automatic (last scan with the same pump setting)' }];
      for (let k = 0; k < i; k++) {
        const s = t.scans[k];
        opts.push({ id: s.id, label: S.scanName({ scan: s, index: k }) });
      }
      return opts;
    }

    function resultLine(s) {
      const a = analysis();
      const r = K.scanResult(s, { gpi: a.gpi, evap: a.evap, margin: a.margin });
      if (!r) return html`<span class="muted">Enter the water drop when the scan finishes.</span>`;
      if (r.rising) return html`<span class="tone-warn">Water level rose. Check auto-fill, rain, swimmers or a running hose.</span>`;
      const total = r.totalGal != null ? html` · about <strong>${K.fmtGal(r.totalGal)} gal/day</strong> total` : '';
      const leak = r.isLeak
        ? html`<span class="tone-danger"><strong>${r.leakGal != null ? K.fmtGal(r.leakGal) + ' gal/day' : K.fmtIn(r.leakIn) + ' in/day'}</strong> more than normal evaporation</span>`
        : html`<span class="tone-ok">within normal evaporation</span>`;
      return html`<strong>${K.fmtIn(r.totalIn)} in/day</strong>${total} → ${leak}`;
    }

    function timerTpl(s) {
      if (s.readings && s.readings.length) return '';
      return html`<button type="button" class="btn btn-sm timer-btn" data-act="timer" data-id="${s.id}"></button>`;
    }

    function scansTpl() {
      if (!t.scans.length) {
        return html`<p class="muted small">No scans yet. Start with the pump ON, then run the same scan with the pump OFF.</p>`;
      }
      return html`${t.scans.map((s, i) => {
        const iso = s.purpose === 'isolation';
        const fromDevice = s.readings && s.readings.length >= 3;
        const rate = fromDevice ? K.scanRate(s) : null;
        return html`
          <article class="scan${iso ? ' scan-iso' : ''}" data-scan="${s.id}">
            <header class="scan-head">
              <h3><span class="scan-num">${i + 1}</span> <span data-role="scan-title">${iso ? 'Rescan after isolating' : 'Scan'}</span></h3>
              <button type="button" class="btn btn-quiet btn-sm" data-act="remove-scan" data-index="${i}">Remove</button>
            </header>
            <div class="grid">
              <div class="field">
                <span class="field-label" id="pump-${s.id}">Pump</span>
                <div class="seg-toggle" role="radiogroup" aria-labelledby="pump-${s.id}">
                  ${C.pumps.map((p) => html`<label><input type="radio" name="pump-${s.id}" value="${p.id}" data-field="scans.${i}.pump" ${s.pump === p.id ? 'checked' : ''}><span>${p.short}</span></label>`)}
                </div>
              </div>
              ${f('Scan type', 'scans.' + i + '.purpose', { type: 'select', blankLabel: false, options: [{ id: 'baseline', label: 'Test scan' }, { id: 'isolation', label: 'Rescan after isolating' }] })}
              ${iso ? f('What did you isolate?', 'scans.' + i + '.isolated', { list: 'lv-isolations', placeholder: 'e.g. Main drain, Return lines' }) : ''}
              ${iso ? f('Compare with', 'scans.' + i + '.compareTo', { type: 'select', blankLabel: false, options: compareOptions(i) }) : ''}
              ${fromDevice ? html`
                <div class="field full">
                  <span class="field-label">From LeakVue readings</span>
                  <p class="readings-note">Dropped <strong>${K.fmtIn(rate.dropIn, 4)} in</strong> over ${LV.charts.mmss(rate.durationMin * 60)} (${plural(s.readings.length, 'reading')})</p>
                </div>` : html`
                ${f('Scan length (min)', 'scans.' + i + '.durationMin', { inputmode: 'decimal' })}
                ${f('Water drop (inches)', 'scans.' + i + '.dropIn', { inputmode: 'decimal', placeholder: 'e.g. 0.0115', hint: 'Use a minus sign if the level rose.' })}`}
            </div>
            <div class="scan-foot">
              <p class="scan-result" data-role="result">${resultLine(s)}</p>
              ${timerTpl(s)}
            </div>
            ${fromDevice ? LV.charts.levelChart(s.readings, rate.fit, { title: S.scanName({ scan: s, index: i }) }) : ''}
          </article>`;
      })}`;
    }

    /* ---------- live results ---------- */
    function resultsTpl() {
      const a = analysis();
      if (!a.done.length) return html`<p class="muted small">Results appear here as you record scans.</p>`;
      const pat = S.pattern(a);
      const rows = S.baselineRows(a);
      return html`
        ${pat ? html`<div class="callout"><strong>${pat.title}</strong><p>${pat.body}</p></div>` : ''}
        ${rows.length ? LV.charts.lossBars(rows) : ''}
        ${a.steps.map((st) => {
          const txt = S.stepText(st);
          return html`<div class="step">
            <div class="badge badge-${txt.tone}">${badgeIcon(txt.tone)} ${txt.badge}</div>
            ${LV.charts.lossBars(S.stepRows(st), { legend: false })}
            <p class="small">${txt.text}</p>
          </div>`;
        })}
        ${a.gpi == null ? html`<p class="small muted">Add the pool size above to see gallons.</p>` : ''}
      `;
    }
    function badgeIcon(tone) {
      if (tone === 'ok') return LV.util.raw('<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
      if (tone === 'warn') return LV.util.raw('<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2l6.5 12h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 12v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
      return LV.util.raw('<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 7.5v4M8 5v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
    }

    /* ---------- page ---------- */
    root.innerHTML = html`
      <div class="job-head">
        <a class="back" href="#/tests" aria-label="Back to tests">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <div class="job-head-title">
          <h1 data-role="title">${t.customer.name || 'New test'}</h1>
          <div class="muted small">${t.number}</div>
        </div>
        <span class="save-state" data-role="save" data-state="saved" aria-live="polite">Saved</span>
        <a class="btn btn-primary" href="#/test/${t.id}/report">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span>Report</span>
        </a>
      </div>

      ${t.sample ? html`<p class="sample-banner">This is a sample test with simulated LeakVue readings. Change anything you like, or delete it at the bottom.</p>` : ''}

      <datalist id="lv-isolations">${C.isolationSuggestions.map((s) => html`<option value="${s}"></option>`)}</datalist>

      <section class="card">
        <h2>Customer & visit</h2>
        <div class="grid">
          ${f('Customer name', 'customer.name', { autocomplete: 'off' })}
          <div class="field">
            <label for="f-customer-phone">Phone</label>
            <div class="input-action">
              <input id="f-customer-phone" type="tel" data-field="customer.phone" value="${t.customer.phone}" inputmode="tel" autocomplete="off">
              <a class="btn btn-quiet btn-sm" data-role="call" href="${telHref(t.customer.phone) || '#'}" ${telHref(t.customer.phone) ? '' : 'hidden'}>Call</a>
            </div>
          </div>
          ${f('Email', 'customer.email', { type: 'email', inputmode: 'email', autocomplete: 'off' })}
          ${f('Street address', 'property.address', { full: true, autocomplete: 'off' })}
          ${f('City', 'property.city', { autocomplete: 'off' })}
          ${f('State', 'property.state', { autocomplete: 'off' })}
          ${f('ZIP', 'property.zip', { inputmode: 'numeric', autocomplete: 'off' })}
          ${f('Date', 'date', { type: 'date' })}
          ${f('Technician', 'technician', { autocomplete: 'off' })}
          ${f('Status', 'status', { type: 'select', options: C.statuses, blankLabel: false })}
          ${f('Access notes', 'property.access', { full: true, placeholder: 'Gate code, dog, equipment location… (not on the report)' })}
        </div>
        <a class="link-row" data-role="maps" target="_blank" rel="noopener" href="${mapsHref(t) || '#'}" ${mapsHref(t) ? '' : 'hidden'}>Open address in Maps ↗</a>
      </section>

      <section class="card">
        <h2>Pool size</h2>
        <div class="grid">
          ${f('What are we testing?', 'pool.body', { type: 'select', options: C.bodies, blankLabel: false })}
          ${f('Shape', 'pool.shape', { type: 'select', options: C.shapes, blankLabel: false })}
          <div class="contents" data-role="dims">${poolDimsTpl()}</div>
        </div>
        <p class="pool-summary" data-role="pool-summary">${poolSummaryTpl()}</p>
      </section>

      <section class="card">
        <h2>Conditions</h2>
        <div class="grid">
          ${f('Normal evaporation (in/day)', 'conditions.evaporation', { inputmode: 'decimal', hint: 'Typically 0.1–0.3. Use more on hot, dry or windy days.' })}
          ${f('Weather', 'conditions.weather', { placeholder: 'e.g. 94°F, sunny, light wind' })}
          ${f('Auto-fill turned off for the test', 'conditions.autofillOff', { type: 'checkbox' })}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Scans</h2>
        </div>
        <div data-role="scans">${scansTpl()}</div>
        <div class="add-scan-row">
          <button type="button" class="btn" data-act="add-scan" data-pump="on" data-purpose="baseline">+ Pump ON scan</button>
          <button type="button" class="btn" data-act="add-scan" data-pump="off" data-purpose="baseline">+ Pump OFF scan</button>
          <button type="button" class="btn" data-act="add-scan" data-purpose="isolation">+ Rescan after isolating</button>
        </div>
      </section>

      <section class="card">
        <h2>Results</h2>
        <div data-role="results">${resultsTpl()}</div>
        <div class="grid">
          ${f('Diagnosis shown on the report', 'diagnosis', { type: 'select', options: C.diagnosisOptions, blankLabel: false, full: true })}
        </div>
      </section>

      <section class="card">
        <h2>Message to the homeowner</h2>
        ${f('Shown on the report under “Next steps”', 'message', { type: 'textarea', full: true, rows: 4, placeholder: 'e.g. We plugged the return lines and the loss stopped, so the leak is in the return plumbing. Next we will pressure test each return line to pinpoint it.' })}
      </section>

      <section class="card">
        <h2>Internal notes</h2>
        ${f('For you and the office (not on the report)', 'notes', { type: 'textarea', full: true, rows: 3 })}
      </section>

      <section class="card danger-zone">
        <div>
          <h2>Delete test</h2>
          <p class="muted small">Removes this test from this device.</p>
        </div>
        <button type="button" class="btn btn-danger" data-act="delete">Delete test</button>
      </section>
    `;

    /* ---------- partial re-renders ---------- */
    function renderScans() {
      $('[data-role="scans"]', root).innerHTML = scansTpl();
      LV.charts.enhance(root);
      tickTimers();
    }
    function renderResults() {
      $('[data-role="results"]', root).innerHTML = resultsTpl();
    }
    const renderResultsSoon = debounce(renderResults, 150);
    function updateResultLines() {
      t.scans.forEach((s) => {
        const el = $('[data-scan="' + s.id + '"] [data-role="result"]', root);
        if (el) el.innerHTML = resultLine(s);
      });
    }

    /* ---------- timers ---------- */
    function tickTimers() {
      let anyRunning = false;
      t.scans.forEach((s) => {
        const btn = $('[data-act="timer"][data-id="' + s.id + '"]', root);
        const dur = (K.num(s.durationMin) || 15) * 60;
        if (s.timerStartedAt) {
          const left = Math.ceil(dur - (Date.now() - s.timerStartedAt) / 1000);
          if (left <= 0) {
            s.timerStartedAt = null;
            touch();
            chime();
            const idx = t.scans.indexOf(s) + 1;
            toast('Scan ' + idx + ' is done. Enter the water drop.');
            const input = $('[data-scan="' + s.id + '"] [data-field$=".dropIn"]', root);
            if (input) input.focus();
          } else {
            anyRunning = true;
            if (btn) { btn.textContent = 'Stop timer · ' + LV.charts.mmss(left) + ' left'; btn.classList.add('running'); }
            return;
          }
        }
        if (btn) { btn.textContent = 'Start ' + LV.charts.mmss(dur) + ' timer'; btn.classList.remove('running'); }
      });
      keepAwake(anyRunning);
    }
    const timerInterval = setInterval(tickTimers, 1000);

    /* ---------- events ---------- */
    LV.form.bind(root, () => t, (path) => {
      touch();
      if (path === 'customer.name') {
        $('[data-role="title"]', root).textContent = t.customer.name || 'New test';
      } else if (path === 'customer.phone') {
        const a = $('[data-role="call"]', root);
        const href = telHref(t.customer.phone);
        a.hidden = !href;
        if (href) a.href = href;
      } else if (path.indexOf('property.') === 0) {
        const a = $('[data-role="maps"]', root);
        const href = mapsHref(t);
        a.hidden = !href;
        if (href) a.href = href;
      }
      if (path === 'pool.shape' || path === 'pool.body') {
        $('[data-role="dims"]', root).innerHTML = poolDimsTpl();
      }
      if (path.indexOf('pool.') === 0) {
        $('[data-role="pool-summary"]', root).innerHTML = poolSummaryTpl();
      }
      if (/^scans\.\d+\.(pump|purpose)$/.test(path)) {
        const s = t.scans[Number(path.split('.')[1])];
        if (path.endsWith('.purpose') && s.purpose !== 'isolation') { s.isolated = ''; s.compareTo = ''; }
        renderScans();
      } else if (/^scans\.\d+\.durationMin$/.test(path)) {
        tickTimers();
      }
      if (path.indexOf('pool.') === 0 || path.indexOf('conditions.') === 0 || path.indexOf('scans.') === 0 || path === 'diagnosis') {
        updateResultLines();
        renderResultsSoon();
      }
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !root.contains(btn)) return;
      const act = btn.dataset.act;
      if (act === 'add-scan') {
        const purpose = btn.dataset.purpose;
        let pump = btn.dataset.pump;
        if (!pump) {
          // A rescan usually repeats the setting where the leak showed most.
          const a = analysis();
          pump = a.worst ? a.worst.scan.pump : 'on';
        }
        t.scans.push(LV.model.newScan({ pump, purpose }, settings));
        if (t.status === 'scheduled') {
          t.status = 'in_progress';
          const sel = $('#f-status', root);
          if (sel) sel.value = t.status;
        }
        renderScans();
        renderResults();
        touch();
        const last = $$('.scan', root).pop();
        if (last) {
          last.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const focus = $(purpose === 'isolation' ? '[data-field$=".isolated"]' : '[data-field$=".dropIn"]', last);
          if (focus) focus.focus({ preventScroll: true });
        }
      } else if (act === 'remove-scan') {
        const i = Number(btn.dataset.index);
        if (!confirm('Remove scan ' + (i + 1) + '?')) return;
        const removed = t.scans.splice(i, 1)[0];
        t.scans.forEach((s) => { if (s.compareTo === removed.id) s.compareTo = ''; });
        renderScans();
        renderResults();
        touch();
      } else if (act === 'timer') {
        const s = t.scans.find((x) => x.id === btn.dataset.id);
        if (!s) return;
        if (s.timerStartedAt) {
          s.timerStartedAt = null;
        } else {
          unlockAudio();
          s.timerStartedAt = Date.now();
        }
        touch();
        tickTimers();
      } else if (act === 'delete') {
        if (!confirm('Delete test ' + t.number + '? This cannot be undone.')) return;
        deleted = true;
        await LV.db.deleteTest(t.id);
        toast('Test deleted');
        location.hash = '#/tests';
      }
    });

    LV.charts.enhance(root);
    tickTimers();

    async function flush() { await save.flush(); }
    return {
      flush,
      async destroy() {
        clearInterval(timerInterval);
        keepAwake(false);
        await flush();
      },
    };
  };
})();
