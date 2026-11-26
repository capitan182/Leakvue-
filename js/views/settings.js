/* Leakvue — company details for the report header, defaults, and backups. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, debounce, toast, download, readFile, plural } = LV.util;
  const { field } = LV.form;
  const C = LV.catalog;

  function bytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  LV.views.settings = async function (root) {
    const settings = await LV.db.getSettings();
    const f = (label, path, o) => field(settings, label, path, o);

    const save = debounce(async () => {
      try {
        await LV.db.saveSettings(settings);
        LV.app.refreshBrand(settings);
        const el = $('[data-role="save"]', root);
        if (el) { el.dataset.state = 'saved'; el.textContent = 'Saved'; }
      } catch (err) {
        toast('Could not save settings: ' + err.message, 'error');
      }
    }, 400);
    function touch() {
      const el = $('[data-role="save"]', root);
      if (el) { el.dataset.state = 'saving'; el.textContent = 'Saving…'; }
      save();
    }

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
          <p class="muted">Shown on every report. Stored on this device only.</p>
        </div>
        <span class="save-state" data-role="save" data-state="saved" aria-live="polite">Saved</span>
      </div>

      <section class="card">
        <h2>Company</h2>
        <div class="grid">
          ${f('Company name', 'companyName', { full: true, autocomplete: 'organization' })}
          ${f('Location / franchise line', 'companyTagline', { full: true, placeholder: 'e.g. Serving the Greater Phoenix Area' })}
          ${f('Phone', 'phone', { type: 'tel', inputmode: 'tel' })}
          ${f('Email', 'email', { type: 'email', inputmode: 'email' })}
          ${f('Website', 'website', { inputmode: 'url', placeholder: 'example.com' })}
          ${f('License #', 'license')}
          ${f('Office address', 'address', { full: true })}
        </div>
        <div class="sub-label">Logo</div>
        <div class="logo-row" data-role="logo">${logoTpl()}</div>
        <button type="button" class="btn btn-sm" data-act="pick-logo">Upload logo</button>
        <input type="file" accept="image/*" hidden data-act="logo-file">
      </section>

      <section class="card">
        <h2>Jobs</h2>
        <div class="grid">
          ${f('Job number prefix', 'jobPrefix', { hint: 'Next job: ' + ((settings.jobPrefix || '').trim() ? settings.jobPrefix.trim() + '-' : '') + new Date().getFullYear() + '-' + String((Number(settings.jobSeq) || 0) + 1).padStart(4, '0') })}
          ${f('Default technician', 'defaultTechnician', { hint: 'Filled in on new jobs.' })}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Report terms & limitations</h2>
          <button type="button" class="btn btn-quiet btn-sm" data-act="reset-disclaimer">Reset to default</button>
        </div>
        ${f('Printed at the end of every report', 'disclaimer', { type: 'textarea', full: true, rows: 6 })}
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p class="muted small">Jobs and photos live in this browser on this device. Export a backup regularly, and use it to move your jobs to another device.</p>
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
          <p class="muted small">Deletes every job, photo and setting stored here.</p>
        </div>
        <button type="button" class="btn btn-danger" data-act="erase">Erase all data</button>
      </section>
    `;

    async function showUsage() {
      const el = $('[data-role="usage"]', root);
      const jobs = await LV.db.listJobs();
      let text = plural(jobs.length, 'job') + ' stored';
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          if (est && est.usage != null) text += ' · ' + bytes(est.usage) + ' used';
        }
        if (navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()) {
          text += ' · protected from automatic cleanup';
        }
      } catch (_) { /* estimate not available */ }
      el.textContent = text;
    }
    showUsage();

    LV.form.bind(root, () => settings, (path) => {
      touch();
      if (path === 'jobPrefix') {
        const hint = $('#f-jobPrefix-hint', root);
        const prefix = (settings.jobPrefix || '').trim();
        if (hint) hint.textContent = 'Next job: ' + (prefix ? prefix + '-' : '') + new Date().getFullYear() + '-' + String((Number(settings.jobSeq) || 0) + 1).padStart(4, '0');
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
          const stamp = new Date().toISOString().slice(0, 10);
          download('leakvue-backup-' + stamp + '.json', JSON.stringify(data), 'application/json');
          toast('Backup exported: ' + plural(data.jobs.length, 'job') + ', ' + plural(data.photos.length, 'photo'));
        } catch (err) {
          toast('Export failed: ' + err.message, 'error');
        }
      } else if (act === 'pick-import') {
        $('[data-act="import-file"]', root).click();
      } else if (act === 'erase') {
        if (!confirm('Erase ALL jobs, photos and settings on this device?')) return;
        if (!confirm('Last check: this cannot be undone. Export a backup first if you need one. Erase everything?')) return;
        await LV.db.eraseAll();
        toast('All data erased');
        LV.app.refreshBrand();
        location.hash = '#/jobs';
      }
    });

    root.addEventListener('change', async (e) => {
      const input = e.target;
      if (input.dataset.act === 'logo-file' && input.files && input.files[0]) {
        try {
          settings.logo = await LV.photos.compress(input.files[0], { maxDim: 600, type: 'image/png' });
          $('[data-role="logo"]', root).innerHTML = logoTpl();
          touch();
        } catch (err) {
          toast(err.message, 'error');
        }
        input.value = '';
      } else if (input.dataset.act === 'import-file' && input.files && input.files[0]) {
        try {
          const data = JSON.parse(await readFile(input.files[0], 'text'));
          const n = (data && data.jobs && data.jobs.length) || 0;
          if (!confirm('Import ' + plural(n, 'job') + ' from this backup? Jobs with the same ID will be replaced by the backup copy.')) {
            input.value = '';
            return;
          }
          const res = await LV.db.importAll(data);
          toast('Imported ' + plural(res.jobs, 'job') + ' and ' + plural(res.photos, 'photo'));
          location.hash = '#/jobs';
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
