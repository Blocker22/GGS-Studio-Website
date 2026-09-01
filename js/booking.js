// Supabase-backed booking flow. Visually this is the original single-form
// layout (Name / Email / Service / Date / Start / End). Behind the scenes it
// talks to Postgres for live rates and to the create-booking Edge Function to
// place the booking.
//
// No account is required to book. Name and email are enough: the booking is
// owned by this browser, which proves itself with the device secret in
// device.js, and the visitor is offered an account afterwards — the point of
// which is that it survives clearing your browser and follows you to your
// phone. Signing in claims every booking made under the same email.
//
// The one place a password is still demanded up front is an email that already
// has an account. Booking anonymously in a registered customer's name is
// refused by create-booking, so the form asks them to sign in instead.
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { signUpChecked } from './auth.js';
import { openPaymentModal } from './payment-qr.js';
import { clearFormErrors, clearFieldError, showFieldErrors, setFieldError, isEmail } from './form-validate.js';
import { compressImageIfNeeded } from './image-compress.js';
import {
  claimGuestBookings,
  deviceCredentials,
  getDevice,
  lastGuestEmail,
  lastGuestName,
  rememberGuestBooking,
} from './device.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const EYE_OPEN = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

// Set by initTermsModal so the booking form can pop the terms open as a gate
// when someone hits Confirm without having agreed yet. No-op until then.
let openTermsModal = () => {};

// The full Terms & Conditions, shown in a modal whenever a [data-terms-toggle]
// control is clicked. Built once on demand and reused; Escape and the backdrop
// both close it.
//
// It has two modes. Read-only (the default) is just the text. Gate mode adds an
// agree checkbox and a continue button at the bottom, and is what the booking
// form opens when the terms haven't been accepted yet — so the terms are put in
// front of you at the moment you're actually asked to accept them, rather than
// leaving you hunting for a checkbox you skipped.
export function initTermsModal() {
  if (document.getElementById('termsModal')) return;

  const modal = document.createElement('div');
  modal.id = 'termsModal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal terms-modal" role="dialog" aria-modal="true" aria-labelledby="termsModalTitle">
      <button type="button" class="modal-close" data-terms-close aria-label="Close">&times;</button>
      <h3 id="termsModalTitle">Terms &amp; Conditions</h3>
      <div class="modal-body">
        <h4>Booking &amp; Confirmation</h4>
        <ul>
          <li>Your booking is confirmed the moment you complete it. Slots are held on a first-come, first-served basis, and we'll only reach out if there's an issue with your booking.</li>
          <li>No account is needed to book — your name and email are enough. The browser you booked from is what lets you view, reschedule, or cancel that booking afterwards, so clearing its site data means losing that access. Creating an account (any time, including after you book) keeps your bookings reachable from any device.</li>
          <li>If the email address you enter already belongs to a GGS Studio account, you'll be asked to sign in before the booking goes through. This is to stop anyone from booking in someone else's name.</li>
          <li>Sessions start and end at the booked times. Please arrive on time — late arrivals do not extend the session.</li>
          <li>The person booking is responsible for everyone they bring and for the conduct of their group for the duration of the session.</li>
        </ul>

        <h4>Payment</h4>
        <ul>
          <li>Cash bookings require a photo of a valid ID to hold the slot; payment is settled at the studio.</li>
          <li>Online payments are made by transferring to one of GGS Studio's official GCash, GoTyme, or BPI QR codes, then uploading the receipt through this site.</li>
          <li>An online booking stays on hold until the studio has checked the receipt against the receiving account. Once verified, the booking is confirmed; if the receipt can't be verified, you'll be told why and can send a corrected one.</li>
          <li>Online downpayments are the percentage shown on the booking form, with the balance due at the studio on the day of the session. Full online payments settle the entire session upfront.</li>
          <li>Only pay to the QR codes shown on this site. GGS Studio will never ask you to send payment to a different account by message or call.</li>
        </ul>

        <h4>Overtime</h4>
        <ul>
          <li>Staying past your booked end time is charged as overtime at the studio's regular hourly rate (including any add-on services you booked), rounded up to the next hour or fraction thereof.</li>
          <li>Overtime is subject to availability — if another booking follows yours, the session must end on time and overtime may not be possible.</li>
          <li>All overtime charges are payable before leaving the studio.</li>
        </ul>

        <h4>Cancellation &amp; Rescheduling</h4>
        <ul>
          <li>Bookings can be cancelled or rescheduled free of charge any time <strong>up to 24 hours before your booked start time</strong>, either online through My Bookings or by contacting the studio.</li>
          <li>Within the final 24 hours before the session, cancellations and reschedules are no longer available online — call the studio and we'll do our best to work something out.</li>
          <li>If GGS Studio cancels or cannot honour your booking, any amount paid will be refunded in full or credited toward a new schedule, at your choice.</li>
        </ul>

        <h4>No-Shows</h4>
        <ul>
          <li>If you do not arrive within 30 minutes of your booked start time without notice, the booking is treated as a no-show.</li>
          <li><strong>No-show bookings are not refunded.</strong> Any amounts already paid — deposits, full payments, or the session fee — are forfeited, and the slot is released.</li>
          <li>Running late? Call ahead. With notice we'll hold your slot for the remainder of the booked time (the session still ends at the original end time).</li>
        </ul>

        <h4>Studio Rules &amp; Equipment Care</h4>
        <ul>
          <li>Treat the equipment and the room with care. Instruments, consoles, microphones, and cables are to be used only for their intended purpose and handled by or under the supervision of your group.</li>
          <li>Food and drinks stay away from the equipment and the mixing console.</li>
          <li>Smoking, vaping, alcohol, and illegal substances are prohibited on the premises.</li>
          <li>Any damage to studio equipment, furniture, or the room caused by misuse, negligence, or rough handling will be charged to the person who made the booking at repair or replacement cost, whichever applies.</li>
          <li>GGS Studio reserves the right to end a session immediately, without refund, for conduct that endangers people or equipment.</li>
        </ul>

        <h4>Belongings &amp; Files</h4>
        <ul>
          <li>GGS Studio is not liable for personal belongings left behind or lost on the premises.</li>
          <li>Back up your recordings and files before leaving — GGS Studio is not responsible for lost or corrupted files once your session ends.</li>
        </ul>

        <h4>Data &amp; Privacy</h4>
        <ul>
          <li>Your name, email, ID photo, and payment receipts are collected solely to manage your booking and payment, and are handled in accordance with the Data Privacy Act (RA 10173). They are stored in private, access-controlled storage readable only by you and GGS Studio staff, and are never sold or shared beyond what is needed to process your booking.</li>
          <li>Booking without an account stores a random identifier and a random key in your browser. They are not linked to any advertising, are never shared with anyone, and exist only so this browser can prove that a booking is yours. Clearing your browser data erases them, and with them your access to those bookings.</li>
          <li>Our <a href="privacy" target="_blank" rel="noopener">Privacy Policy</a> sets out in full what we collect, why, who processes it on our behalf, how long we keep it, and the rights you have over it. It forms part of these terms.</li>
          <li>You can delete your account at any time from your Profile page. Doing so erases your login, personal details, ID photos, and receipts; past sessions remain in the studio's books as anonymised walk-in bookings, because we are required to keep those financial records.</li>
        </ul>

        <h4>Site Assistant</h4>
        <ul>
          <li>The chat assistant on this site is an automated tool provided for convenience. Most of its answers are drawn directly from our published rates and policies; more open-ended questions are answered with the help of a third-party AI provider, as described in the Privacy Policy.</li>
          <li>Its replies are informational only and are <strong>not a binding quotation or confirmation</strong>. The price shown on the booking form at the moment you book, and these Terms &amp; Conditions, are what govern your session. Where the assistant and this page disagree, this page wins.</li>
          <li>The assistant cannot make, change, cancel, or take payment for a booking — only you can, through the booking form and the My Bookings page.</li>
          <li>Please don't type passwords, card numbers, or other sensitive details into the chat. Misusing the assistant — for spam, abuse, or anything unrelated to the studio — may lead to it being withdrawn.</li>
        </ul>

        <h4>Consumer Rights</h4>
        <ul>
          <li>Nothing in these terms limits your rights under Philippine consumer law, including the Consumer Act of the Philippines (RA 7394) and the Data Privacy Act (RA 10173).</li>
          <li>You are entitled to services that match what was advertised and booked. If a session materially falls short of what was promised, contact us — we will work with you in good faith toward a fair resolution, which may include a partial or full refund or a replacement session.</li>
          <li>These terms do not remove your right to raise concerns with the Department of Trade and Industry (DTI) or other appropriate agencies.</li>
          <li>Questions, complaints, or refund requests? Reach us through the contact details on this site and we'll respond promptly.</li>
        </ul>
      </div>
      <div class="modal-foot" data-terms-gate hidden>
        <label class="terms-check">
          <input type="checkbox" data-terms-agree>
          <span>I have read and agree to the Terms &amp; Conditions above, including the cancellation and no-refund policies.</span>
        </label>
        <button type="button" class="btn-primary" data-terms-continue disabled>Agree &amp; continue</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const gate = modal.querySelector('[data-terms-gate]');
  const agreeBox = modal.querySelector('[data-terms-agree]');
  const continueBtn = modal.querySelector('[data-terms-continue]');
  let onAgree = null;
  let lastFocus = null;

  function open({ requireAgreement = false, onAgree: cb = null } = {}) {
    onAgree = requireAgreement ? cb : null;
    gate.hidden = !requireAgreement;
    agreeBox.checked = false;
    continueBtn.disabled = true;
    lastFocus = document.activeElement;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    // In gate mode the point of opening is the decision at the bottom, so send
    // focus there instead of to the close button.
    (requireAgreement ? agreeBox : modal.querySelector('[data-terms-close]')).focus();
  }
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    onAgree = null;
    lastFocus?.focus?.();
  }
  openTermsModal = open;

  agreeBox.addEventListener('change', () => {
    continueBtn.disabled = !agreeBox.checked;
  });
  continueBtn.addEventListener('click', () => {
    if (!agreeBox.checked) return;
    const cb = onAgree;
    close();
    cb?.();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-terms-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
  document.querySelectorAll('[data-terms-toggle]').forEach((btn) => btn.addEventListener('click', () => open()));
}

export function initPasswordToggles() {
  document.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    const input = document.getElementById(btn.dataset.pwToggle);
    if (!input) return;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.querySelector('svg').innerHTML = show ? EYE_OFF : EYE_OPEN;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

function formatPeso(amount) {
  return '₱' + Math.round(amount).toLocaleString('en-PH');
}

// Swaps a figure in with a short bump instead of the digits blinking to a new
// value. Re-triggering needs the class off for a reflow, hence the offsetWidth.
function setFigure(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function to12Hour(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

// `session` may be null — that's a guest call, authorised by the device
// credentials that ride along in every body instead of by a bearer token.
// The Edge Function decides which of the two it got; nothing here assumes.
async function callFunction(name, session, body) {
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
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.code = data.code || null;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function initBooking() {
  initPasswordToggles();
  const supabase = await getSupabase();

  const form = document.getElementById('bookingForm');
  const nameEl = document.getElementById('fName');
  const emailEl = document.getElementById('fEmail');
  const servicesWrap = document.getElementById('fServices');
  const dateEl = document.getElementById('fDate');
  const startEl = document.getElementById('fStart');
  const endEl = document.getElementById('fEnd');
  const sumDuration = document.getElementById('sumDuration');
  const sumPrice = document.getElementById('sumPrice');
  const submitBtn = document.getElementById('bookSubmitBtn');
  const confirmMsg = document.getElementById('confirmMsg');
  const payOptionEls = Array.from(document.querySelectorAll('input[name="payOption"]'));
  const termsEl = document.getElementById('fTerms');
  initTermsModal();
  const payOptions = document.getElementById('payOptions');
  const payIdUpload = document.getElementById('payIdUpload');
  const idImageEl = document.getElementById('fIdImage');
  const idImageHint = idImageEl?.closest('.pay-id-upload')?.querySelector('.field-hint') || null;
  const idImageHintDefault = idImageHint?.textContent || '';

  // Compress as soon as a photo is picked, not at submit time — the result
  // (or a clear "still too large" message) shows up immediately instead of
  // only surfacing after the customer has filled out the rest of the form.
  idImageEl?.addEventListener('change', async () => {
    const file = idImageEl.files?.[0];
    if (!file) return;
    clearFieldError(idImageEl);
    if (file.size <= 2 * 1024 * 1024) return;
    if (idImageHint) idImageHint.textContent = 'Compressing photo…';
    const compressed = await compressImageIfNeeded(file);
    if (compressed !== file) {
      const dt = new DataTransfer();
      dt.items.add(compressed);
      idImageEl.files = dt.files;
    }
    if (idImageHint) idImageHint.textContent = idImageHintDefault;
  });
  const payDepositPct = document.getElementById('payDepositPct');

  const authSignedIn = document.getElementById('authSignedIn');
  const authWho = document.getElementById('authWho');
  const authStep = document.getElementById('authStep');
  const authStepNote = document.getElementById('authStepNote');
  const authPassword = document.getElementById('authPassword');
  const authMsg = document.getElementById('authMsg');
  const authToggleRow = document.getElementById('authToggleRow');
  // Kept in the markup but never shown any more: the auth step only ever means
  // "this email is taken", and there is no sign-up alternative to toggle to.
  const authToggleBtn = document.getElementById('authToggleBtn');
  if (authToggleBtn) authToggleBtn.hidden = true;

  let session = null;
  let mainRoom = null;
  let addonServices = [];
  let depositPercent = 20;
  // Non-null only while the "this email has an account" password step is up.
  let awaitingAuthMode = null; // 'login' | null
  let isStaff = false;

  async function refreshAuthUI() {
    if (session) {
      if (authSignedIn) {
        authSignedIn.style.display = 'flex';
        authWho.textContent = `Booking as ${session.user.email}`;
      }
      // Fill the account's details in rather than blanking the fields out —
      // a disabled empty Name was making the form impossible to submit.
      emailEl.value = session.user.email || '';
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', session.user.id)
        .single();
      isStaff = profile?.role === 'staff' || profile?.role === 'admin';
      if (!nameEl.value.trim()) {
        nameEl.value = profile?.full_name || session.user.user_metadata?.full_name || '';
      }
      nameEl.readOnly = false;
      emailEl.readOnly = true;
      hideAuthStep();
    } else {
      if (authSignedIn) authSignedIn.style.display = 'none';
      emailEl.readOnly = false;
      isStaff = false;
      // Someone who has booked here before as a guest shouldn't have to retype
      // the details their earlier bookings are filed under.
      if (!emailEl.value.trim()) emailEl.value = lastGuestEmail() || '';
      if (!nameEl.value.trim()) nameEl.value = lastGuestName() || '';
    }
    refreshPayOptions();
  }

  function hideAuthStep() {
    authStep.style.display = 'none';
    authToggleRow.style.display = 'none';
    authPassword.value = '';
    clearFieldError(authPassword);
    authMsg.textContent = '';
    authMsg.classList.remove('error');
    authMsg.style.display = 'none';
    awaitingAuthMode = null;
    submitBtn.textContent = 'Confirm booking request';
  }

  // Only ever 'login' now. Booking itself needs no account; this step appears
  // solely because the email typed in belongs to one, and letting an anonymous
  // visitor book in a registered customer's name is the fraud we're preventing.
  function showAuthStep(note) {
    awaitingAuthMode = 'login';
    clearFieldError(authPassword);
    authStep.style.display = 'block';
    // There's no "create an account instead" alternative here — that address is
    // already taken, which is the entire reason we're asking.
    authToggleRow.style.display = 'none';
    authStepNote.textContent =
      note ||
      'That email already has a GGS Studio account. Enter its password to confirm this booking, ' +
        'or use a different email address.';
    submitBtn.textContent = 'Log in & confirm booking';
    authPassword.focus();
  }

  // Typing a different address is the other way out of the login step, so drop
  // back to plain guest booking as soon as the email changes.
  emailEl.addEventListener('input', () => {
    if (awaitingAuthMode && !session) hideAuthStep();
  });

  supabase.auth.getSession().then(({ data }) => {
    session = data.session;
    refreshAuthUI();
  });
  supabase.auth.onAuthStateChange((_event, s) => {
    session = s;
    // Deferred: querying Supabase from inside this callback can deadlock the
    // auth lock, and refreshAuthUI reads the profiles table.
    setTimeout(refreshAuthUI, 0);
  });

  async function loadRates() {
    const [{ data: rooms }, { data: services }, { data: settings }] = await Promise.all([
      supabase.from('rooms').select('*').eq('is_active', true).order('created_at').limit(1),
      supabase.from('services').select('*').eq('is_active', true),
      supabase.from('app_settings').select('key, value').eq('key', 'deposit_percent'),
    ]);
    const pct = Number(settings?.[0]?.value);
    if (Number.isFinite(pct) && pct > 0) depositPercent = pct;
    if (payDepositPct) payDepositPct.textContent = String(depositPercent);
    mainRoom = rooms?.[0] || null;
    addonServices = (services || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    renderServiceChecks();
  }

  function priceLabel(svc) {
    if (svc.price_type === 'hourly') return `+ ${formatPeso(svc.price)} / hr`;
    if (svc.price_type === 'unit') return `+ ${formatPeso(svc.price)} / ${svc.unit_label || 'unit'}`;
    return `+ ${formatPeso(svc.price)} flat`;
  }

  // The add-on list is whatever the `services` table currently holds, so a
  // service added in the admin panel appears here on the next page load with
  // no change needed in this file.
  function renderServiceChecks() {
    if (!servicesWrap) return;
    servicesWrap.innerHTML = '';
    if (addonServices.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No add-ons available right now — the room rate covers your session.';
      servicesWrap.appendChild(empty);
      return;
    }
    addonServices.forEach((svc) => {
      const wrap = document.createElement('div');
      wrap.className = 'service-check-wrap';

      const label = document.createElement('label');
      label.className = 'service-check';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = svc.id;
      cb.dataset.slug = svc.slug;
      cb.addEventListener('change', () => {
        if (expand) {
          expand.classList.toggle('open', cb.checked);
          // A freshly-revealed quantity field should read as "unset" rather
          // than carry over whatever was left from the last time this same
          // add-on was checked.
          if (cb.checked && qtyInput) qtyInput.focus({ preventScroll: true });
        }
        syncServiceDeps();
        updateSummary();
      });

      // 'unit' pricing (e.g. per song/per track) needs a quantity, so
      // checking the box reveals a small panel asking for it — rather than
      // cramming a number field into the row itself — and the price is
      // priced against whatever's typed there instead of a flat/hourly rate.
      let expand = null;
      let qtyInput = null;
      if (svc.price_type === 'unit') {
        const unitWord = svc.unit_label || 'unit';
        expand = document.createElement('div');
        expand.className = 'service-check-expand';

        const qtyLabel = document.createElement('span');
        qtyLabel.className = 'service-check-qty-label';
        qtyLabel.textContent = `How many ${unitWord}s?`;

        qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.className = 'service-check-qty';
        qtyInput.min = '1';
        qtyInput.step = '1';
        qtyInput.value = '1';
        qtyInput.dataset.qtyFor = svc.id;
        qtyInput.setAttribute('aria-label', `Number of ${unitWord}s for ${svc.name}`);
        // Zero (or blank, or negative) buys nothing, so it's not a valid
        // quantity — snap back to 1 as soon as the field stops being edited
        // rather than silently pricing it as zero.
        qtyInput.addEventListener('blur', () => {
          const n = Math.floor(Number(qtyInput.value));
          qtyInput.value = String(Number.isFinite(n) && n >= 1 ? n : 1);
          updateSummary();
        });
        qtyInput.addEventListener('input', updateSummary);

        expand.append(qtyLabel, qtyInput);
      }

      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

      const name = document.createElement('span');
      name.className = 'service-check-name';
      name.textContent = svc.name;

      const note = document.createElement('span');
      note.className = 'service-check-note';
      note.dataset.baseNote = svc.description || '';
      note.textContent = note.dataset.baseNote;

      const body = document.createElement('span');
      body.className = 'service-check-body';
      body.append(name, note);

      const price = document.createElement('span');
      price.className = 'service-check-price';
      price.textContent = priceLabel(svc);

      label.append(cb, tick, body, price);
      wrap.append(label);
      if (expand) wrap.append(expand);
      servicesWrap.appendChild(wrap);
    });
    syncServiceDeps();
  }

  function serviceCheckboxes() {
    return servicesWrap ? Array.from(servicesWrap.querySelectorAll('input[type="checkbox"]')) : [];
  }

  // A service can name a prerequisite (services.requires_service_id, set in the
  // admin panel) — e.g. Mixing requires Recording. A service whose prerequisite
  // is not picked stays locked and unchecked. Nothing here names a specific
  // service; the rule lives entirely in the data.
  //
  // Runs to a fixed point so chains settle in one call: unchecking A locks B,
  // which must then also lock whatever required B.
  function syncServiceDeps() {
    const boxes = serviceCheckboxes();
    const boxById = new Map(boxes.map((c) => [c.value, c]));
    const svcById = new Map(addonServices.map((s) => [s.id, s]));

    for (let pass = 0; pass <= boxes.length; pass++) {
      let changed = false;
      boxes.forEach((cb) => {
        const requiredId = svcById.get(cb.value)?.requires_service_id || null;
        const requiredBox = requiredId ? boxById.get(requiredId) : null;
        // A prerequisite that isn't offered at all (inactive, or deleted) locks
        // its dependants rather than silently letting them through.
        const locked = Boolean(requiredId) && (!requiredBox || !requiredBox.checked || requiredBox.disabled);
        if (cb.disabled !== locked) {
          cb.disabled = locked;
          changed = true;
        }
        if (locked && cb.checked) {
          cb.checked = false;
          changed = true;
        }
      });
      if (!changed) break;
    }

    // Say why a locked row can't be picked, in place of its description.
    boxes.forEach((cb) => {
      const row = cb.closest('.service-check');
      const expand = row?.parentElement.querySelector('.service-check-expand');
      if (expand) expand.classList.toggle('open', cb.checked);
      const note = row?.querySelector('.service-check-note');
      if (!note) return;
      const requiredId = svcById.get(cb.value)?.requires_service_id || null;
      const requiredName = requiredId ? svcById.get(requiredId)?.name : null;
      if (cb.disabled) {
        note.textContent = requiredName
          ? `Add ${requiredName} first — this can't be booked on its own.`
          : "This add-on isn't available on its own right now.";
      } else {
        note.textContent = note.dataset.baseNote || '';
      }
      note.hidden = !note.textContent;
    });
  }

  function addonServiceIds() {
    return serviceCheckboxes().filter((c) => c.checked && !c.disabled).map((c) => c.value);
  }

  // For a 'unit' service, how many the customer set in its quantity input
  // (defaults to 1 if the field can't be found for some reason).
  function serviceQuantity(serviceId) {
    const input = servicesWrap?.querySelector(`.service-check-qty[data-qty-for="${serviceId}"]`);
    const n = input ? Math.floor(Number(input.value)) : 1;
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  // "Room only" when nothing extra is picked — the confirmation line still has
  // to name what was booked.
  function selectedServiceLabel() {
    const picked = new Set(addonServiceIds());
    const names = addonServices
      .filter((s) => picked.has(s.id))
      .map((s) => (s.price_type === 'unit' ? `${s.name} (${serviceQuantity(s.id)} ${s.unit_label || 'unit'})` : s.name));
    return names.length ? `Room + ${names.join(' + ')}` : 'Room only';
  }

  function addonTotal(durationHours) {
    const picked = new Set(addonServiceIds());
    return addonServices.reduce((sum, svc) => {
      if (!picked.has(svc.id)) return sum;
      if (svc.price_type === 'hourly') return sum + Number(svc.price) * durationHours;
      if (svc.price_type === 'unit') return sum + Number(svc.price) * serviceQuantity(svc.id);
      return sum + Number(svc.price);
    }, 0);
  }

  // Returns the session total in pesos, or null when the form isn't complete
  // enough to price yet. Shared by the summary and the payment options.
  function currentTotal() {
    if (!mainRoom || !startEl.value || !endEl.value) return null;
    const [sh, sm] = startEl.value.split(':').map(Number);
    const [eh, em] = endEl.value.split(':').map(Number);
    const rawDuration = (eh * 60 + em - (sh * 60 + sm)) / 60;
    if (rawDuration <= 0) return null;
    const duration = Math.ceil(rawDuration * 10) / 10;
    return Math.ceil(Number(mainRoom.hourly_rate) * duration + addonTotal(duration));
  }

  function updateSummary() {
    document.getElementById('bookingSummary').classList.remove('ready');
    if (!mainRoom || !startEl.value || !endEl.value) {
      setFigure(sumDuration, '—');
      setFigure(sumPrice, '—');
      refreshPayOptions();
      return;
    }
    const [sh, sm] = startEl.value.split(':').map(Number);
    const [eh, em] = endEl.value.split(':').map(Number);
    const rawDuration = (eh * 60 + em - (sh * 60 + sm)) / 60;
    if (rawDuration <= 0) {
      setFigure(sumDuration, 'End must be after start');
      setFigure(sumPrice, '—');
      refreshPayOptions();
      return;
    }
    const duration = Math.ceil(rawDuration * 10) / 10;
    const price = Math.ceil(Number(mainRoom.hourly_rate) * duration + addonTotal(duration));
    setFigure(sumDuration, `${duration} hr${duration !== 1 ? 's' : ''}`);
    setFigure(sumPrice, formatPeso(price));
    document.getElementById('bookingSummary').classList.add('ready');
    refreshPayOptions();
  }

  // Can't book yesterday — let the native picker enforce it.
  dateEl.min = new Date().toLocaleDateString('en-CA');

  function selectedPayOption() {
    return payOptionEls.find((r) => r.checked)?.value || 'cash';
  }

  // create-booking treats anything a staff/admin account books as an in-person
  // job: forced to cash, no ID needed, confirmed on the spot. That's deliberate
  // for walk-ins, but silently overriding the choice made on this form looks
  // like the payment step is broken — so say it out loud instead.
  function refreshStaffNotice() {
    if (!payOptions) return;
    let note = document.getElementById('payStaffNotice');
    if (!note) {
      note = document.createElement('p');
      note.id = 'payStaffNotice';
      note.className = 'pay-staff-notice';
      payOptions.appendChild(note);
    }
    note.hidden = !isStaff;
    note.textContent =
      "You're signed in as studio staff, so this booking will be recorded as an in-person cash booking and confirmed immediately — " +
      'no ID upload and no online payment step. Use a customer account to test the customer flow.';
  }

  function refreshPayOptions() {
    const option = selectedPayOption();
    refreshStaffNotice();
    // The ID photo is only asked for on the cash route, and never for staff —
    // the server skips the check for them too.
    if (payIdUpload) payIdUpload.classList.toggle('show', option === 'cash' && !isStaff);

    // Show what each route would actually charge today.
    const total = currentTotal();
    document.querySelectorAll('[data-pay-amount]').forEach((cell) => {
      const kind = cell.dataset.payAmount;
      if (total == null) { setFigure(cell, '—'); return; }
      if (kind === 'cash') setFigure(cell, formatPeso(0) + ' now');
      else if (kind === 'deposit') setFigure(cell, formatPeso(Math.ceil((total * depositPercent) / 100)) + ' now');
      else setFigure(cell, formatPeso(total) + ' now');
    });
  }

  payOptionEls.forEach((r) => r.addEventListener('change', refreshPayOptions));

  [startEl, endEl].forEach((el) => el.addEventListener('input', updateSummary));

  // Every problem with the form, as [control, reason] pairs, so the whole
  // form can be marked up in one pass instead of surfacing one complaint at a
  // time. Order matters only in that the first entry is the one focused.
  function collectBookingErrors() {
    const errors = [];
    if (!nameEl.value.trim()) errors.push([nameEl, 'Please enter your name.']);

    if (!emailEl.value.trim()) errors.push([emailEl, 'Please enter your email.']);
    else if (!isEmail(emailEl.value)) errors.push([emailEl, "That doesn't look like an email address — check for a typo."]);

    if (!dateEl.value) errors.push([dateEl, 'Please choose a date.']);
    else if (dateEl.min && dateEl.value < dateEl.min) errors.push([dateEl, 'That date has already passed — pick today or later.']);

    if (!startEl.value) errors.push([startEl, 'Please choose a start time.']);
    if (!endEl.value) errors.push([endEl, 'Please choose an end time.']);
    if (startEl.value && endEl.value) {
      const [sh, sm] = startEl.value.split(':').map(Number);
      const [eh, em] = endEl.value.split(':').map(Number);
      if (eh * 60 + em <= sh * 60 + sm) errors.push([endEl, 'End time must be later than the start time.']);
    }

    if (!isStaff && selectedPayOption() === 'cash' && idImageEl) {
      const file = idImageEl.files?.[0];
      if (!file) errors.push([idImageEl, 'Please attach a photo of a valid ID to pay in cash.']);
    }

    if (termsEl && !termsEl.checked) {
      errors.push([termsEl, 'Please agree to the Terms & Conditions to confirm your booking.']);
    }
    return errors;
  }

  // Uploads the valid ID into the caller's own folder in the private
  // customer-ids bucket and returns the stored path. Signed-in customers own
  // <user id>/…; a guest browser owns guest/<device id>/…. Storage RLS lets
  // either write only into its own folder, and nobody but studio staff (or the
  // owning customer) read anything back — anonymous callers have no read at all.
  async function uploadIdImage(userId) {
    let file = idImageEl?.files?.[0];
    if (!file) throw new Error('Please attach a photo of a valid ID to pay in cash.');
    // Belt-and-suspenders: the change handler above already compresses on
    // selection, but this covers a file assigned any other way (browser
    // autofill, a script, a future code path) reaching submit uncompressed.
    file = await compressImageIfNeeded(file);

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const folder = userId ? userId : `guest/${getDevice().id}`;
    const path = `${folder}/${Date.now()}.${ext || 'jpg'}`;
    const { error } = await supabase.storage.from('customer-ids').upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) throw new Error(`Could not upload your ID: ${error.message}`);
    return path;
  }

  // Offered once a guest booking has gone through, never before it. The pitch
  // has to be honest about what an account actually buys: this booking is
  // already made and this browser can already manage it — an account is what
  // keeps it reachable after you clear your browser, and what puts it on your
  // phone too. Declining costs the visitor nothing.
  let saveOffer = null;
  function showSaveAccountOffer(booking) {
    const email = booking?.guest_email || emailEl.value.trim();
    const name = booking?.guest_name || nameEl.value.trim();
    if (!email) return;

    if (!saveOffer) {
      saveOffer = document.createElement('div');
      saveOffer.className = 'auth-step save-account-offer';
      saveOffer.innerHTML = `
        <p class="auth-step-note">
          <strong>Want to keep track of your bookings?</strong>
          This browser remembers what you booked, but that's all it is — one browser.
          Pick a password and you'll be able to see and change your sessions from any device,
          and we'll pull in everything you've ever booked with this email.
        </p>
        <div class="field">
          <label>Password <span class="label-note">optional — at least 6 characters</span></label>
          <div class="pw-wrap">
            <input type="password" data-save-pw placeholder="••••••••" minlength="6" autocomplete="new-password">
            <button type="button" class="pw-toggle" data-save-pw-toggle aria-label="Show password">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EYE_OPEN}</svg>
            </button>
          </div>
        </div>
        <div class="save-account-actions">
          <button type="button" class="btn-primary" data-save-go>Create my account</button>
          <button type="button" class="btn-ghost" data-save-skip>No thanks</button>
        </div>
        <div class="confirm-msg" data-save-msg></div>`;
      confirmMsg.insertAdjacentElement('afterend', saveOffer);

      const pw = saveOffer.querySelector('[data-save-pw]');
      const msg = saveOffer.querySelector('[data-save-msg]');
      const goBtn = saveOffer.querySelector('[data-save-go]');

      // This panel is built after initPasswordToggles() has already run, so its
      // eye button is wired here rather than being picked up by that sweep.
      saveOffer.querySelector('[data-save-pw-toggle]').addEventListener('click', (ev) => {
        const btn = ev.currentTarget;
        const show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        btn.querySelector('svg').innerHTML = show ? EYE_OFF : EYE_OPEN;
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });

      saveOffer.querySelector('[data-save-skip]').addEventListener('click', () => {
        saveOffer.style.display = 'none';
      });

      goBtn.addEventListener('click', async () => {
        const password = pw.value;
        msg.classList.remove('error');
        msg.style.display = 'none';
        if (password.length < 6) {
          msg.textContent = '⚠ Please choose a password of at least 6 characters.';
          msg.classList.add('error');
          msg.style.display = 'block';
          pw.focus();
          return;
        }
        goBtn.disabled = true;
        goBtn.textContent = 'Creating…';
        try {
          const result = await signUpChecked(supabase, saveOffer.dataset.email, password, saveOffer.dataset.name);
          const newSession = result.session;
          if (!newSession) {
            // Email confirmation is switched on: the account exists but can't
            // claim anything until the address is confirmed.
            msg.textContent =
              'Almost there — check your email (and spam/junk folder) to confirm your account. Your booking is safe either way, ' +
              'and it will appear under My Bookings once you confirm.';
            msg.style.display = 'block';
            goBtn.disabled = true;
            goBtn.textContent = 'Check your email';
            return;
          }
          session = newSession;
          const claim = await claimGuestBookings(newSession);
          msg.textContent =
            claim.claimed > 0
              ? `✓ Account created — ${claim.claimed} booking${claim.claimed === 1 ? '' : 's'} moved into it. ` +
                'You can see them under My Bookings from any device now.'
              : '✓ Account created. Your bookings will show up under My Bookings.';
          msg.style.display = 'block';
          saveOffer.querySelector('.field').style.display = 'none';
          saveOffer.querySelector('.save-account-actions').style.display = 'none';
          await refreshAuthUI();
        } catch (err) {
          msg.textContent = `⚠ ${err.message}`;
          msg.classList.add('error');
          msg.style.display = 'block';
          goBtn.disabled = false;
          goBtn.textContent = 'Create my account';
        }
      });
    }

    // form.reset() has already wiped the fields by the time this runs, so the
    // details are carried on the panel itself rather than re-read from the form.
    saveOffer.dataset.email = email;
    saveOffer.dataset.name = name;
    saveOffer.style.display = 'block';
    const pw = saveOffer.querySelector('[data-save-pw]');
    const msg = saveOffer.querySelector('[data-save-msg]');
    const goBtn = saveOffer.querySelector('[data-save-go]');
    pw.value = '';
    msg.textContent = '';
    msg.style.display = 'none';
    msg.classList.remove('error');
    goBtn.disabled = false;
    goBtn.textContent = 'Create my account';
    saveOffer.querySelector('.field').style.display = '';
    saveOffer.querySelector('.save-account-actions').style.display = '';
  }

  function hideSaveAccountOffer() {
    if (saveOffer) saveOffer.style.display = 'none';
  }

  async function placeBooking() {
    const startAt = new Date(`${dateEl.value}T${startEl.value}:00`);
    const endAt = new Date(`${dateEl.value}T${endEl.value}:00`);

    // Re-read rather than trusting the cached copy: a session could have been
    // established (or expired) since the page loaded. A null session here is
    // perfectly normal — it just means this is a guest booking.
    const { data: sessionData } = await supabase.auth.getSession();
    session = sessionData.session;

    const payOption = selectedPayOption();
    const payload = {
      room_id: mainRoom.id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      service_ids: addonServiceIds(),
      service_quantities: Object.fromEntries(addonServiceIds().map((id) => [id, serviceQuantity(id)])),
      payment_option: payOption,
      // Ignored by the server when a session is present; the name and email on
      // an account's booking come from the account.
      guest_name: nameEl.value.trim(),
      guest_email: emailEl.value.trim(),
      // The full directory URL, not just the origin — this project's GitHub
      // Pages site lives under a subpath (/GGS-Studio-Website/), and
      // location.origin alone drops that, so the PayMongo redirect back
      // would 404.
      return_url: location.origin + location.pathname.replace(/[^/]*$/, ''),
    };
    // Staff bookings are taken in person, so the server doesn't ask them for an
    // ID and there's nothing to upload.
    if (payOption === 'cash' && !isStaff) {
      submitBtn.textContent = 'Uploading ID…';
      payload.id_image_path = await uploadIdImage(session?.user?.id || null);
    }

    submitBtn.textContent = 'Sending…';
    const result = await callFunction('create-booking', session, payload);
    if (result.guest) rememberGuestBooking(result.booking);

    const serviceLabel = selectedServiceLabel();
    const bookedStart = startEl.value;
    const bookedEnd = endEl.value;

    // Online, in use: the slot is held and the customer settles it by scanning
    // one of the studio's QRs and uploading the receipt for staff to verify.
    if (result.payment_required && result.payment_method === 'manual') {
      window.dispatchEvent(new CustomEvent('ggs:booking-created', { detail: result.booking }));
      openPaymentModal({
        supabase,
        session,
        booking: result.booking,
        amountDue: result.amount_due,
        paymentOption: result.payment_option,
        depositPercent: result.deposit_percent,
      });
      confirmMsg.textContent =
        `✓ Slot held — ${serviceLabel} on ${b_date(result.booking)}, ${to12Hour(bookedStart)} to ${to12Hour(bookedEnd)}. ` +
        `Send ${formatPeso(result.amount_due)} to one of our QRs and upload the receipt. ` +
        'You can reopen this from My Bookings at any time.';
      confirmMsg.classList.remove('error');
      confirmMsg.style.display = 'block';
      submitBtn.textContent = 'Slot held ✓';
      hideAuthStep();
      form.reset();
      syncServiceDeps();
      if (idImageEl) idImageEl.value = '';
      await refreshAuthUI();
      updateSummary();
      refreshPayOptions();
      if (result.guest) showSaveAccountOffer(result.booking);
      return;
    }

    // Legacy PayMongo route (only reachable when the studio switches it back
    // on): leave the page at the hosted checkout rather than claiming the
    // booking is settled.
    if (result.payment_required && result.checkout_url) {
      submitBtn.textContent = 'Redirecting to payment…';
      window.dispatchEvent(new CustomEvent('ggs:booking-created', { detail: result.booking }));
      location.href = result.checkout_url;
      return;
    }

    const b = result.booking;
    const base = `✓ Booked — ${serviceLabel} on ${b_date(b)}, ${to12Hour(bookedStart)} to ${to12Hour(
      bookedEnd,
    )}. Total: ${formatPeso(b.total_price)}.`;
    // `notice` means the online route couldn't run and this fell back to cash —
    // say so instead of letting them think they've paid.
    confirmMsg.textContent = result.notice
      ? `${base} ${result.notice}`
      : `${base} Bring your ID and pay at the studio — GGS Studio will confirm by email shortly (check your spam/junk folder if you don't see it).`;
    confirmMsg.classList.remove('error');
    confirmMsg.style.display = 'block';
    submitBtn.textContent = 'Request sent ✓';
    hideAuthStep();
    form.reset();
    syncServiceDeps();
    clearFormErrors(form);
    if (idImageEl) idImageEl.value = '';
    await refreshAuthUI();
    updateSummary();
    refreshPayOptions();
    if (result.guest) showSaveAccountOffer(b);
    window.dispatchEvent(new CustomEvent('ggs:booking-created', { detail: b }));
  }

  function b_date(booking) {
    return new Date(booking.start_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    confirmMsg.classList.remove('error');
    confirmMsg.style.display = 'none';
    authMsg.textContent = '';
    authMsg.style.display = 'none';
    clearFormErrors(form);

    // Step 0: the terms have to be accepted before anything else happens. Show
    // them rather than just refusing — ticking the box in there ticks the one
    // on the form and re-submits, so Confirm carries straight on.
    if (termsEl && !termsEl.checked) {
      openTermsModal({
        requireAgreement: true,
        onAgree: () => {
          termsEl.checked = true;
          form.requestSubmit();
        },
      });
      return;
    }

    // Step 2: the password box is showing because this email belongs to an
    // account — sign in, then carry straight on into the booking.
    if (awaitingAuthMode) {
      // The form stays editable while the password box is up, so re-check it
      // rather than signing in and then failing on a date that was cleared.
      const stillWrong = collectBookingErrors();
      if (stillWrong.length) {
        showFieldErrors(stillWrong);
        return;
      }
      const password = authPassword.value;
      if (!password) {
        setFieldError(authPassword, 'Please enter a password.');
        authPassword.focus();
        return;
      }
      if (!isEmail(emailEl.value)) {
        showFieldErrors([[emailEl, "That doesn't look like an email address — check for a typo."]]);
        return;
      }
      submitBtn.disabled = true;
      try {
        const { data: signIn, error } = await supabase.auth.signInWithPassword({
          email: emailEl.value.trim(),
          password,
        });
        if (error) {
          if (/invalid login credentials/i.test(error.message)) {
            setFieldError(authPassword, "That password doesn't match this email. Try again, or book with a different email.");
            authPassword.focus();
            submitBtn.disabled = false;
            return;
          }
          throw error;
        }
        let newSession = signIn.session;
        // onAuthStateChange will populate `session` too; take it directly so
        // we don't have to wait a tick.
        if (!newSession) {
          const { data } = await supabase.auth.getSession();
          newSession = data.session;
        }
        session = newSession;
        // Signing in is also what makes this browser a recognised device for
        // that address, and pulls in anything booked under it as a guest.
        if (session) await claimGuestBookings(session);
        if (!session) {
          authMsg.textContent = 'Check your email to confirm your account, then submit again to book.';
          authMsg.classList.add('error');
          authMsg.style.display = 'block';
          submitBtn.disabled = false;
          return;
        }
        await placeBooking();
      } catch (err) {
        authMsg.textContent = `⚠ ${err.message}`;
        authMsg.classList.add('error');
        authMsg.style.display = 'block';
        submitBtn.disabled = false;
      }
      return;
    }

    // Step 1: validate the booking fields first. Each problem is painted onto
    // the field it belongs to; only a studio-side problem (no bookable room)
    // has no field to attach to, so that one stays a form-level message.
    const fieldErrors = collectBookingErrors();
    if (fieldErrors.length) {
      showFieldErrors(fieldErrors);
      return;
    }
    if (!mainRoom) {
      confirmMsg.textContent = '⚠ No room is currently available for booking. Please try again shortly.';
      confirmMsg.classList.add('error');
      confirmMsg.style.display = 'block';
      return;
    }

    // No account needed from here on — the name and email above are enough.
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    hideSaveAccountOffer();
    try {
      await placeBooking();
    } catch (err) {
      // The server refused an anonymous booking under an email that already has
      // a login. That's not an error to apologise for — it's the point — so ask
      // for the password rather than dead-ending on a red message.
      if (err.code === 'account_exists') {
        showAuthStep();
        setFieldError(emailEl, 'This email has an account — sign in below, or use a different address.');
        submitBtn.disabled = false;
        return;
      }
      confirmMsg.textContent = `⚠ ${err.message}`;
      confirmMsg.classList.add('error');
      confirmMsg.style.display = 'block';
      submitBtn.textContent = 'Confirm booking request';
    } finally {
      submitBtn.disabled = false;
    }
  });

  await loadRates();
  updateSummary();
}

