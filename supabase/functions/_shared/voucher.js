// Voucher maths and rules, shared by the booking form (live preview), the
// dashboard (plain-language summary, status) and the Edge Functions (the check
// that counts). Validity is judged against the BOOKING's start date, not today.

export const KINDS = {
  percent: 'Percent off',
  amount: 'Amount off',
  free_units: 'Free hours',
  free: 'Free session',
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function normaliseCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
}

const peso = (n) => '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');

/**
 * Discount in pesos for a booking. `list` is the full list price, `units` the
 * booked hours and `baseRate` the hourly room rate. Never below 0, never above
 * the list price.
 */
export function computeDiscount(v, { list, units, baseRate }) {
  const value = Number(v?.value) || 0;
  let d = 0;
  if (v.kind === 'percent') d = Math.round((list * Math.min(value, 100)) / 100);
  else if (v.kind === 'amount') d = value;
  else if (v.kind === 'free_units') d = Math.min(units, value) * baseRate;
  else if (v.kind === 'free') d = list;
  return Math.max(0, Math.min(list, Math.round(d)));
}

/** Short label: "20% off", "₱200 off", "2 free hours", "Free session". */
export function voucherLabel(v) {
  const value = Number(v?.value) || 0;
  if (v.kind === 'percent') return `${value}% off`;
  if (v.kind === 'amount') return `${peso(value)} off`;
  if (v.kind === 'free_units') return `${value} free hour${value === 1 ? '' : 's'}`;
  return 'Free session';
}

/** Conditions in words, for customers and staff alike. */
export function describeConditions(v) {
  const out = [];
  if (v.kind === 'free_units') out.push('add-ons are still charged');
  if (Number(v.min_units) > 0) out.push(`bookings of ${v.min_units} hour${Number(v.min_units) === 1 ? '' : 's'} or more`);
  if (Array.isArray(v.weekdays) && v.weekdays.length && v.weekdays.length < 7) {
    out.push(`on ${v.weekdays.map((d) => DOW[d]).join(', ')}`);
  }
  if (v.valid_from && v.valid_until) out.push(`for sessions ${v.valid_from} to ${v.valid_until}`);
  else if (v.valid_from) out.push(`for sessions from ${v.valid_from}`);
  else if (v.valid_until) out.push(`for sessions until ${v.valid_until}`);
  if (v.per_customer) out.push(`${v.per_customer} use${v.per_customer === 1 ? '' : 's'} per customer`);
  if (v.max_uses) out.push(`${v.max_uses} uses in total`);
  return out;
}

/**
 * Can this voucher apply to a booking starting on business-local `date` and
 * lasting `units` hours? `uses` = non-cancelled bookings carrying the code,
 * `customerUses` = the same for this customer. Returns null when fine,
 * otherwise a reason a customer can read.
 */
export function voucherProblem(v, { date, units, uses = 0, customerUses = 0 }) {
  if (!v) return "We don't recognise that code.";
  if (!v.active) return 'That code is paused right now.';
  if (v.valid_from && date < v.valid_from) return `That code works for sessions from ${v.valid_from}.`;
  if (v.valid_until && date > v.valid_until) return 'That code has expired.';
  if (Array.isArray(v.weekdays) && v.weekdays.length && v.weekdays.length < 7) {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!v.weekdays.includes(dow)) return `That code only works on ${v.weekdays.map((d) => DOW[d]).join(', ')}.`;
  }
  if (Number(v.min_units) > 0 && units < Number(v.min_units)) {
    return `That code needs a booking of at least ${v.min_units} hour${Number(v.min_units) === 1 ? '' : 's'}.`;
  }
  if (v.max_uses && uses >= v.max_uses) return 'That code has been used up.';
  if (v.per_customer && customerUses >= v.per_customer) return "You've already used that code.";
  return null;
}

/** Dashboard status: Active, Paused, Starts later, Expired, Used up. */
export function voucherStatus(v, { today, uses = 0 }) {
  if (!v.active) return 'Paused';
  if (v.max_uses && uses >= v.max_uses) return 'Used up';
  if (v.valid_until && today > v.valid_until) return 'Expired';
  if (v.valid_from && today < v.valid_from) return 'Starts later';
  return 'Active';
}

export function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  buf.forEach((n) => { s += chars[n % chars.length]; });
  return s;
}
