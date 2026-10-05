// Shared plumbing for the dashboard: the Supabase client, calls to the Edge
// Functions, a tiny DOM builder, dialogs, menus, toasts, formatting, and the
// list controller every view uses (chips with live counts, a Sort menu with
// newest first by default, search, a table on wide screens and cards on
// narrow ones, and empty states that tell "nothing yet" from "nothing matches").

import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase-client.js';

export const TZ = 'Asia/Manila';
export const state = {
  supabase: null,
  session: null,
  profile: null,
  status: null,
  rooms: [],
  services: [],
};

export async function sb() {
  if (!state.supabase) state.supabase = await getSupabase();
  return state.supabase;
}

// ------------------------------------------------------------------ DOM

/** h('div', { class, on: { click }, ...attrs }, children...) */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'multiple' || k === 'open') node[k] = !!v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const icon = (name, extra = '') => h('i', { class: `ph ph-${name} ${extra}`.trim(), 'aria-hidden': 'true' });
export const clear = (node) => { node.replaceChildren(); return node; };

export function btn(label, opts = {}) {
  const { kind = '', size = '', iconName, onClick, title, type = 'button', disabled } = opts;
  const cls = ['btn', kind && `btn-${kind}`, size && `btn-${size}`, !label && 'btn-icon'].filter(Boolean).join(' ');
  return h('button', { class: cls, type, title: title || (label ? null : opts.aria), 'aria-label': label ? null : (opts.aria || title), disabled, onclick: onClick },
    iconName ? icon(iconName) : null, label || null);
}

export function pill(text, tone = '', iconName) {
  return h('span', { class: `pill ${tone}` }, iconName ? icon(iconName) : null, text);
}

export function field(label, control, { hint, error, cls = '' } = {}) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: `field ${cls}` }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null, error ? h('div', { class: 'field-error' }, error) : null);
}

export const input = (props = {}) => h('input', { class: 'input', type: 'text', ...props });
export const textarea = (props = {}) => h('textarea', { class: 'textarea', ...props });
export function select(options, value, props = {}) {
  const s = h('select', { class: 'select', ...props });
  options.forEach((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    s.appendChild(h('option', { value: v }, l));
  });
  if (value != null) s.value = String(value);
  return s;
}
export function toggle(label, checked, props = {}) {
  const box = h('input', { type: 'checkbox', checked, ...props });
  const wrap = h('label', { class: 'switch' }, box, h('span', { class: 'track', 'aria-hidden': 'true' }), label ? h('span', {}, label) : null);
  wrap.input = box;
  return wrap;
}
export function checkbox(label, checked, props = {}) {
  const box = h('input', { type: 'checkbox', checked, ...props });
  const wrap = h('label', { class: 'check' }, box, h('span', {}, label));
  wrap.input = box;
  return wrap;
}

// ------------------------------------------------------------------ format

export const peso = (n) => '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');
export const ref = (id) => String(id || '').slice(0, 8).toUpperCase();
export const digits = (s) => String(s ?? '').replace(/\D/g, '');

export function fmtDate(d, opts = {}) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', ...opts });
}
export function fmtDay(d) {
  return new Date(d).toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}
export function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}
export function fmtWhen(start, end) {
  return `${fmtDay(start)}, ${fmtTime(start)} to ${fmtTime(end)}`;
}
export function fmtDateTime(d) {
  return new Date(d).toLocaleString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtRel(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return fmtDate(d);
}
export const hours = (b) => (new Date(b.end_at) - new Date(b.start_at)) / 3600000;
export const hrs = (n) => `${+Number(n).toFixed(1)} hr${Number(n) === 1 ? '' : 's'}`;
export const initials = (name) => String(name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function avatar(person, cls = '') {
  if (person?.avatar_url) return h('img', { class: `avatar ${cls}`, src: person.avatar_url, alt: '' });
  return h('span', { class: `avatar ${cls}`, 'aria-hidden': 'true' }, initials(person?.full_name || person?.name || person?.email));
}

// ------------------------------------------------------------------ booking state

/** Rule: a confirmed booking whose end has passed reads as completed everywhere. */
export function effectiveStatus(b) {
  return b.status === 'confirmed' && new Date(b.end_at).getTime() < Date.now() ? 'completed' : b.status;
}

export function paidAmount(b) {
  return (b.payments || [])
    .filter((p) => p.type !== 'refund' && ['succeeded', 'partially_refunded'].includes(p.status))
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

/** unpaid | review | partial | paid | waived */
export function paymentState(b) {
  if (b.payment_waived) return 'waived';
  const total = Number(b.total_price || 0);
  const paid = paidAmount(b);
  if (total <= 0 || paid >= total) return 'paid';
  if ((b.payments || []).some((p) => p.method === 'manual' && p.status === 'submitted')) return 'review';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

/** none | pending | verified | rejected | deleted */
export function idState(b) {
  if (b.id_check) {
    if (b.id_check.photo_deleted_at && b.id_check.status === 'pending') return 'deleted';
    return b.id_check.status || 'pending';
  }
  return b.id_image_path ? 'pending' : 'none';
}

export const STATUS_TONE = { pending: 'gold', confirmed: 'teal', completed: 'quiet', cancelled: 'danger', no_show: 'warn' };
export const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };
export const PAY_LABEL = { unpaid: 'Unpaid', review: 'Receipt to check', partial: 'Part paid', paid: 'Paid', waived: 'Waived' };
export const PAY_TONE = { unpaid: 'danger', review: 'warn', partial: 'gold', paid: 'teal', waived: 'quiet' };
export const OPTION_LABEL = { cash: 'Pay at the studio', deposit: 'Downpayment online', full: 'Full online' };

export function customerName(b) {
  return b.guest_name || b.profiles?.full_name || 'Customer';
}

// ------------------------------------------------------------------ server calls

let expiredShown = false;
function sessionExpired() {
  if (expiredShown) return;
  expiredShown = true;
  toast('Your session expired. Sign in again.', 'error');
  setTimeout(() => location.reload(), 1600);
}

async function authHeader() {
  const supabase = await sb();
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    sessionExpired();
    throw new Error('Not signed in.');
  }
  return `Bearer ${data.session.access_token}`;
}

/** Calls an Edge Function. Throws with the server's message on failure. */
export async function fn(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: await authHeader() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionExpired();
    throw new Error(data.error || 'Session expired.');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    Object.assign(err, data);
    throw err;
  }
  return data;
}

export const api = (action, body = {}) => fn('admin-api', { action, ...body });

/** Unwraps a Supabase query result, throwing on error. */
export async function q(promise) {
  const { data, error, count } = await promise;
  if (error) {
    if (error.code === 'PGRST301' || /JWT/i.test(error.message)) sessionExpired();
    throw new Error(error.message);
  }
  return count != null && data == null ? count : data;
}

export async function signedUrl(bucket, path, seconds = 300) {
  const supabase = await sb();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Marks a button busy, runs the call, toasts errors uniformly. */
export async function run(button, work, { success } = {}) {
  if (button) { button.classList.add('busy'); button.disabled = true; }
  try {
    const out = await work();
    if (success) toast(typeof success === 'function' ? success(out) : success);
    return out;
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'error');
    throw err;
  } finally {
    if (button) { button.classList.remove('busy'); button.disabled = false; }
  }
}

export async function loadCatalog(force = false) {
  if (state.rooms.length && !force) return;
  const supabase = await sb();
  const [rooms, services] = await Promise.all([
    q(supabase.from('rooms').select('*').order('created_at')),
    q(supabase.from('services').select('*').order('sort_order').order('name')),
  ]);
  state.rooms = rooms || [];
  state.services = services || [];
}

export async function settings(keys) {
  const supabase = await sb();
  const rows = await q(supabase.from('app_settings').select('key, value').in('key', keys));
  return Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
}

export async function saveSetting(key, value) {
  const supabase = await sb();
  await q(supabase.from('app_settings').upsert({ key, value }));
}

// ------------------------------------------------------------------ toasts

export function toast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const ico = type === 'error' ? 'warning-circle' : type === 'warn' ? 'warning' : 'check-circle';
  const t = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, icon(ico), h('div', {}, message));
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 3800);
}

// ------------------------------------------------------------------ dialogs

/**
 * Opens a modal <dialog>. `body` and `foot` may be nodes or functions of the
 * close handle. Returns { el, close, body }. Escape and the backdrop close it.
 */
export function openDialog({ title, sub, body, foot, size = '', onClose, dismissable = true }) {
  const dlg = h('dialog', { class: `dlg ${size}`, 'aria-labelledby': 'dlg-title' });
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    dlg.close();
    dlg.remove();
    onClose?.(value);
  };
  const handle = { el: dlg, close };
  const bodyNode = typeof body === 'function' ? body(handle) : body;
  const footNode = typeof foot === 'function' ? foot(handle) : foot;
  dlg.append(
    h('div', { class: 'dlg-head' },
      h('div', {}, h('h2', { id: 'dlg-title' }, title), sub ? h('p', {}, sub) : null),
      dismissable ? btn('', { kind: 'ghost', iconName: 'x', aria: 'Close', onClick: () => close(null) }) : null),
    h('div', { class: 'dlg-body' }, bodyNode),
    footNode ? h('div', { class: 'dlg-foot' }, footNode) : null,
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissable) close(null); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && dismissable) close(null); });
  document.body.appendChild(dlg);
  dlg.showModal();
  handle.body = bodyNode;
  return handle;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, extra }) {
  return new Promise((resolve) => {
    openDialog({
      title,
      size: 'narrow',
      body: h('div', { class: 'stack' }, h('p', { class: 'muted', style: 'white-space:pre-wrap' }, message), extra || null),
      foot: (d) => [
        btn('Cancel', { onClick: () => d.close(false) }),
        btn(confirmLabel, { kind: danger ? 'danger' : 'primary', onClick: () => d.close(true) }),
      ],
      onClose: (v) => resolve(v === true),
    });
  });
}

export function promptDialog({ title, message, label, value = '', placeholder = '', confirmLabel = 'OK', type = 'text', multiline = false }) {
  return new Promise((resolve) => {
    const ctl = multiline ? textarea({ value, placeholder }) : input({ value, placeholder, type });
    openDialog({
      title,
      size: 'narrow',
      body: h('div', { class: 'stack' }, message ? h('p', { class: 'muted' }, message) : null, field(label || title, ctl)),
      foot: (d) => [btn('Cancel', { onClick: () => d.close(null) }), btn(confirmLabel, { kind: 'primary', onClick: () => d.close(ctl.value) })],
      onClose: (v) => resolve(v),
    });
    setTimeout(() => ctl.focus(), 30);
    if (!multiline) ctl.addEventListener('keydown', (e) => { if (e.key === 'Enter') ctl.closest('dialog').querySelector('.btn-primary').click(); });
  });
}

// ------------------------------------------------------------------ menus

let openMenu = null;
export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}
document.addEventListener('click', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('resize', closeMenu);
document.addEventListener('scroll', closeMenu, true);

/** items: [{ label, icon, onClick, danger, checked }] or 'sep' */
export function showMenu(anchor, items) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  items.filter(Boolean).forEach((it) => {
    if (it === 'sep') return m.appendChild(h('hr'));
    m.appendChild(h('button', {
      type: 'button',
      role: it.checked != null ? 'menuitemradio' : 'menuitem',
      'aria-checked': it.checked != null ? String(!!it.checked) : null,
      class: it.danger ? 'danger' : '',
      onclick: () => { closeMenu(); it.onClick?.(); },
    }, it.icon ? icon(it.icon) : null, it.label));
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  if (left < 8) left = 8;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  Object.assign(m.style, { left: `${left}px`, top: `${top}px` });
  openMenu = m;
  m.querySelector('button')?.focus();
}

// ------------------------------------------------------------------ skeleton / empty

export function skeleton(rows = 5, { tiles = 0 } = {}) {
  return h('div', { class: 'skeleton', 'aria-label': 'Loading', role: 'status' },
    tiles ? h('div', { class: 'tiles' }, Array.from({ length: tiles }, () => h('div', { class: 'sk', style: 'height:92px' }))) : null,
    h('div', { class: 'sk', style: 'height:40px;width:70%' }),
    Array.from({ length: rows }, () => h('div', { class: 'sk', style: 'height:56px' })));
}

export function empty({ iconName = 'tray', title, text, action }) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', {}, title), text ? h('p', {}, text) : null, action || null);
}

export function errorBox(err, retry) {
  return h('div', { class: 'empty' }, icon('warning-circle'), h('h3', {}, "This view didn't load"),
    h('p', {}, err?.message || String(err)), retry ? btn('Try again', { onClick: retry }) : null);
}

// ------------------------------------------------------------------ list controller

function storeGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
export { storeGet, storeSet };

/**
 * A list with chips (live counts), Sort menu, search, and responsive output.
 * opts: { key, chips: [{ id, label, test, attention }], sorts: [[id, label, compare]],
 *         search: item => text, digits?: item => phone, columns: [{ label, cls, render }],
 *         card: item => node, empty: {...}, rowClass?, toolbarExtra? }
 */
export function createList(opts) {
  const key = `ggs-list-${opts.key}`;
  const saved = storeGet(key, {});
  const listState = {
    chip: saved.chip && opts.chips?.some((c) => c.id === saved.chip) ? saved.chip : (opts.chips?.[0]?.id ?? null),
    sort: saved.sort && opts.sorts?.some((s) => s[0] === saved.sort) ? saved.sort : opts.sorts?.[0]?.[0],
    query: '',
  };
  let items = [];
  const root = h('div', { class: 'responsive' });
  const chipBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' });
  const searchInput = input({ type: 'search', placeholder: opts.searchPlaceholder || 'Search', 'aria-label': 'Search' });
  const sortBtn = btn('Sort', { iconName: 'sort-descending', size: '', onClick: () => {
    showMenu(sortBtn, opts.sorts.map(([id, label]) => ({
      label, checked: listState.sort === id, onClick: () => { listState.sort = id; persist(); render(); },
    })));
  } });
  const toolbar = h('div', { class: 'toolbar' },
    opts.chips?.length ? chipBox : h('div', { style: 'flex:1' }),
    opts.toolbarExtra || null,
    opts.sorts?.length > 1 ? sortBtn : null,
    opts.search ? h('div', { class: 'search' }, icon('magnifying-glass'), searchInput) : null);
  const out = h('div');
  root.append(toolbar, out);

  const persist = () => storeSet(key, { chip: listState.chip, sort: listState.sort });
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { listState.query = searchInput.value.trim().toLowerCase(); render(); }, 120);
  });

  function filtered() {
    const chip = opts.chips?.find((c) => c.id === listState.chip);
    let list = chip ? items.filter(chip.test) : items.slice();
    const qy = listState.query;
    if (qy && opts.search) {
      const qd = qy.replace(/\D/g, '');
      list = list.filter((it) => opts.search(it).toLowerCase().includes(qy) || (qd.length >= 3 && opts.digits && opts.digits(it).includes(qd)));
    }
    const sorter = opts.sorts?.find((s) => s[0] === listState.sort)?.[2];
    if (sorter) list.sort(sorter);
    return list;
  }

  function renderChips() {
    clear(chipBox);
    (opts.chips || []).forEach((c) => {
      const n = items.filter(c.test).length;
      chipBox.appendChild(h('button', {
        type: 'button', class: `chip ${c.attention && n ? 'attention' : ''}`, 'aria-pressed': String(listState.chip === c.id),
        onclick: () => { listState.chip = c.id; persist(); render(); },
      }, c.label, h('span', { class: 'count' }, n)));
    });
  }

  function render() {
    renderChips();
    const sortLabel = opts.sorts?.find((s) => s[0] === listState.sort)?.[1];
    if (sortLabel) sortBtn.lastChild.textContent = sortLabel;
    const list = filtered();
    clear(out);
    if (!items.length) return out.appendChild(empty(opts.empty || { title: 'Nothing here yet' }));
    if (!list.length) {
      return out.appendChild(empty({ iconName: 'funnel-simple', title: 'Nothing matches', text: 'Try another filter or clear the search.',
        action: btn('Clear filters', { onClick: () => { listState.chip = opts.chips?.[0]?.id ?? null; listState.query = ''; searchInput.value = ''; persist(); render(); } }) }));
    }
    if (opts.columns) {
      const table = h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, opts.columns.map((c) => h('th', { class: c.cls || '' }, c.label)))),
        h('tbody', {}, list.map((it) => h('tr', { class: opts.rowClass?.(it) || '', 'data-id': it.id },
          opts.columns.map((c) => h('td', { class: c.cls || '' }, c.render(it)))))));
      out.appendChild(h('div', { class: 'table-wrap' }, table));
    }
    if (opts.card) out.appendChild(h('div', { class: 'cards', style: opts.columns ? null : 'display:flex' }, list.map((it) => opts.card(it))));
    opts.afterRender?.(list);
  }

  return {
    el: root,
    setItems(next) { items = next || []; render(); },
    render,
    get items() { return items; },
    setChip(id) { listState.chip = id; persist(); render(); },
    setQuery(qy) { searchInput.value = qy; listState.query = qy.toLowerCase(); render(); },
  };
}

// ------------------------------------------------------------------ routing

export function routeParams() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [view, query = ''] = raw.split('?');
  return { view: view || 'bookings', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function setParam(key, value) {
  const { view, params } = routeParams();
  if (value == null || value === '') delete params[key];
  else params[key] = value;
  const qs = new URLSearchParams(params).toString();
  history.replaceState(null, '', `#/${view}${qs ? `?${qs}` : ''}`);
}

export function go(view, params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `#/${view}${qs ? `?${qs}` : ''}`;
}

export function pageHead(title, sub, actions = []) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

/** File -> base64 (no data: prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  } catch {
    toast('Copy failed. Select the text and copy it by hand.', 'warn');
  }
}

/** Sandboxed preview for email HTML: no scripts, no navigation. */
export function previewFrame(html, cls = 'preview-frame') {
  const f = h('iframe', { class: cls, sandbox: '', title: 'Email preview', referrerpolicy: 'no-referrer' });
  f.srcdoc = html || '';
  return f;
}
