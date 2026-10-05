// Scroll motion for the public pages. Native scrolling only: nothing here
// pins, snaps or slows the page down.
//
//   [data-reveal]   animates in when it enters the viewport and back out when
//                   it leaves; .above marks "left through the top" so it exits
//                   upward and re-enters from above when you scroll back.
//   [data-stagger]  the same for its children, one after another (--i).
//   .hero           --hp goes 0 -> 1 as the hero scrolls away.
//   .transport      the hero's timeline: the playhead, the lit part of the
//                   waveform and the timecode follow page progress, and the
//                   nav's progress line takes over once the hero is gone.
//
// Everything is skipped under prefers-reduced-motion except the static state.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initReveal(root = document) {
  const els = root.querySelectorAll('[data-reveal], [data-stagger]');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const el = en.target;
      if (en.isIntersecting) {
        el.classList.add('in');
        el.classList.remove('above');
      } else {
        el.classList.remove('in');
        el.classList.toggle('above', en.boundingClientRect.top < 0);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => {
    if (el.hasAttribute('data-stagger')) indexChildren(el);
    io.observe(el);
  });
  // Children added later (services, gallery, reviews load from the network).
  const mo = new window.MutationObserver((records) => records.forEach((r) => indexChildren(r.target)));
  root.querySelectorAll('[data-stagger]').forEach((el) => mo.observe(el, { childList: true }));
}

function indexChildren(el) {
  Array.from(el.children).forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 12))));
}

/** Seeded bar heights so the waveform looks the same on every visit. */
function waveformPath(bars, width, height) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gap = width / bars;
  const bar = Math.max(1, gap * 0.55);
  let d = '';
  for (let i = 0; i < bars; i++) {
    // A song shape: quiet intro, a lift, a drop, a bigger lift, a tail.
    const t = i / bars;
    const shape = 0.25 + 0.55 * Math.sin(Math.PI * t) ** 0.6 + (t > 0.55 && t < 0.8 ? 0.2 : 0) - (t > 0.42 && t < 0.48 ? 0.35 : 0);
    const h = Math.max(2, height * Math.min(1, shape * (0.45 + 0.55 * rand())));
    const x = i * gap + (gap - bar) / 2;
    const y = (height - h) / 2;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}h${bar.toFixed(1)}v${h.toFixed(1)}h-${bar.toFixed(1)}z`;
  }
  return d;
}

export function initHeroMotion() {
  const hero = document.querySelector('.hero');
  const transport = document.querySelector('.transport');
  const nav = document.querySelector('nav');
  if (!hero) return;

  const wave = transport?.querySelector('.transport-wave');
  const timeEl = transport?.querySelector('[data-timecode]');
  const SONG = 3 * 60 + 34; // the "track" is 3:34 long
  if (wave) {
    const draw = () => {
      const w = Math.max(200, Math.round(wave.clientWidth));
      const bars = Math.round(w / 6);
      const d = waveformPath(bars, w, 44);
      wave.querySelector('svg')?.remove();
      wave.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${w} 44" preserveAspectRatio="none" aria-hidden="true"><path class="wave-dim" d="${d}"/><path class="wave-lit" d="${d}"/></svg>`);
      wave.style.setProperty('--w', `${w}px`);
    };
    // Redraw whenever the strip changes size (first layout, rotation, resize).
    let rt;
    new window.ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(draw, 80); }).observe(wave);
  }

  let ticking = false;
  const update = () => {
    ticking = false;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, window.scrollY / max));
    const heroH = hero.offsetHeight || window.innerHeight;
    const hp = Math.min(1, Math.max(0, window.scrollY / (heroH * 0.85)));
    if (!reduce) hero.style.setProperty('--hp', hp.toFixed(3));
    if (wave) wave.style.setProperty('--p', p.toFixed(4));
    if (timeEl) {
      const s = Math.round(p * SONG);
      timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} / 03:34`;
    }
    if (nav) {
      nav.style.setProperty('--progress', p.toFixed(4));
      nav.style.setProperty('--progress-on', window.scrollY > heroH * 0.9 ? '1' : '0');
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}
