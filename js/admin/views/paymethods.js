// Setup > Payment methods: the accounts customers pay into, and paying at the
// studio. Built-in methods can be switched off but not deleted; at least one
// stays on. Bookings keep the method they were made with.

import {
  btn, checkbox, clear, confirmDialog, field, h, icon, input, pageHead, pill, run, saveSetting, sb, settings, textarea, toast, toggle,
} from '../core.js';
import { SUPABASE_URL } from '../../supabase-client.js';

const BUILT_IN = new Set(['cash', 'gcash', 'gotyme', 'bpi']);
const MAX = 8;

export async function render(root) {
  const supabase = await sb();
  const s = await settings(['payment_methods', 'deposit_percent']);
  let methods = structuredClone(s.payment_methods || []);
  let savedJson = JSON.stringify(methods);
  const box = h('div', { class: 'stack' });
  const summary = h('p', { class: 'muted' });
  const dirtyPill = h('span', { class: 'pill warn', hidden: true }, 'Unsaved changes');
  const saveBtn = btn('Save', { kind: 'primary', iconName: 'floppy-disk', onClick: (e) => save(e.currentTarget) });

  const changed = () => {
    dirtyPill.hidden = JSON.stringify(methods) === savedJson;
    const on = methods.filter((m) => m.enabled !== false).map((m) => m.name);
    summary.textContent = on.length ? `Customers can pay with: ${on.join(', ')}.` : 'No method is switched on. Customers could not pay.';
  };

  function card(m, i) {
    const body = h('div', { class: 'stack', hidden: true });
    const en = toggle('', m.enabled !== false);
    en.input.addEventListener('change', () => { m.enabled = en.input.checked; changed(); });
    const bind = (ctl, key, fnv = (v) => v) => { ctl.addEventListener('input', () => { m[key] = fnv(ctl.value); changed(); }); return ctl; };
    const head = h('div', { class: 'row', style: 'gap:12px' },
      en,
      m.qr_url ? h('img', { src: m.qr_url, alt: '', style: 'width:40px;height:40px;border-radius:6px;background:#fff;object-fit:contain' }) : h('span', { class: 'avatar' }, icon(m.kind === 'online' ? 'qr-code' : 'storefront')),
      h('div', { style: 'flex:1;min-width:0' }, h('strong', {}, m.name || 'Untitled'), h('div', { class: 'cell-sub' }, m.kind === 'online' ? `Online transfer${m.account_name ? ` to ${m.account_name}` : ''}` : 'Paid at the studio')),
      BUILT_IN.has(m.id) ? pill('Built in', 'quiet') : null,
      btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-up', aria: 'Move up', disabled: i === 0, onClick: () => { [methods[i - 1], methods[i]] = [methods[i], methods[i - 1]]; draw(); changed(); } }),
      btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-down', aria: 'Move down', disabled: i === methods.length - 1, onClick: () => { [methods[i + 1], methods[i]] = [methods[i], methods[i + 1]]; draw(); changed(); } }),
      btn('Details', { size: 'sm', iconName: 'caret-down', onClick: () => { body.hidden = !body.hidden; } }));

    const name = bind(input({ value: m.name || '' }), 'name');
    if (m.kind === 'online') {
      const qrFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      qrFile.addEventListener('change', async () => {
        const f = qrFile.files[0];
        if (!f) return;
        await run(null, async () => {
          const path = `qr/${m.id}-${Date.now()}.${(f.name.split('.').pop() || 'png').toLowerCase()}`;
          const { error } = await supabase.storage.from('site-files').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
          if (error) throw error;
          m.qr_url = `${SUPABASE_URL}/storage/v1/object/public/site-files/${path}`;
          draw(); changed();
        }, { success: 'QR uploaded. Save to publish it.' }).catch(() => {});
      });
      const needsReceipt = checkbox('Ask for a receipt screenshot', m.needs_receipt !== false);
      needsReceipt.input.addEventListener('change', () => { m.needs_receipt = needsReceipt.input.checked; changed(); });
      const needsRef = checkbox('Ask for the reference number', m.needs_ref !== false);
      needsRef.input.addEventListener('change', () => { m.needs_ref = needsRef.input.checked; changed(); });
      body.append(
        h('div', { class: 'grid grid-3' }, field('Name customers see', name), field('Account name', bind(input({ value: m.account_name || '' }), 'account_name')), field('Account number', bind(input({ value: m.account_number || '' }), 'account_number'), { hint: 'Optional' })),
        field('Steps', bind(textarea({ value: m.steps || '', rows: 3 }), 'steps'), { hint: 'One step per line. **bold** works; {total} and {account_name} fill in.' }),
        h('div', { class: 'row' }, needsReceipt, needsRef),
        field('Reference number hint', bind(input({ value: m.ref_hint || '' }), 'ref_hint')),
        h('div', { class: 'row' }, m.qr_url ? h('img', { src: m.qr_url, alt: `${m.name} QR`, style: 'width:120px;border-radius:8px;background:#fff;padding:6px' }) : h('span', { class: 'faint' }, 'No QR yet'),
          btn(m.qr_url ? 'Replace QR' : 'Upload QR', { size: 'sm', iconName: 'qr-code', onClick: () => qrFile.click() }), qrFile));
    } else {
      body.append(
        field('Name customers see', name),
        field('Description', bind(textarea({ value: m.detail || '', rows: 2 }), 'detail')),
        field('Note on the confirmation', bind(input({ value: m.note || '' }), 'note')),
        h('p', { class: 'hint' }, 'Paying at the studio asks for a photo of a valid ID when "Require an ID" is on in Booking rules.'));
    }
    if (!BUILT_IN.has(m.id)) {
      body.append(h('div', {}, btn('Delete method', { size: 'sm', kind: 'danger', iconName: 'trash', onClick: async () => {
        if (!(await confirmDialog({ title: `Delete ${m.name}?`, message: 'Bookings already made keep the name they were paid with.', confirmLabel: 'Delete', danger: true }))) return;
        methods.splice(i, 1); draw(); changed();
      } })));
    }
    return h('div', { class: 'card stack' }, head, body);
  }

  function draw() {
    clear(box);
    methods.forEach((m, i) => box.appendChild(card(m, i)));
    box.appendChild(h('div', { class: 'row' },
      btn('Add an online account', { size: 'sm', iconName: 'plus', disabled: methods.length >= MAX, onClick: () => add('online') }),
      btn('Add a pay-in-person option', { size: 'sm', iconName: 'plus', disabled: methods.length >= MAX, onClick: () => add('in_person') }),
      methods.length >= MAX ? h('span', { class: 'hint' }, `Up to ${MAX} methods.`) : null));
  }

  function add(kind) {
    const id = `${kind === 'online' ? 'acct' : 'person'}-${Date.now().toString(36)}`;
    methods.push(kind === 'online'
      ? { id, kind, name: 'New account', enabled: false, account_name: '', account_number: '', steps: 'Scan the QR.\nSend exactly **{total}**.\nUpload the receipt below.', needs_receipt: true, needs_ref: true, ref_hint: 'Reference number on the receipt' }
      : { id, kind, name: 'Pay at the studio', enabled: false, detail: '', note: '' });
    draw(); changed();
    box.querySelectorAll('.card')[methods.length - 1]?.querySelector('[hidden]')?.removeAttribute('hidden');
    toast('Added, switched off. Fill it in, switch it on, then save.');
  }

  async function save(button) {
    if (!methods.some((m) => m.enabled !== false)) return toast('Keep at least one payment method switched on.', 'warn');
    if (methods.some((m) => !String(m.name || '').trim())) return toast('Every method needs a name.', 'warn');
    await run(button, () => saveSetting('payment_methods', methods), { success: 'Saved. The booking form uses these now.' }).catch(() => {});
    savedJson = JSON.stringify(methods);
    changed();
  }

  root.append(pageHead('Payment methods', `Online payments are checked by hand on the Payments page. The downpayment is ${s.deposit_percent ?? 20}% (change it in Booking rules).`, [dirtyPill, saveBtn]), summary, box);
  draw();
  changed();
  const warn = (e) => { if (!dirtyPill.hidden) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}
