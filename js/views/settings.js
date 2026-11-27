/* Leakvue — company details for the report, test defaults, and backups. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, debounce, toast, download, readFile, plural } = LV.util;
  const { field } = LV.form;
  const C = LV.catalog;

  function bytes(n) {
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function nextNumberHint(settings) {
    const prefix = (settings.jobPrefix || '').trim();
    return 'Next test: ' + (prefix ? prefix + '-' : '') + new Date().getFullYear() + '-' + String((Number(settings.jobSeq) || 0) + 1).padStart(4, '0');
  }

  LV.views.settings = async function (root) {
    const settings = await LV.db.getSettings();
    const f = (label, path, o) => field(settings, label, path, o);

    function setSaveState(state) {
      const el = $('[data-role="save"]', root);
      if (el) { el.dataset.state = state; el.textContent = state === 'saving' ? 'Saving…' : 'Saved'; }
    }
    const save = debounce(async () => {
      try {
        await LV.db.saveSettings(settings);
        LV.app.refreshBrand(settings);
        setSaveState('saved');
      } catch (err) {
        toast('Could not save settings: ' + err.message, 'error');
      }
    }, 400);
    function touch() { setSaveState('saving'); save(); }

    function logoTpl() {
      return settings.logo
        ? html`<img class="logo-preview" src="${settings.logo}" alt="Company logo">
               <button type="button" class="btn btn-quiet btn-sm" data-act="remove-logo">Remove logo</button>`
        : html`<p class="muted small">No logo yet. A PNG with a transparent background looks best.</p>`;
    }

    root.innerHTML = html`
      <div class="page-head">
        <div>
          <h1>Settings</h1>
          <p class="muted">Stored on this device only.</p>
        </div>
        <span class="save-state" data-role="save" data-state="saved" aria-live="polite">Saved</span>
      </div>

      <section class="card">
        <h2>Company (shown on reports)</h2>
        <div class="grid">
          ${f('Company name', 'companyName', { full: true, autocomplete: 'organization' })}
          ${f('Location / franchise line', 'companyTagline', { full: true, placeholder: 'e.g. Serving the Greater Phoenix Area' })}
          ${f('Phone', 'phone', { type: 'tel', inputmode: 'tel' })}
          ${f('Email', 'email', { type: 'email', inputmode: 'email' })}
          ${f('Website', 'website', { inputmode: 'url', placeholder: 'example.com' })}
          ${f('License #', 'license')}
        </div>
        <div class="sub-label">Logo</div>
        <div class="logo-row" data-role="logo">${logoTpl()}</div>
        <button type="button" class="btn btn-sm" data-act="pick-logo">Upload logo</button>
        <input type="file" accept="image/*" hidden data-act="logo-file">
      </section>

      <section class="card">
        <h2>Test defaults</h2>
        <div class="grid">
          ${f('Scan length (minutes)', 'scanMinutes', { inputmode: 'numeric', hint: 'Used for new scans. Techs can change it per scan.' })}
          ${f('Normal evaporation (in/day)', 'evaporation', { inputmode: 'decimal', hint: 'Starting value for new tests. Adjust per test for the weather.' })}
          ${f('Leak margin (in/day)', 'margin', { inputmode: 'decimal', hint: 'Loss this close to evaporation counts as normal. 0.1 in/day is about 30 gal/day on a 16×32 pool.' })}
          ${f('Water cost ($ per 1,000 gal)', 'waterCost', { inputmode: 'decimal', placeholder: 'Leave blank to hide', hint: 'Shows homeowners a monthly cost. Check your local water rate.' })}
          ${f('Test number prefix', 'jobPrefix', { hint: nextNumberHint(settings) })}
          ${f('Technician on this device', 'defaultTechnician', { hint: 'Filled in on every new test. It also updates when you type a name on a test.' })}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Fine print</h2>
          <button type="button" class="btn btn-quiet btn-sm" data-act="reset-disclaimer">Reset to default</button>
        </div>
        ${f('Printed at the bottom of every report', 'disclaimer', { type: 'textarea', full: true, rows: 5 })}
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p class="muted small">Tests live in this browser on this device. Export a backup regularly, and use it to move tests to another device.</p>
        <p class="small" data-role="usage"></p>
        <div class="btn-row">
          <button type="button" class="btn" data-act="export">Export backup</button>
          <button type="button" class="btn" data-act="pick-import">Import backup</button>
          <input type="file" accept="application/json,.json" hidden data-act="import-file">
        </div>
      </section>

      <section class="card danger-zone">
        <div>
          <h2>Erase this device</h2>
          <p class="muted small">Deletes every test and setting stored here.</p>
        </div>
        <button type="button" class="btn btn-danger" data-act="erase">Erase all data</button>
      </section>
    `;

    (async function showUsage() {
      const el = $('[data-role="usage"]', root);
      const tests = await LV.db.listTests();
      let text = plural(tests.length, 'test') + ' stored';
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          if (est && est.usage != null) text += ' · ' + bytes(est.usage) + ' used';
        }
        if (navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()) {
          text += ' · protected from automatic cleanup';
        }
      } catch (_) { /* not available */ }
      el.textContent = text;
    })();

    LV.form.bind(root, () => settings, (path) => {
      touch();
      if (path === 'jobPrefix') {
        const hint = $('#f-jobPrefix-hint', root);
        if (hint) hint.textContent = nextNumberHint(settings);
      }
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !root.contains(btn)) return;
      const act = btn.dataset.act;
      if (act === 'pick-logo') {
        $('[data-act="logo-file"]', root).click();
      } else if (act === 'remove-logo') {
        settings.logo = '';
        $('[data-role="logo"]', root).innerHTML = logoTpl();
        touch();
      } else if (act === 'reset-disclaimer') {
        settings.disclaimer = C.defaultDisclaimer;
        $('#f-disclaimer', root).value = settings.disclaimer;
        touch();
      } else if (act === 'export') {
        try {
          await save.flush();
          const data = await LV.db.exportAll();
          download('leakvue-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
          toast('Backup exported: ' + plural(data.tests.length, 'test'));
        } catch (err) {
          toast('Export failed: ' + err.message, 'error');
        }
      } else if (act === 'pick-import') {
        $('[data-act="import-file"]', root).click();
      } else if (act === 'erase') {
        if (!confirm('Erase ALL tests and settings on this device?')) return;
        if (!confirm('Last check: this cannot be undone. Export a backup first if you need one. Erase everything?')) return;
        await LV.db.eraseAll();
        toast('All data erased');
        LV.app.refreshBrand();
        location.hash = '#/tests';
      }
    });

    root.addEventListener('change', async (e) => {
      const input = e.target;
      if (input.dataset.act === 'logo-file' && input.files && input.files[0]) {
        try {
          settings.logo = await LV.images.shrink(input.files[0], 600);
          $('[data-role="logo"]', root).innerHTML = logoTpl();
          touch();
        } catch (err) {
          toast(err.message, 'error');
        }
        input.value = '';
      } else if (input.dataset.act === 'import-file' && input.files && input.files[0]) {
        try {
          const data = JSON.parse(await readFile(input.files[0], 'text'));
          const n = (data && data.tests && data.tests.length) || 0;
          if (!confirm('Import ' + plural(n, 'test') + ' from this backup? Tests with the same ID will be replaced by the backup copy.')) {
            input.value = '';
            return;
          }
          const res = await LV.db.importAll(data);
          toast('Imported ' + plural(res.tests, 'test'));
          location.hash = '#/tests';
        } catch (err) {
          toast(err instanceof SyntaxError ? 'That file is not a Leakvue backup.' : err.message, 'error');
        }
        input.value = '';
      }
    });

    const flush = async () => { await save.flush(); };
    return { flush, destroy: flush };
  };
})();
