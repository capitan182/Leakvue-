/* Leakvue — the tech's test screen. Everything autosaves to the device. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, $$, debounce, toast, fmtDate, plural } = LV.util;
  const { field } = LV.form;
  const C = LV.catalog;
  const K = LV.calc;
  const S = LV.story;

  function normalize(t, settings) {
    const base = LV.model.newTest({}, settings);
    Object.keys(base).forEach((k) => { if (t[k] === undefined) t[k] = base[k]; });
    ['pool', 'conditions'].forEach((k) => { t[k] = Object.assign({}, base[k], t[k] || {}); });
    if (!Array.isArray(t.scans)) t.scans = [];
    if (!Array.isArray(t.otherBodies)) t.otherBodies = [];
    t.scans = t.scans.map((s) => {
      const scan = Object.assign(LV.model.newScan({}, settings), s);
      if (!s.condition) scan.condition = s.pump === 'off' ? 'off' : 'on'; // older scans: pump on/off only
      scan.pump = C.conditionOf(scan).pump; // keeps the pump ON vs OFF math in step with the setting
      scan.bodyId = K.bodyIdOf(scan, t);
      return scan;
    });
    return t;
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

    // The name a tech types becomes this device's default, so every new test after this one is filled in.
    const rememberTechnician = debounce(async (name) => {
      name = (name || '').trim();
      if (!name || name === settings.defaultTechnician) return;
      settings.defaultTechnician = name;
      try { await LV.db.saveSettings(settings); } catch (_) { /* not critical */ }
    }, 800);

    /* ---------- pool ---------- */
    /** Size fields for one body of water. prefix is 'pool' or 'otherBodies.<n>'. */
    function dimsTpl(prefix, p) {
      const ft = { inputmode: 'decimal', type: 'text' };
      const dims = [];
      if (p.shape === 'rectangle' || p.shape === 'oval') {
        dims.push(f('Length (ft)', prefix + '.length', ft), f('Width (ft)', prefix + '.width', ft));
      } else if (p.shape === 'round') {
        dims.push(f('Diameter (ft)', prefix + '.diameter', ft));
      } else if (p.shape === 'kidney') {
        dims.push(f('Length (ft)', prefix + '.length', ft), f('Width, wide end (ft)', prefix + '.width', ft), f('Width, narrow end (ft)', prefix + '.width2', ft));
      } else if (p.shape === 'area') {
        dims.push(f('Surface area (sq ft)', prefix + '.area', ft));
      }
      if (/spa/i.test(p.body) && /pool/i.test(p.body)) {
        dims.push(f('Attached spa surface (sq ft)', prefix + '.spaArea', Object.assign({ hint: 'Add it if the spa shares water with the pool.' }, ft)));
      }
      return html`${dims}`;
    }
    function summaryTpl(p) {
      const area = K.surfaceArea(p);
      if (area == null) return html`<span class="muted">Size is optional. Inches a day is the standard; add the size to also show gallons.</span>`;
      const gpi = K.gallonsPerInch(area);
      return html`Surface ≈ <strong>${Math.round(area).toLocaleString()} sq ft</strong> · 1 inch of water ≈ <strong>${K.fmtGal(gpi)} gallons</strong>`;
    }
    function poolDimsTpl() { return dimsTpl('pool', t.pool); }
    function poolSummaryTpl() { return summaryTpl(t.pool); }

    /* ---------- other bodies of water (a spa, fountain… tested separately) ---------- */
    const multi = () => t.otherBodies.length > 0;
    function otherBodiesTpl() {
      return html`${t.otherBodies.map((b, k) => html`
        <div class="body-block" data-body="${b.id}">
          <div class="card-head">
            <h3>${S.bodyName(t, b.id)}</h3>
            <button type="button" class="btn btn-quiet btn-sm" data-act="remove-body" data-index="${k}">Remove</button>
          </div>
          <div class="grid">
            ${f('What is it?', 'otherBodies.' + k + '.body', { type: 'select', options: C.bodies, blankLabel: false })}
            ${f('Shape', 'otherBodies.' + k + '.shape', { type: 'select', options: C.shapes, blankLabel: false })}
            <div class="contents" data-role="dims-${k}">${dimsTpl('otherBodies.' + k, b)}</div>
          </div>
          <p class="pool-summary" data-role="summary-${k}">${summaryTpl(b)}</p>
        </div>`)}`;
    }
    function renderBodies() {
      $('[data-role="other-bodies"]', root).innerHTML = otherBodiesTpl();
      $('[data-role="bodies-title"]', root).textContent = multi() ? 'Bodies of water' : 'Pool size';
      $('[data-role="main-name"]', root).hidden = !multi();
      $('[data-role="main-name"]', root).textContent = S.bodyName(t, 'main');
    }
    /** The analysis for the body a scan belongs to. */
    function analysisFor(s) {
      return K.analyze(t, settings, K.bodiesOf(t).find((b) => b.id === K.bodyIdOf(s, t)));
    }

    /* ---------- scans ---------- */
    function compareOptions(i) {
      const opts = [{ id: '', label: 'Automatic (last scan with the same setting)' }];
      const body = K.bodyIdOf(t.scans[i], t);
      for (let k = 0; k < i; k++) {
        const s = t.scans[k];
        if (K.bodyIdOf(s, t) === body) opts.push({ id: s.id, label: S.scanName({ scan: s, index: k }) });
      }
      return opts;
    }

    function resultLine(s) {
      const a = analysisFor(s);
      const r = K.scanResult(s, { gpi: a.gpi, evap: a.evap, margin: a.margin });
      if (!r) return html`<span class="muted">Enter the water drop when the scan finishes.</span>`;
      if (r.rising) {
        return html`<span class="tone-warn"><strong>Water level went up</strong>, so water was being added (auto-fill, hose, rain or
          spillover from a spa or waterfall). This scan is left out of the results. Stop the water and scan again.</span>`;
      }
      const total = r.totalGal != null ? html` · about <strong>${K.fmtGal(r.totalGal)} gal/day</strong> total` : '';
      const leak = r.isLeak
        ? html`<span class="tone-danger"><strong>${r.leakGal != null ? K.fmtGal(r.leakGal) + ' gal/day' : K.fmtIn(r.leakIn) + ' in/day'}</strong> more than normal evaporation</span>`
        : html`<span class="tone-ok">within normal evaporation</span>`;
      return html`<strong>${K.fmtIn(r.totalIn)} in/day</strong>${total} → ${leak}`;
    }

    function timerTpl(s) {
      if ((s.readings && s.readings.length) || R.recordingScan() === s.id) return '';
      return html`<button type="button" class="btn btn-sm timer-btn" data-act="timer" data-id="${s.id}"></button>`;
    }

    /* ---------- recording from the LeakVue (alongside its own app) ---------- */
    const R = LV.recorder;
    const appName = (model) => (model === 1 ? 'the LeakVue 1 app' : 'the ALD app');
    function recordTpl(s) {
      if (!R.available()) return '';
      const rec = R.recordingScan();
      if (rec === s.id) return html`<button type="button" class="btn btn-sm record-btn running" data-act="record" data-id="${s.id}">Stop recording</button>`;
      if (rec || !R.connected()) return '';
      const has = s.readings && s.readings.length;
      return html`<button type="button" class="btn btn-sm record-btn" data-act="record" data-id="${s.id}">${has ? 'Record again' : 'Record from LeakVue'}</button>`;
    }
    function deviceTpl() {
      if (!R.available()) return '';
      const r = R.state();
      if (r.status === 'connected') {
        const scanNo = t.scans.findIndex((x) => x.id === R.recordingScan()) + 1;
        let live;
        if (!R.heard() && !R.quiet()) live = 'Connected. Listening for readings…';
        else if (R.quiet()) live = html`<span class="tone-warn">Waiting for readings. Press Test in ${appName(r.device.model)}.</span>`;
        else if (r.outOfZone) live = html`<span class="tone-warn">The float is out of the testing zone. Adjust the fine screw.</span>`;
        else if (r.slow) live = html`Live, about one reading a second (${appName(r.device.model)} is on its sensor screen). Press Test there for full speed.`;
        else live = 'Live readings coming in.';
        return html`
          <div class="device-row">
            <p><span class="dot-live" aria-hidden="true"></span><strong>${r.device.name}</strong> connected <span class="muted">· LeakVue ${r.device.model}</span></p>
            <button type="button" class="btn btn-quiet btn-sm" data-act="lv-disconnect">Disconnect</button>
          </div>
          <p class="small" data-role="device-live">${live}${R.recordingScan() ? html` <strong>Recording scan ${scanNo || ''}.</strong>` : ''}</p>`;
      }
      if (r.status === 'finding' || r.status === 'connecting') return html`<p class="small muted">Looking for the LeakVue…</p>`;
      if (r.status === 'choose') {
        return html`<p class="small">More than one LeakVue is connected. Which one?</p>
          <div class="device-choices">${r.candidates.map((d) => html`<button type="button" class="btn btn-sm" data-act="lv-choose" data-id="${d.deviceId}" data-name="${d.name || ''}">${d.name || d.deviceId}</button>`)}</div>`;
      }
      return html`
        <div class="device-row">
          <p class="small muted">Record each scan straight from the LeakVue while its own app runs the test.</p>
          <button type="button" class="btn btn-sm" data-act="lv-connect">Connect LeakVue</button>
        </div>
        ${r.message ? html`<p class="small ${r.status === 'error' || r.status === 'none' ? 'tone-warn' : ''}">${r.message}</p>` : ''}`;
    }
    function readingsNoteTpl(s, rate) {
      const a = R.state().active;
      if (a && a.scanId === s.id) {
        const n = s.readings ? s.readings.length : 0;
        const last = n ? s.readings[n - 1] : null;
        return html`<strong>Recording…</strong> ${plural(n, 'reading')}${last ? html` · ${LV.charts.mmss(last[0])} so far` : ''}${a.skipped ? html` · ${plural(a.skipped, 'out-of-zone reading')} skipped` : ''}`;
      }
      return html`Dropped <strong>${K.fmtIn(rate.dropIn, 4)} in</strong> over ${LV.charts.mmss(rate.durationMin * 60)} (${plural(s.readings.length, 'reading')}) <button type="button" class="btn-link small" data-act="clear-readings" data-id="${s.id}">Clear readings</button>`;
    }

    function scansTpl() {
      if (!t.scans.length) {
        return html`<p class="muted small">No scans yet. Add one scan for each setting you test: entire system, pump on, water feature and so on.</p>`;
      }
      return html`${t.scans.map((s, i) => {
        const iso = s.purpose === 'isolation';
        const live = R.recordingScan() === s.id;
        const fromDevice = live || (s.readings && s.readings.length >= 3);
        const rate = s.readings && s.readings.length >= 3 ? K.scanRate(s) : null;
        return html`
          <article class="scan${iso ? ' scan-iso' : ''}" data-scan="${s.id}">
            <header class="scan-head">
              <h3><span class="scan-num">${i + 1}</span> <span data-role="scan-title">${iso ? 'Rescan after isolating' : 'Scan'}${multi() ? html` <span class="muted">· ${S.bodyName(t, K.bodyIdOf(s, t))}</span>` : ''}</span></h3>
              <button type="button" class="btn btn-quiet btn-sm" data-act="remove-scan" data-index="${i}">Remove</button>
            </header>
            <div class="grid">
              ${multi() ? f('Which body of water?', 'scans.' + i + '.bodyId', { type: 'select', blankLabel: false, options: K.bodiesOf(t).map((b) => ({ id: b.id, label: S.bodyName(t, b.id) })) }) : ''}
              ${f('What was running?', 'scans.' + i + '.condition', { type: 'select', blankLabel: false, options: C.conditions.map((c) => ({ id: c.id, label: c.label })) })}
              ${f('Scan type', 'scans.' + i + '.purpose', { type: 'select', blankLabel: false, options: [{ id: 'baseline', label: 'Test scan' }, { id: 'isolation', label: 'Rescan after isolating' }] })}
              ${iso ? f('What did you isolate?', 'scans.' + i + '.isolated', { list: 'lv-isolations', placeholder: 'e.g. Main drain, Return lines' }) : ''}
              ${iso ? f('Compare with', 'scans.' + i + '.compareTo', { type: 'select', blankLabel: false, options: compareOptions(i) }) : ''}
              ${fromDevice ? html`
                <div class="field full">
                  <span class="field-label">From LeakVue readings</span>
                  <p class="readings-note" data-role="readings-note">${readingsNoteTpl(s, rate)}</p>
                </div>` : html`
                ${f('Scan length (min)', 'scans.' + i + '.durationMin', { inputmode: 'decimal' })}
                <div class="field">
                  <span class="field-label" id="dir-${s.id}">Water level went</span>
                  <div class="seg-toggle" role="radiogroup" aria-labelledby="dir-${s.id}">
                    <label><input type="radio" name="dir-${s.id}" value="down" data-field="scans.${i}.direction" ${s.direction !== 'up' ? 'checked' : ''}><span>Down</span></label>
                    <label><input type="radio" name="dir-${s.id}" value="up" data-field="scans.${i}.direction" ${s.direction === 'up' ? 'checked' : ''}><span>Up</span></label>
                  </div>
                </div>
                ${f('How much (inches)', 'scans.' + i + '.dropIn', { inputmode: 'decimal', placeholder: 'e.g. 0.0115', hint: 'Up means water was being added: that scan is left out.' })}`}
            </div>
            <div class="scan-foot">
              <p class="scan-result" data-role="result">${resultLine(s)}</p>
              <div class="scan-actions">${recordTpl(s)}${timerTpl(s)}</div>
            </div>
            <div data-role="chart">${rate ? LV.charts.levelChart(s.readings, rate.fit, { title: S.scanName({ scan: s, index: i }) }) : ''}</div>
          </article>`;
      })}`;
    }

    /* ---------- live results ---------- */
    function resultsTpl() {
      if (!multi()) return bodyResultsTpl(analysis());
      const all = K.analyzeAll(t, settings);
      if (!all.some((x) => x.a.done.length)) return html`<p class="muted small">Results appear here as you record scans.</p>`;
      return html`${all.map((x) => html`
        <div class="body-results">
          <h3>${S.bodyName(t, x.body.id)}</h3>
          ${x.a.done.length ? bodyResultsTpl(x.a) : html`<p class="muted small">No scans for this one yet.</p>`}
        </div>`)}`;
    }
    function bodyResultsTpl(a) {
      if (!a.done.length) return html`<p class="muted small">Results appear here as you record scans.</p>`;
      const pat = S.pattern(a);
      const rows = S.baselineRows(a);
      const risen = a.risen.length ? html`<div class="callout callout-warn">
          <strong>${a.status === 'rising' ? 'Every scan had water added' : plural(a.risen.length, 'scan') + ' left out'}</strong>
          <p>The level went up in scan ${a.risen.map((x) => x.index + 1).join(', ')}, so water was being added. Check the auto-fill, hoses and any
          spillover, then scan again.${a.status === 'rising' ? ' The report asks the homeowner for a retest.' : ''}</p>
        </div>` : '';
      return html`
        ${risen}
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
        ${a.gpi == null ? html`<p class="small muted">Add the size above to also see gallons.</p>` : ''}
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
          <h1>${t.number || 'New test'}</h1>
          <div class="muted small" data-role="subtitle">${fmtDate(t.date)}</div>
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
        <h2>Visit</h2>
        <div class="grid visit-grid">
          ${f('Date', 'date', { type: 'date' })}
          ${f('Technician', 'technician', { autocomplete: 'off' })}
        </div>
      </section>

      <section class="card">
        <h2 data-role="bodies-title">${multi() ? 'Bodies of water' : 'Pool size'}</h2>
        <h3 class="body-main-name" data-role="main-name" ${multi() ? '' : 'hidden'}>${S.bodyName(t, 'main')}</h3>
        <div class="grid">
          ${f('What are we testing?', 'pool.body', { type: 'select', options: C.bodies, blankLabel: false })}
          ${f('Shape', 'pool.shape', { type: 'select', options: C.shapes, blankLabel: false })}
          <div class="contents" data-role="dims">${poolDimsTpl()}</div>
        </div>
        <p class="pool-summary" data-role="pool-summary">${poolSummaryTpl()}</p>
        <div data-role="other-bodies">${otherBodiesTpl()}</div>
        <button type="button" class="btn btn-sm add-body" data-act="add-body">+ Add another body of water</button>
        <p class="muted small add-body-hint">For a spa, fountain or basin you test separately, with its own scans. If you test them as one system, leave this alone.</p>
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
        ${R.available() ? html`<div class="device-panel" data-role="device">${deviceTpl()}</div>` : ''}
        <div data-role="scans">${scansTpl()}</div>
        <div class="add-scan-row">
          <button type="button" class="btn" data-act="add-scan" data-purpose="baseline">+ Add a scan</button>
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
      const a = R.state().active;
      if (a && a.testId === t.id) {
        const btn = $('[data-act="record"][data-id="' + a.scanId + '"]', root);
        const left = Math.max(0, Math.ceil(a.durationSec - (Date.now() - a.start) / 1000));
        if (btn) btn.textContent = 'Stop recording · ' + LV.charts.mmss(left) + ' left';
      }
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
      if (path === 'date') $('[data-role="subtitle"]', root).textContent = fmtDate(t.date);
      if (path === 'technician') rememberTechnician(t.technician);
      if (path === 'pool.shape' || path === 'pool.body') {
        $('[data-role="dims"]', root).innerHTML = poolDimsTpl();
      }
      if (path.indexOf('pool.') === 0) {
        $('[data-role="pool-summary"]', root).innerHTML = poolSummaryTpl();
      }
      const ob = /^otherBodies\.(\d+)\.(\w+)$/.exec(path);
      if (ob) {
        const k = Number(ob[1]);
        if (ob[2] === 'shape' || ob[2] === 'body') $('[data-role="dims-' + k + '"]', root).innerHTML = dimsTpl('otherBodies.' + k, t.otherBodies[k]);
        const sum = $('[data-role="summary-' + k + '"]', root);
        if (sum) sum.innerHTML = summaryTpl(t.otherBodies[k]);
      }
      // A body's kind changed: its name shows on the size card, the scans and the results.
      if (multi() && (path === 'pool.body' || (ob && ob[2] === 'body'))) {
        $$('[data-body] h3', root).forEach((h, k) => { h.textContent = S.bodyName(t, t.otherBodies[k].id); });
        $('[data-role="main-name"]', root).textContent = S.bodyName(t, 'main');
        renderScans();
      }
      if (/^scans\.\d+\.bodyId$/.test(path)) renderScans();
      if (/^scans\.\d+\.(condition|purpose)$/.test(path)) {
        const s = t.scans[Number(path.split('.')[1])];
        if (path.endsWith('.purpose') && s.purpose !== 'isolation') { s.isolated = ''; s.compareTo = ''; }
        if (path.endsWith('.condition')) s.pump = C.conditionOf(s).pump;
        renderScans();
      } else if (/^scans\.\d+\.durationMin$/.test(path)) {
        tickTimers();
      }
      if (path.indexOf('pool.') === 0 || path.indexOf('otherBodies.') === 0 || path.indexOf('conditions.') === 0 ||
          path.indexOf('scans.') === 0 || path === 'diagnosis') {
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
        // A new scan goes to the first body of water with no scans yet (pool first, then a spa that
        // was just added), otherwise to the same body as the last scan.
        const prev = t.scans[t.scans.length - 1];
        const empty = K.bodiesOf(t).find((b) => !t.scans.some((x) => K.bodyIdOf(x, t) === b.id));
        const bodyId = purpose !== 'isolation' && empty ? empty.id : prev ? K.bodyIdOf(prev, t) : 'main';
        let condition;
        if (purpose === 'isolation') {
          // A rescan usually repeats the setting where the leak showed most.
          const a = analysisFor({ bodyId });
          condition = a.worst ? C.conditionOf(a.worst.scan).id : 'on';
        } else {
          // Usual order: entire system first, then pump on, then anything else the tech picks.
          const has = (side) => t.scans.some((x) => x.purpose !== 'isolation' && x.pump === side && K.bodyIdOf(x, t) === bodyId);
          condition = !has('off') ? 'off' : !has('on') ? 'on' : 'feature';
        }
        t.scans.push(LV.model.newScan({ condition, pump: C.conditions.find((c) => c.id === condition).pump, purpose, bodyId }, settings));
        renderScans();
        renderResults();
        touch();
        const last = $$('.scan', root).pop();
        if (last) {
          last.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const focus = $(purpose === 'isolation' ? '[data-field$=".isolated"]' : '[data-field$=".dropIn"]', last);
          if (focus) focus.focus({ preventScroll: true });
        }
      } else if (act === 'add-body') {
        // The other body is usually the spa when the first is the pool, and the pool otherwise.
        const kind = /spa/i.test(t.pool.body || '') ? 'Pool' : 'Spa';
        t.otherBodies.push({ id: LV.util.uid(), body: kind, shape: kind === 'Spa' ? 'round' : 'rectangle', length: '', width: '', width2: '', diameter: '', area: '' });
        renderBodies();
        renderScans();
        renderResults();
        touch();
      } else if (act === 'remove-body') {
        const k = Number(btn.dataset.index);
        const b = t.otherBodies[k];
        const its = t.scans.filter((s) => s.bodyId === b.id);
        if (!confirm('Remove the ' + S.bodyName(t, b.id).toLowerCase() + (its.length ? ' and its ' + plural(its.length, 'scan') : '') + '?')) return;
        t.otherBodies.splice(k, 1);
        t.scans = t.scans.filter((s) => s.bodyId !== b.id);
        t.scans.forEach((s) => { if (its.some((x) => x.id === s.compareTo)) s.compareTo = ''; });
        renderBodies();
        renderScans();
        renderResults();
        touch();
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
      } else if (act === 'lv-connect') {
        await R.connect();
      } else if (act === 'lv-choose') {
        await R.connectTo(btn.dataset.id, btn.dataset.name);
      } else if (act === 'lv-disconnect') {
        if (R.recordingScan() && !confirm('Stop recording and disconnect? The readings so far are kept.')) return;
        await R.disconnect();
      } else if (act === 'record') {
        const s = t.scans.find((x) => x.id === btn.dataset.id);
        if (!s) return;
        if (R.recordingScan() === s.id) { await R.stopRecording('stopped'); return; }
        if (s.readings && s.readings.length && !confirm('Replace the ' + plural(s.readings.length, 'reading') + ' on this scan?')) return;
        unlockAudio();
        s.timerStartedAt = null;
        try {
          const a = R.startRecording({ testId: t.id, scanId: s.id, durationSec: (K.num(s.durationMin) || 15) * 60 });
          s.readings = a.readings;
        } catch (err) { toast(err.message, 'error'); return; }
        touch();
        renderScans();
        renderResults();
      } else if (act === 'clear-readings') {
        const s = t.scans.find((x) => x.id === btn.dataset.id);
        if (!s || !confirm('Clear the LeakVue readings on this scan? You can type the drop in instead.')) return;
        s.readings = null;
        touch();
        renderScans();
        renderResults();
      } else if (act === 'delete') {
        if (!confirm('Delete test ' + t.number + '? This cannot be undone.')) return;
        deleted = true;
        await LV.db.deleteTest(t.id);
        toast('Test deleted');
        location.hash = '#/tests';
      }
    });

    /* ---------- live recording ---------- */
    function renderDevice() {
      const el = $('[data-role="device"]', root);
      if (el) el.innerHTML = deviceTpl();
    }
    function updateLive(s) {
      const art = $('[data-scan="' + s.id + '"]', root);
      if (!art) return;
      const rate = s.readings && s.readings.length >= 3 ? K.scanRate(s) : null;
      const note = $('[data-role="readings-note"]', art);
      if (note) note.innerHTML = readingsNoteTpl(s, rate);
      const chart = $('[data-role="chart"]', art);
      if (chart && rate) {
        chart.innerHTML = LV.charts.levelChart(s.readings, rate.fit, { title: S.scanName({ scan: s, index: t.scans.indexOf(s) }) });
        LV.charts.enhance(chart);
      }
    }
    // If this test's scan is being recorded (the tech left and came back), pick the readings up again.
    const act0 = R.state().active;
    if (act0 && act0.testId === t.id) {
      const s = t.scans.find((x) => x.id === act0.scanId);
      if (s) s.readings = act0.readings;
    }
    const detach = R.attach(t.id, (a) => {
      const s = t.scans.find((x) => x.id === a.scanId);
      if (!s) return;
      s.readings = a.readings;
      touch();
      updateLive(s);
      updateResultLines();
      renderResultsSoon();
    });
    const offRecorder = R.on((kind, st, a) => {
      if (kind === 'finished' && a && a.testId === t.id) {
        const i = t.scans.findIndex((x) => x.id === a.scanId);
        renderScans();
        renderResults();
        renderDevice();
        if (a.endReason === 'done') {
          chime();
          toast('Scan ' + (i + 1) + ' recorded: ' + plural(a.readings.length, 'reading') + '.');
        } else if (a.endReason === 'stopped') {
          toast('Recording stopped. ' + plural(a.readings.length, 'reading') + ' kept.');
        }
        return;
      }
      if (kind === 'started' || kind === 'state') {
        renderDevice();
        renderScans();
        return;
      }
      if (kind === 'tick') renderDevice();
    });

    LV.charts.enhance(root);
    tickTimers();

    async function flush() { await save.flush(); }
    return {
      flush,
      async destroy() {
        clearInterval(timerInterval);
        detach();
        offRecorder();
        keepAwake(false);
        await flush();
      },
    };
  };
})();
