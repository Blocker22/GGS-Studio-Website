// Supabase-backed booking flow. Visually this is the original single-form
// layout (Name / Email / Service / Date / Start / End). Behind the scenes it
// talks to Postgres for live rates and to the create-booking Edge Function to
// place the booking. Account creation/login is NOT required to fill out the
// form — it only kicks in when the visitor submits and isn't signed in yet,
// using the name/email they already typed.
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { signUpChecked } from './auth.js';
import { openPaymentModal } from './payment-qr.js';
import { clearFormErrors, clearFieldError, showFieldErrors, setFieldError, isEmail } from './form-validate.js';
import { compressImageIfNeeded } from './image-compress.js';

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

async function callFunction(name, session, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
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
  const authToggleBtn = document.getElementById('authToggleBtn');

  let session = null;
  let mainRoom = null;
  let addonServices = [];
  let depositPercent = 20;
  let awaitingAuthMode = null; // 'signup' | 'login' | null
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

  function showAuthStep(mode) {
    awaitingAuthMode = mode;
    clearFieldError(authPassword);
    authStep.style.display = 'block';
    authToggleRow.style.display = 'block';
    authStepNote.textContent =
      mode === 'signup'
        ? 'One more step — create an account to confirm this booking.'
        : 'Welcome back — enter your password to confirm this booking.';
    authToggleBtn.textContent = mode === 'signup' ? 'Already have an account? Log in instead' : 'New here? Create an account instead';
    submitBtn.textContent = mode === 'signup' ? 'Create account & confirm booking' : 'Log in & confirm booking';
    authPassword.focus();
  }

  authToggleBtn.addEventListener('click', () => {
    showAuthStep(awaitingAuthMode === 'signup' ? 'login' : 'signup');
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
    return svc.price_type === 'hourly' ? `+ ${formatPeso(svc.price)} / hr` : `+ ${formatPeso(svc.price)} flat`;
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
      const label = document.createElement('label');
      label.className = 'service-check';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = svc.id;
      cb.dataset.slug = svc.slug;
      cb.addEventListener('change', () => {
        syncServiceDeps();
        updateSummary();
      });

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
      servicesWrap.appendChild(label);
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

  // "Room only" when nothing extra is picked — the confirmation line still has
  // to name what was booked.
  function selectedServiceLabel() {
    const picked = new Set(addonServiceIds());
    const names = addonServices.filter((s) => picked.has(s.id)).map((s) => s.name);
    return names.length ? `Room + ${names.join(' + ')}` : 'Room only';
  }

  function addonTotal(durationHours) {
    const picked = new Set(addonServiceIds());
    return addonServices.reduce((sum, svc) => {
      if (!picked.has(svc.id)) return sum;
      return sum + (svc.price_type === 'hourly' ? Number(svc.price) * durationHours : Number(svc.price));
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

  // Uploads the valid ID into the customer's own folder in the private
  // customer-ids bucket and returns the stored path. Storage RLS restricts
  // both the write and any later read to that customer plus studio staff.
  async function uploadIdImage(userId) {
    let file = idImageEl?.files?.[0];
    if (!file) throw new Error('Please attach a photo of a valid ID to pay in cash.');
    // Belt-and-suspenders: the change handler above already compresses on
    // selection, but this covers a file assigned any other way (browser
    // autofill, a script, a future code path) reaching submit uncompressed.
    file = await compressImageIfNeeded(file);

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${userId}/${Date.now()}.${ext || 'jpg'}`;
    const { error } = await supabase.storage.from('customer-ids').upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) throw new Error(`Could not upload your ID: ${error.message}`);
    return path;
  }

  async function placeBooking() {
    const startAt = new Date(`${dateEl.value}T${startEl.value}:00`);
    const endAt = new Date(`${dateEl.value}T${endEl.value}:00`);

    const { data: sessionData } = await supabase.auth.getSession();
    session = sessionData.session;
    if (!session) throw new Error('Please sign in to continue.');

    const payOption = selectedPayOption();
    const payload = {
      room_id: mainRoom.id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      service_ids: addonServiceIds(),
      payment_option: payOption,
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
      payload.id_image_path = await uploadIdImage(session.user.id);
    }

    submitBtn.textContent = 'Sending…';
    const result = await callFunction('create-booking', session, payload);

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
      : `${base} Bring your ID and pay at the studio — GGS Studio will confirm by email shortly.`;
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

    // Step 2: we're mid-auth (password box showing) — try to sign in/up.
    if (awaitingAuthMode) {
      const password = authPassword.value;
      if (!password) {
        setFieldError(authPassword, 'Please enter a password.');
        authPassword.focus();
        return;
      }
      if (password.length < 6) {
        setFieldError(authPassword, 'Password must be at least 6 characters.');
        authPassword.focus();
        return;
      }
      if (!isEmail(emailEl.value)) {
        showFieldErrors([[emailEl, "That doesn't look like an email address — check for a typo."]]);
        return;
      }
      submitBtn.disabled = true;
      try {
        // Registering signs the account in as part of signUpChecked, so the
        // booking below carries straight on — no second password prompt.
        let newSession = null;
        if (awaitingAuthMode === 'signup') {
          try {
            const result = await signUpChecked(supabase, emailEl.value.trim(), password, nameEl.value.trim());
            newSession = result.session;
          } catch (err) {
            if (/already registered/i.test(err.message)) {
              showAuthStep('login');
              setFieldError(emailEl, err.message);
              submitBtn.disabled = false;
              return;
            }
            throw err;
          }
        } else {
          const { data: signIn, error } = await supabase.auth.signInWithPassword({
            email: emailEl.value.trim(),
            password,
          });
          if (error) {
            if (/invalid login credentials/i.test(error.message)) {
              setFieldError(authPassword, "That password doesn't match this email. Try again.");
              authPassword.focus();
              submitBtn.disabled = false;
              return;
            }
            throw error;
          }
          newSession = signIn.session;
        }
        // onAuthStateChange will populate `session` too; take it directly so
        // we don't have to wait a tick.
        if (!newSession) {
          const { data } = await supabase.auth.getSession();
          newSession = data.session;
        }
        session = newSession;
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

    if (!session) {
      showAuthStep('signup');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      await placeBooking();
    } catch (err) {
      confirmMsg.textContent = `⚠ ${err.message}`;
      confirmMsg.classList.add('error');
      confirmMsg.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  await loadRates();
  updateSummary();
}

