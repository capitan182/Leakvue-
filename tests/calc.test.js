// Run with: node tests/calc.test.js
const assert = require('assert');
const C = require('../js/calc.js');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Surface area and gallons per inch
close(C.surfaceArea({ shape: 'rectangle', length: 32, width: 16 }), 512, 1e-9, 'rect');
close(C.surfaceArea({ shape: 'round', diameter: 20 }), Math.PI * 100, 1e-9, 'round');
close(C.surfaceArea({ shape: 'oval', length: 30, width: 15 }), Math.PI * 15 * 7.5, 1e-9, 'oval');
close(C.surfaceArea({ shape: 'kidney', length: 30, width: 12, width2: 16 }), 0.45 * 28 * 30, 1e-9, 'kidney');
close(C.surfaceArea({ shape: 'area', area: '450', spaArea: '50' }), 500, 1e-9, 'area + spa');
assert.strictEqual(C.surfaceArea({ shape: 'rectangle', length: 32 }), null, 'missing width');
close(C.gallonsPerInch(512), 319.2, 0.1, '512 sq ft -> ~319 gal per inch');

// Manual scan: 0.0115 in in 15 min = 1.104 in/day
const ctx = { gpi: C.gallonsPerInch(512), evap: 0.25, margin: 0.1 };
let r = C.scanResult({ dropIn: '0.0115', durationMin: 15 }, ctx);
close(r.totalIn, 1.104, 1e-6, 'in/day');
close(r.leakIn, 0.854, 1e-6, 'leak in/day');
close(r.leakGal, 0.854 * 319.2, 1, 'leak gal/day');
assert.ok(r.isLeak);

// Readings: trend recovers the true rate despite ripple and noise
const readings = C.sampleReadings(1.1, 15, 7);
r = C.scanResult({ readings }, ctx);
close(r.totalIn, 1.1, 0.06, 'fitted rate from noisy readings');
assert.strictEqual(r.source, 'readings');

// Rising water (auto-fill left on) counts as no loss
r = C.scanResult({ dropIn: '-0.002', durationMin: 15 }, ctx);
assert.ok(r.rising && r.totalIn === 0 && r.leakIn === 0);

// Pump patterns
const mk = (pump, inPerDay, extra) => Object.assign({ id: pump + inPerDay, pump, purpose: 'baseline', dropIn: String(inPerDay * 15 / 1440), durationMin: 15 }, extra);
const pool = { shape: 'rectangle', length: 32, width: 16 };
const S = { evaporation: 0.25, margin: 0.1 };
assert.strictEqual(C.analyze({ pool, scans: [mk('on', 1.1), mk('off', 0.45)] }, S).pattern, 'pressure');
assert.strictEqual(C.analyze({ pool, scans: [mk('on', 0.4), mk('off', 1.2)] }, S).pattern, 'suction');
assert.strictEqual(C.analyze({ pool, scans: [mk('on', 0.9), mk('off', 0.95)] }, S).pattern, 'structure');
assert.strictEqual(C.analyze({ pool, scans: [mk('on', 0.3), mk('off', 0.28)] }, S).pattern, 'none');
assert.strictEqual(C.analyze({ pool, scans: [mk('on', 0.9)] }, S).pattern, 'single');
assert.strictEqual(C.analyze({ pool, diagnosis: 'suction', scans: [mk('on', 1.1), mk('off', 0.45)] }, S).pattern, 'suction', 'override');
assert.strictEqual(C.analyze({ pool, diagnosis: 'hide', scans: [mk('on', 1.1), mk('off', 0.45)] }, S).pattern, null, 'hidden');

// Isolation rescans: resolved, second leak, unchanged
const on = mk('on', 1.1);
let a = C.analyze({ pool, scans: [on, mk('off', 0.45), mk('on', 0.28, { id: 'r1', purpose: 'isolation', compareTo: on.id })] }, S);
assert.strictEqual(a.steps[0].outcome, 'resolved');
assert.strictEqual(a.status, 'resolved');
a = C.analyze({ pool, scans: [on, mk('on', 0.6, { id: 'r2', purpose: 'isolation', compareTo: on.id })] }, S);
assert.strictEqual(a.steps[0].outcome, 'remaining');
close(a.steps[0].reduction, (0.85 - 0.35) / 0.85, 1e-6, 'reduction');
assert.strictEqual(a.status, 'remaining');
a = C.analyze({ pool, scans: [on, mk('on', 1.08, { id: 'r3', purpose: 'isolation', compareTo: on.id })] }, S);
assert.strictEqual(a.steps[0].outcome, 'unchanged');
// Isolation scan with no explicit baseline falls back to the latest same-pump baseline
a = C.analyze({ pool, scans: [on, mk('on', 0.28, { id: 'r4', purpose: 'isolation' })] }, S);
assert.strictEqual(a.steps[0].base.scan.id, on.id);

// No pool size: rates still work, gallons are null
a = C.analyze({ pool: {}, scans: [mk('on', 1.1)] }, S);
assert.strictEqual(a.worst.result.leakGal, null);
close(a.worst.result.leakIn, 0.85, 1e-9, 'leak in/day without size');

// Water added during a scan (level rose): left out of every conclusion, never read as "not leaking"
const up = (pump, inPerDay, extra) => mk(pump, -inPerDay, Object.assign({ id: 'up-' + pump + inPerDay }, extra));
a = C.analyze({ pool, scans: [up('on', 0.5), up('off', 0.3)] }, S);
assert.strictEqual(a.status, 'rising', 'every scan rose: test again, not "normal"');
assert.strictEqual(a.risen.length, 2);
assert.strictEqual(a.worst, null);
a = C.analyze({ pool, scans: [up('on', 0.5), mk('off', 1.2)] }, S);
assert.strictEqual(a.status, 'leak', 'a rising scan does not hide a real leak in another scan');
assert.strictEqual(a.worst.scan.pump, 'off');
assert.strictEqual(a.on, null, 'the rising pump-ON scan is not used for the pump pattern');
assert.strictEqual(a.pattern, 'single');
// a rescan never compares itself with a scan that had water added
const upOn = up('on', 0.5);
a = C.analyze({ pool, scans: [on, upOn, mk('on', 0.28, { id: 'r5', purpose: 'isolation', compareTo: upOn.id })] }, S);
assert.strictEqual(a.steps[0].base.scan.id, on.id);
// a rising rescan is ignored, so the test is still "leak", not "resolved"
a = C.analyze({ pool, scans: [on, up('on', 0.2, { purpose: 'isolation', compareTo: on.id })] }, S);
assert.strictEqual(a.steps.length, 0);
assert.strictEqual(a.status, 'leak');
// manual entry: the iPhone pad has no minus key, so "Up" flips the sign
r = C.scanResult({ dropIn: '0.002', durationMin: 15, direction: 'up' }, ctx);
assert.ok(r.rising);
r = C.scanResult({ dropIn: '-0.002', durationMin: 15, direction: 'up' }, ctx);
assert.ok(r.rising, 'a typed minus with Up is still a rise');
r = C.scanResult({ dropIn: '0.002', durationMin: 15, direction: 'down' }, ctx);
assert.ok(!r.rising);

// Several bodies of water tested separately: each is analyzed on its own scans and size
{
  const spa = { id: 'spa1', body: 'Spa', shape: 'round', diameter: 7 };
  const test = {
    pool, otherBodies: [spa],
    scans: [mk('on', 1.1), mk('off', 0.45), mk('on', 0.27, { id: 's-on', bodyId: 'spa1' }), mk('off', 0.26, { id: 's-off', bodyId: 'spa1' })],
  };
  const all = C.analyzeAll(test, S);
  assert.deepStrictEqual(all.map((x) => x.body.id), ['main', 'spa1']);
  assert.strictEqual(all[0].a.status, 'leak');
  assert.strictEqual(all[0].a.done.length, 2, 'pool uses only pool scans');
  assert.strictEqual(all[1].a.status, 'normal', 'spa holds water');
  close(all[1].a.area, Math.PI * 3.5 * 3.5, 1e-9, 'spa area');
  assert.deepStrictEqual(all[1].a.done.map((x) => x.index), [2, 3], 'scan numbers stay as on the tech screen');
  assert.strictEqual(C.headlineBody(all).body.id, 'main', 'the leaking body leads');
  assert.strictEqual(C.analyze(test, S).body.id, 'main', 'default is the first body');
  // a scan pointing at a body that was removed falls back to the first
  assert.strictEqual(C.bodyIdOf({ bodyId: 'gone' }, test), 'main');
  // no extra bodies: exactly as before
  assert.strictEqual(C.analyzeAll({ pool, scans: [mk('on', 1.1)] }, S).length, 1);
  // a retest on one body beats "not leaking" on another for the headline
  const t2 = { pool, otherBodies: [spa], scans: [mk('on', 0.27), up('on', 0.3, { bodyId: 'spa1' })] };
  assert.strictEqual(C.headlineBody(C.analyzeAll(t2, S)).a.status, 'rising');
}

// Friendly rounding
assert.strictEqual(C.fmtGal(4.44), '4.4');
assert.strictEqual(C.fmtGal(47.6), '48');
assert.strictEqual(C.fmtGal(272.4), '270');
assert.strictEqual(C.fmtGal(8173), '8,170');

// Steadiness of recorded scans, and the "settled" light
{
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  // ~4.77 readings a second; level(t) in inches, higher = more water
  const make = (sec, level, every) => { const r = []; for (let t = 0; t <= sec; t += every || 0.21) r.push([Math.round(t * 100) / 100, level(t)]); return r; };
  const leak = (inPerDay) => (t) => -inPerDay * t / 86400;
  const codes = (q) => q.issues.map((x) => x.code + ':' + x.level).sort().join(' ');

  let q = C.scanQuality(make(900, (t) => leak(1)(t) + rnd() * 4e-6));
  assert.strictEqual(q.grade, 'good', 'clean scan ' + codes(q));
  assert.ok(q.thirds.every((r) => Math.abs(r - 1) < 0.02), 'thirds agree: ' + q.thirds);
  assert.ok(q.plusMinus < 0.02);

  q = C.scanQuality(make(900, (t) => leak(1)(t) + rnd() * 0.006));
  assert.ok(q.issues.some((x) => x.code === 'bounce' && x.level === 'poor'), 'bouncy: ' + codes(q));

  q = C.scanQuality(make(900, (t) => leak(1)(t) + (t > 300 ? -0.003 : 0)));
  const j = q.issues.find((x) => x.code === 'jump');
  assert.ok(j && Math.abs(j.at - 300) < 3 && j.count === 1, 'bump at 5:00: ' + JSON.stringify(j));
  assert.strictEqual(q.grade, 'poor');
  assert.ok(!q.issues.some((x) => x.code === 'bounce'), 'a bump is not bounce');

  // one glitch reading (seen on the LeakVue 2) is not a jump
  const g = make(900, leak(1)); g[2000][1] -= 0.07;
  q = C.scanQuality(g);
  assert.strictEqual(q.grade, 'good', 'single glitch ignored: ' + codes(q));

  // canister still catching up for the first couple of minutes
  q = C.scanQuality(make(900, (t) => leak(1)(t) + 0.004 * Math.exp(-t / 60)));
  assert.ok(q.issues.some((x) => x.code === 'settling'), 'settling: ' + codes(q));

  // rate drifts from 0.5 to 1.5 in/day (air bubble warming, say)
  q = C.scanQuality(make(900, (t) => -(0.5 * t + (1 / 900) * t * t / 2) / 86400));
  assert.ok(q.issues.some((x) => x.code === 'rate'), 'drift: ' + codes(q));

  // 20 s with no readings
  q = C.scanQuality(make(900, leak(1)).filter((p) => p[0] < 400 || p[0] > 420));
  assert.ok(q.issues.some((x) => x.code === 'gap' && x.level === 'fair' && Math.abs(x.at - 400) < 1), 'gap: ' + codes(q));

  // out of the testing zone
  assert.strictEqual(C.scanQuality(make(900, leak(1)), { skipped: 300 }).issues.find((x) => x.code === 'zone').level, 'poor');
  assert.strictEqual(C.scanQuality(make(900, leak(1)), { skipped: 2 }).issues.find((x) => x.code === 'zone').level, 'info');
  assert.strictEqual(C.scanQuality(make(900, leak(1)), { skipped: 2 }).grade, 'good');

  // too short to judge; short scans skip the thirds
  assert.strictEqual(C.scanQuality(make(20, leak(1))), null);
  assert.strictEqual(C.scanQuality(make(120, leak(1))).thirds, null);

  // settled light
  assert.strictEqual(C.settleCheck(make(10, leak(1))).state, 'checking');
  assert.strictEqual(C.settleCheck(make(40, leak(1))).state, 'settled');
  assert.strictEqual(C.settleCheck(make(40, (t) => 0.01 * Math.exp(-t / 60))).state, 'moving', 'catching up');
  assert.strictEqual(C.settleCheck(make(40, (t) => leak(1)(t) + rnd() * 0.004)).state, 'bouncing');
  // slow mode (a reading every 1.2 s) still settles
  assert.strictEqual(C.settleCheck(make(40, leak(0.5), 1.23)).state, 'settled');
  // clock-time seconds (as the live light gets them) give the same answer
  const clock = make(40, leak(1)).map((p) => [p[0] + 1795000000, p[1] + 14.9]);
  const sc = C.settleCheck(clock);
  assert.strictEqual(sc.state, 'settled');
  assert.ok(Math.abs(sc.rate - 1) < 1e-3, 'rate with clock times ' + sc.rate);
  close(C.fitLine(clock).slope, -1 / 86400, 1e-12, 'fit with big numbers');
  console.log('steadiness tests passed');
}

console.log('calc tests passed');
