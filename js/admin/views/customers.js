// Front desk > Customers: one row per person with their history. Derived from
// bookings (cancelled ones excluded), grouped by email, then phone, then name,
// and joined to registered accounts by account, then phone, then email.
// Accounts that never booked get their own rows.

import {
  api, btn, confirmDialog, createList, customerName, digits, effectiveStatus, fmtDate, fmtWhen, fn, h, hours, hrs, icon,
  openDialog, pageHead, paidAmount, peso, pill, q, ref, run, sb, STATUS_LABEL, STATUS_TONE, toast,
} from '../core.js';
import { BOOKING_SELECT } from './booking-dialogs.js';

export async function render(root) {
  const supabase = await sb();
  let customers = [];

  const summary = h('p', { class: 'muted' });
  const list = createList({
    key: 'customers',
    searchPlaceholder: 'Name, email or phone',
    chips: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'registered', label: 'Registered', test: (c) => !!c.account },
      { id: 'guests', label: 'Guests', test: (c) => !c.account },
      { id: 'repeat', label: 'Repeat', test: (c) => c.bookings.length > 1 },
      { id: 'none', label: 'No bookings', test: (c) => !c.bookings.length },
    ],
    sorts: [
      ['newest', 'Newest first', (a, b) => (b.since || '').localeCompare(a.since || '')],
      ['oldest', 'Oldest first', (a, b) => (a.since || '').localeCompare(b.since || '')],
      ['latest', 'Latest booking', (a, b) => (b.last || '').localeCompare(a.last || '')],
      ['most', 'Most bookings', (a, b) => b.bookings.length - a.bookings.length],
      ['paid', 'Most paid', (a, b) => b.paid - a.paid],
      ['name', 'Name A to Z', (a, b) => a.name.localeCompare(b.name)],
    ],
    search: (c) => `${c.name} ${c.email || ''}`,
    digits: (c) => digits(c.phone),
    empty: { iconName: 'users', title: 'No customers yet', text: 'People appear here after their first booking or sign-up.' },
    columns: [
      { label: 'Customer', render: (c) => h('div', {}, h('button', { type: 'button', class: 'link-btn cell-title', onclick: () => openCustomer(c) }, c.name), c.account ? h('div', { class: 'tags' }, pill(c.account.verified ? 'Registered' : 'Registered, email unverified', c.account.verified ? 'teal' : 'warn', 'user-circle')) : null) },
      { label: 'Contact', render: (c) => h('div', {}, c.phone ? h('div', {}, h('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, c.phone)) : null, c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : null) },
      { label: 'Bookings', cls: 'num', render: (c) => String(c.bookings.length) },
      { label: 'Hours', cls: 'num', render: (c) => hrs(c.hours) },
      { label: 'Add-ons', cls: 'num', render: (c) => String(c.addons) },
      { label: 'Paid', cls: 'num', render: (c) => peso(c.paid) },
      { label: 'Last booking', render: (c) => c.last ? fmtDate(c.last) : h('span', { class: 'faint' }, '—') },
      { label: 'Since', render: (c) => c.since ? fmtDate(c.since) : '—' },
    ],
    card: (c) => h('button', { type: 'button', class: 'card', style: 'text-align:left;color:inherit;width:100%', onclick: () => openCustomer(c) },
      h('div', { class: 'card-row' }, h('div', {}, h('div', { class: 'cell-title' }, c.name), h('div', { class: 'cell-sub' }, [c.phone, c.email].filter(Boolean).join(' · '))),
        c.account ? pill('Registered', 'teal') : null),
      h('div', { class: 'card-meta' }, h('span', {}, `${c.bookings.length} bookings`), h('span', {}, hrs(c.hours)), h('span', {}, `${peso(c.paid)} paid`), c.last ? h('span', {}, `Last ${fmtDate(c.last)}`) : null)),
  });

  function group(bookings, accounts) {
    const people = new Map();
    const keyOf = (b) => {
      const e = (b.guest_email || '').toLowerCase();
      const p = digits(b.guest_phone || b.profiles?.phone).slice(-10);
      if (b.customer_id) return `acct:${b.customer_id}`;
      if (e) return `email:${e}`;
      if (p.length >= 7) return `phone:${p}`;
      return `name:${customerName(b).toLowerCase()}`;
    };
    bookings.filter((b) => b.status !== 'cancelled').forEach((b) => {
      const k = keyOf(b);
      if (!people.has(k)) people.set(k, { key: k, name: customerName(b), email: b.guest_email || null, phone: b.guest_phone || b.profiles?.phone || null, customerId: b.customer_id, bookings: [] });
      const p = people.get(k);
      p.bookings.push(b);
      if (!p.email && b.guest_email) p.email = b.guest_email;
      if (!p.phone && b.guest_phone) p.phone = b.guest_phone;
    });
    // Join accounts: by account id, then phone, then email.
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const used = new Set();
    for (const p of people.values()) {
      let acct = p.customerId ? byId.get(p.customerId) : null;
      if (!acct && p.phone) acct = accounts.find((a) => !used.has(a.id) && a.phone && digits(a.phone).slice(-10) === digits(p.phone).slice(-10));
      if (!acct && p.email) acct = accounts.find((a) => !used.has(a.id) && a.email && a.email.toLowerCase() === p.email.toLowerCase());
      if (acct) { p.account = acct; used.add(acct.id); p.email = p.email || acct.email; p.name = acct.name || p.name; }
    }
    accounts.filter((a) => !used.has(a.id)).forEach((a) => people.set(`acct:${a.id}`, { key: `acct:${a.id}`, name: a.name || a.email || 'Unnamed', email: a.email, phone: a.phone, account: a, bookings: [] }));

    return [...people.values()].map((p) => {
      const done = p.bookings.filter((b) => effectiveStatus(b) === 'completed');
      const starts = p.bookings.map((b) => b.created_at).sort();
      const sinceCandidates = [starts[0], p.account?.created_at].filter(Boolean).sort();
      return {
        ...p,
        id: p.key,
        hours: p.bookings.reduce((s, b) => s + hours(b), 0),
        addons: p.bookings.reduce((s, b) => s + (b.booking_services || []).length, 0),
        paid: done.reduce((s, b) => s + Math.min(paidAmount(b), Number(b.total_price)), 0),
        last: p.bookings.map((b) => b.start_at).sort().pop() || null,
        since: sinceCandidates[0] || null,
      };
    });
  }

  function openCustomer(c) {
    const history = c.bookings.slice().sort((a, b) => b.start_at.localeCompare(a.start_at));
    openDialog({
      title: c.name,
      sub: [c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details',
      size: 'wide',
      body: h('div', { class: 'stack' },
        h('div', { class: 'tiles', style: 'margin:0' },
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Bookings'), h('span', { class: 'tile-value' }, c.bookings.length)),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Hours'), h('span', { class: 'tile-value' }, hrs(c.hours))),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Paid'), h('span', { class: 'tile-value' }, peso(c.paid))),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Customer since'), h('span', { class: 'tile-value', style: 'font-size:1.1rem' }, c.since ? fmtDate(c.since) : '—'))),
        c.account ? h('div', { class: 'banner', style: 'margin:0' }, icon('user-circle'), h('div', {}, `Registered account${c.account.verified ? '' : ' (email not verified yet)'}. Signed up ${fmtDate(c.account.created_at)}.`)) : null,
        h('h3', { class: 'section-title' }, 'History'),
        history.length ? h('div', { class: 'list' }, history.map((b) => h('div', { class: 'list-item' },
          h('div', { style: 'flex:1' }, h('div', { class: 'cell-title' }, fmtWhen(b.start_at, b.end_at)), h('div', { class: 'cell-sub' }, `${ref(b.id)} · ${(b.booking_services || []).map((s) => s.services?.name).join(', ') || 'Room only'}`)),
          pill(STATUS_LABEL[effectiveStatus(b)], STATUS_TONE[effectiveStatus(b)]),
          h('span', { class: 'num', style: 'min-width:70px' }, peso(b.total_price)),
          btn('Open', { size: 'sm', onClick: () => { location.hash = `#/bookings?b=${b.id}`; document.querySelector('dialog.dlg')?.close(); } }))))
          : h('p', { class: 'muted' }, 'No bookings yet.'),
        c.account ? h('div', { class: 'panel panel-pad stack', style: 'border-color:color-mix(in srgb, var(--danger) 35%, transparent)' },
          h('strong', {}, 'Delete this account'),
          h('p', { class: 'muted' }, 'For erasure requests under the Data Privacy Act. Erases their login, personal details, ID photos and receipts. Past sessions stay in the books as anonymous walk-ins.'),
          h('div', {}, btn('Delete account', { kind: 'danger', iconName: 'trash', onClick: () => deleteAccount(c) }))) : null),
      foot: (d) => [btn('Close', { onClick: () => d.close() })],
    });
  }

  async function deleteAccount(c, force = false) {
    if (!force && !(await confirmDialog({ title: `Delete ${c.name}'s account?`, message: 'Their login, personal details, ID photos and receipts are erased for good. This cannot be undone.', confirmLabel: 'Delete account', danger: true }))) return;
    try {
      await fn('delete-account', { user_id: c.account.id, force });
      toast('Account deleted.');
      document.querySelector('dialog.dlg')?.close();
      await reload();
    } catch (err) {
      if (err.can_force && await confirmDialog({ title: 'Are you sure?', message: `${err.error}\n\nDelete the account anyway?`, confirmLabel: 'Delete anyway', danger: true })) return deleteAccount(c, true);
      if (!err.can_force) toast(err.message, 'error');
    }
  }

  async function reload() {
    const [bookings, accounts] = await Promise.all([
      q(supabase.from('bookings').select(BOOKING_SELECT).limit(5000)),
      api('customers.list').then((r) => r.customers || []).catch(() => []),
    ]);
    customers = group(bookings || [], accounts);
    const registered = customers.filter((c) => c.account).length;
    summary.textContent = `${customers.length} customers, ${registered} of them registered.`;
    list.setItems(customers);
  }

  root.append(pageHead('Customers', null), summary, h('div', { style: 'height:12px' }), list.el);
  await run(null, reload).catch(() => {});
}
