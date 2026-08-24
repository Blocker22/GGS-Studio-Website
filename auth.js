// Shared header behaviour (greeting, sign in / sign out, mobile menu) plus a
// sign-up wrapper that turns Supabase's deliberately-vague "already
// registered" response into a real error.
import { getSupabase } from './supabase-client.js';

// One nav markup, built here, used by every page — the header used to be
// pasted into each HTML file by hand and drifted (different labels, different
// hrefs, "Booking" vs "Book a session"). Now there is exactly one layout.
const NAV_LINKS = [
  { label: 'Services', hash: '#services' },
  { label: 'The Room', hash: '#room' },
];

// The 4th slot toggles: "Book a session" signed out, "My Bookings" signed in
// — swapped in render() below rather than showing both at once.
function renderNav(navEl) {
  const here = location.pathname.split('/').pop() || 'index.html';
  const onIndex = here === 'index.html' || here === '';
  const bookHref = onIndex ? '#book' : 'index.html#book';

  const links = NAV_LINKS.map((l) => {
    const href = onIndex ? l.hash : `index.html${l.hash}`;
    return `<a href="${href}">${l.label}</a>`;
  }).join('');

  navEl.innerHTML = `
    <div class="logo"><a href="index.html"><img src="assets/Logo_NoBG.png" alt="GGS Studio"></a></div>
    <div class="nav-links" id="navLinks">${links}<a href="${bookHref}" id="navBookLink">Book a session</a></div>
    <div class="nav-right">
      <a href="login.html" class="nav-cta" id="navAuth">Sign in</a>
      <button class="burger" id="burgerBtn" aria-label="Toggle menu" aria-expanded="false" aria-controls="navLinks">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;
  return bookHref;
}

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
  const navEl = document.querySelector('nav');
  const bookHref = navEl ? renderNav(navEl) : null;
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

  const bookLink = document.getElementById('navBookLink');

  async function render(session) {
    el.textContent = session ? 'Sign out' : 'Sign in';
    el.href = session ? '#' : `login.html?next=${encodeURIComponent(location.pathname.split('/').pop() || 'index.html')}`;
    if (bookLink) {
      if (session) {
        bookLink.textContent = 'My Bookings';
        bookLink.href = 'account.html';
      } else {
        bookLink.textContent = 'Book a session';
        bookLink.href = bookHref;
      }
      markCurrentNavLink(); // href just changed, so "current" needs a re-check
    }
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
