// Front desk > Calendar: what one day looks like. A month grid marks closed
// days, special dates and how busy each day is; the chosen day lists every
// hour the schedule opens plus any hour a booking covers outside them, so
// nothing is hidden.

import {
  btn, clear, customerName, effectiveStatus, h, icon, loadCatalog, pageHead, pill, q, sb, setParam, state, STATUS_LABEL,
  STATUS_TONE, fmtTime, select,
} from '../core.js';
import { BOOKING_SELECT, openBookingForm } from './booking-dialogs.js';
import {
  addDays, bookableMinutes, blockedRanges, DOW_NAMES, hoursFor, localDate, localMs, MONTH_NAMES, openWindow, time12, todayLocal,
} from '../../../supabase/functions/_shared/schedule.js';

const HOUR = 3600000;

export async function render(root, params) {
  await loadCatalog();
  const supabase = await sb();
  let roomId = params.room || state.rooms.find((r) => r.is_active)?.id || state.rooms[0]?.id;
  let selected = params.date || todayLocal();
  let month = selected.slice(0, 7);
  let schedule = null;
  let bookings = [];

  const roomPick = state.rooms.length > 1 ? select(state.rooms.map((r) => [r.id, r.name]), roomId) : null;
  roomPick?.addEventListener('change', async () => { roomId = roomPick.value; await loadSchedule(); await loadMonth(); });
  const monthLabel = h('h2', { class: 'section-title' });
  const grid = h('div', { class: 'month' });
  const dayPanel = h('div', { class: 'panel' });

  async function loadSchedule() {
    const [hours, setting] = await Promise.all([
      q(supabase.from('operating_hours').select('*').eq('room_id', roomId)),
      q(supabase.from('staff_settings').select('value').eq('key', 'schedule').maybeSingle()),
    ]);
    schedule = {
      weekly: (hours || []).map((x) => ({ dow: x.day_of_week, closed: x.is_closed || !x.open_time, open: x.open_time?.slice(0, 5), close: x.close_time?.slice(0, 5) })),
      overrides: setting?.value?.overrides || [],
    };
  }

  async function loadMonth() {
    const first = `${month}-01`;
    const from = new Date(localMs(addDays(first, -7))).toISOString();
    const to = new Date(localMs(addDays(first, 45))).toISOString();
    bookings = await q(supabase.from('bookings').select(BOOKING_SELECT).eq('room_id', roomId).lt('start_at', to).gt('end_at', from).order('start_at')) || [];
    drawMonth();
    drawDay();
  }

  function dayBookings(date) {
    return bookings.filter((b) => localDate(b.start_at) === date && b.status !== 'cancelled');
  }

  function drawMonth() {
    const [y, m] = month.split('-').map(Number);
    monthLabel.textContent = `${MONTH_NAMES[m - 1]} ${y}`;
    clear(grid);
    DOW_NAMES.forEach((d) => grid.appendChild(h('div', { class: 'dow' }, d.slice(0, 3))));
    const first = `${month}-01`;
    const startDow = new Date(`${first}T12:00:00Z`).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const d = addDays(first, i - startDow);
      const info = hoursFor(schedule, d);
      const list = dayBookings(d);
      const tags = [];
      if (info.closed && info.special) tags.push(h('span', { class: 'tag off' }, info.show === 'booked' ? 'Booked out' : 'Closed'));
      else if (info.special && info.blocks.length) tags.push(h('span', { class: 'tag off' }, `${time12(info.blocks[0].from)} off`));
      else if (info.special) tags.push(h('span', { class: 'tag special' }, `${time12(info.open)} to ${time12(info.close)}`));
      if (list.length) tags.push(h('span', { class: 'tag busy' }, `${list.length} booking${list.length === 1 ? '' : 's'}`));
      grid.appendChild(h('button', {
        type: 'button',
        class: ['day', d.slice(0, 7) !== month && 'out', d === todayLocal() && 'today', d === selected && 'sel', info.closed && 'closed'].filter(Boolean).join(' '),
        'aria-label': `${d}${info.closed ? ', closed' : ''}, ${list.length} bookings`,
        onclick: () => { selected = d; setParam('date', d); drawMonth(); drawDay(); },
      }, h('span', { class: 'd' }, Number(d.slice(8))), tags));
    }
  }

  function drawDay() {
    const info = hoursFor(schedule, selected);
    const list = dayBookings(selected);
    const win = openWindow(info);
    const blocks = blockedRanges(info);
    const base = localMs(selected, '00:00');
    // Hours to show: every open hour, plus any hour a booking covers.
    const hoursSet = new Set();
    if (win) for (let t = win[0]; t < win[1]; t += HOUR) hoursSet.add(Math.floor((t - base) / HOUR));
    list.forEach((b) => {
      for (let t = new Date(b.start_at).getTime(); t < new Date(b.end_at).getTime(); t += HOUR) hoursSet.add(Math.floor((t - base) / HOUR));
    });
    const hoursList = [...hoursSet].sort((a, b) => a - b);
    const bookedMin = list.reduce((s, b) => s + (new Date(b.end_at) - new Date(b.start_at)) / 60000, 0);
    const avail = bookableMinutes(info);
    const addons = list.flatMap((b) => (b.booking_services || []).map((bs) => bs.services?.name)).filter(Boolean);

    const warnings = [];
    if (info.closed && list.length) warnings.push('There are bookings on a day that is closed.');
    list.forEach((b) => {
      const s = new Date(b.start_at).getTime();
      const e = new Date(b.end_at).getTime();
      if (win && (s < win[0] || e > win[1])) warnings.push(`${customerName(b)} is booked outside operating hours.`);
      if (blocks.some(([a, z]) => s < z && e > a)) warnings.push(`${customerName(b)} is booked during hours that are off.`);
    });

    const rows = hoursList.map((hr) => {
      const t0 = base + hr * HOUR;
      const t1 = t0 + HOUR;
      const inside = win && t0 >= win[0] && t1 <= win[1];
      const covering = list.filter((b) => new Date(b.start_at).getTime() < t1 && new Date(b.end_at).getTime() > t0);
      const blocked = blocks.some(([a, z]) => t0 < z && t1 > a);
      const label = time12(`${String(hr % 24).padStart(2, '0')}:00`);
      let what;
      let cls = 'slot-row';
      if (covering.length) {
        what = h('div', { class: 'stack', style: 'gap:6px' }, covering.map((b) => {
          const startsHere = new Date(b.start_at).getTime() >= t0;
          return h('div', { class: 'row', style: 'gap:8px' },
            h('strong', {}, customerName(b)),
            startsHere ? h('span', { class: 'faint' }, `${fmtTime(b.start_at)} to ${fmtTime(b.end_at)}`) : h('span', { class: 'faint' }, 'continues'),
            pill(STATUS_LABEL[effectiveStatus(b)], STATUS_TONE[effectiveStatus(b)]),
            b.guest_phone ? h('a', { href: `tel:${b.guest_phone.replace(/[^\d+]/g, '')}` }, b.guest_phone) : null,
            (b.booking_services || []).length ? h('span', { class: 'faint' }, (b.booking_services || []).map((bs) => bs.services?.name).join(', ')) : null,
            startsHere ? btn('Open', { size: 'sm', onClick: () => { location.hash = `#/bookings?b=${b.id}`; } }) : null);
        }));
        if (blocked) cls += ' blocked';
      } else if (blocked) {
        cls += ' blocked';
        what = h('span', { class: 'what' }, `Off${info.note ? `: ${info.note}` : ''}${info.show === 'booked' ? ' (shown to the public as booked)' : ''}`);
      } else {
        cls += ' free';
        what = h('span', { class: 'what' }, 'Free ', btn('Book', { size: 'sm', kind: 'ghost', onClick: () => openBookingForm(null, { date: selected, start: `${String(hr % 24).padStart(2, '0')}:00`, end: `${String((hr + 1) % 24).padStart(2, '0')}:00` }).then((ok) => ok && loadMonth()) }));
      }
      if (!inside) cls += ' outside';
      return h('div', { class: cls }, h('div', { class: 'time' }, label, !inside ? h('div', { class: 'hint' }, 'outside hours') : null), what);
    });

    const dateTitle = new Date(`${selected}T12:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    dayPanel.replaceChildren(
      h('div', { class: 'panel-head' }, h('h2', {}, dateTitle),
        btn('Add booking', { size: 'sm', iconName: 'plus', onClick: () => openBookingForm(null, { date: selected }).then((ok) => ok && loadMonth()) })),
      h('div', { class: 'panel-body stack' },
        h('div', { class: 'row', style: 'gap:18px' },
          h('span', {}, icon('clock'), ' ', info.closed ? (info.special && info.show === 'booked' ? 'Closed, shown as fully booked' : 'Closed') : `${time12(info.open)} to ${time12(info.close)}${info.special ? ' (special hours)' : ''}`),
          h('span', {}, icon('calendar-check'), ` ${Math.round(bookedMin / 6) / 10} of ${Math.round(avail / 6) / 10} hours booked`),
          h('span', {}, icon('headphones'), ` ${addons.length ? addons.join(', ') : 'No add-ons to prepare'}`)),
        info.note && info.special ? h('div', { class: 'banner', style: 'margin:0' }, icon('note'), h('div', {}, info.note)) : null,
        warnings.length ? h('div', { class: 'banner warn', style: 'margin:0' }, icon('warning'), h('div', {}, [...new Set(warnings)].map((w) => h('div', {}, w)))) : null,
        rows.length ? h('div', { class: 'timeline' }, rows) : h('p', { class: 'muted' }, 'Closed, and nothing is booked.')));
  }

  const nav = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    month = d.toISOString().slice(0, 7);
    loadMonth();
  };

  root.append(
    pageHead('Calendar', 'One day at a time. Pick a date to see each hour, free or booked.', roomPick ? [roomPick] : []),
    h('div', { class: 'split', style: 'align-items:start' },
      h('div', { class: 'panel panel-pad stack' },
        h('div', { class: 'row between' },
          btn('', { iconName: 'caret-left', aria: 'Previous month', onClick: () => nav(-1) }),
          monthLabel,
          h('div', { class: 'row', style: 'gap:6px' },
            btn('Today', { size: 'sm', onClick: () => { selected = todayLocal(); month = selected.slice(0, 7); setParam('date', null); loadMonth(); } }),
            btn('', { iconName: 'caret-right', aria: 'Next month', onClick: () => nav(1) }))),
        grid,
        h('div', { class: 'legend' },
          h('span', {}, h('i', { style: 'background:var(--gold-soft);border:1px solid var(--gold)' }), 'Bookings'),
          h('span', {}, h('i', { style: 'background:var(--teal-soft);border:1px solid var(--teal-text)' }), 'Special hours'),
          h('span', {}, h('i', { style: 'background:var(--danger-soft);border:1px solid var(--danger)' }), 'Closed or hours off'))),
      dayPanel));

  await loadSchedule();
  await loadMonth();
}
