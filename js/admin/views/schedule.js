// Setup > Schedule: when the studio can be booked. Weekly hours, plus special
// dates built from WHEN + WHAT rules (closed, special hours, or some hours off).
// The same rule engine runs on the website and in the booking functions, so
// all three always agree. Saving lists upcoming bookings that no longer fit.

import {
  api, btn, checkbox, clear, confirmDialog, field, fmtDateTime, fmtWhen, h, icon, input, loadCatalog, openDialog, pageHead, pill,
  q, run, sb, select, state, textarea, toast, empty,
} from '../core.js';
import {
  addDays, DOW_NAMES, describeWhat, describeWhen, hoursFor, longDate, MONTH_NAMES, nextOccurrence, normaliseRule, REPEATS, time12, todayLocal,
} from '../../../supabase/functions/_shared/schedule.js';

const REPEAT_LABEL = {
  once: 'One date', range: 'Date range', yearly: 'Every year', monthly: 'Every month (or one month)',
  nthWeekday: 'Nth weekday of the month', weekOfMonth: 'A week of the month',
};

export async function render(root) {
  await loadCatalog();
  const supabase = await sb();
  let roomId = state.rooms.find((r) => r.is_active)?.id || state.rooms[0]?.id;
  let weekly = [];
  let rules = [];
  let dirty = false;
  let mode = 'list';
  let calMonth = todayLocal().slice(0, 7);

  const weeklyBox = h('div', { class: 'stack', style: 'gap:8px' });
  const rulesBox = h('div');
  const affectedBox = h('div');
  const saveBtn = btn('Save schedule', { kind: 'primary', iconName: 'floppy-disk', onClick: (e) => save(e.currentTarget) });
  const dirtyNote = h('span', { class: 'pill warn', hidden: true }, 'Unsaved changes');
  const markDirty = () => { dirty = true; dirtyNote.hidden = false; };

  async function load() {
    const [hours, setting] = await Promise.all([
      q(supabase.from('operating_hours').select('*').eq('room_id', roomId)),
      q(supabase.from('staff_settings').select('value').eq('key', 'schedule').maybeSingle()),
    ]);
    weekly = DOW_NAMES.map((_, dow) => {
      const r = (hours || []).find((x) => x.day_of_week === dow);
      return { dow, closed: !r || r.is_closed || !r.open_time, open: r?.open_time?.slice(0, 5) || '09:00', close: r?.close_time?.slice(0, 5) || '18:00' };
    });
    rules = setting?.value?.overrides || [];
    dirty = false;
    dirtyNote.hidden = true;
    drawWeekly();
    drawRules();
  }

  const schedule = () => ({ weekly, overrides: rules });

  function drawWeekly() {
    clear(weeklyBox);
    weekly.forEach((w) => {
      const open = input({ type: 'time', value: w.open, step: 900, disabled: w.closed, 'aria-label': `${DOW_NAMES[w.dow]} opens` });
      const close = input({ type: 'time', value: w.close, step: 900, disabled: w.closed, 'aria-label': `${DOW_NAMES[w.dow]} closes` });
      const sw = checkbox('Open', !w.closed);
      sw.input.addEventListener('change', () => { w.closed = !sw.input.checked; open.disabled = close.disabled = w.closed; markDirty(); });
      open.addEventListener('input', () => { w.open = open.value; markDirty(); });
      close.addEventListener('input', () => { w.close = close.value; markDirty(); });
      weeklyBox.appendChild(h('div', { class: 'week-row' },
        h('strong', {}, DOW_NAMES[w.dow]), sw, open, close));
    });
    weeklyBox.appendChild(h('p', { class: 'hint' }, 'A closing time earlier than the opening time means the day runs past midnight.'));
  }

  function drawRules() {
    clear(rulesBox);
    const seg = h('div', { class: 'seg' }, [['list', 'List'], ['calendar', 'Calendar']].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(mode === id), onclick: () => { mode = id; drawRules(); } }, label)));
    rulesBox.appendChild(h('div', { class: 'row between', style: 'margin-bottom:12px' }, seg, btn('Add special date', { iconName: 'plus', onClick: () => editRule(null) })));
    if (mode === 'calendar') return rulesBox.appendChild(calendar());
    if (!rules.length) return rulesBox.appendChild(empty({ iconName: 'calendar-x', title: 'No special dates', text: 'Add holidays, private events, maintenance or special hours. They apply on top of the weekly hours.' }));
    rulesBox.appendChild(h('div', { class: 'list' }, rules.map((r, i) => {
      const next = nextOccurrence(r);
      return h('div', { class: 'list-item' },
        icon(r.what === 'closed' ? 'prohibit' : r.what === 'hours' ? 'clock-clockwise' : 'clock-countdown'),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'cell-title' }, describeWhen(r)),
          h('div', { class: 'cell-sub' }, describeWhat(r), r.note ? ` · ${r.note}` : ''),
          h('div', { class: 'cell-sub' }, next ? `Next: ${longDate(next)}` : 'No upcoming date', r.repeat !== 'once' && r.repeat !== 'range' && (r.startsOn || r.endsOn) ? ` · active ${r.startsOn || '…'} to ${r.endsOn || '…'}` : '')),
        h('div', { class: 'cell-actions' },
          btn('', { size: 'sm', kind: 'ghost', iconName: 'arrow-up', aria: 'Move up', disabled: i === 0, onClick: () => { [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; markDirty(); drawRules(); } }),
          btn('', { size: 'sm', kind: 'ghost', iconName: 'image', aria: 'Make an announcement image', onClick: () => { location.hash = `#/graphics?rule=${encodeURIComponent(r.id)}`; } }),
          btn('Edit', { size: 'sm', onClick: () => editRule(r) }),
          btn('', { size: 'sm', kind: 'ghost', iconName: 'trash', aria: 'Remove', onClick: () => { rules.splice(i, 1); markDirty(); drawRules(); } })));
    })));
    rulesBox.appendChild(h('p', { class: 'hint', style: 'margin-top:10px' }, 'When several rules hit the same date, the most specific wins: one date, then ranges, yearly, nth weekday, week of month, monthly. Ties go to the rule higher in this list.'));
  }

  function calendar() {
    const [y, m] = calMonth.split('-').map(Number);
    const first = `${calMonth}-01`;
    const startDow = new Date(`${first}T12:00:00Z`).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const grid = h('div', { class: 'month' }, DOW_NAMES.map((d) => h('div', { class: 'dow' }, d.slice(0, 3))));
    const cells = Math.ceil((startDow + days) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const d = addDays(first, i - startDow);
      const info = hoursFor(schedule(), d);
      const tag = info.closed && info.special ? h('span', { class: 'tag off' }, info.show === 'booked' ? 'Booked' : 'Closed')
        : info.closed ? h('span', { class: 'tag', style: 'color:var(--text-3)' }, 'Closed weekly')
        : info.blocks.length ? h('span', { class: 'tag off' }, `${time12(info.blocks[0].from)} to ${time12(info.blocks[0].to)} off`)
        : info.special ? h('span', { class: 'tag special' }, `${time12(info.open)} to ${time12(info.close)}`) : null;
      grid.appendChild(h('button', { type: 'button', class: `day ${d.slice(0, 7) !== calMonth ? 'out' : ''} ${info.closed ? 'closed' : ''} ${d === todayLocal() ? 'today' : ''}`,
        title: info.rule ? `${describeWhen(info.rule)}: ${describeWhat(info.rule)}` : 'Normal hours',
        onclick: () => (info.rule ? editRule(info.rule) : editRule(null, d)) }, h('span', { class: 'd' }, Number(d.slice(8))), tag));
    }
    const nav = (delta) => { const dt = new Date(Date.UTC(y, m - 1 + delta, 1)); calMonth = dt.toISOString().slice(0, 7); drawRules(); };
    return h('div', { class: 'stack' },
      h('div', { class: 'row between' }, btn('', { iconName: 'caret-left', aria: 'Previous month', onClick: () => nav(-1) }), h('strong', {}, `${MONTH_NAMES[m - 1]} ${y}`), btn('', { iconName: 'caret-right', aria: 'Next month', onClick: () => nav(1) })),
      grid, h('p', { class: 'hint' }, 'Click a day to edit its rule, or to add one for that date.'));
  }

  function editRule(rule, date) {
    const r = rule ? { ...rule, blocks: (rule.blocks || []).map((b) => ({ ...b })) } : { repeat: 'once', date: date || todayLocal(), what: 'closed', show: 'unavailable', blocks: [], note: '' };
    const repeat = select(REPEATS.map((x) => [x, REPEAT_LABEL[x]]), r.repeat);
    const whenBox = h('div', { class: 'grid grid-3' });
    const what = select([['closed', 'Closed all day'], ['hours', 'Special hours'], ['block', 'Usual hours, some hours off']], r.what);
    const show = select([['unavailable', 'Show as closed, with the note'], ['booked', 'Show as fully booked (note stays private)']], r.show || 'unavailable');
    const openIn = input({ type: 'time', value: r.open || '10:00', step: 900 });
    const closeIn = input({ type: 'time', value: r.close || '18:00', step: 900 });
    const blocksBox = h('div', { class: 'stack', style: 'gap:8px' });
    const note = textarea({ rows: 2, value: r.note || '', placeholder: 'e.g. Private event, Holy Week, maintenance' });
    const startsOn = input({ type: 'date', value: r.startsOn || '' });
    const endsOn = input({ type: 'date', value: r.endsOn || '' });
    const limits = h('div', { class: 'grid grid-2' }, field('Starting', startsOn, { hint: 'Optional' }), field('Ending', endsOn, { hint: 'Optional' }));
    const summary = h('div', { class: 'banner', style: 'margin:0' }, icon('info'), h('div'));
    const err = h('div', { class: 'field-error' });
    const showField = field('What the public sees', show);
    const hoursRow = h('div', { class: 'grid grid-2' }, field('Opens', openIn), field('Closes', closeIn));

    const monthOpts = (allowEvery) => [...(allowEvery ? [[0, 'Every month']] : []), ...MONTH_NAMES.map((n, i) => [i + 1, n])];
    const dayOpts = [...Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]), [-1, 'Last day']];
    function drawWhen() {
      clear(whenBox);
      const set = (k) => (e) => { r[k] = e.target.value; refresh(); };
      const t = repeat.value;
      if (t === 'once') whenBox.append(field('Date', input({ type: 'date', value: r.date || todayLocal(), oninput: set('date') })));
      if (t === 'range') {
        const yearly = checkbox('Repeat every year', !!r.yearly);
        yearly.input.addEventListener('change', () => { r.yearly = yearly.input.checked; refresh(); });
        whenBox.append(field('From', input({ type: 'date', value: r.from || todayLocal(), oninput: set('from') })), field('To', input({ type: 'date', value: r.to || addDays(todayLocal(), 3), oninput: set('to') })), h('div', { style: 'align-self:end' }, yearly));
      }
      if (t === 'yearly') whenBox.append(field('Month', select(monthOpts(false), r.month || 12, { onchange: set('month') })), field('Day', select(dayOpts, r.day || 25, { onchange: set('day') })));
      if (t === 'monthly') whenBox.append(field('Month', select(monthOpts(true), r.month ?? 0, { onchange: set('month') })), field('Day', select(dayOpts, r.day || 1, { onchange: set('day') })));
      if (t === 'nthWeekday') whenBox.append(field('Which', select([[1, 'First'], [2, 'Second'], [3, 'Third'], [4, 'Fourth'], [5, 'Fifth'], [-1, 'Last']], r.nth || 1, { onchange: set('nth') })), field('Weekday', select(DOW_NAMES.map((d, i) => [i, d]), r.weekday ?? 6, { onchange: set('weekday') })), field('Month', select(monthOpts(true), r.month ?? 0, { onchange: set('month') })));
      if (t === 'weekOfMonth') whenBox.append(field('Week', select([[1, 'Days 1 to 7'], [2, 'Days 8 to 14'], [3, 'Days 15 to 21'], [4, 'Days 22 to 28'], [5, 'Days 29 to 31'], [-1, 'Last 7 days']], r.week || 1, { onchange: set('week') })), field('Month', select(monthOpts(true), r.month ?? 0, { onchange: set('month') })));
      // Defaults so a fresh rule is valid before anything is touched.
      if (t === 'once') r.date = r.date || todayLocal();
      if (t === 'range') { r.from = r.from || todayLocal(); r.to = r.to || addDays(todayLocal(), 3); }
      if (t === 'yearly') { r.month = r.month || 12; r.day = r.day || 25; }
      if (t === 'monthly') { r.month = r.month ?? 0; r.day = r.day || 1; }
      if (t === 'nthWeekday') { r.nth = r.nth || 1; r.weekday = r.weekday ?? 6; r.month = r.month ?? 0; }
      if (t === 'weekOfMonth') { r.week = r.week || 1; r.month = r.month ?? 0; }
      limits.hidden = t === 'once' || (t === 'range' && !r.yearly);
    }
    function drawBlocks() {
      clear(blocksBox);
      (r.blocks || []).forEach((b, i) => {
        const f = input({ type: 'time', value: b.from, step: 900 });
        const t = input({ type: 'time', value: b.to, step: 900 });
        f.addEventListener('input', () => { b.from = f.value; refresh(); });
        t.addEventListener('input', () => { b.to = t.value; refresh(); });
        blocksBox.appendChild(h('div', { class: 'row' }, h('span', { class: 'faint' }, 'Off from'), f, h('span', { class: 'faint' }, 'to'), t,
          btn('', { size: 'sm', kind: 'ghost', iconName: 'x', aria: 'Remove', onClick: () => { r.blocks.splice(i, 1); drawBlocks(); refresh(); } })));
      });
      if ((r.blocks || []).length < 6) blocksBox.appendChild(h('div', {}, btn('Add hours off', { size: 'sm', iconName: 'plus', onClick: () => { r.blocks = r.blocks || []; r.blocks.push({ from: '14:00', to: '16:00' }); drawBlocks(); refresh(); } })));
    }
    function refresh() {
      r.repeat = repeat.value;
      r.what = what.value;
      r.show = show.value;
      r.open = openIn.value;
      r.close = closeIn.value;
      r.note = note.value;
      r.startsOn = startsOn.value || undefined;
      r.endsOn = endsOn.value || undefined;
      hoursRow.hidden = r.what !== 'hours';
      blocksSection.hidden = r.what === 'closed';
      showField.hidden = r.what === 'hours';
      const next = nextOccurrence(r);
      summary.lastChild.textContent = `${describeWhen(r)}: ${describeWhat(r) || '…'}.${next ? ` Next date: ${longDate(next)}.` : ' No upcoming date.'}${r.show === 'booked' ? ' The note is never shown publicly.' : ''}`;
    }
    const blocksSection = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Hours off'), blocksBox);
    repeat.addEventListener('change', () => { r.repeat = repeat.value; drawWhen(); refresh(); });
    [what, show, openIn, closeIn, note, startsOn, endsOn].forEach((c) => c.addEventListener('input', refresh));
    drawWhen();
    drawBlocks();
    refresh();

    openDialog({
      title: rule ? 'Edit special date' : 'Add a special date',
      body: h('div', { class: 'stack' }, field('When', repeat), whenBox, limits, field('What happens', what), hoursRow, blocksSection, showField, field('Note', note, { hint: 'Shown to customers unless the date is shown as booked.' }), summary, err),
      foot: (d) => [
        rule ? h('div', { class: 'left' }, btn('Remove', { kind: 'danger', onClick: () => { rules = rules.filter((x) => x.id !== rule.id); markDirty(); drawRules(); d.close(); } })) : null,
        btn('Cancel', { onClick: () => d.close() }),
        btn(rule ? 'Update' : 'Add', { kind: 'primary', onClick: () => {
          const res = normaliseRule(r);
          if (res.error) { err.textContent = res.error; return; }
          if (rule) rules = rules.map((x) => (x.id === rule.id ? res.rule : x));
          else rules.push(res.rule);
          markDirty();
          drawRules();
          d.close();
          toast('Added to the list. Save the schedule to apply it.');
        } }),
      ],
    });
  }

  function drawAffected(list) {
    clear(affectedBox);
    if (!list) return;
    if (!list.length) {
      affectedBox.appendChild(h('div', { class: 'banner', style: 'margin:0' }, icon('check-circle'), h('div', {}, 'Every upcoming booking still fits the schedule.')));
      return;
    }
    const pendingNotice = list.filter((a) => !a.notice_sent_at).length;
    affectedBox.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, `${list.length} upcoming booking${list.length === 1 ? '' : 's'} no longer fit`),
        btn(pendingNotice ? `Email ${pendingNotice === list.length ? 'everyone' : `the ${pendingNotice} not told yet`}` : 'Email everyone again', { kind: 'primary', iconName: 'paper-plane-tilt', onClick: async (e) => {
          const ids = pendingNotice ? list.filter((a) => !a.notice_sent_at).map((a) => a.id) : list.map((a) => a.id);
          if (!(await confirmDialog({ title: `Email ${ids.length} customer${ids.length === 1 ? '' : 's'}?`, message: 'Each gets the schedule-change email explaining what changed. You can edit its wording in Email templates.', confirmLabel: 'Send' }))) return;
          const r = await run(e.currentTarget, () => api('schedule.notify', { ids })).catch(() => null);
          if (r) toast(`${r.sent} sent${r.noEmail ? `, ${r.noEmail} without email (call them)` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`, r.failed ? 'warn' : 'ok');
          refreshAffected();
        } })),
      h('div', { class: 'panel-body list' }, list.map((a) => h('div', { class: 'list-item' },
        icon('warning', 'faint'),
        h('div', { style: 'flex:1' }, h('div', { class: 'cell-title' }, `${a.name}, ${fmtWhen(a.start_at, a.end_at)}`), h('div', { class: 'cell-sub' }, a.reason),
          h('div', { class: 'cell-sub' }, [a.phone, a.email].filter(Boolean).join(' · ') || 'No contact details')),
        a.notice_sent_at ? pill(`Told ${fmtDateTime(a.notice_sent_at)}`, 'teal') : pill('Not told yet', 'warn'),
        btn('Open', { size: 'sm', onClick: () => { location.hash = `#/bookings?b=${a.id}`; } }))))));
  }

  async function refreshAffected() {
    drawAffected((await api('schedule.affected')).conflicts);
  }

  async function save(button) {
    const out = await run(button, () => api('schedule.save', { room_id: roomId, weekly, overrides: rules }), { success: 'Schedule saved. The website uses it now.' }).catch(() => null);
    if (!out) return;
    dirty = false;
    dirtyNote.hidden = true;
    drawAffected(out.conflicts);
  }

  const roomPick = state.rooms.length > 1 ? select(state.rooms.map((r) => [r.id, r.name]), roomId) : null;
  roomPick?.addEventListener('change', async () => {
    if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', message: 'Switching rooms reloads the schedule.', confirmLabel: 'Discard' }))) { roomPick.value = roomId; return; }
    roomId = roomPick.value; load();
  });

  root.append(
    pageHead('Schedule', 'When customers can book. Special dates apply to every room.', [dirtyNote, roomPick, saveBtn].filter(Boolean)),
    h('div', { class: 'stack' },
      affectedBox,
      h('div', { class: 'split', style: 'align-items:start' },
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Weekly hours')), h('div', { class: 'panel-body' }, weeklyBox)),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Special dates')), h('div', { class: 'panel-body' }, rulesBox)))));
  await load();
  refreshAffected().catch(() => {});
  const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  return () => { window.removeEventListener('beforeunload', warn); if (dirty) toast('Unsaved schedule changes were discarded.', 'warn'); };
}
