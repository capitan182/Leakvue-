/* Leakvue — homeowner report. Three plain cards (is it leaking and how much, where, what next), each
   sized for a phone screen so it can be screenshotted on its own. The technical pages (bars, graphs,
   numbers) are added only when the tech switches them on. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, raw, fmtDate, $$, toast, plural } = LV.util;
  const K = LV.calc;
  const S = LV.story;
  const C = LV.catalog;

  const ICONS = {
    ok: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2l6.5 12h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 12v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 7.5v4M8 5v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  LV.views.report = async function (root, id) {
    const [t, s] = await Promise.all([LV.db.getTest(id), LV.db.getSettings()]);
    if (!t) {
      root.innerHTML = html`<div class="empty"><h2>Test not found</h2><a class="btn" href="#/tests">Back to tests</a></div>`;
      return {};
    }
    const a = K.analyze(t, s);
    const pat = S.pattern(a);
    const cond = t.conditions || {};
    const pool = t.pool || {};
    const dateText = fmtDate(t.date, { year: 'numeric', month: 'long', day: 'numeric' });
    const withReadings = a.done.filter((x) => x.result.source === 'readings');
    const contact = [s.phone, s.website].filter(Boolean).join(' · ');

    const prevTitle = document.title;
    document.title = [t.number, 'Pool Leak Test'].filter(Boolean).join(' – ');

    const brand = html`
      <div class="rc-brand">
        ${s.logo ? html`<img src="${s.logo}" alt="">` : ''}
        <div>
          <div class="rc-co">${s.companyName || 'Leak Detection'}</div>
          ${s.companyTagline ? html`<div class="rc-tag">${s.companyTagline}</div>` : ''}
        </div>
      </div>`;
    const foot = html`
      <footer class="rc-foot">
        <span>${s.companyName || ''}${contact ? ' · ' + contact : ''}</span>
        <span>${fmtDate(t.date)}</span>
      </footer>`;
    const card = (cls, body) => html`<section class="rcard ${cls}">${body}${foot}</section>`;

    /* ---------- The homeowner report: three plain cards ---------- */
    const p = S.plain(a, s, pool.body);

    /* 1. Is it leaking, and how much? */
    const answer = card('rc-answer', html`
      ${brand}
      <h2 class="rc-title">Your ${p.thing} leak test</h2>
      <p class="rc-sub">${dateText}</p>
      ${p.kind === 'pending' ? html`<p class="rc-sentence">The results will show here once the test is done.</p>` : ''}
      ${p.kind === 'normal' ? html`
        <div class="verdict verdict-ok">${raw(ICONS.ok)} No leak found</div>
        <p class="rc-plain">${p.lines[0]}</p>` : ''}
      ${p.kind === 'leak' ? html`
        <div class="verdict verdict-leak">Yes, your ${p.thing} is leaking</div>
        <div class="hero">
          <div class="hero-pre">${p.qual}</div>
          <div class="hero-num">${p.big}</div>
          <div class="hero-unit">${p.unit}</div>
        </div>
        <ul class="rc-lines">${p.lines.map((l) => html`<li>${l}</li>`)}</ul>` : ''}
    `);

    /* 2. Where is it? */
    const where = p.where ? card('rc-where', html`
      <h2 class="rc-title">${p.where.title}</h2>
      ${p.where.spot ? html`<p class="rc-spot">${p.where.spot}</p>` : ''}
      ${p.where.detail ? html`<p class="rc-plain">${p.where.detail}</p>` : ''}
      ${p.where.why ? html`<p class="rc-why"><span>How we know</span>${p.where.why}</p>` : ''}
    `) : '';

    /* 3. What happens next (with the fine print) */
    const nextPlain = card('rc-next', html`
      ${brand}
      <h2 class="rc-title">What happens next</h2>
      <p class="rc-message">${t.message || C.plain.nextDefault}</p>
      <div class="rc-contact">
        ${t.technician ? html`<div><span class="muted">Your technician</span><strong>${t.technician}</strong></div>` : ''}
        ${s.phone ? html`<div><span class="muted">Questions? Call</span><strong>${s.phone}</strong></div>` : ''}
      </div>
      ${s.disclaimer ? html`<p class="fine">${s.disclaimer}</p>` : ''}
      <p class="fine">Report ${t.number}</p>
    `);

    /* ---------- Technical pages (off unless the tech switches them on) ---------- */

    /* 2. Pump on vs off */
    const rows = S.baselineRows(a);
    const evapCaption = a.evapGal != null
      ? 'Normal evaporation today: about ' + K.fmtGal(a.evapGal) + ' gallons a day (' + K.fmtIn(a.evap) + '″).'
      : 'Normal evaporation today: about ' + K.fmtIn(a.evap) + '″ a day.';
    const compare = rows.length ? card('rc-compare', html`
      <h2 class="rc-title">${rows.length > 1 ? 'Pump on vs. pump off' : 'What we measured'}</h2>
      <p class="rc-sub">How fast the pool lost water in each ${rows.length > 1 ? 'test' : 'scan'}${a.gpi != null ? ', in gallons per day' : ', in inches per day'}.</p>
      ${LV.charts.lossBars(rows, { caption: evapCaption })}
      ${pat ? html`<div class="callout"><div class="callout-k">What this means</div><strong>${pat.title}</strong><p>${pat.body}</p></div>` : ''}
    `) : '';

    /* 3. Isolation rescans */
    const steps = a.steps.length ? card('rc-steps', html`
      <h2 class="rc-title">Narrowing it down</h2>
      <p class="rc-sub">We closed off part of the system and scanned again to see whether the leak stopped.</p>
      ${a.steps.map((st, i) => {
        const txt = S.stepText(st);
        return html`<div class="step">
          <div class="step-head"><span class="step-num">${i + 1}</span> Isolated: <strong>${st.scan.isolated || 'a line'}</strong></div>
          ${LV.charts.lossBars(S.stepRows(st), { legend: i === 0 })}
          <div class="badge badge-${txt.tone}">${raw(ICONS[txt.tone])} ${txt.badge}</div>
          <p class="small">${txt.text}</p>
        </div>`;
      })}
    `) : '';

    /* 4. Water level graphs (only for scans with LeakVue readings) */
    let yMin = 0, yMax = 0;
    withReadings.forEach((x) => {
      const ext = LV.charts.levelExtent(x.scan.readings, x.result.fit);
      yMin = Math.min(yMin, ext[0]);
      yMax = Math.max(yMax, ext[1]);
    });
    const graphs = withReadings.length ? card('rc-graphs', html`
      <h2 class="rc-title">Water level during each scan</h2>
      <p class="rc-sub">The steeper the line slopes down, the faster the pool is losing water. All graphs use the same scale.</p>
      ${LV.charts.LEVEL_LEGEND}
      ${withReadings.map((x) => html`
        <div class="graph">
          <div class="graph-head"><strong>${S.scanName(x)}</strong> <span class="muted">· ${K.fmtIn(x.result.totalIn)}″ a day</span></div>
          ${LV.charts.levelChart(x.scan.readings, x.result.fit, { yMin, yMax, height: withReadings.length > 2 ? 132 : 160, legend: false, title: S.scanName(x) })}
        </div>`)}
    `) : '';

    /* 6. Details: the numbers behind every chart */
    const details = card('rc-details', html`
      <h2 class="rc-title">Test details</h2>
      ${a.done.length ? html`<table class="rc-table">
        <thead><tr><th>Scan</th><th>Time</th><th>Drop</th><th>Loss a day</th></tr></thead>
        <tbody>${a.done.map((x) => html`<tr>
          <td>${S.scanName(x)}</td>
          <td>${LV.charts.mmss(x.result.durationMin * 60)}</td>
          <td>${K.fmtIn(x.result.dropIn, 4)}″</td>
          <td>${K.fmtIn(x.result.totalIn)}″${x.result.totalGal != null ? html`<br><span class="muted">${K.fmtGal(x.result.totalGal)} gal</span>` : ''}</td>
        </tr>`)}</tbody>
      </table>` : ''}
      <dl class="rc-dl">
        <div><dt>Tested</dt><dd>${pool.body || 'Pool'}${a.area != null ? ' · ' + Math.round(a.area).toLocaleString() + ' sq ft surface' : ''}</dd></div>
        ${a.gpi != null ? html`<div><dt>1 inch of water</dt><dd>${K.fmtGal(a.gpi)} gallons</dd></div>` : ''}
        <div><dt>Normal evaporation used</dt><dd>${K.fmtIn(a.evap)}″ a day</dd></div>
        ${cond.weather ? html`<div><dt>Weather</dt><dd>${cond.weather}</dd></div>` : ''}
        <div><dt>Auto-fill</dt><dd>${cond.autofillOff ? 'Off during test' : 'Not confirmed off'}</dd></div>
        <div><dt>Report #</dt><dd>${t.number}</dd></div>
      </dl>
    `);

    root.innerHTML = html`
      <div class="report-toolbar no-print">
        <a class="btn" href="#/test/${t.id}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Edit
        </a>
        <div class="report-actions">
          <button type="button" class="btn" data-act="print">Print / PDF</button>
          <button type="button" class="btn btn-primary" data-act="pictures">Save to Photos</button>
        </div>
      </div>
      <p class="report-tip no-print">Screenshot any card, or tap <strong>Save to Photos</strong> to save every card as a picture at once
      (then choose <em>Save Images</em>). Upload them from Photos to your report.</p>
      ${t.sample ? html`<p class="sample-banner no-print">Sample report with simulated readings.</p>` : ''}
      <label class="check report-detail no-print">
        <input type="checkbox" data-act="detail" ${t.reportDetail ? 'checked' : ''}>
        Add the technical pages (graphs and numbers) for someone who wants them
      </label>
      <div class="report-cards">
        ${answer}${where}${nextPlain}
        <div class="rc-technical" data-role="technical" ${t.reportDetail ? '' : 'hidden'}>${compare}${steps}${graphs}${details}</div>
      </div>
    `;
    LV.charts.enhance(root);

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="print"]')) window.print();
      const btn = e.target.closest('[data-act="pictures"]');
      if (btn && !btn.disabled) savePictures(btn);
    });
    root.addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'detail') return;
      t.reportDetail = e.target.checked;
      $$('[data-role="technical"]', root).forEach((el) => { el.hidden = !t.reportDetail; });
      LV.db.saveTest(t).catch(() => {});
    });

    async function savePictures(btn) {
      const label = btn.textContent;
      btn.disabled = true;
      try {
        const base = (t.number || 'leak-test').replace(/[^\w-]+/g, '-');
        const images = await LV.reportImages.render($$('.rcard', root).filter((el) => el.offsetParent !== null), base, (i, n) => {
          btn.textContent = 'Making picture ' + i + ' of ' + n + '…';
        });
        btn.textContent = label;
        const title = 'Pool leak test ' + (t.number || '');
        if (LV.native.isNative()) {
          if (await LV.native.shareImages(images, title)) toast(plural(images.length, 'picture') + ' ready');
        } else {
          await LV.reportImages.shareOnWeb(images, title);
        }
      } catch (err) {
        console.error(err);
        toast('Could not make the pictures: ' + (err && err.message ? err.message : err), 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    }

    return { destroy() { document.title = prevTitle; } };
  };
})();
