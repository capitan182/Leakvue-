// Run with: node tests/decode.test.js
const assert = require('assert');
const D = require('../js/decode.js');

// Hex in and out
assert.deepStrictEqual(D.hexToBytes('0a 1B-ff'), [10, 27, 255]);
assert.deepStrictEqual(D.hexToBytes('0a1bff'), [10, 27, 255]);
assert.deepStrictEqual(D.hexToBytes(''), []);
assert.deepStrictEqual(D.hexToBytes(null), []);
assert.deepStrictEqual(D.hexToBytes('abc'), [0xab], 'a dangling half byte is dropped');
assert.strictEqual(D.bytesToHex([10, 27, 255]), '0a 1b ff');
assert.strictEqual(D.bytesToHex([]), '');

// ASCII
assert.strictEqual(D.ascii([76, 86, 50, 0, 255]), 'LV2..');
assert.strictEqual(D.looksLikeText([76, 86, 50]), true);
assert.strictEqual(D.looksLikeText([76, 86, 50, 0]), true, 'trailing NUL is fine');
assert.strictEqual(D.looksLikeText([76, 0, 50]), false);
assert.strictEqual(D.looksLikeText([1]), false);

// Trial decodings: 2 bytes -> only the 16-bit types
const row = (rows, type) => rows.find((r) => r.type === type);
let t = D.trials([0x34, 0x12]);
assert.deepStrictEqual(t.map((r) => r.type), ['u16le', 'u16be', 'i16le', 'i16be']);
assert.strictEqual(row(t, 'u16le').values[0].value, 0x1234);
assert.strictEqual(row(t, 'u16be').values[0].value, 0x3412);

// Negative numbers and both byte orders
t = D.trials([0xfe, 0xff, 0xff, 0xff]);
assert.strictEqual(row(t, 'i16le').values[0].value, -2);
assert.strictEqual(row(t, 'i16be').values[0].value, -257);
assert.strictEqual(row(t, 'i32le').values[0].value, -2);
assert.strictEqual(row(t, 'u32le').values[0].value, 4294967294);
assert.strictEqual(row(t, 'i16le').values.length, 2, 'two 16-bit numbers fit in 4 bytes');
assert.strictEqual(row(t, 'i16le').values[1].offset, 2);

// Float32: 12.5 is 0x41480000
t = D.trials([0x00, 0x00, 0x48, 0x41]);
assert.strictEqual(row(t, 'f32le').values[0].value, 12.5);
assert.strictEqual(row(t, 'f32le').values[0].text, '12.5');
t = D.trials([0x41, 0x48, 0x00, 0x00]);
assert.strictEqual(row(t, 'f32be').values[0].value, 12.5);

// Every offset, and the byte cap
t = D.trials([1, 2, 3, 4, 5], { every: true });
assert.deepStrictEqual(row(t, 'u16le').values.map((v) => v.offset), [0, 1, 2, 3]);
assert.deepStrictEqual(row(t, 'u32le').values.map((v) => v.offset), [0, 1]);
t = D.trials(new Array(64).fill(1), { maxBytes: 8 });
assert.strictEqual(row(t, 'u16le').values.length, 4);

// Single bytes only when asked
assert.deepStrictEqual(D.trials([7]), []);
assert.strictEqual(row(D.trials([200], { includeBytes: true }), 'i8').values[0].value, -56);

// Log line
assert.strictEqual(D.trialsLine([0x34, 0x12]), 'u16le=[4660] u16be=[13330] i16le=[4660] i16be=[13330]');
assert.strictEqual(D.trialsLine([]), '');

// Float formatting keeps nonsense short
assert.strictEqual(D.fmtFloat(0), '0');
assert.strictEqual(D.fmtFloat(1.5e-12), '1.500e-12');
assert.strictEqual(D.fmtFloat(NaN), 'NaN');
assert.strictEqual(D.fmtFloat(3.1415927410125732), '3.141593');

// UUIDs
assert.strictEqual(D.normUuid('180F'), '0000180f-0000-1000-8000-00805f9b34fb');
assert.strictEqual(D.shortUuid('0000180F-0000-1000-8000-00805F9B34FB'), '180f');
assert.strictEqual(D.shortUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E'), '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
assert.strictEqual(D.uuidName('2A19'), 'Battery Level');
assert.strictEqual(D.uuidName('6E400003-B5A3-F393-E0A9-E50E24DCCA9E'), 'UART TX (device sends)');
assert.strictEqual(D.uuidName('12345678-1234-1234-1234-123456789abc'), '');

console.log('decode tests passed');

// --- LeakVue 2 reading frames ---
let lv = D.leakvue([0x84, 0x53, 0x8d, 0x9d, 0x86]);
assert.strictEqual(lv.error, false);
assert.strictEqual(lv.counter, 0x86);
assert.strictEqual(lv.raw, 0x84538d9d, 'big-endian 32-bit level');
assert.strictEqual(lv.status, 0x84);
// error / no-target sentinel
lv = D.leakvue([0xff, 0x7f, 0xff, 0xff, 0x1c]);
assert.strictEqual(lv.error, true);
assert.strictEqual(lv.counter, 0x1c);
assert.strictEqual(lv.raw, null);
// 4 bytes = the slow reading on the ALD Sensor Details screen (no counter)
lv = D.leakvue([0x84, 0x42, 0x30, 0x70]);
assert.strictEqual(lv.counter, null);
assert.strictEqual(lv.raw, 0x84423070);
assert.strictEqual(D.leakvue([0xff, 0x7f, 0xff, 0xff]).error, true);
// too short (the 1-byte 01 that follows each slow reading is not a reading)
assert.strictEqual(D.leakvue([0x84, 0x53, 0x8d]), null);
assert.strictEqual(D.leakvue([0x01]), null);
assert.strictEqual(D.leakvue(null), null);
// higher value during the sensor-waving spike than at rest (matches the app's graph going up)
assert.ok(D.leakvue([0x88, 0x3b, 0xad, 0x26, 0x0a]).raw > D.leakvue([0x84, 0x53, 0x8d, 0x9d, 0x86]).raw, 'wave reads higher');
// packet-counter gap, with wrap
assert.strictEqual(D.leakvueGap(0x86, 0x87), 1);
assert.strictEqual(D.leakvueGap(0x10, 0x13), 3);
assert.strictEqual(D.leakvueGap(0xff, 0x00), 1, 'wraps 255->0');
assert.strictEqual(D.leakvueGap(0xfe, 0x01), 3);

console.log('leakvue frame tests passed');

// px = raw / (3 × 2^20), the ALD app's unit
assert.strictEqual(D.leakvue([0x84, 0x00, 0x00, 0x00, 0x01]).px, 704);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
close(D.leakvue([0x84, 0x53, 0x8d, 0x9d, 0x86]).px, 132.32638 * 16 / 3, 1e-4, 'still-water px');
// The ALD Sensor Details Delta (27 Nov 2026 23:40 recording): after Clear at raw 0x871f5b0c, each Delta
// equals (raw - that) in inches to the 5 decimals shown.
{
  const be = (hex) => hex.match(/../g).map((h) => parseInt(h, 16));
  const inches = (hex) => D.leakvue(be(hex)).px * D.LEAKVUE_IN_PER_PX;
  const zero = inches('871f5b0c');
  for (const [hex, delta] of [['87281b65', 0.00385], ['871dc359', -0.00070], ['871fb2d5', 0.00015], ['87213ed5', 0.00083],
    ['871f26a8', -0.00009], ['871bd28c', -0.00155], ['871fae23', 0.00014], ['87141ebe', -0.00494], ['8716c4d6', -0.00378],
    ['8716b75e', -0.00380], ['8712bdee', -0.00555], ['870dc20c', -0.00774], ['871308a8', -0.00542], ['87088fb1', -0.01003]]) {
    close(inches(hex) - zero, delta, 0.00001, 'ALD Delta at ' + hex);
  }
}
assert.strictEqual(D.leakvue([0xff, 0x7f, 0xff, 0xff, 0x1c]).px, null);
close(1 * D.LEAKVUE_IN_PER_PX, 0.02113, 1e-9, 'in per px');
console.log('leakvue px tests passed');

// The owner's ALD History Details screens: px figure + scan length -> inches/day, checked against the
// inches implied by the gallons shown (gal / (sqft x 0.623)), which carry more digits than the inches.
const ALD = [ // [px shown, scan seconds, gallons, sqft]
  [5.94424, 511, 16.52, 120],    // May 26, 8:31, 15x8
  [1.06293, 600, 18.87, 900],    // June 3, 10:00, 30x30
  [63.85312, 900, 1261.01, 1500],// June 4 10:18, 25x60
  [74.22552, 900, 1465.85, 1500],// June 4 10:38, 25x60
  [31.79114, 900, 376.70, 900],  // June 9, 30x30
  [49.96741, 869, 6.13, 9],      // June 10, 14:29, 3x3
  [0.89290, 121, 78.52, 900],    // Nov 26 3:53 PM, 2:01, 30x30
  [43.83249, 485, 962.74, 900],  // Apr 20, 8:05, 30x30
  [61.52377, 900, 14.58, 18],    // June 10 10:24, 15:00, 3x6
  [4.25909, 776, 58.52, 900],    // June 10 3:49 PM, 12:56, 30x30
  [175.04136, 341, 3648.74, 600],// June 11, 5:41, 20x30
  [-144.31024, 893, -1721.75, 900], // June 9 10:32, 14:53, 30x30 (level rose: shown as +, same sign both ways)
];
for (const [px, sec, gal, sqft] of ALD) {
  const expected = gal / (sqft * 0.623);
  const got = D.aldInchesPerDay(px, sec);
  assert.ok(Math.abs(got - expected) / expected < 0.003, `ALD ${px}px over ${sec}s: ${got} vs ${expected}`);
}
assert.strictEqual(D.aldInchesPerDay(1, 0), null);
console.log('ALD px-to-inch tests passed');

// LeakVue 1 frames (unit #49): little-endian float32 spot position (~1/6 pixel) + packet counter
{
  let v = D.leakvue1([0xad, 0x40, 0xa9, 0x43, 0x4c]);
  assert.strictEqual(v.counter, 0x4c);
  assert.ok(Math.abs(v.value - 338.5052) < 1e-3, 'first frame ' + v.value);
  v = D.leakvue1([0x5d, 0x6d, 0x39, 0x44, 0x10]);
  assert.ok(Math.abs(v.value - 741.709) < 1e-3, 'settled frame ' + v.value);
  assert.ok(Math.abs(v.inches - 741.709 / D.LEAKVUE1_UNITS_PER_INCH) < 1e-6);
  v = D.leakvue1([0, 0, 0, 0, 0x20]);
  assert.strictEqual(v.error, true, 'zero = no reading');
  assert.strictEqual(D.leakvue1([1, 2]), null);
  // 4-byte frames (Delta screen and Align picture) are levels without a packet counter
  v = D.leakvue1([0xe7, 0x25, 0xb4, 0x43]);
  assert.strictEqual(v.counter, null);
  assert.ok(Math.abs(v.value - 360.296) < 1e-3, '4-byte level ' + v.value);
  // other lengths are not readings
  assert.strictEqual(D.leakvue1([0x01]), null, 'battery byte on the Delta screen');
  assert.strictEqual(D.leakvue1(new Array(20).fill(5)), null, '20-byte picture piece');
  // The old app's live Delta (inches), 27 Nov 2026 23:17 recording: after Clear at level 315.732,
  // Delta = (level - 315.732) x 0.00022, to the 5 decimals it shows.
  const f32 = (x) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x, true); return [0, 1, 2, 3].map((i) => b.getUint8(i)); };
  const zero = D.leakvue1(f32(315.732)).inches;
  for (const [level, delta] of [[313.714, -0.00044], [315.897, 0.00004], [335.605, 0.00437], [339.118, 0.00514],
    [370.294, 0.01200], [366.056, 0.01107], [394.382, 0.01730], [401.796, 0.01893]]) {
    const got = D.leakvue1(f32(level)).inches - zero;
    assert.ok(Math.abs(got - delta) <= 0.000006, `Delta at ${level}: ${got.toFixed(6)} vs ${delta}`);
  }
  console.log('leakvue 1 frame tests passed');
}
