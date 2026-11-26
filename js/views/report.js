/* Leakvue — homeowner report. A stack of cards, each sized for a phone screen so any one of them
   can be screenshotted and texted on its own. "Print / Save PDF" gives the whole thing. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, raw, fmtDate } = LV.util;
  const K = LV.calc;
  const S = LV.story;

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
    const head = S.headline(a, s);
    const pat = S.pattern(a);
    const customer = t.customer || {};
    const prop = t.property || {};
    const cond = t.conditions || {};
    const pool = t.pool || {};
    const dateText = fmtDate(t.date, { year: 'numeric', month: 'long', day: 'numeric' });
    const withReadings = a.done.filter((x) => x.result.source === 'readings');
    const contact = [s.phone, s.website].filter(Boolean).join(' · ');

    const prevTitle = document.title;
    document.title = [t.number, customer.name, 'Pool Leak Test'].filter(Boolean).join(' – ');

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
        <span>${customer.name || ''}${customer.name ? ' · ' : ''}${fmtDate(t.date)}</span>
      </footer>`;
    const card = (cls, body) => html`<section class="rcard ${cls}">${body}${foot}</section>`;

    /* 1. Summary */
    const lastStep = a.steps.length ? a.steps[a.steps.length - 1] : null;
    const summary = card('rc-summary', html`
      ${brand}
      <h2 class="rc-title">Pool leak test results</h2>
      <p class="rc-sub">${[customer.name, prop.address].filter(Boolean).join(' · ')}${customer.name || prop.address ? html`<br>` : ''}${dateText}</p>
      ${head.kind === 'pending' ? html`<p class="rc-sentence">${head.sentence}</p>` : html`
        <div class="hero${head.kind === 'normal' ? ' hero-ok' : ''}">
          <div class="hero-num">${head.big}</div>
          <div class="hero-unit">${head.unit ? head.unit + ' leaking' : 'water loss'}</div>
        </div>
        <p class="rc-sentence">${head.sentence}</p>
        ${a.status === 'resolved' ? html`<div class="badge badge-ok">${raw(ICONS.ok)} Leak isolated: ${lastStep.scan.isolated || 'see below'}</div>` : ''}
        ${a.status === 'remaining' ? html`<div class="badge badge-warn">${raw(ICONS.warn)} Still searching for another leak</div>` : ''}
        ${head.stats && head.stats.length ? html`<div class="stats">${head.stats.map((x) => html`<div class="stat"><div class="stat-v">${x.value}</div><div class="stat-l">${x.label}</div></div>`)}</div>` : ''}
        ${head.kind === 'leak' && head.week > 0 ? html`
          <div class="rc-wall">
            ${LV.charts.wallFigure(head.week / 7, a.evap)}
            <p class="small">Only about ${K.fmtIn(Math.min(head.week, a.evap * 7), 1)}″ of that weekly drop is normal evaporation.</p>
          </div>` : ''}
        ${head.stats && head.stats.some((x) => /\*$/.test(x.label)) ? html`<p class="fine">*Estimated at $${s.waterCost} per 1,000 gallons. Your water rate may differ.</p>` : ''}
      `}
    `);

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

    /* 5. Next steps */
    const next = (t.message || t.technician || s.phone) ? card('rc-next', html`
      ${brand}
      <h2 class="rc-title">Next steps</h2>
      ${t.message ? html`<p class="rc-message">${t.message}</p>` : ''}
      <div class="rc-contact">
        ${t.technician ? html`<div><span class="muted">Your technician</span><strong>${t.technician}</strong></div>` : ''}
        ${s.phone ? html`<div><span class="muted">Call</span><strong>${s.phone}</strong></div>` : ''}
        ${s.email ? html`<div><span class="muted">Email</span><strong>${s.email}</strong></div>` : ''}
        ${s.license ? html`<div><span class="muted">License</span><strong>${s.license}</strong></div>` : ''}
      </div>
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
      ${s.disclaimer ? html`<p class="fine">${s.disclaimer}</p>` : ''}
    `);

    root.innerHTML = html`
      <div class="report-toolbar no-print">
        <a class="btn" href="#/test/${t.id}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Edit test
        </a>
        <button type="button" class="btn btn-primary" data-act="print">Print / Save PDF</button>
      </div>
      <p class="report-tip no-print">Each card fits a phone screen. Screenshot any card to text it to the homeowner.</p>
      ${t.sample ? html`<p class="sample-banner no-print">Sample report with simulated readings.</p>` : ''}
      <div class="report-cards">
        ${summary}${compare}${steps}${graphs}${next}${details}
      </div>
    `;
    LV.charts.enhance(root);

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="print"]')) window.print();
    });

    return { destroy() { document.title = prevTitle; } };
  };
})();
