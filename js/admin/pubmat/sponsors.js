// Sponsor and partner logos for the footer bar of a graphic. The library is
// shared by every design and kept in app_settings.graphics_sponsors; the
// logo files live in the public site-files bucket. `value` is the list shown
// on the current design: [{ id, name, src }].

import { append, btn, clear, confirmDialog, h, icon, input, q, saveSetting, sb, settings, toast } from '../core.js';

import { SUPABASE_URL } from '../../supabase-client.js';

/** Appends children, skipping null and false (native append prints them). */
const put = (node, ...kids) => append(node, kids);

const KEY = 'graphics_sponsors';

export function sponsorPicker(value, onChange) {
  const root = h('div', { class: 'stack pm-sponsors' });
  let library = null;
  let adding = false;
  let error = '';

  const chosen = () => new Set((value || []).map((x) => x.id));
  const set = (list) => { value = list; onChange(list); draw(); };

  async function load() {
    try {
      library = (await settings([KEY]))[KEY] || [];
    } catch (err) {
      error = err.message;
      library = [];
    }
    draw();
  }

  async function save(list) {
    await saveSetting(KEY, list);
    library = list;
  }

  function draw() {
    clear(root);
    if (!library) { put(root, h('p', { class: 'hint' }, 'Loading sponsors…')); return; }
    if (error) put(root, h('p', { class: 'field-error' }, error));
    const grid = h('div', { class: 'pm-sponsor-grid' });
    library.forEach((sp) => {
      const on = chosen().has(sp.id);
      put(grid, h('div', { class: `pm-sponsor${on ? ' on' : ''}` },
        h('button', { type: 'button', class: 'pm-sponsor-pick', 'aria-pressed': String(on), onclick: () => set(on ? value.filter((x) => x.id !== sp.id) : [...(value || []), { id: sp.id, name: sp.name, src: sp.src }]) },
          h('img', { src: sp.src, alt: '' }), h('span', {}, sp.name), on ? icon('check') : null),
        btn('', { size: 'sm', kind: 'ghost', iconName: 'trash', aria: `Remove ${sp.name}`, onClick: async () => {
          const ok = await confirmDialog({ title: `Remove ${sp.name}?`, message: 'It disappears from the sponsor list. Graphics you already downloaded are not affected.', confirmLabel: 'Remove', danger: true });
          if (!ok) return;
          try {
            await save(library.filter((x) => x.id !== sp.id));
            value = (value || []).filter((x) => x.id !== sp.id);
            onChange(value);
            draw();
          } catch (err) { toast(err.message, 'error'); }
        } })));
    });
    if (library.length) put(root, grid);
    else if (!adding) put(root, h('p', { class: 'hint' }, 'No sponsors yet. Add a logo to show it in the footer bar.'));

    if (!adding) {
      put(root, h('div', {}, btn('Add a sponsor', { size: 'sm', iconName: 'plus', onClick: () => { adding = true; draw(); } })));
      return;
    }
    const name = input({ placeholder: 'Sponsor name', maxlength: 60 });
    const file = h('input', { type: 'file', accept: 'image/png, image/jpeg, image/webp', class: 'input' });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f && !name.value) name.value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    });
    const go = btn('Save sponsor', { kind: 'primary', size: 'sm', onClick: async (e) => {
      const f = file.files?.[0];
      if (!f) return toast('Pick the logo file.', 'warn');
      if (!name.value.trim()) return toast('Give the sponsor a name.', 'warn');
      if (f.size > 4 * 1024 * 1024) return toast('That file is over 4 MB.', 'warn');
      const button = e.currentTarget;
      button.classList.add('busy');
      try {
        const supabase = await sb();
        const id = Math.random().toString(36).slice(2, 10);
        const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const path = `sponsors/${id}.${ext}`;
        await q(supabase.storage.from('site-files').upload(path, f, { contentType: f.type, cacheControl: '31536000' }));
        const sponsor = { id, name: name.value.trim(), src: `${SUPABASE_URL}/storage/v1/object/public/site-files/${path}` };
        await save([...library, sponsor]);
        adding = false;
        set([...(value || []), sponsor]);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        button.classList.remove('busy');
      }
    } });
    put(root, h('div', { class: 'stack pm-sponsor-add' },
      name, file,
      h('div', { class: 'row' }, go, btn('Cancel', { size: 'sm', kind: 'ghost', onClick: () => { adding = false; draw(); } }))));
  }

  draw();
  load();
  return root;
}
