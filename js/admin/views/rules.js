// Setup > Booking rules: the limits the public booking form enforces (staff
// bookings skip all of them except overlaps), the downpayment, the cutoff for
// customer changes, ID checks and automatic review requests.

import { btn, field, h, icon, input, pageHead, run, saveSetting, settings, toggle } from '../core.js';

export async function render(root) {
  const s = await settings(['booking_rules', 'deposit_percent', 'reschedule_cutoff_hours', 'paymongo_enabled']);
  const r = s.booking_rules || {};
  const num = (v, min, max, step = 1) => input({ type: 'number', min, max, step, value: v });
  const deposit = num(s.deposit_percent ?? 20, 1, 100);
  const cutoff = num(s.reschedule_cutoff_hours ?? 24, 0, 720);
  const ahead = num(r.max_days_ahead ?? 90, 1, 730);
  const maxOpen = num(r.max_open_per_customer ?? 3, 1, 50);
  const lead = num(r.min_lead_minutes ?? 60, 0, 10080, 15);
  const requireId = toggle('Ask for a photo of a valid ID when someone pays at the studio', r.require_id_for_cash !== false);
  const retention = num(r.id_retention_days ?? 30, 1, 365);
  const feedbackOn = toggle('Email a review request after each session', r.feedback_enabled !== false);
  const feedbackDelay = num(r.feedback_delay_hours ?? 3, 1, 47);
  const paymongo = toggle('Use PayMongo hosted checkout instead of QR transfers (legacy)', s.paymongo_enabled === true);

  const save = btn('Save rules', { kind: 'primary', iconName: 'floppy-disk', onClick: (e) => run(e.currentTarget, async () => {
    await Promise.all([
      saveSetting('booking_rules', {
        ...r,
        max_days_ahead: Number(ahead.value) || 90,
        max_open_per_customer: Number(maxOpen.value) || 3,
        min_lead_minutes: Number(lead.value) || 0,
        require_id_for_cash: requireId.input.checked,
        id_retention_days: Number(retention.value) || 30,
        feedback_enabled: feedbackOn.input.checked,
        feedback_delay_hours: Number(feedbackDelay.value) || 3,
      }),
      saveSetting('deposit_percent', Number(deposit.value) || 20),
      saveSetting('reschedule_cutoff_hours', Number(cutoff.value) || 0),
      saveSetting('paymongo_enabled', paymongo.input.checked),
    ]);
  }, { success: 'Saved. New bookings follow these rules.' }).catch(() => {}) });

  const section = (title, iconName, ...children) => h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, icon(iconName), ' ', title)), h('div', { class: 'panel-body stack' }, children));

  root.append(
    pageHead('Booking rules', 'What the website lets customers do. Staff bookings ignore these limits, but never double-book.', [save]),
    h('div', { class: 'split', style: 'align-items:start' },
      h('div', { class: 'stack' },
        section('Booking window', 'calendar-blank',
          h('div', { class: 'grid grid-2' }, field('Book up to (days ahead)', ahead), field('Minimum notice (minutes)', lead)),
          field('Upcoming bookings allowed per customer', maxOpen, { hint: 'Counted by email or account.' })),
        section('Payment and changes', 'credit-card',
          field('Downpayment (% of the total)', deposit),
          field('Customers can cancel or move until (hours before)', cutoff, { hint: 'After this, only staff can change the booking.' }),
          paymongo)),
      h('div', { class: 'stack' },
        section('Identity checks', 'identification-card', requireId,
          field('Delete ID photos after (days past the session)', retention, { hint: 'Only the check result is kept after that. Keep it short; ID photos are sensitive personal data.' })),
        section('Reviews', 'star', feedbackOn,
          field('Send it this many hours after the session ends', feedbackDelay, { hint: 'Only sessions that ended in the last 48 hours get one, so switching this on never emails old customers.' })))));
}
