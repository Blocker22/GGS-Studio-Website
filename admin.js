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
    if (!res.ok) throw new Error(json.error || 'Request failed.');
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

  supabase.auth.onAuthStateChange(async () => {
    const ok = await checkAccess();
    if (ok) loadActiveTab();
  });

  // ---------- Tabs ----------
  const tabs = ['dashboard', 'bookings', 'customers', 'rooms', 'availability', 'payments', 'staff', 'settings'];
  const loaded = {};
  let activeTab = 'dashboard';

  document.getElementById('adminNav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll('#adminNav button').forEach((b) => b.classList.toggle('active', b === btn));
    tabs.forEach((t) => document.getElementById(`tab-${t}`).classList.toggle('active', t === activeTab));
    loadActiveTab();
  });

  function loadActiveTab() {
    const loaders = {
      dashboard: loadDashboard, bookings: loadBookings, customers: loadCustomers,
      rooms: loadRooms, availability: loadAvailability, payments: loadPayments,
      staff: loadStaff, settings: loadSettings,
    };
    loaders[activeTab]?.();
  }

  // ---------- Dashboard ----------
  async function loadDashboard() {
    const statsEl = document.getElementById('dashStats');
    const todayEl = document.getElementById('dashToday');
    statsEl.innerHTML = '';
    todayEl.innerHTML = '<p style="opacity:0.5;font-size:0.85rem;">Loading…</p>';

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
      el('div', { class: 'a-card stat-box' }, [el('div', { class: 'a-label' }, label), el('div', { class: `val ${cls}` }, String(value))]);

    statsEl.append(
      stat('Total bookings', bookings?.length || 0),
      stat('Pending approval', pending, 'text-gold-stat'),
      stat("Today's sessions", (today || []).length),
      stat('Revenue this month', peso(revenue)),
    );
    statsEl.querySelectorAll('.text-gold-stat').forEach((n) => (n.style.color = 'var(--gold)'));

    todayEl.innerHTML = '';
    if (!today || today.length === 0) {
      todayEl.appendChild(el('p', { style: 'opacity:0.5;font-size:0.85rem;' }, 'Nothing booked today.'));
    } else {
      today.forEach((b) => {
        todayEl.appendChild(
          el('div', { style: 'display:flex;justify-content:space-between;font-size:0.85rem;padding:8px 0;border-bottom:1px solid rgba(238,244,244,0.06);' }, [
            el('span', {}, new Date(b.start_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })),
            el('span', { style: 'opacity:0.7;' }, b.rooms?.name || ''),
            el('span', { class: `pill pill-${b.status}` }, b.status),
          ]),
        );
      });
    }
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

  async function loadBookings() {
    if (roomsCache.length === 0) await loadRoomsServicesCache();

    const { data, error } = await supabase
      .from('bookings')
      .select('*, rooms(id,name), profiles!bookings_customer_id_fkey(id,full_name), booking_services(services(name))')
      .order('start_at', { ascending: false });
    if (error) {
      document.getElementById('bookingsBody').innerHTML = `<tr><td colspan="7">Error: ${error.message}</td></tr>`;
      return;
    }
    allBookings = data || [];
    renderBookings();
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
      if (search && !(b.profiles?.full_name || '').toLowerCase().includes(search)) return false;
      if (from && new Date(b.start_at) < new Date(from)) return false;
      if (to && new Date(b.start_at) > new Date(to + 'T23:59:59')) return false;
      return true;
    });

    const body = document.getElementById('bookingsBody');
    body.innerHTML = '';
    if (filtered.length === 0) {
      body.appendChild(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;opacity:0.5;padding:24px;' }, 'No bookings match these filters.')));
      return;
    }

    filtered.forEach((b) => {
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
      body.appendChild(
        el('tr', {}, [
          el('td', {}, dt(b.start_at)),
          el('td', {}, b.rooms?.name || ''),
          el('td', {}, b.profiles?.full_name || '—'),
          el('td', { style: 'opacity:0.6;' }, (b.booking_services || []).map((bs) => bs.services?.name).filter(Boolean).join(', ') || '—'),
          el('td', {}, peso(b.total_price)),
          el('td', {}, el('span', { class: `pill pill-${b.status}` }, b.status.replace('_', ' '))),
          el('td', {}, actions),
        ]),
      );
    });
  }

  ['fltStatus', 'fltSearch', 'fltFrom', 'fltTo'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderBookings);
  });
  document.getElementById('fltReset').addEventListener('click', () => {
    ['fltStatus', 'fltSearch', 'fltFrom', 'fltTo'].forEach((id) => (document.getElementById(id).value = ''));
    renderBookings();
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
    const reason = prompt('Cancellation reason (optional):') || undefined;
    try {
      await callFunction('cancel-booking', { booking_id: id, reason });
      loadBookings();
    } catch (err) {
      alert(err.message);
    }
  }

  function populateNewBookingForm() {
    const custSel = document.getElementById('nbCustomer');
    const roomSel = document.getElementById('nbRoom');
    const svcWrap = document.getElementById('nbServices');
    if (!custSel.dataset.loaded) {
      supabase.from('profiles').select('id, full_name').eq('role', 'customer').order('full_name').then(({ data }) => {
        custSel.innerHTML = '<option value="">Select customer…</option>' + (data || []).map((c) => `<option value="${c.id}">${c.full_name || c.id}</option>`).join('');
        custSel.dataset.loaded = '1';
      });
    }
    roomSel.innerHTML = roomsCache.filter((r) => r.is_active).map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
    svcWrap.innerHTML = '';
    servicesCache.filter((s) => s.is_active).forEach((s) => {
      const label = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:0.82rem;' }, [
        el('input', { type: 'checkbox', value: s.id }),
        ` ${s.name}`,
      ]);
      svcWrap.appendChild(label);
    });
  }

  document.getElementById('newBookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('nbMsg');
    msg.style.display = 'none';
    const customerId = document.getElementById('nbCustomer').value;
    const roomId = document.getElementById('nbRoom').value;
    const date = document.getElementById('nbDate').value;
    const start = document.getElementById('nbStart').value;
    const duration = Number(document.getElementById('nbDuration').value);
    const serviceIds = Array.from(document.getElementById('nbServices').querySelectorAll('input:checked')).map((i) => i.value);

    if (!customerId || !roomId || !date || !start) {
      msg.textContent = 'Please fill in customer, room, date, and start time.';
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
        customer_id: customerId,
      });
      e.target.reset();
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
          el('div', { style: 'display:flex;justify-content:space-between;font-size:0.85rem;padding:8px 0;border-bottom:1px solid rgba(238,244,244,0.06);' }, [
            el('span', {}, d(b.start_at)),
            el('span', { style: 'opacity:0.6;' }, b.rooms?.name || ''),
            el('span', { class: `pill pill-${b.status}` }, b.status),
            el('span', {}, peso(b.total_price)),
          ]),
        );
      });
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
    servicesCache.forEach((s) => {
      const nameInput = el('input', { class: 'a-input', value: s.name });
      const priceInput = el('input', { type: 'number', class: 'a-input', value: s.price, style: 'width:100px;' });
      const typeSel = el('select', { class: 'a-input' }, [
        el('option', { value: 'flat', ...(s.price_type === 'flat' ? { selected: 'selected' } : {}) }, 'Flat'),
        el('option', { value: 'hourly', ...(s.price_type === 'hourly' ? { selected: 'selected' } : {}) }, 'Hourly'),
      ]);
      const activeCb = el('input', { type: 'checkbox' });
      activeCb.checked = s.is_active;
      async function save() {
        await supabase.from('services').update({ name: nameInput.value, price: Number(priceInput.value), price_type: typeSel.value, is_active: activeCb.checked }).eq('id', s.id);
      }
      nameInput.addEventListener('blur', save);
      priceInput.addEventListener('blur', save);
      typeSel.addEventListener('change', save);
      activeCb.addEventListener('change', save);
      svcBody.appendChild(el('tr', {}, [el('td', {}, nameInput), el('td', {}, priceInput), el('td', {}, typeSel), el('td', {}, activeCb)]));
    });
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
    await supabase.from('services').insert({ name, slug, price: Number(document.getElementById('newSvcPrice').value), price_type: document.getElementById('newSvcType').value });
    document.getElementById('newSvcName').value = '';
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
        el('div', { style: 'display:grid;grid-template-columns:110px 1fr 1fr 100px;gap:14px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(238,244,244,0.06);' }, [
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
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;padding:8px 0;border-bottom:1px solid rgba(238,244,244,0.06);' }, [
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
      body.appendChild(el('tr', {}, el('td', { colspan: '9', style: 'text-align:center;opacity:0.5;padding:24px;' }, 'No payments yet — Stripe may still be disabled in Settings.')));
      return;
    }
    data.forEach((p) => {
      const canRefund = p.status === 'succeeded' || p.status === 'partially_refunded';
      body.appendChild(
        el('tr', {}, [
          el('td', {}, d(p.created_at)),
          el('td', {}, p.bookings?.rooms?.name || ''),
          el('td', {}, p.bookings?.profiles?.full_name || '—'),
          el('td', {}, p.type),
          el('td', {}, peso(p.amount)),
          el('td', {}, peso(p.refunded_amount)),
          el('td', {}, el('span', { style: 'color:var(--gold);font-size:0.75rem;text-transform:uppercase;' }, p.status)),
          el('td', { style: 'font-size:0.7rem;opacity:0.4;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, p.stripe_payment_intent_id || '—'),
          el('td', {}, canRefund
            ? el('button', {
                class: 'a-btn-ghost',
                onclick: async () => {
                  const amountStr = prompt('Refund amount in ₱ (blank = full remaining):');
                  if (amountStr === null) return;
                  try {
                    await callFunction('admin-refund', { payment_id: p.id, amount: amountStr.trim() ? Number(amountStr) : undefined });
                    loadPayments();
                  } catch (err) { alert(err.message); }
                },
              }, 'Refund')
            : '—'),
        ]),
      );
    });
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
        roleCell = el('span', { style: 'text-transform:uppercase;color:var(--gold);font-size:0.75rem;' }, s.role);
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
    document.getElementById('setStripeEnabled').checked = get('stripe_enabled') === true;
    document.getElementById('setDepositPct').value = Number(get('deposit_percent') ?? 30);
    document.getElementById('setCutoffHrs').value = Number(get('reschedule_cutoff_hours') ?? 24);
  }
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    await Promise.all([
      supabase.from('app_settings').update({ value: document.getElementById('setStripeEnabled').checked }).eq('key', 'stripe_enabled'),
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
