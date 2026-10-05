// Dashboard shell: sign-in, the forced first password change, the grouped
// sidebar (collapsible on wide screens, a drawer on narrow ones), the header,
// and a hash router (#/view?params) so views survive reloads and Back on a
// static host. Each view lives in ./views/<name>.js and loads on demand.

import {
  api, btn, clear, errorBox, field, go, h, icon, input, openDialog, q, routeParams, run, sb, skeleton,
  state, storeGet, storeSet, toast, avatar,
} from './core.js';

export const NAV = [
  { group: 'Front desk', items: [
    { id: 'bookings', label: 'Bookings', icon: 'calendar-check' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar-dots' },
    { id: 'customers', label: 'Customers', icon: 'users' },
    { id: 'payments', label: 'Payments', icon: 'receipt' },
  ] },
  { group: 'Messages', items: [
    { id: 'inbox', label: 'Inbox', icon: 'tray' },
    { id: 'templates', label: 'Email templates', icon: 'envelope-simple' },
    { id: 'feedback', label: 'Reviews', icon: 'star' },
  ] },
  { group: 'Marketing', items: [
    { id: 'mailing', label: 'Mailing list', icon: 'paper-plane-tilt' },
    { id: 'graphics', label: 'Social graphics', icon: 'image' },
    { id: 'vouchers', label: 'Vouchers', icon: 'ticket' },
  ] },
  { group: 'Setup', items: [
    { id: 'schedule', label: 'Schedule', icon: 'clock' },
    { id: 'services', label: 'Rooms & rates', icon: 'microphone-stage' },
    { id: 'paymethods', label: 'Payment methods', icon: 'credit-card' },
    { id: 'contacts', label: 'Contacts', icon: 'address-book' },
    { id: 'assistant', label: 'Chat assistant', icon: 'chat-circle-dots' },
    { id: 'rules', label: 'Booking rules', icon: 'sliders-horizontal' },
  ] },
  { group: 'Reports & team', items: [
    { id: 'insights', label: 'Insights', icon: 'chart-bar' },
    { id: 'audit', label: 'Audit log', icon: 'list-magnifying-glass' },
    { id: 'team', label: 'Team', icon: 'users-three' },
  ] },
];
const VIEWS = new Set([...NAV.flatMap((g) => g.items.map((i) => i.id)), 'profile']);
const app = document.getElementById('app');

// ------------------------------------------------------------------ sign in

function renderSignIn(message) {
  const email = input({ type: 'email', autocomplete: 'username', required: true });
  const password = input({ type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'field-error', role: 'alert' }, message || '');
  const submit = btn('Sign in', { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'signin-card', novalidate: true },
    h('img', { src: 'assets/Logo_NoBG.png', alt: 'GGS Studio' }),
    h('h1', {}, 'Studio dashboard'),
    h('p', {}, 'Staff sign-in. Customers, use My Bookings on the main site.'),
    field('Email', email), field('Password', password), err, submit,
    h('p', { class: 'hint', style: 'margin:16px 0 0' }, h('a', { href: './' }, 'Back to the website')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!email.value.trim() || !password.value) { err.textContent = 'Enter your email and password.'; return; }
    const supabase = await sb();
    await run(submit, async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) {
        err.textContent = /invalid/i.test(error.message) ? "That email and password don't match." : error.message;
        return;
      }
      await boot();
    }).catch(() => {});
  });
  clear(app).appendChild(h('div', { class: 'signin' }, form));
  email.focus();
}

function forcePasswordChange() {
  return new Promise((resolve) => {
    const pw = input({ type: 'password', autocomplete: 'new-password', minlength: 10 });
    const pw2 = input({ type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'field-error' });
    openDialog({
      title: 'Choose your own password',
      sub: 'You signed in with a temporary password. Pick a new one to continue.',
      size: 'narrow',
      dismissable: false,
      body: h('div', { class: 'stack' }, field('New password', pw, { hint: 'At least 10 characters.' }), field('Repeat it', pw2), err),
      foot: (d) => [btn('Save password', { kind: 'primary', onClick: async (e) => {
        err.textContent = '';
        if (pw.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; }
        if (pw.value !== pw2.value) { err.textContent = "The two passwords don't match."; return; }
        const supabase = await sb();
        await run(e.currentTarget, async () => {
          const { error } = await supabase.auth.updateUser({ password: pw.value });
          if (error) throw error;
          await q(supabase.from('profiles').update({ must_change_password: false }).eq('id', state.profile.id));
          d.close(true);
        }, { success: 'Password saved.' }).catch(() => {});
      } })],
      onClose: () => resolve(),
    });
  });
}

// ------------------------------------------------------------------ shell

let shell;
let content;
let navButtons = {};
let currentView = null;
let cleanup = null;

function buildShell() {
  const collapsed = storeGet('ggs-sidebar-collapsed', false);
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Dashboard sections' });
  sidebar.appendChild(h('a', { class: 'brand', href: '#/bookings' },
    h('img', { src: 'assets/Logo_NoBG.png', alt: '' }),
    h('div', { class: 'brand-text' }, h('strong', {}, 'GGS Studio'), h('span', {}, 'Dashboard'))));
  navButtons = {};
  NAV.forEach((g) => {
    const group = h('div', { class: 'nav-group' }, h('div', { class: 'nav-group-label' }, g.group));
    g.items.forEach((it) => {
      const badge = h('span', { class: 'nav-badge', hidden: true });
      const a = h('a', { class: 'nav-item', href: `#/${it.id}`, title: it.label, onclick: () => shell.classList.remove('drawer-open') },
        icon(it.icon), h('span', { class: 'label' }, it.label), badge);
      a.badge = badge;
      navButtons[it.id] = a;
      group.appendChild(a);
    });
    sidebar.appendChild(group);
  });
  const collapseBtn = h('button', { class: 'nav-item hide-mobile', type: 'button', onclick: () => {
    shell.classList.toggle('collapsed');
    storeSet('ggs-sidebar-collapsed', shell.classList.contains('collapsed'));
  } }, icon('sidebar-simple'), h('span', { class: 'label' }, 'Collapse sidebar'));
  sidebar.appendChild(h('div', { class: 'sidebar-foot' },
    h('a', { class: 'nav-item', href: './', target: '_blank', rel: 'noopener' }, icon('arrow-square-out'), h('span', { class: 'label' }, 'View website')),
    collapseBtn));

  const p = state.profile;
  const me = h('button', { class: 'me', type: 'button', onclick: () => go('profile'), title: 'Your profile' },
    avatar(p), h('span', {}, p.full_name || state.session.user.email));
  const themeBtn = btn('', { kind: 'ghost', iconName: 'circle-half', aria: 'Switch light or dark', onClick: () => {
    const now = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = now === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ggs-admin-theme', next); } catch { /* ignore */ }
  } });
  const refreshBtn = btn('', { kind: 'ghost', iconName: 'arrow-clockwise', aria: 'Refresh this view', onClick: () => route(true) });
  const signOut = btn('', { kind: 'ghost', iconName: 'sign-out', aria: 'Sign out', onClick: async () => {
    const supabase = await sb();
    await supabase.auth.signOut();
    location.hash = '';
    renderSignIn();
  } });
  const menuBtn = btn('', { kind: 'ghost', iconName: 'list', aria: 'Open menu', onClick: () => shell.classList.add('drawer-open') });
  menuBtn.classList.add('show-mobile');
  const title = h('span', { class: 'topbar-title' });
  const topbar = h('header', { class: 'topbar' }, menuBtn, title, h('div', { class: 'spacer' }), refreshBtn, themeBtn, me, signOut);

  content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  shell = h('div', { class: `shell ${collapsed ? 'collapsed' : ''}` },
    sidebar, h('div', { class: 'drawer-scrim', onclick: () => shell.classList.remove('drawer-open') }),
    h('div', { class: 'main' }, topbar, content));
  shell.titleEl = title;
  clear(app).appendChild(shell);
}

export function setBadge(view, count) {
  const a = navButtons[view];
  if (!a) return;
  a.badge.textContent = count > 99 ? '99+' : String(count || '');
  a.badge.hidden = !count;
  a.classList.toggle('has-badge', !!count);
}

async function refreshBadges() {
  if (document.hidden || !state.session) return;
  try {
    const supabase = await sb();
    const [unread, review] = await Promise.all([
      q(supabase.from('mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'in').eq('read', false)),
      q(supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'submitted')),
    ]);
    setBadge('inbox', unread);
    setBadge('payments', review);
  } catch { /* badges are best-effort */ }
}

async function route(force = false) {
  const { view: rawView, params } = routeParams();
  const view = VIEWS.has(rawView) ? rawView : 'bookings';
  Object.entries(navButtons).forEach(([id, a]) => { if (id === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const label = NAV.flatMap((g) => g.items).find((i) => i.id === view)?.label || 'Your profile';
  shell.titleEl.textContent = label;
  document.title = `${label} · GGS Studio`;
  if (!force && view === currentView && cleanup?.onParams) {
    cleanup.onParams(params);
    return;
  }
  if (typeof cleanup === 'function') cleanup();
  else cleanup?.destroy?.();
  cleanup = null;
  currentView = view;
  clear(content).appendChild(skeleton(6, { tiles: view === 'bookings' || view === 'insights' ? 4 : 0 }));
  try {
    const mod = await import(`./views/${view}.js`);
    if (currentView !== view) return;
    const container = h('div');
    cleanup = await mod.render(container, params, { setBadge, refreshBadges });
    if (currentView !== view) return;
    clear(content).appendChild(container);
  } catch (err) {
    console.error(err);
    clear(content).appendChild(errorBox(err, () => route(true)));
  }
}

// ------------------------------------------------------------------ boot

let badgeTimer = null;

async function boot() {
  const supabase = await sb();
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (!state.session) return renderSignIn();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
  if (!profile || !['staff', 'admin'].includes(profile.role)) {
    await supabase.auth.signOut();
    return renderSignIn('This account has no staff access. Use My Bookings on the main site instead.');
  }
  state.profile = profile;
  if (profile.must_change_password) await forcePasswordChange();
  try { state.status = await api('status'); } catch { state.status = null; }
  buildShell();
  window.addEventListener('hashchange', () => route());
  await route();
  refreshBadges();
  clearInterval(badgeTimer);
  badgeTimer = setInterval(refreshBadges, 90000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadges(); });
  window.addEventListener('ggs:badges', refreshBadges);
  if (state.status && !state.status.email_configured) {
    toast('Email is not configured, so no emails are being sent. Set RESEND_API_KEY in Supabase.', 'warn');
  }
}

(async () => {
  const supabase = await sb();
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { state.session = null; }
    if (event === 'TOKEN_REFRESHED') state.session = session;
  });
  try {
    await boot();
  } catch (err) {
    console.error(err);
    clear(app).appendChild(h('div', { class: 'signin' }, errorBox(err, () => location.reload())));
  }
})();

