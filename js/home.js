// Home page: the hero slideshow, the studio gallery and the photo lightbox.
//
// Photos come from assets/slideshow/manifest.json, written by
// scripts/optimize-images.py together with 1600px (web/) and 720px (thumb/)
// copies. The page never downloads the full-size originals: the hero loads
// one web-size photo up front and the next one just before it shows, and the
// gallery's thumbnails load lazily as they scroll into view.

const MANIFEST = 'assets/slideshow/manifest.json';

let photosPromise = null;
export function loadPhotos() {
  if (!photosPromise) {
    photosPromise = fetch(MANIFEST, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return photosPromise;
}

export async function initSlideshow() {
  const el = document.getElementById('heroSlideshow');
  if (!el) return;
  const photos = await loadPhotos();
  if (!photos.length) return el.classList.add('empty');
  const make = (p, eager) => {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    if (eager) img.fetchPriority = 'high';
    img.src = p.web;
    el.appendChild(img);
    return img;
  };
  const first = make(photos[0], true);
  first.classList.add('active');
  if (photos.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Two photos in the DOM at a time: the one showing and the next, which
  // has a full interval to download before it fades in.
  let index = 0;
  let current = first;
  let next = make(photos[1]);
  setInterval(() => {
    if (document.hidden || !next.complete) return;
    current.classList.remove('active');
    next.classList.add('active');
    const old = current;
    setTimeout(() => old.remove(), 1600);
    current = next;
    index = (index + 1) % photos.length;
    next = make(photos[(index + 1) % photos.length]);
  }, 5200);
}

export async function initGallery() {
  const el = document.getElementById('studioGallery');
  if (!el) return;
  const photos = await loadPhotos();
  if (!photos.length) return el.classList.add('empty');
  const frag = document.createDocumentFragment();
  photos.forEach((p, i) => {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = p.thumb;
    img.dataset.full = p.web;
    img.alt = `Inside GGS Studio, photo ${i + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (p.w && p.h) { img.width = 720; img.height = Math.round((720 * p.h) / p.w); }
    fig.appendChild(img);
    frag.appendChild(fig);
  });
  el.appendChild(frag);
}

export function initLightbox() {
  const box = document.createElement('div');
  box.className = 'lightbox-backdrop';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Photo');
  box.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">&times;</button><img alt="">';
  document.body.appendChild(box);
  const img = box.querySelector('img');
  let lastFocus = null;
  const open = (src, alt) => {
    lastFocus = document.activeElement;
    img.src = src;
    img.alt = alt || '';
    box.classList.add('open');
    document.body.style.overflow = 'hidden';
    box.querySelector('button').focus();
  };
  const close = () => {
    box.classList.remove('open');
    document.body.style.overflow = '';
    lastFocus?.focus?.();
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('#studioGallery img, .review-photos img');
    if (t) open(t.dataset.full || t.src, t.alt);
  });
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.lightbox-close')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('open')) close(); });
}

/** Runs `fn` once the browser is idle (or after `timeout` ms at the latest). */
export function whenIdle(fn, timeout = 2500) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 1200);
}
