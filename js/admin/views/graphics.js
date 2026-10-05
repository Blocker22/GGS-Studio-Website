// Marketing > Social graphics: on-brand posts, vouchers and receipts without
// a design tool. The engine follows the Manson Pickleball pubmat maker;
// the layouts and presets are GGS Studio's own.
//
// Simple mode: pick a ready-made design, change the words, then the look
// (layout, background, logo, footer, decorations, colors, photo). A spec is
// turned into layers by buildLayers() and one painter draws them for the
// preview, every thumbnail and the PNG, so they always match.
// Free mode (pubmat/editor.js): every layer can be dragged, resized and
// restyled, with undo and a draft saved on this device.
//
// Links from elsewhere open straight into a filled-in design:
//   #/graphics?voucher=<id>   Vouchers > Make image
//   #/graphics?rule=<id>      Schedule > the image button on a special date
//   #/graphics?receipt=<id>   Bookings > Make receipt

import { append, btn, clear, copy, customerName, fmtWhen, h, icon, loadCatalog, pageHead, paidAmount, peso, q, sb, state, toast } from '../core.js';
import { loadBrand, PHOTOS } from '../pubmat/brand.js';
import { CATEGORIES, PRESETS, receiptSpecFromBooking, specFromHours, specFromRates, specFromRule, voucherSpecFromVoucher } from '../pubmat/presets.js';
import { BG_STYLES, bgId, DECORS, DOCUMENT_LAYOUTS, downloadCanvas, FOOTER_STYLES, FORMATS, LAYOUTS, LOGO_SIZES, LOGO_STYLES, paint, PHOTO_LAYOUTS, prepareSpec, THEMES } from '../pubmat/render.js';
import { fileToDataUrl, openEditor, readDraft } from '../pubmat/editor.js';
import { sponsorPicker } from '../pubmat/sponsors.js';
import { BOOKING_SELECT } from './booking-dialogs.js';

/** Appends children, skipping null and false (native append prints them). */
const put = (node, ...kids) => append(node, kids);

const WORD_FIELDS = ['badge', 'big', 'headline', 'body', 'details', 'cta', 'caption'];
const BIG_LAYOUTS = new Set(['field', 'stat', 'wave', 'label', 'quiet', 'cover', 'column', 'voucher', 'giftcard', 'receipt']);
const DOC_FORMATS = new Set(['voucher', 'slip']);

// Field names and hints change with the kind of design.
const FIELD_TEXT = {
  default: {
    headline: ['Headline', 'The biggest words. Keep it short.'],
    big: ['Big number or date', 'Shown very large, like 100, ₱200, or OCT 19. Empty hides it.'],
    body: ['Message', 'One or two sentences. Empty hides it.'],
    details: ['Details', 'Dates, times, prices. One per line.'],
    badge: ['Small label', ''],
    cta: ['Button text', ''],
  },
  tracks: { details: ['List rows', 'One per line, like "December 24: 10:00 AM to 4:00 PM". Each row is numbered.'] },
  label: { details: ['Fields', 'One per line, like "When: Saturday, 7:00 PM". Shown as boxes on the label.'] },
  voucher: {
    headline: ['Title', 'Like "Studio voucher".'],
    big: ['Value', 'Like ₱100 OFF or 1 FREE HOUR.'],
    body: ['What it is good for', ''],
    details: ['Terms', 'One per line, like the expiry date.'],
    badge: ['Voucher code', 'Give each voucher its own code.'],
    cta: ['How to use it', ''],
  },
  giftcard: {
    headline: ['What it is for', ''],
    big: ['Value', 'Like ₱1,000 or 3 HOURS.'],
    body: ['Message', ''],
    details: ['To and from', 'One per line, like "To: Maria". Leave the name out to write it by hand.'],
    badge: ['Certificate number', ''],
    cta: ['Validity', 'Like "Valid until December 31, 2026".'],
  },
  receipt: {
    headline: ['Title', 'Like "Payment receipt".'],
    big: ['Total', 'Like ₱1,050.'],
    body: ['Customer and date', 'One per line, like "Received from: Juan".'],
    details: ['Items', 'One per line, like "Main room, 3 hours: ₱1,050".'],
    badge: ['Receipt number', ''],
    cta: ['Payment', 'Like "Paid online · Ref. 8045577246989".'],
  },
};
const fieldText = (layout, key) => (FIELD_TEXT[layout] && FIELD_TEXT[layout][key]) || FIELD_TEXT.default[key];

const specFrom = (preset, keep = {}) => ({
  ...preset,
  // Vouchers and receipts bring their own size; posters keep the last poster size.
  format: preset.format || (keep.format && !DOC_FORMATS.has(keep.format) ? keep.format : 'square'),
  decorColors: true,
  decorSeed: undefined,
  logoStyle: keep.logoStyle || 'color',
  logoSize: keep.logoSize || 'medium',
  footerStyle: keep.footerStyle || 'lines',
  sponsors: keep.sponsors || [],
  sponsorLabel: keep.sponsorLabel || 'Supported by',
  showContacts: true,
  showWebsite: true,
  showAddress: Boolean(preset.showAddress),
  photoUrl: null,
  photo: PHOTOS[preset.photo] ? preset.photo : Object.keys(PHOTOS)[0],
});

// Thumbnails draw when they scroll into view, a few at a time, so opening
// the page does not paint seventy canvases at once.
let thumbQueue = Promise.resolve();
const thumbIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    thumbIO.unobserve(en.target);
    en.target._draw?.();
  });
}, { rootMargin: '200px' }) : null;

function thumbCanvas(getSpec, scale) {
  const c = h('canvas', { class: 'pm-thumb-canvas', 'aria-hidden': 'true' });
  let token = 0;
  c._draw = () => {
    const mine = ++token;
    thumbQueue = thumbQueue.then(async () => {
      if (mine !== token || !c.isConnected) return;
      const { doc, imgs } = await prepareSpec(getSpec(), { thumb: true });
      if (mine === token) paint(c, doc, imgs, scale);
    }).catch(() => {});
  };
  if (thumbIO) thumbIO.observe(c); else c._draw();
  return c;
}

async function loadSeeds(params) {
  const supabase = await sb();
  if (params.voucher) {
    const v = await q(supabase.from('vouchers').select('*').eq('id', params.voucher).maybeSingle());
    return v ? { ...voucherSpecFromVoucher(v), category: 'document' } : null;
  }
  if (params.rule) {
    const setting = await q(supabase.from('staff_settings').select('value').eq('key', 'schedule').maybeSingle());
    const rule = (setting?.value?.overrides || []).find((r) => r.id === params.rule);
    const spec = rule ? specFromRule(rule) : null;
    return spec ? { ...spec, category: 'update' } : null;
  }
  if (params.receipt) {
    const b = await q(supabase.from('bookings').select(BOOKING_SELECT).eq('id', params.receipt).maybeSingle());
    if (!b) return null;
    const hrs = (new Date(b.end_at) - new Date(b.start_at)) / 3600000;
    const rate = Number(b.rates?.hourly_rate ?? 0);
    const lines = [`${b.rooms?.name || 'Studio'}, ${+hrs.toFixed(1)} hour${hrs === 1 ? '' : 's'}: ${peso(rate * hrs)}`];
    (b.booking_services || []).forEach((a) => lines.push(`${a.services?.name || 'Add-on'}${a.quantity > 1 ? ` x ${a.quantity}` : ''}: ${peso(a.price_at_booking)}`));
    if (b.voucher?.code) lines.push(`Voucher ${b.voucher.code}: -${peso(b.voucher.discount)}`);
    const paid = paidAmount(b);
    return { ...receiptSpecFromBooking(b, { name: customerName(b), paid, lines, when: fmtWhen(b.start_at, b.end_at) }), category: 'document' };
  }
  return null;
}

async function liveDesigns() {
  await loadCatalog();
  const supabase = await sb();
  const out = [];
  const room = state.rooms.find((r) => r.is_active) || state.rooms[0];
  if (room) out.push(specFromRates(room, state.services.filter((s) => s.is_active)));
  const hours = room ? await q(supabase.from('operating_hours').select('*').eq('room_id', room.id)).catch(() => null) : null;
  if (hours?.length) out.push(specFromHours(hours));
  return out;
}

export async function render(root, params) {
  await loadBrand();
  const [seed, live] = await Promise.all([loadSeeds(params).catch(() => null), liveDesigns().catch(() => [])]);
  if ((params.voucher || params.rule || params.receipt) && !seed) toast('That item has no design to make (it may be paused, past, or deleted).', 'warn');
  const presets = [...live, ...PRESETS];

  let preset = seed ? { ...(PRESETS.find((x) => x.layout === seed.layout) || PRESETS[0]), ...seed } : presets[0];
  let spec = specFrom(preset);
  let category = seed ? seed.category || 'document' : 'all';
  let editorCleanup = null;

  const preview = h('canvas', { class: 'pm-preview', role: 'img' });
  const spinner = h('span', { class: 'pm-spinner', hidden: true }, icon('spinner-gap'));
  const sampleNote = h('div', { class: 'banner warn pm-sample', hidden: true }, icon('warning'), h('div', {}, 'This design has example dates, prices, or names. Change them to the real ones before you post.'));
  const formatBox = h('div', { class: 'pm-formats', role: 'group', 'aria-label': 'Size' });
  const formatHint = h('p', { class: 'hint' });
  const actions = h('div', { class: 'pm-actions' });
  const presetBox = h('div', {});
  const wordsBox = h('div', { class: 'stack' });
  const lookBox = h('div', { class: 'stack pm-look' });
  const simple = h('div', { class: 'pm-simple' });

  let drawToken = 0;
  let drawTimer = null;
  function redraw() {
    clearTimeout(drawTimer);
    spinner.hidden = false;
    drawTimer = setTimeout(async () => {
      const mine = ++drawToken;
      const { doc, imgs } = await prepareSpec(spec);
      if (mine !== drawToken) return;
      paint(preview, doc, imgs, 1);
      preview.setAttribute('aria-label', `Preview: ${spec.headline || preset.name}`);
      spinner.hidden = true;
    }, 60);
  }
  // Option thumbnails show the current design with one option changed, so
  // they redraw (lazily, after a pause) whenever the design changes.
  let lookTimer = null;
  const set = (key, value, { look = true } = {}) => {
    spec = { ...spec, [key]: value };
    redraw();
    drawTop();
    if (look) { clearTimeout(lookTimer); lookTimer = setTimeout(drawLook, 350); }
  };

  function pick(p) {
    preset = p;
    spec = specFrom(p, { format: spec.format, logoStyle: spec.logoStyle, logoSize: spec.logoSize, footerStyle: spec.footerStyle, sponsors: spec.sponsors, sponsorLabel: spec.sponsorLabel });
    redraw();
    drawTop();
    drawPresets();
    drawWords();
    drawLook();
  }

  function drawTop() {
    sampleNote.hidden = !preset.sample;
    clear(formatBox);
    FORMATS.forEach((f) => put(formatBox, h('button', {
      type: 'button', class: spec.format === f.id ? 'on' : '', 'aria-pressed': String(spec.format === f.id), title: f.hint,
      onclick: () => { spec = { ...spec, format: f.id }; redraw(); drawTop(); clearTimeout(lookTimer); lookTimer = setTimeout(drawLook, 350); },
    }, f.label, h('span', {}, `${f.w} x ${f.h}`))));
    formatHint.textContent = `${FORMATS.find((f) => f.id === spec.format)?.hint || ''}.`;
    clear(actions);
    const draft = readDraft();
    put(actions, 
      btn('Download picture', { kind: 'primary', iconName: 'download-simple', onClick: async (e) => {
        const b = e.currentTarget;
        b.classList.add('busy');
        const { doc, imgs } = await prepareSpec(spec);
        const out = document.createElement('canvas');
        paint(out, doc, imgs, 1);
        await downloadCanvas(out, `ggs-studio-${preset.id}-${spec.format}.png`).catch((err) => toast(err.message, 'error'));
        b.classList.remove('busy');
      } }),
      btn('Copy caption', { iconName: 'copy', disabled: !spec.caption, onClick: () => copy(spec.caption) }),
      btn('Edit freely', { iconName: 'sliders-horizontal', onClick: async () => {
        if (draft && !window.confirm('Start free editing from this design? Your last free-edit design will be replaced.')) return;
        const { doc } = await prepareSpec(spec);
        openFree(doc, `ggs-studio-custom-${doc.w}x${doc.h}.png`);
      } }),
      draft ? h('button', { type: 'button', class: 'pm-continue', onclick: () => openFree(draft.doc, `ggs-studio-custom-${draft.doc.w}x${draft.doc.h}.png`) },
        icon('clock-counter-clockwise'), 'Continue my last free-edit design',
        h('span', {}, `· ${new Date(draft.savedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)) : null);
  }

  function drawPresets() {
    clear(presetBox);
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Design categories' });
    [{ id: 'all', label: 'All' }, ...CATEGORIES].forEach((c) => {
      const n = c.id === 'all' ? presets.length : presets.filter((x) => x.category === c.id).length;
      if (!n) return;
      put(chips, h('button', { type: 'button', class: `chip${category === c.id ? ' on' : ''}`, 'aria-pressed': String(category === c.id), onclick: () => { category = c.id; drawPresets(); } },
        c.label, h('span', { class: 'count' }, n)));
    });
    const grid = h('div', { class: 'pm-preset-grid' });
    (category === 'all' ? presets : presets.filter((x) => x.category === category)).forEach((p) => {
      const thumbSpec = { ...specFrom(p), format: 'square' };
      put(grid, h('button', { type: 'button', class: `pm-preset${p.id === preset.id ? ' on' : ''}`, 'aria-pressed': String(p.id === preset.id), onclick: () => pick(p) },
        thumbCanvas(() => thumbSpec, 0.24), h('span', {}, p.name)));
    });
    put(presetBox, 
      h('h2', { class: 'pm-step' }, h('span', {}, '1'), 'Choose a design'),
      h('p', { class: 'hint' }, `${presets.length} ready-made designs. Rates and hours fill in from your live settings.`),
      chips, grid);
  }

  function drawWords() {
    clear(wordsBox);
    const area = (key, rows) => {
      const t = h('textarea', { class: 'textarea', rows, value: spec[key] || '' });
      t.addEventListener('input', () => set(key, t.value, { look: false }));
      return t;
    };
    const line = (key, max) => {
      const t = h('input', { class: 'input', value: spec[key] || '', maxlength: max });
      t.addEventListener('input', () => set(key, t.value, { look: false }));
      return t;
    };
    const fieldOf = (key, control) => {
      const [label, hint] = fieldText(spec.layout, key);
      control.id = `pm-${key}`;
      return h('div', { class: 'field' }, h('label', { for: control.id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
    };
    put(wordsBox, 
      h('div', { class: 'pm-step-row' },
        h('h2', { class: 'pm-step' }, h('span', {}, '2'), 'Change the words'),
        btn('Undo changes', { kind: 'ghost', size: 'sm', iconName: 'arrow-counter-clockwise', onClick: () => { spec = { ...spec, ...Object.fromEntries(WORD_FIELDS.map((k) => [k, preset[k]])) }; redraw(); drawWords(); drawTop(); } })),
      fieldOf('headline', area('headline', 2)),
      BIG_LAYOUTS.has(spec.layout) ? fieldOf('big', line('big', 40)) : null,
      fieldOf('body', area('body', 3)),
      fieldOf('details', area('details', 4)),
      h('div', { class: 'grid grid-2' }, fieldOf('badge', line('badge', 24)), fieldOf('cta', line('cta', 80))));
    if (!DOCUMENT_LAYOUTS.has(spec.layout)) {
      const checks = [['showContacts', 'Phone numbers'], ['showWebsite', 'Website'], ['showAddress', 'Address']].map(([key, label]) => {
        const box = h('input', { type: 'checkbox', checked: spec[key] !== false });
        box.addEventListener('change', () => set(key, box.checked));
        return h('label', { class: 'check' }, box, h('span', {}, label));
      });
      put(wordsBox, h('fieldset', { class: 'pm-fieldset' }, h('legend', {}, 'Show at the bottom'), h('div', { class: 'row' }, checks)));
    }
    const cap = h('textarea', { class: 'textarea', rows: 3, value: spec.caption || '', id: 'pm-caption' });
    cap.addEventListener('input', () => { spec = { ...spec, caption: cap.value }; drawTop(); });
    put(wordsBox, h('div', { class: 'field' }, h('label', { for: 'pm-caption' }, 'Post caption'), cap, h('div', { class: 'hint' }, 'Text to paste under the picture when you post it.')));
  }

  function optionGrid(items, cls = '') {
    return h('div', { class: `pm-option-grid ${cls}` }, items.map(({ change, label, selected, onPick }) =>
      h('button', { type: 'button', class: `pm-option${selected ? ' on' : ''}`, 'aria-pressed': String(selected), onclick: onPick },
        thumbCanvas(() => ({ ...spec, ...change, format: 'square' }), 0.14), h('span', {}, label))));
  }

  function drawLook() {
    clear(lookBox);
    put(lookBox, h('h2', { class: 'pm-step' }, h('span', {}, '3'), 'Change the look'));
    ['poster', 'document'].forEach((group) => {
      put(lookBox, h('fieldset', { class: 'pm-fieldset' }, h('legend', {}, group === 'poster' ? 'Poster layout' : 'Vouchers and receipts'),
        optionGrid(LAYOUTS.filter((l) => l.group === group).map((l) => ({
          change: { layout: l.id }, label: l.label, selected: spec.layout === l.id,
          onPick: () => { set('layout', l.id); drawWords(); },
        })))));
    });
    put(lookBox, 
      h('fieldset', { class: 'pm-fieldset' }, h('legend', {}, 'Background'),
        optionGrid(BG_STYLES.map((b) => ({ change: { bg: b.id }, label: b.label, selected: bgId(spec.bg) === b.id, onPick: () => set('bg', b.id) })))),
      h('fieldset', { class: 'pm-fieldset' }, h('legend', {}, 'Logo'),
        optionGrid(LOGO_STYLES.map((l) => ({ change: { logoStyle: l.id }, label: l.label, selected: (spec.logoStyle || 'color') === l.id, onPick: () => set('logoStyle', l.id) }))),
        spec.logoStyle !== 'none' ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Logo size', style: 'margin-top:8px' }, LOGO_SIZES.map((z) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String((spec.logoSize || 'medium') === z.id), class: (spec.logoSize || 'medium') === z.id ? 'on' : '', onclick: () => set('logoSize', z.id),
        }, z.label))) : null));
    if (!DOCUMENT_LAYOUTS.has(spec.layout)) {
      put(lookBox, h('fieldset', { class: 'pm-fieldset' }, h('legend', {}, 'Footer'),
        optionGrid(FOOTER_STYLES.map((f) => ({ change: { footerStyle: f.id }, label: f.label, selected: (spec.footerStyle || 'lines') === f.id, onPick: () => set('footerStyle', f.id) }))),
        h('p', { class: 'hint' }, FOOTER_STYLES.find((f) => f.id === (spec.footerStyle || 'lines')).hint),
        h('p', { class: 'pm-label', style: 'margin-top:12px' }, 'Sponsors'),
        sponsorPicker(spec.sponsors, (sponsors) => {
          spec = { ...spec, sponsors, footerStyle: sponsors.length ? 'bar' : spec.footerStyle };
          redraw();
          clearTimeout(lookTimer);
          lookTimer = setTimeout(drawLook, 350);
        }),
        spec.sponsors?.length ? (() => {
          const t = h('input', { class: 'input', value: spec.sponsorLabel, maxlength: 40, id: 'pm-sponsor-label' });
          t.addEventListener('input', () => set('sponsorLabel', t.value, { look: false }));
          return h('div', { class: 'field' }, h('label', { for: 'pm-sponsor-label' }, 'Words above the logos'), t);
        })() : null,
        spec.sponsors?.length && spec.footerStyle !== 'bar' ? h('p', { class: 'field-error' }, 'Sponsors only show with the footer bar.') : null));
    }
    const decorHead = h('div', { class: 'pm-step-row' }, h('legend', {}, 'Decorations'),
      spec.decor && spec.decor !== 'none' ? btn('Shuffle', { kind: 'ghost', size: 'sm', iconName: 'shuffle', onClick: () => set('decorSeed', Math.floor(Math.random() * 1e9)) }) : null);
    const decorColors = h('input', { type: 'checkbox', checked: spec.decorColors !== false });
    decorColors.addEventListener('change', () => set('decorColors', decorColors.checked));
    put(lookBox, h('fieldset', { class: 'pm-fieldset' }, decorHead,
      optionGrid(Object.entries(DECORS).map(([id, d]) => ({ change: { decor: id }, label: d.label, selected: (spec.decor || 'none') === id, onPick: () => { spec = { ...spec, decorSeed: undefined }; set('decor', id); } })), 'pm-scroll'),
      DECORS[spec.decor]?.palette ? h('label', { class: 'check' }, decorColors, h('span', {}, "Use the occasion's colors")) : null));
    put(lookBox, h('fieldset', { class: 'pm-fieldset' },
      h('legend', {}, `Colors${DECORS[spec.decor]?.palette && spec.decorColors !== false ? ' (used when the occasion colors are off)' : ''}`),
      h('div', { class: 'pm-themes' }, Object.entries(THEMES).map(([id, t]) => h('button', {
        type: 'button', class: spec.theme === id ? 'on' : '', 'aria-pressed': String(spec.theme === id), onclick: () => set('theme', id),
      }, h('span', { class: 'pm-theme-swatch', style: { background: t.bg }, 'aria-hidden': 'true' }), t.label)))));
    if (PHOTO_LAYOUTS.has(spec.layout)) {
      const upload = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1' });
      upload.addEventListener('change', async () => {
        const f = upload.files?.[0];
        upload.value = '';
        if (f) set('photoUrl', (await fileToDataUrl(f)).src);
      });
      put(lookBox, h('fieldset', { class: 'pm-fieldset' }, h('legend', {}, 'Photo'),
        h('div', { class: 'pm-photo-grid' },
          Object.entries(PHOTOS).map(([key, p]) => h('button', {
            type: 'button', class: `pm-photo${!spec.photoUrl && spec.photo === key ? ' on' : ''}`, 'aria-pressed': String(!spec.photoUrl && spec.photo === key), 'aria-label': p.alt,
            onclick: () => { spec = { ...spec, photoUrl: null }; set('photo', key); },
          }, h('img', { src: p.thumb, alt: '', loading: 'lazy' }))),
          h('button', { type: 'button', class: `pm-photo pm-photo-add${spec.photoUrl ? ' on' : ''}`, onclick: () => upload.click() }, icon('image-square'), spec.photoUrl ? 'Yours' : 'My own'),
          upload)));
    } else {
      put(lookBox, h('p', { class: 'hint' }, 'This layout has no photo. Pick a layout with a photo in it to add one.'));
    }
  }

  function openFree(doc, fileName) {
    const holder = h('div', {});
    simple.hidden = true;
    put(root, holder);
    editorCleanup = openEditor(holder, {
      doc, fileName,
      onExit: () => { editorCleanup = null; holder.remove(); simple.hidden = false; drawTop(); },
    });
  }

  put(simple, 
    h('div', { class: 'pm-layout' },
      h('div', { class: 'panel panel-pad pm-preview-panel' },
        h('div', { class: 'pm-preview-wrap' }, preview, spinner),
        sampleNote, formatBox, formatHint, actions),
      h('div', { class: 'stack' },
        h('div', { class: 'panel panel-pad' }, presetBox),
        h('div', { class: 'panel panel-pad' }, wordsBox),
        h('div', { class: 'panel panel-pad' }, lookBox))));
  put(root, pageHead('Social graphics', 'Posts, vouchers and receipts in the GGS look. Pick a design, change the words, download.'), simple);
  drawTop();
  drawPresets();
  drawWords();
  drawLook();
  redraw();
  return () => editorCleanup?.();
}
