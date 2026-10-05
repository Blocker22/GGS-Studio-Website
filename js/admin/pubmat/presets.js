// Ready-made GGS Studio graphics, plus builders that fill a design from live
// data: a voucher, a special date, the rate card, the weekly hours, or a
// booking's receipt. Presets marked `sample: true` contain example dates,
// names or numbers that must be changed before posting.

import { SITE_DOMAIN } from './brand.js';
import { describeConditions, voucherLabel } from '../../../supabase/functions/_shared/voucher.js';
import { DOW_NAMES, describeWhat, longDate, nextOccurrence, time12 } from '../../../supabase/functions/_shared/schedule.js';

const peso = (n) => `₱${Math.round(Number(n) || 0).toLocaleString('en-PH')}`;
const BOOK = `Book at ${SITE_DOMAIN}`;

export const CATEGORIES = [
  { id: 'announcement', label: 'Announcements' },
  { id: 'update', label: 'Updates' },
  { id: 'promo', label: 'Promos' },
  { id: 'advertising', label: 'Advertising' },
  { id: 'event', label: 'Events' },
  { id: 'milestone', label: 'Milestones' },
  { id: 'greeting', label: 'Greetings' },
  { id: 'holiday', label: 'Holidays' },
  { id: 'reminder', label: 'Reminders' },
  { id: 'document', label: 'Vouchers and receipts' },
];

const p = (category, id, name, spec) => ({
  id,
  category,
  name,
  layout: 'field',
  theme: 'night',
  photo: 'photo1',
  bg: 'lines',
  decor: 'none',
  badge: '',
  big: '',
  headline: '',
  body: '',
  details: '',
  cta: '',
  caption: '',
  sample: false,
  ...spec,
});

export const PRESETS = [
  // Announcements
  p('announcement', 'now-booking', 'Now booking', {
    layout: 'cover', photo: 'photo1', badge: 'Now booking',
    headline: 'Track it.\nMix it.\nShip it.',
    body: "Cebu's independent recording studio. An engineer in every session.",
    cta: BOOK,
    caption: `Sessions are open. Book the room and an engineer online at ${SITE_DOMAIN}.`,
  }),
  p('announcement', 'book-online', 'Book online', {
    layout: 'window', theme: 'light', photo: 'photo2', badge: 'New',
    headline: 'Book your session online',
    body: 'Pick a day and a time, choose your add-ons, and leave your details. No account needed.',
    cta: BOOK,
    caption: `You can now book GGS Studio online at ${SITE_DOMAIN}. Pick your time and we confirm by email.`,
  }),
  p('announcement', 'pay-online', 'Pay online', {
    layout: 'column', photo: 'photo4', theme: 'teal', badge: 'New',
    headline: 'Pay your downpayment online',
    body: 'Send it from your banking app, upload the receipt, and your slot is held.',
    details: 'Scan, pay, upload your receipt\nWe check it and email you when it clears',
    cta: BOOK,
    caption: `You can now pay for your session online. Book at ${SITE_DOMAIN}, send the downpayment, and upload your receipt.`,
  }),
  p('announcement', 'new-gear', 'New gear', {
    layout: 'window', photo: 'photo12', badge: 'New in the room',
    headline: 'Fresh gear in the room',
    body: 'Come hear it on your next session. Example gear: change it to what you got.',
    details: 'Example: a new vocal mic\nExample: new monitors',
    cta: BOOK, sample: true,
    caption: 'New gear just landed in the studio. Book a session and try it out.',
  }),
  p('announcement', 'closed-maintenance', 'Closed for maintenance', {
    layout: 'label', theme: 'gold', badge: 'Heads up',
    headline: 'Studio closed for maintenance',
    body: 'We are tuning up the room. Sessions resume right after.',
    details: 'Closed: Example date\nOpen again: Example date',
    sample: true,
    caption: `Heads up: the studio is closed for maintenance on the dates above. Book your next session at ${SITE_DOMAIN}.`,
  }),

  // Updates
  p('update', 'schedule-change', 'Schedule update', {
    layout: 'tracks', theme: 'night', badge: 'Schedule',
    headline: 'Schedule update',
    body: 'Take note of these dates.',
    details: 'Dec 24: 10:00 AM to 4:00 PM\nDec 25: Closed',
    cta: BOOK, sample: true,
    caption: `Schedule update for the coming days. Book your slot at ${SITE_DOMAIN}.`,
  }),
  p('update', 'fully-booked', 'Fully booked', {
    layout: 'quiet', theme: 'gold', badge: 'Fully booked',
    headline: 'Fully booked',
    body: 'Every hour is taken that day. Pick another day and book early.',
    cta: BOOK,
    caption: `We're fully booked that day. Grab another slot at ${SITE_DOMAIN}.`,
  }),

  // Promos
  p('promo', 'weekday-promo', 'Weekday promo', {
    layout: 'stat', theme: 'gold', badge: 'Weekdays only',
    big: '20% OFF',
    headline: 'Weekday sessions',
    body: 'Book a Monday to Thursday session and save. Example offer: change it before posting.',
    cta: 'Use code WEEKDAY20', sample: true,
    caption: 'Weekday sessions are 20% off. Use the code when you book online.',
  }),
  p('promo', 'student-rate', 'Student rate', {
    layout: 'column', theme: 'night', photo: 'photo6', badge: 'Students',
    big: '₱50 OFF',
    headline: 'Student sessions',
    body: 'Show your school ID at the studio. Example offer: change it before posting.',
    details: 'Valid school ID\nAny day we are open',
    cta: BOOK, sample: true,
    caption: 'Students get a discount on every session. Bring your school ID.',
  }),
  p('promo', 'bundle', 'Record and mix bundle', {
    layout: 'label', theme: 'teal', badge: 'Bundle',
    big: '3 HRS',
    headline: 'Record and mix in one go',
    body: 'Track it, mix it, leave with the song. Example offer: change it before posting.',
    details: 'Recording: 3 hours\nMixing: One song',
    cta: BOOK, sample: true,
    caption: 'Record and mix your song in one booking.',
  }),

  // Advertising
  p('advertising', 'the-room', 'The room', {
    layout: 'cover', photo: 'photo1', badge: 'GGS Studio',
    headline: 'Your next song starts here',
    body: 'A treated room, a full mic locker, and an engineer who listens.',
    cta: BOOK,
    caption: `Your next song starts here. Book GGS Studio at ${SITE_DOMAIN}.`,
  }),
  p('advertising', 'services', 'What we do', {
    layout: 'strip', photo: 'photo2', theme: 'night',
    headline: 'Recording, mixing and mastering',
    body: 'Hourly or by the project. Every session includes an engineer.',
    details: 'Vocals and full bands\nPodcasts and voice-overs\nMixing and mastering',
    cta: BOOK,
    caption: `Recording, mixing and mastering in Lapu-Lapu City. ${BOOK}.`,
  }),
  p('advertising', 'same-day-mix', 'Same-day rough mix', {
    layout: 'wave', theme: 'night', badge: 'Every session',
    headline: 'Leave with a rough mix the same day',
    body: 'Hear your song before you get home.',
    cta: BOOK,
    caption: 'Every session ends with a rough mix you can take home.',
  }),
  p('advertising', 'podcast', 'Podcast recording', {
    layout: 'column', photo: 'photo13', theme: 'teal', badge: 'Podcasts',
    headline: 'Record your podcast in a real studio',
    body: 'Clean sound, more than one mic, and an engineer at the desk.',
    cta: BOOK,
    caption: 'Record your podcast in a treated room with an engineer at the desk.',
  }),

  // Events
  p('event', 'open-studio', 'Open studio night', {
    layout: 'label', theme: 'night', badge: 'Event',
    big: 'OCT 24',
    headline: 'Open studio night',
    body: 'Bring your demo, meet other artists, and hear the room. Example details: change before posting.',
    details: 'When: Saturday, 7:00 PM\nEntry: Free, limited slots',
    cta: 'Message us to join', sample: true,
    caption: 'Open studio night: bring your demo and meet other artists. Message us to join.',
  }),
  p('event', 'workshop', 'Workshop', {
    layout: 'window', photo: 'photo4', theme: 'gold', badge: 'Workshop',
    headline: 'Home recording basics',
    body: 'A hands-on afternoon on mics, levels and a clean vocal take. Example details: change before posting.',
    details: 'When: Example date, 2:00 PM\nFee: Example fee',
    cta: 'Message us to sign up', sample: true,
    caption: 'Learn the basics of recording at home in one afternoon.',
  }),

  // Milestones
  p('milestone', 'sessions-count', 'Sessions milestone', {
    layout: 'stat', theme: 'teal', badge: 'Thank you',
    big: '100',
    headline: 'Sessions recorded',
    body: 'Thank you to every artist who walked through the door. Example number: change it before posting.',
    sample: true,
    caption: 'Thank you to every artist who has recorded with us.',
  }),
  p('milestone', 'anniversary', 'Anniversary', {
    layout: 'quiet', theme: 'gold', badge: 'Anniversary',
    big: '1 YEAR',
    headline: 'of making music together',
    body: 'Thank you for every take, every mix, and every late night.',
    caption: 'One year of GGS Studio. Thank you for making music with us.',
  }),
  p('milestone', 'release', 'New release', {
    layout: 'wave', theme: 'night', badge: 'Out now',
    headline: 'Recorded at GGS Studio',
    body: 'Example: Artist name, "Song title". Change it before posting.',
    cta: 'Listen now', sample: true,
    caption: 'Proud to share a new release recorded in our room. Go give it a listen.',
  }),

  // Greetings
  p('greeting', 'thank-you', 'Thank you', {
    layout: 'quiet', theme: 'night',
    headline: 'Thank you for making music with us',
    body: 'Every session means a lot to a small studio.',
    caption: 'Thank you for making music with us.',
  }),
  p('greeting', 'weekend', 'Have a good weekend', {
    layout: 'window', theme: 'light', photo: 'photo6',
    headline: 'Weekend sessions are open',
    body: 'Make the weekend count. Grab a slot.',
    cta: BOOK,
    caption: `Weekend slots are open. ${BOOK}.`,
  }),

  // Holidays
  p('holiday', 'christmas', 'Christmas', {
    layout: 'quiet', decor: 'christmas',
    headline: 'Merry Christmas from GGS Studio',
    body: 'Thank you for every song this year.',
    caption: 'Merry Christmas from all of us at GGS Studio.',
  }),
  p('holiday', 'new-year', 'New Year', {
    layout: 'quiet', decor: 'newyear', big: '2027',
    headline: 'Happy New Year',
    body: 'New year, new songs. See you in the studio.',
    cta: BOOK,
    caption: 'Happy New Year! New year, new songs.',
  }),
  p('holiday', 'cny', 'Chinese New Year', {
    layout: 'quiet', decor: 'cny',
    headline: 'Happy Chinese New Year',
    body: 'Wishing you a year of good music.',
    caption: 'Happy Chinese New Year from GGS Studio.',
  }),
  p('holiday', 'valentines', "Valentine's Day", {
    layout: 'field', decor: 'valentines', badge: "Valentine's",
    headline: 'Record a song for someone',
    body: 'A love song makes a better gift than flowers.',
    cta: BOOK,
    caption: "Valentine's idea: record a song for someone you love.",
  }),
  p('holiday', 'halloween', 'Halloween', {
    layout: 'field', decor: 'halloween',
    headline: 'Happy Halloween',
    body: 'Spooky sessions are still sessions.',
    caption: 'Happy Halloween from GGS Studio.',
  }),
  p('holiday', 'independence', 'Independence Day', {
    layout: 'quiet', decor: 'ph',
    headline: 'Happy Independence Day',
    body: 'Proud to make Filipino music.',
    caption: 'Happy Independence Day from GGS Studio.',
  }),
  p('holiday', 'fiesta', 'Fiesta', {
    layout: 'field', decor: 'fiesta', badge: 'Fiesta',
    headline: 'Happy fiesta, Lapu-Lapu',
    body: 'Celebrate, then come record.',
    caption: 'Happy fiesta to everyone in Lapu-Lapu City.',
  }),

  // Reminders
  p('reminder', 'arrive-early', 'Arrive early', {
    layout: 'tracks', theme: 'gold', badge: 'Reminder',
    headline: 'Booked time is booked time',
    body: 'Your session runs from your start time, so come a little early.',
    details: 'Arrive 10 minutes early\nBring your files and lyrics\nYour session ends on time',
    caption: 'Reminder: your session starts and ends at the times you booked. Come a little early.',
  }),
  p('reminder', 'id-reminder', 'Bring your ID', {
    layout: 'field', theme: 'night', badge: 'Reminder',
    headline: 'Paying at the studio? Bring your ID',
    body: 'We check it against the photo you sent when you booked.',
    caption: 'Paying at the studio? Bring the ID you uploaded when you booked.',
  }),

  // Vouchers and receipts
  p('document', 'voucher-discount', 'Discount voucher', {
    layout: 'voucher', format: 'voucher', theme: 'night',
    headline: 'Studio voucher', big: '₱100 OFF',
    body: 'Good for any session at GGS Studio.',
    details: 'Example: valid until Dec 31, 2026\nOne use per customer',
    badge: 'EXAMPLE100', cta: `Type the code when you book at ${SITE_DOMAIN}`,
    sample: true,
  }),
  p('document', 'voucher-free-hour', 'Free hour voucher', {
    layout: 'voucher', format: 'voucher', theme: 'gold',
    headline: 'Studio voucher', big: '1 FREE HOUR',
    body: 'One hour of studio time on us. Add-ons are still charged.',
    details: 'Example: valid until Dec 31, 2026\nOne use per customer',
    badge: 'FREEHOUR', cta: `Type the code when you book at ${SITE_DOMAIN}`,
    sample: true,
  }),
  p('document', 'gift-certificate', 'Gift certificate', {
    layout: 'giftcard', format: 'voucher', theme: 'gold',
    headline: 'Studio time at GGS Studio', big: '₱1,000',
    body: 'For a song, a podcast, or a whole afternoon of takes.',
    details: 'To:\nFrom:',
    badge: 'No. 0001', cta: 'Example: valid until Dec 31, 2026',
    sample: true,
  }),
  p('document', 'receipt-payment', 'Payment receipt', {
    layout: 'receipt', format: 'slip', theme: 'night',
    headline: 'Payment receipt', big: '₱1,050',
    body: 'Received from: Example name\nBooking: Example date, 2 PM to 5 PM\nIssued: Example date',
    details: 'Main room, 3 hours: ₱1,050',
    badge: 'No. EXAMPLE', cta: 'Paid online · Ref. example',
    sample: true,
  }),
];

// ------------------------------------------------------------------ live builders

const shortDay = (iso) => longDate(iso).replace(/, \d{4}$/, '');

/** A voucher design filled in from a voucher row (Vouchers > Make image). */
export function voucherSpecFromVoucher(v) {
  const base = PRESETS.find((x) => x.id === (v.kind === 'free_units' ? 'voucher-free-hour' : 'voucher-discount'));
  const cond = describeConditions(v);
  return {
    ...base,
    id: `voucher-${v.id}`,
    sample: false,
    big: voucherLabel(v).toUpperCase(),
    body: v.description || `${voucherLabel(v)} your next session at GGS Studio.`,
    details: (cond.length ? cond.map((c) => c[0].toUpperCase() + c.slice(1)) : ['Any day we are open']).join('\n'),
    badge: v.code,
    cta: `Type ${v.code} when you book at ${SITE_DOMAIN}`,
    caption: `${voucherLabel(v)} your next session with code ${v.code}. Book at ${SITE_DOMAIN}.`,
  };
}

/** A post announcing one schedule rule (Schedule > the image button). */
export function specFromRule(rule) {
  const next = nextOccurrence(rule);
  if (!next) return null;
  const holiday = /christmas|new year|holiday|pasko/i.test(rule.note || '');
  if (rule.what === 'closed' && rule.show === 'booked') {
    return { ...PRESETS.find((x) => x.id === 'fully-booked'), id: `rule-${rule.id}`, headline: `Fully booked on ${shortDay(next)}`, caption: `We're fully booked on ${shortDay(next)}. Grab another slot at ${SITE_DOMAIN}.` };
  }
  if (rule.what === 'closed') {
    return {
      ...PRESETS.find((x) => x.id === 'closed-maintenance'),
      id: `rule-${rule.id}`,
      sample: false,
      decor: holiday ? 'christmas' : 'none',
      headline: `Studio closed ${shortDay(next)}`,
      body: rule.note && rule.show !== 'booked' ? rule.note : 'Please plan your sessions around this day. Thank you for understanding.',
      details: `Closed: ${longDate(next)}`,
      caption: `Heads up: the studio is closed on ${longDate(next)}.${rule.note ? ` ${rule.note}` : ''} Book your next session at ${SITE_DOMAIN}.`,
    };
  }
  const what = describeWhat(rule).replace(' (shown as booked)', '');
  return {
    ...PRESETS.find((x) => x.id === 'schedule-change'),
    id: `rule-${rule.id}`,
    sample: false,
    badge: rule.what === 'hours' ? 'Special hours' : 'Heads up',
    headline: rule.what === 'hours' ? `Special hours on ${shortDay(next)}` : `Some hours off on ${shortDay(next)}`,
    body: rule.note && rule.show !== 'booked' ? rule.note : 'The rest of the schedule is as usual.',
    details: `${shortDay(next)}: ${what}`,
    caption: `Take note: on ${longDate(next)} we are ${what.toLowerCase()}. Book at ${SITE_DOMAIN}.`,
  };
}

/** The rate card from the live room and add-on prices. */
export function specFromRates(room, services) {
  const unit = (s) => (s.price_type === 'hourly' ? ' per hour' : s.price_type === 'unit' ? ` per ${s.unit_label || 'unit'}` : '');
  const lines = [`${room.name}: ${peso(room.hourly_rate)} per hour`, ...services.slice(0, 6).map((s) => `${s.name}: +${peso(s.price)}${unit(s)}`)];
  return p('update', 'rates', 'Rate card', {
    layout: 'tracks', theme: 'night', format: 'portrait', badge: 'Rates',
    headline: 'Studio rates',
    body: 'Every session includes an engineer.',
    details: lines.join('\n'),
    cta: BOOK,
    caption: `Our studio rates. Every session includes an engineer. ${BOOK}.`,
  });
}

/** The weekly opening hours. */
export function specFromHours(weekly) {
  const lines = [...weekly].sort((a, b) => a.day_of_week - b.day_of_week)
    .map((x) => `${DOW_NAMES[x.day_of_week]}: ${x.is_closed || !x.open_time ? 'Closed' : `${time12(x.open_time.slice(0, 5))} to ${time12(x.close_time.slice(0, 5))}`}`);
  return p('update', 'hours', 'Opening hours', {
    layout: 'tracks', theme: 'teal', format: 'portrait', badge: 'Hours',
    headline: 'Opening hours',
    body: 'Book online any time, day or night.',
    details: lines.join('\n'),
    cta: BOOK,
    caption: `Our opening hours. Book online any time at ${SITE_DOMAIN}.`,
  });
}

/**
 * A receipt from a booking row (Bookings > Make receipt). `b` carries the
 * snapshot fields: rates, total_price, payments, guest or profile name.
 */
export function receiptSpecFromBooking(b, { name, paid, lines, when }) {
  const base = PRESETS.find((x) => x.id === 'receipt-payment');
  const issued = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
  const total = Number(b.custom_total ?? b.total_price) || 0;
  return {
    ...base,
    id: `receipt-${b.id}`,
    sample: false,
    headline: paid >= total && total > 0 ? 'Payment receipt' : 'Booking summary',
    badge: `No. ${String(b.id).slice(0, 8).toUpperCase()}`,
    body: [`Received from: ${name}`, `Booking: ${when}`, `Issued: ${issued}`].join('\n'),
    details: lines.join('\n'),
    big: peso(total),
    cta: b.payment_waived ? 'No charge (waived)' : paid >= total ? `Paid${b.payment_option === 'cash' ? ' at the studio' : ' online'}` : paid > 0 ? `${peso(paid)} paid, ${peso(total - paid)} due at the studio` : 'Pay at the studio',
  };
}
