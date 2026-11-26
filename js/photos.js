/* Leakvue — photo capture, compression and the reusable photo grid. */
(function () {
  'use strict';
  const LV = window.LV;
  const { html, uid, debounce, toast } = LV.util;

  const MAX_DIM = 1600;
  const QUALITY = 0.82;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = src;
    });
  }

  /** Downscale a photo to keep storage small. Returns a data URL. */
  async function compress(file, opts) {
    const maxDim = (opts && opts.maxDim) || MAX_DIM;
    const type = (opts && opts.type) || 'image/jpeg';
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#fff'; // JPEG has no transparency
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      return canvas.toDataURL(type, QUALITY);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- Lightbox ---------- */
  let lightbox = null;
  function openLightbox(src, caption) {
    if (!lightbox) {
      lightbox = document.createElement('dialog');
      lightbox.className = 'lightbox';
      lightbox.innerHTML =
        '<form method="dialog"><button class="btn lightbox-close" aria-label="Close">Close</button></form>' +
        '<img alt=""><p class="lightbox-caption"></p>';
      lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
      document.body.appendChild(lightbox);
    }
    lightbox.querySelector('img').src = src;
    lightbox.querySelector('img').alt = caption || 'Photo';
    lightbox.querySelector('.lightbox-caption').textContent = caption || '';
    if (lightbox.showModal) lightbox.showModal();
    else lightbox.setAttribute('open', '');
  }

  /**
   * Mount an editable photo grid.
   * opts: { jobId, findingId (or null for general photos), photos, onChange(photos) }
   */
  function mount(el, opts) {
    let photos = opts.photos.slice();
    let busy = 0;
    const captionSavers = {};

    function render() {
      el.innerHTML = html`
        <div class="photo-grid">
          ${photos.map((p) => html`
            <figure class="photo" data-id="${p.id}">
              <button type="button" class="photo-view" data-act="view" aria-label="Enlarge photo">
                <img src="${p.dataUrl}" alt="${p.caption || 'Job photo'}" loading="lazy">
              </button>
              <input class="photo-caption" data-act="caption" value="${p.caption || ''}"
                     placeholder="Add a caption" aria-label="Photo caption" enterkeyhint="done">
              <button type="button" class="photo-del" data-act="delete" aria-label="Delete photo" title="Delete photo">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
              </button>
            </figure>`)}
          <button type="button" class="photo-add" data-act="pick" ${busy ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
            <span>${busy ? 'Adding…' : 'Add photos'}</span>
          </button>
          <input type="file" accept="image/*" multiple hidden data-act="add">
        </div>`;
    }

    function changed() { if (opts.onChange) opts.onChange(photos.slice()); }

    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !el.contains(btn)) return;
      const fig = btn.closest('.photo');
      const id = fig && fig.dataset.id;
      const act = btn.dataset.act;
      if (act === 'pick') {
        el.querySelector('input[data-act="add"]').click();
      } else if (act === 'view') {
        const p = photos.find((x) => x.id === id);
        if (p) openLightbox(p.dataUrl, p.caption);
      } else if (act === 'delete') {
        if (!confirm('Delete this photo?')) return;
        await LV.db.deletePhoto(id);
        photos = photos.filter((x) => x.id !== id);
        render();
        changed();
      }
    });

    el.addEventListener('change', async (e) => {
      const input = e.target;
      if (input.dataset.act !== 'add' || !input.files || !input.files.length) return;
      const files = Array.prototype.slice.call(input.files);
      busy++;
      render();
      let failed = 0;
      for (const file of files) {
        try {
          const dataUrl = await compress(file);
          const photo = {
            id: uid(),
            jobId: opts.jobId,
            findingId: opts.findingId || null,
            caption: '',
            dataUrl,
            createdAt: Date.now(),
          };
          await LV.db.savePhoto(photo);
          photos.push(photo);
        } catch (err) {
          failed++;
          console.error(err);
        }
      }
      busy--;
      render();
      changed();
      if (failed) toast(failed + ' photo(s) could not be added.', 'error');
    });

    el.addEventListener('input', (e) => {
      const input = e.target;
      if (input.dataset.act !== 'caption') return;
      const id = input.closest('.photo').dataset.id;
      const p = photos.find((x) => x.id === id);
      if (!p) return;
      p.caption = input.value;
      const btnImg = input.closest('.photo').querySelector('img');
      if (btnImg) btnImg.alt = p.caption || 'Job photo';
      if (!captionSavers[id]) captionSavers[id] = debounce((photo) => LV.db.savePhoto(photo), 400);
      captionSavers[id](p);
    });

    render();

    return {
      flush() {
        return Promise.all(Object.keys(captionSavers).map((k) => captionSavers[k].flush()));
      },
      get photos() { return photos.slice(); },
    };
  }

  LV.photos = { compress, mount, openLightbox };
})();
