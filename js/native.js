/* Leakvue — the bridge to the native iPhone/iPad app.
 *
 * In Safari none of this exists and every check here says "not available", so the web app keeps
 * working unchanged. Inside the native app (built with Capacitor) the app injects `window.Capacitor`
 * before our scripts run, with one object per native plugin. We call those directly so there is
 * still no build step.
 *
 * LV.native  is this running inside the app? share a file through the iOS share sheet
 * LV.ble     Bluetooth Low Energy: scan, connect, list services, read, listen, and one
 *            write-without-reply used for the serial port's "ready" signal.
 */
(function () {
  'use strict';
  const LV = window.LV;

  function cap() { return window.Capacitor || null; }
  function isNative() {
    const c = cap();
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
  }
  function plugin(name) {
    const c = cap();
    return (c && c.Plugins && c.Plugins[name]) || null;
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /** Native plugin errors arrive in a few shapes; make them one readable sentence. */
  function errText(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || err.errorMessage || String(err);
  }

  /* ---------- Share sheet ---------- */

  /**
   * Save text as a file and open the iOS share sheet (AirDrop, Mail, Files...).
   * Resolves true when shared, false when the person closed the sheet.
   */
  async function shareTextFile(filename, text, title) {
    const fs = plugin('Filesystem');
    const share = plugin('Share');
    if (!fs || !share) throw new Error('Sharing is not available in this version of the app.');
    const saved = await fs.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
    try {
      await share.share({ title: title || filename, files: [saved.uri] });
      return true;
    } catch (err) {
      if (/cancel/i.test(errText(err))) return false;
      throw err;
    }
  }

  /** Stop (or allow again) the screen dimming and locking. A locked phone stops receiving readings. */
  function keepAwake(on) {
    const p = plugin('KeepAwake');
    if (!p) return;
    Promise.resolve(on ? p.keepAwake() : p.allowSleep()).catch(() => { /* not critical */ });
  }

  LV.native = { isNative, plugin, shareTextFile, keepAwake, errText };

  /* ---------- Bluetooth ---------- */

  let ready = null;
  let scanHandle = null;
  const handles = {}; // listener handles by event name

  function ble() {
    const p = plugin('BluetoothLe');
    if (!p) throw new Error('Bluetooth is only available inside the Leakvue iPhone/iPad app.');
    return p;
  }

  async function listen(key, fn) {
    await unlisten(key);
    handles[key] = await ble().addListener(key, fn);
  }
  async function unlisten(key) {
    const h = handles[key];
    delete handles[key];
    if (h && h.remove) { try { await h.remove(); } catch (_) { /* already gone */ } }
  }

  LV.ble = {
    available() { return !!plugin('BluetoothLe'); },

    /** Turns Bluetooth on for the app. The first call makes iOS ask for permission. Resolves true when the radio is on. */
    async init() {
      const p = ble();
      if (!ready) {
        ready = withTimeout(p.initialize({}), 15000,
          'Bluetooth did not start. Check that Bluetooth is on, then try again.')
          .catch((err) => { ready = null; throw err; });
      }
      await ready;
      const res = await p.isEnabled();
      return !!(res && res.value);
    },

    /** Start scanning. onResult gets { device: { deviceId, name }, localName, rssi, txPower, uuids, manufacturerData, serviceData } every time a device is heard. */
    async startScan(onResult) {
      const p = ble();
      await LV.ble.stopScan();
      scanHandle = await p.addListener('onScanResult', onResult);
      await p.requestLEScan({ allowDuplicates: true });
    },

    async stopScan() {
      const h = scanHandle;
      scanHandle = null;
      if (!LV.ble.available()) return;
      try { await ble().stopLEScan(); } catch (_) { /* not scanning */ }
      if (h && h.remove) { try { await h.remove(); } catch (_) { /* already gone */ } }
    },

    async connect(deviceId, onDisconnect) {
      await listen('disconnected|' + deviceId, () => { if (onDisconnect) onDisconnect(deviceId); });
      await ble().connect({ deviceId, timeout: 15000 });
    },

    async disconnect(deviceId) {
      try { await ble().disconnect({ deviceId }); } finally {
        const prefix = 'notification|' + deviceId + '|';
        await Promise.all(Object.keys(handles).filter((k) => k.indexOf(prefix) === 0).map(unlisten));
        await unlisten('disconnected|' + deviceId);
      }
    },

    /** [{ uuid, characteristics: [{ uuid, properties: { read, write, notify, indicate, ... }, descriptors }] }] */
    async services(deviceId) {
      const res = await ble().getServices({ deviceId });
      return (res && res.services) || [];
    },

    /** Resolves to the value as a hex string. */
    async read(deviceId, service, characteristic) {
      const res = await ble().read({ deviceId, service, characteristic, timeout: 5000 });
      return (res && res.value) || '';
    },

    /** onValue gets a hex string each time the device sends this characteristic. */
    async subscribe(deviceId, service, characteristic, onValue) {
      const key = 'notification|' + deviceId + '|' + service.toLowerCase() + '|' + characteristic.toLowerCase();
      await listen(key, (event) => onValue((event && event.value) || ''));
      await ble().startNotifications({ deviceId, service, characteristic, timeout: 5000 });
    },

    /** Send bytes (hex string) without asking for a reply. The Lab uses this for one thing only: the serial port's "ready" signal. */
    async writeNoReply(deviceId, service, characteristic, hex) {
      await ble().writeWithoutResponse({ deviceId, service, characteristic, value: hex });
    },

    async rssi(deviceId) {
      const res = await ble().readRssi({ deviceId });
      return res ? Number(res.value) : null;
    },

    /**
     * Devices iOS is already connected to that expose one of these services — including ones
     * another app (such as the official LeakVue app) opened. They usually stop advertising once
     * connected, so a scan won't find them; this will. Returns [{ deviceId, name }].
     */
    async alreadyConnected(services) {
      const res = await ble().getConnectedDevices({ services });
      return (res && res.devices) || [];
    },
  };
})();
