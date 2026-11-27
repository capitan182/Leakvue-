/* Leakvue — the math. Pure functions, no DOM, so they can be checked in Node too.
 *
 * Units: feet for pool dimensions, inches for water level, minutes for scan length.
 * A scan's loss rate comes from LeakVue readings when present (least-squares trend, so ripples
 * don't skew it), otherwise from the drop the tech typed in.
 */
(function (root) {
  'use strict';

  const GAL_PER_CUBIC_FT = 7.48052;
  const GAL_PER_SQFT_INCH = GAL_PER_CUBIC_FT / 12; // ≈ 0.623 gallons per sq ft per inch
  const BATHTUB_GAL = 40;

  function num(v) {
    if (v === '' || v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  /** Water surface area in sq ft (pool + attached spa), or null if dimensions are missing. */
  function surfaceArea(pool) {
    if (!pool) return null;
    const L = num(pool.length);
    const W = num(pool.width);
    const W2 = num(pool.width2);
    const D = num(pool.diameter);
    const A = num(pool.area);
    let area = null;
    switch (pool.shape) {
      case 'rectangle': if (L && W) area = L * W; break;
      case 'oval': if (L && W) area = Math.PI * (L / 2) * (W / 2); break;
      case 'round': if (D) area = Math.PI * Math.pow(D / 2, 2); break;
      case 'kidney': if (L && W && W2) area = 0.45 * (W + W2) * L; break;
      case 'area': if (A) area = A; break;
      default: break;
    }
    if (area == null) return null;
    const spa = num(pool.spaArea);
    return area + (spa && spa > 0 ? spa : 0);
  }

  function gallonsPerInch(area) {
    return area == null ? null : area * GAL_PER_SQFT_INCH;
  }

  /** Least-squares line through [tSeconds, levelInches] pairs. */
  function fitLine(readings) {
    const n = readings.length;
    if (!n) return null;
    // Centred sums, so big times (clock seconds) or big levels don't swamp the tiny changes we measure.
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += readings[i][0]; my += readings[i][1]; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = readings[i][0] - mx, dy = readings[i][1] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (!sxx) return null;
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const e = readings[i][1] - my - slope * (readings[i][0] - mx);
      ssRes += e * e;
    }
    return { slope, intercept, r2: syy > 0 ? 1 - ssRes / syy : 1 };
  }

  /** Raw rate for one scan: { inPerDay (positive = water going down), dropIn, durationMin, source } */
  function scanRate(scan) {
    const r = Array.isArray(scan.readings) ? scan.readings : null;
    if (r && r.length >= 3) {
      const fit = fitLine(r);
      const spanSec = r[r.length - 1][0] - r[0][0];
      if (fit && spanSec > 0) {
        return {
          inPerDay: -fit.slope * 86400,
          dropIn: -fit.slope * spanSec,
          durationMin: spanSec / 60,
          source: 'readings',
          fit,
        };
      }
    }
    let drop = num(scan.dropIn);
    const dur = num(scan.durationMin);
    if (drop == null || !dur || dur <= 0) return null;
    // The iPhone number pad has no minus key, so a rise is entered as a size plus "Up".
    if (scan.direction === 'up') drop = -Math.abs(drop);
    return { inPerDay: (drop / dur) * 1440, dropIn: drop, durationMin: dur, source: 'manual', fit: null };
  }

  /** Split a scan's loss into normal evaporation and leak, in inches/day and gallons/day. */
  function scanResult(scan, ctx) {
    const rate = scanRate(scan);
    if (!rate) return null;
    const total = Math.max(0, rate.inPerDay);
    const evapIn = Math.min(total, ctx.evap);
    const leakIn = Math.max(0, total - ctx.evap);
    const g = (inch) => (ctx.gpi == null ? null : inch * ctx.gpi);
    return Object.assign({}, rate, {
      rising: rate.inPerDay < 0,
      totalIn: total,
      evapIn,
      leakIn,
      totalGal: g(total),
      evapGal: g(evapIn),
      leakGal: g(leakIn),
      isLeak: leakIn > ctx.margin,
    });
  }

  /**
   * Interpret the latest pump-ON and pump-OFF baseline scans.
   *  none      – both within normal evaporation
   *  pressure  – loses more with the pump running
   *  suction   – loses more with the pump off
   *  structure – about the same either way
   *  single    – only one baseline so far (leak present)
   */
  function pumpPattern(on, off, margin) {
    if (on && off) {
      const a = on.result.leakIn;
      const b = off.result.leakIn;
      const hi = Math.max(a, b);
      if (hi <= margin) return 'none';
      if (Math.abs(a - b) <= Math.max(margin, 0.25 * hi)) return 'structure';
      return a > b ? 'pressure' : 'suction';
    }
    const one = on || off;
    if (!one) return null;
    return one.result.leakIn <= margin ? 'none' : 'single';
  }

  /** Full analysis of a test visit. */
  /**
   * Every body of water in a test. The first is test.pool (id 'main'), so tests from before there
   * could be several keep working; a separately tested spa, fountain etc. go in test.otherBodies.
   */
  function bodiesOf(test) {
    const main = Object.assign({}, test.pool || {}, { id: 'main' });
    return [main].concat((test.otherBodies || []).filter((b) => b && b.id && b.id !== 'main'));
  }
  /** Which body a scan belongs to (anything unknown counts as the first). */
  function bodyIdOf(scan, test) {
    const id = scan && scan.bodyId;
    return id && (test.otherBodies || []).some((b) => b.id === id) ? id : 'main';
  }

  /** Full analysis of one body of water (the first one unless `body` is given). */
  function analyze(test, settings, body) {
    settings = settings || {};
    body = body || bodiesOf(test)[0];
    const area = surfaceArea(body);
    const gpi = gallonsPerInch(area);
    const evapSetting = num(test.conditions && test.conditions.evaporation);
    const evap = evapSetting != null ? Math.max(0, evapSetting) : (num(settings.evaporation) != null ? num(settings.evaporation) : 0.25);
    const margin = num(settings.margin) != null ? Math.max(0, num(settings.margin)) : 0.1;
    const ctx = { gpi, evap, margin };

    // Scan numbers stay the same as on the tech screen, even when only one body's scans are used.
    const scans = (test.scans || [])
      .map((scan, index) => ({ scan, index }))
      .filter((x) => bodyIdOf(x.scan, test) === body.id)
      .map((x) => Object.assign(x, { result: scanResult(x.scan, ctx) }));
    const done = scans.filter((x) => x.result);
    // A scan where the level went UP had water added (auto-fill, hose, rain, spillover from another
    // body of water). It says nothing about a leak, so it's left out of every conclusion.
    const risen = done.filter((x) => x.result.rising);
    const valid = done.filter((x) => !x.result.rising);
    const baselines = valid.filter((x) => x.scan.purpose !== 'isolation');
    const latest = (pump) => {
      const list = baselines.filter((x) => x.scan.pump === pump);
      return list.length ? list[list.length - 1] : null;
    };
    const on = latest('on');
    const off = latest('off');
    const autoPattern = pumpPattern(on, off, margin);
    const override = test.diagnosis || '';
    const pattern = override === 'hide' ? null : (override || autoPattern);

    let worst = null;
    baselines.forEach((x) => { if (!worst || x.result.leakIn > worst.result.leakIn) worst = x; });

    const steps = valid.filter((x) => x.scan.purpose === 'isolation').map((x) => {
      let base = valid.find((y) => y.scan.id === x.scan.compareTo) || null;
      if (!base) base = latest(x.scan.pump) || worst;
      const before = base ? base.result.leakIn : null;
      const after = x.result.leakIn;
      const resolved = after <= margin;
      const reduction = before ? Math.max(0, Math.min(1, (before - after) / before)) : null;
      let outcome;
      if (resolved) outcome = 'resolved';
      else if (reduction != null && reduction < 0.1) outcome = 'unchanged';
      else outcome = 'remaining';
      return Object.assign({}, x, { base, before, after, resolved, reduction, outcome });
    });

    const last = steps.length ? steps[steps.length - 1] : null;
    let status;
    if (!done.length) status = 'pending';
    else if (!valid.length) status = 'rising'; // every scan had water added: test again
    else if (last) status = last.resolved ? 'resolved' : 'remaining';
    else status = worst && worst.result.isLeak ? 'leak' : 'normal';

    return {
      body, area, gpi, evap, margin,
      evapGal: gpi == null ? null : evap * gpi,
      scans, done, valid, risen, baselines, on, off, worst, steps,
      autoPattern, pattern, status,
      rangeDiffers: !!(on && off && autoPattern !== 'structure' && autoPattern !== 'none'),
    };
  }

  /** Each body of water analyzed on its own scans: [{ body, a }]. */
  function analyzeAll(test, settings) {
    return bodiesOf(test).map((body) => ({ body, a: analyze(test, settings, body) }));
  }

  /**
   * The one body that answers "how did the test come out?" for a list row or a headline:
   * a leaking body first (the fastest loss), then one that needs a retest, then not leaking.
   */
  function headlineBody(all) {
    const leaking = all.filter((x) => ['leak', 'resolved', 'remaining'].includes(x.a.status));
    if (leaking.length) return leaking.sort((p, q) => q.a.worst.result.totalIn - p.a.worst.result.totalIn)[0];
    return all.find((x) => x.a.status === 'rising') || all.find((x) => x.a.status === 'normal') || all[0];
  }

  /* ---------- friendly numbers ---------- */

  function roundGal(g) {
    if (g == null || !isFinite(g)) return null;
    if (g < 10) return Math.round(g * 10) / 10;
    if (g < 100) return Math.round(g);
    if (g < 1000) return Math.round(g / 5) * 5;
    return Math.round(g / 10) * 10;
  }

  function fmtGal(g) {
    const r = roundGal(g);
    return r == null ? '—' : r.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function fmtIn(inch, digits) {
    if (inch == null || !isFinite(inch)) return '—';
    return inch.toLocaleString(undefined, { minimumFractionDigits: digits == null ? 2 : digits, maximumFractionDigits: digits == null ? 2 : digits });
  }

  function bathtubs(galPerDay) {
    return galPerDay == null ? null : galPerDay / BATHTUB_GAL;
  }

  /** Simulated LeakVue readings, used only by the clearly-labelled sample test. */
  function sampleReadings(inPerDay, minutes, seed) {
    let s = seed || 1;
    const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    const out = [];
    const step = 5;
    for (let t = 0; t <= minutes * 60; t += step) {
      const level = -(inPerDay / 86400) * t + 0.00025 * gauss() + 0.0003 * Math.sin((2 * Math.PI * t) / 47);
      out.push([t, Math.round(level * 1e5) / 1e5]);
    }
    return out;
  }

  /* ---------- How steady were the readings? ----------
   * A leak doesn't change speed in 15 minutes, and the stilling well damps waves, so a good scan is a
   * straight line with a little fuzz. What spoils one: air in the tube or the sun warming it (the rate
   * drifts), the canister still catching up with the pool (the start is off), a bump (a sudden step),
   * wind or pump vibration (bounce), the float leaving the testing zone, or the phone losing the
   * readings for a while. Thresholds are first guesses from the owner's captures; tune them here. */
  const QUALITY = {
    bin: 2,               // seconds; readings are grouped and the median taken, so one glitch can't count
    jumpIn: 0.001,        // a step this big within one bin (≈40× a 1 in/day leak) = a jump
    bounceFair: 0.0004,   // typical scatter (in) around the trend line
    bouncePoor: 0.0012,
    gapSec: 5,            // no readings for longer than this = a gap
    rateFair: 0.1,        // in/day difference between the first and last third of the scan…
    ratePoor: 0.3,        // …or this share of the scan's own rate, whichever is bigger
    rateFairShare: 0.2,
    ratePoorShare: 0.5,
    minSpanForRate: 180,  // seconds; shorter scans are too short to split in thirds
    settleWindow: 30,     // seconds of readings the "settled" light looks at
    settleMinSpan: 25,
    settleMaxRate: 4,     // in/day; faster than any real leak = the canister is still catching up
    settleSpread: 0.0006, // in; scatter of the 2-second medians around the trend
  };

  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Readings grouped into `sec`-second bins: [[mean t, median level]]. One glitch can't move a median. */
  function binMedians(readings, sec) {
    const groups = new Map();
    const t0 = readings[0][0];
    for (const [t, v] of readings) {
      const k = Math.floor((t - t0) / sec);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([t, v]);
    }
    return Array.from(groups.values()).map((g) => [g.reduce((a, p) => a + p[0], 0) / g.length, median(g.map((p) => p[1]))]);
  }

  const lossPerDay = (fit) => -fit.slope * 86400;

  /**
   * Steadiness of a recorded scan.
   * Returns null when there are too few readings, else
   * { grade: 'good'|'fair'|'poor', issues: [{ code, level: 'info'|'fair'|'poor', at?, value? }],
   *   bounceIn, thirds: [in/day…] | null, plusMinus (in/day) | null }
   * extra.skipped = out-of-zone readings left out while recording.
   */
  function scanQuality(readings, extra) {
    if (!Array.isArray(readings) || readings.length < 10) return null;
    const Q = QUALITY;
    const n = readings.length;
    const t0 = readings[0][0];
    const span = readings[n - 1][0] - t0;
    if (!(span >= 30)) return null;
    const fit = fitLine(readings);
    if (!fit) return null;
    const issues = [];
    const add = (code, level, more) => issues.push(Object.assign({ code, level }, more || {}));

    // Bounce: typical reading-to-reading jitter (median-based, so a few glitches don't count, and a
    // one-off jump or a slow drift doesn't either; those have their own checks below).
    const diffs = [];
    for (let i = 1; i < n; i++) diffs.push(Math.abs(readings[i][1] - readings[i - 1][1]));
    const jitter = (1.4826 * median(diffs)) / Math.SQRT2;
    // …plus slower rocking (a float swinging every few seconds): each 2-second median against the
    // average of its neighbours within 4 seconds either side (trend allowed for). A one-off step only
    // touches the few bins next to it, so the median over the whole scan ignores it.
    const bins = binMedians(readings, Q.bin);
    const sway = bins.map((b, i) => {
      const nb = bins.slice(Math.max(0, i - 2), i + 3).filter((_, k) => k !== Math.min(i, 2));
      const local = nb.reduce((a, x) => a + x[1] - fit.slope * (x[0] - b[0]), 0) / nb.length;
      return Math.abs(b[1] - local);
    });
    const bounceIn = Math.max(jitter, 1.4826 * median(sway));
    const bouncy = bounceIn > Q.bounceFair;
    if (bounceIn > Q.bouncePoor) add('bounce', 'poor', { value: bounceIn });
    else if (bouncy) add('bounce', 'fair', { value: bounceIn });

    // Jumps: a 2-second median that steps away from the one before by more than the trend explains.
    const jumps = [];
    for (let i = 1; i < bins.length; i++) {
      const step = bins[i][1] - bins[i - 1][1] - fit.slope * (bins[i][0] - bins[i - 1][0]);
      if (Math.abs(step) > Q.jumpIn) jumps.push({ at: bins[i][0] - t0, value: step });
    }
    // A bump is one or two jumps; dozens on a bouncy scan are just the bounce.
    if (jumps.length && !(bouncy && jumps.length > 3)) add('jump', 'poor', Object.assign({ count: jumps.length }, jumps[0]));

    // Gaps: stretches with no readings.
    for (let i = 1; i < n; i++) {
      const dt = readings[i][0] - readings[i - 1][0];
      if (dt > Q.gapSec) add('gap', dt > span * 0.1 ? 'poor' : 'fair', { at: readings[i - 1][0] - t0, value: dt });
    }

    // Out of the testing zone.
    const skipped = (extra && extra.skipped) || 0;
    if (skipped) {
      const share = skipped / (n + skipped);
      add('zone', share > 0.05 ? 'poor' : share > 0.01 ? 'fair' : 'info', { value: skipped });
    }

    // Did the rate change? Compare thirds of the scan.
    let thirds = null;
    let plusMinus = null;
    if (span >= Q.minSpanForRate) {
      thirds = [0, 1, 2].map((k) => {
        const part = readings.filter((p) => p[0] >= t0 + (k * span) / 3 && p[0] <= t0 + ((k + 1) * span) / 3);
        const f = part.length >= 3 ? fitLine(part) : null;
        return f ? lossPerDay(f) : null;
      });
      if (thirds.every((r) => r != null)) {
        const overall = Math.abs(lossPerDay(fit));
        const fairLim = Math.max(Q.rateFair, Q.rateFairShare * overall);
        const poorLim = Math.max(Q.ratePoor, Q.ratePoorShare * overall);
        const [r1, r2, r3] = thirds;
        plusMinus = (Math.max(r1, r2, r3) - Math.min(r1, r2, r3)) / 2;
        const lateAgree = Math.abs(r2 - r3) <= fairLim;
        const startOff = Math.abs(r1 - (r2 + r3) / 2);
        if (lateAgree && startOff > fairLim) add('settling', startOff > poorLim ? 'poor' : 'fair', { value: r1 - (r2 + r3) / 2 });
        else {
          const change = Math.max(r1, r2, r3) - Math.min(r1, r2, r3);
          if (change > poorLim) add('rate', 'poor', { value: r3 - r1 });
          else if (change > fairLim) add('rate', 'fair', { value: r3 - r1 });
        }
      } else thirds = null;
    }

    const grade = issues.some((x) => x.level === 'poor') ? 'poor' : issues.some((x) => x.level === 'fair') ? 'fair' : 'good';
    return { grade, issues, bounceIn, thirds, plusMinus };
  }

  /**
   * Is the canister settled, so the tech can press Test? points = recent [[tSec, inches]], newest last.
   * { state: 'checking', wait } | { state: 'moving', rate } | { state: 'bouncing', spread } | { state: 'settled', rate }
   */
  function settleCheck(points) {
    const Q = QUALITY;
    if (!Array.isArray(points) || !points.length) return { state: 'checking', wait: Q.settleMinSpan };
    const tEnd = points[points.length - 1][0];
    const recent = points.filter((p) => p[0] >= tEnd - Q.settleWindow);
    const span = tEnd - recent[0][0];
    if (recent.length < 5 || span < Q.settleMinSpan) return { state: 'checking', wait: Math.ceil(Q.settleMinSpan - span) };
    const fit = fitLine(recent);
    if (!fit) return { state: 'checking', wait: 1 };
    const rate = lossPerDay(fit);
    const bins = binMedians(recent, Q.bin);
    const res = bins.map((b) => b[1] - (fit.slope * b[0] + fit.intercept));
    const spread = Math.max.apply(null, res) - Math.min.apply(null, res);
    if (Math.abs(rate) > Q.settleMaxRate) return { state: 'moving', rate };
    if (spread > Q.settleSpread) return { state: 'bouncing', spread };
    return { state: 'settled', rate };
  }

  const api = {
    GAL_PER_SQFT_INCH, BATHTUB_GAL, QUALITY, scanQuality, settleCheck,
    num, surfaceArea, gallonsPerInch, fitLine, scanRate, scanResult, pumpPattern, analyze,
    bodiesOf, bodyIdOf, analyzeAll, headlineBody,
    roundGal, fmtGal, fmtIn, bathtubs, sampleReadings,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.LV = root.LV || {}; root.LV.calc = api; }
})(typeof window !== 'undefined' ? window : null);
