// Custom date and time controls for the booking form.
//
// The native <input type="date"> / <input type="time"> pickers are kept in the
// markup — every other module (js/booking.js, js/availability.js) still reads
// and writes their .value and listens for their events — but they're hidden and
// driven by the modals built here instead. That buys two things the native
// pickers can't do: times outside the studio's opening hours for the chosen day
// simply aren't offered, and the minute wheel is free rather than locked to the
// half-hour steps the old step="1800" enforced.
import { getSupabase } from './supabase-client.js';

const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_MINUTES = 24 * 60;

const dayKey = (d) => d.toLocaleDateString('en-CA');
const pad = (n) => String(n).padStart(2, '0');
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const hour12 = (h) => (h % 12 === 0 ? 12 : h % 12);

function label12(min) {
  const h = Math.floor(min / 60);
  return `${hour12(h)}:${pad(min % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}

// Writes through the hidden native input so everything already listening for
// its events (summary pricing, validation, the availability calendar) reacts
// exactly as it did when a human typed into it.
function setValue(input, value) {
  if (input.value === value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Shell shared by both controls: the hidden native input, a button in the form
// showing the current value, and a modal that opens over the page. The modal
// lives on <body> rather than inside the field, so it can never be clipped by
// the form card or pushed off the bottom of a phone screen.
function mountShell(input, { placeholder, title, onOpen }) {
  input.classList.add('dtp-native');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dtp-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.innerHTML = `<span class="dtp-value is-empty">${placeholder}</span>`;
  input.insertAdjacentElement('afterend', trigger);

  const backdrop = document.createElement('div');
  backdrop.className = 'dtp-backdrop';
  backdrop.innerHTML = `
    <div class="dtp-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="dtp-modal-head">
        <span class="dtp-modal-title">${title}</span>
        <button type="button" class="dtp-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="dtp-modal-body" data-body></div>
    </div>`;
  document.body.appendChild(backdrop);
  const body = backdrop.querySelector('[data-body]');

  const valueEl = trigger.querySelector('.dtp-value');
  const setLabel = (text, empty) => {
    valueEl.textContent = text;
    valueEl.classList.toggle('is-empty', Boolean(empty));
  };

  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('dtp-locked');
  };
  const open = () => {
    // Shown first, then filled: the time wheels place themselves by setting
    // scrollTop, which does nothing while the modal is still display:none.
    backdrop.classList.add('open');
    document.body.classList.add('dtp-locked');
    onOpen?.();
  };

  trigger.addEventListener('click', open);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
  });

  return { trigger, body, setLabel, open, close };
}

// ---------- Date ----------
function buildDatePicker(input, { isClosedOn }) {
  let render = () => {};
  const shell = mountShell(input, {
    placeholder: 'Choose a date',
    title: 'Pick a date',
    onOpen: () => render(),
  });
  shell.body.innerHTML = `
    <div class="dtp-cal-head">
      <button type="button" class="dtp-nav" data-prev aria-label="Previous month">&#8249;</button>
      <span class="dtp-cal-month" data-month></span>
      <button type="button" class="dtp-nav" data-next aria-label="Next month">&#8250;</button>
    </div>
    <div class="dtp-cal-dows">${DOW_SHORT.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="dtp-cal-grid" data-grid></div>`;

  const monthEl = shell.body.querySelector('[data-month]');
  const grid = shell.body.querySelector('[data-grid]');
  const todayKey = dayKey(new Date());
  let view = new Date();
  view.setDate(1);

  render = function renderMonth() {
    const year = view.getFullYear();
    const month = view.getMonth();
    monthEl.textContent = view.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    const offset = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<span></span>');
    for (let day = 1; day <= days; day++) {
      const date = new Date(year, month, day);
      const key = dayKey(date);
      // Past days and days the studio is shut aren't offered at all.
      const disabled = key < todayKey || isClosedOn(date.getDay());
      cells.push(`<button type="button" class="dtp-cal-day${key === input.value ? ' selected' : ''}${key === todayKey ? ' today' : ''}"
        data-key="${key}"${disabled ? ' disabled' : ''}>${day}</button>`);
    }
    grid.innerHTML = cells.join('');
  };

  function syncLabel() {
    if (!input.value) {
      shell.setLabel('Choose a date', true);
      return;
    }
    const date = new Date(`${input.value}T12:00`);
    shell.setLabel(date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), false);
  }

  shell.body.querySelector('[data-prev]').addEventListener('click', () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
  });
  shell.body.querySelector('[data-next]').addEventListener('click', () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render();
  });
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.dtp-cal-day');
    if (!cell || cell.disabled) return;
    setValue(input, cell.dataset.key);
    shell.close();
  });

  // The big availability calendar writes into this input too; follow it.
  ['input', 'change'].forEach((ev) => input.addEventListener(ev, () => {
    syncLabel();
    if (input.value) {
      const picked = new Date(`${input.value}T12:00`);
      view = new Date(picked.getFullYear(), picked.getMonth(), 1);
    }
  }));

  syncLabel();
  render();
}

// ---------- Time ----------
// Two snapping scroll wheels — hour and minute. Whatever sits under the
// highlight band when the scrolling stops is the selection; tapping a row
// scrolls it there, which lands in exactly the same place. The hour wheel runs
// straight through the whole opening window and carries its own AM/PM label,
// so morning rolls into afternoon by scrolling rather than by flipping a
// separate switch first.
//
// `bounds()` returns the minute-of-day window this control may pick from, so
// the wheels can be rebuilt whenever the date (and therefore the opening hours)
// or the start time changes. Nothing reaches the input until Confirm.
function buildTimePicker(input, { placeholder, title, bounds }) {
  let draft = null; // minutes past midnight, or null

  let render = () => {};
  const shell = mountShell(input, {
    placeholder,
    title,
    onOpen: () => {
      const range = bounds();
      draft = toMin(input.value);
      if (range && draft != null && (draft < range.min || draft > range.max)) draft = null;
      render();
    },
  });
  shell.body.innerHTML = `
    <div class="dtp-readout" data-readout>--:--</div>
    <p class="dtp-hint" data-hint></p>
    <div class="dtp-wheels" data-wheels>
      ${['Hour', 'Minute', 'AM/PM'].map((name, i) => `
        <div class="dtp-wheel-col" data-col="${['hours', 'mins', 'period'][i]}">
          <button type="button" class="dtp-step" data-step="-1" aria-label="Earlier ${name}">&#9650;</button>
          <div class="dtp-wheel-view">
            <div class="dtp-wheel-band" aria-hidden="true"></div>
            <div class="dtp-wheel" tabindex="0" role="listbox" aria-label="${name}"></div>
          </div>
          <button type="button" class="dtp-step" data-step="1" aria-label="Later ${name}">&#9660;</button>
        </div>`).join('')}
    </div>
    <div class="dtp-actions">
      <button type="button" class="dtp-btn" data-close>Cancel</button>
      <button type="button" class="dtp-btn dtp-btn-gold" data-confirm disabled>Set time</button>
    </div>`;

  const readout = shell.body.querySelector('[data-readout]');
  const hint = shell.body.querySelector('[data-hint]');
  const wheelsWrap = shell.body.querySelector('[data-wheels]');
  const confirmBtn = shell.body.querySelector('[data-confirm]');

  // One scroll wheel: the ▲/▼ buttons, the highlight band and the scrolling
  // column. The centred row is the value; the column is padded top and bottom
  // so the first and last rows can reach the middle.
  function makeWheel(col, onPick) {
    const el = col.querySelector('.dtp-wheel');
    let values = [];
    let quiet = false; // set while the wheel is being positioned in code
    let timer = null;

    const itemHeight = () => el.firstElementChild?.offsetHeight || 38;
    const indexAt = () => {
      if (!values.length) return 0;
      const idx = Math.round(el.scrollTop / itemHeight());
      return Math.min(Math.max(idx, 0), values.length - 1);
    };
    const paint = (idx) => {
      Array.from(el.children).forEach((row, i) => row.classList.toggle('active', i === idx));
    };

    el.addEventListener('scroll', () => {
      if (!values.length) return;
      paint(indexAt());
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (quiet) { quiet = false; return; }
        onPick(values[indexAt()]);
      }, 90);
    });
    el.addEventListener('click', (e) => {
      const row = e.target.closest('.dtp-wheel-item');
      if (!row) return;
      el.scrollTo({ top: Array.from(el.children).indexOf(row) * itemHeight(), behavior: 'smooth' });
    });
    const nudge = (step) => {
      if (!values.length) return;
      const next = Math.min(Math.max(indexAt() + step, 0), values.length - 1);
      el.scrollTo({ top: next * itemHeight(), behavior: 'smooth' });
    };
    // The ▲/▼ buttons and the arrow keys both move the wheel one row, so this
    // stays usable without a mouse wheel or a touchscreen.
    col.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => nudge(Number(btn.dataset.step)));
    });
    el.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      nudge(step);
    });

    return {
      // `selected` is the value to centre on; the nearest one on offer is used
      // when it isn't available any more (the window moved under it).
      set(nextValues, labels, selected) {
        const same = nextValues.length === values.length && nextValues.every((v, i) => v === values[i]);
        values = nextValues;
        if (!same) {
          el.innerHTML = nextValues
            .map((v, i) => `<div class="dtp-wheel-item" role="option" data-i="${i}">${labels[i]}</div>`)
            .join('');
        }
        let idx = nextValues.indexOf(selected);
        if (idx < 0) {
          idx = 0;
          nextValues.forEach((v, i) => {
            if (Math.abs(v - selected) < Math.abs(nextValues[idx] - selected)) idx = i;
          });
        }
        paint(idx);
        const target = idx * itemHeight();
        if (Math.round(el.scrollTop) !== target) {
          quiet = true;
          el.scrollTop = target;
        }
      },
    };
  }

  // Each wheel edits one part of the draft; every render re-centres the others
  // on it, so scrolling the hours past noon carries AM/PM along by itself.
  const hoursWheel = makeWheel(shell.body.querySelector('[data-col="hours"]'), (h) => {
    setDraft(h * 60 + (draft ?? 0) % 60);
  });
  const minsWheel = makeWheel(shell.body.querySelector('[data-col="mins"]'), (m) => {
    setDraft(Math.floor((draft ?? 0) / 60) * 60 + m);
  });
  // Picking a half of the day keeps the hour and minute, moving the whole time
  // twelve hours across.
  const periodWheel = makeWheel(shell.body.querySelector('[data-col="period"]'), (base) => {
    const d = draft ?? 0;
    setDraft((base + (Math.floor(d / 60) % 12)) * 60 + (d % 60));
  });

  // Clamped back into the opening window, so no amount of scrolling can
  // assemble a time the studio isn't open for.
  function setDraft(minutes) {
    const range = bounds();
    if (!range || range.min > range.max) return;
    draft = Math.min(Math.max(minutes, range.min), range.max);
    render();
  }

  render = function renderPanel() {
    const range = bounds();
    const usable = Boolean(range) && range.min <= range.max;
    wheelsWrap.hidden = !usable;
    confirmBtn.disabled = !usable;
    if (!range) {
      hint.textContent = 'Pick a date first — the times we can offer depend on it.';
      readout.textContent = '--:--';
      return;
    }
    hint.textContent = range.note;
    if (!usable) {
      readout.textContent = '--:--';
      return;
    }

    const { min, max } = range;
    // Nothing chosen yet opens on the earliest time that can still be booked.
    if (draft == null) draft = min;
    draft = Math.min(Math.max(draft, min), max);
    const hour = Math.floor(draft / 60);

    // Every hour the window touches, in order, morning straight through to
    // evening — scrolling off the end of the morning simply continues into the
    // afternoon, and the AM/PM wheel below follows the hour rather than
    // gating it.
    const hours = [];
    for (let h = 0; h < 24; h++) {
      if (h * 60 + 59 >= min && h * 60 <= max) hours.push(h);
    }
    hoursWheel.set(hours, hours.map(hour12), hour);

    const periods = [];
    const periodLabels = [];
    if (min < 12 * 60) { periods.push(0); periodLabels.push('AM'); }
    if (max >= 12 * 60) { periods.push(12); periodLabels.push('PM'); }
    periodWheel.set(periods, periodLabels, hour >= 12 ? 12 : 0);

    // Every minute of the chosen hour that the window still allows — no
    // half-hour steps, so a session can start or end on any minute.
    const mins = [];
    for (let m = 0; m < 60; m++) {
      const abs = hour * 60 + m;
      if (abs >= min && abs <= max) mins.push(m);
    }
    minsWheel.set(mins, mins.map(pad), draft % 60);

    readout.textContent = label12(draft);
  };

  confirmBtn.addEventListener('click', () => {
    if (draft == null) return;
    setValue(input, toHHMM(draft));
    shell.close();
  });

  function syncLabel() {
    const current = toMin(input.value);
    shell.setLabel(current == null ? placeholder : label12(current), current == null);
  }

  // 'input' as well as 'change': the availability calendar fills these in by
  // hand and only fires the former.
  ['input', 'change'].forEach((ev) => input.addEventListener(ev, syncLabel));

  syncLabel();
  return {
    // A value that no longer fits the window (the date moved, or the start time
    // did) is dropped rather than quietly submitted.
    refresh() {
      const range = bounds();
      const current = toMin(input.value);
      if (range && current != null && (current < range.min || current > range.max)) setValue(input, '');
      syncLabel();
    },
  };
}

export async function initDateTimePickers() {
  const dateEl = document.getElementById('fDate');
  const startEl = document.getElementById('fStart');
  const endEl = document.getElementById('fEnd');
  if (!dateEl || !startEl || !endEl) return;

  // Any leftover half-hour stepping goes with the native pickers.
  [startEl, endEl].forEach((el) => el.removeAttribute('step'));

  const supabase = await getSupabase();
  const [{ data: rooms }, { data: hoursRows }] = await Promise.all([
    supabase.from('rooms').select('id').eq('is_active', true).order('created_at').limit(1),
    supabase.from('operating_hours').select('*'),
  ]);
  const roomId = rooms?.[0]?.id || null;
  const hoursByDow = {};
  (hoursRows || [])
    .filter((h) => !roomId || h.room_id === roomId)
    .forEach((h) => { hoursByDow[h.day_of_week] = h; });

  const isClosedOn = (dow) => {
    const h = hoursByDow[dow];
    return !h || h.is_closed;
  };

  // The opening window for whatever date is currently chosen, in minutes past
  // midnight, already trimmed for today's elapsed hours. A room that closes
  // after midnight is capped at 23:59 — the form books a single calendar day.
  function openWindow() {
    if (!dateEl.value) return null;
    const date = new Date(`${dateEl.value}T12:00`);
    if (isNaN(date.getTime())) return null;
    const hours = hoursByDow[date.getDay()];
    if (!hours || hours.is_closed) return null;
    const open = toMin(String(hours.open_time).slice(0, 5));
    let close = toMin(String(hours.close_time).slice(0, 5));
    if (open == null || close == null) return null;
    if (close <= open) close = DAY_MINUTES - 1;
    let min = open;
    const now = new Date();
    if (dateEl.value === dayKey(now)) min = Math.max(min, now.getHours() * 60 + now.getMinutes());
    return { open, close, min, max: close };
  }

  const closedNote = 'The studio is closed that day — pick another date.';

  buildDatePicker(dateEl, { isClosedOn });

  const startPicker = buildTimePicker(startEl, {
    placeholder: 'Start time',
    title: 'Start time',
    bounds() {
      if (!dateEl.value) return null;
      const w = openWindow();
      if (!w) return { min: 1, max: 0, note: closedNote };
      // The closing minute itself can't start a session that ends later.
      return { min: w.min, max: Math.max(w.min, w.max - 1), note: `Open ${label12(w.open)} – ${label12(w.close)}` };
    },
  });

  const endPicker = buildTimePicker(endEl, {
    placeholder: 'End time',
    title: 'End time',
    bounds() {
      if (!dateEl.value) return null;
      const w = openWindow();
      if (!w) return { min: 1, max: 0, note: closedNote };
      const start = toMin(startEl.value);
      // An end time is always after the start, and never past closing.
      const min = start != null ? Math.min(start + 1, w.max) : w.min;
      const note = start != null
        ? `After ${label12(start)} · closes ${label12(w.close)}`
        : `Open ${label12(w.open)} – ${label12(w.close)}`;
      return { min, max: w.max, note };
    },
  });

  ['input', 'change'].forEach((ev) => dateEl.addEventListener(ev, () => {
    startPicker.refresh();
    endPicker.refresh();
  }));
  ['input', 'change'].forEach((ev) => startEl.addEventListener(ev, () => endPicker.refresh()));
}
