/* Leakvue — shared helpers. Classic script (no modules) so the app also runs from file://. */
(function () {
  'use strict';
  const LV = (window.LV = window.LV || {});
  LV.views = LV.views || {};

  /* ---------- HTML templating with automatic escaping ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) {
    return v == null ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  function Raw(s) { this.s = s; }
  Raw.prototype.toString = function () { return this.s; };
  function raw(s) { return new Raw(s == null ? '' : String(s)); }

  function renderVal(v) {
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(renderVal).join('');
    if (v === false || v == null) return '';
    return esc(v);
  }

  /** Tagged template: interpolated values are escaped unless they are html`` results or raw(). */
  function html(strings) {
    let out = strings[0];
    for (let i = 1; i < arguments.length; i++) out += renderVal(arguments[i]) + strings[i];
    return new Raw(out);
  }

  /* ---------- Misc ---------- */
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function debounce(fn, ms) {
    let t = null;
    let lastArgs = null;
    function d() {
      lastArgs = arguments;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(null, lastArgs); }, ms);
    }
    d.flush = function () {
      if (t) { clearTimeout(t); t = null; return fn.apply(null, lastArgs); }
    };
    d.pending = function () { return t !== null; };
    return d;
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtDate(iso, opts) {
    if (!iso) return '';
    const parts = String(iso).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return iso;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtTime(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
    if (!m) return hhmm || '';
    return new Date(2000, 0, 1, Number(m[1]), Number(m[2]))
      .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function fmtDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  /* Read/write nested values with paths like "customer.name" or "findings.2.location". */
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = value;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  let toastTimer = null;
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2600);
  }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function readFile(file, as) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      if (as === 'text') r.readAsText(file);
      else r.readAsDataURL(file);
    });
  }

  function telHref(phone) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    return digits ? 'tel:' + digits : null;
  }

  function fullAddress(p) {
    if (!p) return '';
    const cityLine = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [p.address, cityLine].filter(Boolean).join(', ');
  }

  LV.util = {
    esc, raw, html, uid, debounce, todayISO, fmtDate, fmtTime, fmtDateTime, plural,
    getPath, setPath, $, $$, toast, download, readFile, telHref, fullAddress,
  };
})();
