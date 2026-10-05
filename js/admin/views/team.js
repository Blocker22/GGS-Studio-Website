// Reports & team > Team: who can sign in to the dashboard. Admins add people
// with a temporary password (they must choose their own on first sign-in),
// change roles, and remove access. Nobody can remove themselves.

import {
  api, avatar, btn, confirmDialog, createList, field, fmtDate, fmtRel, h, input, openDialog, pageHead, pill, q, run, sb, select, state,
} from '../core.js';

function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(14);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => chars[n % chars.length]).join('');
}

export async function render(root) {
  const supabase = await sb();
  const isAdmin = state.profile.role === 'admin';
  const list = createList({
    key: 'team',
    sorts: [
      ['name', 'Name A to Z', (a, b) => (a.full_name || '').localeCompare(b.full_name || '')],
      ['newest', 'Newest first', (a, b) => b.created_at.localeCompare(a.created_at)],
    ],
    search: (s) => `${s.full_name || ''} ${s.email || ''}`,
    empty: { iconName: 'users-three', title: 'No staff yet' },
    card: (s) => h('div', { class: 'card row', style: 'align-items:center;gap:14px' },
      avatar(s),
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'row', style: 'gap:8px' }, h('strong', {}, s.full_name || 'Unnamed'), s.id === state.profile.id ? pill('You', 'gold') : null,
          pill(s.role === 'admin' ? 'Admin' : 'Staff', s.role === 'admin' ? 'teal' : ''), s.notify_bookings ? pill('Booking alerts', 'quiet', 'bell') : null),
        h('div', { class: 'cell-sub' }, s.email || '—'),
        h('div', { class: 'cell-sub' }, `Added ${fmtDate(s.created_at)} · ${s.last_sign_in_at ? `last signed in ${fmtRel(s.last_sign_in_at)}` : 'never signed in'}`)),
      isAdmin && s.id !== state.profile.id ? h('div', { class: 'cell-actions' },
        select([['staff', 'Staff'], ['admin', 'Admin']], s.role, { 'aria-label': 'Role', onchange: (e) => run(null, () => api('staff.role', { user_id: s.id, role: e.target.value }), { success: 'Role changed.' }).then(reload).catch(reload) }),
        btn('Remove', { size: 'sm', kind: 'danger', onClick: async () => {
          if (!(await confirmDialog({ title: `Remove ${s.full_name || s.email}?`, message: 'They lose dashboard access right away. Their account stays as a customer account, and the audit log keeps what they did.', confirmLabel: 'Remove', danger: true }))) return;
          await run(null, () => api('staff.remove', { user_id: s.id }), { success: 'Removed from the team.' }).catch(() => {});
          reload();
        } })) : null),
  });

  function addStaff() {
    const name = input();
    const email = input({ type: 'email' });
    const role = select([['staff', 'Staff'], ['admin', 'Admin (can manage the team)']], 'staff');
    const pw = input({ value: tempPassword(), class: 'input mono' });
    const err = h('div', { class: 'field-error' });
    openDialog({
      title: 'Add a team member',
      sub: 'Give them the temporary password yourself. They must change it when they first sign in.',
      size: 'narrow',
      body: h('div', { class: 'stack' }, field('Name', name), field('Email', email), field('Role', role), field('Temporary password', pw, { hint: 'At least 10 characters.' }), err),
      foot: (d) => [btn('Cancel', { onClick: () => d.close() }), btn('Add', { kind: 'primary', onClick: async (e) => {
        err.textContent = '';
        try {
          const r = await run(e.currentTarget, () => api('staff.create', { name: name.value, email: email.value, role: role.value, password: pw.value }));
          d.close();
          openDialog({
            title: r.existing ? 'Access granted' : 'Account created',
            size: 'narrow',
            body: h('div', { class: 'stack' }, r.existing
              ? h('p', {}, `${email.value} already had an account, so it now has ${role.value} access. They sign in with their existing password.`)
              : h('div', { class: 'stack' }, h('p', {}, 'Send them these details privately:'), h('dl', { class: 'kv' }, h('dt', {}, 'Sign in at'), h('dd', {}, `${location.origin}${location.pathname}`), h('dt', {}, 'Email'), h('dd', {}, email.value), h('dt', {}, 'Password'), h('dd', { class: 'mono' }, pw.value)))),
            foot: (d2) => [btn('Done', { kind: 'primary', onClick: () => d2.close() })],
          });
          reload();
        } catch (ex) { err.textContent = ex.message; }
      } })],
    });
  }

  async function reload() {
    list.setItems(await q(supabase.rpc('staff_list')) || []);
  }

  root.append(pageHead('Team', isAdmin ? 'People who can use this dashboard.' : 'People who can use this dashboard. Only admins can add or remove people.', isAdmin ? [btn('Add team member', { kind: 'primary', iconName: 'user-plus', onClick: addStaff })] : []), list.el);
  await reload();
}
