// Setup > Contacts: the studio's email, address, socials and the people to
// call. The website footer, the booking page, emails and the chat assistant
// all read these, so a change here shows up everywhere.

import { api, btn, clear, field, h, input, pageHead, run, saveSetting, settings, toast } from '../core.js';

export async function render(root) {
  const [all, fwd] = await Promise.all([settings(['contacts']), api('forwarding.get').catch(() => ({ to: [] }))]);
  const c = all.contacts || {};
  const data = { email: c.email || '', address: c.address || '', map_url: c.map_url || '', facebook: c.facebook || '', instagram: c.instagram || '', people: (c.people || []).map((p) => ({ ...p })), forward_to: (fwd.to || []).join(', ') };
  if (!data.people.length) data.people.push({ name: '', phone: '', email: '' });

  const peopleBox = h('div', { class: 'stack' });
  const bind = (ctl, obj, key) => { ctl.addEventListener('input', () => { obj[key] = ctl.value.trim(); }); return ctl; };

  function drawPeople() {
    clear(peopleBox);
    data.people.forEach((p, i) => peopleBox.appendChild(h('div', { class: 'card' },
      h('div', { class: 'grid grid-3' },
        field('Name or role', bind(input({ value: p.name || '', placeholder: 'e.g. Front desk' }), p, 'name')),
        field('Phone', bind(input({ type: 'tel', value: p.phone || '' }), p, 'phone')),
        field('Email', bind(input({ type: 'email', value: p.email || '' }), p, 'email'), { hint: 'Optional' })),
      h('div', { class: 'cell-actions' },
        btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-up', aria: 'Move up', disabled: i === 0, onClick: () => { [data.people[i - 1], data.people[i]] = [data.people[i], data.people[i - 1]]; drawPeople(); } }),
        btn('Remove', { size: 'sm', kind: 'ghost', disabled: data.people.length === 1, onClick: () => { data.people.splice(i, 1); drawPeople(); } })))));
    if (data.people.length < 6) peopleBox.appendChild(h('div', {}, btn('Add a person', { size: 'sm', iconName: 'plus', onClick: () => { data.people.push({ name: '', phone: '', email: '' }); drawPeople(); } })));
  }
  drawPeople();

  const save = btn('Save contacts', { kind: 'primary', iconName: 'floppy-disk', onClick: (e) => {
    const people = data.people.filter((p) => p.name || p.phone || p.email);
    if (!data.email) return toast('Add the studio email.', 'warn');
    const forward = data.forward_to.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (forward.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return toast('One of the forwarding addresses is not a valid email.', 'warn');
    if (!people.length) return toast('Add at least one person or phone number.', 'warn');
    run(e.currentTarget, () => (async () => { const { forward_to: _f, ...rest } = data; await saveSetting('contacts', { ...rest, people }); await api('forwarding.set', { to: forward }); })(), { success: 'Saved. The website shows these now.' }).catch(() => {});
  } });

  root.append(
    pageHead('Contacts', 'Shown in the website footer and booking page, used in emails, and given to the chat assistant.', [save]),
    h('div', { class: 'split', style: 'align-items:start' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Studio')), h('div', { class: 'panel-body stack' },
        field('Studio email', bind(input({ type: 'email', value: data.email }), data, 'email'), { hint: 'Shown on the website. Mail sent here lands in Messages > Inbox.' }),
        field('Forward to', bind(input({ value: data.forward_to, placeholder: 'you@gmail.com' }), data, 'forward_to'), { hint: 'Each email that arrives is copied here, along with booking alerts. Only staff can see this. Separate several with commas.' }),
        field('Address', bind(input({ value: data.address }), data, 'address')),
        field('Map link', bind(input({ value: data.map_url, placeholder: 'https://maps.google.com/...' }), data, 'map_url')),
        field('Facebook page', bind(input({ value: data.facebook }), data, 'facebook')),
        field('Instagram', bind(input({ value: data.instagram, placeholder: 'Optional' }), data, 'instagram')))),
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'People to contact')), h('div', { class: 'panel-body' }, peopleBox))));
}
