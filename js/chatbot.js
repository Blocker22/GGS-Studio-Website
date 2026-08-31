// The studio assistant that lives in the bottom-right corner of the site.
//
// Almost everything it answers, it answers locally. The rates, the opening
// hours, the booking and payment policy, and the signed-in customer's own
// sessions are all already reachable from the browser, so a question about any
// of them is a lookup, not a language problem — answering it here is instant,
// free, always correct, and works with the network flaking.
//
// Only a genuinely open-ended question ("can I bring my own drummer and split
// the session across two days?") falls through to supabase/functions/
// chat-assist, which is where the AI provider and its key live. The key is
// never in this file, and never reaches the browser.
//
// The "book for me" flow doesn't reimplement booking — it drives the real
// booking form (#bookingForm on index.html/account.html) by setting its
// fields and dispatching the same events a person clicking through it would,
// so every existing rule (add-on prerequisites, live pricing, the terms gate,
// sign-in) keeps working exactly as it does today. The two things a chat
// message genuinely cannot do — pick a file from disk, and give legally
// meaningful consent to the terms — stay native browser interactions; the
// wizard hands the ID photo off through a real file input, and lets the
// existing terms modal handle agreement.

import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { deviceCredentials, fetchGuestBookings } from './device.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const SCROLL_REVEAL_PX = 380;
const MAX_HISTORY_TURNS = 8;
const MIN_THINK_MS = 380;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function peso(n) {
  return '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function to12Hour(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const period = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${period}`;
}

function fmtDateHuman(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fireEvent(el, type) {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

// Where the booking form lives depends on which page we're on: index.html and
// account.html both embed it, anywhere else has to navigate to the home page.
function bookHref() {
  const onBookingPage = Boolean(document.getElementById('bookingForm'));
  return onBookingPage ? '#book' : 'index#book';
}

export async function initChatbot() {
  if (document.getElementById('ggsChat')) return;

  const root = document.createElement('div');
  root.id = 'ggsChat';
  root.className = 'ggs-chat';
  root.innerHTML = `
    <button type="button" class="ggs-chat-launcher" aria-expanded="false" aria-controls="ggsChatPanel">
      <span class="ggs-chat-launcher-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </span>
      <span class="ggs-chat-launcher-close" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </span>
      <span class="sr-only">Open the studio assistant</span>
    </button>

    <div class="ggs-chat-panel" id="ggsChatPanel" role="dialog" aria-label="GGS Studio assistant" hidden>
      <div class="ggs-chat-head">
        <div>
          <strong>Studio assistant</strong>
          <span class="ggs-chat-sub" data-chat-status>Here to help with your session</span>
        </div>
        <button type="button" class="ggs-chat-x" data-chat-close aria-label="Close the assistant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="ggs-chat-log" data-chat-log role="log" aria-live="polite"></div>

      <div class="ggs-chat-quick" data-chat-quick></div>

      <form class="ggs-chat-form" data-chat-form>
        <input type="text" data-chat-input placeholder="Ask about your booking…" autocomplete="off" maxlength="800">
        <button type="submit" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
      <p class="ggs-chat-foot">Answers are for guidance — the booking form and <a href="privacy">Privacy Policy</a> are what count.</p>
    </div>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.ggs-chat-launcher');
  const panel = root.querySelector('.ggs-chat-panel');
  const log = root.querySelector('[data-chat-log]');
  const quickWrap = root.querySelector('[data-chat-quick]');
  const form = root.querySelector('[data-chat-form]');
  const input = root.querySelector('[data-chat-input]');
  const statusEl = root.querySelector('[data-chat-status]');

  // --- Reveal on scroll ---------------------------------------------------
  // A short page (the profile or privacy page) can't be scrolled far enough to
  // ever cross the threshold, so on those the launcher is shown right away
  // rather than never appearing at all.
  function syncVisible() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const shown = scrollable <= SCROLL_REVEAL_PX || window.scrollY > SCROLL_REVEAL_PX;
    root.classList.toggle('visible', shown || panel.hidden === false);
  }
  syncVisible();
  window.addEventListener('scroll', syncVisible, { passive: true });
  window.addEventListener('resize', syncVisible);

  // --- Studio facts, fetched once on first open ---------------------------
  let facts = null;
  let factsPromise = null;
  let supabase = null;

  async function loadFacts() {
    if (facts) return facts;
    if (factsPromise) return factsPromise;
    factsPromise = (async () => {
      supabase = await getSupabase();
      const [{ data: rooms }, { data: services }, { data: hours }, { data: settings }] = await Promise.all([
        supabase.from('rooms').select('*').eq('is_active', true).order('created_at').limit(1),
        supabase.from('services').select('*').eq('is_active', true),
        supabase.from('operating_hours').select('*'),
        supabase.from('app_settings').select('key, value').in('key', ['deposit_percent', 'reschedule_cutoff_hours']),
      ]);
      const setting = (k) => settings?.find((s) => s.key === k)?.value;
      facts = {
        room: rooms?.[0] || null,
        services: (services || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        hours: hours || [],
        depositPercent: Number(setting('deposit_percent') ?? 20),
        cutoffHours: Number(setting('reschedule_cutoff_hours') ?? 24),
      };
      return facts;
    })().catch(() => {
      // A failed lookup shouldn't take the whole widget down — the escalation
      // path still works, and the answers that need facts say so politely.
      facts = { room: null, services: [], hours: [], depositPercent: 20, cutoffHours: 24 };
      return facts;
    });
    return factsPromise;
  }

  // --- Local answers ------------------------------------------------------
  // Each returns { text, actions?, quick? }. None of these touch the network
  // beyond the one facts lookup above.
  const ANSWERS = {
    async book() {
      return {
        text: "I can either fill the booking form out for you right here, step by step, or just point you to it so you fill it in yourself. Which would you like?",
        quick: ['book_wizard', 'book_info'],
      };
    },

    async book_info() {
      const f = await loadFacts();
      return {
        text: [
          'Booking takes about a minute:',
          '1. Pick your date, start and end time on the booking form.',
          '2. Tick any add-ons you want — per-song services will ask how many.',
          '3. Choose how to pay: cash at the studio, a ' + f.depositPercent + '% downpayment online, or the full amount online.',
          '4. Confirm, and you will get an email once we have checked it.',
        ].join('\n'),
        actions: [{ label: 'Book a session', href: bookHref() }],
        quick: ['pay', 'rates', 'cancel'],
      };
    },

    async rates() {
      const f = await loadFacts();
      if (!f.room) return { text: "I couldn't load our rates just now. Please check the Services section on the home page, or call the studio on +63 976 350 6301." };
      const lines = [`The room is ${peso(f.room.hourly_rate)} per hour, and every session includes an engineer.`];
      if (f.services.length) {
        lines.push('Add-ons you can put on top:');
        f.services.forEach((s) => {
          const rate = s.price_type === 'hourly'
            ? `${peso(s.price)} / hr`
            : s.price_type === 'unit'
            ? `${peso(s.price)} per ${s.unit_label || 'unit'}`
            : `${peso(s.price)} flat`;
          lines.push(`• ${s.name} — ${rate}`);
        });
      }
      lines.push('The booking form totals it up for you as you pick.');
      return {
        text: lines.join('\n'),
        actions: [{ label: 'Open the booking form', href: bookHref() }],
        quick: ['book', 'pay', 'hours'],
      };
    },

    async hours() {
      const f = await loadFacts();
      if (!f.hours.length) return { text: 'Our hours are set per day in the booking calendar — pick a date on the booking form and it shows the open windows for that day.' };
      const lines = f.hours
        .slice()
        .sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0))
        .map((h) => (h.is_closed
          ? `• ${DAYS[h.day_of_week]} — closed`
          : `• ${DAYS[h.day_of_week]} — ${to12Hour(h.open_time)} to ${to12Hour(h.close_time)}`));
      return {
        text: ['Here are our regular hours:', ...lines, 'The calendar on the booking form shows what is actually free on a given day.'].join('\n'),
        actions: [{ label: 'Check availability', href: bookHref() }],
        quick: ['book', 'rates'],
      };
    },

    async pay() {
      const f = await loadFacts();
      return {
        text: [
          `Three ways to settle a session:`,
          `• Cash at the studio — attach a photo of a valid ID to hold the slot, pay on the day.`,
          `• ${f.depositPercent}% downpayment online — scan our GCash, GoTyme, or BPI QR, upload the receipt, pay the balance at the studio.`,
          `• Full payment online — same QR transfer, nothing left to pay on the day.`,
          `Online bookings are confirmed once our staff have checked the receipt. Only ever pay to the QR codes shown on this site.`,
        ].join('\n'),
        actions: [{ label: 'My bookings', href: 'account' }],
        quick: ['mine', 'cancel', 'book'],
      };
    },

    // 'cancel' isn't answered from here — runIntent() routes it straight to
    // startManageBookings(), which lists the customer's own bookings with
    // working Cancel/Reschedule buttons instead of just describing the policy.

    async mine() {
      const sb = supabase || (await getSupabase());
      supabase = sb;
      const { data: sessionData } = await sb.auth.getSession();
      const session = sessionData?.session;

      // Signed out is no longer a dead end: booking needs no account, so this
      // browser may well have sessions of its own to show.
      let bookings = [];
      if (session) {
        const { data, error } = await sb
          .from('bookings')
          .select('start_at, end_at, status, total_price, rooms(name)')
          .eq('customer_id', session.user.id)
          .gte('start_at', new Date().toISOString())
          .neq('status', 'cancelled')
          .order('start_at')
          .limit(3);
        if (error) return { text: 'I could not read your bookings just now. The My Bookings page will have them.', actions: [{ label: 'My bookings', href: 'account' }] };
        bookings = data || [];
      } else {
        const guest = await fetchGuestBookings();
        bookings = guest.bookings
          .filter((b) => new Date(b.start_at) >= new Date() && b.status !== 'cancelled')
          .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
          .slice(0, 3);
      }

      if (!bookings.length) {
        return {
          text: session
            ? 'You have no upcoming sessions booked at the moment.'
            : "I can't see any sessions booked on this browser. If you booked on another device, sign in and they'll all be here.",
          actions: session
            ? [{ label: 'Book one now', href: bookHref() }]
            : [{ label: 'Book one now', href: bookHref() }, { label: 'Sign in', href: 'login?next=account' }],
          quick: ['rates', 'hours'],
        };
      }
      const lines = bookings.map((b) => {
        const s = new Date(b.start_at);
        const e = new Date(b.end_at);
        const when = s.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
        const t = `${s.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}–${e.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
        return `• ${b.rooms?.name || 'Room'} on ${when}, ${t} — ${b.status}, ${peso(b.total_price)}`;
      });
      return {
        text: [bookings.length === 1 ? 'Here is your next session:' : 'Here are your next sessions:', ...lines].join('\n'),
        actions: [{ label: 'Manage them', href: 'account' }],
        quick: ['cancel', 'pay'],
      };
    },

    async where() {
      return {
        text: [
          'We are at Manson Trading, Looc, Lapu-Lapu City, Cebu.',
          'Email ggs.studio2026@gmail.com or call +63 976 350 6301 — happy to help either way.',
        ].join('\n'),
        actions: [
          { label: 'Open in Maps', href: 'https://maps.google.com/?q=Manson+Trading,+Looc,+Lapu-Lapu+City,+Cebu', external: true },
          { label: 'Call the studio', href: 'tel:+639763506301' },
        ],
        quick: ['hours', 'book'],
      };
    },
  };

  const QUICK_LABELS = {
    rates: 'Rates & services',
    book: 'I want to book',
    book_wizard: 'Yes, fill it out for me',
    book_info: "I'll do it myself",
    pay: 'How do I pay?',
    cancel: 'Cancel or reschedule',
    mine: 'My bookings',
    hours: 'Opening hours',
    where: 'Where are you?',
  };

  const DEFAULT_QUICK = ['book', 'rates', 'mine', 'cancel', 'hours', 'where'];

  // Keyword routing for typed questions. Deliberately narrow: it only claims a
  // message it is confident about, and anything else is escalated rather than
  // guessed at with a canned reply that might be wrong.
  const KEYWORDS = [
    ['mine', /\b(my|our)\b.*\b(booking|bookings|session|sessions|schedule|reservation)|^bookings?$|upcoming/i],
    ['cancel', /cancel|reschedul|resched|move (my|the) (booking|session)|change (the )?(date|time)|refund|no.?show/i],
    ['pay', /\bpay|payment|deposit|downpayment|gcash|bpi|gotyme|receipt|cash|qr\b|installment|price.*(pay|settle)/i],
    ['rates', /rate|price|pricing|cost|how much|magkano|fee|charge|per (song|track|hour)|package/i],
    ['hours', /hour|open|close|closing|opening|what time|schedule.*(open|close)|available.*(day|time)|araw/i],
    ['book', /book|reserve|reservation|schedule a|slot|avail a|sign up for a session/i],
    ['where', /where|location|address|map|direction|contact|phone|email|call you|find you/i],
  ];

  // A short message that lands squarely on one topic gets the local answer. A
  // long one, or one that mixes topics, almost always carries a condition the
  // canned text doesn't cover — that is what the AI escalation is for.
  function routeLocally(text) {
    const words = text.trim().split(/\s+/).length;
    const matches = KEYWORDS.filter(([, re]) => re.test(text)).map(([id]) => id);
    if (matches.length === 0) return null;
    if (matches.length > 1 && words > 6) return null;
    if (words > 12) return null;
    // A question with its own conditions ("if", "but", "can I also") is exactly
    // the kind the prepared answer would talk past.
    if (/\b(if|but|also|instead|except|unless|both|and then|possible to)\b/i.test(text) && words > 6) return null;
    return matches[0];
  }

  // --- Rendering ------------------------------------------------------------
  const history = [];

  function scrollDown() {
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  // Reveals bot text a few words at a time rather than popping in whole, so
  // every answer — canned or AI-written — visibly "types". Word-chunked
  // rather than character-by-character: just as readable as a stream, far
  // fewer DOM writes, and the total time is capped so a long AI answer
  // doesn't make someone wait to finish reading what's already on screen.
  function typeIntoBubble(bubble, text, onDone) {
    const html = escapeHtml(text).replace(/\n/g, '<br>');
    if (reducedMotion()) {
      bubble.innerHTML = html;
      onDone();
      return;
    }
    const tokens = text.split(/(\s+)/);
    const wordCount = tokens.filter((t) => t.trim()).length || 1;
    const perWordMs = Math.max(10, Math.min(38, 900 / wordCount));
    bubble.classList.add('typing');
    bubble.innerHTML = '';
    let i = 0;
    (function step() {
      i++;
      bubble.innerHTML = escapeHtml(tokens.slice(0, i).join('')).replace(/\n/g, '<br>');
      scrollDown();
      if (i < tokens.length) {
        setTimeout(step, perWordMs);
      } else {
        bubble.classList.remove('typing');
        onDone();
      }
    })();
  }

  // Appends one message and resolves once it has finished "typing" — a plain
  // user message resolves immediately, a bot message resolves after the
  // word-reveal (or instantly under reduced motion). Await it before adding
  // whatever comes next, so replies never race ahead of their own text.
  function addMessage(who, text, { actions = [] } = {}) {
    const row = document.createElement('div');
    row.className = `ggs-msg ggs-msg-${who}`;
    const bubble = document.createElement('div');
    bubble.className = 'ggs-bubble';
    row.appendChild(bubble);
    log.appendChild(row);
    scrollDown();

    return new Promise((resolve) => {
      const finish = () => {
        if (actions.length) {
          const acts = document.createElement('div');
          acts.className = 'ggs-msg-actions';
          actions.forEach((a) => {
            const link = document.createElement('a');
            link.className = 'ggs-msg-action';
            link.href = a.href;
            link.textContent = a.label;
            if (a.external) { link.target = '_blank'; link.rel = 'noopener'; }
            // An in-page jump to the booking form should also shut the panel,
            // so the thing it just pointed at isn't hidden behind it.
            if (a.href.startsWith('#')) link.addEventListener('click', () => closePanel());
            acts.appendChild(link);
          });
          row.appendChild(acts);
        }
        scrollDown();
        resolve(row);
      };
      if (who === 'user') {
        bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
        finish();
      } else {
        typeIntoBubble(bubble, text, finish);
      }
    });
  }

  function renderQuick(ids = DEFAULT_QUICK) {
    quickWrap.innerHTML = '';
    ids.filter((id) => QUICK_LABELS[id]).forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ggs-quick';
      btn.textContent = QUICK_LABELS[id];
      btn.addEventListener('click', () => handlePreset(id));
      quickWrap.appendChild(btn);
    });
  }

  function showTyping() {
    const row = document.createElement('div');
    row.className = 'ggs-msg ggs-msg-bot';
    row.innerHTML = '<div class="ggs-bubble ggs-typing"><span></span><span></span><span></span></div>';
    log.appendChild(row);
    scrollDown();
    return row;
  }

  // Every bot message — canned, AI-written, or a wizard prompt — passes
  // through here: a beat of "…" first (padded to a minimum so an instant
  // local lookup still reads as a reply being composed, not a blank flash),
  // then the message itself typing in.
  async function sendBotMessage(text, opts = {}) {
    const typing = showTyping();
    const started = Date.now();
    await sleep(Math.max(0, MIN_THINK_MS - (Date.now() - started)));
    typing.remove();
    return addMessage('bot', text, opts);
  }

  async function respondWithTyping(work) {
    const typing = showTyping();
    const started = Date.now();
    try {
      const answer = await work();
      const elapsed = Date.now() - started;
      if (elapsed < MIN_THINK_MS && !reducedMotion()) await sleep(MIN_THINK_MS - elapsed);
      typing.remove();
      return answer;
    } catch (err) {
      typing.remove();
      throw err;
    }
  }

  // 'book_wizard' and 'cancel' need to drive an interactive flow rather than
  // display one canned reply, so they short-circuit the plain ANSWERS lookup
  // both here and in handleTyped below.
  async function runIntent(id) {
    if (id === 'book_wizard') return startBookingWizard();
    if (id === 'cancel') return startManageBookings();
    const answer = await respondWithTyping(() => ANSWERS[id]());
    await addMessage('bot', answer.text, { actions: answer.actions });
    history.push({ role: 'model', text: answer.text });
    renderQuick(answer.quick?.length ? [...answer.quick, 'where'] : DEFAULT_QUICK);
  }

  // A quick-reply button's own click handler never awaits this, so without a
  // catch here any error thrown anywhere downstream — the wizard, the manage-
  // bookings flow, anything runIntent reaches — became an unhandled promise
  // rejection: invisible in the UI, the conversation just stops dead. Every
  // preset click is now guaranteed to end in either a normal reply or a
  // visible error message, never silence.
  async function handlePreset(id) {
    addMessage('user', QUICK_LABELS[id]);
    history.push({ role: 'user', text: QUICK_LABELS[id] });
    quickWrap.innerHTML = '';
    try {
      await runIntent(id);
    } catch (err) {
      console.error('[chatbot] preset failed:', id, err);
      await sendBotMessage(`Sorry, something went wrong on my end (${err?.message || 'unknown error'}). Please try again, or reach the studio directly.`, {
        actions: [{ label: 'Email the studio', href: 'mailto:ggs.studio2026@gmail.com' }],
      });
      renderQuick(DEFAULT_QUICK);
    }
  }

  // The only path that spends an API call.
  async function escalate(text) {
    const sb = supabase || (await getSupabase());
    supabase = sb;
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData?.session?.access_token || SUPABASE_ANON_KEY;

    const res = await fetch(`${FUNCTIONS_URL}/chat-assist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: history.slice(-MAX_HISTORY_TURNS) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The assistant is unavailable right now.');
    return data.reply;
  }

  async function handleTyped(text) {
    addMessage('user', text);
    history.push({ role: 'user', text });
    quickWrap.innerHTML = '';

    const local = routeLocally(text);
    try {
      if (local) {
        await runIntent(local);
        return;
      }
      statusEl.textContent = 'Thinking…';
      const reply = await respondWithTyping(() => escalate(text));
      await addMessage('bot', reply);
      history.push({ role: 'model', text: reply });
      renderQuick(DEFAULT_QUICK);
    } catch (err) {
      await addMessage('bot', `${err.message} You can always reach the studio at ggs.studio2026@gmail.com or +63 976 350 6301.`, {
        actions: [{ label: 'Email the studio', href: 'mailto:ggs.studio2026@gmail.com' }],
      });
      renderQuick(DEFAULT_QUICK);
    } finally {
      statusEl.textContent = 'Here to help with your session';
    }
  }

  // === Booking wizard =======================================================
  // Drives the real #bookingForm instead of duplicating its logic: every value
  // collected here is written straight into the form's own inputs and fired as
  // a real 'input'/'change' event, so the form's existing listeners (pricing,
  // add-on prerequisites, pay-option amounts) do the actual work. The wizard
  // only ever reads back what the form itself computed.
  function getFormRefs() {
    const bookingForm = document.getElementById('bookingForm');
    if (!bookingForm) return null;
    return {
      form: bookingForm,
      nameEl: document.getElementById('fName'),
      emailEl: document.getElementById('fEmail'),
      dateEl: document.getElementById('fDate'),
      startEl: document.getElementById('fStart'),
      endEl: document.getElementById('fEnd'),
      idImageEl: document.getElementById('fIdImage'),
      sumDuration: document.getElementById('sumDuration'),
      sumPrice: document.getElementById('sumPrice'),
    };
  }

  function mountWizardBox(html, mount) {
    const row = document.createElement('div');
    row.className = 'ggs-msg ggs-msg-bot ggs-msg-wizard';
    const box = document.createElement('div');
    box.className = 'ggs-wizard-box';
    box.innerHTML = html;
    row.appendChild(box);
    log.appendChild(row);
    scrollDown();
    mount(box);
  }

  function lockWizardBox(box) {
    box.querySelectorAll('input, button, select').forEach((el) => { el.disabled = true; });
    box.classList.add('done');
  }

  // `field` is optional — when given, that specific input turns red (matching
  // the booking form's own field-error styling) and is scrolled into view and
  // focused, rather than leaving the reason to a caption that can be off-screen
  // if the wizard box has scrolled up in a long conversation.
  function showWizardError(box, message, field) {
    const err = box.querySelector('[data-w-err]');
    if (err) { err.textContent = message; err.hidden = false; }

    box.querySelectorAll('input.invalid').forEach((el) => el.classList.remove('invalid'));
    if (!field) return false;

    field.classList.add('invalid');
    field.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    field.focus({ preventScroll: true });
    if (!field.dataset.wErrWatch) {
      field.dataset.wErrWatch = '1';
      field.addEventListener('input', () => field.classList.remove('invalid'), { once: false });
    }
    return false;
  }

  // Checks a candidate [startAt, endAt) against opening hours and existing
  // bookings before the wizard accepts it — otherwise someone could sail
  // through every remaining step only to have the server reject an already-
  // closed or already-booked slot at the very last one. Uses the same
  // public_busy_ranges RPC the landing-page calendar uses, so a signed-out
  // visitor can still get a real answer.
  // `fields` (optional) is whichever of { dateI, startI, endI } this step
  // actually has, so each failure can redden the input it's actually about
  // instead of only the caption underneath.
  async function validateSlot(startAt, endAt, box, fields = {}) {
    const { dateI, startI } = fields;
    const f = await loadFacts();
    if (!f.room) { showWizardError(box, 'Could not verify availability just now — please try again.'); return false; }

    if (startAt.getTime() < Date.now()) {
      showWizardError(box, 'That start time has already passed — please pick a later time.', startI);
      return false;
    }

    const dayKey = startAt.toLocaleDateString('en-CA');
    const hours = f.hours.find((h) => h.day_of_week === startAt.getDay());
    if (!hours || hours.is_closed) {
      showWizardError(box, "We're closed that day — please pick another date.", dateI);
      return false;
    }
    const openAt = new Date(`${dayKey}T${hours.open_time}`);
    let closeAt = new Date(`${dayKey}T${hours.close_time}`);
    if (closeAt <= openAt) closeAt = new Date(closeAt.getTime() + 24 * 3600000);
    if (startAt < openAt || endAt > closeAt) {
      showWizardError(box, `We're open ${to12Hour(hours.open_time)}–${to12Hour(hours.close_time)} that day — please pick a time in that window.`, startI);
      return false;
    }

    const sb = supabase || (await getSupabase());
    supabase = sb;
    const { data: busy, error } = await sb.rpc('public_busy_ranges', {
      p_room_id: f.room.id,
      p_from: startAt.toISOString(),
      p_to: endAt.toISOString(),
    });
    if (error) { showWizardError(box, 'Could not verify availability just now — please try again.'); return false; }
    const conflict = (busy || []).some((r) => new Date(r.start_at).getTime() < endAt.getTime() && new Date(r.end_at).getTime() > startAt.getTime());
    if (conflict) { showWizardError(box, 'That time is already booked — please pick another slot.', startI); return false; }
    return true;
  }

  async function wizardDateTime(refs) {
    await sendBotMessage("First — what date and time works for you?");
    await new Promise((resolve) => {
      const todayIso = new Date().toLocaleDateString('en-CA');
      const html = `
        <div class="ggs-wizard-row">
          <label>Date<input type="date" data-w-date min="${todayIso}" value="${escapeHtml(refs.dateEl.value || '')}"></label>
        </div>
        <div class="ggs-wizard-row ggs-wizard-row-2">
          <label>Start<input type="time" step="1800" data-w-start value="${escapeHtml(refs.startEl.value || '')}"></label>
          <label>End<input type="time" step="1800" data-w-end value="${escapeHtml(refs.endEl.value || '')}"></label>
        </div>
        <p class="ggs-wizard-error" data-w-err hidden></p>
        <button type="button" class="ggs-wizard-btn" data-w-next>Continue</button>`;
      mountWizardBox(html, (box) => {
        const nextBtn = box.querySelector('[data-w-next]');
        nextBtn.addEventListener('click', async () => {
          const dateI = box.querySelector('[data-w-date]');
          const startI = box.querySelector('[data-w-start]');
          const endI = box.querySelector('[data-w-end]');
          if (!dateI.value) return showWizardError(box, 'Please pick a date.', dateI);
          if (!startI.value) return showWizardError(box, 'Please pick a start time.', startI);
          if (!endI.value) return showWizardError(box, 'Please pick an end time.', endI);
          if (dateI.value < todayIso) return showWizardError(box, 'That date has already passed — please pick today or later.', dateI);
          const [sh, sm] = startI.value.split(':').map(Number);
          const [eh, em] = endI.value.split(':').map(Number);
          if (eh * 60 + em <= sh * 60 + sm) return showWizardError(box, 'End time must be after the start time.', endI);

          const startAt = new Date(`${dateI.value}T${startI.value}:00`);
          const endAt = new Date(`${dateI.value}T${endI.value}:00`);

          nextBtn.disabled = true;
          nextBtn.textContent = 'Checking availability…';
          let ok = false;
          try {
            ok = await validateSlot(startAt, endAt, box, { dateI, startI, endI });
          } catch (err) {
            console.error('[chatbot] slot check failed:', err);
            showWizardError(box, 'Could not verify availability just now — please try again.');
          } finally {
            nextBtn.disabled = false;
            nextBtn.textContent = 'Continue';
          }
          if (!ok) return;

          refs.dateEl.value = dateI.value; fireEvent(refs.dateEl, 'input'); fireEvent(refs.dateEl, 'change');
          refs.startEl.value = startI.value; fireEvent(refs.startEl, 'input'); fireEvent(refs.startEl, 'change');
          refs.endEl.value = endI.value; fireEvent(refs.endEl, 'input'); fireEvent(refs.endEl, 'change');

          lockWizardBox(box);
          addMessage('user', `${fmtDateHuman(dateI.value)}, ${to12Hour(startI.value)}–${to12Hour(endI.value)}`);
          resolve();
        });
      });
    });
  }

  // Depth of a service in its own prerequisite chain (0 = no prerequisite),
  // so dependencies can be checked into the real form parent-first — checking
  // a dependant before its prerequisite just gets it silently unchecked again
  // by the form's own syncServiceDeps.
  function dependencyDepth(id, svcById, seen = new Set()) {
    if (seen.has(id)) return 0;
    seen.add(id);
    const req = svcById.get(id)?.requires_service_id;
    return req ? 1 + dependencyDepth(req, svcById, seen) : 0;
  }

  function applyAddonsToForm(picked, services) {
    const wrap = document.getElementById('fServices');
    if (!wrap) return;
    const svcById = new Map(services.map((s) => [s.id, s]));
    const wanted = new Set(picked.map((p) => p.id));
    const qtyById = new Map(picked.map((p) => [p.id, p.qty]));

    // A picked service drags its whole prerequisite chain along — the real
    // form enforces this anyway, so silently including it here beats the
    // wizard's pick getting rejected with no explanation.
    let changed = true;
    while (changed) {
      changed = false;
      Array.from(wanted).forEach((id) => {
        const req = svcById.get(id)?.requires_service_id;
        if (req && !wanted.has(req)) { wanted.add(req); changed = true; }
      });
    }

    wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (cb.checked && !wanted.has(cb.value)) { cb.checked = false; fireEvent(cb, 'change'); }
    });
    Array.from(wanted)
      .sort((a, b) => dependencyDepth(a, svcById) - dependencyDepth(b, svcById))
      .forEach((id) => {
        const cb = wrap.querySelector(`input[type="checkbox"][value="${id}"]`);
        if (cb && !cb.checked) { cb.checked = true; fireEvent(cb, 'change'); }
        if (qtyById.has(id)) {
          const qtyInput = wrap.querySelector(`.service-check-qty[data-qty-for="${id}"]`);
          if (qtyInput) { qtyInput.value = String(qtyById.get(id)); fireEvent(qtyInput, 'input'); }
        }
      });
  }

  async function wizardAddons(refs) {
    const f = await loadFacts();
    if (!f.services.length) return;
    await sendBotMessage('Want to add anything on top? Tick whatever you need.');
    await new Promise((resolve) => {
      const rows = f.services.map((s) => {
        const rate = s.price_type === 'hourly'
          ? `${peso(s.price)}/hr`
          : s.price_type === 'unit'
          ? `${peso(s.price)}/${s.unit_label || 'unit'}`
          : `${peso(s.price)} flat`;
        return `
          <label class="ggs-wizard-check">
            <input type="checkbox" data-w-svc="${s.id}">
            <span>${escapeHtml(s.name)}<em>${rate}</em></span>
            ${s.price_type === 'unit' ? `<input type="number" min="1" step="1" value="1" class="ggs-wizard-qty" data-w-qty="${s.id}" disabled>` : ''}
          </label>`;
      }).join('');
      const html = `${rows}<button type="button" class="ggs-wizard-btn" data-w-next>Continue</button>`;
      mountWizardBox(html, (box) => {
        box.querySelectorAll('[data-w-svc]').forEach((cb) => {
          cb.addEventListener('change', () => {
            const qty = box.querySelector(`[data-w-qty="${cb.dataset.wSvc}"]`);
            if (qty) qty.disabled = !cb.checked;
          });
        });
        box.querySelector('[data-w-next]').addEventListener('click', () => {
          const picked = Array.from(box.querySelectorAll('[data-w-svc]:checked')).map((cb) => {
            const qtyInput = box.querySelector(`[data-w-qty="${cb.dataset.wSvc}"]`);
            const qty = qtyInput ? Math.max(1, Math.floor(Number(qtyInput.value)) || 1) : 1;
            return { id: cb.dataset.wSvc, qty };
          });
          applyAddonsToForm(picked, f.services);
          lockWizardBox(box);
          const names = picked.map((p) => f.services.find((s) => s.id === p.id)?.name).filter(Boolean);
          addMessage('user', names.length ? names.join(', ') : 'No add-ons');
          resolve();
        });
      });
    });
  }

  async function wizardContact(refs) {
    if (refs.nameEl.value.trim() && refs.emailEl.value.trim()) return;
    await sendBotMessage('Who should I put this booking under?');
    await new Promise((resolve) => {
      const emailLocked = refs.emailEl.readOnly;
      const html = `
        <div class="ggs-wizard-row"><label>Name<input type="text" data-w-name value="${escapeHtml(refs.nameEl.value)}"></label></div>
        <div class="ggs-wizard-row"><label>Email<input type="email" data-w-email value="${escapeHtml(refs.emailEl.value)}" ${emailLocked ? 'disabled' : ''}></label></div>
        <p class="ggs-wizard-error" data-w-err hidden></p>
        <button type="button" class="ggs-wizard-btn" data-w-next>Continue</button>`;
      mountWizardBox(html, (box) => {
        box.querySelector('[data-w-next]').addEventListener('click', () => {
          const nameI = box.querySelector('[data-w-name]');
          const emailI = box.querySelector('[data-w-email]');
          const name = nameI.value.trim();
          const email = emailI.value.trim();
          if (!name) return showWizardError(box, 'Please enter a name.', nameI);
          if (!emailLocked && (!email || !email.includes('@'))) return showWizardError(box, 'Please enter a valid email.', emailI);

          refs.nameEl.value = name; fireEvent(refs.nameEl, 'input');
          if (!emailLocked) { refs.emailEl.value = email; fireEvent(refs.emailEl, 'input'); }

          lockWizardBox(box);
          addMessage('user', emailLocked ? name : `${name} · ${email}`);
          resolve();
        });
      });
    });
  }

  async function wizardPayment() {
    await sendBotMessage('How would you like to pay?');
    await new Promise((resolve) => {
      const cashAmt = document.querySelector('[data-pay-amount="cash"]')?.textContent || '—';
      const depAmt = document.querySelector('[data-pay-amount="deposit"]')?.textContent || '—';
      const fullAmt = document.querySelector('[data-pay-amount="full"]')?.textContent || '—';
      const html = `
        <label class="ggs-wizard-radio"><input type="radio" name="w-pay" value="cash" checked><span>Cash at the studio<em>${cashAmt}</em></span></label>
        <label class="ggs-wizard-radio"><input type="radio" name="w-pay" value="deposit"><span>Downpayment online<em>${depAmt}</em></span></label>
        <label class="ggs-wizard-radio"><input type="radio" name="w-pay" value="full"><span>Pay in full online<em>${fullAmt}</em></span></label>
        <button type="button" class="ggs-wizard-btn" data-w-next>Continue</button>`;
      mountWizardBox(html, (box) => {
        box.querySelector('[data-w-next]').addEventListener('click', () => {
          const choice = box.querySelector('input[name="w-pay"]:checked')?.value || 'cash';
          const radio = document.querySelector(`input[name="payOption"][value="${choice}"]`);
          if (radio) { radio.checked = true; fireEvent(radio, 'change'); }
          lockWizardBox(box);
          const label = choice === 'cash' ? 'Cash at the studio' : choice === 'deposit' ? 'Downpayment online' : 'Pay in full online';
          addMessage('user', label);
          resolve();
        });
      });
    });
  }

  async function wizardReview(refs) {
    const total = refs.sumPrice.textContent;
    const duration = refs.sumDuration.textContent;
    const payOption = document.querySelector('input[name="payOption"]:checked')?.value || 'cash';
    const staffNotice = document.getElementById('payStaffNotice');
    const isStaff = Boolean(staffNotice && !staffNotice.hidden);
    const needsId = payOption === 'cash' && !isStaff;

    await sendBotMessage(
      `Here's your session: ${duration}, total ${total}. `
      + (needsId
        ? 'Last thing — attach a photo of a valid ID to hold a cash slot, then I\'ll send it in.'
        : "I'll send this in for you now."),
    );

    await new Promise((resolve) => {
      const html = `
        ${needsId ? `
          <div class="ggs-wizard-row"><label>ID photo<input type="file" accept="image/png, image/jpeg, image/webp, image/heic" data-w-id></label></div>
          <p class="ggs-wizard-error" data-w-err hidden></p>` : ''}
        <button type="button" class="ggs-wizard-btn ggs-wizard-btn-gold" data-w-submit>Submit booking</button>`;
      mountWizardBox(html, (box) => {
        box.querySelector('[data-w-submit]').addEventListener('click', () => {
          if (needsId) {
            const idI = box.querySelector('[data-w-id]');
            const file = idI.files?.[0];
            if (!file) return showWizardError(box, 'Please attach a photo of your ID.', idI);
            const dt = new DataTransfer();
            dt.items.add(file);
            refs.idImageEl.files = dt.files;
            fireEvent(refs.idImageEl, 'change');
          }
          lockWizardBox(box);
          resolve();
        });
      });
    });

    refs.form.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    refs.form.requestSubmit();
    await sendBotMessage("Sent! Check just above the chat for the confirmation — or to finish anything the form still needs from you, like agreeing to the terms or signing in.");
    renderQuick(['mine', 'pay', 'book']);
  }

  async function startBookingWizard() {
    const refs = getFormRefs();
    if (!refs) {
      await sendBotMessage("I can walk you through booking on the home page — let's head there.", {
        actions: [{ label: 'Go to the booking form', href: 'index#book' }],
      });
      renderQuick(DEFAULT_QUICK);
      return;
    }
    try {
      await loadFacts();
      // Scroll to the real form right away, not just before the final submit —
      // watching it fill itself in as you answer is the whole point of doing
      // this through chat instead of typing straight into it.
      refs.form.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      await sendBotMessage("Let's get you booked — I've scrolled you to the form so you can watch it fill in as we go.");
      await wizardDateTime(refs);
      await wizardAddons(refs);
      await wizardContact(refs);
      await wizardPayment();
      await wizardReview(refs);
    } catch (err) {
      // Anything that goes wrong partway through used to just stop the
      // conversation dead with no explanation — whatever got filled in stays
      // filled in, so pointing at the form itself is a real fallback, not a
      // dead end.
      console.error('[chatbot] booking wizard failed:', err);
      await sendBotMessage(`Something went wrong while I was filling that out (${err?.message || 'unknown error'}). The form has whatever I'd already filled in — you can finish it there.`, {
        actions: [{ label: 'Go to the booking form', href: bookHref() }],
      });
      renderQuick(DEFAULT_QUICK);
    }
  }

  // === Cancel / reschedule ==================================================
  // Same idea as the booking wizard: no separate logic for what a cancellation
  // or a reschedule actually does. It calls the exact same cancel-booking and
  // update-booking Edge Functions the My Bookings page's own buttons call, so
  // the cutoff rule, the "no-shows aren't refunded" logic, and everything else
  // the server enforces is enforced here too — the chat is just another door.

  // `session` is null when the booking was made on this browser without an
  // account — the device credentials in the body are the authority then, and
  // the server applies exactly the same rules either way.
  async function callBookingFunction(name, session, body) {
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ ...deviceCredentials(), ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function describeBooking(b) {
    const s = new Date(b.start_at);
    return `${b.rooms?.name || 'session'} on ${s.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
  }

  // A lightweight yes/no, mounted the same way as any other wizard step.
  function wizardConfirm({ confirmLabel = 'Yes', cancelLabel = 'No, keep it' } = {}) {
    return new Promise((resolve) => {
      const html = `
        <div class="ggs-wizard-booking-actions" style="justify-content:flex-start;">
          <button type="button" class="ggs-wizard-btn ggs-wizard-btn-danger" data-w-yes>${confirmLabel}</button>
          <button type="button" class="ggs-wizard-btn" data-w-no>${cancelLabel}</button>
        </div>`;
      mountWizardBox(html, (box) => {
        box.querySelector('[data-w-yes]').addEventListener('click', () => { lockWizardBox(box); resolve(true); });
        box.querySelector('[data-w-no]').addEventListener('click', () => { lockWizardBox(box); resolve(false); });
      });
    });
  }

  async function handleCancelClick(b, session) {
    try {
      addMessage('user', `Cancel my ${describeBooking(b)}`);
      await sendBotMessage('Cancelling is free right now, but it cannot be undone. Go ahead?');
      const ok = await wizardConfirm({ confirmLabel: 'Yes, cancel it' });
      if (!ok) {
        await sendBotMessage("No problem — I've left it as it is.");
        renderQuick(['mine', 'book']);
        return;
      }
      await sendBotMessage('Cancelling it now…');
      try {
        await callBookingFunction('cancel-booking', session, { booking_id: b.id, reason: 'Cancelled via chat assistant' });
        await sendBotMessage('Done — that session is cancelled.');
      } catch (err) {
        await sendBotMessage(`I could not cancel it: ${err.message}`, { actions: [{ label: 'Try My Bookings', href: 'account' }] });
      }
      renderQuick(['mine', 'book']);
    } catch (err) {
      console.error('[chatbot] cancel flow failed:', err);
      await sendBotMessage(`Something went wrong (${err?.message || 'unknown error'}). Please try from My Bookings instead.`, {
        actions: [{ label: 'My bookings', href: 'account' }],
      });
      renderQuick(DEFAULT_QUICK);
    }
  }

  async function handleReschedClick(b, session, cutoffHours) {
    try {
      await handleReschedClickInner(b, session, cutoffHours);
    } catch (err) {
      console.error('[chatbot] reschedule flow failed:', err);
      await sendBotMessage(`Something went wrong (${err?.message || 'unknown error'}). Please try from My Bookings instead.`, {
        actions: [{ label: 'My bookings', href: 'account' }],
      });
      renderQuick(DEFAULT_QUICK);
    }
  }

  async function handleReschedClickInner(b, session, cutoffHours) {
    addMessage('user', `Reschedule my ${describeBooking(b)}`);
    const durationMs = new Date(b.end_at).getTime() - new Date(b.start_at).getTime();
    const startsAt = new Date(b.start_at);
    await sendBotMessage('Sure — pick a new date and start time. The session keeps its current length.');

    await new Promise((resolve, reject) => {
      const earliest = new Date(Date.now() + cutoffHours * 3600000);
      const html = `
        <div class="ggs-wizard-row">
          <label>New date<input type="date" data-w-date min="${earliest.toLocaleDateString('en-CA')}" value="${startsAt.toLocaleDateString('en-CA')}"></label>
        </div>
        <div class="ggs-wizard-row">
          <label>New start time<input type="time" step="1800" data-w-start value="${startsAt.toTimeString().slice(0, 5)}"></label>
        </div>
        <p class="ggs-wizard-error" data-w-err hidden></p>
        <button type="button" class="ggs-wizard-btn ggs-wizard-btn-gold" data-w-next>Save new time</button>`;
      mountWizardBox(html, (box) => {
        const nextBtn = box.querySelector('[data-w-next]');
        nextBtn.addEventListener('click', async () => {
          try {
            const dateI = box.querySelector('[data-w-date]');
            const startI = box.querySelector('[data-w-start]');
            if (!dateI.value) return showWizardError(box, 'Please pick a date.', dateI);
            if (!startI.value) return showWizardError(box, 'Please pick a start time.', startI);
            const newStart = new Date(`${dateI.value}T${startI.value}:00`);
            if (Number.isNaN(newStart.getTime())) return showWizardError(box, 'That date/time is not valid.', startI);
            if (newStart.getTime() - Date.now() < cutoffHours * 3600000) {
              return showWizardError(box, `New time must be at least ${cutoffHours} hours from now.`, startI);
            }
            const newEnd = new Date(newStart.getTime() + durationMs);

            nextBtn.disabled = true;
            nextBtn.textContent = 'Checking availability…';
            let ok = false;
            try {
              ok = await validateSlot(newStart, newEnd, box, { dateI, startI });
            } catch (err) {
              console.error('[chatbot] slot check failed:', err);
              showWizardError(box, 'Could not verify availability just now — please try again.');
            }
            nextBtn.disabled = false;
            nextBtn.textContent = 'Save new time';
            if (!ok) return;

            lockWizardBox(box);
            addMessage('user', `${fmtDateHuman(dateI.value)}, ${to12Hour(startI.value)}`);
            await sendBotMessage('Updating your booking…');
            try {
              await callBookingFunction('update-booking', session, {
                booking_id: b.id,
                start_at: newStart.toISOString(),
                end_at: newEnd.toISOString(),
              });
              await sendBotMessage("Done — your session has been moved.");
            } catch (err) {
              await sendBotMessage(`I could not reschedule it: ${err.message}`, { actions: [{ label: 'Try My Bookings', href: 'account' }] });
            }
            renderQuick(['mine', 'book']);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  }

  function mountBookingPicker(bookings, cutoffHours, session) {
    const rows = bookings.map((b) => {
      const start = new Date(b.start_at);
      const end = new Date(b.end_at);
      const hoursAway = (start.getTime() - Date.now()) / 3600000;
      const canChange = hoursAway >= cutoffHours;
      const when = `${start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}, `
        + `${start.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}–${end.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
      return `
        <div class="ggs-wizard-booking" data-w-booking="${b.id}">
          <div class="ggs-wizard-booking-info">
            <strong>${escapeHtml(b.rooms?.name || 'Room')}</strong>
            <span>${when} · ${peso(b.total_price)}</span>
            ${!canChange ? '<em>Inside the cutoff window — call the studio</em>' : ''}
          </div>
          ${canChange ? `
          <div class="ggs-wizard-booking-actions">
            <button type="button" class="ggs-wizard-btn" data-w-cancel="${b.id}">Cancel</button>
            <button type="button" class="ggs-wizard-btn" data-w-resched="${b.id}">Reschedule</button>
          </div>` : ''}
        </div>`;
    }).join('');
    mountWizardBox(rows, (box) => {
      box.querySelectorAll('[data-w-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const b = bookings.find((x) => x.id === btn.dataset.wCancel);
          lockWizardBox(box);
          handleCancelClick(b, session);
        });
      });
      box.querySelectorAll('[data-w-resched]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const b = bookings.find((x) => x.id === btn.dataset.wResched);
          lockWizardBox(box);
          handleReschedClick(b, session, cutoffHours);
        });
      });
    });
  }

  async function startManageBookings() {
    try {
      const sb = supabase || (await getSupabase());
      supabase = sb;
      const { data: sessionData } = await sb.auth.getSession();
      const session = sessionData?.session;
      const f = await loadFacts();

      // Signed in or not, the bot can act — a booking made without an account is
      // managed with this browser's device credentials instead of a session.
      let bookings = [];
      if (session) {
        const { data, error } = await sb
          .from('bookings')
          .select('id, start_at, end_at, status, total_price, rooms(name)')
          .eq('customer_id', session.user.id)
          .in('status', ['pending', 'confirmed'])
          .gte('start_at', new Date().toISOString())
          .order('start_at')
          .limit(5);
        if (error) {
          await sendBotMessage('I could not load your bookings just now.', { actions: [{ label: 'My bookings', href: 'account' }] });
          renderQuick(DEFAULT_QUICK);
          return;
        }
        bookings = data || [];
      } else {
        const guest = await fetchGuestBookings();
        bookings = guest.bookings
          .filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.start_at) >= new Date())
          .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
          .slice(0, 5);
      }

      // Nothing to act on — so answer the policy question that was actually
      // asked, which needs no account to explain.
      if (!bookings.length) {
        await sendBotMessage(
          `You can cancel or reschedule free of charge any time up to ${f.cutoffHours} hours before your session, `
          + `right here or from My Bookings. Inside that window it's phone-only: call the studio on +63 976 350 6301. `
          + `No-shows aren't refunded, so it's always worth telling us if you're running late.`
          + (session
            ? " You have no upcoming sessions at the moment, though."
            : " I can't see any sessions booked on this browser — if you booked on another device, sign in and I'll find them."),
          {
            actions: session
              ? [{ label: 'Book a session', href: bookHref() }]
              : [{ label: 'Sign in', href: 'login?next=account' }, { label: 'Book a session', href: bookHref() }],
          },
        );
        renderQuick(DEFAULT_QUICK);
        return;
      }

      await sendBotMessage(`You can cancel or reschedule free of charge up to ${f.cutoffHours} hours before a session. Here's what's coming up — pick one:`);
      mountBookingPicker(bookings, f.cutoffHours, session);
    } catch (err) {
      console.error('[chatbot] manage bookings failed:', err);
      await sendBotMessage(`Something went wrong (${err?.message || 'unknown error'}). Please try from My Bookings instead.`, {
        actions: [{ label: 'My bookings', href: 'account' }],
      });
      renderQuick(DEFAULT_QUICK);
    }
  }

  // --- Open / close -------------------------------------------------------
  let greeted = false;

  async function openPanel() {
    panel.hidden = false;
    root.classList.add('open', 'visible');
    launcher.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      await sendBotMessage("Hi! I'm the GGS Studio assistant. I can help with rates, booking, payments, and your own sessions. What do you need?");
      renderQuick(DEFAULT_QUICK);
      loadFacts();
    }
    setTimeout(() => input.focus({ preventScroll: true }), 120);
  }

  function closePanel() {
    panel.hidden = true;
    root.classList.remove('open');
    launcher.setAttribute('aria-expanded', 'false');
    syncVisible();
  }

  launcher.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  root.querySelector('[data-chat-close]').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handleTyped(text);
  });
}
