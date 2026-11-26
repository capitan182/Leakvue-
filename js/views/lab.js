/* Leakvue — Device Lab: find out what a LeakVue sends over Bluetooth.
 *
 * Only shown inside the native iPhone/iPad app. It scans for nearby Bluetooth devices, connects to
 * the one you pick, lists everything the device offers, reads what can be read and listens to
 * everything that sends updates. Every value goes into a log (hex plus trial decodings) that can be
 * shared to a Mac. It never writes to the device and never tries to get past pairing or encryption.
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
      ${total ? html`
        <label class="check lab-check"><input type="checkbox" data-act="named" ${S.namedOnly ? 'checked' : ''}> Only show devices with a name</label>
        <ul class="lab-devices">
          ${shown.map((d) => html`
            <li class="lab-device ${/leak/i.test(d.name || '') ? 'is-likely' : ''}">
              <div class="lab-device-main">
                <div class="lab-device-name">${d.name || html`<span class="muted">No name</span>`}</div>
                <div class="lab-device-meta">
                  <span class="lab-rssi">${d.rssi == null ? '' : d.rssi + ' dBm · ' + signalWord(d.rssi)}</span>
                  · heard ${d.seen}×
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
          <span class="lab-char-name">${D.uuidName(ch.uuid) || 'Unknown (maker-specific)'}</span>
        </div>
        <div class="lab-id">${D.shortUuid(ch.uuid)}</div>
        <div class="lab-props">
          ${propsList(ch.props).map((p) => html`<span class="pill">${p}</span>`)}
          ${ch.subscribed ? html`<span class="pill status-completed">listening</span>` : ''}
        </div>
        ${ch.error ? html`<div class="lab-error">${ch.error}</div>` : ''}
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
      ${c.silent ? html`<div class="lab-alert"><strong>The device isn't answering.</strong>
        It connected, but it ignores our requests. If the iPhone shows a <em>Bluetooth Pairing Request</em>,
        tap <strong>Pair</strong>, then tap Read everything again. If it asks for a code you don't have,
        stop there and share the log.</div>` : ''}
      ${c.locked ? html`<div class="lab-alert"><strong>Some values are locked.</strong>
        The device wants pairing or encryption before it will share them. We stop here rather than
        try to get around that. Share the log; the next step would be asking ALD / PlainSight how the
        device talks.</div>` : ''}
      <div class="btn-row">
        ${c.status === 'disconnected'
          ? html`<button type="button" class="btn btn-sm btn-primary" data-act="connect" data-id="${c.id}">Reconnect</button>`
          : html`<button type="button" class="btn btn-sm" data-act="disconnect">Disconnect</button>`}
        ${c.status === 'connected' ? html`<button type="button" class="btn btn-sm" data-act="reread" ${c.busy ? 'disabled' : ''}>Read everything again</button>` : ''}
      </div>
      ${c.status === 'connected' ? html`
        <label class="check lab-check"><input type="checkbox" data-act="poll" ${S.poll ? 'checked' : ''}> Re-read every 2 seconds
          <span class="muted small">(for values the device doesn't push on its own)</span></label>` : ''}
      ${c.services.map((svc) => html`
        <div class="lab-service">
          <div class="sub-label">Service: ${D.uuidName(svc.uuid) || 'Unknown (maker-specific)'}</div>
          <div class="lab-id">${D.shortUuid(svc.uuid)}</div>
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
    log(kind, ch.alias + ' #' + ch.count + extra + ' ' + valueText(bytes), t);
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

  async function readAll(c, reason) {
    for (const ch of c.chars.values()) {
      if (S.conn !== c || c.status !== 'connected' || c.silent) return;
      if (!ch.props.read) continue;
      if (reason === 'poll' && (ch.subscribed || ch.readFailed)) continue;
      try {
        record(ch, 'READ', await LV.ble.read(c.id, ch.service, ch.uuid));
        answered(c);
      } catch (err) {
        const msg = LV.native.errText(err);
        ch.error = 'Could not read: ' + msg;
        ch.readFailed = true;
        if (reason !== 'poll') log('READERR', ch.alias + ' ' + msg);
        noteLocked(c, msg);
        mark('conn');
        if (!answered(c, err)) return;
      }
    }
  }

  async function subscribeAll(c) {
    for (const ch of c.chars.values()) {
      if (S.conn !== c || c.status !== 'connected' || c.silent) return;
      if (!(ch.props.notify || ch.props.indicate) || ch.subscribed) continue;
      try {
        await LV.ble.subscribe(c.id, ch.service, ch.uuid, (hex) => { if (S.conn === c) record(ch, 'NOTIFY', hex); });
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
      try { await readAll(c, 'poll'); } finally { S.polling = false; }
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
      c.note = 'Reading what the device offers…';
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
          };
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
      await readAll(c, 'first');
      if (S.conn === c && c.status === 'connected') {
        const listening = Array.from(c.chars.values()).filter((ch) => ch.subscribed).length;
        c.note = c.silent ? ''
          : listening
            ? 'Listening to ' + plural(listening, 'value') + '. Move the water and watch which one changes.'
            : 'This device does not push any values on its own. Try "Re-read every 2 seconds".';
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

  const QUICK_NOTES = [
    'Idle: sensor in still water',
    'Hand raising and lowering the water',
    'Draining a little water',
    'Stopped / water settling',
  ];

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
          <p class="muted">See what a LeakVue sends over Bluetooth. This screen only listens. It never sends anything to the device.</p>
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
        <p class="muted small">Tap a note right before you do each thing, so the log shows what the water was doing.</p>
        <div class="lab-notes">
          ${QUICK_NOTES.map((n) => html`<button type="button" class="chip" data-act="note" data-note="${n}">${n}</button>`)}
        </div>
        <form class="input-action lab-note-form" data-act="note-form">
          <div class="field" style="flex:1"><input type="text" name="note" placeholder="Or type your own note" autocomplete="off" aria-label="Note for the log"></div>
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
        else if (act === 'reread') {
          const c = S.conn;
          if (c && c.status === 'connected' && !c.busy) {
            c.busy = true;
            c.chars.forEach((ch) => { ch.readFailed = false; });
            c.silent = false;
            c.strikes = 0;
            mark('conn');
            try { await subscribeAll(c); await readAll(c, 'again'); } finally { c.busy = false; mark('conn'); }
          }
        }
        else if (act === 'settings') await LV.native.plugin('BluetoothLe').openAppSettings();
        else if (act === 'note') { log('NOTE', btn.dataset.note); toast('Noted'); }
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
      log('NOTE', text);
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
