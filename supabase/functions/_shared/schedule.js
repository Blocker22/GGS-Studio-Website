// The operating-schedule rule engine. One file, three users: the Edge
// Functions (booking checks), the public booking calendar, and the admin
// dashboard all import this exact module, so they always agree on which dates
// a rule covers. GitHub Pages publishes the whole repo, so the site imports it
// straight from ../supabase/functions/_shared/schedule.js.
//
// Plain JavaScript with no imports, so it runs unchanged in Deno and browsers.
//
// A schedule is { weekly: [{ dow, closed, open, close }] (Sunday = 0),
//                 overrides: [rule] }.
// A rule is WHEN + WHAT:
//   repeat: 'once'        { date }
//           'range'       { from, to, yearly? }      yearly ranges may wrap New Year
//           'yearly'      { month, day }
//           'monthly'     { month (0 = every month), day (-1 = last) }
//           'nthWeekday'  { month (0 = every), nth (1-5, -1 = last), weekday }
//           'weekOfMonth' { month (0 = every), week (1-5 = days 1-7, 8-14, ...; -1 = last 7 days) }
//   repeating rules may carry startsOn / endsOn (YYYY-MM-DD)
//   what:   'closed' { show: 'unavailable' | 'booked' }
//           'hours'  { open, close, blocks? }
//           'block'  { blocks: [{ from, to }] (max 6), show }
//   note:   free text, never shown publicly when show = 'booked'
//
// All dates are business-local (Asia/Manila, UTC+8 with no DST) as
// YYYY-MM-DD strings; all times are HH:MM. A close time at or before the open
// time means the day runs past midnight.

export const TZ = 'Asia/Manila';
export const TZ_OFFSET = '+08:00';
export const MAX_RULES = 300;
export const MAX_BLOCKS = 6;

export const REPEATS = ['once', 'range', 'yearly', 'monthly', 'nthWeekday', 'weekOfMonth'];
// Most specific wins when several rules hit one date; ties go to the first listed.
const PRECEDENCE = { once: 6, range: 5, yearly: 4, nthWeekday: 3, weekOfMonth: 2, monthly: 1 };

export const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- time helpers

export function toMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMin(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "14:30" -> "2:30 PM"; "14:00" -> "2 PM". */
export function time12(hhmm) {
  const min = toMin(hhmm);
  if (min == null) return '';
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = ((h + 11) % 12) + 1;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}

/** Epoch ms of a business-local date + time. */
export function localMs(date, hhmm = '00:00') {
  return new Date(`${date}T${fromMin(toMin(hhmm) ?? 0)}:00${TZ_OFFSET}`).getTime();
}

/** The business-local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(when) {
  const d = when instanceof Date ? when : new Date(when);
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

/** The business-local time (HH:MM) of an instant. */
export function localTime(when) {
  const d = when instanceof Date ? when : new Date(when);
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(11, 16);
}

export function todayLocal() {
  return localDate(new Date());
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parts(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d, dow, lastDay };
}

// ---------------------------------------------------------------- matching

/** Does `rule` cover business-local `date`? */
export function ruleMatches(rule, date) {
  if (!rule || !date) return false;
  if (rule.repeat !== 'once' && rule.repeat !== 'range') {
    if (rule.startsOn && date < rule.startsOn) return false;
    if (rule.endsOn && date > rule.endsOn) return false;
  }
  const { m, d, dow, lastDay } = parts(date);
  const monthOk = (month) => !Number(month) || Number(month) === m;

  switch (rule.repeat) {
    case 'once':
      return rule.date === date;
    case 'range': {
      if (!rule.from || !rule.to) return false;
      if (!rule.yearly) return date >= rule.from && date <= rule.to;
      if (rule.startsOn && date < rule.startsOn) return false;
      if (rule.endsOn && date > rule.endsOn) return false;
      const md = date.slice(5);
      const a = rule.from.slice(5);
      const b = rule.to.slice(5);
      return a <= b ? md >= a && md <= b : md >= a || md <= b; // wraps past New Year
    }
    case 'yearly':
      return Number(rule.month) === m && (Number(rule.day) === d || (Number(rule.day) === -1 && d === lastDay));
    case 'monthly': {
      if (!monthOk(rule.month)) return false;
      const day = Number(rule.day);
      return day === -1 ? d === lastDay : day === d;
    }
    case 'nthWeekday': {
      if (!monthOk(rule.month) || Number(rule.weekday) !== dow) return false;
      const nth = Number(rule.nth);
      if (nth === -1) return d + 7 > lastDay;
      return Math.ceil(d / 7) === nth;
    }
    case 'weekOfMonth': {
      if (!monthOk(rule.month)) return false;
      const week = Number(rule.week);
      if (week === -1) return d > lastDay - 7;
      return Math.ceil(d / 7) === week;
    }
    default:
      return false;
  }
}

/** The rule that governs `date`, or null. */
export function ruleFor(schedule, date) {
  let best = null;
  let bestRank = -1;
  (schedule?.overrides || []).forEach((rule) => {
    if (!ruleMatches(rule, date)) return;
    const rank = PRECEDENCE[rule.repeat] ?? 0;
    if (rank > bestRank) {
      best = rule;
      bestRank = rank;
    }
  });
  return best;
}

function weeklyFor(schedule, dow) {
  const row = (schedule?.weekly || []).find((w) => Number(w.dow) === dow);
  if (!row || row.closed || !row.open || !row.close) return { closed: true, open: null, close: null };
  return { closed: false, open: row.open, close: row.close };
}

function cleanBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => toMin(b?.from) != null && toMin(b?.to) != null && toMin(b.to) > toMin(b.from))
    .slice(0, MAX_BLOCKS)
    .map((b) => ({ from: fromMin(toMin(b.from)), to: fromMin(toMin(b.to)) }));
}

/**
 * What a business-local date looks like:
 *   { date, open, close, closed, show, note, rule, blocks: [{from,to}], special }
 * `special` is true when a rule changed the day at all.
 */
export function hoursFor(schedule, date) {
  const { dow } = parts(date);
  const base = weeklyFor(schedule, dow);
  const rule = ruleFor(schedule, date);
  const out = {
    date,
    open: base.open,
    close: base.close,
    closed: base.closed,
    show: null,
    note: null,
    rule: null,
    blocks: [],
    special: false,
    weeklyClosed: base.closed,
  };
  if (!rule) return out;

  if (rule.what === 'closed') {
    return { ...out, open: null, close: null, closed: true, show: rule.show || 'unavailable', note: rule.note || null, rule, special: true };
  }
  if (rule.what === 'hours') {
    if (toMin(rule.open) == null || toMin(rule.close) == null) return out;
    return {
      ...out,
      open: rule.open,
      close: rule.close,
      closed: false,
      show: rule.show || 'unavailable',
      note: rule.note || null,
      rule,
      blocks: cleanBlocks(rule.blocks),
      special: true,
    };
  }
  if (rule.what === 'block') {
    // A block on a day that's closed anyway changes nothing.
    if (base.closed) return out;
    return { ...out, show: rule.show || 'unavailable', note: rule.note || null, rule, blocks: cleanBlocks(rule.blocks), special: true };
  }
  return out;
}

/** Open window of a day as epoch ms [start, end), or null when closed. */
export function openWindow(info) {
  if (!info || info.closed || !info.open || !info.close) return null;
  const start = localMs(info.date, info.open);
  let end = localMs(info.date, info.close);
  if (end <= start) end += 24 * 3600000;
  return [start, end];
}

/** The day's blocked periods as epoch ms ranges. */
export function blockedRanges(info) {
  return (info?.blocks || []).map((b) => [localMs(info.date, b.from), localMs(info.date, b.to)]);
}

/** Open minutes minus blocked minutes, for occupancy. */
export function bookableMinutes(info) {
  const win = openWindow(info);
  if (!win) return 0;
  const blocked = blockedRanges(info).reduce((s, [a, b]) => s + Math.max(0, Math.min(b, win[1]) - Math.max(a, win[0])), 0);
  return Math.max(0, (win[1] - win[0] - blocked) / 60000);
}

function fmtRange(blocks) {
  return blocks.map((b) => `${time12(b.from)} to ${time12(b.to)}`).join(', ');
}

/**
 * Can a booking run from `startIso` to `endIso`? Returns null when it fits the
 * schedule, otherwise { code, message } in plain language. `publicView` keeps
 * private notes out of the message.
 */
export function checkWindow(schedule, startIso, endIso, { publicView = true } = {}) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const date = localDate(new Date(start));
  const info = hoursFor(schedule, date);
  const note = info.note && !(publicView && info.show === 'booked') ? ` (${info.note})` : '';

  if (info.closed) {
    if (info.show === 'booked') return { code: 'full', message: 'That day is fully booked.' };
    return { code: 'closed', message: `We're closed on that day${note}.` };
  }
  const win = openWindow(info);
  if (!win || start < win[0] || end > win[1]) {
    return {
      code: 'hours',
      message: `We're open ${time12(info.open)} to ${time12(info.close)} that day. Pick a time inside those hours.`,
    };
  }
  const clash = blockedRanges(info).find(([a, b]) => start < b && end > a);
  if (clash) {
    if (info.show === 'booked') return { code: 'blocked', message: 'Part of that time is already booked. Try another slot.' };
    return { code: 'blocked', message: `We can't host bookings from ${fmtRange(info.blocks)} that day${note}.` };
  }
  return null;
}

// ---------------------------------------------------------------- words

function ordinal(n) {
  if (n === -1) return 'last';
  return ['', 'first', 'second', 'third', 'fourth', 'fifth'][n] || `${n}th`;
}

function dayOrdinal(n) {
  if (n === -1) return 'last day';
  const s = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${s}`;
}

export function longDate(date) {
  if (!date) return '';
  return new Date(`${date}T12:00:00${TZ_OFFSET}`).toLocaleDateString('en-PH', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** "Every 3rd Saturday of August", "Dec 24, 2026", ... */
export function describeWhen(rule) {
  const monthName = (m) => (Number(m) ? MONTH_NAMES[Number(m) - 1] : null);
  switch (rule?.repeat) {
    case 'once':
      return longDate(rule.date);
    case 'range':
      if (rule.yearly) {
        const f = new Date(`2000-${rule.from?.slice(5)}T12:00:00Z`);
        const t = new Date(`2000-${rule.to?.slice(5)}T12:00:00Z`);
        const fmt = (d) => d.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' });
        return `Every year, ${fmt(f)} to ${fmt(t)}`;
      }
      return `${longDate(rule.from)} to ${longDate(rule.to)}`;
    case 'yearly':
      return `Every ${monthName(rule.month)} ${Number(rule.day) === -1 ? '(last day)' : rule.day}`;
    case 'monthly':
      return `The ${dayOrdinal(Number(rule.day))} of ${monthName(rule.month) || 'every month'}`;
    case 'nthWeekday':
      return `The ${ordinal(Number(rule.nth))} ${DOW_NAMES[Number(rule.weekday)]} of ${monthName(rule.month) || 'every month'}`;
    case 'weekOfMonth': {
      const w = Number(rule.week);
      const span = w === -1 ? 'the last 7 days' : `days ${(w - 1) * 7 + 1} to ${w * 7}`;
      return `${span[0].toUpperCase()}${span.slice(1)} of ${monthName(rule.month) || 'every month'}`;
    }
    default:
      return 'Unknown rule';
  }
}

export function describeWhat(rule) {
  if (!rule) return '';
  if (rule.what === 'closed') return rule.show === 'booked' ? 'Closed (shown as fully booked)' : 'Closed';
  if (rule.what === 'hours') {
    const base = `Open ${time12(rule.open)} to ${time12(rule.close)}`;
    const blocks = cleanBlocks(rule.blocks);
    return blocks.length ? `${base}, off ${fmtRange(blocks)}` : base;
  }
  if (rule.what === 'block') {
    const blocks = cleanBlocks(rule.blocks);
    return `Off ${fmtRange(blocks)}${rule.show === 'booked' ? ' (shown as booked)' : ''}`;
  }
  return '';
}

/** The next date on or after `from` that the rule covers, within ~2 years. */
export function nextOccurrence(rule, from = todayLocal()) {
  let d = from;
  for (let i = 0; i < 800; i++) {
    if (ruleMatches(rule, d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

/** Validate and normalise a rule from the dashboard. Returns { rule } or { error }. */
export function normaliseRule(input) {
  const r = { ...input };
  if (!REPEATS.includes(r.repeat)) return { error: 'Pick when the rule repeats.' };
  if (!['closed', 'hours', 'block'].includes(r.what)) return { error: 'Pick what happens on those dates.' };
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (r.repeat === 'once' && !isDate(r.date)) return { error: 'Pick the date.' };
  if (r.repeat === 'range' && (!isDate(r.from) || !isDate(r.to))) return { error: 'Pick both ends of the range.' };
  if (r.repeat === 'range' && !r.yearly && r.to < r.from) return { error: 'The range ends before it starts.' };
  if (r.what === 'hours' && (toMin(r.open) == null || toMin(r.close) == null)) return { error: 'Set the special opening hours.' };
  if (r.what === 'block') {
    r.blocks = cleanBlocks(r.blocks);
    if (!r.blocks.length) return { error: 'Add at least one period that is off.' };
  }
  if (r.what === 'hours') r.blocks = cleanBlocks(r.blocks);
  if (r.what !== 'hours' && r.what !== 'block') delete r.blocks;
  if (r.what === 'hours') r.show = 'unavailable';
  r.show = r.show === 'booked' ? 'booked' : 'unavailable';
  r.note = typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '';
  if (!r.id) r.id = Math.random().toString(36).slice(2, 10);
  return { rule: r };
}
