// Social graphics ("pubmats") as a list of layers. The engine (layers,
// one painter, free edit) follows the Manson Pickleball pubmat maker; the
// layouts are GGS Studio's own: solid fields, hairline rules, one highlight
// color per theme, and the waveform as the only motif.
//
// A design spec (preset + edits) is turned into layers by buildLayers(); the
// same drawLayers() paints them for the live preview, the thumbnails, the
// free-edit mode, and the downloaded PNG, so all four always match.
//
// Layer types (all coordinates in design pixels, e.g. 1080 x 1350):
//   rect    { x, y, w, h, fill, radius }
//   ellipse { x, y, w, h, fill }
//   image   { x, y, w, h, src, fit: 'cover' | 'contain', radius }
//   text    { x, y, w, text, size, weight, color, lh, tracking, align, bullet, paraGap }  (height follows the text)
//   button  { x, y, maxW, text, size, bg, fg }                                            (size follows the text)
//   chip    { x, y, text, size, bg, fg }                                                  (a small uppercase pill)
//   wave    { x, y, w, h, color, rest, progress, bars, seed }                             (the waveform motif)
//   grid    { x, y, w, h, color, cols, rows, lineWidth }                                  (background lines)
//   court   { x, y, w, h, color, lineWidth, rotation, clip }                              (old small waveform)
//   dash    { x, y, w, h, color }                                                         (a dashed line)
//   deco    { x, y, w, h, kind, colors, rotation }                                        (a sticker, see decor.js)
//   scatter { x, y, w, h, shape, count, size, seed, colors, holes }                       (confetti, snow, hearts...)
// Rects may also have a stroke (with dash). Old drafts may still hold blob,
// halftone and gradient layers; they still draw, but nothing new makes them.
// Every layer also has id, name, and opacity; the background is locked.

import { ADDRESS, PHOTOS, SITE_DOMAIN, displayPhone, phoneContacts, studioPhotoKeys } from './brand.js';
import { DECORS, OCCASION_THEMES, decorLayers, drawBlob, drawHalftone, drawScatter, drawSticker, hashString, isImportant, luminance, rgba, seeded } from './decor.js';

export { DECORS } from './decor.js';

// Full resolution, trimmed of padding; the nav logo is sized for screens.
export const LOGO_SRC = 'assets/logo-hd.png';

// Logo styles and sizes a design can pick. 'white' and 'dark' are the logo
// recolored in one color; 'none' leaves the logo off. The GGS logo is
// stacked (taller than the old horizontal one), so sizes run larger.
export const LOGO_STYLES = [
  { id: 'color', label: 'Color' },
  { id: 'white', label: 'White' },
  { id: 'dark', label: 'Dark' },
  { id: 'none', label: 'No logo' }
];
export const LOGO_SIZES = [
  { id: 'small', label: 'Small', scale: 1.15 },
  { id: 'medium', label: 'Medium', scale: 1.45 },
  { id: 'large', label: 'Large', scale: 1.8 }
];

// Set by buildLayers for the design being built (layouts run synchronously).
let logoSrc = LOGO_SRC;
let logoScale = 1.45;
let logoPlate = true;
let logoKind = 'color';

function recolor(img, color) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

const logoCache = new Map();
/** The logo picture for a style, or null for 'none'. */
export async function loadLogo(style = 'color') {
  if (style === 'none') return null;
  if (style !== 'white' && style !== 'dark') return loadImage(LOGO_SRC);
  if (!logoCache.has(style)) {
    logoCache.set(
      style,
      loadImage(LOGO_SRC).then(img => (img ? loadImage(recolor(img, style === 'white' ? '#ffffff' : '#020304')) : null))
    );
  }
  return logoCache.get(style);
}

export const FORMATS = [
  { id: 'square', label: 'Square', hint: 'Facebook and Instagram posts', w: 1080, h: 1080 },
  { id: 'portrait', label: 'Tall', hint: 'Fills more of the Facebook feed', w: 1080, h: 1350 },
  { id: 'story', label: 'Story', hint: 'Facebook and Instagram stories', w: 1080, h: 1920 },
  { id: 'wide', label: 'Wide', hint: 'Link previews and group banners', w: 1200, h: 630 },
  { id: 'voucher', label: 'Voucher', hint: 'Vouchers and gift certificates, good for printing', w: 1500, h: 700 },
  { id: 'slip', label: 'Slip', hint: 'Receipt slips, easy to send in chat', w: 900, h: 1500 }
];

const INK = '#020304';
const GOLD = '#ffd558';
const TEAL = '#4dffdb';
const NIGHT = '#020304';
/** Readable text on a fill: ink on light colors (gold, teal, white), white on dark. */
const on = c => (luminance(c) > 0.55 ? INK : '#ffffff');

// GGS gold and teal. Each theme is one solid field plus one highlight (hi)
// for tags, numbers and rules. Text sits in ink on gold, white on the darks.
export const THEMES = {
  night: { label: 'Studio night', bg: NIGHT, fg: '#ffffff', muted: '#a9b1b1', line: 'rgba(255,255,255,0.14)', chipBg: GOLD, chipFg: INK, hi: GOLD },
  gold: { label: 'Gold', bg: GOLD, fg: INK, muted: '#4a3f16', line: 'rgba(2,3,4,0.18)', chipBg: INK, chipFg: GOLD, hi: INK },
  teal: { label: 'Deep teal', bg: '#06302a', fg: '#ffffff', muted: '#b5dcd3', line: 'rgba(77,255,219,0.2)', chipBg: TEAL, chipFg: INK, hi: TEAL },
  light: { label: 'White', bg: '#ffffff', fg: INK, muted: '#4f5759', line: 'rgba(2,3,4,0.12)', chipBg: INK, chipFg: GOLD, hi: INK }
};

export const LAYOUTS = [
  { id: 'field', label: 'Statement', group: 'poster' },
  { id: 'stat', label: 'Big number', group: 'poster' },
  { id: 'wave', label: 'Waveform', group: 'poster' },
  { id: 'tracks', label: 'Track list', group: 'poster' },
  { id: 'label', label: 'Tape label', group: 'poster' },
  { id: 'quiet', label: 'Quiet', group: 'poster' },
  { id: 'cover', label: 'Photo panel', group: 'poster' },
  { id: 'window', label: 'Photo window', group: 'poster' },
  { id: 'column', label: 'Photo column', group: 'poster' },
  { id: 'strip', label: 'Contact sheet', group: 'poster' },
  { id: 'voucher', label: 'Voucher', group: 'document' },
  { id: 'giftcard', label: 'Gift certificate', group: 'document' },
  { id: 'receipt', label: 'Receipt', group: 'document' }
];
export const PHOTO_LAYOUTS = new Set(['cover', 'window', 'column', 'strip']);
export const DOCUMENT_LAYOUTS = new Set(['voucher', 'giftcard', 'receipt']);
// Layouts from the first version, mapped to the nearest current one.
const LAYOUT_ALIASES = { glow: 'quiet', center: 'quiet', minimal: 'window', photo: 'window', frame: 'window', fade: 'cover', side: 'cover', magazine: 'cover', arch: 'column', split: 'column', collage: 'strip', bento: 'strip', schedule: 'tracks', ticket: 'label' };
export const layoutId = id => LAYOUT_ALIASES[id] || id || 'field';

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';
const INK_SOFT = '#3c4446';
const WHITE = '#ffffff';
const PAPER_LINE = '#e6e8e8';
// GGS corners are sharp: every rounded box is drawn at this fraction of the
// radius a layout asks for. Arches and pills (array radii) keep their shape.
const CORNER = 0.12;

// ---- Assets ----

const images = new Map();
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!images.has(src)) {
    images.set(
      src,
      new Promise(resolve => {
        const img = new Image();
        img.decoding = 'async';
        // Sponsor logos live in Supabase storage; without CORS the canvas
        // would be "tainted" and the PNG download would fail.
        if (/^https?:/.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      })
    );
  }
  return images.get(src);
}

/** Loads every picture the layers use. Resolves { [src]: HTMLImageElement }. */
export async function loadLayerImages(layers) {
  const srcs = [...new Set(layers.filter(l => l.type === 'image' && l.src).map(l => l.src))];
  const loaded = await Promise.all(srcs.map(loadImage));
  return Object.fromEntries(srcs.map((s, i) => [s, loaded[i]]));
}

let fontsReady = null;
export function loadFonts() {
  if (!fontsReady) {
    fontsReady = document.fonts
      ? Promise.all([500, 600, 700, 800].map(w => document.fonts.load(`${w} 40px "Inter"`))).catch(() => {})
      : Promise.resolve();
  }
  return fontsReady;
}

let measureCtx = null;
export function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

// ---- Text ----

function setFont(ctx, weight, size, tracking = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking * size}px`;
}

// Wraps one paragraph. Words longer than the box are broken by letter.
function wrapPara(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const push = word => {
    if (ctx.measureText(word).width <= maxWidth) return word;
    let chunk = '';
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    return chunk;
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = push(word);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// Largest size (down to `min`) at which the text fits the box, one paragraph per line break.
function fitText(ctx, text, { weight, max, min, width, height, lh, tracking = 0, maxLines = 99 }) {
  const paras = String(text || '').split('\n').filter(p => p.trim());
  for (let size = max; size >= min; size -= 2) {
    setFont(ctx, weight, size, tracking);
    const lines = paras.flatMap(p => wrapPara(ctx, p, width));
    const widest = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
    // Shrink rather than split a word across lines ("downpaym / ent").
    const wordsFit = size === min || paras.every(p => p.split(/\s+/).every(w => ctx.measureText(w).width <= width));
    if (wordsFit && lines.length <= maxLines && lines.length * size * lh <= height && widest <= width) return size;
  }
  return min;
}

const isNumbered = p => /^\d+[.)]\s/.test(p);
const bulletIndent = size => size * 0.82;

/** Lays out a text layer: [{ lines, bullet, indent }] plus its total height. */
export function layoutText(ctx, L) {
  setFont(ctx, L.weight, L.size, L.tracking || 0);
  const gap = L.paraGap || 0;
  const paras = String(L.text ?? '')
    .split('\n')
    .map(p => {
      const bullet = Boolean(L.bullet) && Boolean(p.trim()) && !isNumbered(p.trim()) && L.align !== 'center';
      const indent = bullet ? bulletIndent(L.size) : 0;
      return { bullet, indent, lines: wrapPara(ctx, p, Math.max(10, L.w - indent)) };
    });
  const lineH = L.size * (L.lh || 1.2);
  const h = paras.reduce((s, p) => s + p.lines.length * lineH, 0) + gap * Math.max(0, paras.length - 1);
  return { paras, h, lineH };
}

function pillBox(ctx, L, uppercase) {
  setFont(ctx, 800, L.size, uppercase ? 0.06 : -0.01);
  const text = uppercase ? String(L.text || '').toUpperCase() : String(L.text || '');
  if (uppercase) {
    const tw = ctx.measureText(text).width;
    return { x: L.x, y: L.y, w: tw + L.size * 1.6, h: L.size * 2.1, lines: [text] };
  }
  const padX = L.size * 0.9;
  const lines = wrapPara(ctx, text, Math.max(20, (L.maxW || 2000) - padX * 2));
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
  return { x: L.x, y: L.y, w: tw + padX * 2, h: lines.length * L.size * 1.2 + L.size * 1.3, lines };
}

/** The box a layer occupies, for selection and hit testing. */
export function boxOf(ctx, L) {
  if (L.type === 'text') return { x: L.x, y: L.y, w: L.w, h: Math.max(L.size * 0.8, layoutText(ctx, L).h) };
  if (L.type === 'button') return pillBox(ctx, L, false);
  if (L.type === 'chip') return pillBox(ctx, L, true);
  return { x: L.x, y: L.y, w: L.w, h: L.h };
}

// ---- Drawing ----

function roundRectPath(ctx, x, y, w, h, r, exact = false) {
  ctx.beginPath();
  const lim = v => Math.max(0, Math.min(v || 0, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.roundRect(x, y, w, h, Array.isArray(r) ? r.map(lim) : lim(exact ? r : (r || 0) * CORNER));
}

// A receipt edge: straight sides, torn-paper teeth along the top and bottom.
function zigzagPath(ctx, L) {
  const t = L.zigzag;
  const n = Math.max(4, Math.round(L.w / (t * 2)));
  const tw = L.w / n;
  ctx.beginPath();
  ctx.moveTo(L.x, L.y + t);
  for (let i = 0; i < n; i++) {
    ctx.lineTo(L.x + (i + 0.5) * tw, L.y);
    ctx.lineTo(L.x + (i + 1) * tw, L.y + t);
  }
  ctx.lineTo(L.x + L.w, L.y + L.h - t);
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(L.x + (i + 0.5) * tw, L.y + L.h);
    ctx.lineTo(L.x + i * tw, L.y + L.h - t);
  }
  ctx.closePath();
}

// Gradients use CSS angles: 180 runs top to bottom, 90 left to right.
function fillFor(ctx, L) {
  const g = L.gradient;
  if (!g) return L.fill;
  let grad;
  if (g.kind === 'radial') {
    const cx = L.x + L.w * (g.cx ?? 0.3);
    const cy = L.y + L.h * (g.cy ?? 0.2);
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(L.w, L.h) * (g.r ?? 1));
  } else {
    const a = ((g.angle ?? 180) * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(L.w * dx) + Math.abs(L.h * dy)) / 2;
    const cx = L.x + L.w / 2;
    const cy = L.y + L.h / 2;
    grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  for (const [o, c] of g.stops) grad.addColorStop(Math.min(1, Math.max(0, o)), c);
  return grad;
}

function drawImage(ctx, L, img) {
  ctx.save();
  roundRectPath(ctx, L.x, L.y, L.w, L.h, L.radius);
  ctx.clip();
  if (img) {
    const s = L.fit === 'contain' ? Math.min(L.w / img.width, L.h / img.height) : Math.max(L.w / img.width, L.h / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, L.x + (L.w - dw) / 2, L.y + (L.h - dh) / 2, dw, dh);
  } else if (L.fit !== 'contain') {
    ctx.fillStyle = '#cfd4db';
    ctx.fillRect(L.x, L.y, L.w, L.h);
  }
  ctx.restore();
}

// The GGS motif: a waveform of seeded bars, like the one in the logo. The
// box keeps the old court's 24 x 44 proportions so every layout still fits it.
function drawCourt(ctx, L) {
  ctx.save();
  ctx.translate(L.x + L.w / 2, L.y + L.h / 2);
  ctx.rotate(L.rotation || 0);
  ctx.fillStyle = L.color;
  const bars = 15;
  const gap = L.w / bars;
  const bw = Math.max(1, Math.min(gap * 0.5, L.lineWidth * 1.4));
  const rnd = seeded(Math.round(L.w * 7 + L.h));
  for (let i = 0; i < bars; i++) {
    const t = i / (bars - 1);
    const env = 0.25 + 0.75 * Math.sin(Math.PI * t);
    const bh = L.h * env * (0.45 + 0.55 * rnd());
    ctx.fillRect(-L.w / 2 + i * gap + (gap - bw) / 2, -bh / 2, bw, bh);
  }
  ctx.restore();
}

// The GGS motif: a waveform of seeded bars. Bars past `progress` use `rest`,
// like the played and unplayed parts of a track in a DAW.
function drawWave(ctx, L) {
  const n = Math.max(8, Math.round(L.bars || 64));
  const step = L.w / n;
  const bw = Math.max(1, step * 0.5);
  const rnd = seeded(L.seed ?? 7);
  const cy = L.y + L.h / 2;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const env = 0.3 + 0.7 * Math.pow(Math.sin(Math.PI * t), 0.6);
    const bh = Math.max(bw, L.h * env * (0.35 + 0.65 * rnd()));
    ctx.fillStyle = L.progress != null && t > L.progress ? L.rest || L.color : L.color;
    ctx.fillRect(L.x + i * step + (step - bw) / 2, cy - bh / 2, bw, bh);
  }
}

// Evenly spaced hairlines across a box: a session grid.
function drawGrid(ctx, L) {
  ctx.fillStyle = L.color;
  const lw = L.lineWidth || 2;
  for (let i = 1; i < (L.cols || 0); i++) ctx.fillRect(Math.round(L.x + (L.w * i) / L.cols - lw / 2), L.y, lw, L.h);
  for (let i = 1; i < (L.rows || 0); i++) ctx.fillRect(L.x, Math.round(L.y + (L.h * i) / L.rows - lw / 2), L.w, lw);
}

function drawText(ctx, L) {
  // Lines are broken on the shared measuring canvas, the same one layouts
  // used to size the text. A scaled or on-screen canvas can measure a few
  // pixels wider, and re-wrapping there would overlap the next block.
  const { paras, lineH } = layoutText(measurer(), L);
  setFont(ctx, L.weight, L.size, L.tracking || 0);
  ctx.fillStyle = L.color;
  ctx.textBaseline = 'alphabetic';
  const align = L.align || 'left';
  ctx.textAlign = align;
  let y = L.y;
  const dot = L.size * 0.34;
  for (const p of paras) {
    if (p.bullet) {
      ctx.fillStyle = L.bullet;
      ctx.fillRect(L.x, y + L.size * 0.42, dot, dot);
      ctx.fillStyle = L.color;
    }
    const x = align === 'center' ? L.x + L.w / 2 : align === 'right' ? L.x + L.w : L.x + p.indent;
    p.lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineH + L.size * 0.86));
    y += p.lines.length * lineH + (L.paraGap || 0);
  }
  ctx.textAlign = 'left';
}

function drawPill(ctx, L, uppercase) {
  const box = pillBox(ctx, L, uppercase);
  ctx.fillStyle = L.bg;
  roundRectPath(ctx, box.x, box.y, box.w, box.h, uppercase ? box.h / 2 : L.size * 0.55);
  ctx.fill();
  ctx.fillStyle = L.fg;
  if (uppercase) {
    ctx.textBaseline = 'middle';
    ctx.fillText(box.lines[0], box.x + L.size * 0.8, box.y + box.h / 2 + L.size * 0.04);
    ctx.textBaseline = 'alphabetic';
  } else {
    box.lines.forEach((line, i) => ctx.fillText(line, box.x + L.size * 0.9, box.y + L.size * 0.62 + i * L.size * 1.2 + L.size * 0.86));
  }
}

function drawDash(ctx, L) {
  const horizontal = L.w >= L.h;
  const t = Math.max(2, horizontal ? L.h : L.w);
  ctx.strokeStyle = L.color;
  ctx.lineWidth = t;
  ctx.setLineDash([t * 3, t * 2.5]);
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(L.x, L.y + L.h / 2);
    ctx.lineTo(L.x + L.w, L.y + L.h / 2);
  } else {
    ctx.moveTo(L.x + L.w / 2, L.y);
    ctx.lineTo(L.x + L.w / 2, L.y + L.h);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawLayers(ctx, layers, imgs) {
  for (const L of layers) {
    if (L.hidden) continue;
    ctx.save();
    ctx.globalAlpha = L.opacity ?? 1;
    if (L.clip) {
      roundRectPath(ctx, L.clip.x, L.clip.y, L.clip.w, L.clip.h, L.clip.r);
      ctx.clip();
    }
    if (L.type === 'rect') {
      if (L.zigzag) zigzagPath(ctx, L);
      else roundRectPath(ctx, L.x, L.y, L.w, L.h, L.radius);
      if (L.fill || L.gradient) {
        ctx.fillStyle = fillFor(ctx, L);
        ctx.fill();
      }
      if (L.stroke) {
        ctx.strokeStyle = L.stroke;
        ctx.lineWidth = L.strokeWidth || 2;
        ctx.setLineDash(L.dash || []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (L.type === 'ellipse') {
      ctx.fillStyle = L.fill;
      ctx.beginPath();
      ctx.ellipse(L.x + L.w / 2, L.y + L.h / 2, Math.abs(L.w / 2), Math.abs(L.h / 2), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (L.type === 'image') drawImage(ctx, L, imgs[L.src]);
    else if (L.type === 'text') drawText(ctx, L);
    else if (L.type === 'button') drawPill(ctx, L, false);
    else if (L.type === 'chip') drawPill(ctx, L, true);
    else if (L.type === 'court') drawCourt(ctx, L);
    else if (L.type === 'wave') drawWave(ctx, L);
    else if (L.type === 'grid') drawGrid(ctx, L);
    else if (L.type === 'dash') drawDash(ctx, L);
    else if (L.type === 'blob') drawBlob(ctx, L);
    else if (L.type === 'halftone') drawHalftone(ctx, L);
    else if (L.type === 'deco') drawSticker(ctx, L);
    else if (L.type === 'scatter') drawScatter(ctx, L);
    ctx.restore();
  }
}

/** Paints a document ({ w, h, layers }) onto a canvas at `scale`. */
export function paint(canvas, doc, imgs, scale = 1) {
  canvas.width = Math.round(doc.w * scale);
  canvas.height = Math.round(doc.h * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  drawLayers(ctx, doc.layers, imgs);
}

// ---- Building a design ----

function builder() {
  const layers = [];
  const add = layer => {
    const full = { id: `l${layers.length + 1}`, opacity: 1, ...layer };
    layers.push(full);
    return full;
  };
  return { layers, add };
}

// A dark plate goes behind the logo when the page under it is light, or with
// `onBusy` (a photo or white paper) unless the logo itself is dark.
function addLogo(add, logo, x, y, h, onBusy = false) {
  if (!logo) return { w: 0, h: 0 };
  const plate = onBusy ? logoKind !== 'dark' : logoPlate;
  const w = (logo.width / logo.height) * h;
  if (!plate) {
    add({ type: 'image', name: 'Logo', src: logoSrc, x, y, w, h, fit: 'contain', radius: 0 });
    return { w, h };
  }
  const px = h * 0.3;
  const py = h * 0.24;
  add({ type: 'rect', name: 'Logo background', x, y, w: w + px * 2, h: h + py * 2, fill: INK, radius: h * 0.42 });
  add({ type: 'image', name: 'Logo', src: logoSrc, x: x + px, y: y + py, w, h, fit: 'contain', radius: 0 });
  return { w: w + px * 2, h: h + py * 2 };
}

function footerLines(spec) {
  const lines = [];
  if (spec.showContacts !== false && phoneContacts().length) lines.push(`Call or text ${phoneContacts().map(c => displayPhone(c.phone)).join('  ·  ')}`);
  if (spec.showAddress) lines.push(ADDRESS.join(', '));
  if (spec.showWebsite !== false && !String(spec.cta || '').includes(SITE_DOMAIN)) lines.push(`Book at ${SITE_DOMAIN}`);
  return lines;
}

// Footer anchored to `bottom`. Returns the height it used, including the rule.
function addFooter(ctx, add, spec, x, bottom, width, u, color, rule, align = 'left') {
  const lines = footerLines(spec);
  if (!lines.length) return 0;
  const lh = 27 * u * 1.45;
  const top = bottom - lines.length * lh;
  if (rule) add({ type: 'rect', name: 'Divider', x, y: top - 26 * u, w: width, h: Math.max(1, 2 * u), fill: rule, radius: 0 });
  const size = Math.min(...lines.map(line => fitText(ctx, line, { weight: 600, max: 27 * u, min: 16 * u, width, height: lh, lh: 1, maxLines: 1 })));
  add({ type: 'text', name: 'Contact details', text: lines.join('\n'), x, y: top, w: width, size, weight: 600, color, lh: 1.45, tracking: 0, align });
  return lines.length * lh + 26 * u;
}

/**
 * Fits the text blocks of a spec into a region, shrinking together until they fit.
 * Returns { total, place(y) } where place() adds the layers starting at y.
 */
function stack(ctx, spec, region, u, colors, opts = {}) {
  const align = opts.align || 'left';
  let result;
  for (let k = 1; k >= 0.5; k -= 0.05) {
    const blocks = [];
    const gap = 30 * u * k;
    const text = (name, t, weight, size, lh, color, extra = {}) => {
      const L = { type: 'text', name, text: t, x: region.x, y: 0, w: region.w, size, weight, color, lh, tracking: 0, align, ...extra };
      blocks.push({ h: layoutText(ctx, L).h, layer: L });
    };
    if (opts.big && spec.big) {
      const size = fitText(ctx, spec.big, { weight: 800, max: (opts.bigMax || 360) * u * k, min: 70 * u, width: region.w, height: region.h * 0.5, lh: 0.95, tracking: -0.04, maxLines: 1 });
      text('Big number', spec.big, 800, size, 0.95, colors.big || colors.fg, { tracking: -0.04 });
    }
    if (spec.headline) {
      const size = fitText(ctx, spec.headline, { weight: 800, max: (opts.headMax || 124) * u * k, min: 40 * u, width: region.w, height: region.h * (opts.headShare || 0.5), lh: 1.04, tracking: -0.03 });
      text('Headline', spec.headline, 800, size, 1.04, colors.fg, { tracking: -0.03 });
    }
    if (spec.body) {
      const size = fitText(ctx, spec.body, { weight: 500, max: 40 * u * k, min: 22 * u, width: region.w, height: region.h * 0.32, lh: 1.38 });
      text('Message', spec.body, 500, size, 1.38, colors.muted);
    }
    const details = String(spec.details || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .join('\n');
    if (details) {
      const size = 36 * u * k;
      text('Details', details, 700, size, 1.2, colors.fg, { bullet: colors.dot, paraGap: size * 0.3 });
    }
    if (spec.cta) {
      const L = { type: 'button', name: 'Button', text: spec.cta, x: region.x, y: 0, maxW: region.w, size: 34 * u * k, bg: colors.chipBg, fg: colors.chipFg };
      const box = pillBox(ctx, L, false);
      if (align === 'center') L.x = region.x + (region.w - box.w) / 2;
      blocks.push({ h: box.h, layer: L });
    }
    const total = blocks.reduce((s, b) => s + b.h, 0) + gap * Math.max(0, blocks.length - 1);
    result = { blocks, gap, total };
    if (total <= region.h) break;
  }
  return {
    total: result.total,
    place(add, y) {
      for (const b of result.blocks) {
        add({ ...b.layer, y });
        y += b.h + result.gap;
      }
    }
  };
}

function placeStack(add, s, region, anchor) {
  const y = anchor === 'bottom' ? region.y + region.h - s.total : anchor === 'center' ? region.y + (region.h - s.total) / 2 : region.y;
  s.place(add, y);
}

const isWide = (W, H) => W / H > 1.4;
const isTall = (W, H) => H / W > 1.15;
const bgRect = (W, H, fill) => ({ type: 'rect', name: 'Background', role: 'background', locked: true, x: 0, y: 0, w: W, h: H, fill, radius: 0 });
const photoLayer = (src, x, y, w, h, radius = 0) => ({ type: 'image', name: 'Photo', src, x, y, w, h, fit: 'cover', radius });

// ---- Shared pieces ----
// Every GGS layout is built from the same few parts: a top bar (logo left,
// a channel-style tag right), hairline rules, one highlight color per theme,
// and the waveform. Fields are solid; nothing is blurred or blended.

/** The theme's one highlight: gold on night, ink on gold, teal on deep teal. */
const hiOf = t => t.hi || t.chipBg;
const colorsOf = t => ({ fg: t.fg, muted: t.muted, dot: hiOf(t), chipBg: t.chipBg, chipFg: t.chipFg, big: hiOf(t) });
const ruleW = u => Math.max(1, 2 * u);
const lineOf = t => rgba(t.fg, 0.2);

function hair(add, x, y, w, color, u, name = 'Rule') {
  add({ type: 'rect', name, x, y, w, h: ruleW(u), fill: color, radius: 0 });
}
function vhair(add, x, y, h, color, u, name = 'Rule') {
  add({ type: 'rect', name, x, y, w: ruleW(u), h, fill: color, radius: 0 });
}

const TAG_SIZE = 22;
/** Width of a tag (square marker + uppercase label). */
function tagWidth(ctx, text, u) {
  const size = TAG_SIZE * u;
  setFont(ctx, 700, size, 0.14);
  return size * 0.5 + size * 0.6 + ctx.measureText(String(text).toUpperCase()).width;
}
/**
 * A small uppercase label with a square marker, like a channel name on a
 * desk. `align` says what x is: the left edge, the right edge, or the center.
 * Returns its height.
 */
function addTag(ctx, add, text, x, y, u, color, align = 'left') {
  if (!text) return 0;
  const size = TAG_SIZE * u;
  const w = tagWidth(ctx, text, u);
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const sq = size * 0.5;
  add({ type: 'rect', name: 'Label marker', x: left, y: y + size * 0.5 - sq / 2, w: sq, h: sq, fill: color, radius: 0 });
  add({ type: 'text', name: 'Label', text: String(text).toUpperCase(), x: left + sq + size * 0.6, y, w: w + size, size, weight: 700, color, lh: 1.2, tracking: 0.14, align: 'left' });
  return size * 1.2;
}

const logoSize = (logo, h, plate) => (logo ? { w: (logo.width / logo.height) * h + (plate ? h * 0.6 : 0), h: h + (plate ? h * 0.48 : 0) } : { w: 0, h: 0 });

/**
 * Logo on the left, the badge as a tag on the right, and (unless rule is
 * false) a hairline under both. Returns the y just below the rule.
 */
function topBar(c, x, y, w, { label = c.spec.badge, rule = true, logoH = 44, gap = 30, onPhoto = false } = {}) {
  const { ctx, add, u, t, logo } = c;
  const box = addLogo(add, logo, x, y, logoH * u * logoScale, onPhoto);
  const h = Math.max(box.h, TAG_SIZE * u * 1.2);
  addTag(ctx, add, label, x + w, y + (h - TAG_SIZE * u * 1.2) / 2, u, hiOf(t), 'right');
  const below = y + h + gap * u;
  if (rule) hair(add, x, below, w, lineOf(t), u);
  return below;
}

const detailRows = spec =>
  String(spec.details || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
const splitRow = row => {
  const i = row.indexOf(': ');
  return i > 0 ? [row.slice(0, i), row.slice(i + 2)] : [row, ''];
};

// ---- Posters ----

// Statement and Big number: the words are the design.
function layoutStatement(c) {
  const { ctx, add, spec, W, H, u, t } = c;
  const stat = spec.layout === 'stat';
  const wide = isWide(W, H);
  const pad = 76 * u;
  add(bgRect(W, H, t.bg));
  const top = topBar(c, pad, pad, W - pad * 2);
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, lineOf(t));
  const y = top + 56 * u;
  const region = { x: pad, y, w: (wide ? W * 0.66 : W) - pad * 2, h: H - pad - footerH - 48 * u - y };
  const s = stack(ctx, spec, region, u, colorsOf(t), { big: stat || Boolean(spec.big), headMax: wide ? 100 : 136, headShare: stat ? 0.3 : 0.6, bigMax: wide ? 250 : 360 });
  placeStack(add, s, region, stat ? 'center' : 'bottom');
}

// Waveform: headline above a played-through waveform, the rest below it.
function layoutWave(c) {
  const { ctx, add, spec, W, H, u, t } = c;
  const hi = hiOf(t);
  const wide = isWide(W, H);
  const pad = 76 * u;
  add(bgRect(W, H, t.bg));
  const top = topBar(c, pad, pad, W - pad * 2);
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, lineOf(t));
  const y0 = top + 48 * u;
  const y1 = H - pad - footerH - 40 * u;
  const avail = y1 - y0;
  const gap = 44 * u;
  const tc = 46 * u;
  const waveH = Math.min(avail * 0.24, (wide ? 120 : 220) * u);
  const rest = { body: spec.body, details: spec.details, cta: spec.cta };
  const hasRest = Boolean(spec.body || spec.details || spec.cta);
  const headShare = hasRest ? 0.5 : 0.8;
  const headR = { x: pad, y: y0, w: W - pad * 2, h: (avail - waveH - tc - gap * 2) * headShare };
  placeStack(add, stack(ctx, { headline: spec.headline, big: spec.big }, headR, u, colorsOf(t), { big: Boolean(spec.big), headMax: wide ? 96 : 128, headShare: 1, bigMax: 220 }), headR, 'bottom');
  const waveY = headR.y + headR.h + gap;
  const progress = 0.42;
  const ww = W - pad * 2;
  add({ type: 'wave', name: 'Waveform', x: pad, y: waveY, w: ww, h: waveH, color: hi, rest: rgba(t.fg, 0.22), progress, bars: wide ? 110 : 72, seed: hashString(spec.id || spec.headline || 'ggs') });
  add({ type: 'rect', name: 'Playhead', x: pad + ww * progress - 1.5 * u, y: waveY - 18 * u, w: Math.max(2, 3 * u), h: waveH + 36 * u, fill: t.fg, radius: 0 });
  const ts = 18 * u;
  const tcY = waveY + waveH + 26 * u;
  add({ type: 'text', name: 'Time', text: '00:00', x: pad, y: tcY, w: ww / 3, size: ts, weight: 600, color: t.muted, lh: 1.2, tracking: 0.08, align: 'left' });
  add({ type: 'text', name: 'Time', text: '03:24', x: pad + (ww * 2) / 3, y: tcY, w: ww / 3, size: ts, weight: 600, color: t.muted, lh: 1.2, tracking: 0.08, align: 'right' });
  if (!hasRest) return;
  const ry = waveY + waveH + tc + gap;
  const restR = { x: pad, y: ry, w: (wide ? W * 0.7 : W) - pad * 2, h: y1 - ry };
  placeStack(add, stack(ctx, rest, restR, u, colorsOf(t)), restR, 'top');
}

// Track list: numbered rows, a label on the left and a value on the right.
function layoutTracks(c) {
  const { ctx, add, spec, W, H, u, t } = c;
  const hi = hiOf(t);
  const line = lineOf(t);
  const wide = isWide(W, H);
  const pad = 72 * u;
  add(bgRect(W, H, t.bg));
  const top = topBar(c, pad, pad, W - pad * 2);
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, null);
  const bottom = H - pad - footerH - (footerH ? 36 * u : 0);
  const colors = colorsOf(t);
  const headR = wide ? { x: pad, y: top + 40 * u, w: W * 0.38 - pad, h: bottom - top - 40 * u } : { x: pad, y: top + 48 * u, w: W - pad * 2, h: (bottom - top) * 0.34 };
  const hs = stack(ctx, { headline: spec.headline, body: spec.body }, headR, u, colors, { headMax: wide ? 72 : 104, headShare: 0.7 });
  placeStack(add, hs, headR, 'top');
  const ay = wide ? top + 40 * u : headR.y + hs.total + 56 * u;
  const area = wide ? { x: W * 0.38 + pad * 0.5, y: ay, w: W * 0.62 - pad * 1.5, h: bottom - ay } : { x: pad, y: ay, w: W - pad * 2, h: bottom - ay };
  let ctaH = 0;
  if (spec.cta) {
    const L = { type: 'button', name: 'Button', text: spec.cta, x: area.x, y: 0, maxW: area.w, size: 30 * u, bg: t.chipBg, fg: t.chipFg };
    ctaH = pillBox(ctx, L, false).h;
    add({ ...L, y: area.y + area.h - ctaH });
  }
  const rows = detailRows(spec).map(splitRow);
  if (!rows.length) return;
  const listH = area.h - (ctaH ? ctaH + 40 * u : 0);
  const rowH = Math.min(104 * u, listH / rows.length);
  const num = Math.min(20 * u, rowH * 0.24);
  const numW = num * 3.2;
  const labelW = (area.w - numW) * 0.52;
  const valueW = area.w - numW - labelW;
  let size = Math.min(36 * u, rowH * 0.38);
  for (const [label, value] of rows) {
    size = Math.min(size, fitText(ctx, label, { weight: 700, max: size, min: 14 * u, width: value ? labelW - 16 * u : area.w - numW, height: size * 1.2, lh: 1, maxLines: 1 }));
    if (value) size = Math.min(size, fitText(ctx, value, { weight: 500, max: size, min: 14 * u, width: valueW, height: size * 1.2, lh: 1, maxLines: 1 }));
  }
  const closed = luminance(t.bg) > 0.5 ? '#b3261e' : '#ff8f78';
  hair(add, area.x, area.y, area.w, line, u);
  rows.forEach(([label, value], i) => {
    const y = area.y + i * rowH;
    const ty = y + (rowH - size * 1.15) / 2;
    add({ type: 'text', name: 'Track number', text: String(i + 1).padStart(2, '0'), x: area.x, y: y + (rowH - num * 1.2) / 2, w: numW, size: num, weight: 700, color: hi, lh: 1.2, tracking: 0.06, align: 'left' });
    add({ type: 'text', name: 'Row', text: label, x: area.x + numW, y: ty, w: value ? labelW : area.w - numW, size, weight: 700, color: t.fg, lh: 1.15, tracking: -0.01, align: 'left' });
    if (value) add({ type: 'text', name: 'Row value', text: value, x: area.x + numW + labelW, y: ty, w: valueW, size, weight: 500, color: /closed/i.test(value) ? closed : t.muted, lh: 1.15, tracking: 0, align: 'right' });
    hair(add, area.x, y + rowH, area.w, line, u);
  });
}

// Tape label: a ruled box like the label on a reel, with "Label: value" fields.
function layoutLabel(c) {
  const { ctx, add, spec, W, H, u, t } = c;
  const hi = hiOf(t);
  const line = rgba(t.fg, 0.3);
  const wide = isWide(W, H);
  const m = 60 * u;
  add(bgRect(W, H, t.bg));
  const footerH = addFooter(ctx, add, spec, m, H - m, W - m * 2, u, t.muted, null);
  const box = { x: m, y: m, w: W - m * 2, h: H - m * 2 - (footerH ? footerH + 6 * u : 0) };
  add({ type: 'rect', name: 'Label outline', ...box, fill: null, radius: 0, stroke: line, strokeWidth: ruleW(u) });
  const ip = 40 * u;
  const y1 = topBar(c, box.x + ip, box.y + ip * 0.8, box.w - ip * 2, { rule: false, logoH: 40, gap: 32 });
  hair(add, box.x, y1, box.w, line, u);
  const bottom = box.y + box.h;

  const ctaH = spec.cta ? (wide ? 76 : 96) * u : 0;
  if (spec.cta) {
    const top = bottom - ctaH;
    hair(add, box.x, top, box.w, line, u);
    const tw = box.w * 0.6 - ip;
    const size = fitText(ctx, spec.cta, { weight: 700, max: 30 * u, min: 16 * u, width: tw, height: ctaH * 0.7, lh: 1.2, maxLines: 2 });
    const L = { type: 'text', name: 'Button', text: spec.cta, x: box.x + ip, y: 0, w: tw, size, weight: 700, color: hi, lh: 1.2, tracking: 0, align: 'left' };
    add({ ...L, y: top + (ctaH - layoutText(ctx, L).h) / 2 });
    add({ type: 'wave', name: 'Waveform', x: box.x + box.w * 0.64, y: top + ctaH * 0.3, w: box.w * 0.36 - ip, h: ctaH * 0.4, color: rgba(t.fg, 0.45), bars: 30, seed: 11 });
  }

  const fields = detailRows(spec).map(row => {
    const [k, v] = splitRow(row);
    return v ? [k, v] : ['', k];
  });
  const cols = fields.length > 1 ? 2 : 1;
  const nRows = Math.ceil(fields.length / cols);
  const cellH = (wide ? 88 : 118) * u;
  const gridTop = bottom - ctaH - nRows * cellH;
  if (nRows) {
    const cw = box.w / cols;
    hair(add, box.x, gridTop, box.w, line, u);
    for (let r = 1; r < nRows; r++) hair(add, box.x, gridTop + r * cellH, box.w, line, u);
    if (cols === 2) vhair(add, box.x + cw, gridTop, nRows * cellH, line, u);
    fields.forEach(([k, v], i) => {
      const cx = box.x + (i % cols) * cw + ip * 0.8;
      const cy = gridTop + Math.floor(i / cols) * cellH;
      const inner = cw - ip * 1.6;
      const ls = 17 * u;
      const vs = fitText(ctx, v || ' ', { weight: 700, max: (wide ? 28 : 34) * u, min: 15 * u, width: inner, height: cellH * 0.45, lh: 1.15, maxLines: 1 });
      const blockH = (k ? ls * 1.2 + 10 * u : 0) + vs * 1.15;
      let y = cy + (cellH - blockH) / 2;
      if (k) {
        add({ type: 'text', name: 'Field label', text: k.toUpperCase(), x: cx, y, w: inner, size: ls, weight: 700, color: t.muted, lh: 1.2, tracking: 0.12, align: 'left' });
        y += ls * 1.2 + 10 * u;
      }
      add({ type: 'text', name: 'Field', text: v, x: cx, y, w: inner, size: vs, weight: 700, color: t.fg, lh: 1.15, tracking: -0.01, align: 'left' });
    });
  }
  const mainBottom = nRows ? gridTop : bottom - ctaH;
  const main = { x: box.x + ip, y: y1 + ip, w: box.w - ip * 2, h: mainBottom - ip - (y1 + ip) };
  placeStack(add, stack(ctx, { headline: spec.headline, body: spec.body, big: spec.big }, main, u, colorsOf(t), { big: Boolean(spec.big), headMax: wide ? 80 : 110, headShare: 0.5, bigMax: wide ? 150 : 220 }), main, 'center');
}

// Photo panel: the photo fills the page; a solid panel carries the words.
function layoutCover(c) {
  const { ctx, add, spec, W, H, u, t, photo } = c;
  const hi = hiOf(t);
  const wide = isWide(W, H);
  const tall = isTall(W, H);
  const pad = 64 * u;
  add(bgRect(W, H, t.bg));
  add(photoLayer(photo, 0, 0, W, H));
  const py = H * (tall ? 0.5 : 0.44);
  const panel = wide ? { x: 0, y: 0, w: W * 0.5, h: H } : { x: 0, y: py, w: W * 0.88, h: H - py };
  add({ type: 'rect', name: 'Panel', ...panel, fill: t.bg, radius: 0 });
  add({ type: 'rect', name: 'Accent', x: panel.x + pad, y: panel.y, w: 120 * u, h: 8 * u, fill: hi, radius: 0 });
  const inner = { x: panel.x + pad, y: panel.y + pad, w: panel.w - pad * 2, h: panel.h - pad * 2 };
  let y = inner.y;
  if (wide) y = topBar(c, inner.x, inner.y, inner.w) + 40 * u;
  else {
    addLogo(add, c.logo, pad, pad, 46 * u * logoScale, true);
    if (spec.badge) y += addTag(ctx, add, spec.badge, inner.x, y, u, hi) + 34 * u;
  }
  const footerH = addFooter(ctx, add, spec, inner.x, inner.y + inner.h, inner.w, u, t.muted, lineOf(t));
  const region = { x: inner.x, y, w: inner.w, h: inner.y + inner.h - footerH - 36 * u - y };
  placeStack(add, stack(ctx, spec, region, u, colorsOf(t), { big: Boolean(spec.big), headMax: wide ? 80 : 108, headShare: 0.7, bigMax: 200 }), region, wide ? 'bottom' : 'top');
}

// Photo window: a framed photo under the top bar, words beside or below it.
function layoutWindow(c) {
  const { ctx, add, spec, W, H, u, t, photo } = c;
  const wide = isWide(W, H);
  const tall = isTall(W, H);
  const pad = 68 * u;
  add(bgRect(W, H, t.bg));
  const top = topBar(c, pad, pad, W - pad * 2) + 36 * u;
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, lineOf(t));
  const bottom = H - pad - footerH - 40 * u;
  let region;
  if (wide) {
    add(photoLayer(photo, W * 0.52, top, W * 0.48 - pad, bottom - top));
    region = { x: pad, y: top, w: W * 0.52 - pad * 1.6, h: bottom - top };
  } else {
    const ph = (bottom - top) * (tall ? 0.52 : 0.46);
    add(photoLayer(photo, pad, top, W - pad * 2, ph));
    region = { x: pad, y: top + ph + 48 * u, w: W - pad * 2, h: bottom - top - ph - 48 * u };
  }
  placeStack(add, stack(ctx, spec, region, u, colorsOf(t), { headMax: wide ? 78 : 104, headShare: 0.55 }), region, wide ? 'bottom' : 'top');
}

// Photo column: the photo runs edge to edge down one side, split by a highlight rule.
function layoutColumn(c) {
  const { ctx, add, spec, W, H, u, t, photo } = c;
  const hi = hiOf(t);
  const tall = isTall(W, H);
  const pad = 64 * u;
  add(bgRect(W, H, t.bg));
  let area;
  if (tall) {
    const ph = H * 0.44;
    add(photoLayer(photo, 0, 0, W, ph));
    add({ type: 'rect', name: 'Accent', x: 0, y: ph, w: W, h: 6 * u, fill: hi, radius: 0 });
    area = { x: pad, y: ph + pad * 0.8, w: W - pad * 2, h: H - ph - pad * 1.8 };
  } else {
    const pw = W * 0.4;
    add(photoLayer(photo, 0, 0, pw, H));
    add({ type: 'rect', name: 'Accent', x: pw, y: 0, w: 6 * u, h: H, fill: hi, radius: 0 });
    area = { x: pw + pad, y: pad, w: W - pw - pad * 2, h: H - pad * 2 };
  }
  const top = topBar(c, area.x, area.y, area.w) + 40 * u;
  const footerH = addFooter(ctx, add, spec, area.x, area.y + area.h, area.w, u, t.muted, lineOf(t));
  const region = { x: area.x, y: top, w: area.w, h: area.y + area.h - footerH - 36 * u - top };
  placeStack(add, stack(ctx, spec, region, u, colorsOf(t), { big: Boolean(spec.big), headMax: isWide(W, H) ? 72 : 100, headShare: 0.55, bigMax: 180 }), region, 'bottom');
}

// Contact sheet: three studio photos in a row, numbered like film frames.
function layoutStrip(c) {
  const { ctx, add, spec, W, H, u, t, photos } = c;
  const wide = isWide(W, H);
  const pad = 64 * u;
  add(bgRect(W, H, t.bg));
  const top = topBar(c, pad, pad, W - pad * 2) + 36 * u;
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, lineOf(t));
  const bottom = H - pad - footerH - 40 * u;
  const gap = 12 * u;
  const ns = 17 * u;
  const numH = ns * 1.2 + 14 * u;
  const frames = wide
    ? { x: W * 0.46, y: top, w: W * 0.54 - pad, h: bottom - top - numH }
    : { x: pad, y: top, w: W - pad * 2, h: Math.min(((W - pad * 2) / 3) * 1.4, (bottom - top) * 0.46) };
  const fw = (frames.w - gap * 2) / 3;
  for (let i = 0; i < 3; i++) {
    const x = frames.x + i * (fw + gap);
    add({ ...photoLayer(photos[i] || photos[0], x, frames.y, fw, frames.h), name: i ? `Photo ${i + 1}` : 'Photo' });
    add({ type: 'text', name: 'Frame number', text: String(i + 1).padStart(2, '0'), x, y: frames.y + frames.h + 14 * u, w: fw, size: ns, weight: 700, color: t.muted, lh: 1.2, tracking: 0.1, align: 'left' });
  }
  const region = wide
    ? { x: pad, y: top, w: W * 0.46 - pad * 1.6, h: bottom - top }
    : { x: pad, y: frames.y + frames.h + numH + 40 * u, w: W - pad * 2, h: bottom - (frames.y + frames.h + numH + 40 * u) };
  placeStack(add, stack(ctx, spec, region, u, colorsOf(t), { headMax: wide ? 72 : 100, headShare: 0.55 }), region, wide ? 'bottom' : 'top');
}

// Quiet: centered, no rules. For thank-yous and holidays.
function layoutQuiet(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const hi = hiOf(t);
  const wide = isWide(W, H);
  const pad = 84 * u;
  add(bgRect(W, H, t.bg));
  const lh = 50 * u * logoScale;
  const ls = logoSize(logo, lh, logoPlate);
  addLogo(add, logo, (W - ls.w) / 2, pad, lh);
  let top = pad + ls.h + 64 * u;
  if (spec.badge) top += addTag(ctx, add, spec.badge, W / 2, top, u, hi, 'center') + 40 * u;
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, null, 'center');
  const region = { x: pad * (wide ? 2.2 : 1), y: top, w: W - pad * (wide ? 4.4 : 2), h: H - top - footerH - pad - 30 * u };
  placeStack(add, stack(ctx, spec, region, u, colorsOf(t), { align: 'center', big: Boolean(spec.big), headMax: wide ? 92 : 124, headShare: 0.55, bigMax: 280 }), region, 'center');
}

// ---- Vouchers, gift certificates, receipts ----

/** A highlight that reads on white paper (gold and teal are too light for text). */
function paperAccent(t) {
  const hi = hiOf(t);
  if (luminance(hi) < 0.5) return hi;
  return hi.toLowerCase() === TEAL ? '#00715f' : '#7f5d00';
}

// Lays out rows top to bottom, shrinking all of them together until they fit.
function flow(height, build, start = 1) {
  let out;
  for (let k = start; k >= 0.5; k -= 0.05) {
    const rows = build(k).filter(Boolean);
    out = { rows, total: rows.reduce((s, r) => s + r.h, 0) };
    if (out.total <= height) break;
  }
  return {
    ...out,
    place(add, y) {
      for (const r of out.rows) {
        r.place?.(add, y);
        y += r.h;
      }
    }
  };
}

const textRow = (ctx, L) => {
  const h = layoutText(ctx, L).h;
  return { h, place: (add, y) => add({ ...L, y }) };
};
const gapRow = h => ({ h });

// Voucher: the page is the voucher. A solid highlight stub holds the code.
function layoutVoucher(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const hi = hiOf(t);
  const onHi = on(hi);
  add(bgRect(W, H, t.bg));
  const tall = H > W * 1.05;
  const stub = tall ? { x: 0, y: H * 0.72, w: W, h: H * 0.28 } : { x: W * 0.7, y: 0, w: W * 0.3, h: H };
  const main = tall ? { x: 0, y: 0, w: W, h: H * 0.72 } : { x: 0, y: 0, w: W * 0.7, h: H };
  add({ type: 'rect', name: 'Stub', ...stub, fill: hi, radius: 0 });

  const p = 64 * u;
  const mr = { x: main.x + p, y: main.y + p, w: main.w - p * 2, h: main.h - p * 2 };
  const f = flow(mr.h, k => {
    const s = u * k;
    const logoH = 44 * s * logoScale;
    const ls = logoSize(logo, logoH, logoPlate);
    return [
      logo && { h: ls.h + 34 * s, place: (a, y) => addLogo(a, logo, mr.x, y, logoH) },
      spec.headline && textRow(ctx, { type: 'text', name: 'Title', text: spec.headline, x: mr.x, w: mr.w, size: fitText(ctx, spec.headline, { weight: 800, max: 50 * s, min: 24 * s, width: mr.w, height: 130 * s, lh: 1.08, tracking: -0.02 }), weight: 800, color: t.fg, lh: 1.08, tracking: -0.02, align: 'left' }),
      spec.big && gapRow(12 * s),
      spec.big && textRow(ctx, { type: 'text', name: 'Value', text: spec.big, x: mr.x, w: mr.w, size: fitText(ctx, spec.big, { weight: 800, max: 180 * s, min: 50 * s, width: mr.w, height: 210 * s, lh: 0.95, tracking: -0.04, maxLines: 1 }), weight: 800, color: hi, lh: 0.95, tracking: -0.04, align: 'left' }),
      spec.body && gapRow(20 * s),
      spec.body && textRow(ctx, { type: 'text', name: 'Description', text: spec.body, x: mr.x, w: mr.w, size: 28 * s, weight: 500, color: t.fg, lh: 1.35, tracking: 0, align: 'left' }),
      spec.details && gapRow(22 * s),
      spec.details && textRow(ctx, { type: 'text', name: 'Terms', text: detailRows(spec).join('\n'), x: mr.x, w: mr.w, size: 21 * s, weight: 500, color: t.muted, lh: 1.3, tracking: 0, align: 'left', bullet: hi, paraGap: 6 * s })
    ];
  }, 1.35);
  f.place(add, mr.y);

  const sp = 40 * u;
  const sr = { x: stub.x + sp, y: stub.y + sp, w: stub.w - sp * 2, h: stub.h - sp * 2 };
  const sf = flow(sr.h, k => {
    const s = u * k;
    return [
      textRow(ctx, { type: 'text', name: 'Code label', text: 'VOUCHER CODE', x: sr.x, w: sr.w, size: 18 * s, weight: 700, color: rgba(onHi, 0.7), lh: 1.2, tracking: 0.14, align: 'left' }),
      gapRow(14 * s),
      spec.badge && textRow(ctx, { type: 'text', name: 'Code', text: spec.badge, x: sr.x, w: sr.w, size: fitText(ctx, spec.badge, { weight: 800, max: 46 * s, min: 18 * s, width: sr.w, height: 60 * s, lh: 1.1, tracking: 0.04, maxLines: 2 }), weight: 800, color: onHi, lh: 1.1, tracking: 0.04, align: 'left' }),
      spec.cta && gapRow(18 * s),
      spec.cta && { h: ruleW(s) + 18 * s, place: (a, y) => hair(a, sr.x, y, sr.w, rgba(onHi, 0.3), s) },
      spec.cta && textRow(ctx, { type: 'text', name: 'How to use', text: spec.cta, x: sr.x, w: sr.w, size: 21 * s, weight: 600, color: onHi, lh: 1.3, tracking: 0, align: 'left' })
    ];
  }, 1.35);
  sf.place(add, sr.y + Math.max(0, (sr.h - sf.total) / 2));
}

// Gift certificate: one hairline frame, everything centered.
function layoutGiftcard(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const hi = hiOf(t);
  const line = rgba(t.fg, 0.3);
  add(bgRect(W, H, t.bg));
  const m = 36 * u;
  const frame = { x: m, y: m, w: W - m * 2, h: H - m * 2 };
  add({ type: 'rect', name: 'Frame', ...frame, fill: null, radius: 0, stroke: line, strokeWidth: ruleW(u) });
  const inner = { x: frame.x + 64 * u, y: frame.y + 52 * u, w: frame.w - 128 * u, h: frame.h - 104 * u };
  const wide = W / H > 1.3;
  const rows = detailRows(spec);
  const bottomH = 70 * u;
  const f = flow(inner.h - bottomH, k => {
    const s = u * k;
    const logoH = 46 * s * logoScale;
    const ls = logoSize(logo, logoH, logoPlate);
    const rowW = inner.w * (wide ? 0.6 : 0.86);
    const rowX = inner.x + (inner.w - rowW) / 2;
    const rs = 26 * s;
    return [
      logo && { h: ls.h + 26 * s, place: (a, y) => addLogo(a, logo, inner.x + (inner.w - ls.w) / 2, y, logoH) },
      { h: TAG_SIZE * s * 1.2 + 24 * s, place: (a, y) => addTag(ctx, a, 'Gift certificate', inner.x + inner.w / 2, y, s, hi, 'center') },
      spec.headline && textRow(ctx, { type: 'text', name: 'Headline', text: spec.headline, x: inner.x, w: inner.w, size: fitText(ctx, spec.headline, { weight: 800, max: 56 * s, min: 26 * s, width: inner.w, height: 140 * s, lh: 1.08, tracking: -0.02 }), weight: 800, color: t.fg, lh: 1.08, tracking: -0.02, align: 'center' }),
      spec.big && gapRow(10 * s),
      spec.big && textRow(ctx, { type: 'text', name: 'Value', text: spec.big, x: inner.x, w: inner.w, size: fitText(ctx, spec.big, { weight: 800, max: 140 * s, min: 44 * s, width: inner.w, height: 160 * s, lh: 0.95, tracking: -0.04, maxLines: 1 }), weight: 800, color: hi, lh: 0.95, tracking: -0.04, align: 'center' }),
      spec.body && gapRow(18 * s),
      spec.body && textRow(ctx, { type: 'text', name: 'Message', text: spec.body, x: inner.x + inner.w * 0.08, w: inner.w * 0.84, size: 24 * s, weight: 500, color: t.muted, lh: 1.4, tracking: 0, align: 'center' }),
      rows.length && gapRow(22 * s),
      ...rows.map(row => {
        const i = row.indexOf(':');
        const label = i > 0 ? row.slice(0, i + 1) : row;
        const value = i > 0 ? row.slice(i + 1).trim() : '';
        return {
          h: rs * 2.1,
          place: (a, y) => {
            setFont(ctx, 700, rs);
            const lwid = ctx.measureText(label + ' ').width;
            a({ type: 'text', name: 'Field label', text: label, x: rowX, y: y + rs * 0.4, w: lwid + 4, size: rs, weight: 700, color: t.muted, lh: 1.2, tracking: 0, align: 'left' });
            if (value) a({ type: 'text', name: 'Field', text: value, x: rowX + lwid + 8 * s, y: y + rs * 0.4, w: rowW - lwid - 8 * s, size: rs, weight: 700, color: t.fg, lh: 1.2, tracking: 0, align: 'left' });
            a({ type: 'rect', name: 'Field line', x: rowX + lwid, y: y + rs * 1.75, w: rowW - lwid, h: ruleW(s), fill: line, radius: 0 });
          }
        };
      })
    ];
  }, 1.6);
  f.place(add, inner.y + Math.max(0, (inner.h - bottomH - f.total) / 2));
  // Bottom row: validity, signature line, certificate number.
  const by = inner.y + inner.h - bottomH;
  const col = inner.w / 3;
  const small = 19 * u;
  if (spec.cta) add({ type: 'text', name: 'Validity', text: spec.cta, x: inner.x, y: by + 24 * u, w: col - 10 * u, size: small, weight: 600, color: t.muted, lh: 1.3, tracking: 0, align: 'left' });
  add({ type: 'rect', name: 'Signature line', x: inner.x + col + 20 * u, y: by + 22 * u, w: col - 40 * u, h: ruleW(u), fill: rgba(t.fg, 0.5), radius: 0 });
  add({ type: 'text', name: 'Signature label', text: 'Authorized signature', x: inner.x + col, y: by + 32 * u, w: col, size: small * 0.9, weight: 600, color: t.muted, lh: 1.3, tracking: 0, align: 'center' });
  if (spec.badge) add({ type: 'text', name: 'Certificate number', text: spec.badge, x: inner.x + col * 2 + 10 * u, y: by + 24 * u, w: col - 10 * u, size: small, weight: 700, color: t.fg, lh: 1.3, tracking: 0.06, align: 'right' });
}

// Receipt: a plain white slip, hairline rules, on the theme color.
function layoutReceipt(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  add(bgRect(W, H, t.bg));
  const ink = INK;
  const soft = INK_SOFT;
  const accent = paperAccent(t);
  const m = 44 * u;
  const pw = Math.min(W - m * 2, (H - m * 2) * 0.72);
  const maxPaper = { x: (W - pw) / 2, y: m, w: pw, h: H - m * 2 };
  const p = 52 * u;
  const inner = { x: maxPaper.x + p, y: maxPaper.y + p, w: maxPaper.w - p * 2, h: maxPaper.h - p * 2 };
  const pairs = text =>
    String(text || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(splitRow);
  const rowsOf = (list, s, size, weightL, weightR, colorL, colorR, name) =>
    list.map(([l, r]) => {
      // The label takes what it needs (up to 55%), the value gets the rest.
      setFont(ctx, weightL, size);
      const lw = r ? Math.min(inner.w * 0.55, ctx.measureText(l).width + size) : inner.w;
      const L = { type: 'text', name, text: l, x: inner.x, w: lw, size, weight: weightL, color: colorL, lh: 1.25, tracking: 0, align: 'left' };
      const R = r ? { type: 'text', name: `${name} amount`, text: r, x: inner.x + lw, w: inner.w - lw, size, weight: weightR, color: colorR, lh: 1.25, tracking: 0, align: 'right' } : null;
      const h = Math.max(layoutText(ctx, L).h, R ? layoutText(ctx, R).h : 0) + size * 0.55;
      return {
        h,
        place: (a, y) => {
          a({ ...L, y });
          if (R) a({ ...R, y });
        }
      };
    });
  const rule = s => ({ h: 44 * s, place: (a, y) => hair(a, inner.x, y + 21 * s, inner.w, PAPER_LINE, s, 'Divider') });
  const phones = phoneContacts().map(x => displayPhone(x.phone)).join('  ·  ');
  const f = flow(inner.h, k => {
    const s = u * k;
    const logoH = 50 * s * logoScale;
    const ls = logoSize(logo, logoH, true);
    const total = spec.big
      ? {
          h: 70 * s,
          place: (a, y) => {
            a({ type: 'text', name: 'Total label', text: 'Total', x: inner.x, y: y + 16 * s, w: inner.w * 0.4, size: 32 * s, weight: 800, color: ink, lh: 1.2, tracking: 0, align: 'left' });
            a({ type: 'text', name: 'Total', text: spec.big, x: inner.x + inner.w * 0.3, y, w: inner.w * 0.7, size: fitText(ctx, spec.big, { weight: 800, max: 56 * s, min: 28 * s, width: inner.w * 0.7, height: 70 * s, lh: 1.1, tracking: -0.02, maxLines: 1 }), weight: 800, color: ink, lh: 1.1, tracking: -0.02, align: 'right' });
          }
        }
      : null;
    return [
      // White paper: the logo always sits on its dark plate.
      logo && { h: ls.h + 20 * s, place: (a, y) => addLogo(a, logo, inner.x + (inner.w - ls.w) / 2, y, logoH, true) },
      textRow(ctx, { type: 'text', name: 'Business details', text: [ADDRESS.join(', '), phones, SITE_DOMAIN].filter(Boolean).join('\n'), x: inner.x, w: inner.w, size: 19 * s, weight: 500, color: soft, lh: 1.45, tracking: 0, align: 'center' }),
      rule(s),
      spec.headline && textRow(ctx, { type: 'text', name: 'Title', text: spec.headline, x: inner.x, w: inner.w, size: fitText(ctx, spec.headline, { weight: 800, max: 44 * s, min: 24 * s, width: inner.w, height: 110 * s, lh: 1.1, tracking: -0.02 }), weight: 800, color: ink, lh: 1.1, tracking: -0.02, align: 'center' }),
      spec.badge && gapRow(8 * s),
      spec.badge && textRow(ctx, { type: 'text', name: 'Receipt number', text: spec.badge, x: inner.x, w: inner.w, size: 20 * s, weight: 700, color: soft, lh: 1.3, tracking: 0.08, align: 'center' }),
      gapRow(22 * s),
      ...rowsOf(pairs(spec.body), s, 21 * s, 500, 700, soft, ink, 'Detail'),
      rule(s),
      ...rowsOf(pairs(spec.details), s, 26 * s, 600, 700, ink, ink, 'Item'),
      spec.details && rule(s),
      total,
      spec.cta && gapRow(14 * s),
      spec.cta && textRow(ctx, { type: 'text', name: 'Payment', text: spec.cta, x: inner.x, w: inner.w, size: 22 * s, weight: 700, color: accent, lh: 1.3, tracking: 0, align: 'center' }),
      rule(s),
      textRow(ctx, { type: 'text', name: 'Thank you', text: 'Thank you for recording with us.', x: inner.x, w: inner.w, size: 26 * s, weight: 800, color: ink, lh: 1.2, tracking: -0.01, align: 'center' }),
      gapRow(10 * s),
      textRow(ctx, { type: 'text', name: 'Note', text: 'This is an acknowledgement receipt, not an official receipt.', x: inner.x, w: inner.w, size: 16 * s, weight: 500, color: soft, lh: 1.35, tracking: 0, align: 'center' })
    ];
  }, 1.2);
  // Like a real slip, the paper is only as long as what is printed on it.
  const paperH = Math.min(maxPaper.h, f.total + p * 2);
  const paperY = (H - paperH) / 2;
  add({ type: 'rect', name: 'Receipt paper', x: maxPaper.x, y: paperY, w: maxPaper.w, h: paperH, fill: WHITE, radius: 0 });
  f.place(add, paperY + p);
}

// ---- Backgrounds, applied after a layout is built ----
// One neutral line color at low strength, never a second hue: the theme's
// field stays a single solid color.

export const BG_STYLES = [
  { id: 'lines', label: 'Grid lines' },
  { id: 'rules', label: 'Ruled lines' },
  { id: 'wave', label: 'Waveform' },
  { id: 'flat', label: 'Flat' }
];
// Older designs named backgrounds that no longer exist.
const BG_ALIASES = { site: 'lines', blobs: 'lines', halftone: 'lines', gradient: 'flat', glow: 'flat' };
export const bgId = id => BG_ALIASES[id] || id || 'lines';

function applyBackground(layers, spec, t, W, H, u) {
  const style = bgId(spec.bg);
  if (style === 'flat') return;
  const at = layers.findIndex(l => l.role === 'background');
  const bg = layers[at];
  if (!bg) return;
  const light = luminance(bg.fill) > 0.5;
  const color = rgba(light ? INK : WHITE, light ? 0.08 : 0.07);
  let layer;
  if (style === 'wave') {
    layer = { type: 'wave', name: 'Background waveform', role: 'backdrop', x: 0, y: H * 0.28, w: W, h: H * 0.44, color: rgba(light ? INK : WHITE, light ? 0.04 : 0.045), bars: Math.round(W / (24 * u)), seed: 3 };
  } else {
    const cell = 108 * u;
    layer = { type: 'grid', name: 'Background lines', role: 'backdrop', x: 0, y: 0, w: W, h: H, color, cols: style === 'rules' ? 0 : Math.max(2, Math.round(W / cell)), rows: Math.max(2, Math.round(H / (style === 'rules' ? cell * 0.6 : cell))), lineWidth: Math.max(1, 1.5 * u) };
  }
  layers.splice(at + 1, 0, layer);
}

// The box a text layer's words actually cover (a centered footer is narrow).
function inkBox(ctx, l) {
  if (l.type !== 'text') return boxOf(ctx, l);
  const { paras, h } = layoutText(ctx, l);
  setFont(ctx, l.weight, l.size, l.tracking || 0);
  const widest = Math.max(0, ...paras.flatMap(pp => pp.lines.map(line => ctx.measureText(line).width + pp.indent)));
  const w = Math.min(l.w, widest);
  const x = l.align === 'center' ? l.x + (l.w - w) / 2 : l.align === 'right' ? l.x + l.w - w : l.x;
  return { x, y: l.y, w, h };
}

function applyDecor(layers, spec, W, H, u) {
  if (!spec.decor || spec.decor === 'none') return;
  const ctx = measurer();
  const keepOut = layers.filter(isImportant).map(l => inkBox(ctx, l));
  const bg = layers.find(l => l.role === 'background');
  const seed = spec.decorSeed ?? hashString(`${spec.id}|${spec.layout}|${spec.format}`);
  const { behind, front } = decorLayers(spec.decor, { W, H, u, keepOut, seed, onLight: luminance(bg?.fill) > 0.6 });
  let at = layers.findIndex(l => l.role === 'background') + 1;
  while (layers[at] && layers[at].role === 'backdrop') at++;
  layers.splice(at, 0, ...behind.map(l => ({ ...l, role: 'decor' })));
  layers.push(...front.map(l => ({ ...l, role: 'decor' })));
}

export function resolveTheme(spec) {
  const base = THEMES[spec.theme] || THEMES.night;
  const d = DECORS[spec.decor];
  return d && d.palette && spec.decorColors !== false ? { ...base, ...OCCASION_THEMES[d.palette] } : base;
}

const LAYOUT_FNS = {
  field: layoutStatement,
  stat: layoutStatement,
  wave: layoutWave,
  tracks: layoutTracks,
  label: layoutLabel,
  quiet: layoutQuiet,
  cover: layoutCover,
  window: layoutWindow,
  column: layoutColumn,
  strip: layoutStrip,
  voucher: layoutVoucher,
  giftcard: layoutGiftcard,
  receipt: layoutReceipt
};

export function photoSrcOf(spec, photos, thumb = false) {
  if (spec.photoUrl) return spec.photoUrl;
  const p = photos[spec.photo];
  return p ? (thumb ? p.thumb : p.src) : null;
}

/**
 * Turns a spec into a document { w, h, layers }.
 * assets: { logo: HTMLImageElement, photoSrc: string } (the logo's shape sizes its box).
 */
export const FOOTER_STYLES = [
  { id: 'lines', label: 'Text lines', hint: 'Contact details in small text, part of the design.' },
  { id: 'bar', label: 'Footer bar', hint: 'A clean white band along the bottom, with room for sponsor logos.' },
  { id: 'none', label: 'No footer', hint: 'No contact details at all.' }
];

/**
 * The white band along the bottom: contact details on the left, sponsor
 * logos on the right. `y` is its top edge.
 */
function addFooterBar(add, ctx, spec, t, W, y, h, u) {
  const lines = footerLines(spec);
  const sponsors = (spec.sponsors || []).filter(x => x && x.src);
  const accent = luminance(t.bg) > 0.6 ? GOLD : t.bg === NIGHT ? GOLD : t.bg;
  add({ type: 'rect', name: 'Footer bar', x: 0, y, w: W, h, fill: WHITE, radius: 0 });
  add({ type: 'rect', name: 'Footer accent', x: 0, y, w: W, h: Math.max(3, 8 * u), fill: accent, radius: 0 });
  const pad = 56 * u;
  const inner = { y: y + 8 * u, h: h - 8 * u };
  const textW = sponsors.length ? (W - pad * 2) * 0.46 : W - pad * 2;
  if (lines.length) {
    const lh = 1.4;
    const size = Math.min(...lines.map(line => fitText(ctx, line, { weight: 700, max: 26 * u, min: 13 * u, width: textW, height: 40 * u, lh: 1, maxLines: 1 })));
    const blockH = lines.length * size * lh;
    add({
      type: 'text', name: 'Contact details', text: lines.join('\n'), x: pad, y: inner.y + (inner.h - blockH) / 2, w: textW,
      size, weight: 700, color: INK_SOFT, lh, tracking: 0, align: sponsors.length ? 'left' : 'center'
    });
  }
  if (!sponsors.length) return;
  const label = spec.sponsorLabel || 'Supported by';
  const area = { x: pad + textW + 30 * u, w: W - pad * 2 - textW - 30 * u };
  const labelSize = 17 * u;
  const logoH = Math.min(inner.h * 0.5, 84 * u);
  const gap = 22 * u;
  const boxW = Math.min(logoH * 2.4, (area.w - gap * (sponsors.length - 1)) / sponsors.length);
  const rowW = boxW * sponsors.length + gap * (sponsors.length - 1);
  const top = inner.y + (inner.h - (labelSize * 1.6 + logoH)) / 2;
  add({ type: 'text', name: 'Sponsors label', text: label.toUpperCase(), x: area.x, y: top, w: area.w, size: labelSize, weight: 800, color: '#5b6472', lh: 1.2, tracking: 0.08, align: 'right' });
  sponsors.forEach((sp, i) => {
    add({ type: 'image', name: `Sponsor: ${sp.name}`, src: sp.src, x: area.x + area.w - rowW + i * (boxW + gap), y: top + labelSize * 1.6, w: boxW, h: logoH, fit: 'contain', radius: 0 });
  });
}

export function buildLayers(spec, assets) {
  spec = { ...spec, layout: layoutId(spec.layout) };
  const format = FORMATS.find(f => f.id === spec.format) || FORMATS[0];
  const { w: W, h: fullH } = format;
  const { layers, add } = builder();
  const fn = LAYOUT_FNS[spec.layout] || layoutStatement;
  // A footer bar gets its own strip at the bottom: the design is laid out in
  // the space above it, so no layout has to know about the bar.
  const footerStyle = spec.footerStyle || 'lines';
  const u0 = Math.min(W, fullH * 1.15) / 1080;
  const hasSponsors = (spec.sponsors || []).some(x => x && x.src);
  const barH = footerStyle === 'bar' ? Math.round((hasSponsors ? 170 : 120) * u0) : 0;
  const H = fullH - barH;
  const layoutSpec = footerStyle === 'lines' ? spec : { ...spec, showContacts: false, showWebsite: false, showAddress: false };
  const u = Math.min(W, H * 1.15) / 1080;
  const t = resolveTheme(spec);
  const photos = assets.photos && assets.photos.length ? assets.photos : [assets.photoSrc];
  logoSrc = assets.logo ? assets.logo.src : LOGO_SRC;
  logoScale = (LOGO_SIZES.find(x => x.id === spec.logoSize) || LOGO_SIZES[1]).scale;
  // The plate is dark; only the full-color logo needs one on light colors.
  logoKind = spec.logoStyle || 'color';
  logoPlate = logoKind === 'color' && luminance(t.bg) > 0.5;
  fn({ ctx: measurer(), add, spec: layoutSpec, W, H, u, t, logo: assets.logo, photo: assets.photoSrc, photos });
  applyBackground(layers, layoutSpec, t, W, H, u);
  applyDecor(layers, layoutSpec, W, H, u);
  if (barH) addFooterBar(add, measurer(), spec, t, W, H, barH, u0);
  layers.forEach((l, i) => {
    l.id = `l${i + 1}`;
  });
  return { w: W, h: fullH, layers };
}

/**
 * Builds a spec into a document and loads its pictures: { doc, imgs }, ready for paint().
 * `thumb` uses the small photo files, for previews.
 */
export async function prepareSpec(spec, { thumb = false } = {}) {
  await loadFonts();
  const logo = await loadLogo(spec.logoStyle);
  spec = { ...spec, layout: layoutId(spec.layout) };
  const photoSrc = PHOTO_LAYOUTS.has(spec.layout) ? photoSrcOf(spec, PHOTOS, thumb) : null;
  // The contact sheet uses two more studio photos after the chosen one.
  let photos = null;
  if (spec.layout === 'strip') {
    const keys = studioPhotoKeys().filter(k => PHOTOS[k].orientation !== 'portrait');
    const at = Math.max(0, keys.indexOf(spec.photo));
    photos = [photoSrc, ...[3, 6].map(i => PHOTOS[keys[(at + i) % keys.length]][thumb ? 'thumb' : 'src'])];
  }
  const doc = buildLayers(spec, { logo, photoSrc, photos });
  return { doc, imgs: await loadLayerImages(doc.layers) };
}

export function downloadCanvas(canvas, filename) {
  return new Promise(resolve =>
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      resolve();
    }, 'image/png')
  );
}
