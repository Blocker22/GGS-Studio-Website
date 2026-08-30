import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

function peso(n) { return '₱' + Math.round(n).toLocaleString('en-PH'); }
function dt(s) { return new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function d(s) { return new Date(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

// window.prompt()/confirm() are blocked in some hosts this admin panel runs
// in (e.g. an editor's embedded webview throws "prompt() is not supported"
// instead of showing anything), so every yes/no or fill-in-a-value question
// goes through this instead — same modal-backdrop/.modal look already used
// for the payment QR modal, resolved as a promise rather than blocking.
function dialogModal({ title, message, showInput, inputPlaceholder, confirmLabel = 'OK', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const inputEl = showInput
      ? el('input', { class: 'a-input', placeholder: inputPlaceholder || '', style: 'margin-top:10px; width:100%;' })
      : null;
    const finish = (value) => {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && inputEl && document.activeElement === inputEl) finish(inputEl.value);
    };
    const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: 'width:min(420px, 100%);' }, [
      el('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close', onclick: () => finish(null) }, '×'),
      el('h3', {}, title),
      el('div', { class: 'modal-body' }, [
        el('p', { style: 'font-size:0.88rem; line-height:1.55; white-space:pre-wrap; margin:0;' }, message),
        ...(inputEl ? [inputEl] : []),
      ]),
      el('div', { class: 'modal-foot', style: 'display:flex; gap:10px; justify-content:flex-end;' }, [
        el('button', { type: 'button', class: 'a-btn-ghost', onclick: () => finish(null) }, cancelLabel),
        el('button', { type: 'button', class: 'a-btn-gold', onclick: () => finish(inputEl ? inputEl.value : true) }, confirmLabel),
      ]),
    ]);
    const backdrop = el('div', { class: 'modal-backdrop' }, [dialog]);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));
    if (inputEl) inputEl.focus();
  });
}

// Drop-in replacement for window.prompt(): resolves to the typed string, or
// null if the dialog was cancelled/dismissed — same contract callers already
// coded against.
function promptDialog(message, opts = {}) {
  return dialogModal({ title: opts.title || 'Enter a value', message, showInput: true, inputPlaceholder: opts.placeholder, confirmLabel: opts.confirmLabel || 'OK' });
}

// Drop-in replacement for window.confirm(): resolves true/false.
function confirmDialog(message, opts = {}) {
  return dialogModal({ title: opts.title || 'Confirm', message, showInput: false, confirmLabel: opts.confirmLabel || 'OK', cancelLabel: opts.cancelLabel || 'Cancel' })
    .then((v) => v === true);
}

const EYE_OPEN = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

function initPasswordToggles() {
  document.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    const input = document.getElementById(btn.dataset.pwToggle);
    if (!input || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.querySelector('svg').innerHTML = show ? EYE_OFF : EYE_OPEN;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

async function main() {
  initPasswordToggles();
  const supabase = await getSupabase();

  async function callFunction(name, body) {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) throw new Error('Not authenticated.');
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sess.session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(json.error || 'Request failed.');
      // delete-booking hands back unrefunded_amount so the caller can offer a
      // "delete anyway" path instead of a dead end; delete-account uses
      // can_force for the same purpose.
      if (json.unrefunded_amount != null) err.unrefundedAmount = json.unrefunded_amount;
      if (json.can_force) err.canForce = true;
      throw err;
    }
    return json;
  }

  // ---------- Auth gate ----------
  const loginWrap = document.getElementById('loginWrap');
  const adminShell = document.getElementById('adminShell');
  const loginForm = document.getElementById('loginForm');
  const loginMsg = document.getElementById('loginMsg');
  const adminUserName = document.getElementById('adminUserName');
  const logoutBtn = document.getElementById('logoutBtn');

  let profile = null;

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginMsg.style.display = 'none';
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      loginMsg.textContent = error.message;
      loginMsg.classList.add('error');
      loginMsg.style.display = 'block';
    }
  });

  logoutBtn.addEventListener('click', () => supabase.auth.signOut());

  async function checkAccess() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      profile = null;
      loginWrap.style.display = 'flex';
      adminShell.style.display = 'none';
      return false;
    }
    const { data: p } = await supabase.from('profiles').select('id, full_name, role').eq('id', data.session.user.id).single();
    profile = p;
    if (!p || !['staff', 'admin'].includes(p.role)) {
      loginMsg.textContent = 'This account does not have staff access.';
      loginMsg.classList.add('error');
      loginMsg.style.display = 'block';
      loginWrap.style.display = 'flex';
      adminShell.style.display = 'none';
      await supabase.auth.signOut();
      return false;
    }
    loginWrap.style.display = 'none';
    adminShell.style.display = 'flex';
    adminUserName.textContent = p.full_name || data.session.user.email;
    document.getElementById('inviteCard').style.display = p.role === 'admin' ? 'block' : 'none';
    return true;
  }

  supabase.auth.onAuthStateChange(async (event) => {
    // INITIAL_SESSION fires immediately on page load — the boot sequence at
    // the bottom of this file already handles that first load. TOKEN_REFRESHED
    // fires silently every ~hour and doesn't need a re-render. Reacting to
    // both here duplicated every loaded tab's content (e.g. dashboard stat
    // cards rendering twice) via a race with the boot call.
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    const ok = await checkAccess();
    if (ok) loadActiveTab();
  });

  // ---------- Tabs ----------
  const tabs = ['dashboard', 'bookings', 'customers', 'rooms', 'availability', 'payments', 'staff', 'settings'];
  let activeTab = 'dashboard';

  document.getElementById('adminNav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll('#adminNav button').forEach((b) => b.classList.toggle('active', b === btn));
    tabs.forEach((t) => document.getElementById(`tab-${t}`).classList.toggle('active', t === activeTab));
    loadActiveTab();
  });

  // A tab's loader can be asked to run again while its previous run is still
  // in flight — e.g. the auth-change listener above firing a beat after the
  // boot call already started loading the dashboard. Each loader clearing
  // and rebuilding its own DOM atomically (see loadDashboard) already makes
  // that safe to render, but there's no reason to let a stale trigger fire a
  // second redundant round of queries on top — skip it and let the run
  // already in flight finish.
  const tabLoadInFlight = {};
  function loadActiveTab() {
    const loaders = {
      dashboard: loadDashboard, bookings: loadBookings, customers: loadCustomers,
      rooms: loadRooms, availability: loadAvailability, payments: loadPayments,
      staff: loadStaff, settings: loadSettings,
    };
    const loader = loaders[activeTab];
    if (!loader || tabLoadInFlight[activeTab]) return;
    tabLoadInFlight[activeTab] = Promise.resolve(loader()).finally(() => {
      delete tabLoadInFlight[activeTab];
    });
  }

  // ---------- Dashboard ----------
  async function loadDashboard() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const [{ data: bookings }, { data: monthPayments }, { data: today }] = await Promise.all([
      supabase.from('bookings').select('id, status, total_price'),
      supabase.from('payments').select('amount').eq('status', 'succeeded').gte('created_at', startOfMonth),
      supabase.from('bookings').select('id, start_at, status, rooms(name)').gte('start_at', startOfDay).lt('start_at', endOfDay).neq('status', 'cancelled').order('start_at'),
    ]);

    const pending = (bookings || []).filter((b) => b.status === 'pending').length;
    const revenue = (monthPayments || []).reduce((s, p) => s + Number(p.amount), 0);

    const stat = (label, value, cls = '') =>
      el('div', { class: 'stat-box' }, [el('div', { class: 'a-label' }, label), el('div', { class: `val ${cls}` }, String(value))]);

    // The clear used to happen before the fetch above, with the append only
    // landing once it resolved — so two overlapping loadDashboard() calls
    // (one already in flight when a second one starts, e.g. from the
    // sign-in auth event firing a beat after the page's own boot call) would
    // both clear early and then each append its own 4 cards on top of
    // whichever landed first, doubling every tile. Clearing and appending
    // now happen back-to-back with no await between them, so whichever call
    // finishes last always wins outright instead of stacking on the other.
    const statsEl = document.getElementById('dashStats');
    statsEl.innerHTML = '';
    statsEl.append(
      stat('Total bookings', bookings?.length || 0),
      stat('Pending approval', pending, 'text-gold-stat'),
      stat("Today's sessions", (today || []).length),
      stat('Revenue this month', peso(revenue)),
    );
    statsEl.querySelectorAll('.text-gold-stat').forEach((n) => (n.style.color = 'var(--gold)'));

    await loadDashboardCalendarData();
    renderDashCalendar();
    renderWeekSchedule();
  }

  // ---------- Dashboard: clickable calendar + weekly class-schedule ----------
  const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEK_DAY_START = 8; // 8am
  const WEEK_DAY_END = 22; // 10pm
  const WEEK_ROWS = (WEEK_DAY_END - WEEK_DAY_START) * 2; // 30-min rows

  let dashCalDate = new Date();
  let dashSelectedDate = new Date();
  let weekStartDate = startOfWeek(new Date());
  let dashBookingsCache = [];
  let dashBookingsRangeLoaded = null;

  function startOfWeek(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  }

  function to12HourLabel(h) {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = ((h + 11) % 12) + 1;
    return `${hour}${period}`;
  }

  async function loadDashboardCalendarData() {
    if (roomsCache.length === 0) await loadRoomsServicesCache();
    // covers the visible month view plus a wide buffer for week navigation
    const from = new Date(dashCalDate.getFullYear(), dashCalDate.getMonth() - 2, 1);
    const to = new Date(dashCalDate.getFullYear(), dashCalDate.getMonth() + 3, 0);
    const rangeKey = `${from.toDateString()}_${to.toDateString()}`;
    if (dashBookingsRangeLoaded === rangeKey) return;

    const { data } = await supabase
      .from('bookings')
      .select('*, rooms(id,name), profiles!bookings_customer_id_fkey(id,full_name), booking_services(service_id, services(name)), payments(amount, status, method, type, rejection_reason)')
      .gte('start_at', from.toISOString())
      .lte('start_at', to.toISOString())
      .order('start_at');
    dashBookingsCache = data || [];
    dashBookingsRangeLoaded = rangeKey;
  }

  function renderDashCalendar() {
    const grid = document.getElementById('dashCalGrid');
    if (!grid) return;
    const year = dashCalDate.getFullYear();
    const month = dashCalDate.getMonth();
    document.getElementById('dashCalMonthLabel').textContent = dashCalDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

    const firstOfMonth = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
    const todayKey = new Date().toDateString();
    const selectedKey = dashSelectedDate.toDateString();

    const hasBooking = {};
    dashBookingsCache.forEach((b) => {
      if (b.status !== 'cancelled') hasBooking[new Date(b.start_at).toDateString()] = true;
    });

    grid.innerHTML = '';
    DOW_SHORT.forEach((dw) => grid.appendChild(el('div', { class: 'cal-dow' }, dw)));

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = cellDate.toDateString();
      const cls = ['cal-day'];
      if (cellDate.getMonth() !== month) cls.push('other-month');
      if (key === todayKey) cls.push('today');
      if (key === selectedKey) cls.push('selected');
      const cell = el('div', { class: cls.join(' '), onclick: () => selectDashDate(cellDate) });
      cell.appendChild(el('div', { class: 'cal-daynum' }, String(cellDate.getDate())));
      if (hasBooking[key]) cell.appendChild(el('div', { class: 'cal-dot' }));
      grid.appendChild(cell);
    }
  }

  async function selectDashDate(dateObj) {
    dashSelectedDate = dateObj;
    weekStartDate = startOfWeek(dateObj);
    if (dateObj.getMonth() !== dashCalDate.getMonth() || dateObj.getFullYear() !== dashCalDate.getFullYear()) {
      dashCalDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
      await loadDashboardCalendarData();
    }
    renderDashCalendar();
    renderWeekSchedule();
  }

  document.getElementById('dashCalPrev').addEventListener('click', async () => {
    dashCalDate = new Date(dashCalDate.getFullYear(), dashCalDate.getMonth() - 1, 1);
    await loadDashboardCalendarData();
    renderDashCalendar();
  });
  document.getElementById('dashCalNext').addEventListener('click', async () => {
    dashCalDate = new Date(dashCalDate.getFullYear(), dashCalDate.getMonth() + 1, 1);
    await loadDashboardCalendarData();
    renderDashCalendar();
  });
  document.getElementById('dashCalToday').addEventListener('click', () => {
    dashCalDate = new Date();
    selectDashDate(new Date());
  });
  document.getElementById('weekPrev').addEventListener('click', () => {
    weekStartDate = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() - 7);
    renderWeekSchedule();
  });
  document.getElementById('weekNext').addEventListener('click', () => {
    weekStartDate = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 7);
    renderWeekSchedule();
  });

  function renderWeekSchedule() {
    const grid = document.getElementById('weekGrid');
    if (!grid) return;
    grid.setAttribute('style', `grid-template-rows: auto repeat(${WEEK_ROWS}, 26px);`);
    grid.innerHTML = '';

    const weekDates = Array.from({ length: 7 }, (_, i) => new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + i));
    const todayKey = new Date().toDateString();

    document.getElementById('weekRangeLabel').textContent =
      `${weekDates[0].toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    grid.appendChild(el('div', { class: 'wk-head corner' }));
    weekDates.forEach((dObj) => {
      grid.appendChild(
        el('div', { class: `wk-head${dObj.toDateString() === todayKey ? ' today' : ''}` }, [
          el('div', { class: 'd' }, DOW_SHORT[dObj.getDay()]),
          el('div', {}, String(dObj.getDate())),
        ]),
      );
    });

    for (let h = WEEK_DAY_START; h < WEEK_DAY_END; h++) {
      const rowStart = 2 + (h - WEEK_DAY_START) * 2;
      grid.appendChild(el('div', { class: 'wk-timelabel', style: `grid-row:${rowStart} / span 2;` }, to12HourLabel(h)));
    }
    for (let col = 0; col < 7; col++) {
      grid.appendChild(
        el('div', {
          class: 'wk-cell',
          style: `grid-column:${col + 2}; grid-row:2 / span ${WEEK_ROWS}; background-image:repeating-linear-gradient(to bottom, transparent 0, transparent 51px, rgba(244,248,248,0.08) 51px, rgba(244,248,248,0.08) 52px);`,
        }),
      );
    }

    const weekEndExclusive = new Date(weekDates[6].getFullYear(), weekDates[6].getMonth(), weekDates[6].getDate() + 1);
    dashBookingsCache
      .filter((b) => {
        const s = new Date(b.start_at);
        return s >= weekDates[0] && s < weekEndExclusive;
      })
      .forEach((b) => {
        const start = new Date(b.start_at);
        const end = new Date(b.end_at);
        const dayIdx = start.getDay();
        const windowMinutes = WEEK_ROWS * 30;
        const startMin = Math.max(0, (start.getHours() - WEEK_DAY_START) * 60 + start.getMinutes());
        const endMin = Math.min(windowMinutes, (end.getHours() - WEEK_DAY_START) * 60 + end.getMinutes());
        if (endMin <= 0 || startMin >= windowMinutes) return;
        const rowStart = 2 + Math.floor(startMin / 30);
        const rowEnd = Math.max(rowStart + 1, 2 + Math.ceil(endMin / 30));

        grid.appendChild(
          el(
            'div',
            {
              class: `wk-block status-${b.status}`,
              style: `grid-column:${dayIdx + 2}; grid-row:${rowStart} / ${rowEnd};`,
              onclick: () => openEditModal(b),
            },
            [
              el('b', {}, start.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })),
              `${b.rooms?.name || ''} · ${b.profiles?.full_name || b.guest_name || 'Customer'}`,
            ],
          ),
        );
      });
  }

  // ---------- Bookings ----------
  let allBookings = [];
  let bookingsChannel = null;
  let roomsCache = [];
  let servicesCache = [];

  async function loadRoomsServicesCache() {
    const [{ data: rooms }, { data: services }] = await Promise.all([
      supabase.from('rooms').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
    ]);
    roomsCache = rooms || [];
    servicesCache = services || [];
  }

  function sortedServices() {
    return servicesCache
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  }

  // Every service that reaches `rootId` by following requires_service_id — the
  // ones that already depend on it. Offering any of them as rootId's own
  // prerequisite would close a cycle, and a cycle is a set of services nobody
  // could ever book.
  function dependantsOf(rootId) {
    const found = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      servicesCache.forEach((s) => {
        if (found.has(s.id) || !s.requires_service_id) return;
        if (s.requires_service_id === rootId || found.has(s.requires_service_id)) {
          found.add(s.id);
          grew = true;
        }
      });
    }
    return found;
  }

  function requiresSelect(serviceId, currentValue) {
    const blocked = dependantsOf(serviceId);
    const sel = el('select', { class: 'a-input' }, [el('option', { value: '' }, '— nothing —')]);
    sortedServices().forEach((s) => {
      if (s.id === serviceId || blocked.has(s.id)) return;
      sel.appendChild(el('option', { value: s.id }, s.name));
    });
    sel.value = currentValue || '';
    return sel;
  }

  // Applies every services.requires_service_id rule to a set of checkboxes,
  // whichever admin form they belong to: a service whose prerequisite is not
  // ticked is disabled and cleared. Loops to a fixed point so chains settle.
  function enforceServiceDeps(svcWrap) {
    const boxes = Array.from(svcWrap.querySelectorAll('input[type="checkbox"]'));
    const boxById = new Map(boxes.map((c) => [c.value, c]));
    const svcById = new Map(servicesCache.map((s) => [s.id, s]));
    for (let pass = 0; pass <= boxes.length; pass++) {
      let changed = false;
      boxes.forEach((cb) => {
        const requiredId = svcById.get(cb.value)?.requires_service_id || null;
        const requiredBox = requiredId ? boxById.get(requiredId) : null;
        const locked = Boolean(requiredId) && (!requiredBox || !requiredBox.checked || requiredBox.disabled);
        if (cb.disabled !== locked) { cb.disabled = locked; changed = true; }
        if (locked && cb.checked) { cb.checked = false; changed = true; }
      });
      if (!changed) break;
    }
    boxes.forEach((cb) => {
      const svc = svcById.get(cb.value);
      const requiredName = svc?.requires_service_id ? svcById.get(svc.requires_service_id)?.name : null;
      const row = cb.closest('label');
      if (row) row.title = cb.disabled && requiredName ? `Requires ${requiredName}` : '';
      if (row) row.style.opacity = cb.disabled ? '0.45' : '';
    });
  }

  async function loadBookings() {
    if (roomsCache.length === 0) await loadRoomsServicesCache();

    const { data, error } = await supabase
      .from('bookings')
      .select('*, rooms(id,name), profiles!bookings_customer_id_fkey(id,full_name), booking_services(service_id, quantity, services(name, price_type, unit_label)), payments(amount, status, method, type, rejection_reason)')
      .order('start_at', { ascending: false });
    if (error) {
      document.getElementById('bookingsBody').innerHTML = `<tr><td colspan="7">Error: ${error.message}</td></tr>`;
      return;
    }
    allBookings = data || [];
    renderBookings();
    renderCalendar();
    populateNewBookingForm();

    if (!bookingsChannel) {
      bookingsChannel = supabase
        .channel('admin-bookings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
          if (activeTab === 'bookings') loadBookings();
        })
        .subscribe();
    }
  }

  function renderBookings() {
    const status = document.getElementById('fltStatus').value;
    const search = document.getElementById('fltSearch').value.toLowerCase();
    const from = document.getElementById('fltFrom').value;
    const to = document.getElementById('fltTo').value;

    const filtered = allBookings.filter((b) => {
      if (status && b.status !== status) return false;
      if (search && !(b.profiles?.full_name || b.guest_name || '').toLowerCase().includes(search)) return false;
      if (from && new Date(b.start_at) < new Date(from)) return false;
      if (to && new Date(b.start_at) > new Date(to + 'T23:59:59')) return false;
      return true;
    });

    const body = document.getElementById('bookingsBody');
    body.innerHTML = '';
    if (filtered.length === 0) {
      body.appendChild(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;opacity:0.5;padding:24px;' }, 'No bookings match these filters.')));
      return;
    }

    filtered.forEach((b) => {
      const paid = paidAmount(b);
      const actions = el('div', { class: 'row-flex' });
      if (b.status === 'pending') {
        actions.append(
          el('button', { class: 'a-btn-ghost', onclick: () => setStatus(b.id, 'confirmed') }, 'Approve'),
          el('button', { class: 'a-btn-ghost', onclick: () => cancelBooking(b.id) }, 'Reject'),
        );
      } else if (b.status === 'confirmed') {
        actions.append(
          el('button', { class: 'a-btn-ghost', onclick: () => setStatus(b.id, 'completed') }, 'Completed'),
          el('button', { class: 'a-btn-ghost', onclick: () => setStatus(b.id, 'no_show') }, 'No-show'),
          el('button', { class: 'a-btn-ghost', onclick: () => cancelBooking(b.id) }, 'Cancel'),
        );
      }
      if (paid < Number(b.total_price) && b.status !== 'cancelled') {
        actions.append(el('button', { class: 'a-btn-ghost', onclick: () => markPaid(b) }, 'Mark Paid'));
      }
      actions.append(el('button', { class: 'a-btn-ghost', onclick: () => openEditModal(b) }, 'Edit'));
      actions.append(el('button', { class: 'a-btn-danger', onclick: () => deleteBooking(b.id) }, 'Delete'));
      body.appendChild(
        el('tr', {}, [
          el('td', {}, dt(b.start_at)),
          el('td', {}, b.rooms?.name || ''),
          el('td', {}, b.profiles?.full_name || (b.guest_name ? `${b.guest_name} (guest)` : '—')),
          el('td', {}, payOptionCell(b)),
          el('td', { style: 'opacity:0.6;' }, (b.booking_services || [])
            .filter((bs) => bs.services?.name)
            .map((bs) => bs.services.price_type === 'unit' ? `${bs.services.name} (${bs.quantity} ${bs.services.unit_label || 'unit'})` : bs.services.name)
            .join(', ') || '—'),
          el('td', {}, peso(b.total_price)),
          el('td', {}, paymentPill(b)),
          el('td', {}, el('span', { class: `pill pill-${b.status}` }, b.status.replace('_', ' '))),
          el('td', {}, actions),
        ]),
      );
    });
  }

  const PAY_OPTION_LABEL = { cash: 'Cash', deposit: 'Downpayment (online)', full: 'Full (online)' };

  // Valid IDs live in a private bucket, so staff get a short-lived signed URL
  // rather than a permanent link that could leak out of the dashboard.
  async function viewIdImage(path) {
    const { data, error } = await supabase.storage.from('customer-ids').createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      alert('Could not open that ID: ' + (error?.message || 'unknown error'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  function payOptionCell(b) {
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-start;' }, [
      el('span', { style: 'font-size:0.78rem;' }, PAY_OPTION_LABEL[b.payment_option] || b.payment_option || '—'),
    ]);
    if (b.id_image_path) {
      wrap.appendChild(
        el('button', {
          class: 'a-btn-ghost',
          style: 'padding:3px 8px;font-size:0.68rem;',
          onclick: () => viewIdImage(b.id_image_path),
        }, 'View ID'),
      );
    } else if (b.payment_option === 'cash' && !b.created_by) {
      wrap.appendChild(el('span', { style: 'font-size:0.65rem;color:#e5876f;' }, 'No ID on file'));
    }
    return wrap;
  }

  function paidAmount(booking) {
    return (booking.payments || [])
      .filter((p) => p.status === 'succeeded' || p.status === 'partially_refunded')
      .reduce((s, p) => s + Number(p.amount), 0);
  }

  function paymentPill(booking) {
    const paid = paidAmount(booking);
    const total = Number(booking.total_price);
    // An unverified QR transfer outranks "Unpaid" in the list — it's the row
    // that needs someone to act, and it's easy to miss on the Payments tab.
    const manual = (booking.payments || []).find((p) => p.method === 'manual');
    if (paid <= 0 && manual?.status === 'submitted') {
      return el('span', { class: 'pill pill-pending', style: 'color:#e5a03f;border-color:#8a6320;' }, 'Receipt to review');
    }
    if (paid <= 0 && manual?.status === 'rejected') {
      return el('span', { class: 'pill pill-cancelled' }, 'Receipt rejected');
    }
    if (paid <= 0) return el('span', { class: 'pill pill-cancelled' }, 'Unpaid');
    if (paid >= total) return el('span', { class: 'pill pill-confirmed' }, 'Paid');
    return el('span', { class: 'pill pill-pending' }, `Partial (${peso(paid)})`);
  }

  async function markPaid(booking) {
    const remaining = Number(booking.total_price) - paidAmount(booking);
    const input = await promptDialog(`Amount received in cash (₱), leave blank for full remaining balance ₱${Math.round(remaining)}:`);
    if (input === null) return;
    const amount = input.trim() ? Number(input) : undefined;
    try {
      await callFunction('mark-paid', { booking_id: booking.id, amount });
      loadBookings();
    } catch (err) {
      alert(err.message);
    }
  }

  ['fltStatus', 'fltSearch', 'fltFrom', 'fltTo'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderBookings);
  });
  document.getElementById('fltReset').addEventListener('click', () => {
    ['fltStatus', 'fltSearch', 'fltFrom', 'fltTo'].forEach((id) => (document.getElementById(id).value = ''));
    renderBookings();
    renderCalendar();
  });

  // ---------- Bookings: List / Calendar toggle ----------
  const listView = document.getElementById('bookingsListView');
  const calView = document.getElementById('bookingsCalendarView');
  document.getElementById('bookingsViewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    document.querySelectorAll('#bookingsViewToggle button').forEach((b) => b.classList.toggle('active', b === btn));
    const isCalendar = btn.dataset.view === 'calendar';
    listView.style.display = isCalendar ? 'none' : '';
    calView.style.display = isCalendar ? '' : 'none';
    if (isCalendar) renderCalendar();
  });

  // ---------- Bookings: Calendar ----------
  let calDate = new Date();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  document.getElementById('calPrev').addEventListener('click', () => {
    calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('calToday').addEventListener('click', () => {
    calDate = new Date();
    renderCalendar();
  });

  function renderCalendar() {
    const grid = document.getElementById('calGrid');
    if (!grid || calView.style.display === 'none') return;
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    document.getElementById('calMonthLabel').textContent = calDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const today = new Date();
    const todayKey = today.toDateString();

    const byDay = {};
    allBookings.forEach((b) => {
      const key = new Date(b.start_at).toDateString();
      (byDay[key] = byDay[key] || []).push(b);
    });

    grid.innerHTML = '';
    DOW.forEach((d) => grid.appendChild(el('div', { class: 'cal-dow' }, d)));

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = cellDate.toDateString();
      const dayBookings = (byDay[key] || []).sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
      const cell = el('div', {
        class: `cal-day${cellDate.getMonth() !== month ? ' other-month' : ''}${key === todayKey ? ' today' : ''}`,
      });
      cell.appendChild(el('div', { class: 'cal-daynum' }, String(cellDate.getDate())));
      const visible = dayBookings.slice(0, 3);
      visible.forEach((b) => {
        const time = new Date(b.start_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
        cell.appendChild(
          el('div', {
            class: `cal-chip status-${b.status}`,
            onclick: () => openEditModal(b),
          }, `${time} ${b.rooms?.name || ''}`),
        );
      });
      if (dayBookings.length > 3) {
        cell.appendChild(el('div', { class: 'cal-more' }, `+${dayBookings.length - 3} more`));
      }
      grid.appendChild(cell);
    }
  }

  // ---------- Edit booking modal ----------
  const editBackdrop = document.getElementById('editModalBackdrop');
  const editForm = document.getElementById('editBookingForm');
  let editingBookingId = null;

  function openEditModal(booking) {
    editingBookingId = booking.id;
    document.getElementById('ebMsg').style.display = 'none';

    // Preselect whoever the booking actually belongs to, so saving without
    // touching this field can't quietly move it to someone else.
    Promise.resolve(wireCustomerPicker('eb')).then(() => {
      if (booking.guest_name) {
        setCustomerMode('eb', 'guest');
        document.getElementById('ebGuestName').value = booking.guest_name;
        document.getElementById('ebCustomer').value = '';
      } else {
        setCustomerMode('eb', 'account');
        document.getElementById('ebGuestName').value = '';
        document.getElementById('ebCustomer').value = booking.customer_id || '';
      }
    });

    const roomSel = document.getElementById('ebRoom');
    roomSel.innerHTML = roomsCache.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
    roomSel.value = booking.room_id;

    const start = new Date(booking.start_at);
    const end = new Date(booking.end_at);
    document.getElementById('ebDate').value = start.toISOString().slice(0, 10);
    document.getElementById('ebStart').value = start.toTimeString().slice(0, 5);
    document.getElementById('ebDuration').value = ((end - start) / 3600000).toFixed(1);
    document.getElementById('ebStatus').value = booking.status;
    document.getElementById('ebNotes').value = booking.notes || '';

    const selectedIds = new Set((booking.booking_services || []).map((bs) => bs.service_id));
    const svcWrap = document.getElementById('ebServices');
    svcWrap.innerHTML = '';
    sortedServices().forEach((s) => {
      const cb = el('input', { type: 'checkbox', value: s.id });
      cb.checked = selectedIds.has(s.id);
      cb.addEventListener('change', () => enforceServiceDeps(svcWrap));
      svcWrap.appendChild(el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:0.82rem;' }, [cb, ` ${s.name}`]));
    });
    enforceServiceDeps(svcWrap);

    renderEbPaymentStatus(booking);
    editBackdrop.classList.add('open');
  }

  function renderEbPaymentStatus(booking) {
    const paid = paidAmount(booking);
    const total = Number(booking.total_price);
    const statusEl = document.getElementById('ebPaymentStatus');
    const btn = document.getElementById('ebMarkPaidBtn');
    if (paid >= total) {
      statusEl.textContent = `Paid in full (${peso(paid)})`;
      statusEl.style.color = 'var(--teal)';
      btn.style.display = 'none';
    } else if (paid > 0) {
      statusEl.textContent = `Partially paid — ${peso(paid)} of ${peso(total)}`;
      statusEl.style.color = 'var(--gold)';
      btn.style.display = '';
    } else {
      statusEl.textContent = `Unpaid — ${peso(total)} due`;
      statusEl.style.color = '#e5876f';
      btn.style.display = '';
    }
    // Approving a QR receipt happens on the Payments tab, where the receipt
    // itself can actually be opened — point there rather than duplicating it.
    const manual = (booking.payments || []).find((p) => p.method === 'manual' && p.status === 'submitted');
    if (manual) {
      statusEl.textContent += ' · QR receipt awaiting review on the Payments tab';
      statusEl.style.color = '#e5a03f';
    }
    btn.onclick = async () => {
      const remaining = total - paid;
      const input = await promptDialog(`Amount received in cash (₱), leave blank for full remaining balance ₱${Math.round(remaining)}:`);
      if (input === null) return;
      const amount = input.trim() ? Number(input) : undefined;
      try {
        const result = await callFunction('mark-paid', { booking_id: booking.id, amount });
        booking.payments = [...(booking.payments || []), { amount: result.payment.amount, status: result.payment.status }];
        renderEbPaymentStatus(booking);
        loadBookings();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function closeEditModal() {
    editBackdrop.classList.remove('open');
    editingBookingId = null;
  }
  document.getElementById('ebCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('ebDeleteBtn').addEventListener('click', () => {
    if (!editingBookingId) return;
    deleteBooking(editingBookingId, { onDeleted: () => { closeEditModal(); loadBookings(); } });
  });
  editBackdrop.addEventListener('click', (e) => {
    if (e.target === editBackdrop) closeEditModal();
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('ebMsg');
    msg.style.display = 'none';

    const date = document.getElementById('ebDate').value;
    const start = document.getElementById('ebStart').value;
    const duration = Number(document.getElementById('ebDuration').value);
    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(startAt.getTime() + duration * 3600000);
    const serviceIds = Array.from(document.getElementById('ebServices').querySelectorAll('input:checked')).map((i) => i.value);

    try {
      const { isGuest, customerId, guestName } = customerPickerValues('eb');
      if (isGuest && !guestName) throw new Error("Please enter the customer's name.");
      if (!isGuest && !customerId) throw new Error('Please choose a customer.');

      await callFunction('update-booking', {
        booking_id: editingBookingId,
        room_id: document.getElementById('ebRoom').value,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: document.getElementById('ebStatus').value,
        notes: document.getElementById('ebNotes').value,
        service_ids: serviceIds,
        customer_id: customerId || undefined,
        guest_name: guestName || undefined,
      });
      closeEditModal();
      loadBookings();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
      msg.style.display = 'block';
    }
  });

  async function setStatus(id, status) {
    try {
      await callFunction('update-booking', { booking_id: id, status });
      loadBookings();
    } catch (err) {
      alert(err.message);
    }
  }
  async function cancelBooking(id) {
    const reason = (await promptDialog('Cancellation reason (optional):')) || undefined;
    try {
      await callFunction('cancel-booking', { booking_id: id, reason });
      loadBookings();
    } catch (err) {
      alert(err.message);
    }
  }

  // Permanent removal, distinct from cancelBooking above — that only flips
  // status and keeps the record around; this erases the row (and, via
  // ON DELETE CASCADE, its services and payments) for good. The server
  // refuses when money was taken and never refunded unless force is passed,
  // so the confirm here has to name that before re-sending with force:true.
  async function deleteBooking(id, { onDeleted } = {}) {
    if (!(await confirmDialog('Permanently delete this booking? This cannot be undone.'))) return;
    try {
      await callFunction('delete-booking', { booking_id: id });
      (onDeleted || loadBookings)();
    } catch (err) {
      if (err.unrefundedAmount) {
        const force = await confirmDialog(
          `${err.message}

Delete anyway and write off the unrefunded amount?`,
        );
        if (!force) return;
        try {
          await callFunction('delete-booking', { booking_id: id, force: true });
          (onDeleted || loadBookings)();
        } catch (err2) {
          alert(err2.message);
        }
        return;
      }
      alert(err.message);
    }
  }

  // Customer picker shared by the new-booking form ('nb') and the edit modal
  // ('eb'): either a registered account, or a free-text walk-in name.
  const customerOptionsLoad = {};

  function setCustomerMode(prefix, mode) {
    const guest = mode === 'guest';
    const custSel = document.getElementById(prefix + 'Customer');
    const guestInput = document.getElementById(prefix + 'GuestName');
    document.getElementById(prefix + 'ModeAccount').classList.toggle('active', !guest);
    document.getElementById(prefix + 'ModeGuest').classList.toggle('active', guest);
    custSel.style.display = guest ? 'none' : 'block';
    guestInput.style.display = guest ? 'block' : 'none';
    custSel.required = !guest;
    guestInput.required = guest;
  }

  function wireCustomerPicker(prefix) {
    const custSel = document.getElementById(prefix + 'Customer');
    const accountBtn = document.getElementById(prefix + 'ModeAccount');
    const guestBtn = document.getElementById(prefix + 'ModeGuest');
    if (!accountBtn.dataset.wired) {
      accountBtn.dataset.wired = '1';
      accountBtn.addEventListener('click', () => setCustomerMode(prefix, 'account'));
      guestBtn.addEventListener('click', () => setCustomerMode(prefix, 'guest'));
    }
    // Every profile, not just role='customer' — staff book sessions for
    // themselves too, and a booking whose owner is missing from this list
    // would silently look unassigned in the edit modal.
    // The promise itself is cached, so callers that need the options present
    // (the edit modal preselecting a customer) can await a second open too.
    if (!customerOptionsLoad[prefix]) {
      customerOptionsLoad[prefix] = supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name')
        .then(({ data }) => {
          custSel.innerHTML = '<option value="">Select customer…</option>' + (data || []).map((c) => {
            const suffix = c.role === 'customer' ? '' : ` (${c.role})`;
            return `<option value="${c.id}">${c.full_name || c.id}${suffix}</option>`;
          }).join('');
        });
    }
    return customerOptionsLoad[prefix];
  }

  function customerPickerValues(prefix) {
    const isGuest = document.getElementById(prefix + 'ModeGuest').classList.contains('active');
    return {
      isGuest,
      customerId: isGuest ? '' : document.getElementById(prefix + 'Customer').value,
      guestName: isGuest ? document.getElementById(prefix + 'GuestName').value.trim() : '',
    };
  }

  function populateNewBookingForm() {
    const roomSel = document.getElementById('nbRoom');
    const svcWrap = document.getElementById('nbServices');
    wireCustomerPicker('nb');
    roomSel.innerHTML = roomsCache.filter((r) => r.is_active).map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
    svcWrap.innerHTML = '';
    sortedServices().filter((s) => s.is_active).forEach((s) => {
      const cb = el('input', { type: 'checkbox', value: s.id });
      cb.addEventListener('change', () => enforceServiceDeps(svcWrap));
      svcWrap.appendChild(el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:0.82rem;' }, [cb, ` ${s.name}`]));
    });
    enforceServiceDeps(svcWrap);
  }

  document.getElementById('newBookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('nbMsg');
    msg.style.display = 'none';
    const { isGuest: isGuestMode, customerId, guestName } = customerPickerValues('nb');
    const roomId = document.getElementById('nbRoom').value;
    const date = document.getElementById('nbDate').value;
    const start = document.getElementById('nbStart').value;
    const duration = Number(document.getElementById('nbDuration').value);
    const serviceIds = Array.from(document.getElementById('nbServices').querySelectorAll('input:checked')).map((i) => i.value);

    if ((!customerId && !guestName) || !roomId || !date || !start) {
      msg.textContent = isGuestMode
        ? "Please fill in the customer's name, room, date, and start time."
        : 'Please fill in customer, room, date, and start time.';
      msg.classList.add('error');
      msg.style.display = 'block';
      return;
    }
    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(startAt.getTime() + duration * 3600000);
    try {
      await callFunction('create-booking', {
        room_id: roomId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        service_ids: serviceIds,
        customer_id: customerId || undefined,
        guest_name: guestName || undefined,
      });
      e.target.reset();
      setCustomerMode('nb', 'account');
      loadBookings();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
      msg.style.display = 'block';
    }
  });

  // ---------- Customers ----------
  let customersCache = [];
  async function loadCustomers() {
    const { data } = await supabase.from('profiles').select('id, full_name, phone, created_at').eq('role', 'customer').order('full_name');
    customersCache = data || [];
    renderCustomerList();
  }
  function renderCustomerList() {
    const search = document.getElementById('custSearch').value.toLowerCase();
    const list = document.getElementById('custList');
    list.innerHTML = '';
    customersCache
      .filter((c) => (c.full_name || '').toLowerCase().includes(search))
      .forEach((c) => {
        const item = el('div', { class: 'list-item', onclick: () => showCustomerDetail(c) }, [
          el('div', {}, c.full_name || 'Unnamed'),
          el('div', { style: 'font-size:0.75rem;opacity:0.4;' }, c.phone || 'No phone'),
        ]);
        list.appendChild(item);
      });
    if (customersCache.length === 0) list.appendChild(el('p', { style: 'padding:16px;opacity:0.5;font-size:0.85rem;' }, 'No customers yet.'));
  }
  document.getElementById('custSearch').addEventListener('input', renderCustomerList);

  async function showCustomerDetail(c) {
    const detail = document.getElementById('custDetail');
    detail.innerHTML = '';
    detail.appendChild(el('h2', { style: 'margin-bottom:4px;' }, c.full_name || 'Unnamed'));
    detail.appendChild(
      el('p', { style: 'font-size:0.75rem;opacity:0.5;margin-bottom:20px;' }, `${c.phone || 'No phone'} · Customer since ${d(c.created_at)}`),
    );
    detail.appendChild(el('div', { class: 'a-label', style: 'margin-bottom:10px;' }, 'Booking history'));
    const { data: history } = await supabase
      .from('bookings')
      .select('id, start_at, status, total_price, rooms(name)')
      .eq('customer_id', c.id)
      .order('start_at', { ascending: false });
    if (!history || history.length === 0) {
      detail.appendChild(el('p', { style: 'font-size:0.85rem;opacity:0.5;' }, 'No bookings yet.'));
    } else {
      history.forEach((b) => {
        detail.appendChild(
          el('div', { style: 'display:flex;justify-content:space-between;font-size:0.85rem;padding:8px 0;border-bottom:1px solid rgba(244,248,248,0.06);' }, [
            el('span', {}, d(b.start_at)),
            el('span', { style: 'opacity:0.6;' }, b.rooms?.name || ''),
            el('span', { class: `pill pill-${b.status}` }, b.status),
            el('span', {}, peso(b.total_price)),
          ]),
        );
      });
    }

    // Erasure on request (RA 10173) for customers who ask the studio directly
    // rather than using the delete button on their own profile page.
    detail.appendChild(el('div', { class: 'a-label', style: 'margin:28px 0 8px;color:#e5876f;' }, 'Delete account'));
    detail.appendChild(
      el('p', { style: 'font-size:0.8rem;opacity:0.6;margin-bottom:12px;max-width:60ch;' },
        "Erases their login and personal details along with any ID photos and receipts they uploaded. Sessions above are kept for the studio's books but stop being linked to them."),
    );
    detail.appendChild(
      el('button', { class: 'a-btn-danger', onclick: () => deleteCustomer(c) }, 'Delete this customer account'),
    );
  }

  async function deleteCustomer(c, { force = false } = {}) {
    const who = c.full_name || 'this customer';
    if (!force && !(await confirmDialog(`Permanently delete ${who}'s account?\n\nTheir login, personal details, ID photos and receipts are erased for good. Past sessions stay in the books as anonymous walk-ins.\n\nThis cannot be undone.`))) return;
    try {
      await callFunction('delete-account', { user_id: c.id, force });
      await loadCustomers();
      document.getElementById('custDetail').innerHTML = '';
    } catch (err) {
      // Mirrors delete-booking: an upcoming session or unrefunded money is a
      // stop sign, not a dead end — staff can knowingly override.
      if (err.canForce) {
        if (!(await confirmDialog(`${err.message}\n\nDelete the account anyway?`))) return;
        await deleteCustomer(c, { force: true });
        return;
      }
      alert(err.message);
    }
  }

  // ---------- Rooms & Services ----------
  async function loadRooms() {
    await loadRoomsServicesCache();
    const list = document.getElementById('roomsList');
    list.innerHTML = '';
    roomsCache.forEach((r) => {
      const nameInput = el('input', { class: 'a-input', value: r.name });
      const rateInput = el('input', { type: 'number', class: 'a-input', value: r.hourly_rate, style: 'width:120px;' });
      const descInput = el('input', { class: 'a-input', value: r.description || '' });
      const activeCb = el('input', { type: 'checkbox' });
      activeCb.checked = r.is_active;

      async function save() {
        await supabase.from('rooms').update({
          name: nameInput.value, hourly_rate: Number(rateInput.value), description: descInput.value, is_active: activeCb.checked,
        }).eq('id', r.id);
      }
      nameInput.addEventListener('blur', save);
      rateInput.addEventListener('blur', save);
      descInput.addEventListener('blur', save);
      activeCb.addEventListener('change', save);

      const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'hidden-file' });
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        const path = `${r.id}-${Date.now()}.${file.name.split('.').pop()}`;
        const { error } = await supabase.storage.from('room-images').upload(path, file, { upsert: true });
        if (error) return alert(error.message);
        const { data } = supabase.storage.from('room-images').getPublicUrl(path);
        await supabase.from('rooms').update({ image_url: data.publicUrl }).eq('id', r.id);
        loadRooms();
      });
      const uploadLabel = el('label', { style: 'font-size:0.75rem;color:var(--gold);cursor:pointer;' }, ['Upload photo', fileInput]);

      const thumb = el('div', { style: 'width:90px;height:90px;flex-shrink:0;background:var(--panel-2);border-radius:3px;overflow-hidden;display:flex;align-items:center;justify-content:center;' });
      if (r.image_url) thumb.appendChild(el('img', { src: r.image_url, style: 'width:100%;height:100%;object-fit:cover;' }));
      else thumb.appendChild(el('span', { style: 'font-size:0.7rem;opacity:0.3;' }, 'No photo'));

      list.appendChild(
        el('div', { class: 'a-card', style: 'padding:18px;display:flex;gap:18px;' }, [
          thumb,
          el('div', { style: 'flex:1;display:grid;grid-template-columns:1fr 1fr;gap:10px;' }, [
            el('div', {}, [el('label', { class: 'a-label' }, 'Name'), nameInput]),
            el('div', {}, [el('label', { class: 'a-label' }, 'Hourly rate'), rateInput]),
            el('div', { style: 'grid-column:1/-1;' }, [el('label', { class: 'a-label' }, 'Description'), descInput]),
            el('div', { style: 'grid-column:1/-1;display:flex;align-items:center;gap:16px;' }, [
              el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:0.85rem;' }, [activeCb, ' Active']),
              uploadLabel,
            ]),
          ]),
        ]),
      );
    });

    const svcBody = document.getElementById('servicesBody');
    svcBody.innerHTML = '';
    sortedServices().forEach((s) => {
      const nameInput = el('input', { class: 'a-input', value: s.name });
      const descInput = el('input', { class: 'a-input', value: s.description || '', style: 'min-width:240px;' });
      const priceInput = el('input', { type: 'number', class: 'a-input', value: s.price, style: 'width:100px;' });
      const typeSel = el('select', { class: 'a-input' }, [
        el('option', { value: 'flat', ...(s.price_type === 'flat' ? { selected: 'selected' } : {}) }, 'Flat'),
        el('option', { value: 'hourly', ...(s.price_type === 'hourly' ? { selected: 'selected' } : {}) }, 'Hourly'),
        el('option', { value: 'unit', ...(s.price_type === 'unit' ? { selected: 'selected' } : {}) }, 'Per unit'),
      ]);
      const unitInput = el('input', { class: 'a-input', value: s.unit_label || '', placeholder: 'e.g. song', style: 'width:100px;' });
      const requiresSel = requiresSelect(s.id, s.requires_service_id);
      const orderInput = el('input', { type: 'number', class: 'a-input', value: s.sort_order ?? 0, style: 'width:80px;' });
      const activeCb = el('input', { type: 'checkbox' });
      activeCb.checked = s.is_active;
      // Whether a field's edit can be left showing exactly what's typed (no
      // redraw needed), or has to reach other rows: sort_order changes row
      // order, requires_service_id changes what every other row's "Requires"
      // dropdown may legally offer. This used to `await loadRooms()` on every
      // field's blur — with several inputs in one row (name, then
      // description, then price, …), tabbing through the row fired a full
      // rooms+services teardown-and-rebuild mid-edit, visibly flashing the
      // table and dropping whatever the next tab-stop's focus/keystroke was.
      async function save({ needsRedraw = false } = {}) {
        const patch = {
          name: nameInput.value,
          description: descInput.value.trim() || null,
          price: Number(priceInput.value),
          price_type: typeSel.value,
          unit_label: unitInput.value.trim() || null,
          requires_service_id: requiresSel.value || null,
          sort_order: Number(orderInput.value) || 0,
          is_active: activeCb.checked,
        };
        const { error } = await supabase.from('services').update(patch).eq('id', s.id);
        if (error) { alert(`Could not save "${s.name}": ${error.message}`); return; }
        Object.assign(s, patch);
        if (needsRedraw) loadRooms();
      }
      nameInput.addEventListener('blur', () => save());
      descInput.addEventListener('blur', () => save());
      priceInput.addEventListener('blur', () => save());
      unitInput.addEventListener('blur', () => save());
      orderInput.addEventListener('blur', () => save({ needsRedraw: true }));
      typeSel.addEventListener('change', () => save());
      requiresSel.addEventListener('change', () => save({ needsRedraw: true }));
      activeCb.addEventListener('change', () => save());
      svcBody.appendChild(el('tr', {}, [
        el('td', {}, nameInput),
        el('td', {}, descInput),
        el('td', {}, priceInput),
        el('td', {}, typeSel),
        el('td', {}, unitInput),
        el('td', {}, requiresSel),
        el('td', {}, orderInput),
        el('td', {}, activeCb),
      ]));
    });

    // Keep the "add service" prerequisite picker in step with the table.
    const newRequires = document.getElementById('newSvcRequires');
    if (newRequires) {
      const keep = newRequires.value;
      newRequires.innerHTML = '';
      newRequires.appendChild(el('option', { value: '' }, '— nothing —'));
      sortedServices().forEach((s) => newRequires.appendChild(el('option', { value: s.id }, s.name)));
      newRequires.value = keep;
    }
  }

  document.getElementById('addRoomBtn').addEventListener('click', async () => {
    const name = document.getElementById('newRoomName').value.trim();
    if (!name) return;
    await supabase.from('rooms').insert({ name, hourly_rate: Number(document.getElementById('newRoomRate').value) });
    document.getElementById('newRoomName').value = '';
    loadRooms();
  });
  document.getElementById('addSvcBtn').addEventListener('click', async () => {
    const name = document.getElementById('newSvcName').value.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const { error } = await supabase.from('services').insert({
      name,
      slug,
      description: document.getElementById('newSvcDesc').value.trim() || null,
      price: Number(document.getElementById('newSvcPrice').value),
      price_type: document.getElementById('newSvcType').value,
      unit_label: document.getElementById('newSvcUnit').value.trim() || null,
      requires_service_id: document.getElementById('newSvcRequires').value || null,
      sort_order: Number(document.getElementById('newSvcOrder').value) || 0,
    });
    if (error) { alert(`Could not add service: ${error.message}`); return; }
    document.getElementById('newSvcName').value = '';
    document.getElementById('newSvcDesc').value = '';
    document.getElementById('newSvcUnit').value = '';
    document.getElementById('newSvcRequires').value = '';
    loadRooms();
  });

  // ---------- Availability ----------
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  async function loadAvailability() {
    const roomSel = document.getElementById('availRoom');
    if (roomsCache.length === 0) await loadRoomsServicesCache();
    if (!roomSel.dataset.loaded) {
      roomSel.innerHTML = roomsCache.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
      roomSel.dataset.loaded = '1';
      roomSel.addEventListener('change', renderAvailability);
    }
    renderAvailability();
  }

  async function renderAvailability() {
    const roomId = document.getElementById('availRoom').value;
    const content = document.getElementById('availContent');
    if (!roomId) { content.innerHTML = ''; return; }
    content.innerHTML = '<p style="opacity:0.5;font-size:0.85rem;">Loading…</p>';

    const [{ data: hours }, { data: blocks }] = await Promise.all([
      supabase.from('operating_hours').select('*').eq('room_id', roomId).order('day_of_week'),
      supabase.from('blocked_slots').select('*').eq('room_id', roomId).order('start_at'),
    ]);

    content.innerHTML = '';
    content.appendChild(el('div', { class: 'a-label', style: 'margin-bottom:10px;' }, 'Operating hours'));
    const hoursCard = el('div', { class: 'a-card', style: 'padding:16px;margin-bottom:26px;' });
    (hours || []).forEach((h) => {
      const openInput = el('input', { type: 'time', class: 'a-input', value: (h.open_time || '').slice(0, 5) });
      const closeInput = el('input', { type: 'time', class: 'a-input', value: (h.close_time || '').slice(0, 5) });
      const closedCb = el('input', { type: 'checkbox' });
      closedCb.checked = h.is_closed;
      openInput.disabled = closeInput.disabled = h.is_closed;
      async function save() {
        await supabase.from('operating_hours').update({ open_time: openInput.value, close_time: closeInput.value, is_closed: closedCb.checked }).eq('id', h.id);
      }
      openInput.addEventListener('blur', save);
      closeInput.addEventListener('blur', save);
      closedCb.addEventListener('change', () => { openInput.disabled = closeInput.disabled = closedCb.checked; save(); });
      hoursCard.appendChild(
        el('div', { style: 'display:grid;grid-template-columns:110px 1fr 1fr 100px;gap:14px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(244,248,248,0.06);' }, [
          el('span', { style: 'font-size:0.85rem;' }, DAYS[h.day_of_week]),
          openInput, closeInput,
          el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:0.8rem;' }, [closedCb, ' Closed']),
        ]),
      );
    });
    content.appendChild(hoursCard);

    content.appendChild(el('div', { class: 'a-label', style: 'margin-bottom:10px;' }, 'Blocked dates / times'));
    const blocksCard = el('div', { class: 'a-card', style: 'padding:16px;margin-bottom:16px;' });
    if (!blocks || blocks.length === 0) blocksCard.appendChild(el('p', { style: 'opacity:0.5;font-size:0.85rem;' }, 'No blocks scheduled.'));
    (blocks || []).forEach((b) => {
      blocksCard.appendChild(
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;padding:8px 0;border-bottom:1px solid rgba(244,248,248,0.06);' }, [
          el('span', {}, `${dt(b.start_at)} – ${dt(b.end_at)}`),
          el('span', { style: 'opacity:0.5;' }, b.reason || ''),
          el('button', { class: 'a-btn-ghost', onclick: async () => { await supabase.from('blocked_slots').delete().eq('id', b.id); renderAvailability(); } }, 'Remove'),
        ]),
      );
    });
    content.appendChild(blocksCard);

    const startInput = el('input', { type: 'datetime-local', class: 'a-input' });
    const endInput = el('input', { type: 'datetime-local', class: 'a-input' });
    const reasonInput = el('input', { class: 'a-input', placeholder: 'Maintenance, private event…' });
    content.appendChild(
      el('div', { class: 'a-card', style: 'padding:16px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;' }, [
        el('div', {}, [el('label', { class: 'a-label' }, 'Start'), startInput]),
        el('div', {}, [el('label', { class: 'a-label' }, 'End'), endInput]),
        el('div', { style: 'flex:1;min-width:160px;' }, [el('label', { class: 'a-label' }, 'Reason'), reasonInput]),
        el('button', {
          class: 'a-btn-gold',
          onclick: async () => {
            if (!startInput.value || !endInput.value) return;
            await supabase.from('blocked_slots').insert({ room_id: roomId, start_at: startInput.value, end_at: endInput.value, reason: reasonInput.value || null });
            renderAvailability();
          },
        }, 'Add block'),
      ]),
    );
  }

  // ---------- Payments ----------
  async function loadPayments() {
    const { data } = await supabase
      .from('payments')
      .select('*, bookings(id, start_at, rooms(name), profiles!bookings_customer_id_fkey(full_name))')
      .order('created_at', { ascending: false });
    const body = document.getElementById('paymentsBody');
    body.innerHTML = '';
    if (!data || data.length === 0) {
      body.appendChild(el('tr', {}, el('td', { colspan: '10', style: 'text-align:center;opacity:0.5;padding:24px;' }, 'No payments recorded yet — use "Mark Paid" on a booking to log a cash payment.')));
      return;
    }
    data.forEach((p) => {
      const canRefund = p.status === 'succeeded' || p.status === 'partially_refunded';
      const awaitingReview = p.method === 'manual' && p.status === 'submitted';
      const actions = el('div', { class: 'row-flex' });

      // A submitted QR transfer is a claim, not money in the bank — someone has
      // to open the receipt and check it against the account before approving.
      if (awaitingReview) {
        actions.append(
          el('button', { class: 'a-btn-gold', onclick: () => verifyPayment(p, true) }, 'Approve'),
          el('button', { class: 'a-btn-ghost', onclick: () => verifyPayment(p, false) }, 'Reject'),
        );
      }
      if (canRefund) {
        actions.append(el('button', {
          class: 'a-btn-ghost',
          onclick: async () => {
            const amountStr = await promptDialog('Refund amount in ₱ (blank = full remaining):');
            if (amountStr === null) return;
            try {
              await callFunction('admin-refund', { payment_id: p.id, amount: amountStr.trim() ? Number(amountStr) : undefined });
              loadPayments();
            } catch (err) { alert(err.message); }
          },
        }, 'Refund'));
      }

      body.appendChild(
        el('tr', {}, [
          el('td', {}, d(p.created_at)),
          el('td', {}, p.bookings?.rooms?.name || ''),
          el('td', {}, p.bookings?.profiles?.full_name || p.bookings?.guest_name || '—'),
          el('td', {}, el('span', { class: 'pill', style: METHOD_PILL_STYLE[p.method] || '' }, PAY_METHOD_LABEL[p.method] || p.method)),
          el('td', {}, p.type),
          el('td', {}, peso(p.amount)),
          el('td', {}, peso(p.refunded_amount)),
          el('td', {}, paymentStatusCell(p)),
          el('td', {}, proofCell(p)),
          el('td', {}, actions.childNodes.length ? actions : '—'),
        ]),
      );
    });
  }

  const PAY_METHOD_LABEL = { manual: 'QR transfer', cash: 'cash', paymongo: 'paymongo' };
  const METHOD_PILL_STYLE = {
    cash: 'color:var(--gold);border-color:var(--gold-dim);',
    manual: 'color:var(--teal);border-color:var(--teal);',
    paymongo: 'color:var(--teal);border-color:var(--teal);',
  };
  const PAY_STATUS_LABEL = {
    pending: 'Awaiting receipt',
    submitted: 'Needs review',
    rejected: 'Rejected',
  };

  function paymentStatusCell(p) {
    const label = PAY_STATUS_LABEL[p.status] || p.status;
    const colour = p.status === 'submitted' ? '#e5a03f'
      : p.status === 'rejected' || p.status === 'failed' ? '#e5876f'
      : p.status === 'succeeded' ? 'var(--teal)'
      : 'var(--gold)';
    const cell = el('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start;' }, [
      el('span', { style: `color:${colour};font-size:0.75rem;text-transform:capitalize;` }, label),
    ]);
    if (p.rejection_reason) {
      cell.appendChild(el('span', { style: 'font-size:0.65rem;opacity:0.5;max-width:150px;' }, p.rejection_reason));
    }
    return cell;
  }

  // Receipts live in a private bucket, so staff get a short-lived signed URL
  // rather than a permanent link that could leak out of the dashboard.
  async function viewReceipt(path) {
    const { data, error } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      alert('Could not open that receipt: ' + (error?.message || 'unknown error'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  function proofCell(p) {
    if (p.method !== 'manual') {
      return el('span', { style: 'font-size:0.7rem;opacity:0.4;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;' },
        p.paymongo_payment_id || p.paymongo_checkout_session_id || '—');
    }
    const cell = el('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-start;' });
    if (p.channel) cell.appendChild(el('span', { style: 'font-size:0.7rem;text-transform:uppercase;opacity:0.6;' }, p.channel));
    if (p.reference_no) cell.appendChild(el('span', { style: 'font-size:0.7rem;opacity:0.75;' }, 'Ref ' + p.reference_no));
    if (p.receipt_path) {
      cell.appendChild(el('button', {
        class: 'a-btn-ghost',
        style: 'padding:3px 8px;font-size:0.68rem;',
        onclick: () => viewReceipt(p.receipt_path),
      }, 'View receipt'));
    } else {
      cell.appendChild(el('span', { style: 'font-size:0.65rem;opacity:0.4;' }, 'No receipt yet'));
    }
    return cell;
  }

  async function verifyPayment(p, approve) {
    let payload = { payment_id: p.id, approve };
    if (approve) {
      const amountStr = await promptDialog(
        `Approve this transfer? Blank keeps the expected ₱${Math.round(Number(p.amount))} — ` +
        'enter a different figure only if the receipt shows another amount.',
      );
      if (amountStr === null) return;
      if (amountStr.trim()) payload.amount = Number(amountStr);
    } else {
      const reason = await promptDialog('Why is this receipt being rejected? The customer sees this.');
      if (reason === null) return;
      payload.reason = reason;
    }
    try {
      await callFunction('verify-payment', payload);
      loadPayments();
      loadBookings();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Staff ----------
  async function loadStaff() {
    const { data } = await supabase.from('profiles').select('*').in('role', ['staff', 'admin']).order('full_name');
    const body = document.getElementById('staffBody');
    body.innerHTML = '';
    (data || []).forEach((s) => {
      let roleCell;
      if (profile?.role === 'admin') {
        const sel = el('select', { class: 'a-input' }, [
          el('option', { value: 'staff', ...(s.role === 'staff' ? { selected: 'selected' } : {}) }, 'Staff'),
          el('option', { value: 'admin', ...(s.role === 'admin' ? { selected: 'selected' } : {}) }, 'Admin'),
        ]);
        sel.addEventListener('change', async () => { await supabase.from('profiles').update({ role: sel.value }).eq('id', s.id); });
        roleCell = sel;
      } else {
        roleCell = el('span', { style: 'text-transform:capitalize;color:var(--gold);font-size:0.75rem;' }, s.role);
      }
      body.appendChild(el('tr', {}, [el('td', {}, s.full_name || 'Unnamed'), el('td', {}, roleCell), el('td', {}, d(s.created_at))]));
    });
  }

  document.getElementById('inviteBtn').addEventListener('click', async () => {
    const msg = document.getElementById('inviteMsg');
    msg.style.display = 'none';
    try {
      await callFunction('invite-staff', {
        email: document.getElementById('inviteEmail').value.trim(),
        full_name: document.getElementById('inviteName').value.trim(),
        role: document.getElementById('inviteRole').value,
      });
      document.getElementById('inviteEmail').value = '';
      document.getElementById('inviteName').value = '';
      loadStaff();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
      msg.style.display = 'block';
    }
  });

  // ---------- Settings ----------
  async function loadSettings() {
    const { data } = await supabase.from('app_settings').select('*');
    const get = (key) => data?.find((s) => s.key === key)?.value;
    document.getElementById('setPaymongoEnabled').checked = get('paymongo_enabled') === true;
    document.getElementById('setDepositPct').value = Number(get('deposit_percent') ?? 20);
    document.getElementById('setCutoffHrs').value = Number(get('reschedule_cutoff_hours') ?? 24);

    const { data: sess } = await supabase.auth.getSession();
    if (sess.session) {
      document.getElementById('myEmail').value = sess.session.user.email || '';
      document.getElementById('myName').value = profile?.full_name || '';
    }
  }

  function showAccountMsg(id, text, isError) {
    const msg = document.getElementById(id);
    msg.textContent = text;
    msg.classList.toggle('error', !!isError);
    msg.style.display = 'block';
  }

  document.getElementById('myNameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return;
    const fullName = document.getElementById('myName').value.trim();
    const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', sess.session.user.id);
    if (error) showAccountMsg('myNameMsg', error.message, true);
    else {
      showAccountMsg('myNameMsg', '✓ Name updated.', false);
      if (profile) profile.full_name = fullName;
      document.getElementById('adminUserName').textContent = fullName || sess.session.user.email;
    }
  });

  document.getElementById('myEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('myEmail').value.trim();
    const { error } = await supabase.auth.updateUser({ email });
    if (error) showAccountMsg('myEmailMsg', error.message, true);
    else showAccountMsg('myEmailMsg', '✓ Check your new inbox to confirm the email change.', false);
  });

  document.getElementById('myPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('myPassword').value;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) showAccountMsg('myPasswordMsg', error.message, true);
    else {
      showAccountMsg('myPasswordMsg', '✓ Password changed.', false);
      e.target.reset();
    }
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    await Promise.all([
      supabase.from('app_settings').update({ value: document.getElementById('setPaymongoEnabled').checked }).eq('key', 'paymongo_enabled'),
      supabase.from('app_settings').update({ value: Number(document.getElementById('setDepositPct').value) }).eq('key', 'deposit_percent'),
      supabase.from('app_settings').update({ value: Number(document.getElementById('setCutoffHrs').value) }).eq('key', 'reschedule_cutoff_hours'),
    ]);
    const msg = document.getElementById('settingsMsg');
    msg.textContent = 'Settings saved.';
    msg.classList.remove('error');
    msg.style.display = 'block';
  });

  // ---------- Boot ----------
  const ok = await checkAccess();
  if (ok) loadActiveTab();
}

main();
