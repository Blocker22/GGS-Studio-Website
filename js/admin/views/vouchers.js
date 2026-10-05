// Marketing > Vouchers: discount codes customers type on the booking form.
// Validity is checked against the booking's session date, not today. A code
// that has been used can't be renamed or deleted; pause it instead.

import {
  api, btn, checkbox, confirmDialog, copy, createList, field, h, icon, input, openDialog, pageHead, peso, pill, q, run, sb,
  select, textarea, toggle,
} from '../core.js';
import { describeConditions, KINDS, randomCode, voucherLabel, voucherStatus } from '../../../supabase/functions/_shared/voucher.js';
import { todayLocal } from '../../../supabase/functions/_shared/schedule.js';

const STATUS_TONE = { Active: 'teal', Paused: 'quiet', 'Starts later': 'gold', Expired: 'quiet', 'Used up': 'warn' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function render(root) {
  const supabase = await sb();
  let usage = {};
  const tiles = h('div', { class: 'tiles' });
  const today = todayLocal();
  const statusOf = (v) => voucherStatus(v, { today, uses: usage[v.code]?.uses || 0 });

  const list = createList({
    key: 'vouchers',
    searchPlaceholder: 'Search codes',
    chips: [
      { id: 'all', label: 'All', test: () => true },
      ...['Active', 'Paused', 'Starts later', 'Expired', 'Used up'].map((s) => ({ id: s, label: s, test: (v) => statusOf(v) === s })),
    ],
    sorts: [
      ['newest', 'Newest first', (a, b) => b.created_at.localeCompare(a.created_at)],
      ['oldest', 'Oldest first', (a, b) => a.created_at.localeCompare(b.created_at)],
      ['used', 'Most used', (a, b) => (usage[b.code]?.uses || 0) - (usage[a.code]?.uses || 0)],
      ['code', 'Code A to Z', (a, b) => a.code.localeCompare(b.code)],
    ],
    search: (v) => `${v.code} ${v.description || ''} ${v.note || ''}`,
    empty: { iconName: 'ticket', title: 'No vouchers yet', text: 'Make a code for a promo, a regular, or a gift certificate.', action: btn('New voucher', { kind: 'primary', iconName: 'plus', onClick: () => edit(null) }) },
    card: (v) => {
      const u = usage[v.code] || { uses: 0, discount: 0 };
      const st = statusOf(v);
      const cond = describeConditions(v);
      return h('div', { class: 'card stack', style: 'gap:10px' },
        h('div', { class: 'card-row' },
          h('div', {}, h('button', { type: 'button', class: 'code-tag', style: 'font-size:1rem;padding:4px 10px', title: 'Copy code', onclick: () => copy(v.code) }, v.code, ' ', icon('copy')),
            h('div', { class: 'cell-title', style: 'margin-top:8px' }, voucherLabel(v)), v.description ? h('div', { class: 'cell-sub' }, v.description) : null),
          pill(st, STATUS_TONE[st])),
        cond.length ? h('div', { class: 'cell-sub' }, `For ${cond.join(', ')}.`) : h('div', { class: 'cell-sub' }, 'No conditions.'),
        v.note ? h('div', { class: 'cell-sub' }, icon('note'), ' ', v.note) : null,
        h('div', {}, h('div', { class: 'row between', style: 'font-size:0.86rem' }, h('span', {}, `Used ${u.uses}${v.max_uses ? ` of ${v.max_uses}` : ''} time${u.uses === 1 ? '' : 's'}`), h('span', { class: 'faint' }, `${peso(u.discount)} given`)),
          v.max_uses ? h('div', { class: 'meter', style: 'margin-top:6px' }, h('span', { style: `width:${Math.min(100, (u.uses / v.max_uses) * 100)}%` })) : null),
        h('div', { class: 'cell-actions' },
          btn('Edit', { size: 'sm', iconName: 'pencil-simple', onClick: () => edit(v) }),
          btn(v.active ? 'Pause' : 'Resume', { size: 'sm', iconName: v.active ? 'pause' : 'play', onClick: (e) => run(e.currentTarget, async () => {
            await q(supabase.from('vouchers').update({ active: !v.active }).eq('id', v.id));
            await reload();
          }, { success: v.active ? 'Paused.' : 'Active again.' }).catch(() => {}) }),
          btn('Make image', { size: 'sm', iconName: 'image', onClick: () => { location.hash = `#/graphics?voucher=${v.id}`; } }),
          u.uses ? null : btn('Delete', { size: 'sm', kind: 'danger', iconName: 'trash', onClick: async () => {
            if (!(await confirmDialog({ title: `Delete ${v.code}?`, message: 'It has never been used, so it can be deleted.', confirmLabel: 'Delete', danger: true }))) return;
            await run(null, () => api('voucher.delete', { id: v.id }), { success: 'Deleted.' }).catch(() => {});
            reload();
          } })));
    },
  });

  function edit(v) {
    const code = input({ value: v?.code || randomCode(8), style: 'text-transform:uppercase;font-family:var(--mono)' });
    const kind = select(Object.entries(KINDS), v?.kind || 'percent');
    const value = input({ type: 'number', min: 0, step: 1, value: v?.value ?? 10 });
    const description = input({ value: v?.description || '', placeholder: 'Shown to customers, e.g. Student discount' });
    const note = textarea({ value: v?.note || '', rows: 2, placeholder: 'Only staff see this' });
    const minUnits = input({ type: 'number', min: 0, step: 0.5, value: v?.min_units || '' , placeholder: '0' });
    const maxUses = input({ type: 'number', min: 1, step: 1, value: v?.max_uses || '', placeholder: 'No limit' });
    const perCustomer = input({ type: 'number', min: 1, step: 1, value: v?.per_customer || '', placeholder: 'No limit' });
    const from = input({ type: 'date', value: v?.valid_from || '' });
    const until = input({ type: 'date', value: v?.valid_until || '' });
    const days = DOW.map((d, i) => checkbox(d, !v?.weekdays?.length || v.weekdays.includes(i)));
    const active = toggle('Active', v ? v.active : true);
    const summary = h('div', { class: 'banner', style: 'margin:0' }, icon('info'), h('div'));
    const err = h('div', { class: 'field-error' });
    const valueField = field('Amount', value);

    const sync = () => {
      const k = kind.value;
      valueField.hidden = k === 'free';
      valueField.querySelector('label').textContent = k === 'percent' ? 'Percent off' : k === 'amount' ? 'Pesos off' : 'Free hours';
      const draft = collect();
      const cond = describeConditions(draft);
      summary.lastChild.textContent = `${draft.code || 'This code'} gives ${voucherLabel(draft).toLowerCase()}${cond.length ? `, for ${cond.join(', ')}` : ''}.${draft.active ? '' : ' It is paused.'}`;
    };
    const collect = () => ({
      id: v?.id,
      code: code.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      kind: kind.value,
      value: Number(value.value) || 0,
      description: description.value.trim(),
      note: note.value.trim(),
      min_units: Number(minUnits.value) || 0,
      max_uses: Number(maxUses.value) || null,
      per_customer: Number(perCustomer.value) || null,
      valid_from: from.value || null,
      valid_until: until.value || null,
      weekdays: days.map((d, i) => (d.input.checked ? i : null)).filter((x) => x !== null),
      active: active.input.checked,
    });
    [code, kind, value, minUnits, maxUses, perCustomer, from, until].forEach((c) => c.addEventListener('input', sync));
    days.forEach((d) => d.input.addEventListener('change', sync));
    active.input.addEventListener('change', sync);
    sync();

    openDialog({
      title: v ? `Edit ${v.code}` : 'New voucher',
      body: h('div', { class: 'stack' },
        h('div', { class: 'grid grid-2' },
          field('Code', h('div', { class: 'input-group' }, code, btn('', { iconName: 'shuffle', aria: 'Make a random code', onClick: () => { code.value = randomCode(8); sync(); } })), { hint: '3 to 24 letters, digits or dashes.' }),
          field('Kind', kind)),
        h('div', { class: 'grid grid-2' }, valueField, field('Minimum hours', minUnits)),
        field('Description', description),
        h('div', { class: 'grid grid-2' }, field('Valid for sessions from', from), field('Until', until)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Days it works on'), h('div', { class: 'row' }, days)),
        h('div', { class: 'grid grid-2' }, field('Total uses', maxUses), field('Uses per customer', perCustomer)),
        field('Staff note', note), active, summary, err),
      foot: (d) => [btn('Cancel', { onClick: () => d.close() }), btn(v ? 'Save' : 'Create voucher', { kind: 'primary', onClick: async (e) => {
        err.textContent = '';
        try {
          await run(e.currentTarget, () => api('voucher.save', { voucher: collect() }), { success: v ? 'Saved.' : 'Voucher created.' });
          d.close(); reload();
        } catch (ex) { err.textContent = ex.message; }
      } })],
    });
  }

  async function reload() {
    const [rows, u] = await Promise.all([
      q(supabase.from('vouchers').select('*').order('created_at', { ascending: false })),
      api('voucher.usage').then((r) => r.usage).catch(() => ({})),
    ]);
    usage = u || {};
    const vouchers = rows || [];
    const totalUses = Object.values(usage).reduce((s, x) => s + x.uses, 0);
    const totalDiscount = Object.values(usage).reduce((s, x) => s + x.discount, 0);
    tiles.replaceChildren(
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, icon('ticket'), 'Active codes'), h('span', { class: 'tile-value' }, vouchers.filter((v) => statusOf(v) === 'Active').length)),
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, icon('check-circle'), 'Times used'), h('span', { class: 'tile-value' }, totalUses), h('span', { class: 'tile-sub' }, 'On bookings not cancelled')),
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, icon('coins'), 'Discounts given'), h('span', { class: 'tile-value' }, peso(totalDiscount))));
    list.setItems(vouchers);
  }

  root.append(pageHead('Vouchers', 'Codes are checked against the date of the session being booked.', [btn('New voucher', { kind: 'primary', iconName: 'plus', onClick: () => edit(null) })]), tiles, list.el);
  await reload();
}
