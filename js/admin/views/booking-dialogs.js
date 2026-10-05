// Booking dialogs shared by Bookings, Calendar, Customers and Payments:
// add/edit, cancel (reason, alternatives, live email preview), send an email
// by hand, check a payment receipt, and the ID check.

import {
  api, btn, checkbox, clear, confirmDialog, customerName, effectiveStatus, field, fmtDate, fmtDateTime, fmtWhen, fn, h, hours,
  hrs, icon, idState, input, loadCatalog, openDialog, paidAmount, paymentState, peso, pill, previewFrame, promptDialog, q, ref,
  run, sb, select, signedUrl, state, textarea, toast, toggle, STATUS_LABEL, PAY_LABEL, PAY_TONE, OPTION_LABEL, copy,
} from '../core.js';
import { localDate, localTime } from '../../../supabase/functions/_shared/schedule.js';
import { computeDiscount } from '../../../supabase/functions/_shared/voucher.js';

export const BOOKING_SELECT = '*, rooms(id, name), profiles!bookings_customer_id_fkey(id, full_name, phone), booking_services(service_id, quantity, price_at_booking, services(id, name, price, price_type, unit_label)), payments(id, amount, status, method, type, channel, reference_no, receipt_path, rejection_reason, refunded_amount, created_at, submitted_at)';

export async function loadBooking(id) {
  const supabase = await sb();
  return q(supabase.from('bookings').select(BOOKING_SELECT).eq('id', id).maybeSingle());
}

const toIso = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

// ------------------------------------------------------------------ add / edit

/** Opens the add (booking = null) or edit dialog. Resolves true when saved. */
export async function openBookingForm(booking, { date, start, end } = {}) {
  await loadCatalog();
  const editing = !!booking;
  const rooms = state.rooms;
  const services = state.services;
  const room0 = booking?.room_id || rooms.find((r) => r.is_active)?.id || rooms[0]?.id;

  const name = input({ value: booking ? (booking.guest_name || booking.profiles?.full_name || '') : '', autocomplete: 'off' });
  const email = input({ type: 'email', value: booking?.guest_email || '' });
  const phone = input({ type: 'tel', value: booking?.guest_phone || booking?.profiles?.phone || '' });
  const room = h('select', { class: 'select' }, rooms.map((r) => h('option', { value: r.id }, `${r.name}${r.is_active ? '' : ' (hidden)'}`)));
  room.value = room0;
  const dateIn = input({ type: 'date', value: booking ? localDate(booking.start_at) : (date || localDate(new Date())) });
  const startIn = input({ type: 'time', step: 900, value: booking ? localTime(booking.start_at) : (start || '10:00') });
  const endIn = input({ type: 'time', step: 900, value: booking ? localTime(booking.end_at) : (end || '12:00') });
  const status = select(Object.entries(STATUS_LABEL), booking?.status || 'confirmed');
  const option = select(Object.entries(OPTION_LABEL), booking?.payment_option || 'cash');
  const waived = toggle("Don't charge (waive payment)", !!booking?.payment_waived);
  const voucherIn = input({ value: booking?.voucher?.code || '', placeholder: 'Optional', style: 'text-transform:uppercase' });
  const customOn = toggle('Set the total by hand', !!booking?.custom_total);
  const customIn = input({ type: 'number', min: 0, step: 1, value: booking?.custom_total ? booking.total_price : '' });
  const notes = textarea({ value: booking?.notes || '', rows: 3, placeholder: 'Only staff see this' });
  const notify = checkbox('Email the customer about changes', true);
  const priceHint = h('div', { class: 'hint' });
  const err = h('div', { class: 'field-error', role: 'alert' });

  // Add-ons with quantities for per-unit ones.
  const kept = new Map((booking?.booking_services || []).map((bs) => [bs.service_id, bs]));
  const addonRows = services.filter((s) => s.is_active || kept.has(s.id)).map((s) => {
    const cb = h('input', { type: 'checkbox', checked: kept.has(s.id) });
    const qty = h('input', { class: 'input', type: 'number', min: 1, step: 1, value: kept.get(s.id)?.quantity || 1, style: 'width:72px;min-height:32px', 'aria-label': `How many for ${s.name}`, hidden: s.price_type !== 'unit' || !kept.has(s.id) });
    const unit = s.price_type === 'hourly' ? '/hr' : s.price_type === 'unit' ? `/${s.unit_label || 'unit'}` : 'flat';
    const row = h('label', { class: 'check', style: 'align-items:center' }, cb, h('span', { style: 'flex:1' }, s.name, h('span', { class: 'faint' }, ` ${peso(s.price)} ${unit}`)), qty);
    cb.addEventListener('change', () => { qty.hidden = s.price_type !== 'unit' || !cb.checked; recalc(); });
    qty.addEventListener('input', recalc);
    return { s, cb, qty, row };
  });

  function lengthHours() {
    if (!startIn.value || !endIn.value) return 0;
    let a = new Date(toIso(dateIn.value, startIn.value)).getTime();
    let b = new Date(toIso(dateIn.value, endIn.value)).getTime();
    if (b <= a) b += 86400000; // runs past midnight
    return (b - a) / 3600000;
  }

  function recalc() {
    const hoursN = lengthHours();
    const r = rooms.find((x) => x.id === room.value);
    const rate = editing && booking.room_id === room.value && booking.rates?.hourly_rate != null ? Number(booking.rates.hourly_rate) : Number(r?.hourly_rate || 0);
    const oldHours = editing ? hours(booking) : hoursN;
    let addons = 0;
    addonRows.forEach(({ s, cb, qty }) => {
      if (!cb.checked) return;
      const k = kept.get(s.id);
      const q2 = Math.max(1, Math.floor(Number(qty.value) || 1));
      if (k) {
        const unitPrice = s.price_type === 'hourly' ? Number(k.price_at_booking) / (oldHours || 1) : s.price_type === 'unit' ? Number(k.price_at_booking) / (k.quantity || 1) : Number(k.price_at_booking);
        addons += s.price_type === 'hourly' ? unitPrice * hoursN : s.price_type === 'unit' ? unitPrice * q2 : unitPrice;
      } else {
        addons += s.price_type === 'hourly' ? Number(s.price) * hoursN : s.price_type === 'unit' ? Number(s.price) * q2 : Number(s.price);
      }
    });
    const list = Math.ceil(rate * hoursN + addons);
    let discount = 0;
    if (booking?.voucher && voucherIn.value.trim().toUpperCase() === booking.voucher.code) {
      discount = computeDiscount(booking.voucher, { list, units: hoursN, baseRate: rate });
    }
    customIn.disabled = !customOn.input.checked;
    const voucherNote = voucherIn.value.trim() && voucherIn.value.trim().toUpperCase() !== booking?.voucher?.code ? ' The new code is checked when you save.' : '';
    priceHint.textContent = hoursN > 0
      ? `${hrs(hoursN)} at ${peso(rate)}/hr${addons ? ` + ${peso(addons)} add-ons` : ''} = list ${peso(list)}${discount ? `, voucher -${peso(discount)} = ${peso(list - discount)}` : ''}.${voucherNote}`
      : 'Set a start and end time.';
    if (!customOn.input.checked) customIn.placeholder = String(list - discount);
  }
  [room, dateIn, startIn, endIn, voucherIn, customIn].forEach((c) => c.addEventListener('input', recalc));
  customOn.input.addEventListener('change', recalc);
  recalc();

  const linked = booking?.customer_id
    ? h('div', { class: 'banner', style: 'margin:0' }, icon('user-circle'), h('div', {}, 'Linked to the registered account of ', h('strong', {}, booking.profiles?.full_name || 'a customer'), '. Typing a name below books it as a walk-in instead.'))
    : null;

  const body = h('div', { class: 'stack' },
    linked,
    h('div', { class: 'grid grid-3' }, field('Customer name', name), field('Email', email, { hint: 'For confirmations' }), field('Phone', phone)),
    h('div', { class: 'grid grid-4' }, field('Room', room), field('Date', dateIn), field('Start', startIn), field('End', endIn)),
    h('div', { class: 'hint' }, 'Staff can book any time, even outside opening hours or on closed days. Overlaps with other bookings are still refused.'),
    h('fieldset', {}, h('legend', {}, 'Add-ons'), addonRows.length ? h('div', { class: 'grid grid-2' }, addonRows.map((r) => r.row)) : h('p', { class: 'muted' }, 'No add-ons set up.')),
    h('div', { class: 'grid grid-3' }, field('Status', status), field('Payment', option), field('Voucher code', voucherIn)),
    h('div', { class: 'row' }, waived, customOn),
    h('div', { class: 'grid grid-2' }, field('Total (set by hand)', customIn), h('div', { style: 'align-self:end' }, priceHint)),
    field('Staff notes', notes),
    editing ? notify : null,
    err);

  return new Promise((resolve) => {
    openDialog({
      title: editing ? `Edit booking ${ref(booking.id)}` : 'Add a booking',
      sub: editing ? `Made ${fmtDateTime(booking.created_at)}${booking.via === 'staff' ? ' by staff' : ' on the website'}` : 'Phone or walk-in booking. Confirmed by default.',
      size: 'wide',
      body,
      foot: (d) => [
        btn('Cancel', { onClick: () => d.close(false) }),
        btn(editing ? 'Save changes' : 'Add booking', { kind: 'primary', onClick: async (e) => {
          err.textContent = '';
          if (!name.value.trim() && !booking?.customer_id) { err.textContent = "Give the customer's name."; return; }
          if (!dateIn.value || !startIn.value || !endIn.value) { err.textContent = 'Set the date and times.'; return; }
          const startIso = toIso(dateIn.value, startIn.value);
          let endIso = toIso(dateIn.value, endIn.value);
          if (new Date(endIso) <= new Date(startIso)) endIso = new Date(new Date(endIso).getTime() + 86400000).toISOString();
          const picked = addonRows.filter((r) => r.cb.checked);
          const payload = {
            room_id: room.value,
            start_at: startIso,
            end_at: endIso,
            status: status.value,
            payment_option: option.value,
            payment_waived: waived.input.checked,
            voucher_code: voucherIn.value.trim().toUpperCase(),
            custom_total: customOn.input.checked ? (customIn.value === '' ? Number(customIn.placeholder) : Number(customIn.value)) : null,
            notes: notes.value,
            service_ids: picked.map((r) => r.s.id),
            service_quantities: Object.fromEntries(picked.map((r) => [r.s.id, Math.max(1, Math.floor(Number(r.qty.value) || 1))])),
            guest_email: email.value.trim(),
            guest_phone: phone.value.trim(),
          };
          if (name.value.trim() && name.value.trim() !== booking?.profiles?.full_name) payload.guest_name = name.value.trim();
          try {
            await run(e.currentTarget, async () => {
              if (editing) {
                const out = await fn('update-booking', { booking_id: booking.id, ...payload, notify: notify.input.checked });
                toast(out.changes?.length ? `Saved ${out.changes.length} change${out.changes.length === 1 ? '' : 's'}.` : 'No changes to save.');
              } else {
                if (!payload.voucher_code) delete payload.voucher_code;
                await fn('create-booking', payload);
                toast('Booking added.');
              }
            });
            d.close(true);
          } catch (ex) {
            err.textContent = ex.message;
          }
        } }),
      ],
      onClose: (v) => resolve(v === true),
    });
  });
}

// ------------------------------------------------------------------ cancel

export async function openCancel(booking) {
  const reason = input({ placeholder: 'e.g. The studio is closed for repairs' });
  const note = textarea({ rows: 2, placeholder: 'Optional extra message' });
  const notify = toggle('Email the customer', !!(booking.guest_email || booking.customer_id));
  const altBox = h('div', { class: 'tags' }, h('span', { class: 'faint' }, 'Finding free times…'));
  const chosen = new Map();
  const manualDate = input({ type: 'date' });
  const manualStart = input({ type: 'time', step: 900 });
  const manualEnd = input({ type: 'time', step: 900 });
  const frame = previewFrame('', 'preview-frame');
  frame.style.minHeight = '380px';
  const subject = h('div', { class: 'hint' });

  const chip = (a) => {
    const on = chosen.has(a.start_at);
    return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: () => {
      if (chosen.has(a.start_at)) chosen.delete(a.start_at);
      else if (chosen.size < 6) chosen.set(a.start_at, a);
      else toast('Up to 6 alternatives.', 'warn');
      renderAlts();
      preview();
    } }, fmtWhen(a.start_at, a.end_at));
  };
  let suggestions = [];
  function renderAlts() {
    clear(altBox);
    const all = [...suggestions, ...[...chosen.values()].filter((c) => !suggestions.some((s) => s.start_at === c.start_at))];
    if (!all.length) altBox.appendChild(h('span', { class: 'faint' }, 'No free times of the same length in the next three weeks.'));
    all.forEach((a) => altBox.appendChild(chip(a)));
  }
  api('booking.alternatives', { booking_id: booking.id }).then((r) => { suggestions = r.alternatives || []; renderAlts(); }).catch(() => { suggestions = []; renderAlts(); });

  let timer;
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!notify.input.checked) { frame.srcdoc = '<p style="font-family:sans-serif;color:#888;padding:20px">No email will be sent.</p>'; subject.textContent = ''; return; }
      try {
        const p = await api('booking.cancel', { booking_id: booking.id, preview: true, reason: reason.value, note: note.value, alternatives: [...chosen.values()] });
        frame.srcdoc = p.html;
        subject.textContent = p.to ? `To ${p.to}: ${p.subject}` : 'This booking has no email address, so nothing will be sent.';
      } catch (e) { subject.textContent = e.message; }
    }, 350);
  };
  [reason, note].forEach((c) => c.addEventListener('input', preview));
  notify.input.addEventListener('change', preview);
  preview();

  const addManual = btn('Add', { size: 'sm', onClick: () => {
    if (!manualDate.value || !manualStart.value || !manualEnd.value) return toast('Pick a date, start and end.', 'warn');
    const a = { start_at: toIso(manualDate.value, manualStart.value), end_at: toIso(manualDate.value, manualEnd.value) };
    if (new Date(a.end_at) <= new Date(a.start_at)) return toast('End must be after start.', 'warn');
    if (chosen.size >= 6) return toast('Up to 6 alternatives.', 'warn');
    chosen.set(a.start_at, a);
    renderAlts();
    preview();
  } });

  return new Promise((resolve) => {
    openDialog({
      title: `Cancel ${customerName(booking)}'s booking`,
      sub: fmtWhen(booking.start_at, booking.end_at),
      size: 'wide',
      body: h('div', { class: 'split' },
        h('div', { class: 'stack' },
          field('Reason', reason, { hint: 'Shown to the customer in the email.' }),
          notify,
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Offer other times (each gets a "Book this" link)'), altBox),
          h('div', { class: 'grid grid-3' }, field('Date', manualDate), field('Start', manualStart), field('End', manualEnd)),
          h('div', {}, addManual),
          field('Note', note)),
        h('div', { class: 'stack' }, h('span', { class: 'label' }, 'Email preview'), subject, frame)),
      foot: (d) => [
        btn('Keep booking', { onClick: () => d.close(false) }),
        btn('Cancel booking', { kind: 'danger', onClick: async (e) => {
          try {
            const out = await run(e.currentTarget, () => api('booking.cancel', { booking_id: booking.id, reason: reason.value, note: note.value, alternatives: [...chosen.values()], notify: notify.input.checked }));
            if (out.email_error) toast(`Cancelled, but the email failed: ${out.email_error}`, 'warn');
            else toast(notify.input.checked ? 'Cancelled and emailed.' : 'Cancelled.');
            d.close(true);
          } catch { /* toasted */ }
        } }),
      ],
      onClose: (v) => resolve(v === true),
    });
  });
}

// ------------------------------------------------------------------ send email

const EMAIL_TYPES = [
  ['confirmed', 'Confirmed'],
  ['received', 'Request received'],
  ['thank_you', 'Thank you + review link'],
  ['schedule_change', 'Schedule change'],
  ['rescheduled', 'Moved or changed'],
  ['custom', 'Custom message'],
];

export async function openEmail(booking) {
  const type = select(EMAIL_TYPES, effectiveStatus(booking) === 'completed' ? 'thank_you' : 'confirmed');
  const note = textarea({ rows: 3, placeholder: 'Optional. Added to the message.' });
  const subj = input({ placeholder: 'Subject' });
  const message = textarea({ rows: 6, placeholder: 'Write your message. Placeholders like {first_name} and {date} work here.' });
  const details = checkbox('Include the booking details', true);
  const customBox = h('div', { class: 'stack' }, field('Subject', subj), field('Message', message), details);
  const noteField = field('Note for this email', note, { hint: 'For a schedule change, describe what changed.' });
  const frame = previewFrame('');
  const subject = h('div', { class: 'hint' });
  const log = (booking.email_log || []).slice().reverse();

  let timer;
  const sync = () => {
    customBox.hidden = type.value !== 'custom';
    noteField.hidden = type.value === 'custom';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const p = await api('booking.email', { booking_id: booking.id, type: type.value, preview: true, note: note.value, subject: subj.value || 'Subject', message: message.value || 'Your message', include_details: details.input.checked });
        frame.srcdoc = p.html;
        subject.textContent = p.to ? `To ${p.to}: ${p.subject}` : 'No email address on this booking.';
      } catch (e) { subject.textContent = e.message; }
    }, 350);
  };
  [type, note, subj, message].forEach((c) => c.addEventListener('input', sync));
  details.input.addEventListener('change', sync);
  sync();

  openDialog({
    title: `Email ${customerName(booking)}`,
    sub: booking.guest_email || 'Uses the email on the booking or account',
    size: 'wide',
    body: h('div', { class: 'split' },
      h('div', { class: 'stack' }, field('Which email', type), noteField, customBox,
        h('div', {}, h('span', { class: 'label' }, 'Sent before'),
          log.length ? h('div', { class: 'list' }, log.slice(0, 8).map((l) => h('div', { class: 'list-item' },
            icon('envelope-simple'), h('div', {}, h('div', {}, l.subject), h('div', { class: 'cell-sub' }, `${fmtDateTime(l.at)} by ${l.by}`)))))
            : h('p', { class: 'faint' }, 'Nothing yet.'))),
      h('div', { class: 'stack' }, h('span', { class: 'label' }, 'Preview'), subject, frame)),
    foot: (d) => [
      btn('Close', { onClick: () => d.close() }),
      btn('Send email', { kind: 'primary', iconName: 'paper-plane-tilt', onClick: async (e) => {
        try {
          await run(e.currentTarget, () => api('booking.email', { booking_id: booking.id, type: type.value, note: note.value, subject: subj.value, message: message.value, include_details: details.input.checked }), { success: 'Email sent.' });
          d.close(true);
        } catch { /* toasted */ }
      } }),
    ],
  });
}

// ------------------------------------------------------------------ receipts

async function ocrText(url) {
  const mod = await import('../../ocr.js');
  return mod.readImage(url);
}

export async function openReceipt(booking, payment, { onChange } = {}) {
  const expected = Number(payment.amount);
  const view = h('div', { class: 'stack' }, h('div', { class: 'sk', style: 'height:320px' }));
  const ocrOut = h('div', { class: 'hint' });
  const body = h('div', { class: 'split' },
    view,
    h('div', { class: 'stack' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Customer'), h('dd', {}, customerName(booking)),
        h('dt', {}, 'Booking'), h('dd', {}, `${ref(booking.id)}, ${fmtWhen(booking.start_at, booking.end_at)}`),
        h('dt', {}, 'Expected'), h('dd', {}, h('strong', {}, peso(expected)), ` (${payment.type === 'deposit' ? 'downpayment' : 'full payment'})`),
        h('dt', {}, 'Paid to'), h('dd', {}, (payment.channel || '—').toUpperCase()),
        h('dt', {}, 'Ref no. given'), h('dd', { class: 'mono' }, payment.reference_no || '—'),
        h('dt', {}, 'Sent'), h('dd', {}, payment.submitted_at ? fmtDateTime(payment.submitted_at) : '—'),
        h('dt', {}, 'Status'), h('dd', {}, payment.status === 'submitted' ? pill('Waiting for you', 'warn') : payment.status === 'succeeded' ? pill('Approved', 'teal') : payment.status === 'rejected' ? pill('Rejected', 'danger') : pill(payment.status))),
      payment.rejection_reason ? h('div', { class: 'banner danger' }, icon('x-circle'), h('div', {}, 'Rejected before: ', payment.rejection_reason)) : null,
      h('div', { class: 'banner' }, icon('scan'), h('div', {},
        h('div', {}, 'Read the receipt on this device to compare the amount and ref no. Advisory only: always check the account itself.'),
        ocrOut))));

  let url = null;
  if (payment.receipt_path) {
    try {
      url = await signedUrl('payment-receipts', payment.receipt_path, 600);
      clear(view).appendChild(/\.pdf$/i.test(payment.receipt_path)
        ? h('div', { class: 'empty' }, icon('file-pdf'), h('h3', {}, 'PDF receipt'), h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Open the PDF'))
        : h('a', { href: url, target: '_blank', rel: 'noopener', title: 'Open full size' }, h('img', { src: url, alt: 'Payment receipt', style: 'border-radius:12px;max-height:70vh;margin:auto;object-fit:contain' })));
    } catch (e) {
      clear(view).appendChild(h('div', { class: 'empty' }, icon('warning'), h('p', {}, e.message)));
    }
  } else {
    clear(view).appendChild(h('div', { class: 'empty' }, icon('image-broken'), h('h3', {}, 'No receipt uploaded'), h('p', {}, 'The customer has not sent proof yet.')));
  }

  const readBtn = btn('Read receipt', { size: 'sm', iconName: 'scan', onClick: async (e) => {
    if (!url || /\.pdf$/i.test(payment.receipt_path)) return toast('Only image receipts can be read.', 'warn');
    await run(e.currentTarget, async () => {
      ocrOut.textContent = 'Reading… the first time takes a few seconds.';
      const text = await ocrText(url);
      const flat = text.replace(/\s+/g, ' ');
      const amounts = [...flat.matchAll(/(?:PHP|₱|P)\s?([\d,]+(?:\.\d{2})?)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
      const refDigits = (payment.reference_no || '').replace(/\D/g, '');
      const refFound = refDigits.length >= 4 && flat.replace(/\D/g, '').includes(refDigits);
      const amountFound = amounts.some((a) => Math.abs(a - expected) < 1);
      ocrOut.replaceChildren(
        h('div', {}, amountFound ? '✓ Found the expected amount on the receipt.' : `✗ Didn't find ${peso(expected)}${amounts.length ? `; saw ${amounts.slice(0, 3).map(peso).join(', ')}` : ''}.`),
        h('div', {}, refDigits ? (refFound ? '✓ The ref no. appears on the receipt.' : "✗ The ref no. given doesn't appear on the receipt.") : 'No ref no. was given.'));
    }).catch(() => { ocrOut.textContent = "Couldn't read this image."; });
  } });

  const pending = ['submitted', 'pending', 'rejected'].includes(payment.status);
  openDialog({
    title: 'Check payment receipt',
    sub: `${customerName(booking)}, ${peso(expected)}`,
    size: 'wide',
    body,
    foot: (d) => [
      h('div', { class: 'left' }, readBtn),
      btn('Close', { onClick: () => d.close() }),
      pending ? btn('Reject', { kind: 'danger', onClick: async () => {
        const reason = await promptDialog({ title: 'Reject this receipt', message: 'The customer sees this reason and can send a new receipt.', label: 'What is wrong', placeholder: 'e.g. The amount is ₱300, not ₱700' });
        if (reason == null) return;
        try {
          await run(null, () => fn('verify-payment', { payment_id: payment.id, approve: false, reason }), { success: 'Receipt rejected. The customer was emailed.' });
          d.close(); onChange?.();
        } catch { /* toasted */ }
      } }) : null,
      pending ? btn('Approve', { kind: 'primary', iconName: 'check', onClick: async (e) => {
        const amt = await promptDialog({ title: 'Approve payment', message: `Leave ${peso(expected)} unless the receipt shows a different amount.`, label: 'Amount received (₱)', value: String(expected), type: 'number', confirmLabel: 'Approve' });
        if (amt == null) return;
        try {
          await run(e.currentTarget, () => fn('verify-payment', { payment_id: payment.id, approve: true, amount: Number(amt) || expected }), { success: 'Payment approved.' });
          d.close(); onChange?.();
        } catch { /* toasted */ }
      } }) : null,
    ],
  });
}

export async function markPaid(booking, onChange) {
  const remaining = Math.max(0, Number(booking.total_price) - paidAmount(booking));
  const amt = await promptDialog({
    title: 'Record a payment at the studio',
    message: remaining > 0 ? `Balance due: ${peso(remaining)}. The customer gets an emailed receipt.` : 'This booking is already paid. Enter any extra amount received.',
    label: 'Amount received (₱)', value: remaining > 0 ? String(remaining) : '', type: 'number', confirmLabel: 'Record payment',
  });
  if (amt == null || !(Number(amt) > 0)) return;
  await run(null, () => fn('mark-paid', { booking_id: booking.id, amount: Number(amt) }), { success: 'Payment recorded.' }).catch(() => {});
  onChange?.();
}

// ------------------------------------------------------------------ ID check

export async function openIdCheck(booking, { onChange } = {}) {
  const c = booking.id_check || { label: 'ID photo', number: null, status: 'pending', read: {} };
  const photoBox = h('div', { class: 'stack' }, h('div', { class: 'sk', style: 'height:300px' }));
  let url = null;
  if (booking.id_image_path) {
    try {
      url = await signedUrl('customer-ids', booking.id_image_path, 300);
      clear(photoBox).appendChild(h('img', { src: url, alt: 'ID photo', style: 'border-radius:12px;max-height:60vh;object-fit:contain;margin:auto' }));
    } catch (e) {
      clear(photoBox).appendChild(h('div', { class: 'empty' }, icon('warning'), h('p', {}, e.message)));
    }
  } else {
    clear(photoBox).appendChild(h('div', { class: 'empty' }, icon('image-broken'), h('h3', {}, 'Photo deleted'),
      h('p', {}, c.photo_deleted_at ? `Deleted ${fmtDate(c.photo_deleted_at)}. Only the check record remains.` : 'No photo on file.')));
  }
  const yesNo = (v, yes, no) => v === true ? h('span', {}, '✓ ', yes) : v === false ? h('span', { style: 'color:var(--warn)' }, '✗ ', no) : h('span', { class: 'faint' }, 'Not checked');
  const typeGuess = c.read?.type_guess;
  const statusPill = { verified: pill('Looks right', 'teal', 'check'), rejected: pill('Problem', 'danger', 'x'), pending: pill('To check', 'warn') }[c.status] || pill(c.status);

  openDialog({
    title: 'ID check',
    sub: `${customerName(booking)}, ${fmtWhen(booking.start_at, booking.end_at)}`,
    size: 'wide',
    body: h('div', { class: 'split' }, photoBox, h('div', { class: 'stack' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Name on booking'), h('dd', {}, customerName(booking)),
        h('dt', {}, 'ID type'), h('dd', {}, c.label || '—'),
        h('dt', {}, 'Number'), h('dd', { class: 'mono' }, c.number || '—'),
        h('dt', {}, 'Status'), h('dd', {}, statusPill, c.checked_by ? h('span', { class: 'faint' }, ` by ${c.checked_by}, ${fmtDateTime(c.checked_at)}`) : null)),
      h('div', { class: 'panel panel-pad stack', style: 'gap:6px' },
        h('strong', {}, 'Automatic checks (on the customer\'s device)'),
        h('div', {}, c.format_checked ? '✓ Number format is valid for this ID type' : h('span', { class: 'faint' }, 'No format check for this ID type')),
        h('div', {}, yesNo(c.read?.name_found, 'Name found on the photo', 'Name not found on the photo')),
        h('div', {}, yesNo(c.read?.number_found, 'Number found on the photo', 'Number not found on the photo')),
        typeGuess && c.type && typeGuess !== c.type ? h('div', { style: 'color:var(--warn)' }, `✗ The photo looks like a different ID (${typeGuess})`) : null),
      h('p', { class: 'hint' }, 'None of this proves the ID is real. Compare the photo with the person on arrival.'),
      url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open full size') : null)),
    foot: (d) => [
      booking.id_image_path ? h('div', { class: 'left' }, btn('Delete photo now', { kind: 'danger', iconName: 'trash', onClick: async (e) => {
        if (!(await confirmDialog({ title: 'Delete the ID photo?', message: 'The photo is erased for good. The check record stays.', confirmLabel: 'Delete photo', danger: true }))) return;
        await run(e.currentTarget, () => api('booking.id_photo_delete', { booking_id: booking.id }), { success: 'Photo deleted.' }).catch(() => {});
        d.close(); onChange?.();
      } })) : null,
      booking.id_check ? btn('Check again', { onClick: async (e) => { await run(e.currentTarget, () => api('booking.id_check', { booking_id: booking.id, status: 'pending' })).catch(() => {}); d.close(); onChange?.(); } }) : null,
      booking.id_check ? btn('Problem', { kind: 'danger', onClick: async (e) => { await run(e.currentTarget, () => api('booking.id_check', { booking_id: booking.id, status: 'rejected' }), { success: 'Marked as a problem.' }).catch(() => {}); d.close(); onChange?.(); } }) : null,
      booking.id_check ? btn('Looks right', { kind: 'primary', iconName: 'check', onClick: async (e) => { await run(e.currentTarget, () => api('booking.id_check', { booking_id: booking.id, status: 'verified' }), { success: 'ID marked as checked.' }).catch(() => {}); d.close(); onChange?.(); } }) : btn('Close', { onClick: () => d.close() }),
    ],
  });
}

// ------------------------------------------------------------------ misc actions

export async function setStatus(booking, status, onChange) {
  await run(null, () => fn('update-booking', { booking_id: booking.id, status }), { success: `Marked ${STATUS_LABEL[status].toLowerCase()}.` }).catch(() => {});
  onChange?.();
}

export async function deleteBooking(booking, onChange) {
  const upcoming = new Date(booking.start_at) > new Date() && !['cancelled'].includes(booking.status);
  const notify = checkbox('Email the customer that it is cancelled', upcoming);
  const ok = await confirmDialog({
    title: 'Delete this booking for good?',
    message: `${customerName(booking)}, ${fmtWhen(booking.start_at, booking.end_at)}.\nThe booking, its payments, receipt and ID photo are erased. The audit log keeps a copy. Use Cancel instead if you want to keep the record.`,
    confirmLabel: 'Delete booking', danger: true, extra: notify,
  });
  if (!ok) return;
  try {
    await fn('delete-booking', { booking_id: booking.id, notify: notify.input.checked });
    toast('Booking deleted.');
  } catch (err) {
    if (err.unrefunded_amount) {
      const force = await confirmDialog({ title: 'Money was taken for this booking', message: `${err.error}\n\nDelete anyway and write off ${peso(err.unrefunded_amount)}?`, confirmLabel: 'Delete anyway', danger: true });
      if (!force) return;
      await run(null, () => fn('delete-booking', { booking_id: booking.id, force: true, notify: notify.input.checked }), { success: 'Booking deleted.' }).catch(() => {});
    } else toast(err.message, 'error');
  }
  onChange?.();
}

export function payCell(b, onChange) {
  const ps = paymentState(b);
  const ids = idState(b);
  const open = (b.payments || []).find((p) => p.method === 'manual' && p.type !== 'refund');
  const parts = [
    h('div', { class: 'cell-title' }, OPTION_LABEL[b.payment_option] || b.payment_option),
    h('div', { class: 'tags' },
      pill(PAY_LABEL[ps], PAY_TONE[ps]),
      ids !== 'none' ? h('button', { type: 'button', class: `pill ${ids === 'verified' ? 'teal' : ids === 'rejected' ? 'danger' : ids === 'deleted' ? 'quiet' : 'warn'}`, onclick: () => openIdCheck(b, { onChange }) },
        icon('identification-card'), ids === 'verified' ? 'ID checked' : ids === 'rejected' ? 'ID problem' : ids === 'deleted' ? 'ID deleted' : 'ID to check') : null),
  ];
  if (open?.reference_no) parts.push(h('div', { class: 'cell-sub mono' }, `Ref ${open.reference_no}`));
  const paid = paidAmount(b);
  if (paid > 0 && ps !== 'paid') parts.push(h('div', { class: 'cell-sub' }, `${peso(paid)} of ${peso(b.total_price)}`));
  const acts = [];
  if (open && (open.receipt_path || open.status === 'submitted')) acts.push(btn('Receipt', { size: 'sm', iconName: 'receipt', onClick: () => openReceipt(b, open, { onChange }) }));
  if (!['paid', 'waived'].includes(ps) && b.status !== 'cancelled') acts.push(btn('Mark paid', { size: 'sm', onClick: () => markPaid(b, onChange) }));
  if (acts.length) parts.push(h('div', { class: 'row', style: 'margin-top:6px;gap:6px' }, acts));
  return parts;
}

export { copy };
