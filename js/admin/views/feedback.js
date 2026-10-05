// Messages > Reviews: what customers said after their session. Review links
// go out automatically a few hours after a session ends (Booking rules), or
// by hand from a booking's Send email. Only reviews shown on the site are
// public; if none are, the reviews section stays hidden.

import {
  btn, confirmDialog, createList, fmtDate, h, icon, openDialog, pageHead, pill, q, ref, run, sb, signedUrl,
} from '../core.js';

const stars = (n) => h('span', { class: 'stars', 'aria-label': `${n} out of 5 stars` }, '★'.repeat(n) + '☆'.repeat(5 - n));

export async function render(root) {
  const supabase = await sb();
  const statsBox = h('div', { class: 'tiles' });
  const list = createList({
    key: 'feedback',
    chips: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'site', label: 'On the site', test: (f) => f.featured },
      ...[5, 4, 3, 2, 1].map((n) => ({ id: `r${n}`, label: `${n} ★`, test: (f) => f.rating === n })),
    ],
    sorts: [
      ['newest', 'Newest first', (a, b) => b.created_at.localeCompare(a.created_at)],
      ['oldest', 'Oldest first', (a, b) => a.created_at.localeCompare(b.created_at)],
      ['high', 'Highest rating', (a, b) => b.rating - a.rating || b.created_at.localeCompare(a.created_at)],
      ['low', 'Lowest rating', (a, b) => a.rating - b.rating || b.created_at.localeCompare(a.created_at)],
    ],
    search: (f) => `${f.name} ${f.comment || ''}`,
    empty: { iconName: 'star', title: 'No reviews yet', text: 'Customers get a review link a few hours after their session. You can also send one by hand from a booking.' },
    card: (f) => h('div', { class: 'card stack', style: 'gap:10px' },
      h('div', { class: 'card-row' },
        h('div', {}, h('div', { class: 'cell-title' }, f.name, h('span', { class: 'faint' }, ` (shown as ${f.display_name})`)),
          h('div', { class: 'cell-sub' }, `Session ${f.booking_date ? fmtDate(f.booking_date) : '—'} · reviewed ${fmtDate(f.created_at)}${f.booking_id ? ` · ${ref(f.booking_id)}` : ''}`)),
        h('div', { style: 'text-align:right' }, stars(f.rating), f.featured ? h('div', {}, pill('On the site', 'teal', 'globe')) : null)),
      f.comment ? h('p', { style: 'white-space:pre-wrap' }, f.comment) : h('p', { class: 'faint' }, 'No comment, just a rating.'),
      f.photos?.length ? photoRow(f) : null,
      h('div', { class: 'cell-actions' },
        btn(f.featured ? 'Hide from site' : 'Show on site', { size: 'sm', kind: f.featured ? '' : 'primary', iconName: f.featured ? 'eye-slash' : 'globe', onClick: (e) => run(e.currentTarget, async () => {
          await q(supabase.from('feedback').update({ featured: !f.featured, featured_at: f.featured ? null : new Date().toISOString() }).eq('id', f.id));
          await reload();
        }, { success: f.featured ? 'Hidden from the site.' : 'Now shown on the site.' }).catch(() => {}) }),
        btn('Delete', { size: 'sm', kind: 'danger', iconName: 'trash', onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete this review?', message: 'The review and its photos are erased for good.', confirmLabel: 'Delete', danger: true }))) return;
          await run(null, async () => {
            if (f.photos?.length) await supabase.storage.from('review-photos').remove(f.photos);
            await q(supabase.from('feedback').delete().eq('id', f.id));
            await reload();
          }, { success: 'Review deleted.' }).catch(() => {});
        } }))),
  });

  function photoRow(f) {
    const row = h('div', { class: 'row' });
    f.photos.forEach(async (path) => {
      try {
        const url = await signedUrl('review-photos', path, 3600);
        row.appendChild(h('button', { type: 'button', style: 'border:0;padding:0;background:none;cursor:zoom-in', onclick: () => openDialog({ title: `Photo from ${f.display_name}`, size: 'wide', body: h('img', { src: url, alt: '', style: 'margin:auto;max-height:75vh;border-radius:12px' }) }) },
          h('img', { class: 'thumb', src: url, alt: `Photo from ${f.display_name}` })));
      } catch { /* missing photo */ }
    });
    return row;
  }

  function drawStats(rows) {
    const n = rows.length;
    const avg = n ? rows.reduce((s, r) => s + r.rating, 0) / n : 0;
    const dist = [5, 4, 3, 2, 1].map((s) => [s, rows.filter((r) => r.rating === s).length]);
    statsBox.replaceChildren(
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, icon('star'), 'Average rating'), h('span', { class: 'tile-value' }, n ? avg.toFixed(1) : '—'), h('span', { class: 'tile-sub' }, `${n} review${n === 1 ? '' : 's'}`)),
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, icon('globe'), 'On the site'), h('span', { class: 'tile-value' }, rows.filter((r) => r.featured).length), h('span', { class: 'tile-sub' }, 'The home page shows these')),
      h('div', { class: 'tile', style: 'grid-column:span 2;min-width:260px' }, h('span', { class: 'tile-label' }, 'Ratings'),
        dist.map(([s, c]) => h('div', { class: 'hbar' }, h('span', {}, `${s} ★`), h('span', { class: 'bar' }, h('span', { style: `width:${n ? (c / n) * 100 : 0}%;background:var(--gold)` })), h('span', { class: 'faint' }, c)))));
  }

  async function reload() {
    const rows = await q(supabase.from('feedback').select('*').order('created_at', { ascending: false })) || [];
    drawStats(rows);
    list.setItems(rows);
  }

  root.append(pageHead('Reviews', 'Choose which reviews appear on the home page. Nothing shows until you pick at least one.'), statsBox, list.el);
  await reload();
}
