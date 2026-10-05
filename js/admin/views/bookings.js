// Front desk > Bookings: see, confirm, edit, cancel and settle every booking.

import {
  btn, createList, customerName, effectiveStatus, fmtDate, fmtTime, h, hours, hrs, icon, idState, loadCatalog,
  pageHead, paidAmount, paymentState, peso, pill, q, ref, sb, setParam, showMenu, digits, STATUS_LABEL, STATUS_TONE, copy, TZ,
} from '../core.js';
import {
  BOOKING_SELECT, deleteBooking, openBookingForm, openCancel, openEmail, payCell, setStatus,
} from './booking-dialogs.js';
import { localDate } from '../../../supabase/functions/_shared/schedule.js';

const SORTS = [
  ['newest', 'Newest first', (a, b) => b.created_at.localeCompare(a.created_at)],
  ['oldest', 'Oldest first', (a, b) => a.created_at.localeCompare(b.created_at)],
  ['start_late', 'Session date, latest', (a, b) => b.start_at.localeCompare(a.start_at)],
  ['start_early', 'Session date, earliest', (a, b) => a.start_at.localeCompare(b.start_at)],
  ['name', 'Name A to Z', (a, b) => customerName(a).localeCompare(customerName(b))],
  ['total', 'Highest total', (a, b) => Number(b.total_price) - Number(a.total_price)],
];

export async function render(root, params) {
  await loadCatalog();
  const supabase = await sb();
  let bookings = [];

  const tiles = h('div', { class: 'tiles' });
  const list = createList({
    key: 'bookings',
    searchPlaceholder: 'Name, email, phone or ref',
    chips: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'pending', label: 'Pending', test: (b) => effectiveStatus(b) === 'pending', attention: true },
      { id: 'upcoming', label: 'Upcoming', test: (b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.end_at) > new Date() },
      { id: 'confirmed', label: 'Confirmed', test: (b) => effectiveStatus(b) === 'confirmed' },
      { id: 'completed', label: 'Completed', test: (b) => effectiveStatus(b) === 'completed' },
      { id: 'cancelled', label: 'Cancelled', test: (b) => b.status === 'cancelled' },
      { id: 'no_show', label: 'No-show', test: (b) => b.status === 'no_show' },
      { id: 'review', label: 'Payment to verify', test: (b) => paymentState(b) === 'review', attention: true },
      { id: 'id', label: 'ID to check', test: (b) => idState(b) === 'pending' && b.status !== 'cancelled', attention: true },
      { id: 'waived', label: 'Waived', test: (b) => b.payment_waived },
    ],
    sorts: SORTS,
    search: (b) => [customerName(b), b.guest_email, ref(b.id), b.notes, b.voucher?.code].filter(Boolean).join(' '),
    digits: (b) => digits(b.guest_phone || b.profiles?.phone),
    rowClass: (b) => (b.id === params.b ? 'highlight' : ''),
    empty: { iconName: 'calendar-blank', title: 'No bookings yet', text: 'Bookings from the website and the ones you add by hand show up here.' },
    columns: [
      { label: 'When', render: whenCell },
      { label: 'Customer', render: customerCell },
      { label: 'Contact', render: contactCell },
      { label: 'Add-ons', render: addonsCell },
      { label: 'Total', cls: 'num', render: totalCell },
      { label: 'Payment', render: (b) => payCell(b, reload) },
      { label: 'Status', render: (b) => pill(STATUS_LABEL[effectiveStatus(b)], STATUS_TONE[effectiveStatus(b)]) },
      { label: '', cls: 'num', render: actionsCell },
    ],
    card: (b) => h('div', { class: 'card', 'data-id': b.id, style: b.id === params.b ? 'border-color:var(--gold)' : null },
      h('div', { class: 'card-row' }, h('div', {}, h('div', { class: 'cell-title' }, customerName(b)), whenCell(b)),
        h('div', { style: 'text-align:right' }, totalCell(b), pill(STATUS_LABEL[effectiveStatus(b)], STATUS_TONE[effectiveStatus(b)]))),
      h('div', { class: 'card-meta' }, contactCell(b), addonsCell(b)),
      h('div', { style: 'margin-top:10px' }, payCell(b, reload)),
      h('div', { class: 'cell-actions' }, actionsCell(b))),
    afterRender: () => {
      if (params.b) root.querySelector(`[data-id="${params.b}"]`)?.scrollIntoView({ block: 'center' });
    },
  });

  function whenCell(b) {
    return h('div', {},
      h('div', { class: 'cell-title nowrap' }, fmtDate(b.start_at, { weekday: 'short', year: undefined })),
      h('div', { class: 'cell-sub nowrap' }, `${fmtTime(b.start_at)} to ${fmtTime(b.end_at)}, ${hrs(hours(b))}`),
      h('div', { class: 'cell-sub' }, h('button', { type: 'button', class: 'code-tag', title: 'Copy reference', onclick: () => copy(ref(b.id)) }, ref(b.id))));
  }
  function customerCell(b) {
    return h('div', {},
      h('div', { class: 'cell-title' }, customerName(b), b.customer_id ? h('span', { class: 'faint', title: 'Registered account' }, ' ', icon('user-circle')) : null),
      b.notes ? h('div', { class: 'cell-sub', style: 'max-width:28ch' }, icon('note'), ' ', b.notes) : null,
      b.via === 'staff' ? h('div', { class: 'cell-sub' }, 'Added by staff') : null);
  }
  function contactCell(b) {
    const phone = b.guest_phone || b.profiles?.phone;
    return h('div', { style: 'display:flex;flex-direction:column;gap:2px' },
      phone ? h('a', { href: `tel:${phone.replace(/[^\d+]/g, '')}`, class: 'nowrap' }, icon('phone'), ' ', phone) : null,
      b.guest_email ? h('a', { href: `mailto:${b.guest_email}`, style: 'overflow-wrap:anywhere' }, b.guest_email) : null,
      !phone && !b.guest_email ? h('span', { class: 'faint' }, '—') : null);
  }
  function addonsCell(b) {
    const items = (b.booking_services || []).map((bs) => bs.services?.price_type === 'unit' ? `${bs.services.name} ×${bs.quantity}` : bs.services?.name).filter(Boolean);
    return items.length ? h('div', { class: 'tags', style: 'margin:0' }, items.map((t) => pill(t))) : h('span', { class: 'faint' }, '—');
  }
  function totalCell(b) {
    const addons = (b.booking_services || []).reduce((s, bs) => s + Number(bs.price_at_booking || 0), 0);
    return h('div', {},
      h('div', { class: 'cell-title' }, peso(b.total_price)),
      b.voucher ? h('div', { class: 'cell-sub' }, `${b.voucher.code} −${peso(b.voucher.discount)}`) : null,
      b.custom_total ? h('div', { class: 'cell-sub' }, 'Set by hand') : null,
      addons ? h('div', { class: 'cell-sub' }, `incl. ${peso(addons)} add-ons`) : null);
  }
  function actionsCell(b) {
    const st = effectiveStatus(b);
    const more = btn('', { kind: 'ghost', size: 'sm', iconName: 'dots-three', aria: 'More actions' });
    more.addEventListener('click', () => showMenu(more, [
      { label: 'Edit', icon: 'pencil-simple', onClick: () => openBookingForm(b).then((ok) => ok && reload()) },
      { label: 'Send email', icon: 'envelope-simple', onClick: () => openEmail(b) },
      st === 'confirmed' || st === 'completed' ? { label: 'Mark completed', icon: 'check-circle', onClick: () => setStatus(b, 'completed', reload) } : null,
      ['confirmed', 'completed'].includes(st) ? { label: 'Mark no-show', icon: 'user-minus', onClick: () => setStatus(b, 'no_show', reload) } : null,
      b.status === 'cancelled' ? { label: 'Revive as pending', icon: 'arrow-counter-clockwise', onClick: () => setStatus(b, 'pending', reload) } : null,
      { label: 'Make receipt image', icon: 'receipt', onClick: () => { location.hash = `#/graphics?receipt=${b.id}`; } },
      { label: 'Copy reference', icon: 'copy', onClick: () => copy(ref(b.id)) },
      { label: 'View audit trail', icon: 'list-magnifying-glass', onClick: () => { location.hash = `#/audit?booking=${b.id}`; } },
      'sep',
      b.status !== 'cancelled' ? { label: 'Cancel booking', icon: 'x-circle', danger: true, onClick: () => openCancel(b).then((ok) => ok && reload()) } : null,
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteBooking(b, reload) },
    ]));
    return h('div', { class: 'cell-actions' },
      st === 'pending' ? btn('Confirm', { size: 'sm', kind: 'primary', onClick: () => setStatus(b, 'confirmed', reload) }) : null,
      btn('', { size: 'sm', iconName: 'pencil-simple', aria: 'Edit', onClick: () => openBookingForm(b).then((ok) => ok && reload()) }),
      more);
  }

  function renderTiles() {
    const today = localDate(new Date());
    const live = bookings.filter((b) => b.status !== 'cancelled');
    const pending = live.filter((b) => effectiveStatus(b) === 'pending').length;
    const upcoming = live.filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.end_at) > new Date()).length;
    const todays = live.filter((b) => localDate(b.start_at) === today && b.status !== 'no_show');
    const addonsToday = todays.flatMap((b) => (b.booking_services || []).map((bs) => bs.services?.name)).filter(Boolean);
    const revenue = bookings.filter((b) => effectiveStatus(b) === 'completed').reduce((s, b) => s + Math.min(paidAmount(b), Number(b.total_price)), 0);
    const review = bookings.filter((b) => paymentState(b) === 'review').length;
    const tile = (label, value, sub, iconName, cls, onClick) => h(onClick ? 'button' : 'div', { class: `tile ${cls || ''}`, type: onClick ? 'button' : null, onclick: onClick },
      h('span', { class: 'tile-label' }, icon(iconName), label), h('span', { class: 'tile-value' }, value), sub ? h('span', { class: 'tile-sub' }, sub) : null);
    tiles.replaceChildren(
      tile('Pending requests', pending, pending ? 'Waiting for you to confirm' : 'All caught up', 'hourglass', pending ? 'alert' : '', () => list.setChip('pending')),
      tile('Upcoming', upcoming, `${todays.length} today`, 'calendar-check', '', () => list.setChip('upcoming')),
      tile('Add-ons today', addonsToday.length, addonsToday.length ? [...new Set(addonsToday)].join(', ') : 'Nothing to prepare', 'headphones'),
      tile('Revenue', peso(revenue), 'Completed and paid', 'coins', 'accent', () => { location.hash = '#/insights'; }),
      tile('Payments to verify', review, review ? 'Receipts waiting' : 'None waiting', 'receipt', review ? 'alert' : '', () => list.setChip('review')));
  }

  async function reload() {
    bookings = await q(supabase.from('bookings').select(BOOKING_SELECT).order('created_at', { ascending: false }).limit(2000)) || [];
    renderTiles();
    list.setItems(bookings);
    window.dispatchEvent(new Event('ggs:badges'));
  }

  root.append(
    pageHead('Bookings', `Times are Manila time (${TZ}). Confirmed bookings whose time has passed count as completed.`, [
      btn('Add booking', { kind: 'primary', iconName: 'plus', onClick: () => openBookingForm(null).then((ok) => ok && reload()) }),
    ]),
    tiles,
    list.el);
  await reload();

  // Open a booking straight from a deep link (staff notification emails).
  if (params.b) {
    const b = bookings.find((x) => x.id === params.b);
    if (b) setTimeout(() => list.setQuery(ref(b.id)), 0);
  }

  // Live updates while the view is open.
  let t;
  const channel = supabase.channel(`admin-bookings-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { clearTimeout(t); t = setTimeout(reload, 800); })
    .subscribe();
  return {
    destroy() { supabase.removeChannel(channel); },
    onParams(p) { if (p.b) { params.b = p.b; const b = bookings.find((x) => x.id === p.b); if (b) list.setQuery(ref(b.id)); } else setParam('b', null); },
  };
}

