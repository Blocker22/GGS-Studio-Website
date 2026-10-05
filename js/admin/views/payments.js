// Front desk > Payments: every payment row, with online receipts waiting to be
// checked first. Approve or reject a receipt, record cash, refund.

import {
  btn, createList, customerName, fmtDateTime, fn, h, pageHead, peso, pill, promptDialog, q, ref, run, sb, showMenu, digits,
} from '../core.js';
import { loadBooking, openReceipt } from './booking-dialogs.js';

const METHOD = { manual: 'Online transfer', cash: 'At the studio', paymongo: 'PayMongo' };
const STATUS = {
  pending: ['Waiting for receipt', 'quiet'],
  submitted: ['Receipt to check', 'warn'],
  succeeded: ['Paid', 'teal'],
  rejected: ['Rejected', 'danger'],
  failed: ['Failed', 'danger'],
  refunded: ['Refunded', 'quiet'],
  partially_refunded: ['Part refunded', 'gold'],
};

export async function render(root) {
  const supabase = await sb();
  const list = createList({
    key: 'payments',
    searchPlaceholder: 'Name, ref or reference no.',
    chips: [
      { id: 'review', label: 'Receipts to check', test: (p) => p.status === 'submitted', attention: true },
      { id: 'all', label: 'All', test: () => true },
      { id: 'waiting', label: 'Waiting for receipt', test: (p) => p.status === 'pending' && p.method === 'manual' },
      { id: 'paid', label: 'Paid', test: (p) => ['succeeded', 'partially_refunded'].includes(p.status) },
      { id: 'refunded', label: 'Refunded', test: (p) => Number(p.refunded_amount) > 0 },
      { id: 'rejected', label: 'Rejected', test: (p) => p.status === 'rejected' },
    ],
    sorts: [
      ['newest', 'Newest first', (a, b) => (b.submitted_at || b.created_at).localeCompare(a.submitted_at || a.created_at)],
      ['oldest', 'Oldest first', (a, b) => (a.submitted_at || a.created_at).localeCompare(b.submitted_at || b.created_at)],
      ['amount', 'Largest amount', (a, b) => Number(b.amount) - Number(a.amount)],
    ],
    search: (p) => `${p.bookings ? customerName(p.bookings) : ''} ${ref(p.booking_id)} ${p.reference_no || ''} ${p.channel || ''}`,
    digits: (p) => digits(p.reference_no),
    empty: { iconName: 'receipt', title: 'No payments yet', text: 'Online receipts and cash you record show up here.' },
    columns: [
      { label: 'When', render: (p) => h('div', {}, h('div', { class: 'cell-title nowrap' }, fmtDateTime(p.submitted_at || p.created_at)), h('div', { class: 'cell-sub' }, p.submitted_at ? 'Receipt sent' : 'Created')) },
      { label: 'Customer', render: (p) => h('div', {}, h('div', { class: 'cell-title' }, p.bookings ? customerName(p.bookings) : 'Deleted booking'), h('div', { class: 'cell-sub mono' }, ref(p.booking_id))) },
      { label: 'Method', render: (p) => h('div', {}, METHOD[p.method] || p.method, p.channel ? h('div', { class: 'cell-sub' }, p.channel.toUpperCase()) : null, p.reference_no ? h('div', { class: 'cell-sub mono' }, `Ref ${p.reference_no}`) : null) },
      { label: 'For', render: (p) => p.type === 'deposit' ? 'Downpayment' : p.type === 'refund' ? 'Refund' : 'Full' },
      { label: 'Amount', cls: 'num', render: (p) => h('div', {}, h('div', { class: 'cell-title' }, peso(p.amount)), Number(p.refunded_amount) ? h('div', { class: 'cell-sub' }, `${peso(p.refunded_amount)} refunded`) : null) },
      { label: 'Status', render: (p) => h('div', {}, pill(...(STATUS[p.status] || [p.status, ''])), p.rejection_reason ? h('div', { class: 'cell-sub', style: 'max-width:24ch' }, p.rejection_reason) : null) },
      { label: '', cls: 'num', render: actions },
    ],
    card: (p) => h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('div', {}, h('div', { class: 'cell-title' }, p.bookings ? customerName(p.bookings) : 'Deleted booking'), h('div', { class: 'cell-sub' }, `${METHOD[p.method] || p.method} · ${fmtDateTime(p.submitted_at || p.created_at)}`)),
        h('div', { style: 'text-align:right' }, h('div', { class: 'cell-title' }, peso(p.amount)), pill(...(STATUS[p.status] || [p.status, ''])))),
      h('div', { class: 'cell-actions' }, actions(p))),
  });

  function actions(p) {
    const items = [];
    if (p.method === 'manual' && ['submitted', 'pending', 'rejected'].includes(p.status) && p.bookings) {
      items.push(btn(p.status === 'submitted' ? 'Check receipt' : 'Open', { size: 'sm', kind: p.status === 'submitted' ? 'primary' : '', onClick: async () => {
        const b = await loadBooking(p.booking_id);
        if (b) openReceipt(b, p, { onChange: reload });
      } }));
    }
    if (['succeeded', 'partially_refunded'].includes(p.status)) {
      const more = btn('', { size: 'sm', kind: 'ghost', iconName: 'dots-three', aria: 'More' });
      more.addEventListener('click', () => showMenu(more, [{ label: 'Refund', icon: 'arrow-u-up-left', onClick: () => refund(p) }]));
      items.push(more);
    }
    return h('div', { class: 'cell-actions' }, items);
  }

  async function refund(p) {
    const left = Number(p.amount) - Number(p.refunded_amount || 0);
    const amt = await promptDialog({ title: 'Record a refund', message: `Up to ${peso(left)} can still be refunded. Send the money first, then record it here. The customer is emailed.`, label: 'Amount refunded (₱)', value: String(left), type: 'number', confirmLabel: 'Record refund' });
    if (amt == null) return;
    await run(null, () => fn('admin-refund', { payment_id: p.id, amount: Number(amt) || undefined }), { success: 'Refund recorded.' }).catch(() => {});
    reload();
  }

  async function reload() {
    const rows = await q(supabase.from('payments').select('*, bookings(id, guest_name, guest_email, start_at, end_at, total_price, status, profiles!bookings_customer_id_fkey(full_name))').order('created_at', { ascending: false }).limit(2000));
    list.setItems((rows || []).filter((p) => p.type !== 'refund'));
    window.dispatchEvent(new Event('ggs:badges'));
  }

  root.append(pageHead('Payments', 'Online transfers wait here until someone checks the receipt against the account it was sent to.'), list.el);
  await reload();
}
