// Shared header behaviour (greeting, sign in / sign out, mobile menu) plus a
// sign-up wrapper that turns Supabase's deliberately-vague "already
// registered" response into a real error.
import { getSupabase } from './supabase-client.js';
import { claimGuestBookings } from './device.js';

// Every page is a sibling static file with no .html in its URL (GitHub Pages
// resolves /login to login.html natively; server.js does the same locally
// via express.static's `extensions` option). "." always means "this
// directory", i.e. the site root — so "./" is home and plain relative names
// ("login", "account") work unmodified whether the site sits at a domain
// root or, like this GitHub Pages project, under a subpath.
function currentPage() {
  const last = location.pathname.split('/').pop() || '';
  return last.replace(/\.html$/, ''); // '' on the root/index page
}

// A stray "/page.html" link (an old bookmark, a search result, GitHub's own
// default file listing) still resolves and works — this just tidies the
// visible address bar to match the clean links everywhere else on the site.
function normalizeUrl() {
  const path = location.pathname;
  if (!path.endsWith('.html')) return;
  let clean = path.slice(0, -'.html'.length);
  if (clean.endsWith('/index')) clean = clean.slice(0, -'index'.length);
  history.replaceState(null, '', clean + location.search + location.hash);
}

// One nav markup, built here, used by every page — the header used to be
// pasted into each HTML file by hand and drifted (different labels, different
// hrefs, "Booking" vs "Book a session"). Now there is exactly one layout.
const NAV_LINKS = [
  { label: 'Services', hash: '#services' },
  { label: 'The Room', hash: '#room' },
];

// Book a session and My Bookings are always both shown now, signed in or not —
// booking needs no account any more, and a guest browser can have real
// bookings to manage (see device.js), so hiding My Bookings behind a session
// would hide exactly the thing a signed-out visitor most needs.
function renderNav(navEl) {
  const onIndex = currentPage() === '';
  const bookHref = onIndex ? '#book' : './#book';
  const accountHref = onIndex ? 'account' : './account';

  const links = NAV_LINKS.map((l) => {
    const href = onIndex ? l.hash : `./${l.hash}`;
    return `<a href="${href}">${l.label}</a>`;
  }).join('');

  navEl.innerHTML = `
    <div class="logo"><a href="./"><img src="assets/Logo_NoBG.png" alt="GGS Studio"></a></div>
    <div class="nav-links" id="navLinks">${links}<a href="${bookHref}" id="navBookLink">Book a session</a><a href="${accountHref}" id="navBookingsLink">My Bookings</a></div>
    <div class="nav-right">
      <a href="login" class="nav-cta" id="navAuth">Sign in</a>
      <button class="burger" id="burgerBtn" aria-label="Toggle menu" aria-expanded="false" aria-controls="navLinks">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;
}

// Gives the bar visual weight once you've scrolled off the hero, instead of
// a flat translucent strip for the whole page.
function initScrollShadow(navEl) {
  const onScroll = () => navEl.classList.toggle('scrolled', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
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
  const here = currentPage();
  document.querySelectorAll('#navLinks a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return; // same-page jump, not a "you are here"
    if (href.replace(/^\.\//, '').split('#')[0] === here) a.classList.add('current');
  });
}

export async function initAuthNav() {
  normalizeUrl();
  const navEl = document.querySelector('nav');
  if (navEl) renderNav(navEl);
  if (navEl) initScrollShadow(navEl);
  initBurger();
  markCurrentNavLink();

  const el = document.getElementById('navAuth');
  if (!el) return;
  const supabase = await getSupabase();

  const greet = document.createElement('a');
  greet.className = 'nav-greet';
  greet.href = 'profile';
  greet.title = 'Edit your profile';
  greet.style.display = 'none';
  el.parentNode.insertBefore(greet, el);

  async function render(session) {
    el.textContent = session ? 'Sign out' : 'Sign in';
    // Omit the param entirely for the home page rather than sending
    // "?next=" — an empty string is falsy, so login.html's `|| 'account'`
    // fallback would otherwise silently redirect a home-page sign-in to
    // /account instead of back to /.
    const page = currentPage();
    el.href = session ? '#' : (page ? `login?next=${encodeURIComponent(page)}` : 'login');
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
    location.href = './';
  });

  const { data } = await supabase.auth.getSession();
  await render(data.session);
  // Deferred: querying Supabase from inside this callback can deadlock the auth lock.
  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => render(session), 0);
    // Signing in anywhere on the site sweeps up everything booked under this
    // address without an account, and marks this browser as one that has
    // legitimately signed into it. Fire-and-forget: it must never hold up or
    // break the sign-in itself, and claimGuestBookings swallows its own errors.
    if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      setTimeout(() => claimGuestBookings(session), 0);
    }
  });
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
  // Registering signs you straight in — nobody should have to type the
  // password they just chose a second time. signUp already returns a session
  // when email confirmation is off; when it doesn't, we try the password we
  // were handed. If confirmation really is required that sign-in fails, and
  // the null session tells the caller to ask for the emailed link instead.
  let session = data.session || null;
  if (!session) {
    const { data: signIn } = await supabase.auth.signInWithPassword({ email, password });
    session = signIn?.session || null;
  }
  return { ...data, session };
}

