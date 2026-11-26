/* Leakvue — form field builders and two-way binding to plain objects. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, raw, esc, getPath, setPath } = LV.util;

  function attrs(map) {
    return raw(Object.keys(map)
      .filter((k) => map[k] !== undefined && map[k] !== null && map[k] !== false)
      .map((k) => (map[k] === true ? k : k + '="' + esc(map[k]) + '"'))
      .join(' '));
  }

  function optionPairs(options) {
    return (options || []).map((o) => (typeof o === 'string' ? { id: o, label: o } : o));
  }

  /**
   * Build a labelled field bound to obj[path].
   * o: { type, options, placeholder, hint, full, rows, autocomplete, inputmode, list, blankLabel, readonly }
   */
  function field(obj, label, path, o) {
    o = o || {};
    const v = getPath(obj, path);
    const id = 'f-' + path.replace(/\./g, '-');
    const hintId = o.hint ? id + '-hint' : null;
    const common = {
      id,
      'data-field': path,
      placeholder: o.placeholder,
      'aria-describedby': hintId,
      readonly: o.readonly,
    };
    let control;
    if (o.type === 'textarea') {
      control = html`<textarea ${attrs(Object.assign({ rows: o.rows || 3 }, common))}>${v || ''}</textarea>`;
    } else if (o.type === 'select') {
      const opts = optionPairs(o.options);
      if (v && !opts.some((x) => x.id === v)) opts.push({ id: v, label: v });
      control = html`<select ${attrs(common)}>
        ${o.blankLabel === false ? '' : html`<option value="">${o.blankLabel || 'Select…'}</option>`}
        ${opts.map((x) => html`<option value="${x.id}" ${x.id === (v || '') ? 'selected' : ''}>${x.label}</option>`)}
      </select>`;
    } else if (o.type === 'checkbox') {
      return html`<label class="check${o.full ? ' full' : ''}">
        <input type="checkbox" ${attrs({ id, 'data-field': path, checked: !!v })}>
        <span>${label}</span>
      </label>`;
    } else {
      control = html`<input ${attrs(Object.assign({
        type: o.type || 'text',
        value: v == null ? '' : v,
        autocomplete: o.autocomplete,
        inputmode: o.inputmode,
        list: o.list,
      }, common))}>`;
    }
    return html`<div class="field${o.full ? ' full' : ''}">
      <label for="${id}">${label}</label>
      ${control}
      ${o.hint ? html`<small class="hint" id="${hintId}">${o.hint}</small>` : ''}
    </div>`;
  }

  /** Write changes from any [data-field] control inside root back into getObj(); calls onChange(path, value). */
  function bind(root, getObj, onChange) {
    function handler(e) {
      const el = e.target;
      const path = el && el.dataset && el.dataset.field;
      if (!path) return;
      const value = el.type === 'checkbox' ? el.checked : el.value;
      const obj = getObj();
      if (getPath(obj, path) === value) return;
      setPath(obj, path, value);
      onChange(path, value, el);
    }
    root.addEventListener('input', handler);
    root.addEventListener('change', handler);
  }

  LV.form = { field, bind, attrs };
})();
