/* Leakvue — Device Lab: find out what a LeakVue sends over Bluetooth.
 *
 * Only shown inside the native iPhone/iPad app. It scans for nearby Bluetooth devices, connects to
 * the one you pick, lists everything the device offers and listens to everything that sends
 * updates. Every value goes into a log (hex plus trial decodings) that can be shared to a Mac.
 *
 * What it will and won't send to a device:
 * - Reading is only done when the tech taps Read. The LeakVue 2 never answers a read, and iOS
 *   hangs up 30 seconds after any unanswered request, so reading automatically killed every
 *   connection.
 * - The only thing it ever writes is the serial port's standard "ready to receive" byte, and only
 *   when the tech taps that button.
 * - It never touches a firmware-update service, and never tries to get past pairing or encryption.
 *
 * The state lives outside the view so the connection and the log survive switching screens.
 */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, $, toast, plural, download } = LV.util;
  const D = LV.decode;

  const MAX_LOG = 50000;      // entries kept in memory; the oldest are dropped past this
  const TAIL = 40;            // log lines shown on screen
  const MAX_DEVICES = 25;     // devices listed on screen (strongest first)
  const POLL_MS = 2000;
  const LOCKED = /insufficient|authenticat|encrypt|authoriz/i;
  // Dialog/Renesas "DSPS" serial port: data arrives on TX once the phone says it is ready on FLOW.
  const DSPS = '0783b03e-8535-b5a0-7140-a304d2495cb7';
  // LeakVue 1 (first seen 26 Nov 2026 as "LeakVue 049"): one maker service with values …0002–…0007.
  const LEAKVUE1_SERVICE = '5a460000-4bd6-4b1a-acd4-456a038e3bae';
  const DSPS_FLOW = '0783b03e-8535-b5a0-7140-a304d2495cb9';
  const FLOW_ON = '01';

  const S = {
    log: [],                  // { t, kind, text }
    dropped: 0,
    logStart: null,
    bt: 'idle',               // idle | starting | ready | off | denied | unsupported | error
    btMessage: '',
    scanning: false,
    devices: new Map(),       // id -> { id, name, rssi, seen, lastSeen, uuids, mfr, svc, sig, watch }
    namedOnly: false,
    conn: null,               // { id, name, status, services, chars: Map, locked, busy }
    aliases: new Map(),       // "service|characteristic" -> "C1"
    open: new Set(),          // characteristic keys whose number table is expanded
    poll: false,
    pollTimer: null,
    polling: false,
  };

  let mounted = null;         // { root, dirty } while the screen is showing

  /* ---------- Log ---------- */

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function clock(t) {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  }
  function fileLine(e) {
    const rel = ((e.t - S.logStart) / 1000).toFixed(3).padStart(9, ' ');
    return new Date(e.t).toISOString() + ' ' + rel + 's ' + e.kind.padEnd(7, ' ') + ' ' + e.text;
  }

  function log(kind, text, t) {
    t = t || Date.now();
    if (S.logStart == null) S.logStart = t;
    S.log.push({ t, kind, text });
    if (S.log.length > MAX_LOG) { S.log.shift(); S.dropped++; }
    mark('log');
  }

  function valueText(bytes) {
    if (!bytes.length) return '(empty)';
    let out = D.bytesToHex(bytes) + ' | "' + D.ascii(bytes) + '"';
    const nums = D.trialsLine(bytes, { includeBytes: bytes.length === 1 });
    if (nums) out += ' | ' + nums;
    return out;
  }

  function summaryLines() {
    const lines = [];
    const c = S.conn;
    if (!c) return lines;
    lines.push('# Device: ' + (c.name || '(no name)') + '  id=' + c.id);
    c.chars.forEach((ch) => {
      if (!ch.count) return;
      let line = '#   ' + ch.alias + ' ' + D.shortUuid(ch.uuid) + ': ' + plural(ch.count, 'value') + ', ' + ch.distinct.size + ' different';
      if (ch.notifyCount > 1) {
        const hz = (ch.notifyCount - 1) / ((ch.lastNotifyT - ch.firstNotifyT) / 1000);
        line += ', pushed about ' + hz.toFixed(2) + ' times a second';
      }
      lines.push(line);
    });
    return lines;
  }

  function logFileText() {
    const head = [
      '# Leakvue Device Lab log',
      '# Shared ' + new Date().toISOString() + ' (times below are UTC, then seconds since the log started)',
      '# ' + navigator.userAgent,
      '# ' + plural(S.log.length, 'line') + (S.dropped ? ' (' + S.dropped + ' oldest lines were dropped)' : ''),
      '# Kinds: NOTE = typed by the tech, ADV = advertisement heard while scanning, READ = value we asked for,',
      '#        NOTIFY = value the device pushed. Values are hex | ASCII | the same bytes as numbers',
      '#        (u/i = unsigned/signed, 16/32 = bits, f32 = float, le/be = byte order).',
    ].concat(summaryLines(), ['']);
    return head.concat(S.log.map(fileLine)).join('\n') + '\n';
  }

  /* ---------- Rendering (batched so a chatty device can't freeze the screen) ---------- */

  function mark(part) {
    if (mounted) mounted.dirty[part] = true;
  }

  function signalWord(rssi) {
    if (rssi == null) return '';
    if (rssi >= -60) return 'very close';
    if (rssi >= -75) return 'near';
    if (rssi >= -90) return 'far';
    return 'very far';
  }

  function btTpl() {
    if (S.bt === 'denied') {
      return html`<div class="lab-alert"><strong>Bluetooth is switched off for this app.</strong>
        Tap Open Settings, turn on Bluetooth, then come back and scan again.
        <div class="btn-row"><button type="button" class="btn btn-sm" data-act="settings">Open Settings</button></div></div>`;
    }
    if (S.bt === 'off') {
      return html`<div class="lab-alert"><strong>Bluetooth is turned off.</strong>
        Turn it on in the iPhone's Settings or Control Centre, then tap Start scan again.</div>`;
    }
    if (S.bt === 'unsupported') {
      return html`<div class="lab-alert"><strong>This device has no Bluetooth.</strong>
        The iPhone Simulator on a Mac can't use Bluetooth. Run the app on a real iPhone or iPad.</div>`;
    }
    if (S.bt === 'error') return html`<div class="lab-alert"><strong>Bluetooth problem:</strong> ${S.btMessage}</div>`;
    return '';
  }

  function devicesTpl() {
    let list = Array.from(S.devices.values());
    const total = list.length;
    if (S.namedOnly) list = list.filter((d) => d.name);
    list.sort((a, b) => (b.rssi == null ? -999 : b.rssi) - (a.rssi == null ? -999 : a.rssi));
    const shown = list.slice(0, MAX_DEVICES);
    const connectedId = S.conn && S.conn.status !== 'disconnected' ? S.conn.id : null;

    return html`
      ${btTpl()}
      <div class="btn-row lab-scan-row">
        <button type="button" class="btn ${S.scanning ? '' : 'btn-primary'}" data-act="scan" ${S.bt === 'starting' ? 'disabled' : ''}>
          ${S.bt === 'starting' ? 'Starting Bluetooth…' : S.scanning ? 'Stop scan' : 'Start scan'}
        </button>
        ${S.scanning ? html`<span class="lab-live"><span class="lab-dot"></span>Scanning</span>` : ''}
      </div>
      <details class="lab-advanced">
        <summary>LeakVue app already running?</summary>
        <p class="muted small">If the official LeakVue app is connected to the device right now, it won't show up in a scan.
        Tap below to find it so you can listen in while that app runs the test.</p>
        <button type="button" class="btn btn-sm" data-act="find" ${S.bt === 'starting' ? 'disabled' : ''}>Find the connected LeakVue</button>
      </details>
      ${total ? html`
        <label class="check lab-check"><input type="checkbox" data-act="named" ${S.namedOnly ? 'checked' : ''}> Only show devices with a name</label>
        <ul class="lab-devices">
          ${shown.map((d) => html`
            <li class="lab-device ${/leak/i.test(d.name || '') ? 'is-likely' : ''}">
              <div class="lab-device-main">
                <div class="lab-device-name">${d.name || html`<span class="muted">No name</span>`}</div>
                <div class="lab-device-meta">
                  ${d.seen ? html`<span class="lab-rssi">${d.rssi == null ? '' : d.rssi + ' dBm · ' + signalWord(d.rssi)}</span> · heard ${d.seen}×`
                    : html`<span class="pill">already connected (another app)</span>`}
                </div>
                <div class="lab-id">${d.id}</div>
                ${d.uuids && d.uuids.length ? html`<div class="lab-id">services: ${d.uuids.map(D.shortUuid).join(', ')}</div>` : ''}
                ${d.mfr ? html`<div class="lab-id">maker data: ${d.mfr}</div>` : ''}
                ${d.svc ? html`<div class="lab-id">service data: ${d.svc}</div>` : ''}
              </div>
              <div class="lab-device-acts">
                ${d.id === connectedId
                  ? html`<span class="pill status-completed">Connected</span>`
                  : html`<button type="button" class="btn btn-sm btn-primary" data-act="connect" data-id="${d.id}" ${S.conn && S.conn.busy ? 'disabled' : ''}>Connect</button>`}
                <button type="button" class="btn btn-sm ${d.watch ? 'is-on' : ''}" data-act="watch" data-id="${d.id}" aria-pressed="${d.watch ? 'true' : 'false'}">${d.watch ? 'Watching' : 'Watch'}</button>
              </div>
            </li>`)}
        </ul>
        ${list.length > shown.length ? html`<p class="muted small">Showing the ${shown.length} strongest of ${list.length}. Hold the phone right next to the LeakVue so it comes to the top.</p>` : ''}
        ${!list.length ? html`<p class="muted small">No named devices yet. Untick the box to see ${plural(total, 'device')} without a name.</p>` : ''}
      ` : html`<p class="muted small">${S.scanning
          ? 'Listening… turn the LeakVue on and hold the phone next to it.'
          : 'Turn the LeakVue on, hold the phone next to it, and tap Start scan. The strongest signal is listed first.'}</p>`}
    `;
  }

  function propsList(p) {
    const out = [];
    if (p.read) out.push('read');
    if (p.notify) out.push('notify');
    if (p.indicate) out.push('indicate');
    if (p.write) out.push('write');
    if (p.writeWithoutResponse) out.push('write-no-reply');
    if (p.broadcast) out.push('broadcast');
    if (p.authenticatedSignedWrites) out.push('signed-write');
    if (p.notifyEncryptionRequired || p.indicateEncryptionRequired) out.push('encrypted');
    return out;
  }

  function charTpl(ch) {
    const bytes = ch.last;
    const rows = bytes && bytes.length ? D.trials(bytes, { includeBytes: bytes.length === 1 }) : [];
    let rate = '';
    if (ch.notifyCount > 1) {
      const hz = (ch.notifyCount - 1) / ((ch.lastNotifyT - ch.firstNotifyT) / 1000);
      rate = hz >= 1 ? ' · about ' + hz.toFixed(1) + ' a second' : ' · about one every ' + (1 / hz).toFixed(1) + ' s';
    }
    return html`
      <li class="lab-char ${ch.count ? 'has-data' : ''}">
        <div class="lab-char-head">
          <span class="lab-alias">${ch.alias}</span>
          <span class="lab-char-name">${ch.userName ? html`“${ch.userName}”` : D.uuidName(ch.uuid) || 'Unknown (maker-specific)'}</span>
        </div>
        <div class="lab-id">${D.shortUuid(ch.uuid)}</div>
        <div class="lab-props">
          ${propsList(ch.props).map((p) => html`<span class="pill">${p}</span>`)}
          ${ch.subscribed ? html`<span class="pill status-completed">listening</span>` : ''}
        </div>
        ${ch.error ? html`<div class="lab-error">${ch.error}</div>` : ''}
        ${ch.isData && ch.decoded ? html`
          <div class="lab-reading ${ch.decoded.error ? 'is-err' : ''}">
            ${ch.decoded.error ? 'Float out of the testing zone (no reading)'
              : html`Change since zero <strong>${fmtIn((ch.level - ch.lbase) * ch.decoded.inPerUnit)}</strong>`}
            <span class="muted small">packet ${ch.decoded.counter}${ch.drops ? ' · ' + ch.drops + ' dropped' : ''}${ch.errs ? ' · ' + ch.errs + ' sensor errors' : ''}</span>
          </div>
          ${ch.lbase != null ? html`<div class="muted small">LeakVue ${ch.model} · ${ch.decoded.unitText || ''} · inches are approximate until confirmed · ${plural(ch.count, 'reading')}</div>` : ''}
          ${!ch.decoded.error ? html`<button type="button" class="btn btn-sm lab-read" data-act="zero" data-key="${ch.key}">Zero here</button>` : ''}` : ''}
        ${ch.props.read && !ch.firmware && S.conn && S.conn.status === 'connected' ? html`
          <button type="button" class="btn btn-sm lab-read" data-act="read" data-key="${ch.key}" ${S.conn.busy || S.conn.stalled ? 'disabled' : ''}>Read</button>` : ''}
        ${bytes ? html`
          <div class="lab-value">${bytes.length ? D.bytesToHex(bytes) : '(empty)'}</div>
          ${D.looksLikeText(bytes) ? html`<div class="lab-text">Text: “${D.ascii(bytes).replace(/\.+$/, '')}”</div>` : ''}
          <div class="lab-device-meta">${plural(ch.count, 'value')} · ${ch.distinct.size} different${rate} · last at ${clock(ch.lastT)}</div>
          ${rows.length ? html`
            <details data-key="${ch.key}" ${S.open.has(ch.key) ? 'open' : ''}>
              <summary>Show as numbers</summary>
              <div class="lab-table-wrap"><table class="lab-table">
                ${rows.map((r) => html`<tr><th>${r.type}</th>${r.values.map((v) => html`<td>${v.text}</td>`)}</tr>`)}
              </table></div>
            </details>` : ''}
        ` : ''}
      </li>`;
  }

  function connTpl() {
    const c = S.conn;
    if (!c) return html`<p class="muted small">Not connected. Tap Connect on a device above.</p>`;
    const statusPill = c.status === 'connected'
      ? html`<span class="pill status-completed">Connected</span>`
      : c.status === 'connecting'
        ? html`<span class="pill status-in_progress">Connecting…</span>`
        : html`<span class="pill">Disconnected</span>`;
    return html`
      <div class="lab-conn-head">
        <div>
          <div class="lab-device-name">${c.name || 'No name'}</div>
          <div class="lab-id">${c.id}</div>
        </div>
        ${statusPill}
      </div>
      ${c.note ? html`<p class="muted small">${c.note}</p>` : ''}
      ${c.stalled && c.status === 'connected' ? html`<div class="lab-alert"><strong>The device didn't answer that.</strong>
        The iPhone hangs up about 30 seconds after an unanswered question, so expect this connection to drop.
        Anything the device pushes in the meantime is still recorded. Reconnect afterwards, and don't read that value again.</div>` : ''}
      ${c.silent ? html`<div class="lab-alert"><strong>The device isn't answering.</strong>
        It connected, but it ignored our request to listen. If the iPhone shows a <em>Bluetooth Pairing Request</em>,
        tap <strong>Pair</strong>, then reconnect. If it asks for a code you don't have, stop there and share the log.</div>` : ''}
      ${c.locked ? html`<div class="lab-alert"><strong>Some values are locked.</strong>
        The device wants pairing or encryption before it will share them. We stop here rather than
        try to get around that. Share the log; the next step would be asking ALD / PlainSight how the
        device talks.</div>` : ''}
      <div class="btn-row">
        ${c.status === 'disconnected'
          ? html`<button type="button" class="btn btn-sm btn-primary" data-act="connect" data-id="${c.id}">Reconnect</button>`
          : html`<button type="button" class="btn btn-sm" data-act="disconnect">Disconnect</button>`}
      </div>
      ${c.status === 'connected' && Array.from(c.chars.values()).some((ch) => ch.nameDescriptor && !ch.firmware) ? html`
        <div class="lab-step">
          <strong>This device names its values.</strong> Reading the names tells us what each one is. It only reads; nothing is sent to the device.
          <div class="btn-row"><button type="button" class="btn btn-sm" data-act="names" ${c.busy || c.stalled ? 'disabled' : ''}>Read the value names</button></div>
        </div>` : ''}
      ${c.status === 'connected' && c.flow ? html`
        <div class="lab-step">
          <strong>Nothing arriving?</strong> This device sends its data like a serial cable, and it may be waiting
          for the phone to say "ready". That is the one thing this screen can send: a single standard byte, nothing else.
          <div class="btn-row"><button type="button" class="btn btn-sm" data-act="flow" ${c.busy ? 'disabled' : ''}>${c.flowSent ? 'Send "ready" again' : 'Tell the device we\'re ready'}</button></div>
        </div>` : ''}
      ${c.status === 'connected' && Array.from(c.chars.values()).some((ch) => ch.readOk) ? html`
        <label class="check lab-check"><input type="checkbox" data-act="poll" ${S.poll ? 'checked' : ''}> Re-read every 2 seconds
          <span class="muted small">(only values that answered a Read)</span></label>` : ''}
      ${c.services.map((svc) => html`
        <div class="lab-service">
          <div class="sub-label">Service: ${D.uuidName(svc.uuid) || 'Unknown (maker-specific)'}</div>
          <div class="lab-id">${D.shortUuid(svc.uuid)}</div>
          ${D.isFirmwareService(svc.uuid) ? html`<p class="muted small">Used to update the device's software. The Lab leaves it alone.</p>` : ''}
          <ul class="lab-chars">${svc.chars.map((key) => charTpl(c.chars.get(key)))}</ul>
        </div>`)}
      ${c.status === 'connected' && !c.busy && !c.services.length ? html`<p class="muted small">This device didn't list any services.</p>` : ''}
    `;
  }

  function logTpl() {
    const tail = S.log.slice(-TAIL);
    return html`
      <p class="muted small">${S.log.length
        ? plural(S.log.length, 'line') + ' recorded' + (S.dropped ? ' (oldest ' + S.dropped + ' dropped)' : '') + '. Showing the latest ' + tail.length + '.'
        : 'Nothing recorded yet.'}</p>
      ${tail.length ? html`<pre class="lab-log" tabindex="0" aria-label="Latest log lines">${tail.map((e) => clock(e.t) + ' ' + e.kind + ' ' + e.text).join('\n')}</pre>` : ''}
    `;
  }

  function renderPart(part) {
    if (!mounted) return;
    const el = $('[data-role="' + part + '"]', mounted.root);
    if (!el) return;
    el.innerHTML = part === 'devices' ? devicesTpl() : part === 'conn' ? connTpl() : logTpl();
    if (part === 'log') {
      const pre = $('.lab-log', el);
      if (pre) pre.scrollTop = pre.scrollHeight;
    }
  }

  function tick() {
    // Don't swap the page out from under a finger: a tap needs the same button on touch-down and touch-up.
    if (!mounted || mounted.touching) return;
    const active = document.activeElement;
    for (const part of ['devices', 'conn', 'log']) {
      if (!mounted.dirty[part]) continue;
      if (part === 'log' && active && active.classList && active.classList.contains('lab-log')) continue;
      mounted.dirty[part] = false;
      renderPart(part);
    }
  }

  /* ---------- Bluetooth actions ---------- */

  function advText(d) {
    let s = 'name="' + (d.name || '') + '" id=' + d.id + ' rssi=' + d.rssi;
    if (d.uuids && d.uuids.length) s += ' services=[' + d.uuids.map(D.shortUuid).join(',') + ']';
    if (d.mfr) s += ' maker={' + d.mfr + '}';
    if (d.svc) s += ' servicedata={' + d.svc + '}';
    return s;
  }

  function dataMap(obj, keyFn) {
    if (!obj) return '';
    return Object.keys(obj).sort().map((k) => (keyFn ? keyFn(k) : k) + ': ' + D.bytesToHex(D.hexToBytes(obj[k]))).join('; ');
  }

  function onScanResult(r) {
    if (!r || !r.device || !r.device.deviceId) return;
    const id = r.device.deviceId;
    let d = S.devices.get(id);
    const isNew = !d;
    if (!d) { d = { id, name: '', seen: 0, watch: false }; S.devices.set(id, d); }
    const name = r.localName || r.device.name || d.name || '';
    if (name && !d.name && /leak/i.test(name)) d.watch = true; // almost certainly ours: keep its advertisements
    d.name = name;
    d.rssi = typeof r.rssi === 'number' ? r.rssi : d.rssi;
    d.seen++;
    d.lastSeen = Date.now();
    if (r.uuids && r.uuids.length) d.uuids = r.uuids;
    // Maker data is keyed by the Bluetooth company number; show it in hex like the official lists do.
    const mfr = dataMap(r.manufacturerData, (k) => 'company 0x' + Number(k).toString(16).padStart(4, '0'));
    const svc = dataMap(r.serviceData, D.shortUuid);
    if (mfr) d.mfr = mfr;
    if (svc) d.svc = svc;
    const sig = (d.mfr || '') + '|' + (d.svc || '') + '|' + (d.uuids || []).join(',') + '|' + d.name;
    if (isNew || (d.watch && sig !== d.sig)) log('ADV', advText(d));
    d.sig = sig;
    mark('devices');
  }

  async function startBluetooth() {
    S.bt = 'starting';
    S.btMessage = '';
    mark('devices');
    try {
      const on = await LV.ble.init();
      S.bt = on ? 'ready' : 'off';
    } catch (err) {
      const msg = LV.native.errText(err);
      S.bt = /denied|unauthor/i.test(msg) ? 'denied' : /unsupported/i.test(msg) ? 'unsupported' : 'error';
      S.btMessage = msg;
      log('ERROR', 'Bluetooth start failed: ' + msg);
    }
    mark('devices');
    return S.bt === 'ready';
  }

  async function startScan() {
    if (!(await startBluetooth())) return;
    try {
      await LV.ble.startScan(onScanResult);
      S.scanning = true;
      log('SCAN', 'started');
    } catch (err) {
      S.bt = 'error';
      S.btMessage = LV.native.errText(err);
      log('ERROR', 'Scan failed: ' + S.btMessage);
    }
    mark('devices');
  }

  // Ask iOS which devices another app (the official LeakVue app) already has open, since those
  // stop advertising and never appear in a scan. The DSPS serial-port service is what marks a LeakVue.
  async function findConnected() {
    if (!(await startBluetooth())) return;
    let devices = [];
    try {
      devices = await LV.ble.alreadyConnected([DSPS, LEAKVUE1_SERVICE, 'fef5', '180a']);
    } catch (err) {
      log('ERROR', 'Find connected failed: ' + LV.native.errText(err));
      toast(LV.native.errText(err), 'error');
      return;
    }
    let added = 0;
    for (const dev of devices) {
      if (!dev || !dev.deviceId) continue;
      let d = S.devices.get(dev.deviceId);
      if (!d) { d = { id: dev.deviceId, name: '', seen: 0, watch: false }; S.devices.set(dev.deviceId, d); added++; }
      d.name = dev.name || d.name || '';
      d.preconnected = true;
      log('FOUND', 'already connected: name="' + d.name + '" id=' + dev.deviceId);
    }
    toast(devices.length ? plural(devices.length, 'device') + ' already connected' : 'No already-connected device found');
    if (!devices.length) log('FOUND', 'nothing already connected with those services');
    mark('devices');
  }

  async function stopScan() {
    if (!S.scanning) return;
    S.scanning = false;
    await LV.ble.stopScan();
    log('SCAN', 'stopped (' + plural(S.devices.size, 'device') + ' heard)');
    mark('devices');
  }

  function record(ch, kind, hex, t) {
    const bytes = D.hexToBytes(hex);
    t = t || Date.now();
    let extra = '';
    if (kind === 'NOTIFY') {
      if (ch.notifyCount) extra = ' +' + (t - ch.lastNotifyT) + 'ms';
      else ch.firstNotifyT = t;
      ch.notifyCount++;
      ch.lastNotifyT = t;
    }
    ch.count++;
    ch.last = bytes;
    ch.lastT = t;
    ch.error = '';
    if (ch.distinct.size < 1000) ch.distinct.add(hex);
    let hint = '';
    if (ch.isData) {
      const d = readingOf(ch, bytes);
      if (d) {
        ch.decoded = d;
        if (ch.lastCounter != null) {
          const gap = D.leakvueGap(ch.lastCounter, d.counter);
          if (gap !== 1) ch.drops = (ch.drops || 0) + (gap > 1 ? gap - 1 : 0);
        }
        ch.lastCounter = d.counter;
        if (d.error) ch.errs = (ch.errs || 0) + 1;
        if (!d.error) {
          ch.level = d.raw;
          if (ch.lbase == null) ch.lbase = d.raw; // first reading = the zero we measure change from
          if (ch.lmin == null || d.raw < ch.lmin) ch.lmin = d.raw;
          if (ch.lmax == null || d.raw > ch.lmax) ch.lmax = d.raw;
        }
        hint = d.error ? '  level=OUT-OF-ZONE' : '  level=' + d.raw + ' ' + d.unitText + ' packet=' + d.counter;
      }
    }
    log(kind, ch.alias + ' #' + ch.count + extra + ' ' + valueText(bytes) + hint, t);
    mark('conn');
  }

  function noteLocked(c, msg) {
    if (LOCKED.test(msg) && !c.locked) {
      c.locked = true;
      log('LOCKED', 'The device refused a value without pairing/encryption. Not attempting to get around it.');
    }
  }

  /**
   * A device that leaves two requests in a row unanswered is not going to answer the rest, and
   * iOS drops the connection 30 seconds after an unanswered request. So stop asking. The usual
   * cause is that the device wants to be paired first.
   */
  function answered(c, err) {
    if (!err) { c.strikes = 0; return true; }
    if (!/time(d)? ?out/i.test(LV.native.errText(err))) { c.strikes = 0; return true; }
    c.strikes = (c.strikes || 0) + 1;
    if (c.strikes >= 2 && !c.silent) {
      c.silent = true;
      log('SILENT', 'The device left ' + c.strikes + ' requests in a row unanswered. Not sending more. ' +
        'It may be waiting to be paired, or for its own app to start it.');
      mark('conn');
    }
    return !c.silent;
  }

  /** Read one value because the tech asked. Returns false when the device left it unanswered. */
  async function readOne(c, ch, quiet) {
    if (S.conn !== c || c.status !== 'connected' || c.stalled || ch.firmware) return false;
    try {
      const hex = await LV.ble.read(c.id, ch.service, ch.uuid);
      ch.echo = { hex, until: Date.now() + 250 };
      record(ch, 'READ', hex);
      ch.readOk = true;
      return true;
    } catch (err) {
      const msg = LV.native.errText(err);
      ch.error = 'Could not read: ' + msg;
      ch.readOk = false;
      if (!quiet) log('READERR', ch.alias + ' ' + msg);
      noteLocked(c, msg);
      if (/time(d)? ?out/i.test(msg) && S.conn === c && c.status === 'connected') {
        c.stalled = true;
        log('STALLED', ch.alias + ' was not answered. iOS drops the connection about 30 s after an unanswered request. No more reads on this connection.');
      }
      mark('conn');
      return false;
    }
  }

  /** Read each value's text name (2901 descriptor), one at a time. Stops if the device goes quiet. */
  async function readNames(c) {
    for (const ch of c.chars.values()) {
      if (S.conn !== c || c.status !== 'connected' || c.stalled) return;
      if (!ch.nameDescriptor || ch.firmware || ch.userName) continue;
      try {
        const hex = await LV.ble.readDescriptor(c.id, ch.service, ch.uuid, ch.nameDescriptor);
        const bytes = D.hexToBytes(hex);
        let text = '';
        try { text = new TextDecoder('utf-8').decode(Uint8Array.from(bytes)); } catch (_) { text = D.ascii(bytes); }
        ch.userName = text.replace(/\0+$/, '').trim() || '(blank)';
        log('NAME', ch.alias + ' = "' + ch.userName + '"  (' + D.bytesToHex(bytes) + ')');
      } catch (err) {
        const msg = LV.native.errText(err);
        log('NAMEERR', ch.alias + ' ' + msg);
        noteLocked(c, msg);
        if (/time(d)? ?out/i.test(msg)) {
          c.stalled = true;
          log('STALLED', 'The device did not answer. No more reads on this connection.');
          return;
        }
      }
      mark('conn');
    }
  }

  /** The every-2-seconds re-read: only values that have already answered a Read. */
  async function pollOnce(c) {
    for (const ch of c.chars.values()) {
      if (ch.readOk && !ch.subscribed) await readOne(c, ch, true);
    }
  }

  async function subscribeAll(c) {
    for (const ch of c.chars.values()) {
      if (S.conn !== c || c.status !== 'connected' || c.silent) return;
      if (!(ch.props.notify || ch.props.indicate) || ch.subscribed || ch.firmware) continue;
      try {
        await LV.ble.subscribe(c.id, ch.service, ch.uuid, (hex) => {
          if (S.conn !== c) return;
          // The plugin reports the answer to a Read a second time as if the device had pushed it. Drop that copy.
          const e = ch.echo;
          ch.echo = null;
          if (e && e.hex === hex && Date.now() <= e.until) return;
          record(ch, 'NOTIFY', hex);
        });
        ch.subscribed = true;
        ch.error = '';
        log('LISTEN', ch.alias + ' listening for ' + (ch.props.notify ? 'notifications' : 'indications'));
        answered(c);
      } catch (err) {
        const msg = LV.native.errText(err);
        ch.error = 'Could not listen: ' + msg;
        log('SUBERR', ch.alias + ' ' + msg);
        noteLocked(c, msg);
        if (!answered(c, err)) { mark('conn'); return; }
      }
      mark('conn');
    }
  }

  function setPoll(on) {
    S.poll = on;
    clearInterval(S.pollTimer);
    S.pollTimer = null;
    if (!on) return;
    S.pollTimer = setInterval(async () => {
      const c = S.conn;
      if (!c || c.status !== 'connected' || c.busy || S.polling) return;
      S.polling = true;
      try { await pollOnce(c); } finally { S.polling = false; }
    }, POLL_MS);
  }

  function onDisconnected(c) {
    if (S.conn !== c || c.status === 'disconnected') return;
    c.status = 'disconnected';
    c.busy = false;
    c.chars.forEach((ch) => { ch.subscribed = false; });
    log('DISCONN', 'id=' + c.id + (c.connectedAt ? ' after ' + ((Date.now() - c.connectedAt) / 1000).toFixed(1) + 's connected' : ''));
    mark('conn');
    mark('devices');
  }

  async function connect(id) {
    if (S.conn && S.conn.busy) return;
    if (S.conn && S.conn.status !== 'disconnected') await disconnect();
    await stopScan();
    if (S.bt !== 'ready' && !(await startBluetooth())) return;

    const known = S.devices.get(id);
    const c = S.conn = {
      id, name: (known && known.name) || '', status: 'connecting', services: [], chars: new Map(),
      locked: false, busy: true, note: 'Connecting… keep the phone next to the device.',
    };
    mark('conn');
    mark('devices');
    log('CONNECT', 'name="' + c.name + '" id=' + id);
    try {
      await LV.ble.connect(id, () => onDisconnected(c));
      if (S.conn !== c) return;
      c.status = 'connected';
      c.connectedAt = Date.now();
      c.note = 'Seeing what the device offers…';
      mark('conn');

      const services = await LV.ble.services(id);
      for (const svc of services) {
        const entry = { uuid: svc.uuid, chars: [] };
        c.services.push(entry);
        log('SERVICE', D.shortUuid(svc.uuid) + (D.uuidName(svc.uuid) ? ' (' + D.uuidName(svc.uuid) + ')' : ''));
        for (const chr of svc.characteristics || []) {
          const key = svc.uuid + '|' + chr.uuid;
          if (!S.aliases.has(key)) S.aliases.set(key, 'C' + (S.aliases.size + 1));
          const ch = {
            key, alias: S.aliases.get(key), service: svc.uuid, uuid: chr.uuid, props: chr.properties || {},
            count: 0, notifyCount: 0, distinct: new Set(), last: null, lastT: 0, error: '', subscribed: false,
            firmware: D.isFirmwareService(svc.uuid),
            // The value that carries LeakVue readings: LeakVue 2 (big-endian px) or LeakVue 1 (float mils).
            isData: [D.LEAKVUE_DATA_UUID, D.LEAKVUE1_DATA_UUID].includes(D.normUuid(chr.uuid)),
            model: D.normUuid(chr.uuid) === D.LEAKVUE1_DATA_UUID ? 1 : 2,
            // A 2901 descriptor is the device's own text name for this value ("Level", "Command"…).
            nameDescriptor: ((chr.descriptors || []).map((d) => d.uuid).find((u) => D.shortUuid(u) === '2901')) || null,
            userName: '',
          };
          if (D.normUuid(svc.uuid) === DSPS && D.normUuid(chr.uuid) === DSPS_FLOW && ch.props.writeWithoutResponse) c.flow = ch;
          c.chars.set(key, ch);
          entry.chars.push(key);
          log('CHAR', ch.alias + ' = ' + D.shortUuid(chr.uuid) + ' in service ' + D.shortUuid(svc.uuid) +
            ' props=' + (propsList(ch.props).join(',') || 'none') +
            (D.uuidName(chr.uuid) ? ' (' + D.uuidName(chr.uuid) + ')' : '') +
            ((chr.descriptors || []).length ? ' descriptors=[' + chr.descriptors.map((d) => D.shortUuid(d.uuid)).join(',') + ']' : ''));
        }
      }
      mark('conn');
      await subscribeAll(c);
      if (S.conn === c && c.status === 'connected') {
        const listening = Array.from(c.chars.values()).filter((ch) => ch.subscribed).length;
        c.note = c.silent ? ''
          : listening
            ? 'Listening to ' + plural(listening, 'value') + '. A box turns blue as soon as the device sends something.'
            : 'This device does not push any values on its own. Use the Read buttons below.';
        if (listening) log('READY', 'Listening to ' + plural(listening, 'value') + '. Nothing has been read or written.');
      }
    } catch (err) {
      const msg = LV.native.errText(err);
      log('ERROR', 'Connect failed: ' + msg);
      if (S.conn === c) {
        c.status = 'disconnected';
        c.note = 'Could not connect: ' + msg;
      }
      toast('Could not connect: ' + msg, 'error');
    } finally {
      c.busy = false;
      mark('conn');
      mark('devices');
    }
  }

  async function disconnect() {
    const c = S.conn;
    if (!c || c.status === 'disconnected') return;
    try { await LV.ble.disconnect(c.id); } catch (err) { log('ERROR', 'Disconnect: ' + LV.native.errText(err)); }
    onDisconnected(c);
    c.note = '';
  }

  async function shareLog() {
    if (!S.log.length) { toast('Nothing recorded yet'); return; }
    const d = new Date();
    const name = 'leakvue-device-log-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.txt';
    const text = logFileText();
    if (LV.native.isNative()) {
      if (await LV.native.shareTextFile(name, text, 'Leakvue Device Lab log')) log('NOTE', 'Log shared as ' + name);
    } else {
      download(name, text, 'text/plain');
    }
  }

  /* ---------- The screen ---------- */

  // Markers for a real job, run alongside the ALD app. Each one is stamped with the live LeakVue reading.
  const QUICK_NOTES = [
    'ALD scan started',
    'Pump ON',
    'Pump OFF',
    'Isolated a line',
    'Took a screenshot of the ALD app',
    'ALD scan finished',
  ];

  /** " [LeakVue raw=… packet=… t+…s]" for the reading coming in right now, so a note is tied to the sensor. */
  function liveTag() {
    const c = S.conn;
    if (!c || c.status !== 'connected') return '';
    for (const ch of c.chars.values()) {
      if (!ch.isData || !ch.decoded) continue;
      if (ch.decoded.error) return '  [LeakVue out of zone]';
      if (ch.level == null) return '';
      const since = c.connectedAt ? ' t+' + ((Date.now() - c.connectedAt) / 1000).toFixed(1) + 's' : '';
      return '  [LeakVue ' + ch.model + ' raw=' + ch.level + ' ' + (ch.decoded.unitText || '') +
        ' packet=' + ch.decoded.counter + since + ']';
    }
    return '';
  }
  /**
   * One reading in a shape both models share: { counter, error, raw, unitText, inPerUnit }.
   * raw is what we zero and compare; inPerUnit turns a change in raw into inches.
   */
  function readingOf(ch, bytes) {
    if (ch.model === 1) {
      const d = D.leakvue1(bytes);
      if (!d) return null;
      return { counter: d.counter, error: d.error, raw: d.mils, unitText: d.error ? '' : d.mils.toFixed(3) + ' mils', inPerUnit: 0.001 };
    }
    const d = D.leakvue(bytes);
    if (!d) return null;
    return { counter: d.counter, error: d.error, raw: d.raw, unitText: d.error ? '' : d.px.toFixed(5) + ' px',
      inPerUnit: D.LEAKVUE_IN_PER_PX / D.LEAKVUE_PX_SCALE };
  }
  function fmtIn(inches) {
    return (inches >= 0 ? '+' : '−') + Math.abs(inches).toFixed(4) + ' in';
  }
  function logNote(text) {
    log('NOTE', text + liveTag());
  }

  LV.views.lab = async function (root) {
    if (!LV.ble.available()) {
      root.innerHTML = html`
        <div class="empty">
          <h2>Device Lab is in the iPhone app</h2>
          <p class="muted">Web browsers on iPhone and iPad aren't allowed to use Bluetooth, so this screen only works
          inside the Leakvue app installed from Xcode.</p>
          <a class="btn" href="#/tests">Back to tests</a>
        </div>`;
      return {};
    }

    root.innerHTML = html`
      <div class="page-head">
        <div>
          <h1>Device Lab</h1>
          <p class="muted">See what a LeakVue sends over Bluetooth. This screen listens. It only asks the device for something when you tap a button that says so.</p>
        </div>
      </div>

      <section class="card">
        <h2>1. Find the device</h2>
        <div data-role="devices"></div>
      </section>

      <section class="card">
        <h2>2. What it sends</h2>
        <div data-role="conn"></div>
      </section>

      <section class="card">
        <h2>3. Record and share</h2>
        <p class="muted small">On a real job: tap a marker when it happens, and whenever the ALD app shows a number, type it below.
        Every note saves the LeakVue reading at that instant, so we can line their numbers up with ours.</p>
        <div class="lab-notes">
          ${QUICK_NOTES.map((n) => html`<button type="button" class="chip" data-act="note" data-note="${n}">${n}</button>`)}
        </div>
        <form class="input-action lab-note-form" data-act="note-form">
          <div class="field" style="flex:1"><input type="text" name="note" placeholder="What the ALD app shows, e.g. -0.14in -78gal" autocomplete="off" aria-label="Note for the log"></div>
          <button type="submit" class="btn">Add</button>
        </form>
        <div data-role="log"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-act="share">Share log</button>
          <button type="button" class="btn btn-quiet" data-act="clear">Clear log</button>
        </div>
        <p class="muted small lab-share-tip">Share log opens the share sheet. Pick AirDrop and your Mac; the file lands in the Mac's Downloads folder.</p>
      </section>
    `;

    const view = mounted = { root, dirty: { devices: true, conn: true, log: true }, touching: false };
    LV.native.keepAwake(true); // a capture can run for minutes with nobody touching the phone
    const timer = setInterval(tick, 300);
    tick();

    // Hold off redrawing while a finger is down so taps always land.
    const down = () => { view.touching = true; };
    const up = () => { setTimeout(() => { view.touching = false; }, 0); };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    // <details> forgets it was open when its card is redrawn, so remember it here.
    root.addEventListener('toggle', (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      if (e.target.open) S.open.add(key); else S.open.delete(key);
    }, true);

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !root.contains(btn) || btn.tagName === 'FORM' || btn.tagName === 'INPUT') return;
      const act = btn.dataset.act;
      try {
        if (act === 'scan') { if (S.scanning) await stopScan(); else await startScan(); }
        else if (act === 'find') await findConnected();
        else if (act === 'connect') await connect(btn.dataset.id);
        else if (act === 'disconnect') await disconnect();
        else if (act === 'watch') {
          const d = S.devices.get(btn.dataset.id);
          if (d) {
            d.watch = !d.watch;
            if (d.watch) log('ADV', advText(d) + ' (now watching every change)');
            mark('devices');
          }
        }
        else if (act === 'read') {
          const c = S.conn;
          const ch = c && c.chars.get(btn.dataset.key);
          if (ch && c.status === 'connected' && !c.busy) {
            c.busy = true;
            mark('conn');
            try { await readOne(c, ch); } finally { c.busy = false; mark('conn'); }
          }
        }
        else if (act === 'flow') {
          const c = S.conn;
          if (c && c.flow && c.status === 'connected' && !c.busy) {
            await LV.ble.writeNoReply(c.id, c.flow.service, c.flow.uuid, FLOW_ON);
            c.flowSent = true;
            log('WRITE', c.flow.alias + ' ' + FLOW_ON + ' (serial port flow control: phone is ready to receive)');
            toast('Sent "ready"');
            mark('conn');
          }
        }
        else if (act === 'names') {
          const c = S.conn;
          if (c && c.status === 'connected' && !c.busy) {
            c.busy = true;
            mark('conn');
            try { await readNames(c); } finally { c.busy = false; mark('conn'); }
          }
        }
        else if (act === 'zero') {
          const c = S.conn;
          const ch = c && c.chars.get(btn.dataset.key);
          if (ch && ch.level != null) {
            ch.lbase = ch.level; ch.lmin = ch.level; ch.lmax = ch.level;
            log('ZERO', ch.alias + ' zeroed at raw ' + ch.level);
            mark('conn');
          }
        }
        else if (act === 'settings') await LV.native.plugin('BluetoothLe').openAppSettings();
        else if (act === 'note') { logNote(btn.dataset.note); toast('Noted'); }
        else if (act === 'share') await shareLog();
        else if (act === 'clear') {
          if (!S.log.length || confirm('Clear the log? Share it first if you still need it.')) {
            S.log = []; S.dropped = 0; S.logStart = null;
            mark('log');
          }
        }
      } catch (err) {
        toast(LV.native.errText(err), 'error');
      }
      tick();
    });

    root.addEventListener('change', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'named') { S.namedOnly = e.target.checked; mark('devices'); }
      else if (act === 'poll') { setPoll(e.target.checked); log('NOTE', 'Re-read every 2 seconds: ' + (S.poll ? 'on' : 'off')); }
    });

    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.elements.note;
      const text = input.value.trim();
      if (!text) return;
      logNote(text);
      input.value = '';
      toast('Noted');
    });

    return {
      async destroy() {
        clearInterval(timer);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (mounted === view) mounted = null;
        LV.native.keepAwake(false);
        // Scanning drains the battery, so stop it. A live connection and its log keep going.
        await stopScan();
      },
    };
  };
})();
