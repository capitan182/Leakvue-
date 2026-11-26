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
// too short
assert.strictEqual(D.leakvue([0x84, 0x53, 0x8d]), null);
assert.strictEqual(D.leakvue(null), null);
// higher value during the sensor-waving spike than at rest (matches the app's graph going up)
assert.ok(D.leakvue([0x88, 0x3b, 0xad, 0x26, 0x0a]).raw > D.leakvue([0x84, 0x53, 0x8d, 0x9d, 0x86]).raw, 'wave reads higher');
// packet-counter gap, with wrap
assert.strictEqual(D.leakvueGap(0x86, 0x87), 1);
assert.strictEqual(D.leakvueGap(0x10, 0x13), 3);
assert.strictEqual(D.leakvueGap(0xff, 0x00), 1, 'wraps 255->0');
assert.strictEqual(D.leakvueGap(0xfe, 0x01), 3);

console.log('leakvue frame tests passed');
