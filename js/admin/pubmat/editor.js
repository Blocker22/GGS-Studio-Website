// Free editing of a social graphic: pick, drag, resize and restyle every
// layer, with undo, a layers list and an autosaved draft on this device.
// A plain-JS port of the Manson Pickleball PubmatEditor.
//
// openEditor(root, { doc, fileName, onExit }) draws the editor into `root`
// and returns a cleanup function (it listens for keyboard shortcuts).

import { append, btn, clear, h, icon } from '../core.js';

import { boxOf, downloadCanvas, LOGO_SRC, loadImage, loadLayerImages, measurer, paint } from './render.js';
import { drawSticker, isImportant, SCATTER_SHAPES, STICKER_KINDS, STICKERS } from './decor.js';
import { PHOTOS } from './brand.js';

/** Appends children, skipping null and false (native append prints them). */
const put = (node, ...kids) => append(node, kids);

export const DRAFT_KEY = 'ggs-graphics-draft';

const PALETTE = [
  ['#ffffff', 'White'],
  ['#020304', 'Ink'],
  ['#3c4446', 'Gray'],
  ['#0e1113', 'Night'],
  ['#ffd558', 'Gold'],
  ['#8a6700', 'Deep gold'],
  ['#fff3c9', 'Light gold'],
  ['#4dffdb', 'Teal'],
  ['#06302a', 'Deep teal'],
  ['#dcfff7', 'Light teal'],
  ['#ff5a4f', 'Red'],
];

const TYPE_ICON = { text: 'text-t', image: 'image', rect: 'square', ellipse: 'circle', button: 'rectangle', chip: 'tag', court: 'wave-sine', dash: 'minus', blob: 'circle-dashed', halftone: 'dots-nine', deco: 'sticker', scatter: 'sparkle', wave: 'waveform', grid: 'grid-four' };
const TYPE_LABEL = { text: 'Words', image: 'Picture', rect: 'Box', ellipse: 'Circle', button: 'Button', chip: 'Label', court: 'Waveform', dash: 'Dashed line', blob: 'Soft blob', halftone: 'Halftone dots', deco: 'Sticker', scatter: 'Scattered pieces', wave: 'Waveform', grid: 'Lines' };
// Large background pieces are picked only when nothing else is under the pointer.
const LOW_PRIORITY = new Set(['court', 'scatter', 'halftone', 'blob', 'grid']);
const HANDLES = {
  text: ['nw', 'ne', 'sw', 'se', 'w', 'e'],
  button: ['nw', 'ne', 'sw', 'se'],
  chip: ['nw', 'ne', 'sw', 'se'],
  court: ['nw', 'ne', 'sw', 'se'],
  deco: ['nw', 'ne', 'sw', 'se'],
  default: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
};
const HANDLE_POS = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function saveDraft(doc) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false; // private mode or storage full; the editor still works
  }
}
export function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const updateLayer = (doc, id, patch) => ({ ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
const nextId = (doc) => `l${Math.max(0, ...doc.layers.map((l) => parseInt(l.id.slice(1), 10) || 0)) + 1}`;

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Shrinks a picked photo to at most 1600px, as a data URL that survives in the draft. */
export async function fileToDataUrl(file) {
  const bitmap = await window.createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * s);
  canvas.height = Math.round(bitmap.height * s);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { src: canvas.toDataURL('image/jpeg', 0.88), w: canvas.width, h: canvas.height };
}

function resizePatch(L, box, handle, dx, dy, free) {
  const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const anchor = (w, hh) => ({ x: hx < 0 ? box.x + box.w - w : box.x, y: hy < 0 ? box.y + box.h - hh : box.y });
  if (L.type === 'text') {
    if (!hy) {
      const w = Math.max(40, box.w + dx * hx);
      return { w, x: hx < 0 ? box.x + box.w - w : box.x };
    }
    const f = Math.max(0.1, (box.w + dx * hx) / box.w);
    return { size: Math.max(8, L.size * f), w: box.w * f, paraGap: (L.paraGap || 0) * f, ...anchor(box.w * f, box.h * f) };
  }
  if (L.type === 'button' || L.type === 'chip') {
    const f = Math.max(0.2, (box.w + dx * hx) / box.w);
    return { size: Math.max(8, L.size * f), ...(L.maxW ? { maxW: L.maxW * f } : {}), ...anchor(box.w * f, box.h * f) };
  }
  let w = hx ? box.w + dx * hx : box.w;
  let hh = hy ? box.h + dy * hy : box.h;
  const keepRatio = L.type === 'court' || (L.type === 'deco' && !STICKERS[L.kind]?.band) || (L.type === 'image' && hx && hy && !free);
  if (keepRatio) {
    const f = Math.max(w / box.w, hh / box.h);
    w = box.w * f;
    hh = box.h * f;
  }
  w = Math.max(10, w);
  hh = Math.max(4, hh);
  return { w, h: hh, ...anchor(w, hh) };
}

// ------------------------------------------------------------------ small controls

function swatches(label, value, onChange) {
  const v = String(value || '').toLowerCase();
  const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#ffd558', class: 'pm-color-input', 'aria-label': 'Pick any color' });
  pick.addEventListener('input', () => onChange(pick.value));
  return h('fieldset', { class: 'pm-fieldset' },
    h('legend', {}, label),
    h('div', { class: 'pm-swatches' },
      PALETTE.map(([hex, name]) => h('button', {
        type: 'button', class: 'pm-swatch', title: name, 'aria-label': name, 'aria-pressed': String(v === hex), style: { background: hex }, onclick: () => onChange(hex),
      })),
      h('label', { class: 'pm-swatch pm-swatch-any', title: 'Any color' }, icon('plus'), pick)));
}

function slider(label, value, min, max, onChange, { step = 1, format = (x) => Math.round(x) } = {}) {
  const out = h('span', { class: 'pm-slider-value' }, format(value));
  const range = h('input', { type: 'range', min, max, step, value });
  range.addEventListener('input', () => { out.textContent = format(Number(range.value)); onChange(Number(range.value)); });
  return h('label', { class: 'pm-slider' }, h('span', { class: 'pm-slider-label' }, label, out), range);
}

function choice(label, options, value, onChange) {
  return h('fieldset', { class: 'pm-fieldset' },
    h('legend', {}, label),
    h('div', { class: 'seg pm-seg' }, options.map((o) => h('button', {
      type: 'button', 'aria-pressed': String(value === o.value), class: value === o.value ? 'on' : '', title: o.label, 'aria-label': o.label, onclick: () => onChange(o.value),
    }, o.icon ? icon(o.icon) : o.label))));
}

function stickerPreview(kind) {
  const c = h('canvas', { width: 96, height: 96, 'aria-hidden': 'true' });
  const def = STICKERS[kind];
  const w = def.ratio >= 1 ? 96 * 0.8 : 96 * 0.8 * def.ratio;
  const hh = def.ratio >= 1 ? (96 * 0.8) / def.ratio : 96 * 0.8;
  drawSticker(c.getContext('2d'), { kind, x: (96 - w) / 2, y: (96 - hh) / 2, w, h: hh, rotation: 0 });
  return c;
}

export function photoGrid(onPick, onUpload) {
  const upload = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1' });
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    upload.value = '';
    if (file) onUpload(await fileToDataUrl(file));
  });
  return h('div', { class: 'pm-photo-grid' },
    Object.values(PHOTOS).map((p) => h('button', { type: 'button', class: 'pm-photo', 'aria-label': p.alt, onclick: () => onPick(p.src) },
      h('img', { src: p.thumb, alt: '', loading: 'lazy' }))),
    h('button', { type: 'button', class: 'pm-photo pm-photo-add', onclick: () => upload.click() }, icon('image-square'), 'My own'),
    upload);
}

// ------------------------------------------------------------------ editor

export function openEditor(root, { doc: initialDoc, fileName, onExit }) {
  const st = { doc: initialDoc, past: [], future: [], lastKey: null, lastAt: 0 };
  let selectedId = null;
  let imgs = {};
  let adding = null;
  let gesture = null;
  let gestureSeq = 0;
  let saveTimer = null;
  let savedOk = true;

  const canvas = h('canvas', { class: 'pm-canvas', role: 'img', 'aria-label': 'Design' });
  const overlay = h('div', { class: 'pm-overlay' });
  const frame = h('div', { class: 'pm-frame' }, canvas, overlay);
  const savedNote = h('span', { class: 'pm-saved' });
  const toolbar = h('div', { class: 'pm-toolbar' });
  const addPanel = h('div', { class: 'pm-add', hidden: true });
  const inspector = h('div', { class: 'panel panel-pad pm-inspector' });
  const layersList = h('ul', { class: 'pm-layers' });

  const u = () => Math.min(st.doc.w, st.doc.h * 1.15) / 1080;
  const bgLayer = () => st.doc.layers.find((l) => l.role === 'background');
  const selected = () => st.doc.layers.find((l) => l.id === selectedId) || null;
  const boxes = () => new Map(st.doc.layers.map((l) => [l.id, boxOf(measurer(), l)]));

  // History: changes with the same key inside a second join the last step,
  // so typing a word or dragging an item is one undo, not fifty.
  function change(fn, key, { inspect = true } = {}) {
    const doc = fn(st.doc);
    if (doc === st.doc) return;
    const now = Date.now();
    const join = key && key === st.lastKey && now - st.lastAt < 1000;
    if (!join) st.past = [...st.past.slice(-60), st.doc];
    st.future = [];
    st.doc = doc;
    st.lastKey = key || null;
    st.lastAt = now;
    refresh({ inspect });
  }
  function undo() {
    if (!st.past.length) return;
    st.future = [st.doc, ...st.future];
    st.doc = st.past.pop();
    st.lastKey = null;
    refresh();
  }
  function redo() {
    if (!st.future.length) return;
    st.past.push(st.doc);
    st.doc = st.future.shift();
    st.lastKey = null;
    refresh();
  }

  let srcKey = '';
  async function refresh({ inspect = true } = {}) {
    const key = st.doc.layers.filter((l) => l.type === 'image').map((l) => l.src).join('|');
    if (key !== srcKey) {
      srcKey = key;
      imgs = { ...imgs, ...(await loadLayerImages(st.doc.layers)) };
    }
    paint(canvas, st.doc, imgs, 1);
    frame.style.aspectRatio = `${st.doc.w} / ${st.doc.h}`;
    frame.style.width = `min(100%, calc(64dvh * ${st.doc.w / st.doc.h}))`;
    drawOverlay();
    drawToolbar();
    if (inspect) drawInspector();
    drawLayers();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { savedOk = saveDraft(st.doc); savedNote.textContent = savedOk ? 'Saved on this device' : 'Not saved'; }, 600);
  }

  // ---------------------------------------------------------------- stage

  const toDoc = (e) => {
    const r = overlay.getBoundingClientRect();
    const scale = r.width / st.doc.w;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, scale };
  };

  // Topmost item under the pointer; big background pieces only when nothing else is there.
  function hit(x, y, scale, bx) {
    const pad = 6 / scale;
    const inside = (l) => {
      const b = bx.get(l.id);
      return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    };
    const list = st.doc.layers.filter((l) => !l.locked && !l.hidden).reverse();
    return list.find((l) => !LOW_PRIORITY.has(l.type) && l.role !== 'backdrop' && inside(l)) || list.find(inside) || null;
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.pm-handle')) return;
    const p = toDoc(e);
    const bx = boxes();
    const L = hit(p.x, p.y, p.scale, bx);
    selectedId = L ? L.id : null;
    adding = null;
    addPanel.hidden = true;
    refresh();
    if (!L) return;
    gesture = { kind: 'move', id: L.id, start: p, orig: { x: L.x, y: L.y }, box: bx.get(L.id), key: `move:${L.id}:${++gestureSeq}` };
    overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const p = toDoc(e);
    const dx = p.x - gesture.start.x;
    const dy = p.y - gesture.start.y;
    if (gesture.kind === 'move') {
      let x = gesture.orig.x + dx;
      let y = gesture.orig.y + dy;
      // Snap the item's center to the page's center lines.
      const th = 8 / p.scale;
      const snapV = Math.abs(x + gesture.box.w / 2 - st.doc.w / 2) < th;
      const snapH = Math.abs(y + gesture.box.h / 2 - st.doc.h / 2) < th;
      if (snapV) x = st.doc.w / 2 - gesture.box.w / 2;
      if (snapH) y = st.doc.h / 2 - gesture.box.h / 2;
      overlay.classList.toggle('snap-v', snapV);
      overlay.classList.toggle('snap-h', snapH);
      change((d) => updateLayer(d, gesture.id, { x, y }), gesture.key, { inspect: false });
    } else {
      change((d) => updateLayer(d, gesture.id, resizePatch(gesture.orig, gesture.box, gesture.handle, dx, dy, e.shiftKey)), gesture.key, { inspect: false });
    }
  });
  const endGesture = () => {
    if (gesture) { gesture = null; drawInspector(); }
    overlay.classList.remove('snap-v', 'snap-h');
  };
  overlay.addEventListener('pointerup', endGesture);
  overlay.addEventListener('pointercancel', endGesture);
  overlay.addEventListener('dblclick', () => {
    const t = inspector.querySelector('textarea');
    if (t) { t.focus(); t.select(); }
  });

  function drawOverlay() {
    clear(overlay);
    put(overlay, h('span', { class: 'pm-guide pm-guide-v', 'aria-hidden': 'true' }), h('span', { class: 'pm-guide pm-guide-h', 'aria-hidden': 'true' }));
    const L = selected();
    if (!L) return;
    const b = boxOf(measurer(), L);
    const pct = (v, total) => `${(v / total) * 100}%`;
    const sel = h('div', { class: 'pm-sel', style: { left: pct(b.x, st.doc.w), top: pct(b.y, st.doc.h), width: pct(b.w, st.doc.w), height: pct(b.h, st.doc.h) } });
    (HANDLES[L.type] || HANDLES.default).forEach((hd) => {
      const handle = h('button', { type: 'button', tabindex: '-1', class: 'pm-handle', 'aria-label': `Resize from ${hd}`, style: { left: `${HANDLE_POS[hd][0]}%`, top: `${HANDLE_POS[hd][1]}%`, cursor: CURSOR[hd] } }, h('span'));
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const p = toDoc(e);
        gesture = { kind: 'resize', handle: hd, id: L.id, start: p, orig: { ...L }, box: b, key: `resize:${L.id}:${++gestureSeq}` };
        overlay.setPointerCapture(e.pointerId);
      });
      sel.appendChild(handle);
    });
    overlay.appendChild(sel);
  }

  // ---------------------------------------------------------------- commands

  function addLayer(layer) {
    const id = nextId(st.doc);
    selectedId = id;
    change((d) => ({ ...d, layers: [...d.layers, { id, opacity: 1, ...layer }] }));
  }
  const inkOnBg = () => (luminance(bgLayer()?.fill) > 0.6 ? '#020304' : '#ffffff');
  const addText = (big) => addLayer({
    type: 'text', name: big ? 'Heading' : 'Text', text: big ? 'Your heading' : 'Type your message here',
    x: st.doc.w * 0.1, y: st.doc.h * 0.42, w: st.doc.w * 0.8, size: (big ? 96 : 42) * u(), weight: big ? 800 : 500,
    color: inkOnBg(), lh: big ? 1.05 : 1.35, tracking: big ? -0.03 : 0, align: 'left',
  });
  const addShape = (type) => {
    const s = Math.min(st.doc.w, st.doc.h) * 0.3;
    addLayer({ type, name: type === 'rect' ? 'Box' : 'Circle', x: (st.doc.w - s) / 2, y: (st.doc.h - s) / 2, w: s, h: s, fill: '#ffd558', radius: 0 });
  };
  const addPicture = async (src, natural) => {
    const img = natural || (await loadImage(src));
    const ratio = img ? (img.h || img.height) / (img.w || img.width) : 0.66;
    const w = st.doc.w * 0.6;
    adding = null;
    addLayer({ type: 'image', name: 'Photo', src, x: (st.doc.w - w) / 2, y: (st.doc.h - w * ratio) / 2, w, h: w * ratio, fit: 'cover', radius: 0 });
  };
  const addLogoLayer = async () => {
    const img = await loadImage(LOGO_SRC);
    const w = st.doc.w * 0.36;
    const hh = img ? (w * img.height) / img.width : w * 0.7;
    addLayer({ type: 'image', name: 'Logo', src: LOGO_SRC, x: (st.doc.w - w) / 2, y: st.doc.h * 0.08, w, h: hh, fit: 'contain', radius: 0 });
  };
  const addButton = () => addLayer({ type: 'button', name: 'Button', text: 'Book a session', x: st.doc.w * 0.1, y: st.doc.h * 0.7, maxW: st.doc.w * 0.8, size: 38 * u(), bg: '#ffd558', fg: '#020304' });
  const addWave = () => {
    const hh = st.doc.h * 0.5;
    const w = (hh * 24) / 44;
    addLayer({ type: 'court', name: 'Waveform', x: (st.doc.w - w) / 2, y: (st.doc.h - hh) / 2, w, h: hh, color: luminance(bgLayer()?.fill) > 0.6 ? 'rgba(2,3,4,0.18)' : 'rgba(255,213,88,0.3)', lineWidth: 6 * u(), rotation: 0 });
  };
  const addSticker = (kind) => {
    const def = STICKERS[kind];
    const M = Math.min(st.doc.w, st.doc.h);
    adding = null;
    if (def.band) return addLayer({ type: 'deco', name: def.label, kind, x: 0, y: 0, w: st.doc.w, h: M * 0.11, rotation: 0 });
    const big = M * 0.26;
    const w = def.ratio >= 1 ? big : big * def.ratio;
    const hh = def.ratio >= 1 ? big / def.ratio : big;
    return addLayer({ type: 'deco', name: def.label, kind, x: (st.doc.w - w) / 2, y: (st.doc.h - hh) / 2, w, h: hh, rotation: 0 });
  };
  const addScatter = (shape) => {
    const ctx = measurer();
    // Keep the pieces off the words and logo that are there now.
    const holes = st.doc.layers.filter(isImportant).map((l) => {
      const b = boxOf(ctx, l);
      return { x: b.x - 16 * u(), y: b.y - 16 * u(), w: b.w + 32 * u(), h: b.h + 32 * u() };
    });
    const colors = { confetti: ['#ffd558', '#ffffff', '#4dffdb', '#ff8fb3'], snow: ['#ffffff'], hearts: ['#ff4d7d', '#ffd1e0'], stars: ['#ffd558'], sparkles: ['#ffffff', '#ffd558'], blossoms: ['#ffd6de'], rain: ['#9cc3ff'], dots: ['#ffffff'] }[shape];
    adding = null;
    addLayer({ type: 'scatter', name: SCATTER_SHAPES[shape], shape, x: 0, y: 0, w: st.doc.w, h: st.doc.h, count: 30, size: Math.min(st.doc.w, st.doc.h) * 0.03, seed: (++gestureSeq * 2654435761) >>> 0, colors, holes });
  };
  const addBackdrop = (type) => {
    const s = Math.max(st.doc.w, st.doc.h) * 0.6;
    const light = luminance(bgLayer()?.fill) > 0.6;
    adding = null;
    const W = st.doc.w;
    const H = st.doc.h;
    addLayer(type === 'wave'
      ? { type, name: 'Waveform', x: W * 0.1, y: (H - s * 0.25) / 2, w: W * 0.8, h: s * 0.25, color: light ? '#020304' : '#ffd558', bars: 64, seed: (++gestureSeq * 2654435761) >>> 0 }
      : { type, name: 'Lines', x: 0, y: 0, w: W, h: H, color: light ? 'rgba(2,3,4,0.08)' : 'rgba(255,255,255,0.07)', cols: Math.round(W / (108 * u())), rows: Math.round(H / (108 * u())), lineWidth: Math.max(1, 1.5 * u()) });
  };
  const patchSelected = (patch, key, opts) => {
    const L = selected();
    if (L) change((d) => updateLayer(d, L.id, patch), key && `${key}:${L.id}`, opts);
  };
  function remove() {
    const L = selected();
    if (!L || L.locked) return;
    selectedId = null;
    change((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== L.id) }));
  }
  function duplicate() {
    const L = selected();
    if (!L || L.locked) return;
    const id = nextId(st.doc);
    selectedId = id;
    change((d) => {
      const i = d.layers.findIndex((l) => l.id === L.id);
      const copy = { ...L, id, x: L.x + 24 * u(), y: L.y + 24 * u() };
      return { ...d, layers: [...d.layers.slice(0, i + 1), copy, ...d.layers.slice(i + 1)] };
    });
  }
  const move = (id, dir) => change((d) => {
    const i = d.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (j < 0 || j >= d.layers.length || d.layers[j].locked || d.layers[i].locked) return d;
    const layers = [...d.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return { ...d, layers };
  });
  function centerSelected(axis) {
    const L = selected();
    if (!L) return;
    const b = boxOf(measurer(), L);
    patchSelected(axis === 'x' ? { x: (st.doc.w - b.w) / 2 } : { y: (st.doc.h - b.h) / 2 });
  }
  async function download(button) {
    button.classList.add('busy');
    selectedId = null;
    refresh();
    const out = document.createElement('canvas');
    paint(out, st.doc, await loadLayerImages(st.doc.layers), 1);
    await downloadCanvas(out, fileName);
    button.classList.remove('busy');
  }

  // Keyboard: delete, nudge, undo/redo, duplicate, deselect. Ignored while typing.
  function onKey(e) {
    if (!root.isConnected) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const L = selected();
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (!L) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
    else if (e.key === 'Escape') { selectedId = null; refresh(); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      change((doc) => updateLayer(doc, L.id, { x: L.x + d[0], y: L.y + d[1] }), `nudge:${L.id}`);
    }
  }
  window.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- chrome

  function tool(label, iconName, onClick, { active = false, disabled = false, title } = {}) {
    return h('button', { type: 'button', class: `pm-tool${active ? ' on' : ''}`, onclick: onClick, disabled, title, 'aria-expanded': active ? 'true' : null }, icon(iconName), h('span', {}, label));
  }
  function drawToolbar() {
    clear(toolbar);
    const toggleAdd = (what) => () => { adding = adding === what ? null : what; drawAddPanel(); drawToolbar(); };
    const dl = btn('Download', { kind: 'primary', iconName: 'download-simple', onClick: (e) => download(e.currentTarget) });
    dl.classList.add('pm-download');
    put(toolbar, 
      btn('Simple mode', { kind: 'ghost', iconName: 'arrow-left', onClick: () => { cleanup(); onExit(); } }),
      h('span', { class: 'pm-sep', 'aria-hidden': 'true' }),
      tool('Heading', 'text-h', () => addText(true)),
      tool('Text', 'text-t', () => addText(false)),
      tool('Photo', 'image', toggleAdd('photo'), { active: adding === 'photo' }),
      tool('Stickers', 'sticker', toggleAdd('stickers'), { active: adding === 'stickers' }),
      tool('Logo', 'tag', addLogoLayer),
      tool('Box', 'square', () => addShape('rect')),
      tool('Circle', 'circle', () => addShape('ellipse')),
      tool('Button', 'rectangle', addButton),
      tool('Waveform', 'wave-sine', addWave),
      h('span', { class: 'pm-sep', 'aria-hidden': 'true' }),
      tool('Undo', 'arrow-counter-clockwise', undo, { disabled: !st.past.length, title: 'Undo (Ctrl+Z)' }),
      tool('Redo', 'arrow-clockwise', redo, { disabled: !st.future.length, title: 'Redo (Ctrl+Y)' }),
      dl);
  }
  function drawAddPanel() {
    clear(addPanel);
    addPanel.hidden = !adding;
    if (adding === 'photo') {
      put(addPanel, h('p', { class: 'pm-add-title' }, 'Tap a photo to add it'), photoGrid((src) => addPicture(src), ({ src, w, h: hh }) => addPicture(src, { w, h: hh })));
    } else if (adding === 'stickers') {
      put(addPanel, 
        h('p', { class: 'pm-add-title' }, 'Tap a sticker to add it'),
        h('div', { class: 'pm-sticker-grid' }, STICKER_KINDS.map((kind) => h('button', { type: 'button', class: 'pm-sticker', title: STICKERS[kind].label, onclick: () => addSticker(kind) },
          h('span', { class: 'pm-sticker-art' }, stickerPreview(kind)), h('span', {}, STICKERS[kind].label)))),
        h('p', { class: 'pm-add-title', style: 'margin-top:16px' }, 'Scatter across the page'),
        h('div', { class: 'row' },
          Object.entries(SCATTER_SHAPES).map(([shape, label]) => btn(label, { size: 'sm', onClick: () => addScatter(shape) })),
          btn('Waveform', { size: 'sm', onClick: () => addBackdrop('wave') }),
          btn('Grid lines', { size: 'sm', onClick: () => addBackdrop('grid') })));
    }
  }

  function drawInspector() {
    clear(inspector);
    const L = selected();
    if (!L) {
      const bg = bgLayer();
      put(inspector, 
        h('div', {}, h('p', { class: 'pm-ins-title' }, 'Page'), h('p', { class: 'hint' }, 'Nothing selected. Tap any part of the design to change it.')),
        bg ? swatches('Background color', bg.fill, (fill) => change((d) => updateLayer(d, bg.id, { fill }), 'bg')) : null);
      return;
    }
    const isWords = L.type === 'text' || L.type === 'button' || L.type === 'chip';
    const parts = [
      h('div', { class: 'pm-ins-head' },
        h('div', {}, h('p', { class: 'pm-ins-title' }, L.name || TYPE_LABEL[L.type]), h('p', { class: 'hint' }, TYPE_LABEL[L.type])),
        h('div', { class: 'row' }, btn('', { kind: 'ghost', iconName: 'copy', aria: 'Duplicate', title: 'Duplicate (Ctrl+D)', onClick: duplicate }), btn('', { kind: 'ghost', iconName: 'trash', aria: 'Delete', onClick: remove }))),
    ];
    if (isWords) {
      const ta = h('textarea', { class: 'textarea', rows: L.type === 'text' ? 4 : 2, value: L.text });
      ta.addEventListener('input', () => patchSelected({ text: ta.value }, 'text', { inspect: false }));
      parts.push(h('label', { class: 'field' }, h('span', { class: 'pm-label' }, 'Words'), ta));
      parts.push(slider('Size', L.size, 10, Math.round(400 * u()), (size) => patchSelected({ size }, 'size', { inspect: false })));
    }
    if (L.type === 'text') {
      parts.push(
        choice('Thickness', [{ value: 500, label: 'Normal' }, { value: 700, label: 'Bold' }, { value: 800, label: 'Heavy' }], L.weight, (weight) => patchSelected({ weight })),
        choice('Line up', [{ value: 'left', label: 'Left', icon: 'text-align-left' }, { value: 'center', label: 'Center', icon: 'text-align-center' }, { value: 'right', label: 'Right', icon: 'text-align-right' }], L.align || 'left', (align) => patchSelected({ align })),
        slider('Line spacing', L.lh || 1.2, 0.8, 2, (lh) => patchSelected({ lh }, 'lh', { inspect: false }), { step: 0.05, format: (v) => v.toFixed(2) }),
        swatches('Text color', L.color, (color) => patchSelected({ color }, 'color')));
      const bullets = h('input', { type: 'checkbox', checked: Boolean(L.bullet) });
      bullets.addEventListener('change', () => patchSelected({ bullet: bullets.checked ? '#4dffdb' : null, paraGap: bullets.checked ? L.size * 0.3 : L.paraGap }));
      parts.push(h('label', { class: 'check' }, bullets, h('span', {}, 'Show bullets (one per line)')));
    }
    if (L.type === 'button' || L.type === 'chip') {
      parts.push(swatches('Button color', L.bg, (v) => patchSelected({ bg: v }, 'bgc')), swatches('Text color', L.fg, (v) => patchSelected({ fg: v }, 'fgc')));
    }
    if (L.type === 'ellipse') parts.push(swatches('Color', L.fill, (fill) => patchSelected({ fill }, 'fill')));
    if (L.type === 'rect' && !L.gradient && L.fill) parts.push(swatches('Color', L.fill, (fill) => patchSelected({ fill }, 'fill')));
    if (L.type === 'rect' && L.stroke) parts.push(swatches('Outline color', L.stroke, (stroke) => patchSelected({ stroke }, 'stroke')));
    if (L.type === 'rect' && L.gradient) {
      // Old designs only: a gradient flattens to its first color.
      parts.push(btn('Make it one solid color', { size: 'sm', onClick: () => patchSelected({ gradient: null, fill: L.gradient.stops?.[0]?.[1] || L.fill || '#ffd558' }) }));
    }
    if (L.type === 'deco') {
      STICKERS[L.kind].colors.forEach((c, i) => {
        parts.push(swatches(['Main color', 'Second color', 'Third color'][i] || `Color ${i + 1}`, (L.colors && L.colors[i]) || c, (v) => {
          const colors = STICKERS[L.kind].colors.map((d, j) => (L.colors && L.colors[j]) || d);
          colors[i] = v;
          patchSelected({ colors }, `deco${i}`);
        }));
      });
      parts.push(
        slider('Turn', Math.round(((L.rotation || 0) * 180) / Math.PI), -180, 180, (v) => patchSelected({ rotation: (v * Math.PI) / 180 }, 'rot', { inspect: false }), { format: (v) => `${Math.round(v)}°` }),
        btn('Flip', { iconName: 'flip-horizontal', onClick: () => patchSelected({ flip: !L.flip }) }));
    }
    if (L.type === 'scatter') {
      parts.push(
        slider('How many', L.count, 4, 150, (count) => patchSelected({ count }, 'count', { inspect: false })),
        slider('Piece size', L.size, Math.round(6 * u()), Math.round(90 * u()), (size) => patchSelected({ size }, 'psize', { inspect: false })),
        swatches('Color (all pieces)', L.colors?.[0], (c) => patchSelected({ colors: [c] }, 'scolor')),
        btn('Shuffle pieces', { iconName: 'shuffle', onClick: () => patchSelected({ seed: Math.floor(Math.random() * 1e9) }) }));
    }
    if (L.type === 'wave') {
      parts.push(
        swatches('Color', L.color, (color) => patchSelected({ color }, 'wcolor')),
        slider('Bars', L.bars || 64, 12, 160, (bars) => patchSelected({ bars }, 'bars', { inspect: false })),
        btn('Shuffle', { iconName: 'shuffle', onClick: () => patchSelected({ seed: Math.floor(Math.random() * 1e9) }) }));
    }
    if (L.type === 'grid') {
      parts.push(
        slider('Columns', L.cols || 0, 0, 30, (cols) => patchSelected({ cols }, 'cols', { inspect: false })),
        slider('Rows', L.rows || 0, 0, 40, (rows) => patchSelected({ rows }, 'rows', { inspect: false })));
    }
    if (L.type === 'blob' || L.type === 'halftone') {
      parts.push(
        swatches('Color', L.color, (color) => patchSelected({ color }, 'bcolor')),
        slider('Strength', Math.round((L.alpha ?? 0.4) * 100), 5, 90, (v) => patchSelected({ alpha: v / 100 }, 'alpha', { inspect: false }), { format: (v) => `${v}%` }));
      if (L.type === 'halftone') parts.push(slider('Dot spacing', L.spacing || 16, 6, 60, (spacing) => patchSelected({ spacing }, 'spacing', { inspect: false })));
    }
    if ((L.type === 'rect' || L.type === 'image') && typeof (L.radius ?? 0) === 'number' && !L.zigzag) {
      parts.push(slider('Rounded corners', L.radius || 0, 0, Math.round(Math.min(L.w, L.h) / 2), (radius) => patchSelected({ radius }, 'radius', { inspect: false })));
    }
    if (L.type === 'image') {
      parts.splice(1, 0, h('div', {}, h('p', { class: 'pm-label' }, 'Change the picture'), photoGrid((src) => patchSelected({ src }), ({ src }) => patchSelected({ src }))),
        choice('Fit', [{ value: 'cover', label: 'Fill the box' }, { value: 'contain', label: 'Show all' }], L.fit || 'cover', (fit) => patchSelected({ fit })));
    }
    if (L.type === 'court') {
      parts.push(
        swatches('Bar color', L.color, (color) => patchSelected({ color }, 'color')),
        slider('Bar thickness', L.lineWidth, 1, 30, (lineWidth) => patchSelected({ lineWidth }, 'lw', { inspect: false })),
        choice('Direction', [{ value: 'up', label: 'Standing' }, { value: 'side', label: 'Lying down' }], Math.abs(Math.sin(L.rotation || 0)) > 0.7 ? 'side' : 'up', (v) => patchSelected({ rotation: v === 'side' ? Math.PI / 2 : 0 })));
    }
    if (L.type === 'dash') parts.push(swatches('Color', L.color, (color) => patchSelected({ color }, 'color')));
    parts.push(
      slider('See-through', Math.round((1 - (L.opacity ?? 1)) * 100), 0, 90, (v) => patchSelected({ opacity: 1 - v / 100 }, 'opacity', { inspect: false }), { format: (v) => `${v}%` }),
      h('div', { class: 'grid grid-2' }, btn('Center across', { iconName: 'align-center-horizontal', onClick: () => centerSelected('x') }), btn('Center down', { iconName: 'align-center-vertical', onClick: () => centerSelected('y') })));
    put(inspector, ...parts);
  }

  function drawLayers() {
    clear(layersList);
    const list = [...st.doc.layers].reverse();
    list.forEach((l, i) => {
      const isSel = l.id === selectedId;
      const label = l.type === 'text' || l.type === 'button' || l.type === 'chip' ? l.text?.split('\n')[0] || l.name : l.name;
      layersList.appendChild(h('li', { class: isSel ? 'on' : '' },
        h('button', { type: 'button', class: `pm-layer${l.hidden ? ' off' : ''}`, disabled: l.locked, onclick: () => { selectedId = l.id; refresh(); } }, icon(TYPE_ICON[l.type] || 'square'), h('span', {}, label || TYPE_LABEL[l.type])),
        l.locked ? null : h('span', { class: 'row pm-layer-actions' },
          btn('', { size: 'sm', kind: 'ghost', iconName: l.hidden ? 'eye-slash' : 'eye', aria: l.hidden ? 'Show' : 'Hide', onClick: () => change((d) => updateLayer(d, l.id, { hidden: !l.hidden })) }),
          btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-up', aria: 'Bring forward', disabled: i === 0, onClick: () => move(l.id, 1) }),
          btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-down', aria: 'Send backward', disabled: i >= list.length - 2, onClick: () => move(l.id, -1) }))));
    });
  }

  function cleanup() {
    window.removeEventListener('keydown', onKey);
    clearTimeout(saveTimer);
    saveDraft(st.doc);
  }

  clear(root);
  put(root, 
    h('div', { class: 'pm-editor' },
      toolbar,
      addPanel,
      h('div', { class: 'pm-editor-grid' },
        h('div', { class: 'panel panel-pad pm-stage-panel' },
          h('div', { class: 'pm-stage' }, frame),
          h('p', { class: 'hint pm-stage-hint' }, icon('cursor-click'), h('span', {}, 'Tap anything to change it. Drag to move, pull the squares to resize.'), savedNote)),
        h('div', { class: 'stack' }, inspector, h('div', { class: 'panel' }, h('p', { class: 'panel-head' }, h('strong', {}, 'Layers')), layersList)))));
  root.scrollIntoView?.({ block: 'start' });
  refresh();
  return cleanup;
}
