// Shared header behaviour (greeting, sign in / sign out, mobile menu) plus a
// sign-up wrapper that turns Supabase's deliberately-vague "already
// registered" response into a real error.
import { getSupabase } from './supabase-client.js';

function initBurger() {
  const burger = document.getElementById('burgerBtn');
  const navLinks = document.getElementById('navLinks');
  if (!burger || !navLinks) return;
  burger.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open);
  });
  navLinks.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      burger.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }),
  );
}

// Marks the nav link matching the current page so you can tell where you are.
function markCurrentNavLink() {
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#navLinks a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return; // same-page jump, not a "you are here"
    if (href.split('#')[0] === here) a.classList.add('current');
  });
}

export async function initAuthNav() {
  initBurger();
  markCurrentNavLink();

  const el = document.getElementById('navAuth');
  if (!el) return;
  const supabase = await getSupabase();

  const greet = document.createElement('a');
  greet.className = 'nav-greet';
  greet.href = 'profile.html';
  greet.title = 'Edit your profile';
  greet.style.display = 'none';
  el.parentNode.insertBefore(greet, el);

  async function render(session) {
    el.textContent = session ? 'Sign out' : 'Sign in';
    el.href = session ? '#' : `login.html?next=${encodeURIComponent(location.pathname.split('/').pop() || 'index.html')}`;
    if (!session) {
      greet.style.display = 'none';
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
    const name = (profile?.full_name || session.user.user_metadata?.full_name || session.user.email || '').trim();
    greet.textContent = `Hello, ${name.split(/[\s@]/)[0]}!`;
    greet.style.display = 'inline-flex';
  }

  el.addEventListener('click', async (e) => {
    if (el.textContent !== 'Sign out') return;
    e.preventDefault();
    await supabase.auth.signOut();
    location.href = 'index.html';
  });

  const { data } = await supabase.auth.getSession();
  await render(data.session);
  // Deferred: querying Supabase from inside this callback can deadlock the auth lock.
  supabase.auth.onAuthStateChange((_event, session) => setTimeout(() => render(session), 0));
  window.addEventListener('ggs:profile-updated', async () => {
    const { data: d } = await supabase.auth.getSession();
    render(d.session);
  });
}

// With email confirmation on, Supabase hides account enumeration by returning
// a success with an empty `identities` array instead of an error. With it off
// it errors outright. Both mean the same thing to us.
export async function signUpChecked(supabase, email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      throw new Error('That email is already registered — log in instead.');
    }
    throw error;
  }
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error('That email is already registered — log in instead.');
  }
  return data;
}
