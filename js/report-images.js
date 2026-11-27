/* Leakvue — turn report cards into pictures (PNG), for Photos, ServiceTitan or a text message.
 *
 * Uses html2canvas (MIT, js/vendor/), loaded only when someone taps "Save pictures". It ships with the
 * app, so it works with no signal. The report's charts take their colours from the stylesheet, which
 * html2canvas loses when it draws an <svg>, so those colours are copied onto each chart first.
 */
(function () {
  'use strict';
  const LV = window.LV;
  const SRC = 'js/vendor/html2canvas.min.js';
  let loading = null;

  function load() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('the picture maker did not start')));
        s.onerror = () => { loading = null; reject(new Error('the picture maker could not be loaded')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  const SVG_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'opacity', 'visibility', 'display', 'font-family', 'font-size', 'font-weight',
  ];
  /** Write each SVG element's stylesheet look into its own style attribute (in html2canvas's copy of the page). */
  function inlineSvgStyles(root, win) {
    root.querySelectorAll('svg, svg *').forEach((el) => {
      const cs = win.getComputedStyle(el);
      const decl = SVG_PROPS.map((p) => p + ':' + cs.getPropertyValue(p)).filter((d) => !/:$/.test(d)).join(';');
      el.setAttribute('style', (el.getAttribute('style') || '') + ';' + decl);
    });
  }

  /**
   * One PNG per card. onProgress(i, n) is called before each card.
   * Resolves to [{ name, dataUrl }].
   */
  async function render(cards, baseName, onProgress) {
    if (!cards.length) throw new Error('there are no report cards to save');
    const h2c = await load();
    const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const out = [];
    for (let i = 0; i < cards.length; i++) {
      if (onProgress) onProgress(i + 1, cards.length);
      const canvas = await h2c(cards[i], {
        scale,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        onclone: (doc, el) => inlineSvgStyles(el, doc.defaultView),
      });
      out.push({ name: baseName + '-' + String(i + 1).padStart(2, '0') + '.png', dataUrl: canvas.toDataURL('image/png') });
    }
    return out;
  }

  function toFile(im) {
    const bin = atob(im.dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], im.name, { type: 'image/png' });
  }

  /** In a browser: the share sheet if it takes files (iPhone/iPad Safari does), otherwise downloads. */
  async function shareOnWeb(images, title) {
    const files = images.map(toFile);
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title });
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
      }
    }
    files.forEach((f, i) => setTimeout(() => LV.util.download(f.name, f), i * 300));
    return true;
  }

  LV.reportImages = { render, shareOnWeb };
})();
