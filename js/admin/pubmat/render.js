// Social graphics ("pubmats") as a list of layers. Ported from the Manson
// Pickleball pubmat maker and re-skinned for GGS Studio: gold and teal
// themes, the GGS logo, and a waveform where the court diagram was.
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
//   court   { x, y, w, h, color, lineWidth, rotation, clip }                              (the waveform motif)
//   dash    { x, y, w, h, color }                                                         (a dashed line)
//   blob    { x, y, w, h, color, alpha }                                                  (a soft gradient blob)
//   halftone{ x, y, w, h, color, alpha, spacing }                                         (a cloud of halftone dots)
//   deco    { x, y, w, h, kind, colors, rotation }                                        (a sticker, see decor.js)
//   scatter { x, y, w, h, shape, count, size, seed, colors, holes }                       (confetti, snow, hearts...)
// Rects may also have a gradient, a stroke (with dash), or zigzag edges (receipts).
// Every layer also has id, name, and opacity; the background is locked.

import { ADDRESS, PHOTOS, SITE_DOMAIN, displayPhone, phoneContacts, studioPhotoKeys } from './brand.js';
import { DECORS, OCCASION_THEMES, decorLayers, drawBlob, drawHalftone, drawScatter, drawSticker, hashString, isImportant, luminance, rgba, seeded, shade } from './decor.js';

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

// GGS gold and teal. Text sits in ink on gold and teal, white on the darks.
export const THEMES = {
  night: { label: 'Studio night', bg: NIGHT, fg: '#ffffff', muted: '#c9d0d0', line: 'rgba(255,213,88,0.16)', chipBg: GOLD, chipFg: INK, dot: TEAL, accent: GOLD, grad: ['#161b1e', NIGHT], blobs: [GOLD, TEAL], dots: GOLD },
  gold: { label: 'Gold', bg: GOLD, fg: INK, muted: '#3d3311', line: 'rgba(2,3,4,0.14)', chipBg: INK, chipFg: GOLD, dot: INK, accent: '#8a6700', grad: ['#ffe07f', '#f0bf2c'], blobs: ['#fff3c9', TEAL], dots: INK },
  teal: { label: 'Deep teal', bg: '#06302a', fg: '#ffffff', muted: '#c4efe5', line: 'rgba(77,255,219,0.18)', chipBg: TEAL, chipFg: INK, dot: TEAL, accent: '#06302a', grad: ['#0b4239', '#03150f'], blobs: [TEAL, GOLD], dots: TEAL },
  light: { label: 'White', bg: '#ffffff', fg: INK, muted: '#3c4446', line: 'rgba(2,3,4,0.1)', chipBg: INK, chipFg: GOLD, dot: '#b8860b', accent: INK, grad: ['#ffffff', '#f4efe0'], blobs: [GOLD, TEAL], dots: '#b8860b' }
};

export const LAYOUTS = [
  { id: 'field', label: 'Bold field', group: 'poster' },
  { id: 'glow', label: 'Soft glow', group: 'poster' },
  { id: 'photo', label: 'Photo on top', group: 'poster' },
  { id: 'fade', label: 'Photo fade', group: 'poster' },
  { id: 'side', label: 'Side fade', group: 'poster' },
  { id: 'magazine', label: 'Magazine cover', group: 'poster' },
  { id: 'split', label: 'Half and half', group: 'poster' },
  { id: 'arch', label: 'Arch photo', group: 'poster' },
  { id: 'frame', label: 'Framed photo', group: 'poster' },
  { id: 'collage', label: 'Photo collage', group: 'poster' },
  { id: 'bento', label: 'Tiles', group: 'poster' },
  { id: 'minimal', label: 'Clean and light', group: 'poster' },
  { id: 'center', label: 'Centered', group: 'poster' },
  { id: 'stat', label: 'Big number', group: 'poster' },
  { id: 'schedule', label: 'Schedule list', group: 'poster' },
  { id: 'ticket', label: 'Event ticket', group: 'poster' },
  { id: 'voucher', label: 'Voucher', group: 'document' },
  { id: 'giftcard', label: 'Gift certificate', group: 'document' },
  { id: 'receipt', label: 'Receipt', group: 'document' }
];
export const PHOTO_LAYOUTS = new Set(['photo', 'split', 'frame', 'bento', 'fade', 'side', 'magazine', 'arch', 'collage', 'minimal']);
export const DOCUMENT_LAYOUTS = new Set(['voucher', 'giftcard', 'receipt']);

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';
const INK_SOFT = '#3c4446';
const WHITE = '#ffffff';
const NIGHT_CARD = '#0e1113';
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
    if (lines.length <= maxLines && lines.length * size * lh <= height && widest <= width) return size;
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

function courtAt(cx, cy, h, extra) {
  const w = (h * 24) / 44;
  return { type: 'court', name: 'Waveform', x: cx - w / 2, y: cy - h / 2, w, h, ...extra };
}

function addLogo(add, logo, x, y, h, plate) {
  if (!logo) return { w: 0, h: 0 };
  // A dark plate goes behind the full-color logo whenever the page is light.
  plate = logoPlate;
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

// Adds a small uppercase label. With `right`, x is the right edge.
function addChip(ctx, add, text, x, y, size, bg, fg, right = false) {
  if (!text) return 0;
  const L = { type: 'chip', name: 'Label', text, x, y, size, bg, fg };
  const box = pillBox(ctx, L, true);
  if (right) L.x = x - box.w;
  add(L);
  return box.h;
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

// ---- Layouts ----

function layoutField(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const stat = spec.layout === 'stat';
  const pad = 80 * u;
  add(bgRect(W, H, t.bg));
  const wide = isWide(W, H);
  add(courtAt(wide ? W * 0.86 : W * 0.84, wide ? H * 0.5 : H * 0.3, wide ? H * 1.25 : H * 0.78, { color: t.line, lineWidth: 7 * u, rotation: wide ? Math.PI / 2 : 0.12 }));
  const logoBox = addLogo(add, logo, pad, pad, 62 * u * logoScale, t.bg !== WHITE);
  addChip(ctx, add, spec.badge, W - pad, pad + ((logoBox.h || 62 * u) - 30 * u * 2.1) / 2, 30 * u, t.chipBg, t.chipFg, true);
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, t.line);
  const top = pad + (logoBox.h || 62 * u) + (wide ? 44 : 72) * u;
  const region = { x: pad, y: top, w: (wide ? W * 0.62 : W) - pad * 2, h: H - pad - footerH - 40 * u - top };
  placeStack(add, stack(ctx, spec, region, u, t, { big: stat, headMax: wide ? 96 : 132, headShare: stat ? 0.3 : 0.55, bigMax: wide ? 260 : 380 }), region, stat ? 'center' : 'bottom');
}

function layoutPhoto(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  const wide = isWide(W, H);
  add(bgRect(W, H, t.bg));
  const pad = 72 * u;
  let pr;
  let region;
  if (wide) {
    pr = { x: 0, y: 0, w: W * 0.48, h: H };
    region = { x: W * 0.48 + pad * 0.8, y: pad, w: W * 0.52 - pad * 1.8, h: H - pad * 2 };
  } else {
    const share = H / W > 1.5 ? 0.46 : 0.5;
    pr = { x: 0, y: 0, w: W, h: H * share };
    region = { x: pad, y: pr.h + pad * 0.85, w: W - pad * 2, h: H - pr.h - pad * 1.85 };
  }
  add(photoLayer(photo, pr.x, pr.y, pr.w, pr.h));
  addLogo(add, logo, 40 * u, 40 * u, 54 * u * logoScale, true);
  addChip(ctx, add, spec.badge, pr.x + pr.w - 40 * u, 44 * u, 28 * u, t.chipBg, t.chipFg, true);
  const footerH = addFooter(ctx, add, spec, region.x, region.y + region.h, region.w, u, t.muted, t.line);
  const r = { ...region, h: region.h - footerH - 34 * u };
  placeStack(add, stack(ctx, spec, r, u, t, { headMax: wide ? 84 : 112, headShare: 0.55 }), r, 'top');
}

function layoutSplit(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  add(bgRect(W, H, t.bg));
  const tall = isTall(W, H);
  const pad = 70 * u;
  const text = tall ? { x: 0, y: 0, w: W, h: H * 0.54 } : { x: 0, y: 0, w: W * 0.54, h: H };
  const pr = tall ? { x: 0, y: text.h, w: W, h: H - text.h } : { x: text.w, y: 0, w: W - text.w, h: H };
  add(photoLayer(photo, pr.x, pr.y, pr.w, pr.h));
  const logoBox = addLogo(add, logo, pad, pad, 54 * u * logoScale, t.bg !== WHITE);
  addChip(ctx, add, spec.badge, pr.x + pr.w - 36 * u, pr.y + 36 * u, 26 * u, t.chipBg, t.chipFg, true);
  const footerH = addFooter(ctx, add, spec, pad, text.y + text.h - pad * 0.8, text.w - pad * 2, u, t.muted, t.line);
  const top = pad + logoBox.h + 40 * u;
  const region = { x: pad, y: top, w: text.w - pad * 2, h: text.h - top - footerH - pad * 0.8 - 30 * u };
  placeStack(add, stack(ctx, spec, region, u, t, { headMax: isWide(W, H) ? 76 : 104, headShare: 0.55 }), region, 'center');
}

function layoutFrame(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  add(bgRect(W, H, t.bg));
  const m = 48 * u;
  const wide = isWide(W, H);
  const pr = wide ? { x: m, y: m, w: W * 0.5 - m, h: H - m * 2 } : { x: m, y: m, w: W - m * 2, h: H * (isTall(W, H) ? 0.52 : 0.5) };
  add(photoLayer(photo, pr.x, pr.y, pr.w, pr.h, 30 * u));
  addLogo(add, logo, pr.x + 28 * u, pr.y + 28 * u, 48 * u * logoScale, true);
  addChip(ctx, add, spec.badge, pr.x + pr.w - 28 * u, pr.y + 32 * u, 26 * u, t.chipBg, t.chipFg, true);
  const region = wide
    ? { x: W * 0.5 + m, y: m * 1.4, w: W * 0.5 - m * 2.2, h: H - m * 2.8 }
    : { x: m + 16 * u, y: pr.y + pr.h + m, w: W - m * 2 - 32 * u, h: H - pr.y - pr.h - m * 2 };
  const footerH = addFooter(ctx, add, spec, region.x, region.y + region.h, region.w, u, t.muted, null);
  const r = { ...region, h: region.h - footerH - 20 * u };
  placeStack(add, stack(ctx, spec, r, u, t, { headMax: wide ? 76 : 104, headShare: 0.55 }), r, 'top');
}

function layoutCenter(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  add(bgRect(W, H, t.bg));
  const wide = isWide(W, H);
  add(courtAt(W / 2, H / 2, wide ? W * 0.95 : H * 0.92, { color: t.line, lineWidth: 6 * u, rotation: wide ? Math.PI / 2 : 0 }));
  const pad = 80 * u;
  const logoH = 58 * u * logoScale;
  if (logo) {
    const lw = (logo.width / logo.height) * logoH;
    addLogo(add, logo, (W - lw - logoH * 0.84) / 2, pad, logoH, t.bg !== WHITE);
  }
  let top = pad + logoH * 1.68 + 50 * u;
  if (spec.badge) {
    const L = { type: 'chip', text: spec.badge, size: 28 * u, x: 0, y: top };
    const bw = pillBox(ctx, L, true).w;
    top += addChip(ctx, add, spec.badge, (W - bw) / 2, top, 28 * u, t.chipBg, t.chipFg) + 36 * u;
  }
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, null, 'center');
  const region = { x: pad * (wide ? 2.2 : 1), y: top, w: W - pad * (wide ? 4.4 : 2), h: H - top - footerH - pad - 20 * u };
  const colors = { ...t, dot: t.dot };
  placeStack(add, stack(ctx, spec, region, u, colors, { align: 'center', big: Boolean(spec.big), headMax: wide ? 92 : 128, headShare: 0.55, bigMax: 280 }), region, 'center');
}

function layoutBento(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  const dark = t.bg === NIGHT;
  const card = dark ? NIGHT_CARD : WHITE;
  const cardFg = dark ? WHITE : INK;
  const cardMuted = dark ? '#c3cad6' : INK_SOFT;
  // The headline tile takes the theme color; white and night use gold.
  const field = t.bg === WHITE || dark ? GOLD : t.bg;
  const onField = on(field);
  add(bgRect(W, H, dark ? NIGHT : '#eef0ee'));
  const pad = 36 * u;
  const gap = 18 * u;
  const r = 30 * u;
  const iw = W - pad * 2;
  const ih = H - pad * 2;
  const ratio = W / H;
  const grid =
    ratio > 1.4
      ? { head: [0, 0, 0.46, 1], photo: [0.46, 0, 0.54, 0.6], info: [0.46, 0.6, 0.3, 0.4], brand: [0.76, 0.6, 0.24, 0.4] }
      : ratio > 0.9
        ? { head: [0, 0, 0.58, 0.6], photo: [0.58, 0, 0.42, 0.6], info: [0, 0.6, 0.58, 0.4], brand: [0.58, 0.6, 0.42, 0.4] }
        : { photo: [0, 0, 1, 0.38], head: [0, 0.38, 1, 0.34], info: [0, 0.72, 0.6, 0.28], brand: [0.6, 0.72, 0.4, 0.28] };
  const rect = ([fx, fy, fw, fh]) => {
    const x = pad + fx * iw + (fx > 0 ? gap / 2 : 0);
    const y = pad + fy * ih + (fy > 0 ? gap / 2 : 0);
    const w = fw * iw - (fx > 0 ? gap / 2 : 0) - (fx + fw < 0.999 ? gap / 2 : 0);
    const h = fh * ih - (fy > 0 ? gap / 2 : 0) - (fy + fh < 0.999 ? gap / 2 : 0);
    return { x, y, w, h };
  };
  const head = rect(grid.head);
  const ph = rect(grid.photo);
  const info = rect(grid.info);
  const brand = rect(grid.brand);

  add(photoLayer(photo, ph.x, ph.y, ph.w, ph.h, r));
  add({ type: 'rect', name: 'Headline tile', ...head, fill: field, radius: r, panel: true });
  add(courtAt(head.x + head.w * 0.9, head.y + head.h * 0.2, head.h * 1.1, { color: rgba(onField, 0.14), lineWidth: 6 * u, rotation: 0.2, clip: { ...head, r } }));
  const ip = 44 * u;
  let hy = head.y + ip;
  if (spec.badge) hy += addChip(ctx, add, spec.badge, head.x + ip, hy, 26 * u, onField, field) + 28 * u;
  const hr = { x: head.x + ip, y: hy, w: head.w - ip * 2, h: head.y + head.h - ip - hy };
  placeStack(add, stack(ctx, { headline: spec.headline, big: spec.big }, hr, u, { fg: onField, muted: onField }, { big: Boolean(spec.big), headMax: ratio > 1.4 ? 88 : ratio > 0.9 ? 108 : 150, headShare: 1, bigMax: 220 }), hr, 'bottom');

  add({ type: 'rect', name: 'Info tile', ...info, fill: card, radius: r, card: true });
  const irg = { x: info.x + ip * 0.8, y: info.y + ip * 0.8, w: info.w - ip * 1.6, h: info.h - ip * 1.6 };
  placeStack(add, stack(ctx, { body: spec.body, details: spec.details, cta: spec.cta }, irg, u * 0.9, { fg: cardFg, muted: cardMuted, dot: TEAL, chipBg: field, chipFg: onField }), irg, 'center');

  add({ type: 'rect', name: 'Brand tile', ...brand, fill: card, radius: r, card: true });
  if (logo) {
    const lw = Math.min(brand.w - ip * 1.2, (logo.width / logo.height) * brand.h * 0.34) * logoScale;
    const lh = (logo.height / logo.width) * lw;
    const phones = spec.showContacts !== false ? phoneContacts().map(x => displayPhone(x.phone)) : [];
    const size = fitText(ctx, phones[0] || 'x', { weight: 700, max: 24 * u, min: 14 * u, width: brand.w - ip, height: 24 * u * 1.4, lh: 1, maxLines: 1 });
    const blockH = lh + (phones.length ? 22 * u + phones.length * size * 1.4 : 0);
    const by = brand.y + (brand.h - blockH) / 2;
    add({ type: 'image', name: 'Logo', src: logoSrc, x: brand.x + (brand.w - lw) / 2, y: by, w: lw, h: lh, fit: 'contain', radius: 0 });
    if (phones.length) add({ type: 'text', name: 'Phone numbers', text: phones.join('\n'), x: brand.x + ip / 2, y: by + lh + 22 * u, w: brand.w - ip, size, weight: 700, color: cardMuted, lh: 1.4, tracking: 0, align: 'center' });
  }
}

function layoutSchedule(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const dark = t.bg === NIGHT;
  const band = t.bg === WHITE ? INK : t.bg;
  const onBand = on(band);
  const paper = dark ? NIGHT_CARD : WHITE;
  const ink = dark ? WHITE : INK;
  const soft = dark ? '#c3cad6' : INK_SOFT;
  const line = dark ? '#232c3a' : PAPER_LINE;
  const wide = isWide(W, H);
  add(bgRect(W, H, paper));
  const pad = 72 * u;
  const bandR = wide ? { x: 0, y: 0, w: W * 0.42, h: H } : { x: 0, y: 0, w: W, h: H * (isTall(W, H) ? 0.36 : 0.4) };
  add({ type: 'rect', name: 'Header band', ...bandR, fill: band, radius: 0, panel: true });
  add(courtAt(bandR.x + bandR.w * 0.88, bandR.y + bandR.h * 0.5, bandR.h * 1.3, { color: rgba(onBand, 0.14), lineWidth: 6 * u, rotation: wide ? 0 : Math.PI / 2, clip: { ...bandR, r: 0 } }));
  const logoBox = addLogo(add, logo, pad, pad * 0.8, 50 * u * logoScale, true);
  addChip(ctx, add, spec.badge, bandR.x + bandR.w - pad, pad * 0.8 + (logoBox.h - 26 * u * 2.1) / 2, 26 * u, onBand, band, true);
  const hr = { x: pad, y: pad * 0.8 + logoBox.h + 36 * u, w: bandR.w - pad * 2, h: bandR.h - pad * 1.6 - logoBox.h - 36 * u };
  placeStack(add, stack(ctx, { headline: spec.headline, body: spec.body }, hr, u, { fg: onBand, muted: onBand }, { headMax: wide ? 84 : 110, headShare: 0.7 }), hr, 'bottom');

  const rows = String(spec.details || '').split('\n').map(s => s.trim()).filter(Boolean);
  const area = wide ? { x: bandR.w + pad * 0.8, y: pad * 0.8, w: W - bandR.w - pad * 1.6, h: H - pad * 1.6 } : { x: pad, y: bandR.h + pad * 0.7, w: W - pad * 2, h: H - bandR.h - pad * 1.4 };
  const footerH = addFooter(ctx, add, spec, area.x, area.y + area.h, area.w, u, soft, null);
  let ctaH = 0;
  if (spec.cta) {
    const L = { type: 'button', name: 'Button', text: spec.cta, x: area.x, y: 0, maxW: area.w, size: 32 * u, bg: band === INK && !dark ? GOLD : band, fg: band === INK && !dark ? INK : onBand };
    ctaH = pillBox(ctx, L, false).h;
    add({ ...L, y: area.y + area.h - footerH - (footerH ? 26 * u : 0) - ctaH });
  }
  const listH = area.h - footerH - ctaH - (ctaH ? 40 * u : 0) - (footerH ? 26 * u : 0);
  if (!rows.length) return;
  const rowH = Math.min(118 * u, listH / rows.length);
  const size = Math.min(40 * u, rowH * 0.36);
  rows.forEach((row, i) => {
    const y = area.y + i * rowH;
    const split = row.indexOf(': ');
    const label = split > 0 ? row.slice(0, split) : row;
    const value = split > 0 ? row.slice(split + 2) : '';
    const ty = y + (rowH - size * 1.15) / 2;
    const half = area.w * (value ? 0.48 : 1);
    add({ type: 'text', name: 'Schedule row', text: label, x: area.x, y: ty, w: half, size, weight: 800, color: ink, lh: 1.15, tracking: -0.01, align: 'left' });
    if (value) add({ type: 'text', name: 'Schedule time', text: value, x: area.x + area.w * 0.48, y: ty, w: area.w * 0.52, size, weight: 600, color: /closed/i.test(value) ? '#c0392b' : soft, lh: 1.15, tracking: 0, align: 'right' });
    if (i < rows.length - 1) add({ type: 'rect', name: 'Row line', x: area.x, y: y + rowH, w: area.w, h: Math.max(1, 2 * u), fill: line, radius: 0 });
  });
}

function layoutTicket(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const dark = t.bg === NIGHT;
  const pageBg = t.bg === WHITE ? '#eef0ee' : t.bg;
  const paper = dark ? NIGHT_CARD : WHITE;
  const ink = dark ? WHITE : INK;
  const soft = dark ? '#c3cad6' : INK_SOFT;
  const accent = t.bg === WHITE || dark ? GOLD : t.bg;
  const onAccent = on(accent);
  add(bgRect(W, H, pageBg));
  const wide = isWide(W, H);
  add(courtAt(W * 0.82, H * 0.18, H * (wide ? 1.2 : 0.7), { color: t.bg === WHITE ? 'rgba(2,3,4,0.1)' : rgba(on(t.bg), 0.12), lineWidth: 6 * u, rotation: 0.3 }));
  const m = 60 * u;
  const tall = isTall(W, H);
  const footerLinesCount = footerLines(spec).length;
  const footerSpace = footerLinesCount ? footerLinesCount * 27 * u * 1.45 + 36 * u : 0;
  const logoH = 50 * u * logoScale;
  const topSpace = logoH * 1.68 + 36 * u;
  const tk = { x: m, y: m + topSpace, w: W - m * 2, h: H - m * 2 - topSpace - footerSpace };
  addLogo(add, logo, m, m, logoH, t.bg !== WHITE);
  add({ type: 'rect', name: 'Ticket', ...tk, fill: paper, radius: 36 * u, card: true });
  const stubShare = tall ? 0.34 : 0.36;
  const notch = 30 * u;
  const stub = tall ? { x: tk.x, y: tk.y, w: tk.w, h: tk.h * stubShare } : { x: tk.x, y: tk.y, w: tk.w * stubShare, h: tk.h };
  const main = tall ? { x: tk.x, y: tk.y + stub.h, w: tk.w, h: tk.h - stub.h } : { x: tk.x + stub.w, y: tk.y, w: tk.w - stub.w, h: tk.h };
  // Perforation: a dashed line with a notch cut at each end.
  if (tall) {
    add({ type: 'dash', name: 'Tear line', x: tk.x + notch * 1.5, y: main.y - 2 * u, w: tk.w - notch * 3, h: 4 * u, color: soft, opacity: 0.35 });
    add({ type: 'ellipse', name: 'Notch', x: tk.x - notch, y: main.y - notch, w: notch * 2, h: notch * 2, fill: pageBg });
    add({ type: 'ellipse', name: 'Notch', x: tk.x + tk.w - notch, y: main.y - notch, w: notch * 2, h: notch * 2, fill: pageBg });
  } else {
    add({ type: 'dash', name: 'Tear line', x: main.x - 2 * u, y: tk.y + notch * 1.5, w: 4 * u, h: tk.h - notch * 3, color: soft, opacity: 0.35 });
    add({ type: 'ellipse', name: 'Notch', x: main.x - notch, y: tk.y - notch, w: notch * 2, h: notch * 2, fill: pageBg });
    add({ type: 'ellipse', name: 'Notch', x: main.x - notch, y: tk.y + tk.h - notch, w: notch * 2, h: notch * 2, fill: pageBg });
  }
  const sp = 48 * u;
  let sy = stub.y + sp;
  if (spec.badge) sy += addChip(ctx, add, spec.badge, stub.x + sp, sy, 26 * u, accent, onAccent) + 26 * u;
  const sr = { x: stub.x + sp, y: sy, w: stub.w - sp * 2, h: stub.y + stub.h - sp - sy };
  const bigInk = dark ? GOLD : luminance(accent) > 0.55 ? INK : accent;
  if (spec.big) placeStack(add, stack(ctx, { big: spec.big }, sr, u, { fg: bigInk, big: bigInk }, { big: true, bigMax: tall ? 220 : 170 }), sr, 'center');
  const mr = { x: main.x + sp, y: main.y + sp, w: main.w - sp * 2, h: main.h - sp * 2 };
  placeStack(add, stack(ctx, { headline: spec.headline, body: spec.body, details: spec.details, cta: spec.cta }, mr, u, { fg: ink, muted: soft, dot: accent, chipBg: accent, chipFg: onAccent }, { headMax: wide ? 72 : 96, headShare: 0.45 }), mr, 'center');
  addFooter(ctx, add, spec, m, H - m + 10 * u, W - m * 2, u, t.bg === WHITE ? INK_SOFT : t.muted, null, 'center');
}

// ---- Soft, photo-led layouts ----

const clear = c => rgba(c, 0);

function layoutFade(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  add({ ...bgRect(W, H, t.bg), noGradient: true });
  const pad = 72 * u;
  const wide = isWide(W, H);
  let region;
  if (wide) {
    const pw = W * 0.6;
    add(photoLayer(photo, 0, 0, pw, H));
    add({ type: 'rect', name: 'Photo fade', x: pw * 0.42, y: 0, w: pw * 0.58 + 2, h: H, fill: t.bg, radius: 0, gradient: { kind: 'linear', angle: 90, stops: [[0, clear(t.bg)], [0.75, rgba(t.bg, 0.9)], [1, t.bg]] } });
    region = { x: W * 0.54, y: pad, w: W * 0.46 - pad, h: H - pad * 2 };
  } else {
    const ph = H * (isTall(W, H) ? 0.6 : 0.58);
    add(photoLayer(photo, 0, 0, W, ph));
    add({ type: 'rect', name: 'Photo fade', x: 0, y: ph * 0.38, w: W, h: ph * 0.62 + 2, fill: t.bg, radius: 0, gradient: { kind: 'linear', angle: 180, stops: [[0, clear(t.bg)], [0.7, rgba(t.bg, 0.86)], [1, t.bg]] } });
    region = { x: pad, y: ph * 0.7, w: W - pad * 2, h: H - ph * 0.7 - pad };
  }
  addLogo(add, logo, 44 * u, 44 * u, 54 * u * logoScale, true);
  addChip(ctx, add, spec.badge, (wide ? W * 0.6 : W) - 44 * u, 50 * u, 28 * u, t.chipBg, t.chipFg, true);
  const footerH = addFooter(ctx, add, spec, region.x, region.y + region.h, region.w, u, t.muted, t.line);
  const r = { ...region, h: region.h - footerH - 30 * u };
  placeStack(add, stack(ctx, spec, r, u, t, { headMax: wide ? 84 : 120, headShare: 0.55 }), r, 'bottom');
}

function layoutGlow(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const light = luminance(t.bg) > 0.6;
  add({ ...bgRect(W, H, t.bg), gradient: { kind: 'radial', cx: 0.85, cy: 0.08, r: 1.3, stops: [[0, t.grad[0]], [1, t.grad[1]]] } });
  add({ type: 'blob', name: 'Glow', role: 'backdrop', x: W * 0.3, y: -H * 0.22, w: W * 0.95, h: W * 0.95, color: light ? t.blobs[0] : shade(t.bg, 0.45), alpha: light ? 0.22 : 0.5 });
  add({ type: 'halftone', name: 'Halftone dots', role: 'backdrop', x: W * 0.45, y: H * 0.58, w: W * 0.75, h: W * 0.6, color: t.dots, alpha: light ? 0.25 : 0.22, spacing: 16 * u });
  const pad = 84 * u;
  const logoH = 58 * u * logoScale;
  const logoBox = addLogo(add, logo, pad, pad, logoH, !light);
  addChip(ctx, add, spec.badge, W - pad, pad + ((logoBox.h || logoH) - 28 * u * 2.1) / 2, 28 * u, t.chipBg, t.chipFg, true);
  const footerH = addFooter(ctx, add, spec, pad, H - pad, W - pad * 2, u, t.muted, null);
  const top = pad + (logoBox.h || logoH) + 60 * u;
  const wide = isWide(W, H);
  const region = { x: pad, y: top, w: (wide ? W * 0.7 : W) - pad * 2, h: H - top - footerH - pad - 30 * u };
  placeStack(add, stack(ctx, spec, region, u, t, { big: Boolean(spec.big), headMax: wide ? 100 : 140, headShare: 0.6, bigMax: 300 }), region, 'center');
}

function layoutArch(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  const light = luminance(t.bg) > 0.6;
  add(bgRect(W, H, t.bg));
  const pad = 72 * u;
  const tall = isTall(W, H);
  const wide = isWide(W, H);
  let arch;
  let region;
  if (tall) {
    const w = W * 0.7;
    arch = { x: (W - w) / 2, y: pad * 1.9, w, h: H * 0.42 };
    region = { x: pad, y: arch.y + arch.h + 60 * u, w: W - pad * 2 };
  } else {
    const w = wide ? W * 0.3 : W * 0.4;
    arch = { x: W - pad - w, y: wide ? pad * 0.7 : pad * 1.9, w, h: H - (wide ? pad * 1.4 : pad * 2.9) };
    region = { x: pad, y: pad * 1.9, w: arch.x - pad * 1.7 };
  }
  const halo = 22 * u;
  add({ type: 'rect', name: 'Arch outline', x: arch.x - halo, y: arch.y - halo, w: arch.w + halo * 2, h: arch.h + halo * 2, fill: light ? shade(t.accent, 0.88) : shade(t.bg, 0.14), radius: [arch.w / 2 + halo, arch.w / 2 + halo, 40 * u, 40 * u] });
  add({ ...photoLayer(photo, arch.x, arch.y, arch.w, arch.h), radius: [arch.w / 2, arch.w / 2, 24 * u, 24 * u] });
  addLogo(add, logo, pad, pad * 0.7, 50 * u * logoScale, !light);
  if (tall) addChip(ctx, add, spec.badge, W - pad, pad * 0.8, 26 * u, t.chipBg, t.chipFg, true);
  else if (spec.badge) region.y += addChip(ctx, add, spec.badge, region.x, region.y, 26 * u, t.chipBg, t.chipFg) + 30 * u;
  const footerH = addFooter(ctx, add, spec, region.x, H - pad * 0.8, tall ? region.w : region.w, u, t.muted, null);
  region.h = H - pad * 0.8 - footerH - 30 * u - region.y;
  placeStack(add, stack(ctx, spec, region, u, t, { headMax: wide ? 76 : 108, headShare: 0.55 }), region, tall ? 'top' : 'center');
}

function layoutMagazine(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  const scrim = luminance(t.bg) > 0.6 ? NIGHT : t.bg;
  add({ ...bgRect(W, H, scrim), noGradient: true });
  add(photoLayer(photo, 0, 0, W, H));
  add({ type: 'rect', name: 'Top shade', x: 0, y: 0, w: W, h: H * 0.52, fill: scrim, radius: 0, gradient: { kind: 'linear', angle: 180, stops: [[0, rgba(scrim, 0.9)], [0.55, rgba(scrim, 0.55)], [1, clear(scrim)]] } });
  add({ type: 'rect', name: 'Bottom shade', x: 0, y: H * 0.38, w: W, h: H * 0.62, fill: scrim, radius: 0, gradient: { kind: 'linear', angle: 180, stops: [[0, clear(scrim)], [0.5, rgba(scrim, 0.82)], [1, rgba(scrim, 0.96)]] } });
  const light = luminance(t.bg) > 0.6;
  const colors = { fg: WHITE, muted: WHITE, dot: light ? GOLD : t.dot, chipBg: light ? GOLD : t.chipBg, chipFg: light ? INK : t.chipFg };
  const pad = 70 * u;
  const wide = isWide(W, H);
  const logoBox = addLogo(add, logo, pad, pad * 0.8, 50 * u * logoScale, true);
  addChip(ctx, add, spec.badge, W - pad, pad * 0.8 + (logoBox.h - 26 * u * 2.1) / 2, 26 * u, colors.chipBg, colors.chipFg, true);
  const topR = { x: pad, y: pad * 0.8 + logoBox.h + 36 * u, w: (wide ? W * 0.7 : W) - pad * 2, h: H * (wide ? 0.42 : 0.3) };
  placeStack(add, stack(ctx, { headline: spec.headline, big: spec.big }, topR, u, colors, { headMax: wide ? 92 : 150, headShare: 1, big: Boolean(spec.big), bigMax: 200 }), topR, 'top');
  const footerH = addFooter(ctx, add, spec, pad, H - pad * 0.8, W - pad * 2, u, WHITE, 'rgba(255,255,255,0.25)');
  const bottom = { x: pad, y: H * 0.56, w: (wide ? W * 0.62 : W) - pad * 2, h: H * 0.44 - pad * 0.8 - footerH - 30 * u };
  placeStack(add, stack(ctx, { body: spec.body, details: spec.details, cta: spec.cta }, bottom, u, colors), bottom, 'bottom');
}

function layoutSide(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  add({ ...bgRect(W, H, t.bg), noGradient: true });
  add(photoLayer(photo, 0, 0, W, H));
  const tall = isTall(W, H);
  const pad = 72 * u;
  let region;
  if (tall) {
    add({ type: 'rect', name: 'Color fade', x: 0, y: H * 0.26, w: W, h: H * 0.74, fill: t.bg, radius: 0, gradient: { kind: 'linear', angle: 180, stops: [[0, clear(t.bg)], [0.4, rgba(t.bg, 0.94)], [1, t.bg]] } });
    region = { x: pad, y: H * 0.48, w: W - pad * 2, h: H * 0.52 - pad * 0.8 };
  } else {
    const fw = isWide(W, H) ? W * 0.74 : W * 0.84;
    add({ type: 'rect', name: 'Color fade', x: 0, y: 0, w: fw, h: H, fill: t.bg, radius: 0, gradient: { kind: 'linear', angle: 90, stops: [[0, t.bg], [0.55, rgba(t.bg, 0.94)], [1, clear(t.bg)]] } });
    region = { x: pad, y: pad * 2.1, w: fw * 0.62 - pad * 0.6, h: H - pad * 2.9 };
  }
  const logoBox = addLogo(add, logo, pad, pad * 0.8, 50 * u * logoScale, true);
  addChip(ctx, add, spec.badge, W - pad, pad * 0.8 + (logoBox.h - 26 * u * 2.1) / 2, 26 * u, t.chipBg, t.chipFg, true);
  const footerH = addFooter(ctx, add, spec, region.x, region.y + region.h, region.w, u, t.muted, t.line);
  const r = { ...region, h: region.h - footerH - 30 * u };
  placeStack(add, stack(ctx, spec, r, u, t, { headMax: tall ? 120 : 96, headShare: 0.55 }), r, tall ? 'bottom' : 'center');
}

function layoutCollage(c) {
  const { ctx, add, spec, W, H, u, t, logo, photos } = c;
  add(bgRect(W, H, t.bg));
  const pad = 40 * u;
  const gap = 16 * u;
  const r = 28 * u;
  const iw = W - pad * 2;
  const ih = H - pad * 2;
  const ratio = W / H;
  const g =
    ratio > 1.4
      ? { a: [0.5, 0, 0.5, 0.6], b: [0.5, 0.6, 0.25, 0.4], c: [0.75, 0.6, 0.25, 0.4], text: [0, 0, 0.47, 1] }
      : ratio > 0.9
        ? { a: [0, 0, 0.6, 0.56], b: [0.6, 0, 0.4, 0.28], c: [0.6, 0.28, 0.4, 0.28], text: [0, 0.58, 1, 0.42] }
        : { a: [0, 0, 1, 0.33], b: [0, 0.33, 0.5, 0.19], c: [0.5, 0.33, 0.5, 0.19], text: [0, 0.54, 1, 0.46] };
  const rect = ([fx, fy, fw, fh]) => ({
    x: pad + fx * iw + (fx > 0 ? gap / 2 : 0),
    y: pad + fy * ih + (fy > 0 ? gap / 2 : 0),
    w: fw * iw - (fx > 0 ? gap / 2 : 0) - (fx + fw < 0.999 ? gap / 2 : 0),
    h: fh * ih - (fy > 0 ? gap / 2 : 0) - (fy + fh < 0.999 ? gap / 2 : 0)
  });
  const A = rect(g.a);
  [A, rect(g.b), rect(g.c)].forEach((p, i) => add({ ...photoLayer(photos[i] || photos[0], p.x, p.y, p.w, p.h, r), name: i ? `Photo ${i + 1}` : 'Photo' }));
  addLogo(add, logo, A.x + 24 * u, A.y + 24 * u, 44 * u * logoScale, true);
  addChip(ctx, add, spec.badge, A.x + A.w - 24 * u, A.y + 28 * u, 24 * u, t.chipBg, t.chipFg, true);
  const tr = rect(g.text);
  const region = { x: tr.x + 28 * u, y: tr.y + 24 * u, w: tr.w - 56 * u, h: tr.h - 48 * u };
  const footerH = addFooter(ctx, add, spec, region.x, region.y + region.h, region.w, u, t.muted, t.line);
  const rr = { ...region, h: region.h - footerH - 26 * u };
  placeStack(add, stack(ctx, spec, rr, u, t, { headMax: ratio > 1.4 ? 80 : 104, headShare: 0.55 }), rr, 'center');
}

function layoutMinimal(c) {
  const { ctx, add, spec, W, H, u, t, logo, photo } = c;
  const light = luminance(t.bg) > 0.6;
  const accent = light || luminance(t.bg) < 0.12 ? t.accent : t.bg;
  add(bgRect(W, H, light ? t.bg : shade(accent, 0.94)));
  const colors = { fg: INK, muted: INK_SOFT, dot: accent, chipBg: accent, chipFg: on(accent) };
  const pad = 80 * u;
  const wide = isWide(W, H);
  const tall = isTall(W, H);
  add(courtAt(W * 0.9, H * 0.86, H * (wide ? 1 : 0.6), { color: rgba(accent, 0.12), lineWidth: 5 * u, rotation: 0.35 }));
  const logoBox = addLogo(add, logo, pad, pad, 48 * u * logoScale, false);
  const ps = wide ? H * 0.64 : W * (tall ? 0.5 : 0.38);
  const pbox = wide ? { x: W - pad - ps * 1.15, y: (H - ps) / 2, w: ps * 1.15, h: ps } : { x: W - pad - ps, y: pad, w: ps, h: ps * (tall ? 1.1 : 1) };
  add(photoLayer(photo, pbox.x, pbox.y, pbox.w, pbox.h, 28 * u));
  const region = wide
    ? { x: pad, y: pad + logoBox.h + 44 * u, w: pbox.x - pad * 1.6 }
    : { x: pad, y: pbox.y + pbox.h + 56 * u, w: W - pad * 2 };
  if (spec.badge) region.y += addChip(ctx, add, spec.badge, region.x, region.y, 24 * u, accent, on(accent)) + 28 * u;
  add({ type: 'rect', name: 'Accent line', x: region.x, y: region.y, w: 96 * u, h: 8 * u, fill: accent, radius: 4 * u });
  region.y += 40 * u;
  const footerH = addFooter(ctx, add, spec, region.x, H - pad, region.w, u, INK_SOFT, PAPER_LINE);
  region.h = H - pad - footerH - 30 * u - region.y;
  placeStack(add, stack(ctx, spec, region, u, colors, { headMax: wide ? 80 : 110, headShare: 0.55 }), region, 'top');
}

// ---- Vouchers, gift certificates, receipts ----

// Colors for white paper: ink text, plus an accent from the theme.
function paperColors(t) {
  const lum = luminance(t.bg);
  return { ink: INK, soft: INK_SOFT, accent: lum > 0.6 || lum < 0.12 ? t.accent : t.bg };
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

function layoutVoucher(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const pageBg = luminance(t.bg) > 0.6 ? '#eef0ee' : t.bg;
  add(bgRect(W, H, pageBg));
  const { ink, soft, accent } = paperColors(t);
  const m = 46 * u;
  const paper = { x: m, y: m, w: W - m * 2, h: H - m * 2 };
  add({ type: 'rect', name: 'Voucher', ...paper, fill: WHITE, radius: 30 * u });
  add({ type: 'rect', name: 'Dashed border', x: paper.x + 18 * u, y: paper.y + 18 * u, w: paper.w - 36 * u, h: paper.h - 36 * u, fill: null, radius: 20 * u, stroke: rgba(accent, 0.45), strokeWidth: 3 * u, dash: [14 * u, 10 * u] });
  const tall = H > W * 1.05;
  const notch = 28 * u;
  const stub = tall ? { x: paper.x, y: paper.y + paper.h * 0.72, w: paper.w, h: paper.h * 0.28 } : { x: paper.x + paper.w * 0.7, y: paper.y, w: paper.w * 0.3, h: paper.h };
  const main = tall ? { x: paper.x, y: paper.y, w: paper.w, h: paper.h * 0.72 } : { x: paper.x, y: paper.y, w: paper.w * 0.7, h: paper.h };
  add({ type: 'rect', name: 'Stub', ...stub, fill: rgba(accent, 0.07), radius: tall ? [0, 0, 30 * u, 30 * u] : [0, 30 * u, 30 * u, 0] });
  if (tall) {
    add({ type: 'dash', name: 'Tear line', x: paper.x + notch * 1.5, y: stub.y - 2 * u, w: paper.w - notch * 3, h: 4 * u, color: accent, opacity: 0.5 });
    for (const x of [paper.x - notch, paper.x + paper.w - notch]) add({ type: 'ellipse', name: 'Notch', x, y: stub.y - notch, w: notch * 2, h: notch * 2, fill: pageBg });
  } else {
    add({ type: 'dash', name: 'Tear line', x: stub.x - 2 * u, y: paper.y + notch * 1.5, w: 4 * u, h: paper.h - notch * 3, color: accent, opacity: 0.5 });
    for (const y of [paper.y - notch, paper.y + paper.h - notch]) add({ type: 'ellipse', name: 'Notch', x: stub.x - notch, y, w: notch * 2, h: notch * 2, fill: pageBg });
  }

  const p = 58 * u;
  const mr = { x: main.x + p, y: main.y + p, w: main.w - p * 2, h: main.h - p * 2 };
  const f = flow(mr.h, k => {
    const s = u * k;
    const logoH = 44 * s * logoScale;
    return [
      logo && { h: logoH + 26 * s, place: (a, y) => a({ type: 'image', name: 'Logo', src: logoSrc, x: mr.x, y, w: (logo.width / logo.height) * logoH, h: logoH, fit: 'contain', radius: 0 }) },
      spec.headline && textRow(ctx, { type: 'text', name: 'Title', text: spec.headline, x: mr.x, w: mr.w, size: fitText(ctx, spec.headline, { weight: 800, max: 54 * s, min: 24 * s, width: mr.w, height: 140 * s, lh: 1.08, tracking: -0.02 }), weight: 800, color: ink, lh: 1.08, tracking: -0.02, align: 'left' }),
      spec.big && gapRow(12 * s),
      spec.big && textRow(ctx, { type: 'text', name: 'Value', text: spec.big, x: mr.x, w: mr.w, size: fitText(ctx, spec.big, { weight: 800, max: 190 * s, min: 50 * s, width: mr.w, height: 220 * s, lh: 0.95, tracking: -0.04, maxLines: 1 }), weight: 800, color: accent, lh: 0.95, tracking: -0.04, align: 'left' }),
      spec.body && gapRow(18 * s),
      spec.body && textRow(ctx, { type: 'text', name: 'Description', text: spec.body, x: mr.x, w: mr.w, size: 30 * s, weight: 600, color: ink, lh: 1.35, tracking: 0, align: 'left' }),
      spec.details && gapRow(20 * s),
      spec.details && textRow(ctx, { type: 'text', name: 'Terms', text: spec.details.split('\n').filter(l => l.trim()).join('\n'), x: mr.x, w: mr.w, size: 22 * s, weight: 600, color: soft, lh: 1.3, tracking: 0, align: 'left', bullet: accent, paraGap: 6 * s })
    ];
  }, 1.35);
  f.place(add, mr.y + Math.max(0, (mr.h - f.total) / 2));

  const sp = 40 * u;
  const sr = { x: stub.x + sp, y: stub.y + sp, w: stub.w - sp * 2, h: stub.h - sp * 2 };
  const sf = flow(sr.h, k => {
    const s = u * k;
    return [
      textRow(ctx, { type: 'text', name: 'Code label', text: 'VOUCHER CODE', x: sr.x, w: sr.w, size: 20 * s, weight: 800, color: accent, lh: 1.2, tracking: 0.08, align: 'center' }),
      gapRow(12 * s),
      spec.badge && textRow(ctx, { type: 'text', name: 'Code', text: spec.badge, x: sr.x, w: sr.w, size: fitText(ctx, spec.badge, { weight: 800, max: 46 * s, min: 18 * s, width: sr.w, height: 60 * s, lh: 1.1, tracking: 0.06, maxLines: 2 }), weight: 800, color: ink, lh: 1.1, tracking: 0.06, align: 'center' }),
      spec.cta && gapRow(22 * s),
      spec.cta && textRow(ctx, { type: 'text', name: 'How to use', text: spec.cta, x: sr.x, w: sr.w, size: 22 * s, weight: 600, color: soft, lh: 1.3, tracking: 0, align: 'center' })
    ];
  }, 1.35);
  sf.place(add, sr.y + Math.max(0, (sr.h - sf.total) / 2));
  const b = Math.min(stub.w, stub.h) * 0.22;
  add({ type: 'deco', name: 'Record', kind: 'vinyl', x: stub.x + stub.w - b * 0.8, y: stub.y + stub.h - b * 0.8, w: b, h: b, rotation: 0.3, colors: [INK, GOLD], opacity: 0.9, clip: { ...stub, r: 30 * u } });
}

function layoutGiftcard(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const pageBg = luminance(t.bg) > 0.6 ? '#eef0ee' : t.bg;
  add(bgRect(W, H, pageBg));
  const { ink, soft, accent } = paperColors(t);
  const m = 40 * u;
  const paper = { x: m, y: m, w: W - m * 2, h: H - m * 2 };
  add({ type: 'rect', name: 'Certificate', ...paper, fill: WHITE, radius: 24 * u });
  add(courtAt(paper.x + paper.w * 0.9, paper.y + paper.h * 0.85, paper.h * 0.9, { color: rgba(accent, 0.07), lineWidth: 5 * u, rotation: 0.4, clip: { ...paper, r: 24 * u } }));
  add({ type: 'rect', name: 'Frame', x: paper.x + 22 * u, y: paper.y + 22 * u, w: paper.w - 44 * u, h: paper.h - 44 * u, fill: null, radius: 16 * u, stroke: accent, strokeWidth: 4 * u });
  add({ type: 'rect', name: 'Inner frame', x: paper.x + 36 * u, y: paper.y + 36 * u, w: paper.w - 72 * u, h: paper.h - 72 * u, fill: null, radius: 11 * u, stroke: rgba(accent, 0.35), strokeWidth: 2 * u });
  const inner = { x: paper.x + 76 * u, y: paper.y + 64 * u, w: paper.w - 152 * u, h: paper.h - 128 * u };
  const wide = isWide(W, H) || W / H > 1.3;
  const rows = String(spec.details || '').split('\n').map(s => s.trim()).filter(Boolean);
  const bottomH = 70 * u;
  const f = flow(inner.h - bottomH, k => {
    const s = u * k;
    const logoH = 50 * s * logoScale;
    const lw = logo ? (logo.width / logo.height) * logoH : 0;
    const chip = { type: 'chip', name: 'Label', text: 'Gift certificate', size: 22 * s, bg: accent, fg: on(accent), x: 0, y: 0 };
    const cw = pillBox(ctx, chip, true).w;
    const rowW = inner.w * (wide ? 0.62 : 0.86);
    const rowX = inner.x + (inner.w - rowW) / 2;
    const rs = 28 * s;
    return [
      logo && { h: logoH + 24 * s, place: (a, y) => a({ type: 'image', name: 'Logo', src: logoSrc, x: inner.x + (inner.w - lw) / 2, y, w: lw, h: logoH, fit: 'contain', radius: 0 }) },
      { h: chip.size * 2.1 + 26 * s, place: (a, y) => a({ ...chip, x: inner.x + (inner.w - cw) / 2, y }) },
      spec.headline && textRow(ctx, { type: 'text', name: 'Headline', text: spec.headline, x: inner.x, w: inner.w, size: fitText(ctx, spec.headline, { weight: 800, max: 60 * s, min: 26 * s, width: inner.w, height: 150 * s, lh: 1.08, tracking: -0.02 }), weight: 800, color: ink, lh: 1.08, tracking: -0.02, align: 'center' }),
      spec.big && gapRow(10 * s),
      spec.big && textRow(ctx, { type: 'text', name: 'Value', text: spec.big, x: inner.x, w: inner.w, size: fitText(ctx, spec.big, { weight: 800, max: 150 * s, min: 44 * s, width: inner.w, height: 170 * s, lh: 0.95, tracking: -0.04, maxLines: 1 }), weight: 800, color: accent, lh: 0.95, tracking: -0.04, align: 'center' }),
      spec.body && gapRow(18 * s),
      spec.body && textRow(ctx, { type: 'text', name: 'Message', text: spec.body, x: inner.x + inner.w * 0.08, w: inner.w * 0.84, size: 26 * s, weight: 500, color: soft, lh: 1.4, tracking: 0, align: 'center' }),
      rows.length && gapRow(24 * s),
      ...rows.map(row => {
        const i = row.indexOf(':');
        const label = i > 0 ? row.slice(0, i + 1) : row;
        const value = i > 0 ? row.slice(i + 1).trim() : '';
        const h = rs * 2.1;
        return {
          h,
          place: (a, y) => {
            setFont(ctx, 800, rs);
            const lwid = ctx.measureText(label + ' ').width;
            a({ type: 'text', name: 'Field label', text: label, x: rowX, y: y + rs * 0.4, w: lwid + 4, size: rs, weight: 800, color: ink, lh: 1.2, tracking: 0, align: 'left' });
            if (value) a({ type: 'text', name: 'Field', text: value, x: rowX + lwid + 8 * s, y: y + rs * 0.4, w: rowW - lwid - 8 * s, size: rs, weight: 600, color: ink, lh: 1.2, tracking: 0, align: 'left' });
            a({ type: 'rect', name: 'Field line', x: rowX + lwid, y: y + rs * 1.75, w: rowW - lwid, h: Math.max(1, 2 * s), fill: rgba(accent, 0.4), radius: 0 });
          }
        };
      })
    ];
  }, 1.6);
  f.place(add, inner.y + Math.max(0, (inner.h - bottomH - f.total) / 2));
  // Bottom row: validity, signature line, certificate number.
  const by = inner.y + inner.h - bottomH;
  const col = inner.w / 3;
  const small = 20 * u;
  if (spec.cta) add({ type: 'text', name: 'Validity', text: spec.cta, x: inner.x, y: by + 24 * u, w: col - 10 * u, size: small, weight: 700, color: soft, lh: 1.3, tracking: 0, align: 'left' });
  add({ type: 'rect', name: 'Signature line', x: inner.x + col + 20 * u, y: by + 22 * u, w: col - 40 * u, h: Math.max(1, 2 * u), fill: rgba(INK, 0.5), radius: 0 });
  add({ type: 'text', name: 'Signature label', text: 'Authorized signature', x: inner.x + col, y: by + 32 * u, w: col, size: small * 0.9, weight: 600, color: soft, lh: 1.3, tracking: 0, align: 'center' });
  if (spec.badge) add({ type: 'text', name: 'Certificate number', text: spec.badge, x: inner.x + col * 2 + 10 * u, y: by + 24 * u, w: col - 10 * u, size: small, weight: 800, color: ink, lh: 1.3, tracking: 0.04, align: 'right' });
}

function layoutReceipt(c) {
  const { ctx, add, spec, W, H, u, t, logo } = c;
  const pageBg = luminance(t.bg) > 0.6 ? '#eef0ee' : t.bg;
  add(bgRect(W, H, pageBg));
  const { ink, soft, accent } = paperColors(t);
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
      .map(row => {
        const i = row.indexOf(': ');
        return i > 0 ? [row.slice(0, i), row.slice(i + 2)] : [row, ''];
      });
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
  const rule = s => ({ h: 44 * s, place: (a, y) => a({ type: 'dash', name: 'Divider', x: inner.x, y: y + 20 * s, w: inner.w, h: Math.max(2, 3 * s), color: '#b7bec9' }) });
  const phones = phoneContacts().map(x => displayPhone(x.phone)).join('  ·  ');
  const f = flow(inner.h, k => {
    const s = u * k;
    const logoH = 54 * s * logoScale;
    const lw = logo ? (logo.width / logo.height) * logoH : 0;
    const total = spec.big
      ? {
          h: 70 * s,
          place: (a, y) => {
            a({ type: 'text', name: 'Total label', text: 'Total', x: inner.x, y: y + 16 * s, w: inner.w * 0.4, size: 34 * s, weight: 800, color: ink, lh: 1.2, tracking: 0, align: 'left' });
            a({ type: 'text', name: 'Total', text: spec.big, x: inner.x + inner.w * 0.3, y, w: inner.w * 0.7, size: fitText(ctx, spec.big, { weight: 800, max: 58 * s, min: 28 * s, width: inner.w * 0.7, height: 70 * s, lh: 1.1, tracking: -0.02, maxLines: 1 }), weight: 800, color: accent, lh: 1.1, tracking: -0.02, align: 'right' });
          }
        }
      : null;
    return [
      logo && { h: logoH + 18 * s, place: (a, y) => a({ type: 'image', name: 'Logo', src: logoSrc, x: inner.x + (inner.w - lw) / 2, y, w: lw, h: logoH, fit: 'contain', radius: 0 }) },
      textRow(ctx, { type: 'text', name: 'Business details', text: [ADDRESS.join(', '), phones, SITE_DOMAIN].filter(Boolean).join('\n'), x: inner.x, w: inner.w, size: 20 * s, weight: 600, color: soft, lh: 1.45, tracking: 0, align: 'center' }),
      rule(s),
      spec.headline && textRow(ctx, { type: 'text', name: 'Title', text: spec.headline, x: inner.x, w: inner.w, size: fitText(ctx, spec.headline, { weight: 800, max: 46 * s, min: 24 * s, width: inner.w, height: 110 * s, lh: 1.1, tracking: -0.02 }), weight: 800, color: ink, lh: 1.1, tracking: -0.02, align: 'center' }),
      spec.badge && gapRow(8 * s),
      spec.badge && textRow(ctx, { type: 'text', name: 'Receipt number', text: spec.badge, x: inner.x, w: inner.w, size: 22 * s, weight: 700, color: soft, lh: 1.3, tracking: 0.04, align: 'center' }),
      gapRow(22 * s),
      ...rowsOf(pairs(spec.body), s, 22 * s, 600, 700, soft, ink, 'Detail'),
      rule(s),
      ...rowsOf(pairs(spec.details), s, 27 * s, 600, 700, ink, ink, 'Item'),
      spec.details && rule(s),
      total,
      spec.cta && gapRow(14 * s),
      spec.cta && textRow(ctx, { type: 'text', name: 'Payment', text: spec.cta, x: inner.x, w: inner.w, size: 23 * s, weight: 700, color: accent, lh: 1.3, tracking: 0, align: 'center' }),
      rule(s),
      textRow(ctx, { type: 'text', name: 'Thank you', text: 'Thank you for recording with us.', x: inner.x, w: inner.w, size: 28 * s, weight: 800, color: ink, lh: 1.2, tracking: -0.01, align: 'center' }),
      gapRow(10 * s),
      textRow(ctx, { type: 'text', name: 'Note', text: 'This is an acknowledgement receipt, not an official receipt.', x: inner.x, w: inner.w, size: 17 * s, weight: 600, color: soft, lh: 1.35, tracking: 0, align: 'center' })
    ];
  }, 1.2);
  // Like a real slip, the paper is only as long as what is printed on it.
  const paperH = Math.min(maxPaper.h, f.total + p * 2);
  const paperY = (H - paperH) / 2;
  add({ type: 'rect', name: 'Receipt paper', x: maxPaper.x, y: paperY, w: maxPaper.w, h: paperH, fill: WHITE, radius: 0, zigzag: 16 * u });
  f.place(add, paperY + p);
}

// ---- Backgrounds and decorations, applied after a layout is built ----

export const BG_STYLES = [
  { id: 'site', label: 'Blobs and dots' },
  { id: 'blobs', label: 'Soft blobs' },
  { id: 'halftone', label: 'Halftone dots' },
  { id: 'gradient', label: 'Soft gradient' },
  { id: 'glow', label: 'Glow' },
  { id: 'flat', label: 'Flat' }
];

function applyBackground(layers, spec, t, W, H, u) {
  const style = spec.bg || 'site';
  if (style === 'flat') return;
  const bgIndex = layers.findIndex(l => l.role === 'background');
  const bg = layers[bgIndex];
  if (!bg) return;
  const light = luminance(bg.fill) > 0.6;
  const soft = style === 'gradient' || style === 'glow';
  if (soft && !bg.gradient && !bg.noGradient) {
    const [a, b] = light ? [bg.fill, shade(t.blobs[0], 0.82)] : bg.fill === t.bg ? t.grad : [shade(bg.fill, 0.06), shade(bg.fill, -0.25)];
    bg.gradient = style === 'glow' ? { kind: 'radial', cx: 0.18, cy: 0.1, r: 1.3, stops: [[0, a], [1, b]] } : { kind: 'linear', angle: 160, stops: [[0, a], [1, b]] };
  }
  const M = Math.max(W, H);
  const alpha = light ? 0.16 : 0.42;
  const extra = [];
  if (style !== 'halftone') {
    extra.push({ type: 'blob', name: 'Soft blob', role: 'backdrop', x: W - M * 0.5, y: -M * 0.22, w: M * 0.72, h: M * 0.72, color: t.blobs[0], alpha });
    if (style !== 'gradient') extra.push({ type: 'blob', name: 'Soft blob', role: 'backdrop', x: -M * 0.2, y: H - M * 0.42, w: M * 0.62, h: M * 0.62, color: t.blobs[1], alpha: alpha * 0.9 });
  }
  if (style === 'site' || style === 'halftone' || style === 'glow') {
    const dotAlpha = light ? 0.22 : 0.2;
    extra.push({ type: 'halftone', name: 'Halftone dots', role: 'backdrop', x: -W * 0.12, y: -H * 0.08, w: W * 0.62, h: W * 0.5, color: t.dots, alpha: dotAlpha, spacing: 16 * u });
    extra.push({ type: 'halftone', name: 'Halftone dots', role: 'backdrop', x: W * 0.52, y: H - W * 0.42, w: W * 0.62, h: W * 0.5, color: light ? t.blobs[1] : t.dots, alpha: dotAlpha, spacing: 16 * u });
  }
  // Colored panels and white cards get their own corner blobs, like the site's cards.
  const out = [];
  layers.forEach((l, i) => {
    out.push(l);
    if (i === bgIndex) out.push(...extra);
    if (l.panel && l.type === 'rect') {
      if (soft) l.gradient = { kind: 'linear', angle: 160, stops: [[0, shade(l.fill, 0.05)], [1, shade(l.fill, -0.25)]] };
      out.push({ type: 'blob', name: 'Tile blob', role: 'backdrop', x: l.x + l.w * 0.4, y: l.y - l.h * 0.35, w: l.w * 0.85, h: l.w * 0.85, color: shade(l.fill, 0.4), alpha: 0.45, clip: { x: l.x, y: l.y, w: l.w, h: l.h, r: l.radius } });
    }
    if (l.card && l.type === 'rect') {
      const lightCard = luminance(l.fill) > 0.6;
      out.push({ type: 'blob', name: 'Tile blob', role: 'backdrop', x: l.x + l.w * 0.45, y: l.y - l.h * 0.35, w: l.w * 0.8, h: l.w * 0.8, color: GOLD, alpha: lightCard ? 0.16 : 0.22, clip: { x: l.x, y: l.y, w: l.w, h: l.h, r: l.radius } });
      out.push({ type: 'blob', name: 'Tile blob', role: 'backdrop', x: l.x - l.w * 0.2, y: l.y + l.h * 0.55, w: l.w * 0.65, h: l.w * 0.65, color: TEAL, alpha: lightCard ? 0.12 : 0.16, clip: { x: l.x, y: l.y, w: l.w, h: l.h, r: l.radius } });
    }
  });
  layers.splice(0, layers.length, ...out);
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
  field: layoutField,
  stat: layoutField,
  photo: layoutPhoto,
  split: layoutSplit,
  fade: layoutFade,
  glow: layoutGlow,
  arch: layoutArch,
  magazine: layoutMagazine,
  side: layoutSide,
  collage: layoutCollage,
  minimal: layoutMinimal,
  voucher: layoutVoucher,
  giftcard: layoutGiftcard,
  receipt: layoutReceipt,
  frame: layoutFrame,
  center: layoutCenter,
  bento: layoutBento,
  schedule: layoutSchedule,
  ticket: layoutTicket
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
  const format = FORMATS.find(f => f.id === spec.format) || FORMATS[0];
  const { w: W, h: fullH } = format;
  const { layers, add } = builder();
  const fn = LAYOUT_FNS[spec.layout] || layoutField;
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
  logoPlate = (spec.logoStyle || 'color') === 'color' && luminance(t.bg) > 0.5;
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
  const photoSrc = PHOTO_LAYOUTS.has(spec.layout) ? photoSrcOf(spec, PHOTOS, thumb) : null;
  // The collage uses two more studio photos after the chosen one.
  let photos = null;
  if (spec.layout === 'collage') {
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
