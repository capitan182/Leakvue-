/* Leakvue — record a scan straight from the LeakVue while its own app runs the test.
 *
 * "Record alongside": the tech starts the test in the ALD app (LeakVue 2) or the old LeakVue 1 app as
 * usual. That app holds the Bluetooth link and tells the device to start; iOS also passes the device's
 * readings to us when we connect to the same device (see CLAUDE.md, Experiment A). We only listen:
 * one subscribe to the readings value, never a read or a write.
 *
 * The recording lives here, not in the test screen, so it carries on (and keeps saving) if the tech
 * switches screens. While a test screen shows the test being recorded it attaches a "sink" and saves
 * the readings itself; otherwise we save them straight to the database. Readings are saved about every
 * two seconds, so a crash or a phone call loses at most that much.
 *
 * Readings are stored the way calc.js expects: [secondsSinceStart, levelInches], level relative to the
 * first reading (higher = more water). Out-of-zone readings are skipped and counted.
 */
(function () {
  'use strict';
  const LV = window.LV;
  const D = LV.decode;

  const DSPS = '0783b03e-8535-b5a0-7140-a304d2495cb7';          // LeakVue 2 serial port
  const LEAKVUE1_SERVICE = '5a460000-4bd6-4b1a-acd4-456a038e3bae'; // LeakVue 1
  const SAVE_MS = 2000;
  const QUIET_MS = 4000; // no reading for this long = "waiting for readings"

  const st = {
    status: 'idle',   // idle | finding | choose | none | connecting | connected | error
    message: '',
    device: null,     // { id, name, model: 1 | 2, service, characteristic }
    candidates: [],   // [{ deviceId, name }] when more than one LeakVue is connected
    level: null,      // latest level in inches (absolute, only for "change since")
    lastAt: 0,        // Date.now() of the latest frame
    outOfZone: false, // latest frame said the float is out of the testing zone
    slow: false,      // latest frame had no packet number (ALD Sensor Details / old app's Delta screen)
    active: null,     // { testId, scanId, start, durationSec, readings, skipped, base, sink }
    recent: [],       // last ~45 s of [seconds, inches] for the "settled" light
    errTimes: [],     // Date.now() of out-of-zone frames in the last 10 s
  };
  const listeners = new Set();
  const sinks = new Map(); // testId -> fn(active)
  let saveTimer = null;
  let tickTimer = null;

  function emit(kind) { listeners.forEach((fn) => { try { fn(kind, st); } catch (e) { console.error(e); } }); }
  function set(patch, kind) { Object.assign(st, patch); emit(kind || 'state'); }
  const norm = (u) => D.normUuid(u);

  function available() { return !!(LV.ble && LV.ble.available()); }
  function connected() { return st.status === 'connected'; }

  /** Find the LeakVue another app already has open, and connect to it. */
  async function connect() {
    if (!available()) { set({ status: 'error', message: 'Recording from the LeakVue works in the iPhone/iPad app.' }); return; }
    if (LV.labConnectedId && LV.labConnectedId()) {
      set({ status: 'error', message: 'The Lab is connected to a device. Open Lab and tap Disconnect first.' });
      return;
    }
    set({ status: 'finding', message: '', candidates: [] });
    try {
      const on = await LV.ble.init();
      if (!on) { set({ status: 'error', message: 'Bluetooth is off. Turn it on in Control Center, then try again.' }); return; }
      const found = (await LV.ble.alreadyConnected([DSPS, LEAKVUE1_SERVICE])) || [];
      const leakvues = found.filter((d) => d && d.deviceId);
      if (!leakvues.length) {
        set({ status: 'none', message: 'No LeakVue found. Open the ALD app (or the old LeakVue 1 app), connect it to the LeakVue, then tap Connect LeakVue again.' });
        return;
      }
      if (leakvues.length > 1) { set({ status: 'choose', candidates: leakvues }); return; }
      await connectTo(leakvues[0].deviceId, leakvues[0].name);
    } catch (err) {
      set({ status: 'error', message: LV.native.errText(err) });
    }
  }

  async function connectTo(id, name) {
    set({ status: 'connecting', message: '', candidates: [] });
    try {
      await LV.ble.connect(id, () => onLost(id));
      const services = await LV.ble.services(id);
      let device = null;
      for (const svc of services) {
        for (const chr of svc.characteristics || []) {
          const u = norm(chr.uuid);
          if (u === D.LEAKVUE1_DATA_UUID) device = { id, name: name || 'LeakVue', model: 1, service: svc.uuid, characteristic: chr.uuid };
          else if (u === D.LEAKVUE_DATA_UUID && !device) device = { id, name: name || 'LeakVue', model: 2, service: svc.uuid, characteristic: chr.uuid };
        }
      }
      if (!device) {
        try { await LV.ble.disconnect(id); } catch (_) { /* gone */ }
        set({ status: 'error', message: 'That device does not look like a LeakVue (no readings value found).' });
        return;
      }
      st.device = device;
      await LV.ble.subscribe(id, device.service, device.characteristic, onValue);
      set({ status: 'connected', connectedAt: Date.now(), level: null, lastAt: 0, outOfZone: false, slow: false, message: '', recent: [], errTimes: [] });
      tickTimer = tickTimer || setInterval(() => emit('tick'), 1000);
    } catch (err) {
      set({ status: 'error', message: 'Could not connect: ' + LV.native.errText(err), device: null });
    }
  }

  async function disconnect() {
    const d = st.device;
    if (st.active) await stopRecording('stopped');
    set({ status: 'idle', device: null, level: null, message: '' });
    clearInterval(tickTimer); tickTimer = null;
    // This only ends OUR link; the ALD app keeps its own connection and its test keeps running.
    if (d) { try { await LV.ble.disconnect(d.id); } catch (_) { /* already gone */ } }
  }

  function onLost(id) {
    if (!st.device || st.device.id !== id) return;
    const wasRecording = !!st.active;
    if (wasRecording) stopRecording('lost');
    set({ status: 'error', device: null, level: null,
      message: 'Lost the LeakVue connection.' + (wasRecording ? ' The readings so far are saved.' : '') + ' Check the LeakVue app is still connected, then tap Connect LeakVue.' });
    clearInterval(tickTimer); tickTimer = null;
  }

  /** One frame from the device: hex string. */
  function onValue(hex) {
    const d = st.device;
    if (!d) return;
    const bytes = D.hexToBytes(hex);
    let r = null;
    if (d.model === 1) {
      const x = D.leakvue1(bytes);
      if (x) r = { error: x.error, inches: x.inches, counter: x.counter };
    } else {
      const x = D.leakvue(bytes);
      if (x) r = { error: x.error, inches: x.error ? null : x.px * D.LEAKVUE_IN_PER_PX, counter: x.counter };
    }
    if (!r) return; // not a reading (the 1-byte "01", Align picture pieces)
    const now = Date.now();
    st.lastAt = now;
    st.slow = r.counter == null;
    st.outOfZone = !!r.error;
    st.errTimes = st.errTimes.filter((x) => now - x < 10000);
    if (r.error) st.errTimes.push(now);
    else {
      st.level = r.inches;
      st.recent.push([now / 1000, r.inches]);
      while (st.recent.length && st.recent[0][0] < now / 1000 - 45) st.recent.shift();
    }
    const a = st.active;
    if (a) {
      if (r.error) a.skipped++;
      else {
        if (a.base == null) a.base = r.inches;
        a.readings.push([Math.round((now - a.start) / 10) / 100, Math.round((r.inches - a.base) * 1e7) / 1e7]);
      }
      if ((now - a.start) / 1000 >= a.durationSec) { stopRecording('done'); return; }
    }
    emit('reading');
  }

  /* ---------- recording ---------- */

  function startRecording(opts) {
    if (!connected()) throw new Error('Connect the LeakVue first.');
    if (st.active) throw new Error('Already recording a scan.');
    st.active = {
      testId: opts.testId, scanId: opts.scanId, start: Date.now(), durationSec: opts.durationSec || 900,
      readings: [], skipped: 0, base: null,
    };
    LV.native.keepAwake(true);
    saveTimer = setInterval(persist, SAVE_MS);
    emit('started');
    return st.active;
  }

  /** reason: 'done' (time is up), 'stopped' (tech), 'lost' (connection). */
  async function stopRecording(reason) {
    const a = st.active;
    if (!a) return;
    clearInterval(saveTimer); saveTimer = null;
    a.endReason = reason || 'stopped';
    await persist(a);
    st.active = null;
    LV.native.keepAwake(false);
    listeners.forEach((fn) => { try { fn('finished', st, a); } catch (e) { console.error(e); } });
  }

  /** Save the readings so far: through the test screen if it is showing this test, else to the database. */
  async function persist(a) {
    a = a || st.active;
    if (!a) return;
    const sink = sinks.get(a.testId);
    if (sink) { sink(a); return; }
    try {
      const t = await LV.db.getTest(a.testId);
      const s = t && (t.scans || []).find((x) => x.id === a.scanId);
      if (!s) { if (st.active === a) stopRecording('gone'); return; }
      s.readings = a.readings.slice();
      s.skipped = a.skipped;
      await LV.db.saveTest(t);
    } catch (err) { console.error('Saving readings failed', err); }
  }

  /** A test screen showing testId takes over saving while it is open. Returns a function that detaches it. */
  function attach(testId, fn) {
    sinks.set(testId, fn);
    return () => { if (sinks.get(testId) === fn) sinks.delete(testId); };
  }

  /** fn(kind, state, extra): kind is state | reading | tick | started | finished */
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  LV.recorder = {
    available, connected, connect, connectTo, disconnect, startRecording, stopRecording, attach, on,
    state: () => st,
    quiet: () => connected() && Date.now() - (st.lastAt || st.connectedAt || 0) > QUIET_MS,
    heard: () => st.lastAt > 0,
    recent: () => st.recent,
    // One stray out-of-zone frame is normal; several in 10 s means the float is at the edge.
    zoneTrouble: () => st.outOfZone || st.errTimes.filter((x) => Date.now() - x < 10000).length >= 3,
    recordingScan: () => (st.active ? st.active.scanId : null),
  };
})();
