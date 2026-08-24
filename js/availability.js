// Live availability calendar for the landing page's "Book now" section.
//
// Anonymous visitors can't read `bookings` (RLS scopes it to the owning
// customer plus staff), so the busy ranges come from the `public_busy_ranges`
// RPC — a security-definer function that returns start/end times only, with no
// customer, price, or status attached. Opening hours and rooms are already
// publicly readable.
//
// The calendar is a controller for the booking form beside it: picking a day
// fills #fDate, picking a free window fills #fStart/#fEnd, and typing into
// #fDate by hand moves the calendar. Nothing here submits anything.
import { getSupabase } from './supabase-client.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MS_HOUR = 3600000;

// Local calendar date as YYYY-MM-DD — the same format <input type="date">
// speaks, so the two stay in sync without any timezone round-tripping.
function dayKey(d) {
  return d.toLocaleDateString('en-CA');
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Merges overlapping/touching ranges, then returns what's left of
// [open, close) once they're all removed.
function subtractRanges(open, close, ranges) {
  const busy = ranges
    .map((r) => [Math.max(r[0], open), Math.min(r[1], close)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  busy.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  });

  const free = [];
  let cursor = open;
  merged.forEach(([s, e]) => {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  });
  if (cursor < close) free.push([cursor, close]);
  return { free, busyMs: merged.reduce((sum, [s, e]) => sum + (e - s), 0) };
}

export async function initBookingCalendar() {
  const root = document.getElementById('bookCalendar');
  if (!root) return;

  const dateEl = document.getElementById('fDate');
  const startEl = document.getElementById('fStart');
  const endEl = document.getElementById('fEnd');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-cal-prev aria-label="Previous month">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <div class="cal-month" data-cal-label aria-live="polite">&nbsp;</div>
      <button type="button" class="cal-nav" data-cal-next aria-label="Next month">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>
    <div class="cal-dows">${DOW.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid" data-cal-grid></div>
    <div class="cal-detail" data-cal-detail><div class="cal-detail-inner" data-cal-detail-inner></div></div>
    <div class="cal-legend">
      <span><i class="dot-open"></i>Open</span>
      <span><i class="dot-busy"></i>Partly booked</span>
      <span><i class="dot-full"></i>Fully booked</span>
    </div>
  `;

  const grid = root.querySelector('[data-cal-grid]');
  const label = root.querySelector('[data-cal-label]');
  const detail = root.querySelector('[data-cal-detail]');
  const detailInner = root.querySelector('[data-cal-detail-inner]');

  const supabase = await getSupabase();
  const [{ data: rooms }, { data: hoursRows }] = await Promise.all([
    supabase.from('rooms').select('id, name').eq('is_active', true).order('created_at').limit(1),
    supabase.from('operating_hours').select('*'),
  ]);

  const room = rooms?.[0];
  if (!room) {
    root.innerHTML = '<p class="muted">Availability is unavailable right now — send the form and we\'ll confirm by email.</p>';
    return;
  }

  const hoursByDow = {};
  (hoursRows || []).filter((h) => h.room_id === room.id).forEach((h) => { hoursByDow[h.day_of_week] = h; });

  // One RPC round-trip per visible month, kept so paging back and forth
  // doesn't re-fetch.
  const busyCache = new Map();
  async function busyFor(year, month) {
    const cacheKey = `${year}-${month}`;
    if (busyCache.has(cacheKey)) return busyCache.get(cacheKey);
    // A grid shows up to 6 days of the neighbouring months on either side.
    const from = new Date(year, month, -6);
    const to = new Date(year, month + 1, 7);
    const { data, error } = await supabase.rpc('public_busy_ranges', {
      p_room_id: room.id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    const ranges = error ? [] : (data || []).map((r) => [new Date(r.start_at).getTime(), new Date(r.end_at).getTime()]);
    busyCache.set(cacheKey, ranges);
    return ranges;
  }

  // What a given day looks like: closed, already gone, or some mix of free
  // windows and booked time.
  function dayState(date, ranges) {
    const key = dayKey(date);
    const hours = hoursByDow[date.getDay()];
    if (!hours || hours.is_closed) return { state: 'closed', free: [] };

    const open = new Date(`${key}T${hours.open_time}`).getTime();
    let close = new Date(`${key}T${hours.close_time}`).getTime();
    if (close <= open) close += 24 * MS_HOUR; // room closes after midnight

    // Today's already-elapsed hours are gone, not free.
    const floor = Math.max(open, Date.now());
    if (floor >= close) return { state: 'past', free: [] };

    const { free, busyMs } = subtractRanges(floor, close, ranges);
    if (free.length === 0) return { state: 'full', free: [] };
    return { state: busyMs > 0 ? 'busy' : 'open', free };
  }

  let view = new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  let selectedKey = dateEl?.value || '';
  let dayStates = new Map();

  function renderDetail() {
    const info = dayStates.get(selectedKey);
    if (!selectedKey || !info) {
      detail.classList.remove('open');
      return;
    }
    const date = new Date(`${selectedKey}T12:00`);
    const when = date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });

    if (info.free.length === 0) {
      const why = info.state === 'closed' ? 'The studio is closed that day.'
        : info.state === 'past' ? 'That day has already passed.'
        : 'Every hour is taken — try the day either side.';
      detailInner.innerHTML = `<div class="cal-detail-day">${when}</div><p class="cal-detail-note">${why}</p>`;
    } else {
      const chips = info.free.map(([s, e]) => {
        const hrs = ((e - s) / MS_HOUR).toFixed(1).replace(/\.0$/, '');
        return `<button type="button" class="cal-slot" data-slot-start="${s}" data-slot-end="${e}">
          ${fmtTime(new Date(s))} – ${fmtTime(new Date(e))}<em>${hrs} hr${hrs === '1' ? '' : 's'} free</em>
        </button>`;
      }).join('');
      detailInner.innerHTML = `
        <div class="cal-detail-day">${when}</div>
        <p class="cal-detail-note">Tap a window to drop it into the form.</p>
        <div class="cal-slots">${chips}</div>`;
    }
    detail.classList.add('open');
  }

  function selectDay(key, { syncForm = true } = {}) {
    selectedKey = key;
    grid.querySelectorAll('.cal-day').forEach((c) => c.classList.toggle('selected', c.dataset.key === key));
    if (syncForm && dateEl && dateEl.value !== key) {
      dateEl.value = key;
      dateEl.dispatchEvent(new Event('input', { bubbles: true }));
      dateEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    renderDetail();
  }

  async function render(direction = 0) {
    const year = view.getFullYear();
    const month = view.getMonth();
    label.textContent = view.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

    // Fade the old month out before the new one is built, so paging reads as a
    // movement rather than a repaint.
    if (direction && !reduceMotion) {
      grid.classList.add(direction > 0 ? 'leaving-next' : 'leaving-prev');
      await new Promise((r) => setTimeout(r, 130));
    }

    const ranges = await busyFor(year, month);
    const startOffset = new Date(year, month, 1).getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const todayKey = dayKey(new Date());
    // Draw only the weeks this month actually touches, not a fixed six.
    const weeks = Math.ceil((startOffset + new Date(year, month + 1, 0).getDate()) / 7);

    dayStates = new Map();
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = dayKey(date);
      const info = dayState(date, ranges);
      dayStates.set(key, info);
      const outside = date.getMonth() !== month;
      const disabled = info.free.length === 0;
      cells.push(`
        <button type="button"
          class="cal-day state-${info.state}${outside ? ' outside' : ''}${key === todayKey ? ' today' : ''}${key === selectedKey ? ' selected' : ''}"
          style="--i:${i}" data-key="${key}"${disabled ? ' disabled' : ''}
          aria-label="${date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })} — ${info.state}">
          <span class="cal-daynum">${date.getDate()}</span>
          <span class="cal-mark"></span>
        </button>`);
    }

    grid.classList.remove('leaving-next', 'leaving-prev');
    // Fresh nodes every render, so the per-cell entry animation restarts itself.
    grid.innerHTML = cells.join('');
    renderDetail();
  }

  root.querySelector('[data-cal-prev]').addEventListener('click', () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render(-1);
  });
  root.querySelector('[data-cal-next]').addEventListener('click', () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render(1);
  });

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-day');
    if (!cell || cell.disabled) return;
    selectDay(cell.dataset.key);
  });

  // A free window fills in start and end too — one hour by default, or the
  // whole window when it's shorter than that.
  detail.addEventListener('click', (e) => {
    const slot = e.target.closest('.cal-slot');
    if (!slot || !startEl || !endEl) return;
    const s = new Date(Number(slot.dataset.slotStart));
    const e2 = new Date(Number(slot.dataset.slotEnd));
    // Round the start up to the next half hour — the time inputs step in 30s.
    if (s.getMinutes() % 30 || s.getSeconds()) {
      s.setSeconds(0, 0);
      s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30);
    }
    const end = new Date(Math.min(s.getTime() + MS_HOUR, e2.getTime()));
    startEl.value = hhmm(s);
    endEl.value = hhmm(end);
    [startEl, endEl].forEach((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
    slot.classList.add('taken');
    document.getElementById('bookingSummary')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });

  // Typing a date into the form moves the calendar, not just the other way.
  dateEl?.addEventListener('change', () => {
    if (!dateEl.value || dateEl.value === selectedKey) return;
    const picked = new Date(`${dateEl.value}T12:00`);
    if (isNaN(picked.getTime())) return;
    if (picked.getMonth() !== view.getMonth() || picked.getFullYear() !== view.getFullYear()) {
      view = new Date(picked.getFullYear(), picked.getMonth(), 1);
      render(1).then(() => selectDay(dateEl.value, { syncForm: false }));
      return;
    }
    selectDay(dateEl.value, { syncForm: false });
  });

  // A fresh booking frees up time — repull rather than serving the stale month.
  window.addEventListener('ggs:booking-created', () => {
    busyCache.clear();
    render();
  });

  await render();
}

