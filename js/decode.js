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
    'fe59': 'Nordic Firmware Update', '8ec90001-f315-4f60-9fb8-838830daea50': 'Firmware Update Control',
    '8ec90003-f315-4f60-9fb8-838830daea50': 'Firmware Update (buttonless)',
  };
  function uuidName(u) {
    return KNOWN[shortUuid(u)] || '';
  }

  const api = { hexToBytes, bytesToHex, ascii, looksLikeText, trials, trialsLine, normUuid, shortUuid, uuidName, fmtFloat };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.LV = root.LV || {}; root.LV.decode = api; }
})(typeof window !== 'undefined' ? window : null);
