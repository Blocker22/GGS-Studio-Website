// The catalog of automatic emails: their default wording and the placeholders
// they can use. Staff change the wording in the dashboard (Messages > Email
// templates); only fields that differ from these defaults are stored, in
// app_settings.email_templates = { [type]: { [field]: text } }. The design
// around the words is fixed in email.ts.
//
// Plain JS so the dashboard can show these defaults and email.ts can render
// them from the same source.

export const FIELDS = {
  subject: 'Subject line',
  preheader: 'Preview text',
  headline: 'Headline',
  body: 'Message',
  checklist: 'Checklist (one item per line)',
  button: 'Button label',
  footer: 'Footer',
};

export const PLACEHOLDERS = [
  ['first_name', "Customer's first name"],
  ['name', "Customer's full name"],
  ['email', "Customer's email"],
  ['phone', "Customer's phone"],
  ['date', 'Session date, e.g. Saturday, October 10, 2026'],
  ['date_short', 'Short date, e.g. Sat, Oct 10'],
  ['time', 'Time window, e.g. 2 PM to 4 PM'],
  ['room', 'Room name'],
  ['total', 'Booking total'],
  ['ref', 'Booking reference, e.g. 57D52FBF'],
  ['voucher', 'Voucher code used, if any'],
  ['studio_phone', "The studio's phone"],
  ['studio_email', "The studio's email"],
  ['site', 'Website address'],
  ['payment_note', 'Sentence about payment that fits the booking (cash, online, paid, free)'],
  ['addons_note', 'Sentence listing the add-ons booked'],
  ['change_note', 'Schedule change: what changed and why'],
  ['reason_note', 'Cancellation or rejection reason, as a sentence'],
  ['refund_note', 'Refund sentence, only when something was paid'],
  ['amount', 'Payment or refund amount'],
  ['balance_note', 'Remaining balance sentence'],
  ['previous_when', 'The old date and time (rescheduled emails)'],
  ['note', 'Extra note typed by staff when sending'],
];

const CHECKLIST_DEFAULT = [
  'Arrive 10 minutes early so setup does not eat into your time.',
  'Your time runs from {time} whether or not you are here. Arriving late does not extend the session, and a no-show is charged in full.',
  'Bring the ID you booked with if you are paying at the studio.',
  'Back up your files before you leave.',
].join('\n');

const FOOTER_DEFAULT = 'Questions? Reply to this email or call {studio_phone}.';

export const TEMPLATES = {
  received: {
    label: 'Request received',
    audience: 'customer',
    when: 'Right after a customer books on the website.',
    details: true,
    defaults: {
      subject: 'Booking request received: {date_short}, {time}',
      preheader: 'We have your request for {date_short}. Here is what happens next.',
      headline: 'We have your booking request',
      body: 'Hi {first_name},\n\nThanks for booking GGS Studio. Your session is a request until we confirm it, usually within a few hours.\n\n{payment_note}\n\n{addons_note}',
      checklist: '',
      button: 'View your booking',
      footer: FOOTER_DEFAULT,
    },
  },
  confirmed: {
    label: 'Confirmed',
    audience: 'customer',
    when: 'When staff confirm a booking, or a staff-made booking is created.',
    details: true,
    defaults: {
      subject: 'Confirmed: {date_short}, {time}',
      preheader: 'Your session at GGS Studio is confirmed.',
      headline: "You're booked",
      body: 'Hi {first_name},\n\nYour session is confirmed. See you at the studio.\n\n{payment_note}\n\n{addons_note}',
      checklist: CHECKLIST_DEFAULT,
      button: 'View your booking',
      footer: FOOTER_DEFAULT,
    },
  },
  thank_you: {
    label: 'Thank you + review request',
    audience: 'customer',
    when: 'A few hours after a completed session, or sent by hand.',
    details: false,
    defaults: {
      subject: 'How was your session, {first_name}?',
      preheader: 'One minute to tell us how it went.',
      headline: 'Thanks for recording with us',
      body: 'Hi {first_name},\n\nThanks for coming to GGS Studio on {date}. We would love to hear how it went. It takes a minute, and it helps other artists find us.',
      checklist: '',
      button: 'Leave a review',
      footer: FOOTER_DEFAULT,
    },
  },
  schedule_change: {
    label: 'Schedule change',
    audience: 'customer',
    when: 'When the studio changes its hours and a booking no longer fits.',
    details: true,
    defaults: {
      subject: 'A change affecting your booking on {date_short}',
      preheader: 'Our schedule changed and it affects your session.',
      headline: 'Our schedule changed',
      body: 'Hi {first_name},\n\n{change_note}\n\n{note}\n\nReply to this email or call {studio_phone} and we will move your session to a time that works for you.',
      checklist: '',
      button: 'View your booking',
      footer: FOOTER_DEFAULT,
    },
  },
  rescheduled: {
    label: 'Moved or changed',
    audience: 'customer',
    when: 'When staff move a booking or change its details.',
    details: true,
    defaults: {
      subject: 'Your booking now: {date_short}, {time}',
      preheader: 'The details of your session changed.',
      headline: 'Your booking was updated',
      body: 'Hi {first_name},\n\nWe updated your session. {previous_when}\n\nDid not expect this? Reply and we will sort it out.',
      checklist: '',
      button: 'View your booking',
      footer: FOOTER_DEFAULT,
    },
  },
  cancelled_staff: {
    label: 'Cancelled by the studio',
    audience: 'customer',
    when: 'When staff cancel a booking and choose to tell the customer.',
    details: true,
    defaults: {
      subject: 'Your booking on {date_short} is cancelled',
      preheader: 'We are sorry, we had to cancel your session.',
      headline: 'We had to cancel your session',
      body: 'Hi {first_name},\n\nWe are sorry, we had to cancel your session on {date}, {time}.\n\n{reason_note}\n\n{refund_note}\n\n{note}',
      checklist: '',
      button: '',
      footer: FOOTER_DEFAULT,
    },
  },
  cancelled_customer: {
    label: 'Cancelled by the customer',
    audience: 'customer',
    when: 'When a customer cancels from their booking page or account.',
    details: true,
    defaults: {
      subject: 'Cancelled: {date_short}, {time}',
      preheader: 'Your session is cancelled.',
      headline: 'Your booking is cancelled',
      body: 'Hi {first_name},\n\nYour session on {date}, {time} is cancelled, as you asked.\n\n{refund_note}\n\nYou are welcome to book again any time.',
      checklist: '',
      button: '',
      footer: FOOTER_DEFAULT,
    },
  },
  payment_receipt: {
    label: 'Payment receipt',
    audience: 'customer',
    when: 'When a payment is recorded or an online receipt is approved.',
    details: true,
    defaults: {
      subject: 'Payment received: {amount}',
      preheader: 'Your receipt from GGS Studio.',
      headline: 'Payment received',
      body: 'Hi {first_name},\n\nWe recorded your payment of **{amount}**. This email is your receipt.\n\n{balance_note}',
      checklist: '',
      button: 'View your booking',
      footer: FOOTER_DEFAULT,
    },
  },
  payment_rejected: {
    label: 'Receipt not verified',
    audience: 'customer',
    when: 'When staff reject an uploaded payment receipt.',
    details: true,
    defaults: {
      subject: 'We could not verify your payment receipt',
      preheader: 'Your receipt needs another look.',
      headline: 'Your receipt needs another look',
      body: 'Hi {first_name},\n\nWe could not verify the receipt you sent for this session, so it is not marked paid yet.\n\n{reason_note}\n\nUpload a new receipt from your booking page, or reply and we will help.',
      checklist: '',
      button: 'Upload a new receipt',
      footer: FOOTER_DEFAULT,
    },
  },
  refund: {
    label: 'Refund issued',
    audience: 'customer',
    when: 'When staff record a refund.',
    details: true,
    defaults: {
      subject: 'Refund issued: {amount}',
      preheader: 'Your refund is on its way.',
      headline: 'Your refund is on its way',
      body: 'Hi {first_name},\n\nWe refunded **{amount}** for this session. Depending on your bank or e-wallet it can take a few working days to arrive.',
      checklist: '',
      button: '',
      footer: FOOTER_DEFAULT,
    },
  },
  staff_new_booking: {
    label: 'New booking (to staff)',
    audience: 'staff',
    when: 'Sent to the studio and to staff with booking alerts on, for every website booking.',
    details: true,
    defaults: {
      subject: 'New booking: {name}, {date_short} {time}',
      preheader: '{name} booked {date_short}.',
      headline: 'New booking request',
      body: '**{name}** booked {date}, {time}.\n\nEmail: {email}\nPhone: {phone}\n\n{payment_note}\n\n{note}',
      checklist: '',
      button: 'Open in the dashboard',
      footer: 'You get this because booking alerts are on in your dashboard profile.',
    },
  },
  staff_cancelled: {
    label: 'Customer cancelled (to staff)',
    audience: 'staff',
    when: 'Sent to the studio when a customer cancels online.',
    details: true,
    defaults: {
      subject: 'Cancelled by customer: {name}, {date_short}',
      preheader: '{name} cancelled their session.',
      headline: 'A customer cancelled',
      body: '**{name}** cancelled their session on {date}, {time}.\n\n{refund_note}',
      checklist: '',
      button: 'Open in the dashboard',
      footer: 'You get this because booking alerts are on in your dashboard profile.',
    },
  },
};

export const TEMPLATE_TYPES = Object.keys(TEMPLATES);

/** Defaults merged with the stored overrides for one type. */
export function templateFields(type, overrides) {
  const t = TEMPLATES[type];
  if (!t) return null;
  return { ...t.defaults, ...((overrides && overrides[type]) || {}) };
}

/** Replaces {placeholders}; unknown ones are left as typed so typos are visible. */
export function fillPlaceholders(text, ctx) {
  return String(text ?? '').replace(/\{([a-z_]+)\}/g, (m, key) => (key in ctx ? String(ctx[key] ?? '') : m));
}
