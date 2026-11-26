/* Leakvue — turns the numbers into plain-English pieces used by both the tech screen and the
   homeowner report, so they always say the same thing. */
(function () {
  'use strict';
  const LV = window.LV;
  const C = LV.catalog;
  const K = LV.calc;

  function pumpLabel(pump) { return C.label(C.pumps, pump) || 'Pump ?'; }

  function scanName(x) {
    const s = x.scan;
    let name = 'Scan ' + (x.index + 1) + ' · ' + pumpLabel(s.pump);
    if (s.purpose === 'isolation') name += ' · ' + (s.isolated ? s.isolated + ' isolated' : 'rescan');
    return name;
  }

  /** Bar rows for the baseline (non-isolation) scans. */
  function baselineRows(a) {
    const counts = {};
    a.baselines.forEach((x) => { counts[x.scan.pump] = (counts[x.scan.pump] || 0) + 1; });
    return a.baselines.map((x) => ({
      label: pumpLabel(x.scan.pump),
      note: counts[x.scan.pump] > 1 ? 'scan ' + (x.index + 1) : '',
      result: x.result,
      x,
    }));
  }

  function stepRows(step) {
    const rows = [];
    if (step.base) rows.push({ label: 'Before', note: pumpLabel(step.base.scan.pump).toLowerCase(), result: step.base.result });
    rows.push({ label: 'After isolating ' + (step.scan.isolated || 'the line'), note: pumpLabel(step.scan.pump).toLowerCase(), result: step.result });
    return rows;
  }

  function amount(result, kind) {
    if (result[kind + 'Gal'] != null) return K.fmtGal(result[kind + 'Gal']) + ' gallons a day';
    return K.fmtIn(result[kind + 'In']) + ' inches a day';
  }

  /** Outcome of one isolation rescan: { tone: ok|warn|info, badge, text } */
  function stepText(step) {
    const what = step.scan.isolated || 'that line';
    if (step.outcome === 'resolved') {
      return {
        tone: 'ok',
        badge: 'Leak accounted for',
        text: 'With ' + what + ' isolated, the pool stopped losing more than normal evaporation. That was the leak.',
      };
    }
    if (step.outcome === 'unchanged') {
      return {
        tone: 'info',
        badge: 'Not in ' + what,
        text: 'Isolating ' + what + ' made little difference, so the leak is somewhere else.',
      };
    }
    const pct = step.reduction != null ? Math.round(step.reduction * 100) : null;
    return {
      tone: 'warn',
      badge: 'Another leak likely',
      text: 'With ' + what + ' isolated, the pool still loses about ' + amount(step.result, 'leak') +
        (pct != null ? ' (' + pct + '% less than before)' : '') +
        '. That means there is likely a second leak, so testing continues.',
    };
  }

  /** The headline and stat tiles for the summary card. */
  function headline(a, settings) {
    if (!a.done.length) return { kind: 'pending', sentence: 'No scans recorded yet.' };
    const w = a.worst && a.worst.result;
    if (!w || !w.isLeak) {
      return {
        kind: 'normal',
        big: 'Normal',
        unit: '',
        sentence: 'Your pool’s water loss is within normal evaporation. We did not measure a leak.',
        stats: [],
        week: w ? w.totalIn * 7 : null,
      };
    }
    const qual = a.rangeDiffers ? 'up to' : 'about';
    const stats = [];
    let big, unit, sentence;
    if (w.leakGal != null) {
      big = K.fmtGal(w.leakGal);
      unit = 'gallons a day';
      sentence = 'Your pool is losing ' + qual + ' ' + big + ' gallons of water a day to a leak, on top of normal evaporation.';
      stats.push({ value: K.fmtGal(w.leakGal * 30), label: 'gallons a month' });
      const tubs = K.bathtubs(w.leakGal);
      stats.push({ value: tubs >= 10 ? String(Math.round(tubs)) : (Math.round(tubs * 10) / 10).toString(), label: 'bathtubs of water a day' });
      const cost = K.num(settings.waterCost);
      if (cost) {
        const month = (w.leakGal * 30 / 1000) * cost;
        stats.push({ value: '$' + (month >= 100 ? Math.round(month / 5) * 5 : Math.round(month)).toLocaleString(), label: 'a month in water*' });
      }
    } else {
      big = K.fmtIn(w.leakIn);
      unit = 'inches a day';
      sentence = 'Your pool is losing ' + qual + ' ' + big + ' inches of water a day to a leak, on top of normal evaporation.';
      stats.push({ value: K.fmtIn(w.leakIn * 7, 1) + '″', label: 'a week from the leak' });
    }
    return { kind: 'leak', big, unit, sentence, stats, week: w.totalIn * 7, evapWeek: a.evap * 7, worst: a.worst };
  }

  function pattern(a) {
    return a.pattern ? C.patterns[a.pattern] : null;
  }

  LV.story = { pumpLabel, scanName, baselineRows, stepRows, stepText, headline, pattern, amount };
})();
