// Setup > Rooms & rates: the room rate every session pays, and the add-ons.
// The website's rate card and the booking form both read these rows, so this
// is the only place prices are edited. Existing bookings keep the prices they
// were made at.

import {
  btn, clear, field, h, icon, input, loadCatalog, openDialog, pageHead, peso, pill, q, run, sb, select, state, textarea, toggle, empty,
} from '../core.js';

const TYPES = [['flat', 'Flat, once per booking'], ['hourly', 'Per hour'], ['unit', 'Per unit (songs, tracks)']];

export async function render(root) {
  const supabase = await sb();
  const roomsBox = h('div', { class: 'stack' });
  const servicesBox = h('div', { class: 'stack' });

  async function reload() {
    await loadCatalog(true);
    drawRooms();
    drawServices();
  }

  function drawRooms() {
    clear(roomsBox);
    state.rooms.forEach((r) => {
      roomsBox.appendChild(h('div', { class: 'card row', style: 'align-items:flex-start;gap:14px' },
        r.image_url ? h('img', { class: 'thumb', src: r.image_url, alt: '' }) : h('div', { class: 'thumb', style: 'display:grid;place-items:center' }, icon('microphone-stage')),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'row' }, h('strong', {}, r.name), r.is_active ? pill('Bookable', 'teal') : pill('Hidden', 'quiet')),
          h('div', { class: 'cell-sub' }, r.description || 'No description'),
          h('div', { style: 'margin-top:6px;font-size:1.1rem;font-weight:600' }, `${peso(r.hourly_rate)} / hr`)),
        btn('Edit', { size: 'sm', iconName: 'pencil-simple', onClick: () => editRoom(r) })));
    });
    roomsBox.appendChild(h('div', {}, btn('Add room', { size: 'sm', iconName: 'plus', onClick: () => editRoom(null) })));
  }

  function editRoom(r) {
    const name = input({ value: r?.name || '' });
    const rate = input({ type: 'number', min: 0, step: 10, value: r?.hourly_rate ?? 350 });
    const desc = textarea({ value: r?.description || '', rows: 3 });
    const active = toggle('Bookable on the website', r ? r.is_active : true);
    const photo = h('input', { type: 'file', accept: 'image/*', class: 'input' });
    const err = h('div', { class: 'field-error' });
    openDialog({
      title: r ? `Edit ${r.name}` : 'Add a room',
      body: h('div', { class: 'stack' }, field('Name', name), field('Hourly rate (₱)', rate, { hint: 'New bookings use this. Existing bookings keep their price.' }), field('Description', desc), field('Photo', photo), active, err),
      foot: (d) => [btn('Cancel', { onClick: () => d.close() }), btn('Save', { kind: 'primary', onClick: async (e) => {
        err.textContent = '';
        if (!name.value.trim()) { err.textContent = 'Give the room a name.'; return; }
        try {
          await run(e.currentTarget, async () => {
            const row = { name: name.value.trim(), hourly_rate: Number(rate.value) || 0, description: desc.value.trim() || null, is_active: active.input.checked };
            let id = r?.id;
            if (id) await q(supabase.from('rooms').update(row).eq('id', id));
            else id = (await q(supabase.from('rooms').insert(row).select('id').single())).id;
            const f = photo.files[0];
            if (f) {
              const path = `${id}-${Date.now()}.${(f.name.split('.').pop() || 'jpg').toLowerCase()}`;
              const { error } = await supabase.storage.from('room-images').upload(path, f, { upsert: true, contentType: f.type });
              if (error) throw error;
              const { data } = supabase.storage.from('room-images').getPublicUrl(path);
              await q(supabase.from('rooms').update({ image_url: data.publicUrl }).eq('id', id));
            }
          }, { success: 'Saved.' });
          d.close(); reload();
        } catch (ex) { err.textContent = ex.message; }
      } })],
    });
  }

  function drawServices() {
    clear(servicesBox);
    const list = state.services.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    if (!list.length) servicesBox.appendChild(empty({ iconName: 'headphones', title: 'No add-ons yet', text: 'Add mixing, mastering, an engineer or gear rentals.' }));
    const byId = new Map(list.map((s) => [s.id, s]));
    list.forEach((s, i) => {
      const unit = s.price_type === 'hourly' ? '/ hr' : s.price_type === 'unit' ? `/ ${s.unit_label || 'unit'}` : 'flat';
      servicesBox.appendChild(h('div', { class: 'card row', style: 'align-items:flex-start' },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'row' }, h('strong', {}, s.name), s.is_active ? null : pill('Hidden', 'quiet'),
            s.requires_service_id ? pill(`Needs ${byId.get(s.requires_service_id)?.name || 'another add-on'}`, 'gold') : null),
          h('div', { class: 'cell-sub' }, s.description || 'No description'),
          h('div', { style: 'margin-top:6px;font-weight:600' }, `+ ${peso(s.price)} ${unit}`)),
        h('div', { class: 'cell-actions' },
          btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-up', aria: 'Move up', disabled: i === 0, onClick: () => move(list, i, -1) }),
          btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-down', aria: 'Move down', disabled: i === list.length - 1, onClick: () => move(list, i, 1) }),
          btn('Edit', { size: 'sm', iconName: 'pencil-simple', onClick: () => editService(s) }))));
    });
    servicesBox.appendChild(h('div', {}, btn('Add an add-on', { size: 'sm', iconName: 'plus', onClick: () => editService(null) })));
  }

  async function move(list, i, delta) {
    const a = list[i];
    const b = list[i + delta];
    await run(null, async () => {
      const ordered = list.slice();
      [ordered[i], ordered[i + delta]] = [b, a];
      await Promise.all(ordered.map((s, idx) => (s.sort_order === idx ? null : q(supabase.from('services').update({ sort_order: idx }).eq('id', s.id)))).filter(Boolean));
      await reload();
    }).catch(() => {});
  }

  // Services that already depend on `id` can't become its prerequisite.
  function dependants(id) {
    const found = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      state.services.forEach((s) => {
        if (!found.has(s.id) && s.requires_service_id && (s.requires_service_id === id || found.has(s.requires_service_id))) { found.add(s.id); grew = true; }
      });
    }
    return found;
  }

  function editService(s) {
    const name = input({ value: s?.name || '' });
    const desc = textarea({ value: s?.description || '', rows: 2, placeholder: 'Shown on the rate card and booking form' });
    const price = input({ type: 'number', min: 0, step: 10, value: s?.price ?? 0 });
    const type = select(TYPES, s?.price_type || 'flat');
    const unit = input({ value: s?.unit_label || '', placeholder: 'e.g. song' });
    const blocked = s ? dependants(s.id) : new Set();
    const requires = select([['', 'Nothing'], ...state.services.filter((x) => x.id !== s?.id && !blocked.has(x.id)).map((x) => [x.id, x.name])], s?.requires_service_id || '');
    const active = toggle('Offered on the website', s ? s.is_active : true);
    const unitField = field('Unit name', unit, { hint: 'The customer enters how many; the price multiplies.' });
    const syncType = () => { unitField.hidden = type.value !== 'unit'; };
    type.addEventListener('change', syncType);
    syncType();
    const err = h('div', { class: 'field-error' });
    openDialog({
      title: s ? `Edit ${s.name}` : 'Add an add-on',
      body: h('div', { class: 'stack' }, field('Name', name), field('Description', desc), h('div', { class: 'grid grid-2' }, field('Price (₱)', price), field('Charged', type)), unitField,
        field('Only bookable together with', requires, { hint: 'e.g. Mixing needs Recording. Customers must pick that one first.' }), active, err),
      foot: (d) => [btn('Cancel', { onClick: () => d.close() }), btn('Save', { kind: 'primary', onClick: async (e) => {
        err.textContent = '';
        if (!name.value.trim()) { err.textContent = 'Give it a name.'; return; }
        const row = {
          name: name.value.trim(), description: desc.value.trim() || null, price: Number(price.value) || 0, price_type: type.value,
          unit_label: type.value === 'unit' ? unit.value.trim() || null : null, requires_service_id: requires.value || null, is_active: active.input.checked,
        };
        try {
          await run(e.currentTarget, async () => {
            if (s) await q(supabase.from('services').update(row).eq('id', s.id));
            else await q(supabase.from('services').insert({ ...row, slug: `${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`, sort_order: state.services.length }));
          }, { success: 'Saved.' });
          d.close(); reload();
        } catch (ex) { err.textContent = ex.message; }
      } })],
    });
  }

  root.append(
    pageHead('Rooms & rates', 'Prices here drive the website rate card and the booking form. Bookings already made keep their price.'),
    h('div', { class: 'split', style: 'align-items:start' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Rooms')), h('div', { class: 'panel-body' }, roomsBox)),
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Add-ons')), h('div', { class: 'panel-body' }, servicesBox))));
  await reload();
}
