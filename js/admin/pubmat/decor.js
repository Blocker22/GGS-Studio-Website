// Decorations for social graphics: soft background blobs, halftone dot
// clouds, stickers (records, mics, lanterns, balloons...), and scattered
// confetti. Ported from the Manson Pickleball pubmat maker; the court and
// paddle stickers became studio ones.
//
// Stickers are crisp vector shapes drawn on the canvas. Each occasion also has
// its own palette, so a Chinese New Year post is red and gold and a Halloween
// post is purple and orange.

// ---- Color helpers ----

export function parseColor(c) {
  if (typeof c !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(s => parseFloat(s));
    return { r, g, b, a };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export const rgba = (c, a) => {
  const p = parseColor(c);
  return `rgba(${p.r},${p.g},${p.b},${a})`;
};

// amt > 0 mixes toward white, amt < 0 toward black.
export function shade(c, amt) {
  const p = parseColor(c);
  const t = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  const mix = v => Math.round(v + (t - v) * k);
  const hex = v => v.toString(16).padStart(2, '0');
  return `#${hex(mix(p.r))}${hex(mix(p.g))}${hex(mix(p.b))}`;
}

export const luminance = c => {
  const p = parseColor(c);
  return (0.299 * p.r + 0.587 * p.g + 0.114 * p.b) / 255;
};

// Small seeded random generator, so a design always decorates the same way
// until someone presses Shuffle.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashString = s => [...String(s)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

// ---- Occasion palettes ----
// Same shape as the base themes in render.js. Text on color fields stays white.

export const OCCASION_THEMES = {
  cny: { bg: '#b3121f', fg: '#ffffff', muted: '#ffe9b8', line: 'rgba(245,197,66,0.24)', chipBg: '#f5c542', chipFg: '#7a0d14', dot: '#f5c542', accent: '#b3121f', grad: ['#d11a2d', '#8a0c17'], blobs: ['#f5c542', '#ff5a5f'], dots: '#f5c542' },
  halloween: { bg: '#1c1029', fg: '#ffffff', muted: '#e6d6f5', line: 'rgba(242,140,40,0.2)', chipBg: '#f28c28', chipFg: '#1c1029', dot: '#f28c28', accent: '#f28c28', grad: ['#34184d', '#110a19'], blobs: ['#7b3fb0', '#f28c28'], dots: '#b07ae0' },
  christmas: { bg: '#1b5a34', fg: '#ffffff', muted: '#e3f2e7', line: 'rgba(255,255,255,0.16)', chipBg: '#c62828', chipFg: '#ffffff', dot: '#f5c542', accent: '#c62828', grad: ['#23703f', '#103822'], blobs: ['#4caf6a', '#c62828'], dots: '#ffffff' },
  valentines: { bg: '#c2185b', fg: '#ffffff', muted: '#ffe1ec', line: 'rgba(255,255,255,0.18)', chipBg: '#ffffff', chipFg: '#c2185b', dot: '#ffd1e0', accent: '#c2185b', grad: ['#dd2a6e', '#8c0f40'], blobs: ['#ff8fb3', '#7a0a36'], dots: '#ffd1e0' },
  mothers: { bg: '#fdeef3', fg: '#14181f', muted: '#3a414c', line: 'rgba(216,27,96,0.12)', chipBg: '#d81b60', chipFg: '#ffffff', dot: '#d81b60', accent: '#d81b60', grad: ['#fff6f9', '#f9d5e3'], blobs: ['#f48fb1', '#ce93d8'], dots: '#f06292' },
  fathers: { bg: '#17325e', fg: '#ffffff', muted: '#dbe6f7', line: 'rgba(255,255,255,0.14)', chipBg: '#f5c542', chipFg: '#17325e', dot: '#f5c542', accent: '#17325e', grad: ['#21457f', '#0d1f3d'], blobs: ['#4a78c2', '#f5c542'], dots: '#8fb1e8' },
  newyear: { bg: '#0b0f16', fg: '#ffffff', muted: '#e8dcb5', line: 'rgba(245,197,66,0.18)', chipBg: '#f5c542', chipFg: '#0b0f16', dot: '#f5c542', accent: '#d4a72c', grad: ['#1c2542', '#06080d'], blobs: ['#f5c542', '#3b4f8a'], dots: '#f5c542' },
  ph: { bg: '#0038a8', fg: '#ffffff', muted: '#ffffff', line: 'rgba(252,209,22,0.2)', chipBg: '#fcd116', chipFg: '#0038a8', dot: '#fcd116', accent: '#ce1126', grad: ['#0a4ac4', '#002a7f'], blobs: ['#ce1126', '#fcd116'], dots: '#ffffff' },
  fiesta: { bg: '#c2410c', fg: '#ffffff', muted: '#fff1d6', line: 'rgba(253,216,53,0.22)', chipBg: '#fdd835', chipFg: '#5a1a00', dot: '#fdd835', accent: '#c2410c', grad: ['#e0561a', '#8f2a05'], blobs: ['#fdd835', '#e53935'], dots: '#fdd835' },
  candles: { bg: '#15110d', fg: '#ffffff', muted: '#eadcc2', line: 'rgba(224,178,90,0.18)', chipBg: '#e0b25a', chipFg: '#15110d', dot: '#e0b25a', accent: '#b98a33', grad: ['#2c2219', '#0b0907'], blobs: ['#e0b25a', '#6b4a22'], dots: '#e0b25a' }
};

// ---- Sticker shapes ----
// Each draws inside a local box (0, 0, w, h). `ratio` is width / height.

const TAU = Math.PI * 2;

function ellipse(ctx, cx, cy, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

function starPath(ctx, cx, cy, outer, inner, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function heartPath(ctx, w, h) {
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.92);
  ctx.bezierCurveTo(-w * 0.12, h * 0.52, w * 0.04, h * 0.02, w / 2, h * 0.26);
  ctx.bezierCurveTo(w * 0.96, h * 0.02, w * 1.12, h * 0.52, w / 2, h * 0.92);
  ctx.closePath();
}

function sparklePath(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.quadraticCurveTo(cx + w * 0.07, cy - h * 0.07, w, cy);
  ctx.quadraticCurveTo(cx + w * 0.07, cy + h * 0.07, cx, h);
  ctx.quadraticCurveTo(cx - w * 0.07, cy + h * 0.07, 0, cy);
  ctx.quadraticCurveTo(cx - w * 0.07, cy - h * 0.07, cx, 0);
  ctx.closePath();
}

function flowerAt(ctx, cx, cy, r, petal, center) {
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5 - Math.PI / 2;
    ellipse(ctx, cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.36, r * 0.52, a + Math.PI / 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ellipse(ctx, cx, cy, r * 0.28, r * 0.28);
  ctx.fill();
}

export const STICKERS = {
  lantern: {
    label: 'Lantern', ratio: 0.56, hang: true, colors: ['#d7192d', '#f5c542'],
    draw(ctx, w, h, [body, gold]) {
      const cx = w / 2;
      const str = h * 0.22;
      const top = str + h * 0.055;
      const bh = h * 0.5;
      ctx.strokeStyle = gold;
      ctx.lineWidth = w * 0.03;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, str);
      ctx.stroke();
      ctx.fillStyle = rgba(gold, 0.18);
      ellipse(ctx, cx, top + bh / 2, w * 0.62, bh * 0.66);
      ctx.fill();
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.roundRect(cx - w * 0.22, str, w * 0.44, h * 0.065, w * 0.03);
      ctx.fill();
      ctx.fillStyle = body;
      ellipse(ctx, cx, top + bh / 2, w * 0.48, bh / 2);
      ctx.fill();
      ctx.strokeStyle = rgba(gold, 0.7);
      ctx.lineWidth = w * 0.022;
      for (const k of [0.28, 0.62]) {
        ellipse(ctx, cx, top + bh / 2, w * 0.48 * k, bh / 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, top + bh);
      ctx.stroke();
      ctx.fillStyle = gold;
      const capY = top + bh - h * 0.01;
      ctx.beginPath();
      ctx.roundRect(cx - w * 0.22, capY, w * 0.44, h * 0.065, w * 0.03);
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = w * 0.024;
      ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * w * 0.035, capY + h * 0.06);
        ctx.lineTo(cx + i * w * 0.055, h * 0.99);
        ctx.stroke();
      }
    }
  },
  balloon: {
    label: 'Balloon', ratio: 0.6, colors: ['#e5358c', '#ffffff'],
    draw(ctx, w, h, [body, string]) {
      const cx = w / 2;
      ctx.strokeStyle = rgba(string, 0.8);
      ctx.lineWidth = w * 0.02;
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.66);
      ctx.quadraticCurveTo(cx + w * 0.34, h * 0.82, cx - w * 0.04, h);
      ctx.stroke();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.62);
      ctx.lineTo(cx - w * 0.07, h * 0.67);
      ctx.lineTo(cx + w * 0.07, h * 0.67);
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, cx, h * 0.32, w * 0.46, h * 0.31);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ellipse(ctx, cx - w * 0.17, h * 0.19, w * 0.09, h * 0.065, -0.6);
      ctx.fill();
    }
  },
  star: {
    label: 'Star', ratio: 1, colors: ['#f5c542'],
    draw(ctx, w, h, [c]) {
      ctx.fillStyle = c;
      starPath(ctx, w / 2, h * 0.53, w / 2, w * 0.21);
      ctx.fill();
    }
  },
  sparkle: {
    label: 'Sparkle', ratio: 1, colors: ['#ffffff'],
    draw(ctx, w, h, [c]) {
      ctx.fillStyle = c;
      sparklePath(ctx, w, h);
      ctx.fill();
    }
  },
  heart: {
    label: 'Heart', ratio: 1.05, colors: ['#ff4d7d'],
    draw(ctx, w, h, [c]) {
      ctx.fillStyle = c;
      heartPath(ctx, w, h);
      ctx.fill();
    }
  },
  snowflake: {
    label: 'Snowflake', ratio: 1, colors: ['#ffffff'],
    draw(ctx, w, h, [c]) {
      const cx = w / 2;
      const cy = h / 2;
      const r = w * 0.46;
      ctx.strokeStyle = c;
      ctx.lineWidth = w * 0.06;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * r, cy + dy * r);
        for (const t of [0.5, 0.78]) {
          const bx = cx + dx * r * t;
          const by = cy + dy * r * t;
          for (const s of [-1, 1]) {
            const b = a + s * 0.8;
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(b) * r * 0.24, by + Math.sin(b) * r * 0.24);
          }
        }
        ctx.stroke();
      }
    }
  },
  pumpkin: {
    label: 'Pumpkin', ratio: 1.22, colors: ['#f28c28', '#4e7a2a'],
    draw(ctx, w, h, [body, stem]) {
      const cy = h * 0.6;
      const rib = shade(body, -0.28);
      ctx.fillStyle = stem;
      ctx.beginPath();
      ctx.roundRect(w * 0.46, h * 0.1, w * 0.08, h * 0.2, w * 0.03);
      ctx.fill();
      ellipse(ctx, w * 0.6, h * 0.16, w * 0.1, h * 0.045, -0.5);
      ctx.fill();
      ctx.lineWidth = w * 0.018;
      ctx.strokeStyle = rib;
      for (const [x, rx] of [[0.28, 0.24], [0.72, 0.24], [0.5, 0.25]]) {
        ctx.fillStyle = body;
        ellipse(ctx, w * x, cy, w * rx, h * 0.36);
        ctx.fill();
        ctx.stroke();
      }
      // A friendly jack-o'-lantern face.
      ctx.fillStyle = rgba('#2b1608', 0.88);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + s * w * 0.16, cy - h * 0.14);
        ctx.lineTo(w / 2 + s * w * 0.07, cy - h * 0.02);
        ctx.lineTo(w / 2 + s * w * 0.24, cy - h * 0.02);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(w * 0.3, cy + h * 0.08);
      const teeth = 5;
      for (let i = 1; i <= teeth; i++) ctx.lineTo(w * (0.3 + (0.4 * i) / teeth), cy + h * (i % 2 ? 0.14 : 0.08));
      ctx.quadraticCurveTo(w / 2, cy + h * 0.3, w * 0.3, cy + h * 0.08);
      ctx.fill();
    }
  },
  bat: {
    label: 'Bat', ratio: 2.2, colors: ['#0d0714'],
    draw(ctx, w, h, [c]) {
      const cx = w / 2;
      ctx.fillStyle = c;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(cx, h * 0.38);
        ctx.quadraticCurveTo(cx + s * w * 0.2, h * 0.02, cx + s * w * 0.5, h * 0.12);
        ctx.quadraticCurveTo(cx + s * w * 0.4, h * 0.45, cx + s * w * 0.37, h * 0.8);
        ctx.quadraticCurveTo(cx + s * w * 0.3, h * 0.58, cx + s * w * 0.22, h * 0.74);
        ctx.quadraticCurveTo(cx + s * w * 0.16, h * 0.54, cx + s * w * 0.09, h * 0.72);
        ctx.quadraticCurveTo(cx + s * w * 0.05, h * 0.56, cx, h * 0.64);
      }
      ctx.fill();
      ellipse(ctx, cx, h * 0.46, w * 0.065, h * 0.26);
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * w * 0.018, h * 0.26);
        ctx.lineTo(cx + s * w * 0.05, h * 0.1);
        ctx.lineTo(cx + s * w * 0.06, h * 0.3);
        ctx.fill();
      }
    }
  },
  moon: {
    label: 'Moon', ratio: 1, colors: ['#fdf1c7'],
    draw(ctx, w, h, [c]) {
      const r = w * 0.46;
      ctx.fillStyle = rgba(c, 0.18);
      ellipse(ctx, w / 2, h / 2, r * 1.08, r * 1.08);
      ctx.fill();
      ctx.save();
      ellipse(ctx, w / 2, h / 2, r, r);
      ctx.clip();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(w / 2 + r * 0.46, h / 2 - r * 0.22, r * 0.86, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.restore();
    }
  },
  web: {
    label: 'Cobweb', ratio: 1, corner: true, colors: ['#ffffff'],
    draw(ctx, w, h, [c]) {
      ctx.strokeStyle = rgba(c, 0.55);
      ctx.lineWidth = Math.max(1, w * 0.008);
      const n = 6;
      const angles = Array.from({ length: n }, (_, i) => (i / (n - 1)) * (Math.PI / 2));
      for (const a of angles) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * w * 1.05, Math.sin(a) * h * 1.05);
        ctx.stroke();
      }
      for (let k = 1; k <= 5; k++) {
        const r = (k / 5) * w * 0.95;
        ctx.beginPath();
        angles.forEach((a, i) => {
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (!i) ctx.moveTo(x, y);
          else {
            const m = (a + angles[i - 1]) / 2;
            ctx.quadraticCurveTo(Math.cos(m) * r * 0.86, Math.sin(m) * r * 0.86, x, y);
          }
        });
        ctx.stroke();
      }
    }
  },
  ornament: {
    label: 'Ornament', ratio: 0.52, hang: true, colors: ['#c62828', '#f5c542'],
    draw(ctx, w, h, [ball, gold]) {
      const cx = w / 2;
      const r = w * 0.46;
      const capY = h - r * 2 - h * 0.075;
      ctx.strokeStyle = gold;
      ctx.lineWidth = w * 0.025;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, capY);
      ctx.stroke();
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.roundRect(cx - w * 0.13, capY, w * 0.26, h * 0.075, w * 0.02);
      ctx.fill();
      const cy = h - r;
      ctx.fillStyle = ball;
      ellipse(ctx, cx, cy, r, r);
      ctx.fill();
      ctx.save();
      ellipse(ctx, cx, cy, r, r);
      ctx.clip();
      ctx.fillStyle = rgba(gold, 0.85);
      ctx.fillRect(0, cy - r * 0.12, w, r * 0.24);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ellipse(ctx, cx - r * 0.38, cy - r * 0.4, r * 0.22, r * 0.14, -0.6);
      ctx.fill();
      ctx.restore();
    }
  },
  holly: {
    label: 'Holly', ratio: 1.4, colors: ['#2e7d32', '#d32f2f'],
    draw(ctx, w, h, [leaf, berry]) {
      const cx = w / 2;
      const cy = h * 0.52;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s * 0.35 + (s < 0 ? Math.PI : 0));
        const L = w * 0.46;
        const W = h * 0.3;
        ctx.fillStyle = leaf;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let i = 1; i <= 5; i++) ctx.lineTo((L * i) / 5.4, -W * (i % 2 ? 1 : 0.55) * Math.sin((Math.PI * i) / 6));
        ctx.lineTo(L, 0);
        for (let i = 5; i >= 1; i--) ctx.lineTo((L * i) / 5.4, W * (i % 2 ? 1 : 0.55) * Math.sin((Math.PI * i) / 6));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = shade(leaf, 0.3);
        ctx.lineWidth = w * 0.012;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(L * 0.92, 0);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = berry;
      for (const [dx, dy] of [[-0.06, -0.1], [0.06, -0.08], [0, 0.05]]) {
        ellipse(ctx, cx + dx * w, cy + dy * h, w * 0.07, w * 0.07);
        ctx.fill();
      }
    }
  },
  gift: {
    label: 'Gift', ratio: 1, colors: ['#ffd558', '#f5c542'],
    draw(ctx, w, h, [box, ribbon]) {
      const cx = w / 2;
      ctx.fillStyle = box;
      ctx.fillRect(w * 0.08, h * 0.38, w * 0.84, h * 0.6);
      ctx.fillStyle = shade(box, -0.15);
      ctx.fillRect(0, h * 0.27, w, h * 0.14);
      ctx.fillStyle = ribbon;
      ctx.fillRect(cx - w * 0.07, h * 0.27, w * 0.14, h * 0.71);
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = w * 0.06;
      for (const s of [-1, 1]) {
        ellipse(ctx, cx + s * w * 0.15, h * 0.18, w * 0.15, h * 0.08, s * 0.35);
        ctx.stroke();
      }
    }
  },
  firework: {
    label: 'Firework', ratio: 1, colors: ['#f5c542', '#ffffff'],
    draw(ctx, w, h, [a, b]) {
      const cx = w / 2;
      const cy = h / 2;
      const n = 16;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const ang = (i * TAU) / n;
        const c = i % 2 ? b : a;
        const r1 = w * (i % 2 ? 0.16 : 0.12);
        const r2 = w * (i % 2 ? 0.38 : 0.46);
        ctx.strokeStyle = c;
        ctx.lineWidth = w * 0.026;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        ctx.stroke();
        ctx.fillStyle = c;
        ellipse(ctx, cx + Math.cos(ang) * (r2 + w * 0.035), cy + Math.sin(ang) * (r2 + w * 0.035), w * 0.022, w * 0.022);
        ctx.fill();
      }
    }
  },
  candle: {
    label: 'Candle', ratio: 0.32, colors: ['#f4ead5', '#ffb347'],
    draw(ctx, w, h, [wax, flame]) {
      const cx = w / 2;
      const g = ctx.createRadialGradient(cx, h * 0.17, 0, cx, h * 0.17, w * 1.4);
      g.addColorStop(0, rgba(flame, 0.45));
      g.addColorStop(1, rgba(flame, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - w * 1.4, h * 0.17 - w * 1.4, w * 2.8, w * 2.8);
      ctx.fillStyle = wax;
      ctx.beginPath();
      ctx.roundRect(w * 0.14, h * 0.34, w * 0.72, h * 0.66, w * 0.1);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(w * 0.22, h * 0.38, w * 0.1, h * 0.58);
      ctx.strokeStyle = '#3b2b1a';
      ctx.lineWidth = w * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.34);
      ctx.lineTo(cx, h * 0.28);
      ctx.stroke();
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.02);
      ctx.quadraticCurveTo(cx + w * 0.34, h * 0.2, cx, h * 0.3);
      ctx.quadraticCurveTo(cx - w * 0.34, h * 0.2, cx, h * 0.02);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ellipse(ctx, cx, h * 0.22, w * 0.1, h * 0.05);
      ctx.fill();
    }
  },
  trophy: {
    label: 'Trophy', ratio: 0.86, colors: ['#f5c542'],
    draw(ctx, w, h, [gold]) {
      const dark = shade(gold, -0.2);
      ctx.strokeStyle = gold;
      ctx.lineWidth = w * 0.06;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w / 2 + s * w * 0.33, h * 0.2, w * 0.13, s < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, s < 0 ? Math.PI * 1.5 : Math.PI * 0.5, s > 0);
        ctx.stroke();
      }
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.moveTo(w * 0.18, h * 0.04);
      ctx.lineTo(w * 0.82, h * 0.04);
      ctx.lineTo(w * 0.77, h * 0.38);
      ctx.quadraticCurveTo(w * 0.5, h * 0.64, w * 0.23, h * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(w * 0.44, h * 0.52, w * 0.12, h * 0.22);
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.roundRect(w * 0.28, h * 0.72, w * 0.44, h * 0.09, w * 0.02);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(w * 0.18, h * 0.83, w * 0.64, h * 0.13, w * 0.03);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(w * 0.27, h * 0.08);
      ctx.lineTo(w * 0.36, h * 0.08);
      ctx.lineTo(w * 0.36, h * 0.4);
      ctx.quadraticCurveTo(w * 0.3, h * 0.34, w * 0.27, h * 0.08);
      ctx.fill();
    }
  },
  sun: {
    label: 'Sun', ratio: 1, colors: ['#fcd116'],
    draw(ctx, w, h, [c]) {
      const cx = w / 2;
      const cy = h / 2;
      ctx.fillStyle = c;
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 - Math.PI / 2;
        const p = a + Math.PI / 2;
        const r1 = w * 0.26;
        const r2 = w * 0.49;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1 + Math.cos(p) * w * 0.07, cy + Math.sin(a) * r1 + Math.sin(p) * w * 0.07);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.lineTo(cx + Math.cos(a) * r1 - Math.cos(p) * w * 0.07, cy + Math.sin(a) * r1 - Math.sin(p) * w * 0.07);
        ctx.closePath();
        ctx.fill();
      }
      ellipse(ctx, cx, cy, w * 0.22, w * 0.22);
      ctx.fill();
    }
  },
  flower: {
    label: 'Flower', ratio: 1, colors: ['#f48fb1', '#fdd835'],
    draw(ctx, w, h, [petal, center]) {
      flowerAt(ctx, w / 2, h / 2, w * 0.5, petal, center);
    }
  },
  cloud: {
    label: 'Cloud', ratio: 1.65, colors: ['#ffffff'],
    draw(ctx, w, h, [c]) {
      ctx.fillStyle = c;
      for (const [x, y, r] of [[0.3, 0.62, 0.3], [0.52, 0.44, 0.4], [0.74, 0.6, 0.3]]) {
        ellipse(ctx, w * x, h * y, h * r, h * r);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.roundRect(w * 0.12, h * 0.58, w * 0.76, h * 0.34, h * 0.17);
      ctx.fill();
    }
  },
  vinyl: {
    label: 'Record', ratio: 1, colors: ['#020304', '#ffd558'],
    draw(ctx, w, h, [disc, label]) {
      const cx = w / 2;
      const cy = h / 2;
      const r = w * 0.48;
      ctx.fillStyle = disc;
      ellipse(ctx, cx, cy, r, r);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = Math.max(1, w * 0.008);
      for (let k = 0.5; k < 0.95; k += 0.07) {
        ellipse(ctx, cx, cy, r * k, r * k);
        ctx.stroke();
      }
      ctx.fillStyle = label;
      ellipse(ctx, cx, cy, r * 0.32, r * 0.32);
      ctx.fill();
      ctx.fillStyle = disc;
      ellipse(ctx, cx, cy, r * 0.05, r * 0.05);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r * 0.94, -2.5, -2.05);
      ctx.closePath();
      ctx.fill();
    }
  },
  mic: {
    label: 'Microphone', ratio: 0.5, colors: ['#e9f0ef', '#020304', '#ffd558'],
    draw(ctx, w, h, [head, body, ring]) {
      const cx = w / 2;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.2, h * 0.42);
      ctx.lineTo(cx + w * 0.2, h * 0.42);
      ctx.lineTo(cx + w * 0.12, h * 0.98);
      ctx.lineTo(cx - w * 0.12, h * 0.98);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ring;
      ctx.fillRect(cx - w * 0.22, h * 0.4, w * 0.44, h * 0.05);
      ctx.fillStyle = head;
      ellipse(ctx, cx, h * 0.22, w * 0.42, h * 0.21);
      ctx.fill();
      ctx.strokeStyle = 'rgba(2,3,4,0.28)';
      ctx.lineWidth = Math.max(1, w * 0.03);
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * w * 0.11, h * 0.04);
        ctx.lineTo(cx + i * w * 0.11, h * 0.4);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ellipse(ctx, cx - w * 0.16, h * 0.12, w * 0.08, h * 0.05, -0.6);
      ctx.fill();
    }
  },
  headphones: {
    label: 'Headphones', ratio: 1.05, colors: ['#020304', '#ffd558'],
    draw(ctx, w, h, [band, cup]) {
      ctx.strokeStyle = band;
      ctx.lineWidth = w * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.55, w * 0.38, Math.PI * 1.02, Math.PI * 1.98);
      ctx.stroke();
      for (const x of [w * 0.06, w * 0.72]) {
        ctx.fillStyle = band;
        ctx.beginPath();
        ctx.roundRect(x, h * 0.48, w * 0.22, h * 0.46, w * 0.06);
        ctx.fill();
        ctx.fillStyle = cup;
        ctx.beginPath();
        ctx.roundRect(x + w * (x < w / 2 ? 0.12 : 0), h * 0.54, w * 0.1, h * 0.34, w * 0.03);
        ctx.fill();
      }
      ctx.lineCap = 'butt';
    }
  },
  note: {
    label: 'Music note', ratio: 0.8, colors: ['#ffd558'],
    draw(ctx, w, h, [c]) {
      ctx.fillStyle = c;
      ellipse(ctx, w * 0.28, h * 0.8, w * 0.22, h * 0.14, -0.4);
      ctx.fill();
      ellipse(ctx, w * 0.78, h * 0.68, w * 0.2, h * 0.13, -0.4);
      ctx.fill();
      ctx.fillRect(w * 0.44, h * 0.12, w * 0.07, h * 0.68);
      ctx.fillRect(w * 0.92, h * 0.02, w * 0.07, h * 0.66);
      ctx.beginPath();
      ctx.moveTo(w * 0.44, h * 0.12);
      ctx.lineTo(w * 0.99, h * 0.02);
      ctx.lineTo(w * 0.99, h * 0.16);
      ctx.lineTo(w * 0.44, h * 0.26);
      ctx.closePath();
      ctx.fill();
    }
  },
  meter: {
    label: 'Level meter', ratio: 1.6, colors: ['#4dffdb', '#ffd558', '#ff5a4f'],
    draw(ctx, w, h, [low, mid, peak]) {
      const bars = 9;
      const gap = w / bars;
      const heights = [0.35, 0.55, 0.8, 0.62, 0.95, 0.7, 0.5, 0.78, 0.4];
      for (let i = 0; i < bars; i++) {
        const bh = h * heights[i];
        const segs = Math.round(bh / (h * 0.09));
        for (let k = 0; k < segs; k++) {
          const t = k / 10;
          ctx.fillStyle = t > 0.82 ? peak : t > 0.55 ? mid : low;
          ctx.fillRect(i * gap + gap * 0.18, h - (k + 1) * h * 0.09, gap * 0.64, h * 0.07);
        }
      }
    }
  },
  hat: {
    label: 'Party hat', ratio: 0.72, colors: ['#ffd558', '#ffffff', '#f5c542'],
    draw(ctx, w, h, [body, stripe, pom]) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.12);
      ctx.lineTo(w * 0.04, h);
      ctx.lineTo(w * 0.96, h);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = rgba(stripe, 0.8);
      for (let i = -2; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(0, h * (0.2 + i * 0.2));
        ctx.lineTo(w, h * (0.05 + i * 0.2));
        ctx.lineTo(w, h * (0.12 + i * 0.2));
        ctx.lineTo(0, h * (0.27 + i * 0.2));
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = pom;
      ellipse(ctx, w / 2, h * 0.1, w * 0.13, w * 0.13);
      ctx.fill();
    }
  },
  raindrop: {
    label: 'Raindrop', ratio: 0.66, colors: ['#9cc3ff'],
    draw(ctx, w, h, [c]) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.bezierCurveTo(w * 1.02, h * 0.5, w * 0.95, h, w / 2, h);
      ctx.bezierCurveTo(w * 0.05, h, -w * 0.02, h * 0.5, w / 2, 0);
      ctx.fill();
    }
  },
  bunting: {
    label: 'Bunting', ratio: 8, band: true, colors: ['#ffd558', '#f5c542', '#4dffdb'],
    draw(ctx, w, h, colors) {
      const P = t => ({ x: w * t, y: h * 0.08 + h * 0.5 * 4 * t * (1 - t) * 0.55 });
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1.5, h * 0.03);
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const p = P(i / 40);
        ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y);
      }
      ctx.stroke();
      const n = Math.max(4, Math.round(w / (h * 0.85)));
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.1) / n;
        const t1 = (i + 0.9) / n;
        const a = P(t0);
        const b = P(t1);
        const m = P((t0 + t1) / 2);
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(m.x, m.y + h * 0.62);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
};

export const STICKER_KINDS = Object.keys(STICKERS).filter(k => k !== 'bunting').concat('bunting');

export function drawSticker(ctx, L) {
  const def = STICKERS[L.kind];
  if (!def) return;
  ctx.save();
  ctx.translate(L.x + L.w / 2, L.y + L.h / 2);
  ctx.rotate(L.rotation || 0);
  if (L.flip) ctx.scale(-1, 1);
  ctx.translate(-L.w / 2, -L.h / 2);
  const colors = def.colors.map((c, i) => (L.colors && L.colors[i]) || c);
  def.draw(ctx, L.w, L.h, colors);
  ctx.restore();
}

// ---- Scatter (confetti, snow, hearts...) ----

export const SCATTER_SHAPES = {
  confetti: 'Confetti',
  snow: 'Snow',
  hearts: 'Hearts',
  stars: 'Stars',
  sparkles: 'Sparkles',
  blossoms: 'Blossoms',
  rain: 'Rain',
  dots: 'Dots'
};

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Pieces are placed from the seed, skipping any that would land in a hole
// (the words and logo), so confetti never sits on top of text.
export function drawScatter(ctx, L) {
  const rnd = seeded(L.seed || 1);
  const colors = L.colors && L.colors.length ? L.colors : ['#ffffff'];
  const holes = L.holes || [];
  const count = Math.round(L.count || 20);
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 12; tries++) {
    const s = L.size * (0.55 + rnd() * 0.8);
    const x = L.x + rnd() * L.w;
    const y = L.y + rnd() * L.h;
    const rot = rnd() * TAU;
    const color = colors[Math.floor(rnd() * colors.length)];
    const pick = rnd();
    if (holes.some(hb => overlaps({ x: x - s, y: y - s, w: s * 2, h: s * 2 }, hb))) continue;
    placed++;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    switch (L.shape) {
      case 'confetti':
        if (pick < 0.45) ctx.fillRect(-s * 0.5, -s * 0.22, s, s * 0.44);
        else if (pick < 0.75) {
          ellipse(ctx, 0, 0, s * 0.32, s * 0.32);
          ctx.fill();
        } else {
          ctx.lineWidth = s * 0.18;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-s * 0.5, 0);
          ctx.quadraticCurveTo(-s * 0.25, -s * 0.4, 0, 0);
          ctx.quadraticCurveTo(s * 0.25, s * 0.4, s * 0.5, 0);
          ctx.stroke();
        }
        break;
      case 'snow':
        if (pick < 0.5) {
          ctx.translate(-s / 2, -s / 2);
          STICKERS.snowflake.draw(ctx, s, s, [color]);
        } else {
          ellipse(ctx, 0, 0, s * 0.18, s * 0.18);
          ctx.fill();
        }
        break;
      case 'hearts':
        ctx.translate(-s / 2, -s / 2);
        heartPath(ctx, s, s);
        ctx.fill();
        break;
      case 'stars':
        starPath(ctx, 0, 0, s / 2, s * 0.21);
        ctx.fill();
        break;
      case 'sparkles':
        ctx.rotate(-rot);
        ctx.translate(-s / 2, -s / 2);
        sparklePath(ctx, s, s);
        ctx.fill();
        break;
      case 'blossoms':
        flowerAt(ctx, 0, 0, s * 0.5, color, '#fdd835');
        break;
      case 'rain':
        ctx.rotate(-rot + 0.25);
        ctx.translate(-s * 0.2, -s * 0.3);
        STICKERS.raindrop.draw(ctx, s * 0.4, s * 0.6, [color]);
        break;
      default:
        ellipse(ctx, 0, 0, s * 0.3, s * 0.3);
        ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Soft blobs and halftone clouds (the site's own background) ----

export function drawBlob(ctx, L) {
  const cx = L.x + L.w / 2;
  const cy = L.y + L.h / 2;
  const r = L.w / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, L.h / L.w);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  const a = L.alpha ?? 0.5;
  g.addColorStop(0, rgba(L.color, a));
  g.addColorStop(0.45, rgba(L.color, a * 0.55));
  g.addColorStop(1, rgba(L.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawHalftone(ctx, L) {
  const s = Math.max(4, L.spacing || 14);
  const maxR = s * 0.42;
  const cx = L.x + L.w / 2;
  const cy = L.y + L.h / 2;
  const rx = L.w / 2;
  const ry = L.h / 2;
  ctx.fillStyle = rgba(L.color, L.alpha ?? 0.3);
  const x0 = Math.floor(L.x / s) * s + s / 2;
  const y0 = Math.floor(L.y / s) * s + s / 2;
  ctx.beginPath();
  for (let y = y0; y < L.y + L.h; y += s) {
    for (let x = x0; x < L.x + L.w; x += s) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d >= 1) continue;
      const r = maxR * Math.pow(1 - d, 0.75);
      if (r < 0.45) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
  }
  ctx.fill();
}

// ---- Occasion sets ----
// items: stickers placed in open corners/edges; scatter: pieces across the page.

export const DECORS = {
  none: { label: 'None' },
  studio: {
    label: 'Studio',
    items: [
      { kind: 'vinyl', slots: ['bottom-right', 'top-right', 'bottom-left', 'right'], size: 0.34, rotation: 0 },
      { kind: 'mic', slots: ['top-right', 'bottom-left', 'top-left', 'right'], size: 0.26, rotation: 0.35 },
      { kind: 'note', slots: ['top-left', 'top-right', 'bottom-left', 'left'], size: 0.1 }
    ]
  },
  gear: {
    label: 'Gear',
    items: [
      { kind: 'headphones', slots: ['bottom-right', 'top-right', 'bottom-left', 'right'], size: 0.3, rotation: -0.2 },
      { kind: 'meter', slots: ['top-right', 'top-left', 'bottom-left', 'left'], size: 0.22 }
    ]
  },
  celebrate: {
    label: 'Celebration',
    items: [{ kind: 'trophy', slots: ['bottom-right', 'top-right', 'bottom-left', 'right'], size: 0.28 }],
    scatter: { shape: 'confetti', count: 38, size: 0.026, colors: ['#f5c542', '#ffffff', '#4dffdb', '#ffd558', '#ff8fb3'] }
  },
  birthday: {
    label: 'Birthday',
    items: [
      { kind: 'bunting', band: true, colors: ['#f5c542', '#ff5c8a', '#4dffdb', '#ffd558'] },
      { kind: 'balloon', slots: ['right', 'bottom-right', 'top-right', 'left', 'bottom-left'], size: 0.3, colors: ['#ff5c8a'] },
      { kind: 'balloon', slots: ['right', 'bottom-right', 'top-right', 'left', 'bottom-left'], size: 0.26, colors: ['#f5c542'] },
      { kind: 'balloon', slots: ['left', 'bottom-left', 'right', 'bottom-right'], size: 0.22, colors: ['#4dffdb'] },
      { kind: 'hat', slots: ['bottom-left', 'bottom-right', 'top-left'], size: 0.16, rotation: -0.25 }
    ],
    scatter: { shape: 'confetti', count: 30, size: 0.024, colors: ['#f5c542', '#ff5c8a', '#ffffff', '#ffd558'] }
  },
  christmas: {
    label: 'Christmas',
    palette: 'christmas',
    items: [
      { kind: 'ornament', hang: true, size: 0.34, colors: ['#c62828', '#f5c542'] },
      { kind: 'ornament', hang: true, size: 0.26, colors: ['#f5c542', '#ffffff'] },
      { kind: 'ornament', hang: true, size: 0.3, colors: ['#ffffff', '#f5c542'] },
      { kind: 'holly', slots: ['bottom-left', 'bottom-right', 'top-left'], size: 0.22 },
      { kind: 'gift', slots: ['bottom-right', 'bottom-left'], size: 0.19, colors: ['#c62828', '#f5c542'] }
    ],
    scatter: { shape: 'snow', count: 26, size: 0.03, colors: ['#ffffff'] }
  },
  newyear: {
    label: 'New Year',
    palette: 'newyear',
    items: [
      { kind: 'firework', slots: ['top-right', 'top-left', 'right'], size: 0.34, colors: ['#f5c542', '#ffffff'] },
      { kind: 'firework', slots: ['top-left', 'bottom-right', 'left'], size: 0.24, colors: ['#ff8fb3', '#f5c542'] },
      { kind: 'firework', slots: ['bottom-left', 'right', 'bottom-right'], size: 0.18, colors: ['#4dffdb', '#ffffff'] }
    ],
    scatter: { shape: 'sparkles', count: 24, size: 0.03, colors: ['#f5c542', '#ffffff'] }
  },
  cny: {
    label: 'Chinese New Year',
    palette: 'cny',
    items: [
      { kind: 'lantern', hang: true, size: 0.4 },
      { kind: 'lantern', hang: true, size: 0.3 },
      { kind: 'lantern', hang: true, size: 0.34 },
      { kind: 'flower', slots: ['bottom-left', 'bottom-right'], size: 0.12, colors: ['#ffd6de', '#f5c542'] },
      { kind: 'flower', slots: ['bottom-left', 'bottom-right', 'left'], size: 0.08, colors: ['#ffb3c1', '#f5c542'] }
    ],
    scatter: { shape: 'sparkles', count: 16, size: 0.026, colors: ['#f5c542'] }
  },
  halloween: {
    label: 'Halloween',
    palette: 'halloween',
    items: [
      { kind: 'web', corner: 'top-left', size: 0.36 },
      { kind: 'moon', slots: ['top-right', 'top-left', 'right'], size: 0.22 },
      { kind: 'pumpkin', slots: ['bottom-right', 'bottom-left'], size: 0.3 },
      { kind: 'pumpkin', slots: ['bottom-left', 'bottom-right'], size: 0.19 },
      { kind: 'bat', slots: ['top-right', 'top-left', 'right', 'left'], size: 0.16, rotation: 0.15 },
      { kind: 'bat', slots: ['top-left', 'right', 'top-right', 'left'], size: 0.11, rotation: -0.2 },
      { kind: 'bat', slots: ['right', 'left', 'bottom-right'], size: 0.08 }
    ]
  },
  valentines: {
    label: "Valentine's",
    palette: 'valentines',
    items: [
      { kind: 'heart', slots: ['bottom-right', 'top-right', 'bottom-left'], size: 0.26, colors: ['#ff4d7d'], rotation: 0.2 },
      { kind: 'heart', slots: ['top-left', 'bottom-left', 'top-right'], size: 0.14, colors: ['#ffd1e0'], rotation: -0.25 }
    ],
    scatter: { shape: 'hearts', count: 18, size: 0.032, colors: ['#ffffff', '#ffd1e0', '#ff8fb3'] }
  },
  mothers: {
    label: 'Flowers',
    palette: 'mothers',
    items: [
      { kind: 'flower', slots: ['bottom-right', 'bottom-left', 'top-right'], size: 0.2, colors: ['#f48fb1', '#fdd835'] },
      { kind: 'flower', slots: ['bottom-right', 'bottom-left', 'top-right'], size: 0.13, colors: ['#ce93d8', '#fdd835'] },
      { kind: 'flower', slots: ['top-left', 'bottom-left', 'top-right'], size: 0.11, colors: ['#f06292', '#fff3c4'] }
    ],
    scatter: { shape: 'hearts', count: 10, size: 0.026, colors: ['#f48fb1', '#d81b60'] }
  },
  fathers: {
    label: 'Stars',
    palette: 'fathers',
    items: [{ kind: 'star', slots: ['top-right', 'bottom-right', 'top-left'], size: 0.2 }],
    scatter: { shape: 'stars', count: 16, size: 0.03, colors: ['#f5c542', '#ffffff'] }
  },
  ph: {
    label: 'Philippine flag',
    palette: 'ph',
    items: [
      { kind: 'sun', slots: ['top-right', 'bottom-right', 'top-left'], size: 0.32 },
      { kind: 'star', slots: ['top-left', 'bottom-left', 'right'], size: 0.1, colors: ['#fcd116'] },
      { kind: 'star', slots: ['bottom-left', 'bottom-right', 'left'], size: 0.08, colors: ['#fcd116'] },
      { kind: 'star', slots: ['bottom-right', 'left', 'top-left'], size: 0.07, colors: ['#fcd116'] }
    ]
  },
  fiesta: {
    label: 'Fiesta',
    palette: 'fiesta',
    items: [{ kind: 'bunting', band: true, colors: ['#fdd835', '#e53935', '#43a047', '#1e88e5', '#ffffff'] }],
    scatter: { shape: 'confetti', count: 34, size: 0.026, colors: ['#fdd835', '#ffffff', '#43a047', '#1e88e5'] }
  },
  candles: {
    label: 'Candles',
    palette: 'candles',
    items: [
      { kind: 'candle', slots: ['bottom-right', 'bottom-left'], size: 0.3 },
      { kind: 'candle', slots: ['bottom-right', 'bottom-left'], size: 0.22 },
      { kind: 'candle', slots: ['bottom-left', 'bottom-right'], size: 0.18 }
    ],
    scatter: { shape: 'dots', count: 14, size: 0.012, colors: ['#e0b25a'] }
  },
  rain: {
    label: 'Rain',
    items: [
      { kind: 'cloud', slots: ['top-right', 'top-left'], size: 0.34 },
      { kind: 'cloud', slots: ['top-left', 'right', 'top-right'], size: 0.22 }
    ],
    scatter: { shape: 'rain', count: 34, size: 0.035, colors: ['#9cc3ff', '#dbe8ff'] }
  },
  sparkle: {
    label: 'Sparkles',
    items: [{ kind: 'sparkle', slots: ['top-right', 'bottom-right', 'top-left'], size: 0.16 }],
    scatter: { shape: 'sparkles', count: 16, size: 0.028, colors: ['#ffffff'] }
  }
};

// Boxes of the parts that must stay readable: words, buttons, labels, the logo.
const IMPORTANT = new Set(['text', 'button', 'chip']);
export const isImportant = l => IMPORTANT.has(l.type) || l.name === 'Logo' || l.name === 'Logo background';

/**
 * Chooses sticker and scatter layers for a decoration set.
 * keepOut: boxes to avoid. Returns { behind: [...], front: [...] } layer specs.
 */
export function decorLayers(decorId, { W, H, u, keepOut, seed, onLight }) {
  const decor = DECORS[decorId];
  if (!decor || decorId === 'none') return { behind: [], front: [] };
  const rnd = seeded(seed);
  const M = Math.min(W, H);
  const m = 26 * u;
  const pad = 18 * u;
  const blocked = keepOut.map(b => ({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }));
  const taken = [];
  const free = b => !blocked.some(k => overlaps(b, k)) && !taken.some(k => overlaps(b, k));
  const behind = [];
  const front = [];

  for (const item of decor.items || []) {
    const def = STICKERS[item.kind];
    const colors = item.colors ? def.colors.map((c, i) => item.colors[i] || c) : def.colors;
    // Light pages need darker bats, web lines, and snow so they show.
    const tuned = onLight && ['bat', 'web', 'snowflake', 'cloud', 'sparkle'].includes(item.kind) ? colors.map((c, i) => (i === 0 ? (item.kind === 'bat' ? '#1c1029' : '#00876f') : c)) : colors;
    if (item.band) {
      const h = M * 0.11;
      behind.push({ type: 'deco', name: def.label, kind: item.kind, x: 0, y: 0, w: W, h, rotation: 0, colors: tuned });
      continue;
    }
    if (item.corner) {
      const s = M * item.size;
      const rot = { 'top-left': 0, 'top-right': Math.PI / 2, 'bottom-right': Math.PI, 'bottom-left': -Math.PI / 2 }[item.corner];
      const x = item.corner.includes('right') ? W - s : 0;
      const y = item.corner.includes('bottom') ? H - s : 0;
      behind.push({ type: 'deco', name: def.label, kind: item.kind, x, y, w: s, h: s, rotation: rot, colors: tuned });
      continue;
    }
    let placed = null;
    for (const shrink of [1, 0.82, 0.66, 0.52, 0.42]) {
      const big = M * item.size * shrink;
      const w = def.ratio >= 1 ? big : big * def.ratio;
      const h = def.ratio >= 1 ? big / def.ratio : big;
      const candidates = [];
      if (item.hang || def.hang) {
        // Hanging things hang from the top edge at a few different lengths.
        for (const fx of [0.9, 0.1, 0.78, 0.22, 0.66, 0.34, 0.5].sort(() => rnd() - 0.5)) candidates.push({ x: W * fx - w / 2, y: -h * (0.1 + rnd() * 0.25) });
      } else {
        for (const slot of item.slots) {
          const bleed = [0, 0.18];
          for (const b of bleed) {
            const ox = w * b;
            const oy = h * b;
            const pos = {
              'top-left': { x: m - ox, y: m - oy },
              'top-right': { x: W - m - w + ox, y: m - oy },
              'bottom-left': { x: m - ox, y: H - m - h + oy },
              'bottom-right': { x: W - m - w + ox, y: H - m - h + oy },
              left: { x: m - ox, y: (H - h) / 2 + (rnd() - 0.5) * H * 0.2 },
              right: { x: W - m - w + ox, y: (H - h) / 2 + (rnd() - 0.5) * H * 0.2 },
              top: { x: (W - w) / 2, y: m },
              bottom: { x: (W - w) / 2, y: H - m - h }
            }[slot];
            if (pos) candidates.push(pos);
          }
        }
      }
      placed = candidates.map(p => ({ ...p, w, h })).find(free);
      if (placed) break;
    }
    if (!placed) continue;
    taken.push(placed);
    front.push({ type: 'deco', name: def.label, kind: item.kind, ...placed, rotation: item.rotation ?? (rnd() - 0.5) * 0.3, colors: tuned });
  }

  if (decor.scatter) {
    const sc = decor.scatter;
    const colors = onLight && sc.colors.every(c => luminance(c) > 0.8) ? ['#00876f', '#b8860b'] : sc.colors;
    front.push({
      type: 'scatter',
      name: SCATTER_SHAPES[sc.shape],
      shape: sc.shape,
      x: 0,
      y: 0,
      w: W,
      h: H,
      // Keep the same density on bigger or smaller pages.
      count: Math.round(sc.count * Math.min(1.8, Math.max(0.6, (W * H) / (1080 * 1080)))),
      size: M * sc.size,
      seed: Math.floor(rnd() * 1e9),
      colors,
      holes: [...blocked, ...taken]
    });
  }
  return { behind, front };
}
