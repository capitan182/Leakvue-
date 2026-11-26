/* Leakvue — customer-facing report. Print it, or "Save as PDF" from the print dialog. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, fmtDate, fmtTime, fmtDateTime } = LV.util;
  const C = LV.catalog;

  function photoGrid(photos) {
    if (!photos.length) return '';
    return html`<div class="r-photos">
      ${photos.map((p) => html`<figure class="r-photo">
        <img src="${p.dataUrl}" alt="${p.caption || 'Photo'}">
        ${p.caption ? html`<figcaption>${p.caption}</figcaption>` : ''}
      </figure>`)}
    </div>`;
  }

  function multiline(text) {
    return html`<div class="r-text">${String(text || '').trim()}</div>`;
  }

  LV.views.report = async function (root, id) {
    const job = await LV.db.getJob(id);
    if (!job) {
      root.innerHTML = html`<div class="empty"><h2>Job not found</h2><a class="btn" href="#/jobs">Back to jobs</a></div>`;
      return {};
    }
    const [photos, s] = await Promise.all([LV.db.photosForJob(id), LV.db.getSettings()]);
    const customer = job.customer || {};
    const property = job.property || {};
    const signature = job.signature || {};
    const findings = job.findings || [];
    const tests = (job.tests || []).filter((t) => t.name || t.reading);
    const methods = (job.methods || []).map((m) => C.label(C.methods, m)).filter(Boolean);
    const sitePhotos = photos.filter((p) => !p.findingId || !findings.some((fd) => fd.id === p.findingId));
    const result = C.results.find((r) => r.id === job.result);

    const missing = [];
    if (!customer.name) missing.push('customer name');
    if (!property.address) missing.push('property address');
    if (!result) missing.push('overall result');
    if (!signature.dataUrl) missing.push('customer signature');

    const contact = [s.phone, s.email, s.website].filter(Boolean);
    const findingWord = findings.length === 1 ? '1 leak is' : findings.length + ' leaks are';
    const resultNote = !result ? '' :
      result.id === 'leak_found' && findings.length ? findingWord + ' documented below.' :
      result.id === 'no_leak' ? 'No active leak was found in the systems tested.' :
      result.id === 'further' ? 'See recommendations for next steps.' : '';

    const prevTitle = document.title;
    document.title = [job.number, customer.name, 'Leak Detection Report'].filter(Boolean).join(' – ');

    root.innerHTML = html`
      <div class="report-toolbar no-print">
        <a class="btn" href="#/job/${job.id}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Edit job
        </a>
        <button type="button" class="btn btn-primary" data-act="print">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 9V3h10v6M7 18H4v-8h16v8h-3M7 14h10v7H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          Print / Save PDF
        </button>
      </div>
      ${missing.length ? html`<p class="report-missing no-print">Still missing: ${missing.join(', ')}.</p>` : ''}

      <article class="report">
        <header class="r-head">
          <div class="r-company">
            ${s.logo ? html`<img class="r-logo" src="${s.logo}" alt="${s.companyName} logo">` : ''}
            <div>
              <div class="r-co-name">${s.companyName || 'Leak Detection'}</div>
              ${s.companyTagline ? html`<div class="r-co-tag">${s.companyTagline}</div>` : ''}
              ${contact.length ? html`<div class="r-co-line">${contact.join('  ·  ')}</div>` : ''}
              ${s.address ? html`<div class="r-co-line">${s.address}</div>` : ''}
              ${s.license ? html`<div class="r-co-line">License ${s.license}</div>` : ''}
            </div>
          </div>
          <div class="r-doc">
            <div class="r-doc-title">Leak Detection Report</div>
            <dl class="r-meta">
              <dt>Report #</dt><dd>${job.number}</dd>
              <dt>Date</dt><dd>${fmtDate(job.date, { year: 'numeric', month: 'long', day: 'numeric' })}${job.time ? ' · ' + fmtTime(job.time) : ''}</dd>
              ${job.technician ? html`<dt>Technician</dt><dd>${job.technician}</dd>` : ''}
              ${job.serviceType ? html`<dt>Service</dt><dd>${job.serviceType}</dd>` : ''}
            </dl>
          </div>
        </header>

        ${result ? html`
          <div class="r-result tone-${result.tone}">
            <span class="r-result-label">Result</span>
            <strong>${result.label}</strong>
            ${resultNote ? html`<span class="r-result-note">${resultNote}</span>` : ''}
          </div>` : ''}

        <section class="r-two">
          <div>
            <h3>Customer</h3>
            <p>${customer.name || '—'}</p>
            ${customer.phone ? html`<p>${customer.phone}</p>` : ''}
            ${customer.email ? html`<p>${customer.email}</p>` : ''}
          </div>
          <div>
            <h3>Property</h3>
            <p>${property.address || '—'}</p>
            ${(property.city || property.state || property.zip) ? html`<p>${[property.city, [property.state, property.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>` : ''}
            ${property.type ? html`<p class="r-muted">${property.type}</p>` : ''}
          </div>
        </section>

        ${job.complaint ? html`<section class="r-section"><h3>Reason for service</h3>${multiline(job.complaint)}</section>` : ''}

        ${methods.length ? html`<section class="r-section">
          <h3>Detection methods used</h3>
          <ul class="r-methods">${methods.map((m) => html`<li>${m}</li>`)}</ul>
        </section>` : ''}

        ${tests.length ? html`<section class="r-section">
          <h3>Tests & readings</h3>
          <table class="r-table">
            <thead><tr><th>Test</th><th>Reading / result</th><th>Outcome</th></tr></thead>
            <tbody>${tests.map((t) => html`<tr>
              <td>${t.name}</td><td>${t.reading}</td>
              <td>${t.outcome ? html`<span class="r-outcome ${t.outcome}">${C.label(C.testOutcomes, t.outcome)}</span>` : '—'}</td>
            </tr>`)}</tbody>
          </table>
        </section>` : ''}

        ${findings.length ? html`<section class="r-section">
          <h3>Findings</h3>
          ${findings.map((fd, i) => {
            const fp = photos.filter((p) => p.findingId === fd.id);
            const facts = [
              fd.system ? ['System', fd.system] : null,
              fd.method ? ['Located with', C.label(C.methods, fd.method)] : null,
              ['Marked on site', fd.marked ? 'Yes' : 'No'],
            ].filter(Boolean);
            return html`<div class="r-finding">
              <div class="r-finding-head">
                <span class="r-finding-num">${i + 1}</span>
                <div class="r-finding-title">${fd.location || 'Leak ' + (i + 1)}</div>
                ${fd.severity ? html`<span class="r-sev sev-${fd.severity}">${C.label(C.severities, fd.severity)}</span>` : ''}
              </div>
              <dl class="r-facts">${facts.map((x) => html`<div><dt>${x[0]}</dt><dd>${x[1]}</dd></div>`)}</dl>
              ${fd.description ? multiline(fd.description) : ''}
              ${photoGrid(fp)}
            </div>`;
          })}
        </section>` : ''}

        ${job.recommendations ? html`<section class="r-section"><h3>Recommendations</h3>${multiline(job.recommendations)}</section>` : ''}

        ${sitePhotos.length ? html`<section class="r-section"><h3>Site photos</h3>${photoGrid(sitePhotos)}</section>` : ''}

        ${s.disclaimer ? html`<section class="r-section r-disclaimer"><h3>Terms & limitations</h3>${multiline(s.disclaimer)}</section>` : ''}

        <section class="r-sign">
          <div class="r-sign-box">
            <div class="r-sign-line r-sign-text">${job.technician || ''}</div>
            <div class="r-sign-label">Technician</div>
          </div>
          <div class="r-sign-box">
            <div class="r-sign-line">
              ${signature.dataUrl ? html`<img src="${signature.dataUrl}" alt="Customer signature">` : ''}
            </div>
            <div class="r-sign-label">
              Customer${(signature.name || customer.name) ? ': ' + (signature.name || customer.name) : ''}
              ${signature.signedAt ? html`<span class="r-muted"> · ${fmtDateTime(signature.signedAt)}</span>` : ''}
            </div>
          </div>
        </section>
      </article>
    `;

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="print"]')) window.print();
    });

    return {
      destroy() { document.title = prevTitle; },
    };
  };
})();
