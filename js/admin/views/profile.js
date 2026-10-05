// Your profile: photo, name, booking alerts and password.

import { api, avatar, btn, clear, field, h, input, pageHead, q, run, sb, state, toggle, toast } from '../core.js';
import { SUPABASE_URL } from '../../supabase-client.js';

export async function render(root) {
  const supabase = await sb();
  const p = state.profile;
  const email = state.session.user.email;
  const photoBox = h('div', {}, avatar(p, 'lg'));
  const photoFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  const name = input({ value: p.full_name || '' });
  const alerts = toggle('Email me when someone books or cancels on the website', !!p.notify_bookings, { disabled: !email });

  photoFile.addEventListener('change', async () => {
    const f = photoFile.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return toast('Use a photo under 3 MB.', 'warn');
    await run(null, async () => {
      const path = `avatars/${p.id}-${Date.now()}.${(f.name.split('.').pop() || 'jpg').toLowerCase()}`;
      const { error } = await supabase.storage.from('site-files').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
      if (error) throw error;
      const url = `${SUPABASE_URL}/storage/v1/object/public/site-files/${path}`;
      await q(supabase.from('profiles').update({ avatar_url: url }).eq('id', p.id));
      p.avatar_url = url;
      clear(photoBox).appendChild(avatar(p, 'lg'));
    }, { success: 'Photo updated.' }).catch(() => {});
  });

  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const pw2 = input({ type: 'password', autocomplete: 'new-password' });

  root.append(
    pageHead('Your profile', email),
    h('div', { class: 'split', style: 'align-items:start' },
      h('div', { class: 'panel panel-pad stack' },
        h('div', { class: 'row', style: 'gap:16px' }, photoBox, h('div', { class: 'stack', style: 'gap:6px' },
          btn('Change photo', { size: 'sm', iconName: 'camera', onClick: () => photoFile.click() }),
          p.avatar_url ? btn('Remove photo', { size: 'sm', kind: 'ghost', onClick: () => run(null, async () => {
            await q(supabase.from('profiles').update({ avatar_url: null }).eq('id', p.id));
            p.avatar_url = null;
            clear(photoBox).appendChild(avatar(p, 'lg'));
          }).catch(() => {}) }) : null), photoFile),
        field('Name', name, { hint: 'Signs your replies from the inbox and shows in the audit log.' }),
        field('Email', input({ value: email, disabled: true }), { hint: 'Your sign-in email. Ask an admin if it needs to change.' }),
        alerts,
        h('div', { class: 'row' },
          btn('Save', { kind: 'primary', onClick: (e) => run(e.currentTarget, async () => {
            await q(supabase.from('profiles').update({ full_name: name.value.trim() || null, notify_bookings: alerts.input.checked }).eq('id', p.id));
            p.full_name = name.value.trim();
            p.notify_bookings = alerts.input.checked;
          }, { success: 'Saved.' }).catch(() => {}) }),
          btn('Send me a test alert', { iconName: 'bell', onClick: (e) => run(e.currentTarget, () => api('profile.test_email'), { success: (r) => `Sent to ${r.to}.` }).catch(() => {}) }))),
      h('div', { class: 'panel panel-pad stack' },
        h('h2', { class: 'section-title' }, 'Change password'),
        field('New password', pw, { hint: 'At least 10 characters. Your other sessions are signed out.' }),
        field('Repeat it', pw2),
        h('div', {}, btn('Change password', { onClick: (e) => {
          if (pw.value.length < 10) return toast('Use at least 10 characters.', 'warn');
          if (pw.value !== pw2.value) return toast("The two passwords don't match.", 'warn');
          run(e.currentTarget, async () => {
            const { error } = await supabase.auth.updateUser({ password: pw.value });
            if (error) throw error;
            await supabase.auth.signOut({ scope: 'others' });
            pw.value = ''; pw2.value = '';
          }, { success: 'Password changed. Other sessions were signed out.' }).catch(() => {});
        } })))));
}
