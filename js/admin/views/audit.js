// Reports > Audit log: every change, newest first. Read-only by construction:
// no client role can insert, edit or delete these rows. Field changes show the
// old value struck through; creates and deletes keep a snapshot.

import { btn, clear, fmtDateTime, h, icon, pageHead, peso, q, ref, sb, setParam, empty } from '../core.js';

const PAGE = 60;
const ACTIONS = {
  'booking.create': ['calendar-plus', 'New booking'],
  'booking.edit': ['pencil-simple', 'Booking edited'],
  'booking.update': ['pencil-simple', 'Booking edited'],
  'booking.reschedule': ['calendar-dots', 'Booking moved'],
  'booking.status': ['arrows-clockwise', 'Booking status'],
  'booking.cancel': ['x-circle', 'Booking cancelled'],
  'booking.delete': ['trash', 'Booking deleted'],
  'booking.id': ['identification-card', 'ID check'],
  'payment.mark_paid': ['money', 'Payment recorded'],
  'payment.verify': ['check-circle', 'Receipt approved'],
  'payment.reject': ['x-circle', 'Receipt rejected'],
  'payment.refund': ['arrow-u-up-left', 'Refund'],
  'email.send': ['envelope-simple', 'Email sent'],
  'mail.send': ['paper-plane-tilt', 'Inbox reply'],
  'mailing.edit': ['user-plus', 'Mailing list'],
  'mailing.send': ['megaphone', 'Campaign sent'],
  'schedule.edit': ['clock', 'Schedule saved'],
  'feedback.create': ['star', 'New review'],
  'admin.add': ['user-plus', 'Staff added'],
  'admin.remove': ['user-minus', 'Staff removed'],
  'staff.invite': ['user-plus', 'Staff invited'],
  'profiles.role_change': ['shield-check', 'Role changed'],
  'account.delete': ['user-minus', 'Account deleted'],
};

function labelFor(action) {
  if (ACTIONS[action]) return ACTIONS[action];
  const [table, op] = action.split('.');
  const nice = { app_settings: 'Settings', staff_settings: 'Private settings', vouchers: 'Voucher', services: 'Add-on', rooms: 'Room', operating_hours: 'Weekly hours', feedback: 'Review', blocked_slots: 'Blocked time' }[table] || table;
  return [op === 'delete' ? 'trash' : op === 'insert' ? 'plus' : 'pencil-simple', `${nice} ${op === 'insert' ? 'added' : op === 'delete' ? 'deleted' : 'changed'}`];
}

function show(v) {
  if (v == null || v === '') return '(empty)';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 140);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return fmtDateTime(s);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

function summary(row) {
  const d = row.detail || {};
  if (d.summary) return d.summary;
  switch (row.action) {
    case 'booking.create': return `${d.snapshot?.guest_name || 'A customer'} booked ${d.snapshot?.start_at ? fmtDateTime(d.snapshot.start_at) : ''}, ${peso(d.snapshot?.total_price ?? d.total_price)}${d.via === 'staff' ? ' (added by staff)' : ''}`;
    case 'payment.verify': return `${peso(d.amount)} approved${d.booking_confirmed ? ', booking confirmed' : ''}`;
    case 'payment.reject': return `Reason: ${d.reason || '—'}`;
    case 'payment.refund': return `${peso(d.amount)} refunded`;
    case 'payment.mark_paid': return `${peso(d.amount)} recorded`;
    case 'profiles.role_change': return `${d.subject_name || 'Someone'}: ${d.from} to ${d.to}`;
    case 'staff.invite': return `${d.email} invited as ${d.role}`;
    default: return null;
  }
}

function changes(row) {
  const d = row.detail || {};
  let list = Array.isArray(d.changes) ? d.changes : null;
  if (!list && d.changed) list = Object.entries(d.changed).map(([field, v]) => ({ field, from: v.from, to: v.to }));
  if (!list && d.from && d.to) list = Object.keys(d.to).filter((k) => JSON.stringify(d.from[k]) !== JSON.stringify(d.to[k])).map((k) => ({ field: k, from: d.from[k], to: d.to[k] }));
  if (!list?.length) return null;
  return h('div', { class: 'stack', style: 'gap:2px;margin-top:6px;font-size:0.86rem' }, list.slice(0, 12).map((c) => h('div', {},
    h('span', { class: 'faint' }, `${String(c.field).replace(/_/g, ' ')}: `), h('span', { class: 'diff-old' }, show(c.from)), ' → ', h('span', { class: 'diff-new' }, show(c.to)))));
}

export async function render(root, params) {
  const supabase = await sb();
  const listBox = h('div', { class: 'panel' });
  const more = btn('Load older entries', { onClick: () => load(false) });
  let oldest = null;
  let rows = [];

  async function load(reset) {
    if (reset) { rows = []; oldest = null; }
    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(PAGE);
    if (oldest) query = query.lt('created_at', oldest);
    if (params.booking) query = query.or(`entity_id.eq.${params.booking},detail->>booking_id.eq.${params.booking}`);
    const page = await q(query) || [];
    rows = rows.concat(page);
    oldest = page.length ? page[page.length - 1].created_at : oldest;
    more.hidden = page.length < PAGE;
    draw();
  }

  function draw() {
    clear(listBox);
    if (!rows.length) return listBox.appendChild(empty({ iconName: 'list-magnifying-glass', title: 'Nothing logged yet' }));
    listBox.appendChild(h('div', { class: 'list', style: 'padding:4px 18px' }, rows.map((r) => {
      const [ico, label] = labelFor(r.action);
      const snap = r.detail?.snapshot || r.detail?.created || r.detail?.deleted;
      return h('div', { class: 'list-item' },
        h('span', { class: 'avatar' }, icon(ico)),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'row', style: 'gap:8px' }, h('strong', {}, label),
            r.entity_type === 'booking' && r.entity_id ? h('a', { class: 'code-tag', href: `#/bookings?b=${r.entity_id}` }, ref(r.entity_id)) : null),
          summary(r) ? h('div', { class: 'muted', style: 'font-size:0.9rem' }, summary(r)) : null,
          changes(r),
          snap && !r.detail?.changes ? h('details', { class: 'more', style: 'margin-top:6px' }, h('summary', {}, 'Show record'), h('pre', { class: 'snapshot' }, JSON.stringify(snap, null, 2))) : null),
        h('div', { class: 'audit-who' }, h('div', { class: 'cell-title', style: 'font-size:0.88rem' }, r.actor_label), h('div', { class: 'cell-sub' }, `${r.actor_role} · ${fmtDateTime(r.created_at)}`)));
    })));
  }

  root.append(
    pageHead('Audit log', params.booking ? `Showing the history of booking ${ref(params.booking)}.` : 'Every change made in the dashboard, by the website, or by the system.',
      params.booking ? [btn('Show everything', { onClick: () => { setParam('booking', null); params.booking = null; load(true); } })] : []),
    listBox, h('div', { style: 'margin-top:12px' }, more));
  await load(true);
}
