/* Leakvue — charts. Plain HTML/SVG, no libraries.
 *  - lossBars:   one bar per scan, split into normal evaporation (gray) and leak (blue)
 *  - levelChart: water level over a scan, measured readings + trend line, with hover
 *  - wallFigure: pool wall showing how far the water would drop in a week
 * Colours come from CSS variables (--viz-*) so light/dark and the always-light report work. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html } = LV.util;
  const { fmtGal, fmtIn } = LV.calc;

  const LEVEL_LEGEND = html`
    <div class="viz-legend" aria-hidden="true">
      <span><i class="key key-line"></i>Measured level</span>
      <span><i class="key key-trend"></i>Trend</span>
    </div>`;

  const LEGEND = html`
    <div class="viz-legend" aria-hidden="true">
      <span><i class="key key-evap"></i>Normal evaporation</span>
      <span><i class="key key-leak"></i>Leak</span>
    </div>`;

  /**
   * rows: [{ label, note, result }] where result is a calc scanResult.
   * Uses gallons/day when the pool size is known, otherwise inches/day.
   */
  function lossBars(rows, opts) {
    opts = opts || {};
    const useGal = rows.every((r) => r.result && r.result.totalGal != null);
    const val = (r, k) => (useGal ? r.result[k + 'Gal'] : r.result[k + 'In']);
    const unit = useGal ? 'gal/day' : 'in/day';
    const fmt = (v) => (useGal ? fmtGal(v) : fmtIn(v, 2));
    const max = Math.max.apply(null, rows.map((r) => val(r, 'total')).concat([opts.minScale || 0])) || 1;
    const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100));

    return html`
      <div class="viz viz-bars">
        ${opts.legend === false ? '' : LEGEND}
        ${rows.map((r) => {
          const total = val(r, 'total');
          // Loss within the leak margin is drawn as all-normal so the bar agrees with its "No leak" label.
          const evap = r.result.isLeak ? val(r, 'evap') : total;
          const leak = r.result.isLeak ? val(r, 'leak') : 0;
          const leakText = r.result.isLeak
            ? html`<strong>${fmt(leak)}</strong> ${unit} leak`
            : html`<strong>No leak</strong> <span class="muted">(normal)</span>`;
          const aria = r.label + ': ' + fmt(total) + ' ' + unit + ' total, ' +
            (r.result.isLeak ? fmt(evap) + ' normal evaporation, ' + fmt(leak) + ' leak' : 'within normal evaporation');
          return html`
            <div class="bar-row" role="img" aria-label="${aria}">
              <div class="bar-label">
                <span class="bar-name">${r.label}${r.note ? html` <span class="bar-note">${r.note}</span>` : ''}</span>
                <span class="bar-value">${leakText}</span>
              </div>
              <div class="bar-track">
                ${evap > 0 ? html`<span class="seg seg-evap${leak > 0 ? '' : ' end'}" style="width:${pct(evap)}%" title="Normal evaporation: ${fmt(evap)} ${unit}"></span>` : ''}
                ${leak > 0 ? html`<span class="seg seg-leak end" style="width:calc(${pct(leak)}% - 2px)" title="Leak: ${fmt(leak)} ${unit}"></span>` : ''}
              </div>
            </div>`;
        })}
        ${opts.caption ? html`<p class="viz-caption">${opts.caption}</p>` : ''}
      </div>`;
  }

  /* ---------- water level line chart ---------- */

  function niceStep(range, target) {
    const raw0 = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw0)));
    const f = raw0 / mag;
    const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return step * mag;
  }

  function decimalsFor(step) {
    return Math.max(0, Math.min(5, Math.ceil(-Math.log10(step) + 0.001)));
  }

  function mmss(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec - m * 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  let chartSeq = 0;

  /** Points re-based so the trend starts at 0: [[secondsFromStart, inchesFromStart]...] */
  function rebase(readings, fit) {
    const t0 = readings[0][0];
    const base = fit ? fit.intercept + fit.slope * t0 : readings[0][1];
    return readings.map((p) => [p[0] - t0, p[1] - base]);
  }

  /** [min, max] of a scan's re-based readings, so several charts can share one scale. */
  function levelExtent(readings, fit) {
    const ys = rebase(readings, fit).map((p) => p[1]);
    return [Math.min.apply(null, ys), Math.max.apply(null, ys)];
  }

  /**
   * readings: [[tSec, levelIn]...]; fit from calc.fitLine.
   * opts: { yMin, yMax (shared scale), title, height, legend (default true) }
   */
  function levelChart(readings, fit, opts) {
    opts = opts || {};
    if (!readings || readings.length < 2) return '';
    const W = 360, H = opts.height || 180;
    const m = { l: 52, r: 14, t: 10, b: 30 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const pts = rebase(readings, fit);
    const tMax = pts[pts.length - 1][0] || 1;
    let yLo = Math.min.apply(null, pts.map((p) => p[1]));
    let yHi = Math.max.apply(null, pts.map((p) => p[1]));
    if (opts.yMin != null) yLo = Math.min(yLo, opts.yMin);
    if (opts.yMax != null) yHi = Math.max(yHi, opts.yMax);
    yHi = Math.max(yHi, 0);
    if (yHi - yLo < 0.002) yLo = yHi - 0.002;
    const step = niceStep(yHi - yLo, 4);
    const pad = (yHi - yLo) * 0.04;
    yLo -= pad;
    yHi += pad;
    const dec = decimalsFor(step);
    const x = (t) => m.l + (t / tMax) * pw;
    const y = (v) => m.t + ((yHi - v) / (yHi - yLo)) * ph;

    const yTicks = [];
    for (let v = Math.floor(yHi / step) * step; v >= yLo; v -= step) yTicks.push(Math.abs(v) < step / 1e6 ? 0 : v);
    const minStep = tMax / 60 > 20 ? 10 : 5;
    const xTicks = [];
    for (let mnt = 0; mnt <= tMax / 60 + 1e-9; mnt += minStep) xTicks.push(mnt * 60);

    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
    const endT = pts[pts.length - 1][0];
    const trendEnd = fit ? fit.slope * endT : pts[pts.length - 1][1];
    const id = 'lc' + (++chartSeq);
    const ptsAttr = JSON.stringify(pts.map((p) => [Math.round(p[0]), Math.round(p[1] * 1e5) / 1e5]));

    return html`
      <div class="viz viz-level" data-level-chart data-pts="${ptsAttr}" data-geom="${JSON.stringify({ W, H, m, tMax, yLo, yHi, dec })}">
        ${opts.legend === false ? '' : LEVEL_LEGEND}
        <div class="viz-plot">
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t">
            <title id="${id}-t">${opts.title || 'Water level during the scan'}: dropped ${fmtIn(-trendEnd, 4)} inches over ${mmss(endT)}</title>
            ${yTicks.map((v) => html`
              <line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"></line>
              <text class="tick" x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v === 0 ? '0″' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(dec) + '″'}</text>`)}
            <line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"></line>
            ${xTicks.map((t) => html`
              <text class="tick" x="${x(t)}" y="${H - m.b + 15}" text-anchor="middle">${t / 60}</text>`)}
            <text class="axis-title" x="${m.l + pw / 2}" y="${H - 2}" text-anchor="middle">minutes</text>
            <path class="level-line" d="${line}"></path>
            ${fit ? html`<line class="trend-line" x1="${x(0)}" y1="${y(0)}" x2="${x(endT)}" y2="${y(trendEnd)}"></line>
              <circle class="trend-end" cx="${x(endT)}" cy="${y(trendEnd)}" r="4"></circle>` : ''}
            <g class="hover" visibility="hidden">
              <line class="crosshair" y1="${m.t}" y2="${H - m.b}"></line>
              <circle class="hover-dot" r="4"></circle>
            </g>
          </svg>
          <div class="viz-tip" hidden></div>
        </div>
      </div>`;
  }

  /** Wire up hover/tap crosshairs for every level chart inside root. */
  function enhance(root) {
    root.querySelectorAll('[data-level-chart]').forEach((el) => {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      const pts = JSON.parse(el.dataset.pts);
      const g = JSON.parse(el.dataset.geom);
      const svg = el.querySelector('svg');
      const hover = svg.querySelector('.hover');
      const cross = svg.querySelector('.crosshair');
      const dot = svg.querySelector('.hover-dot');
      const tip = el.querySelector('.viz-tip');
      const pw = g.W - g.m.l - g.m.r;
      const ph = g.H - g.m.t - g.m.b;
      const sx = (t) => g.m.l + (t / g.tMax) * pw;
      const sy = (v) => g.m.t + ((g.yHi - v) / (g.yHi - g.yLo)) * ph;
      function show(evt) {
        const rect = svg.getBoundingClientRect();
        const vx = ((evt.clientX - rect.left) / rect.width) * g.W;
        const t = Math.max(0, Math.min(g.tMax, ((vx - g.m.l) / pw) * g.tMax));
        let best = pts[0];
        for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(best[0] - t)) best = pts[i];
        const px = sx(best[0]);
        const py = sy(best[1]);
        cross.setAttribute('x1', px); cross.setAttribute('x2', px);
        dot.setAttribute('cx', px); dot.setAttribute('cy', py);
        hover.setAttribute('visibility', 'visible');
        const v = best[1];
        tip.textContent = mmss(best[0]) + '  ·  ' + (v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(Math.max(3, g.dec))) + ' in';
        tip.hidden = false;
        const left = (px / g.W) * rect.width;
        tip.style.left = Math.max(4, Math.min(rect.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + 'px';
      }
      function hide() { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; }
      svg.addEventListener('pointermove', show);
      svg.addEventListener('pointerdown', show);
      svg.addEventListener('pointerleave', hide);
    });
  }

  /* ---------- pool wall figure ---------- */

  function wallFigure(totalInPerDay, evapInPerDay) {
    const week = totalInPerDay * 7;
    const evapWeek = Math.min(week, evapInPerDay * 7);
    const scaleIn = Math.max(8, Math.ceil((week * 1.2) / 4) * 4);
    const W = 340, H = 150;
    const top = 26, bottom = H - 8;
    const wallX = 44, wallW = 22;
    const waterL = wallX + wallW, waterR = W - 6;
    const yIn = (inch) => top + (inch / scaleIn) * (bottom - top);
    const yNow = yIn(0);
    const yWeek = yIn(week);
    const yEvap = yIn(evapWeek);
    const ticks = [];
    const tickStep = scaleIn <= 8 ? 2 : scaleIn <= 16 ? 4 : scaleIn <= 32 ? 8 : 12;
    for (let i = 0; i <= scaleIn; i += tickStep) ticks.push(i);
    const midX = waterL + 10;
    return html`
      <div class="viz viz-wall">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${'At this rate the water level drops about ' + fmtIn(week, 1) + ' inches in one week; about ' + fmtIn(evapWeek, 1) + ' inches of that is normal evaporation.'}">
          <rect class="wall" x="${wallX}" y="${top - 12}" width="${wallW}" height="${bottom - top + 12}"></rect>
          <rect class="coping" x="${wallX - 5}" y="${top - 18}" width="${waterR - wallX + 5}" height="7" rx="2"></rect>
          <rect class="tile" x="${wallX + wallW - 4}" y="${top - 11}" width="4" height="18"></rect>
          <rect class="lost-evap" x="${waterL}" y="${yNow}" width="${waterR - waterL}" height="${Math.max(0, yEvap - yNow)}"></rect>
          <rect class="lost-leak" x="${waterL}" y="${yEvap}" width="${waterR - waterL}" height="${Math.max(0, yWeek - yEvap)}"></rect>
          <rect class="water" x="${waterL}" y="${yWeek}" width="${waterR - waterL}" height="${Math.max(0, bottom - yWeek)}"></rect>
          <line class="level-now" x1="${waterL}" x2="${waterR}" y1="${yNow}" y2="${yNow}"></line>
          <line class="level-week" x1="${waterL}" x2="${waterR}" y1="${yWeek}" y2="${yWeek}"></line>
          ${ticks.map((i) => html`
            <line class="ruler" x1="${wallX - 8}" x2="${wallX - 3}" y1="${yIn(i)}" y2="${yIn(i)}"></line>
            <text class="tick" x="${wallX - 11}" y="${yIn(i) + 3.5}" text-anchor="end">${i}″</text>`)}
          <text class="wall-label" x="${waterR - 4}" y="${yNow - 4}" text-anchor="end">Water level today</text>
          ${yEvap - yNow >= 12 ? html`<text class="wall-label" x="${midX}" y="${(yNow + yEvap) / 2 + 4}">evaporation</text>` : ''}
          ${yWeek - yEvap >= 14 ? html`<text class="wall-label leak" x="${midX}" y="${(yEvap + yWeek) / 2 + 4}">lost to the leak</text>` : ''}
          <text class="wall-label strong" x="${waterR - 4}" y="${Math.min(bottom - 4, yWeek + 15)}" text-anchor="end">In 1 week: ${fmtIn(week, 1)}″ lower</text>
        </svg>
      </div>`;
  }

  LV.charts = { lossBars, levelChart, levelExtent, wallFigure, enhance, mmss, LEVEL_LEGEND };
})();
