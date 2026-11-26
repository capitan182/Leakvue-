/* Leakvue — finger/stylus/mouse signature pad on a canvas. */
(function () {
  'use strict';
  const LV = window.LV;

  /**
   * Attach a signature pad to a <canvas>.
   * opts: { value: dataUrl|null, onChange(dataUrl|null) }
   */
  function attach(canvas, opts) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasInk = false;
    let last = null;

    function setup() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0d1b2a';
    }

    function drawImage(dataUrl) {
      const img = new Image();
      img.onload = () => {
        const rect = canvas.getBoundingClientRect();
        const scale = Math.min(rect.width / img.width, rect.height / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (rect.width - w) / 2, (rect.height - h) / 2, w, h);
        hasInk = true;
      };
      img.src = dataUrl;
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      events.forEach((ev) => {
        const p = pos(ev);
        ctx.lineTo(p.x, p.y);
        last = p;
      });
      ctx.stroke();
    });

    function end() {
      if (!drawing) return;
      drawing = false;
      hasInk = true;
      if (opts.onChange) opts.onChange(canvas.toDataURL('image/png'));
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    setup();
    if (opts.value) drawImage(opts.value);

    return {
      clear() {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        hasInk = false;
        if (opts.onChange) opts.onChange(null);
      },
      isEmpty() { return !hasInk; },
    };
  }

  LV.signature = { attach };
})();
