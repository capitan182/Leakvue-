/* Leakvue — turning raw Bluetooth bytes into guesses we can read. Pure functions, no DOM, so they
 * can be checked in Node too (node tests/decode.test.js).
 *
 * We don't know yet how the LeakVue sends the water level, so the Device Lab shows every value as
 * hex plus the same bytes read as each common number type in both byte orders. Whichever column
 * moves smoothly when the water moves is the level.
 */
(function (root) {
  'use strict';

  /** "0a 1B-ff" or "0a1bff" -> [10, 27, 255]. Anything that isn't a hex digit is ignored. */
  function hexToBytes(hex) {
    const clean = String(hex == null ? '' : hex).replace(/[^0-9a-fA-F]/g, '');
    const out = [];
    for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
    return out;
  }

  /** [10, 27, 255] -> "0a 1b ff" */
  function bytesToHex(bytes) {
    return bytes.map((b) => (b < 16 ? '0' : '') + b.toString(16)).join(' ');
  }

  /** Printable ASCII, with a dot for everything else. */
  function ascii(bytes) {
    return bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
  }

  /** True when the bytes look like real text (so the ASCII column is worth a second look). */
  function looksLikeText(bytes) {
    if (bytes.length < 2) return false;
    const end = bytes[bytes.length - 1] === 0 ? bytes.length - 1 : bytes.length; // allow a trailing NUL
    for (let i = 0; i < end; i++) {
      const b = bytes[i];
      if (!((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13)) return false;
    }
    return end > 0;
  }

  const TYPES = [
    { name: 'u8', size: 1, get: (v, o) => v.getUint8(o) },
    { name: 'i8', size: 1, get: (v, o) => v.getInt8(o) },
    { name: 'u16le', size: 2, get: (v, o) => v.getUint16(o, true) },
    { name: 'u16be', size: 2, get: (v, o) => v.getUint16(o, false) },
    { name: 'i16le', size: 2, get: (v, o) => v.getInt16(o, true) },
    { name: 'i16be', size: 2, get: (v, o) => v.getInt16(o, false) },
    { name: 'u32le', size: 4, get: (v, o) => v.getUint32(o, true) },
    { name: 'u32be', size: 4, get: (v, o) => v.getUint32(o, false) },
    { name: 'i32le', size: 4, get: (v, o) => v.getInt32(o, true) },
    { name: 'i32be', size: 4, get: (v, o) => v.getInt32(o, false) },
    { name: 'f32le', size: 4, get: (v, o) => v.getFloat32(o, true) },
    { name: 'f32be', size: 4, get: (v, o) => v.getFloat32(o, false) },
  ];

  function fmtFloat(x) {
    if (!isFinite(x)) return String(x);
    if (x === 0) return '0';
    const a = Math.abs(x);
    // Floats decoded from the wrong bytes are usually absurdly big or small; keep those short.
    if (a >= 1e7 || a < 1e-4) return x.toExponential(3);
    return String(Number(x.toPrecision(7)));
  }

  /**
   * Every way of reading the bytes as a number.
   * Returns [{ type, values: [{ offset, value, text }] }], one row per type.
   * `every` = true tries every starting byte; false (default) steps by the type's own size, which
   * is how a packed list of numbers would be laid out. Only the first `maxBytes` are decoded.
   */
  function trials(bytes, opts) {
    opts = opts || {};
    const max = Math.min(bytes.length, opts.maxBytes || 20);
    const view = new DataView(Uint8Array.from(bytes.slice(0, max)).buffer);
    const rows = [];
    for (const t of TYPES) {
      if (t.size === 1 && !opts.includeBytes) continue;
      if (max < t.size) continue;
      const values = [];
      for (let o = 0; o + t.size <= max; o += opts.every ? 1 : t.size) {
        const value = t.get(view, o);
        values.push({ offset: o, value, text: t.name[0] === 'f' ? fmtFloat(value) : String(value) });
      }
      rows.push({ type: t.name, values });
    }
    return rows;
  }

  /** One-line version for the log file: "u16le=[1,2] u16be=[256,512] ..." */
  function trialsLine(bytes, opts) {
    return trials(bytes, opts)
      .map((r) => r.type + '=[' + r.values.map((v) => v.text).join(',') + ']')
      .join(' ');
  }

  /** Bluetooth's standard 16-bit IDs written out in full look like 0000xxxx-0000-1000-8000-00805f9b34fb. */
  const BASE_TAIL = '-0000-1000-8000-00805f9b34fb';
  function normUuid(u) {
    const s = String(u || '').toLowerCase();
    if (/^[0-9a-f]{4}$/.test(s)) return '0000' + s + BASE_TAIL;
    if (/^[0-9a-f]{8}$/.test(s)) return s + BASE_TAIL;
    return s;
  }
  function shortUuid(u) {
    const s = normUuid(u);
    return s.slice(0, 4) === '0000' && s.slice(8) === BASE_TAIL ? s.slice(4, 8) : s;
  }

  /* Names for the standard pieces most devices have, so the unknown (vendor) ones stand out. */
  const KNOWN = {
    '1800': 'Generic Access', '1801': 'Generic Attribute', '180a': 'Device Information', '180f': 'Battery',
    '1805': 'Current Time', '181a': 'Environmental Sensing', '1809': 'Health Thermometer',
    '2a00': 'Device Name', '2a01': 'Appearance', '2a04': 'Preferred Connection Parameters', '2a05': 'Service Changed',
    '2a19': 'Battery Level', '2a23': 'System ID', '2a24': 'Model Number', '2a25': 'Serial Number',
    '2a26': 'Firmware Revision', '2a27': 'Hardware Revision', '2a28': 'Software Revision', '2a29': 'Manufacturer Name',
    '2a50': 'PnP ID', '2a6e': 'Temperature', '2a6f': 'Humidity', '2a6d': 'Pressure', '2a1c': 'Temperature Measurement',
    '2a2b': 'Current Time',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e': 'Nordic UART Service',
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e': 'UART RX (phone writes)',
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e': 'UART TX (device sends)',
    'fef5': 'Firmware update (Dialog SUOTA)',
    '0783b03e-8535-b5a0-7140-a304d2495cb7': 'Serial port (Dialog DSPS)',
    '0783b03e-8535-b5a0-7140-a304d2495cb8': 'Serial data from the device',
    '0783b03e-8535-b5a0-7140-a304d2495cba': 'Serial data to the device',
    '0783b03e-8535-b5a0-7140-a304d2495cb9': 'Serial flow control',
    'fe59': 'Nordic Firmware Update', '8ec90001-f315-4f60-9fb8-838830daea50': 'Firmware Update Control',
    '8ec90003-f315-4f60-9fb8-838830daea50': 'Firmware Update (buttonless)',
  };
  function uuidName(u) {
    return KNOWN[shortUuid(u)] || '';
  }

  /* --- LeakVue 2 reading frames (Dialog DSPS "data from device", …cb8) ---
   * Worked out from a real capture (26 Nov 2026, confirmed against the official app's own graph):
   *   bytes 0-3  the laser level, a big-endian value (the device's app calls the unit "px").
   *              Higher = higher on the official app's graph. In normal still use byte 0 sits at 0x84.
   *   byte 4     a packet counter, +1 per reading (wraps 255→0), to catch dropped readings.
   *   ff 7f ff ff <ctr>  the sensor's "no reading / lost the target" error.
   * ~5 readings a second. The exact px→inch scale still needs a calibration capture; a leak test
   * only cares about the change over time, where the big constant offset cancels out. */
  const LEAKVUE_DATA_UUID = '0783b03e-8535-b5a0-7140-a304d2495cb8';
  /* Units (see CLAUDE.md):
   * - The ALD app's "px" → inches: 1 px = 0.02113 in. Seven History Details screens (in, gal, px, length)
   *   agree on this once their px figure is scaled by scanLength/15 min: three full 15:00 scans give
   *   0.021133 exactly, the shorter ones 0.02109–0.02113 (display rounding). See aldInchesPerDay().
   * - px = raw / 2^24 is still a GUESS at matching their px. Still water read 132.3264 px; the float
   *   pushed bottom..top on the bench spanned 132.17..136.25 px (≈ 0.09 in). Confirm with the live
   *   Delta on the ALD Sensor Details screen. */
  const LEAKVUE_PX_SCALE = 16777216;
  const LEAKVUE_IN_PER_PX = 0.02113;
  function leakvue(bytes) {
    if (!bytes || bytes.length < 5) return null;
    const counter = bytes[4];
    if (bytes[0] === 0xff && bytes[1] === 0x7f) return { counter, error: true, raw: null, px: null, status: bytes[0] };
    const raw = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0; // 32-bit big-endian, unsigned
    return { counter, error: false, raw, px: raw / LEAKVUE_PX_SCALE, status: bytes[0] };
  }
  /**
   * The ALD app's "~24hr" inches from the px figure on its History Details screen. Their px figure is
   * scaled as if every scan were 15 minutes long, so a shorter scan needs × (15 min / scan length).
   * Inches and gallons on that screen are consistent with each other (gal = in × sqft × 0.623).
   */
  function aldInchesPerDay(pxShown, scanSeconds) {
    if (!isFinite(pxShown) || !(scanSeconds > 0)) return null;
    return pxShown * LEAKVUE_IN_PER_PX * (900 / scanSeconds);
  }

  /* --- LeakVue 1 reading frames (maker service 5a460000-…, value …0002) ---
   * Unit #49, 26-27 Nov 2026, heard alongside the old LeakVue 1 app on an iPad: 5 bytes at ~4.77 a
   * second, byte 4 a +1 packet counter. Bytes 0-3 are a little-endian float32: the laser spot's
   * position on the sensor in about 1/6 pixel (the Align bursts show a 128-pixel profile and the level
   * is 6.0 × the spot's pixel), so the float's whole travel is 0..~768. Higher = more water. Exactly 0
   * = no reading (float out of the zone or moving).
   * Inches: the old app's "24 Hr Approx" in a screen recording, fitted against the logged readings,
   * gives 4,500-5,100 units per inch (r 0.97, endpoint method: (now - start) / elapsed × 24 h).
   * PROVISIONAL until a longer recording narrows it. Other packet lengths on this value are the Align
   * picture (a 4-byte level, then 128 bytes in 20-byte pieces), not readings. */
  const LEAKVUE1_DATA_UUID = '5a460002-4bd6-4b1a-acd4-456a038e3bae';
  const LEAKVUE1_UNITS_PER_INCH = 4700;
  function leakvue1(bytes) {
    if (!bytes || bytes.length !== 5) return null;
    const counter = bytes[4];
    const value = new DataView(Uint8Array.from(bytes.slice(0, 4)).buffer).getFloat32(0, true);
    if (!isFinite(value) || value === 0) return { counter, error: true, value: null, inches: null };
    return { counter, error: false, value, inches: value / LEAKVUE1_UNITS_PER_INCH };
  }

  /** How many readings the counter skipped between two frames (0..255 wrap). 1 = none lost. */
  function leakvueGap(prevCounter, counter) {
    return (counter - prevCounter) & 0xff;
  }

  /** Firmware-update services. The Lab leaves these completely alone. */
  const FIRMWARE = { 'fef5': 1, 'fe59': 1, '8ec90001-f315-4f60-9fb8-838830daea50': 1, '00001530-1212-efde-1523-785feabcd123': 1 };
  function isFirmwareService(u) {
    return !!FIRMWARE[shortUuid(u)];
  }

  const api = {
    hexToBytes, bytesToHex, ascii, looksLikeText, trials, trialsLine, normUuid, shortUuid, uuidName, fmtFloat, isFirmwareService,
    leakvue, leakvue1, LEAKVUE1_DATA_UUID, LEAKVUE1_UNITS_PER_INCH, leakvueGap, aldInchesPerDay, LEAKVUE_DATA_UUID, LEAKVUE_PX_SCALE, LEAKVUE_IN_PER_PX,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.LV = root.LV || {}; root.LV.decode = api; }
})(typeof window !== 'undefined' ? window : null);
