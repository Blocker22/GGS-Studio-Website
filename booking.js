// Supabase-backed booking flow. Visually this is the original single-form
// layout (Name / Email / Service / Date / Start / End). Behind the scenes it
// talks to Postgres for live rates and to the create-booking Edge Function to
// place the booking. Account creation/login is NOT required to fill out the
// form — it only kicks in when the visitor submits and isn't signed in yet,
// using the name/email they already typed.
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { signUpChecked } from './auth.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const EYE_OPEN = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

// The full Terms & Conditions, shown in a modal whenever a [data-terms-toggle]
// control is clicked. Built once on demand and reused; Escape and the backdrop
// both close it.
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
          <li>Online downpayments are charged at the percentage shown at checkout, with the balance due at the studio on the day of the session.</li>
          <li>Full online payments settle the entire session upfront.</li>
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
          <li>Your name, email, and ID photo are collected solely to manage your booking and payment, and are handled in accordance with the Data Privacy Act (RA 10173). They are never sold or shared beyond what is needed to process your booking.</li>
        </ul>

        <h4>Consumer Rights</h4>
        <ul>
          <li>Nothing in these terms limits your rights under Philippine consumer law, including the Consumer Act of the Philippines (RA 7394) and the Data Privacy Act (RA 10173).</li>
          <li>You are entitled to services that match what was advertised and booked. If a session materially falls short of what was promised, contact us — we will work with you in good faith toward a fair resolution, which may include a partial or full refund or a replacement session.</li>
          <li>These terms do not remove your right to raise concerns with the Department of Trade and Industry (DTI) or other appropriate agencies.</li>
          <li>Questions, complaints, or refund requests? Reach us through the contact details on this site and we'll respond promptly.</li>
        </ul>
      </div>
    </div>`;
  document.body.appendChild(modal);

  let lastFocus = null;
  function open() {
    lastFocus = document.activeElement;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    modal.querySelector('[data-terms-close]').focus();
  }
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    lastFocus?.focus?.();
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-terms-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
  document.querySelectorAll('[data-terms-toggle]').forEach((btn) => btn.addEventListener('click', open));
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
  const serviceEl = document.getElementById('fService');
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
  const payIdUpload = document.getElementById('payIdUpload');
  const idImageEl = document.getElementById('fIdImage');
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
  let servicesBySlug = {};
  let depositPercent = 20;
  let awaitingAuthMode = null; // 'signup' | 'login' | null

  async function refreshAuthUI() {
    if (session) {
      if (authSignedIn) {
        authSignedIn.style.display = 'flex';
        authWho.textContent = `Booking as ${session.user.email}`;
      }
      // Fill the account's details in rather than blanking the fields out —
      // a disabled empty Name was making the form impossible to submit.
      emailEl.value = session.user.email || '';
      if (!nameEl.value.trim()) {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
        nameEl.value = profile?.full_name || session.user.user_metadata?.full_name || '';
      }
      nameEl.readOnly = false;
      emailEl.readOnly = true;
      hideAuthStep();
    } else {
      if (authSignedIn) authSignedIn.style.display = 'none';
      emailEl.readOnly = false;
    }
  }

  function hideAuthStep() {
    authStep.style.display = 'none';
    authToggleRow.style.display = 'none';
    authPassword.value = '';
    authMsg.textContent = '';
    awaitingAuthMode = null;
    submitBtn.textContent = 'Confirm booking request';
  }

  function showAuthStep(mode) {
    awaitingAuthMode = mode;
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
    servicesBySlug = {};
    (services || []).forEach((s) => {
      servicesBySlug[s.slug] = s;
    });
  }

  function addonServiceIds(service) {
    // Mixing is never offered on its own — you can't mix a session you
    // didn't record here, so it's only ever paired with recording.
    if (service === 'recording') return [servicesBySlug.recording?.id].filter(Boolean);
    if (service === 'both') return [servicesBySlug.recording?.id, servicesBySlug.mixing?.id].filter(Boolean);
    return [];
  }

  function addonTotal(service, durationHours) {
    return addonServiceIds(service).reduce((sum, id) => {
      const svc = Object.values(servicesBySlug).find((s) => s.id === id);
      if (!svc) return sum;
      return sum + (svc.price_type === 'hourly' ? Number(svc.price) * durationHours : Number(svc.price));
    }, 0);
  }

  // Returns the session total in pesos, or null when the form isn't complete
  // enough to price yet. Shared by the summary and the payment options.
  function currentTotal() {
    if (!mainRoom || !serviceEl.value || !startEl.value || !endEl.value) return null;
    const [sh, sm] = startEl.value.split(':').map(Number);
    const [eh, em] = endEl.value.split(':').map(Number);
    const rawDuration = (eh * 60 + em - (sh * 60 + sm)) / 60;
    if (rawDuration <= 0) return null;
    const duration = Math.ceil(rawDuration * 10) / 10;
    return Math.ceil(Number(mainRoom.hourly_rate) * duration + addonTotal(serviceEl.value, duration));
  }

  function updateSummary() {
    document.getElementById('bookingSummary').classList.remove('ready');
    if (!mainRoom || !serviceEl.value || !startEl.value || !endEl.value) {
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
    const price = Math.ceil(Number(mainRoom.hourly_rate) * duration + addonTotal(serviceEl.value, duration));
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

  function refreshPayOptions() {
    const option = selectedPayOption();
    // The ID photo is only asked for on the cash route.
    if (payIdUpload) payIdUpload.classList.toggle('show', option === 'cash');

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

  [serviceEl, startEl, endEl].forEach((el) => el.addEventListener('input', updateSummary));

  function validateBookingFields() {
    if (!nameEl.value.trim()) return 'Please enter your name.';
    if (!emailEl.value.trim()) return 'Please enter your email.';
    if (!serviceEl.value) return 'Please choose a service.';
    if (!dateEl.value) return 'Please choose a date.';
    if (termsEl && !termsEl.checked) return 'Please agree to the Terms & Conditions to confirm your booking.';
    if (!startEl.value || !endEl.value) return 'Please choose a start and end time.';
    if (selectedPayOption() === 'cash' && !idImageEl?.files?.length) {
      return 'Please attach a photo of a valid ID to pay in cash.';
    }
    const [sh, sm] = startEl.value.split(':').map(Number);
    const [eh, em] = endEl.value.split(':').map(Number);
    if (eh * 60 + em <= sh * 60 + sm) return 'End time must be later than the start time.';
    if (!mainRoom) return 'No room is currently available for booking. Please try again shortly.';
    return null;
  }

  // Uploads the valid ID into the customer's own folder in the private
  // customer-ids bucket and returns the stored path. Storage RLS restricts
  // both the write and any later read to that customer plus studio staff.
  async function uploadIdImage(userId) {
    const file = idImageEl?.files?.[0];
    if (!file) throw new Error('Please attach a photo of a valid ID to pay in cash.');
    if (file.size > 2 * 1024 * 1024) throw new Error('That ID photo is over 2MB — please attach a smaller one.');

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
      service_ids: addonServiceIds(serviceEl.value),
      payment_option: payOption,
      // The full directory URL, not just the origin — this project's GitHub
      // Pages site lives under a subpath (/GGS-Studio-Website/), and
      // location.origin alone drops that, so the PayMongo redirect back
      // would 404.
      return_url: location.origin + location.pathname.replace(/[^/]*$/, ''),
    };
    if (payOption === 'cash') {
      submitBtn.textContent = 'Uploading ID…';
      payload.id_image_path = await uploadIdImage(session.user.id);
    }

    submitBtn.textContent = 'Sending…';
    const result = await callFunction('create-booking', session, payload);

    // Online routes hand back a PayMongo hosted-checkout URL. Leave the page
    // there rather than claiming the booking is settled.
    if (result.payment_required && result.checkout_url) {
      submitBtn.textContent = 'Redirecting to payment…';
      window.dispatchEvent(new CustomEvent('ggs:booking-created', { detail: result.booking }));
      location.href = result.checkout_url;
      return;
    }

    const b = result.booking;
    const base = `✓ Booked — ${serviceEl.options[serviceEl.selectedIndex].text} on ${b_date(b)}, ${to12Hour(
      startEl.value,
    )} to ${to12Hour(endEl.value)}. Total: ${formatPeso(b.total_price)}.`;
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

    // Step 2: we're mid-auth (password box showing) — try to sign in/up.
    if (awaitingAuthMode) {
      const password = authPassword.value;
      if (!password || password.length < 6) {
        authMsg.textContent = 'Password must be at least 6 characters.';
        return;
      }
      submitBtn.disabled = true;
      try {
        if (awaitingAuthMode === 'signup') {
          try {
            await signUpChecked(supabase, emailEl.value.trim(), password, nameEl.value.trim());
          } catch (err) {
            if (/already registered/i.test(err.message)) {
              showAuthStep('login');
              authMsg.textContent = err.message;
              submitBtn.disabled = false;
              return;
            }
            throw err;
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email: emailEl.value.trim(), password });
          if (error) throw error;
        }
        // onAuthStateChange will populate `session`; grab it directly too so
        // we don't have to wait a tick.
        const { data } = await supabase.auth.getSession();
        session = data.session;
        if (!session) {
          authMsg.textContent = 'Check your email to confirm your account, then submit again to book.';
          submitBtn.disabled = false;
          return;
        }
        await placeBooking();
      } catch (err) {
        authMsg.textContent = err.message;
        submitBtn.disabled = false;
      }
      return;
    }

    // Step 1: validate the booking fields first.
    const fieldError = validateBookingFields();
    if (fieldError) {
      confirmMsg.textContent = `⚠ ${fieldError}`;
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
