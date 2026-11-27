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

  /* ---------- One wide summary picture for ServiceTitan ----------
   * ServiceTitan's PDF shrinks pictures to a fixed height (a phone screenshot ends up thumb-sized), so
   * this is wide (about 1.8:1) with at most three lines of very large text, drawn straight onto a
   * canvas so the sizes are exact. */
  const W = 1600, H = 880, PAD = 90;
  const FONT = '-apple-system, system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif';

  /** Largest font size (<= max) at which text fits maxWidth; never below min. */
  function fit(ctx, text, weight, max, min, maxWidth) {
    let size = max;
    for (; size > min; size -= 4) {
      ctx.font = weight + ' ' + size + 'px ' + FONT;
      if (ctx.measureText(text).width <= maxWidth) break;
    }
    ctx.font = weight + ' ' + size + 'px ' + FONT;
    return size;
  }

  /**
   * p: LV.story.plain() result. info: { company, date, number }.
   * Resolves to { name, dataUrl }.
   */
  function summaryPicture(p, info, baseName) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const leak = p.kind === 'leak';
    const accent = leak ? '#b3261e' : p.kind === 'normal' ? '#18794e' : p.kind === 'retest' ? '#9a5b00' : '#5a6878';
    const retest = p.kind === 'retest' ? LV.catalog.plain.retest.picture : null;
    const maxW = W - PAD * 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 28, H);
    ctx.textBaseline = 'alphabetic';

    // 1. Verdict
    const verdict = leak ? 'LEAK FOUND' : p.kind === 'normal' ? 'NOT LEAKING' : retest ? retest[0] : 'TEST NOT FINISHED';
    ctx.fillStyle = accent;
    fit(ctx, verdict, '800', 150, 80, maxW);
    ctx.fillText(verdict, PAD, 230);

    // 2. How much
    let amount = '';
    if (leak) amount = (p.qual === 'Up to' ? 'Up to ' : '') + p.big + ' inches a day';
    else if (p.kind === 'normal' && p.big) amount = p.big + ' inches a day';
    else if (retest) amount = retest[1];
    if (amount && info.bodyName) amount = info.bodyName + ': ' + amount.charAt(0).toLowerCase() + amount.slice(1);
    if (amount) {
      ctx.fillStyle = '#142233';
      fit(ctx, amount, '800', 170, 70, maxW);
      ctx.fillText(amount, PAD, 470);
    }

    // 3. Where
    const third = retest ? retest[2] : p.kind !== 'pending' ? p.short : '';
    if (third) {
      ctx.fillStyle = '#0a4f94';
      fit(ctx, third, '700', 104, 56, maxW);
      ctx.fillText(third, PAD, 660);
    }

    // Small print (fine if it ends up too small to read in the PDF)
    ctx.fillStyle = '#6b7785';
    const foot = [info.company, info.date, info.number].filter(Boolean).join('  ·  ');
    fit(ctx, foot, '500', 44, 28, maxW);
    ctx.fillText(foot, PAD, H - 70);

    return { name: baseName + '-summary.png', dataUrl: c.toDataURL('image/png') };
  }

  LV.reportImages = { render, shareOnWeb, summaryPicture };
})();
