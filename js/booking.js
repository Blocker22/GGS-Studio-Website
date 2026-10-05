// The booking form, shared by the home page and My Bookings. One template
// (renderBookingForm) so both pages always offer the same fields.
//
// No account is needed to book: name, email and a mobile number are enough.
// The booking belongs to this browser (device.js) and every email carries a
// signed link to the booking page. Accounts come last: once the booking is
// in, the visitor can create one (or sign in, if the email already has one)
// to see their bookings on every device.
//
// The rules the server enforces (schedule, ID format, vouchers) come from the
// same shared modules imported here, so the form says no before the server has
// to.
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { signUpChecked } from './auth.js';
import { openPaymentModal } from './payment-qr.js';
import { clearFormErrors, clearFieldError, showFieldErrors, setFieldError, isEmail } from './form-validate.js';
import { compressImageIfNeeded } from './image-compress.js';
import { claimGuestBookings, deviceCredentials, getDevice, lastGuestEmail, lastGuestName, rememberGuestBooking } from './device.js';
import { ID_TYPES, guessIdType, normaliseIdNumber, validateIdNumber } from '../supabase/functions/_shared/idcheck.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const EYE_OPEN = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';
const TIME_POLICY = 'Your time starts and ends at the times you book. The clock runs from your start time whether you are here or not: arriving late does not extend your slot, and a no-show is still charged for the full booking.';

// ------------------------------------------------------------------ terms

let openTermsModal = () => {};

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
        <h4>Booking and confirmation</h4>
        <ul>
          <li>A booking is a request until the studio confirms it, usually within a few hours. Online payments confirm it once we have checked your receipt.</li>
          <li>No account is needed. Every email we send has a private link to your booking page, where you can see the details, pay, or cancel. Keep it to yourself.</li>
          <li>An account is optional. After booking you can create one, or sign in if your email already has one, to see your bookings on any device.</li>
          <li>The person booking is responsible for everyone they bring and for the group's conduct during the session.</li>
        </ul>
        <h4>Your booked time</h4>
        <ul>
          <li><strong>${TIME_POLICY}</strong></li>
          <li>The next booking can start exactly when yours ends, so sessions end on time.</li>
        </ul>
        <h4>Payment</h4>
        <ul>
          <li>Paying at the studio needs a photo of a valid ID to hold the slot. Payment is due before the session starts.</li>
          <li>Online payments are transfers to one of the studio accounts shown on this site, followed by uploading the receipt. The booking stays on hold until we have checked the receipt against the receiving account.</li>
          <li>The online downpayment is the percentage shown on the booking form, with the balance due at the studio. A full online payment settles the whole session.</li>
          <li>Only pay to the accounts shown on this site. GGS Studio will never ask you to pay a different account by message or call.</li>
        </ul>
        <h4>Overtime</h4>
        <ul>
          <li>Staying past your end time is charged at the regular hourly rate (including hourly add-ons), rounded up to the next hour, and only if the room is free. Overtime is paid before you leave.</li>
        </ul>
        <h4>Cancelling and changes</h4>
        <ul>
          <li>You can cancel free of charge from your booking page or My Bookings <strong>up to <span data-cutoff>24</span> hours before your start time</strong>. Cancelling asks for the last 4 digits of the phone number on the booking.</li>
          <li>Within the final <span data-cutoff>24</span> hours, only the studio can cancel or move a booking. Call us and we'll do our best.</li>
          <li>If the studio cancels, anything you paid is refunded in full or moved to a new time, your choice.</li>
        </ul>
        <h4>No-shows</h4>
        <ul>
          <li>Not arriving within 30 minutes of your start without notice makes the booking a no-show. <strong>No-shows are charged in full and not refunded.</strong></li>
        </ul>
        <h4>Studio rules and equipment</h4>
        <ul>
          <li>Treat the room and equipment with care. Food and drinks stay away from the gear and the console. No smoking, vaping, alcohol or illegal substances.</li>
          <li>Damage from misuse or negligence is charged to the person who booked, at repair or replacement cost.</li>
          <li>The studio may end a session without refund for conduct that endangers people or equipment.</li>
          <li>Back up your files before you leave. We are not responsible for lost files or belongings left behind.</li>
        </ul>
        <h4>Data and privacy</h4>
        <ul>
          <li>Your name, email, phone, ID photo and receipts are used only to manage your booking, under the Data Privacy Act (RA 10173). ID photos are visible only to studio staff and are deleted automatically after the session (see the Privacy Policy for how long).</li>
          <li>When you add an ID photo, your own device reads it to check the name and number match. The text never leaves your device; only yes or no results are sent.</li>
          <li>Our <a href="privacy" target="_blank" rel="noopener">Privacy Policy</a> explains what we collect, why, who processes it, how long we keep it, and your rights. It is part of these terms.</li>
        </ul>
        <h4>Site assistant</h4>
        <ul>
          <li>The chat assistant gives general information from our published rates and policies. Its answers are not a quote or a confirmation; the booking form and these terms decide. It cannot book, cancel or take payment.</li>
        </ul>
        <h4>Consumer rights</h4>
        <ul>
          <li>Nothing here limits your rights under the Consumer Act of the Philippines (RA 7394) or the Data Privacy Act (RA 10173). If a session falls short of what was promised, contact us and we'll work toward a fair fix, which may include a refund or a replacement session.</li>
        </ul>
      </div>
      <div class="modal-foot" data-terms-gate hidden>
        <label class="terms-check">
          <input type="checkbox" data-terms-agree>
          <span>I have read and agree to the Terms &amp; Conditions, including the booked-time and no-show rules.</span>
        </label>
        <button type="button" class="btn-primary" data-terms-continue disabled>Agree and continue</button>
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
    (requireAgreement ? agreeBox : modal.querySelector('[data-terms-close]')).focus();
  }
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    onAgree = null;
    lastFocus?.focus?.();
  }
  openTermsModal = open;
  agreeBox.addEventListener('change', () => { continueBtn.disabled = !agreeBox.checked; });
  continueBtn.addEventListener('click', () => {
    if (!agreeBox.checked) return;
    const cb = onAgree;
    close();
    cb?.();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-terms-close]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
  document.querySelectorAll('[data-terms-toggle]').forEach((btn) => btn.addEventListener('click', () => open()));
}

export function initPasswordToggles(root = document) {
  root.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
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

// ------------------------------------------------------------------ helpers

const formatPeso = (amount) => '₱' + Math.round(amount).toLocaleString('en-PH');

function setFigure(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function to12Hour(time) {
  const [h, m] = time.split(':').map(Number);
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Manila (+08:00) date + HH:MM to an ISO instant. */
const toIso = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

async function callFunction(name, session, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ ...deviceCredentials(), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.code = data.code || null;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function publicApi(action, body) {
  const res = await fetch(`${FUNCTIONS_URL}/public-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !('ok' in data)) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ------------------------------------------------------------------ the form

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/** Writes the booking form into #bookingFormMount (or `mount`). */
export function renderBookingForm(mount = document.getElementById('bookingFormMount')) {
  if (!mount || document.getElementById('bookingForm')) return;
  mount.innerHTML = `
  <div id="authSignedIn" class="auth-signed-in" style="display:none;"><span id="authWho"></span></div>
  <form id="bookingForm" novalidate>

    <div class="form-section form-section-first">
      <div class="form-step"><span class="step-n">1</span>When</div>
      <div class="field">
        <label for="fDate">Date</label>
        <input type="date" id="fDate" required>
      </div>
      <div class="field-row">
        <div class="field"><label for="fStart">Start time</label><input type="time" id="fStart" required></div>
        <div class="field"><label for="fEnd">End time</label><input type="time" id="fEnd" required></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-step"><span class="step-n">2</span>Add-ons <span class="label-note">optional, the room rate is always included</span></div>
      <div class="field" id="fServicesField">
        <div class="service-checks" id="fServices" role="group" aria-label="Session add-ons"><p class="muted">Loading add-ons…</p></div>
      </div>
      <div class="field">
        <label for="fVoucher">Voucher code <span class="label-note">optional</span></label>
        <div class="input-row">
          <input type="text" id="fVoucher" autocomplete="off" spellcheck="false" placeholder="e.g. STUDENT10" style="text-transform:uppercase">
          <button type="button" class="btn-outline" id="fVoucherApply">Apply</button>
        </div>
        <p class="field-ok" id="voucherMsg" hidden></p>
      </div>
      <div class="booking-summary" id="bookingSummary" aria-live="polite">
        <div><span>Duration</span><strong id="sumDuration">—</strong></div>
        <div><span>Total</span><strong id="sumPrice">—</strong><span class="discount" id="sumDiscount" hidden></span></div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-step"><span class="step-n">3</span>Payment</div>
      <div class="pay-options" id="payOptions" role="radiogroup" aria-label="How would you like to pay?">
        <label class="pay-option" data-pay-kind="in_person">
          <input type="radio" name="payOption" value="cash" checked>
          <span class="pay-body">
            <span class="pay-title">Pay at the studio</span>
            <span class="pay-note">Nothing to pay now. Add a photo of a valid ID to hold the slot; a school ID works.</span>
          </span>
          <span class="pay-amount" data-pay-amount="cash">—</span>
        </label>
        <div class="pay-id-upload" id="payIdUpload">
          <div class="field-row">
            <div class="field">
              <label for="fIdType">Which ID</label>
              <select id="fIdType"><option value="">Choose…</option>${ID_TYPES.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label for="fIdNumber">ID number</label>
              <input type="text" id="fIdNumber" autocomplete="off" spellcheck="false" placeholder="As printed on the card">
              <p class="field-hint" id="fIdHint"></p>
            </div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="fIdImage">Photo of the front</label>
            <input type="file" id="fIdImage" accept="image/png, image/jpeg, image/webp, image/heic">
            <div class="id-checks" id="idChecks" aria-live="polite"></div>
          </div>
          <p class="id-privacy">Only studio staff see this photo. It is deleted automatically after your session. Your device reads the photo to check the name and number; that text never leaves your device.</p>
        </div>
        <label class="pay-option" data-pay-kind="online">
          <input type="radio" name="payOption" value="deposit">
          <span class="pay-body">
            <span class="pay-title">Pay a <span id="payDepositPct">20</span>% downpayment online</span>
            <span class="pay-note" data-online-note>Send it to one of our accounts, then upload the receipt. The balance is paid at the studio.</span>
          </span>
          <span class="pay-amount" data-pay-amount="deposit">—</span>
        </label>
        <label class="pay-option" data-pay-kind="online">
          <input type="radio" name="payOption" value="full">
          <span class="pay-body">
            <span class="pay-title">Pay in full online</span>
            <span class="pay-note">Same transfer, for the whole session. Nothing left to pay on the day.</span>
          </span>
          <span class="pay-amount" data-pay-amount="full">—</span>
        </label>
      </div>
    </div>


    <div class="form-section">
      <div class="form-step"><span class="step-n">4</span>Your details <span class="label-note">no account needed</span></div>
      <div class="field">
        <label for="fName">Name</label>
        <input type="text" id="fName" autocomplete="name" placeholder="Your name" required>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="fEmail">Email</label>
          <input type="email" id="fEmail" autocomplete="email" placeholder="you@email.com" required>
          <p class="field-hint">Your confirmation and a private link to your booking go here.</p>
        </div>
        <div class="field">
          <label for="fPhone">Mobile number</label>
          <input type="tel" id="fPhone" autocomplete="tel" inputmode="tel" placeholder="0917 123 4567" required>
        </div>
      </div>
    </div>

    <div class="terms-block">
      <p class="policy-note"><strong>Booked time is booked time.</strong> ${TIME_POLICY}</p>
      <label class="terms-check">
        <input type="checkbox" id="fTerms">
        <span>I agree to the <button type="button" class="terms-link" data-terms-toggle>Terms &amp; Conditions</button>, including the booked-time, cancellation and no-show rules.</span>
      </label>
      <label class="terms-check">
        <input type="checkbox" id="fOptIn">
        <span>Send me studio news and offers now and then. Unsubscribe any time.</span>
      </label>
    </div>

    <div class="submit-row"><button type="submit" id="bookSubmitBtn" class="book-submit">Send booking request</button></div>
    <div class="confirm-msg" id="confirmMsg" role="status"></div>
  </form>`;
}

// ------------------------------------------------------------------ behaviour

export async function initBooking() {
  renderBookingForm();
  initPasswordToggles();
  initTermsModal();
  const supabase = await getSupabase();

  const $ = (id) => document.getElementById(id);
  const form = $('bookingForm');
  if (!form) return;
  const nameEl = $('fName');
  const emailEl = $('fEmail');
  const phoneEl = $('fPhone');
  const servicesWrap = $('fServices');
  const dateEl = $('fDate');
  const startEl = $('fStart');
  const endEl = $('fEnd');
  const voucherEl = $('fVoucher');
  const voucherMsg = $('voucherMsg');
  const sumDuration = $('sumDuration');
  const sumPrice = $('sumPrice');
  const sumDiscount = $('sumDiscount');
  const submitBtn = $('bookSubmitBtn');
  const confirmMsg = $('confirmMsg');
  const termsEl = $('fTerms');
  const optInEl = $('fOptIn');
  const payOptions = $('payOptions');
  const payIdUpload = $('payIdUpload');
  const idTypeEl = $('fIdType');
  const idNumberEl = $('fIdNumber');
  const idHint = $('fIdHint');
  const idImageEl = $('fIdImage');
  const idChecks = $('idChecks');
  const authSignedIn = $('authSignedIn');
  const authWho = $('authWho');
  const payOptionEls = Array.from(form.querySelectorAll('input[name="payOption"]'));

  let session = null;
  let mainRoom = null;
  let addonServices = [];
  let depositPercent = 20;
  let requireId = true;
  let isStaff = false;
  let voucher = null; // { code, discount, total, label }
  let idRead = {};

  // ---------- auth state
  async function refreshAuthUI() {
    if (session) {
      authSignedIn.style.display = 'flex';
      authWho.textContent = `Booking as ${session.user.email}`;
      emailEl.value = session.user.email || '';
      const { data: profile } = await supabase.from('profiles').select('full_name, phone, role').eq('id', session.user.id).single();
      isStaff = profile?.role === 'staff' || profile?.role === 'admin';
      if (!nameEl.value.trim()) nameEl.value = profile?.full_name || session.user.user_metadata?.full_name || '';
      if (!phoneEl.value.trim() && profile?.phone) phoneEl.value = profile.phone;
      emailEl.readOnly = true;
    } else {
      authSignedIn.style.display = 'none';
      emailEl.readOnly = false;
      isStaff = false;
      if (!emailEl.value.trim()) emailEl.value = lastGuestEmail() || '';
      if (!nameEl.value.trim()) nameEl.value = lastGuestName() || '';
    }
    refreshPayOptions();
  }
  supabase.auth.getSession().then(({ data }) => { session = data.session; refreshAuthUI(); });
  supabase.auth.onAuthStateChange((_e, s) => { session = s; setTimeout(refreshAuthUI, 0); });

  // ---------- rates and settings
  async function loadRates() {
    const [{ data: rooms }, { data: services }, { data: settings }] = await Promise.all([
      supabase.from('rooms').select('*').eq('is_active', true).order('created_at').limit(1),
      supabase.from('services').select('*').eq('is_active', true),
      supabase.from('app_settings').select('key, value').in('key', ['deposit_percent', 'payment_methods', 'booking_rules', 'reschedule_cutoff_hours']),
    ]);
    const get = (k) => settings?.find((s) => s.key === k)?.value;
    const pct = Number(get('deposit_percent'));
    if (Number.isFinite(pct) && pct > 0) depositPercent = pct;
    $('payDepositPct').textContent = String(depositPercent);
    const cutoff = Number(get('reschedule_cutoff_hours') ?? 24);
    document.querySelectorAll('[data-cutoff]').forEach((el) => { el.textContent = String(cutoff); });
    requireId = get('booking_rules')?.require_id_for_cash !== false;

    // Payment routes follow the methods switched on in the dashboard.
    const methods = get('payment_methods') || [];
    const cashOn = methods.some((m) => m.kind === 'in_person' && m.enabled !== false);
    const online = methods.filter((m) => m.kind === 'online' && m.enabled !== false);
    form.querySelectorAll('[data-pay-kind="in_person"]').forEach((el) => { el.hidden = !cashOn && methods.length > 0; });
    form.querySelectorAll('[data-pay-kind="online"]').forEach((el) => { el.hidden = !online.length && methods.length > 0; });
    if (online.length) form.querySelector('[data-online-note]').textContent = `Send it by ${online.map((m) => m.name).join(', ')}, then upload the receipt. The balance is paid at the studio.`;
    const firstVisible = payOptionEls.find((r) => !r.closest('.pay-option').hidden);
    if (firstVisible && payOptionEls.find((r) => r.checked)?.closest('.pay-option').hidden) firstVisible.checked = true;

    mainRoom = rooms?.[0] || null;
    addonServices = (services || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    renderServiceChecks();
  }

  function priceLabel(svc) {
    if (svc.price_type === 'hourly') return `+ ${formatPeso(svc.price)} / hr`;
    if (svc.price_type === 'unit') return `+ ${formatPeso(svc.price)} / ${svc.unit_label || 'unit'}`;
    return `+ ${formatPeso(svc.price)}`;
  }

  function renderServiceChecks() {
    servicesWrap.innerHTML = '';
    if (!addonServices.length) {
      servicesWrap.innerHTML = '<p class="muted">No add-ons right now. The room rate covers your session.</p>';
      return;
    }
    addonServices.forEach((svc) => {
      const wrap = document.createElement('div');
      const unit = svc.unit_label || 'unit';
      wrap.innerHTML = `
        <label class="service-check">
          <input type="checkbox" value="${svc.id}">
          <span class="tick">${CHECK}</span>
          <span class="service-check-body"><span class="service-check-name">${escapeHtml(svc.name)}</span><span class="service-check-note" data-base-note="${escapeHtml(svc.description || '')}">${escapeHtml(svc.description || '')}</span></span>
          <span class="service-check-price">${priceLabel(svc)}</span>
        </label>
        ${svc.price_type === 'unit' ? `<div class="service-check-expand"><span class="service-check-qty-label">How many ${escapeHtml(unit)}s?</span><input type="number" class="service-check-qty" min="1" step="1" value="1" data-qty-for="${svc.id}" aria-label="Number of ${escapeHtml(unit)}s for ${escapeHtml(svc.name)}"></div>` : ''}`;
      const cb = wrap.querySelector('input[type="checkbox"]');
      const qty = wrap.querySelector('.service-check-qty');
      cb.addEventListener('change', () => {
        if (cb.checked && qty) qty.focus({ preventScroll: true });
        syncServiceDeps();
        updateSummary();
      });
      qty?.addEventListener('input', updateSummary);
      qty?.addEventListener('blur', () => { const n = Math.floor(Number(qty.value)); qty.value = String(n >= 1 ? n : 1); updateSummary(); });
      servicesWrap.appendChild(wrap);
    });
    syncServiceDeps();
  }

  const serviceBoxes = () => Array.from(servicesWrap.querySelectorAll('input[type="checkbox"]'));

  // Prerequisites set in the dashboard (e.g. Mixing needs Recording), settled to a fixed point.
  function syncServiceDeps() {
    const boxes = serviceBoxes();
    const byId = new Map(boxes.map((c) => [c.value, c]));
    const svcById = new Map(addonServices.map((s) => [s.id, s]));
    for (let pass = 0; pass <= boxes.length; pass++) {
      let changed = false;
      boxes.forEach((cb) => {
        const req = svcById.get(cb.value)?.requires_service_id || null;
        const reqBox = req ? byId.get(req) : null;
        const locked = !!req && (!reqBox || !reqBox.checked || reqBox.disabled);
        if (cb.disabled !== locked) { cb.disabled = locked; changed = true; }
        if (locked && cb.checked) { cb.checked = false; changed = true; }
      });
      if (!changed) break;
    }
    boxes.forEach((cb) => {
      const row = cb.closest('.service-check');
      row.parentElement.querySelector('.service-check-expand')?.classList.toggle('open', cb.checked);
      const note = row.querySelector('.service-check-note');
      const req = svcById.get(cb.value)?.requires_service_id;
      const reqName = req ? svcById.get(req)?.name : null;
      note.textContent = cb.disabled ? (reqName ? `Add ${reqName} first. This can't be booked on its own.` : "Not available on its own right now.") : note.dataset.baseNote || '';
    });
  }

  const addonIds = () => serviceBoxes().filter((c) => c.checked && !c.disabled).map((c) => c.value);
  function qtyOf(id) {
    const n = Math.floor(Number(servicesWrap.querySelector(`[data-qty-for="${id}"]`)?.value));
    return n >= 1 ? n : 1;
  }

  function hoursBooked() {
    if (!startEl.value || !endEl.value) return null;
    const [sh, sm] = startEl.value.split(':').map(Number);
    const [eh, em] = endEl.value.split(':').map(Number);
    const raw = (eh * 60 + em - (sh * 60 + sm)) / 60;
    return raw > 0 ? Math.ceil(raw * 10) / 10 : (raw <= 0 && startEl.value && endEl.value ? 0 : null);
  }

  function listPrice() {
    const hrs = hoursBooked();
    if (!mainRoom || !hrs) return null;
    const picked = new Set(addonIds());
    const addons = addonServices.reduce((sum, s) => {
      if (!picked.has(s.id)) return sum;
      if (s.price_type === 'hourly') return sum + Number(s.price) * hrs;
      if (s.price_type === 'unit') return sum + Number(s.price) * qtyOf(s.id);
      return sum + Number(s.price);
    }, 0);
    return Math.ceil(Number(mainRoom.hourly_rate) * hrs + addons);
  }

  const currentTotal = () => {
    const list = listPrice();
    if (list == null) return null;
    return voucher ? Math.max(0, list - voucher.discount) : list;
  };

  function updateSummary() {
    const summary = $('bookingSummary');
    summary.classList.remove('ready');
    const hrs = hoursBooked();
    if (hrs === 0) {
      setFigure(sumDuration, 'End must be after start');
      setFigure(sumPrice, '—');
    } else if (hrs == null || !mainRoom) {
      setFigure(sumDuration, '—');
      setFigure(sumPrice, '—');
    } else {
      setFigure(sumDuration, `${hrs} hr${hrs !== 1 ? 's' : ''}`);
      setFigure(sumPrice, formatPeso(currentTotal()));
      summary.classList.add('ready');
    }
    sumDiscount.hidden = !voucher;
    if (voucher) sumDiscount.textContent = `${voucher.code}: −${formatPeso(voucher.discount)}`;
    refreshPayOptions();
    scheduleVoucherRecheck();
  }

  // ---------- voucher
  let voucherTimer;
  function scheduleVoucherRecheck() {
    if (!voucher) return;
    clearTimeout(voucherTimer);
    voucherTimer = setTimeout(() => applyVoucher(true), 600);
  }
  async function applyVoucher(silent = false) {
    const code = voucherEl.value.trim().toUpperCase();
    clearFieldError(voucherEl);
    voucherMsg.hidden = true;
    if (!code) { voucher = null; updateSummaryNoRecheck(); return; }
    if (!dateEl.value || !startEl.value || !endEl.value) {
      if (!silent) setFieldError(voucherEl, 'Pick your date and times first, then apply the code.');
      return;
    }
    try {
      const r = await publicApi('voucher.check', {
        code,
        start_at: toIso(dateEl.value, startEl.value),
        end_at: toIso(dateEl.value, endEl.value),
        service_ids: addonIds(),
        service_quantities: Object.fromEntries(addonIds().map((id) => [id, qtyOf(id)])),
        email: emailEl.value.trim(),
        room_id: mainRoom?.id,
      });
      if (!r.ok) {
        voucher = null;
        setFieldError(voucherEl, r.error || "That code doesn't apply.");
      } else {
        voucher = { code: r.code, discount: r.discount, label: r.label };
        voucherMsg.hidden = false;
        voucherMsg.textContent = `${r.label} applied${r.description ? `: ${r.description}` : ''}.${r.conditions?.length ? ` For ${r.conditions.join(', ')}.` : ''}`;
      }
    } catch (err) {
      if (!silent) setFieldError(voucherEl, err.message);
    }
    updateSummaryNoRecheck();
  }
  function updateSummaryNoRecheck() {
    const v = voucher;
    clearTimeout(voucherTimer);
    updateSummary();
    clearTimeout(voucherTimer);
    voucher = v;
  }
  $('fVoucherApply').addEventListener('click', () => applyVoucher(false));
  voucherEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyVoucher(false); } });
  voucherEl.addEventListener('input', () => { if (voucher && voucherEl.value.trim().toUpperCase() !== voucher.code) { voucher = null; voucherMsg.hidden = true; updateSummaryNoRecheck(); } });

  // ---------- payment options
  const selectedPayOption = () => payOptionEls.find((r) => r.checked)?.value || 'cash';
  function refreshPayOptions() {
    const option = selectedPayOption();
    let note = $('payStaffNotice');
    if (!note) {
      note = document.createElement('p');
      note.id = 'payStaffNotice';
      note.className = 'pay-staff-notice';
      payOptions.appendChild(note);
    }
    note.hidden = !isStaff;
    note.textContent = "You're signed in as studio staff, so this is recorded as a confirmed pay-at-the-studio booking. Use the dashboard for staff bookings, or a customer account to test the customer flow.";
    payIdUpload.classList.toggle('show', option === 'cash' && !isStaff && requireId);
    const total = currentTotal();
    form.querySelectorAll('[data-pay-amount]').forEach((cell) => {
      const kind = cell.dataset.payAmount;
      if (total == null) return setFigure(cell, '—');
      if (kind === 'cash') setFigure(cell, `${formatPeso(0)} now`);
      else if (kind === 'deposit') setFigure(cell, `${formatPeso(Math.ceil((total * depositPercent) / 100))} now`);
      else setFigure(cell, `${formatPeso(total)} now`);
    });
  }
  payOptionEls.forEach((r) => r.addEventListener('change', refreshPayOptions));
  [startEl, endEl, dateEl].forEach((el) => el.addEventListener('input', updateSummary));

  // ---------- ID checks (format live, photo read on this device)
  function syncIdHint() {
    const t = ID_TYPES.find((x) => x.id === idTypeEl.value);
    idHint.textContent = t ? (t.pattern ? `Format: ${t.hint}.` : 'No published number format for this ID; we check its shape only.') : '';
  }
  idTypeEl.addEventListener('change', () => { syncIdHint(); clearFieldError(idTypeEl); if (idNumberEl.value) checkIdNumber(); runIdRead(); });
  function checkIdNumber() {
    if (!idTypeEl.value || !idNumberEl.value.trim()) return null;
    const r = validateIdNumber(idTypeEl.value, idNumberEl.value);
    if (!r.ok) setFieldError(idNumberEl, r.message);
    else clearFieldError(idNumberEl);
    return r;
  }
  idNumberEl.addEventListener('blur', () => { checkIdNumber(); runIdRead(); });

  let idText = null;
  async function readIdPhoto(file) {
    idChecks.innerHTML = '<span>Checking the photo on this device…</span>';
    try {
      const { readImage } = await import('./ocr.js');
      idText = await readImage(file);
    } catch {
      idText = null;
      idChecks.innerHTML = '<span>We couldn\'t read the photo on this device. That\'s fine: staff will check it.</span>';
      return;
    }
    runIdRead();
  }
  function runIdRead() {
    if (idText == null) return;
    const flat = idText.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
    const digitsOnly = idText.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const num = normaliseIdNumber(idNumberEl.value);
    const nameParts = nameEl.value.trim().toUpperCase().split(/\s+/).filter((p) => p.length >= 3);
    const nameFound = nameParts.length ? nameParts.some((p) => flat.includes(p)) : null;
    const numberFound = num.length >= 4 ? digitsOnly.includes(num) : null;
    const typeGuess = guessIdType(idText);
    idRead = { nameFound, numberFound, typeGuess };
    const line = (ok, yes, no) => ok == null ? '' : `<span class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '✗'} ${ok ? yes : no}</span>`;
    const mismatch = typeGuess && idTypeEl.value && typeGuess !== idTypeEl.value ? `<span class="warn">This looks like a different ID than the one you picked. Check your choice.</span>` : '';
    idChecks.innerHTML = [line(nameFound, 'Your name is on the photo', "We couldn't find your name on the photo. Make sure it's sharp and well lit."),
      line(numberFound, 'The number matches the photo', "We couldn't find that number on the photo. Check for a typo."), mismatch].filter(Boolean).join('') || '<span>Photo added.</span>';
  }
  idImageEl.addEventListener('change', async () => {
    let file = idImageEl.files?.[0];
    if (!file) return;
    clearFieldError(idImageEl);
    if (file.size > 2 * 1024 * 1024) {
      idChecks.innerHTML = '<span>Making the photo smaller…</span>';
      const compressed = await compressImageIfNeeded(file);
      if (compressed !== file) {
        const dt = new DataTransfer();
        dt.items.add(compressed);
        idImageEl.files = dt.files;
        file = compressed;
      }
    }
    readIdPhoto(file);
  });

  // ---------- validation
  dateEl.min = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  function collectErrors() {
    const errors = [];
    if (!nameEl.value.trim()) errors.push([nameEl, 'Please enter your name.']);
    if (!emailEl.value.trim()) errors.push([emailEl, 'Please enter your email.']);
    else if (!isEmail(emailEl.value)) errors.push([emailEl, "That doesn't look like an email address. Check for a typo."]);
    const phoneDigits = phoneEl.value.replace(/\D/g, '');
    if (!isStaff && (phoneDigits.length < 7 || phoneDigits.length > 15)) errors.push([phoneEl, 'Please enter a mobile number we can reach you on.']);
    if (!dateEl.value) errors.push([dateEl, 'Please choose a date.']);
    else if (dateEl.value < dateEl.min) errors.push([dateEl, 'That date has passed. Pick today or later.']);
    if (!startEl.value) errors.push([startEl, 'Please choose a start time.']);
    if (!endEl.value) errors.push([endEl, 'Please choose an end time.']);
    if (startEl.value && endEl.value && hoursBooked() === 0) errors.push([endEl, 'The end time must be later than the start.']);
    if (!isStaff && requireId && selectedPayOption() === 'cash') {
      if (!idTypeEl.value) errors.push([idTypeEl, 'Choose which ID you are using.']);
      else {
        const r = validateIdNumber(idTypeEl.value, idNumberEl.value);
        if (!r.ok) errors.push([idNumberEl, r.message]);
      }
      if (!idImageEl.files?.[0]) errors.push([idImageEl, 'Add a photo of the front of your ID to pay at the studio.']);
    }
    return errors;
  }

  async function uploadIdImage(userId) {
    const file = await compressImageIfNeeded(idImageEl.files[0]);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const folder = userId || `guest/${getDevice().id}`;
    const path = `${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('customer-ids').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
    if (error) throw new Error(`Could not upload your ID: ${error.message}`);
    return path;
  }

  // ---------- last step: an account, for every device
  // Shown after the booking (and after the payment window, if there was one).
  // A new email creates an account; an email that already has one signs in.
  // Either way the guest booking moves into the account.
  let saveOffer = null;
  function showSaveAccountOffer(booking, hasAccount = false) {
    const email = booking?.guest_email || emailEl.value.trim();
    const name = booking?.guest_name || nameEl.value.trim();
    if (!email) return;
    if (saveOffer) saveOffer.remove();
    {
      saveOffer = document.createElement('div');
      saveOffer.className = 'save-account-offer';
      saveOffer.innerHTML = `
        <p class="save-account-title">${hasAccount ? 'Add this booking to your account' : 'Track your bookings on any device'}</p>
        <p class="auth-step-note">${hasAccount
          ? `${escapeHtml(email)} already has a GGS Studio account. Sign in and this booking joins the rest of your sessions.`
          : 'Your booking is safe either way: the email we sent has a link to it. Pick a password to see every session from any phone or laptop.'}</p>
        <div class="field">
          <label for="savePw">Password ${hasAccount ? '' : '<span class="label-note">at least 6 characters</span>'}</label>
          <div class="pw-wrap">
            <input type="password" id="savePw" minlength="6" autocomplete="${hasAccount ? 'current-password' : 'new-password'}">
            <button type="button" class="pw-toggle" data-pw-toggle="savePw" aria-label="Show password"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EYE_OPEN}</svg></button>
          </div>
        </div>
        <div class="save-account-actions"><button type="button" class="btn-primary" data-save-go>${hasAccount ? 'Sign in' : 'Create my account'}</button><button type="button" class="btn-ghost" data-save-skip>Not now</button></div>
        <div class="confirm-msg" data-save-msg></div>`;
      confirmMsg.insertAdjacentElement('afterend', saveOffer);
      initPasswordToggles(saveOffer);
      const pw = saveOffer.querySelector('#savePw');
      const msg = saveOffer.querySelector('[data-save-msg]');
      const goBtn = saveOffer.querySelector('[data-save-go]');
      saveOffer.querySelector('[data-save-skip]').addEventListener('click', () => { saveOffer.style.display = 'none'; });
      goBtn.addEventListener('click', async () => {
        msg.classList.remove('error');
        msg.style.display = 'none';
        if (pw.value.length < 6) {
          msg.textContent = 'Please choose a password of at least 6 characters.';
          msg.classList.add('error');
          msg.style.display = 'block';
          return;
        }
        goBtn.disabled = true;
        goBtn.textContent = hasAccount ? 'Signing in…' : 'Creating…';
        try {
          let result;
          if (hasAccount) {
            const { data, error } = await supabase.auth.signInWithPassword({ email: saveOffer.dataset.email, password: pw.value });
            if (error) throw new Error(/invalid login credentials/i.test(error.message) ? "That password doesn't match this email. You can reset it from the sign-in page." : error.message);
            result = data;
          } else {
            result = await signUpChecked(supabase, saveOffer.dataset.email, pw.value, saveOffer.dataset.name);
          }
          if (!result.session) {
            msg.textContent = 'Almost there. Check your email (and the spam folder) to confirm your account. Your booking will appear under My Bookings once you do.';
            msg.style.display = 'block';
            goBtn.textContent = 'Check your email';
            return;
          }
          session = result.session;
          const claim = await claimGuestBookings(result.session);
          const done = hasAccount ? 'Signed in.' : 'Account created.';
          msg.innerHTML = `${done} ${claim.claimed > 0 ? `${claim.claimed} booking${claim.claimed === 1 ? '' : 's'} added to it.` : 'Your bookings show up under My Bookings.'} <a href="account">Open My Bookings</a>`;
          msg.style.display = 'block';
          saveOffer.querySelector('.field').style.display = 'none';
          saveOffer.querySelector('.save-account-actions').style.display = 'none';
          await refreshAuthUI();
        } catch (err) {
          msg.textContent = err.message;
          msg.classList.add('error');
          msg.style.display = 'block';
          goBtn.disabled = false;
          goBtn.textContent = hasAccount ? 'Sign in' : 'Create my account';
        }
      });
    }
    saveOffer.dataset.email = email;
    saveOffer.dataset.name = name;
    saveOffer.style.display = 'block';
    saveOffer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- submit
  function bookedDate(b) {
    return new Date(b.start_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' });
  }

  function resetForm() {
    const keep = { name: nameEl.value, email: emailEl.value, phone: phoneEl.value };
    form.reset();
    nameEl.value = keep.name;
    emailEl.value = keep.email;
    phoneEl.value = keep.phone;
    voucher = null;
    voucherMsg.hidden = true;
    idText = null;
    idRead = {};
    idChecks.innerHTML = '';
    syncIdHint();
    syncServiceDeps();
    clearFormErrors(form);
    updateSummaryNoRecheck();
  }

  async function placeBooking() {
    const { data: s } = await supabase.auth.getSession();
    session = s.session;
    const payOption = selectedPayOption();
    const payload = {
      v: 2,
      room_id: mainRoom.id,
      start_at: toIso(dateEl.value, startEl.value),
      end_at: toIso(dateEl.value, endEl.value),
      service_ids: addonIds(),
      service_quantities: Object.fromEntries(addonIds().map((id) => [id, qtyOf(id)])),
      payment_option: payOption,
      guest_name: nameEl.value.trim(),
      guest_email: emailEl.value.trim(),
      guest_phone: phoneEl.value.trim(),
      voucher_code: voucher?.code || voucherEl.value.trim().toUpperCase() || undefined,
      policy_accepted: termsEl.checked,
      newsletter_opt_in: optInEl.checked,
      return_url: location.origin + location.pathname.replace(/[^/]*$/, ''),
    };
    if (payOption === 'cash' && !isStaff && requireId) {
      submitBtn.textContent = 'Uploading ID…';
      payload.id_image_path = await uploadIdImage(session?.user?.id || null);
      payload.id_check = { type: idTypeEl.value, number: idNumberEl.value, read: idRead };
    }
    submitBtn.textContent = 'Sending…';
    const result = await callFunction('create-booking', session, payload);
    if (result.guest) rememberGuestBooking(result.booking);
    const b = result.booking;
    const when = `${bookedDate(b)}, ${to12Hour(startEl.value)} to ${to12Hour(endEl.value)}`;
    window.dispatchEvent(new CustomEvent('ggs:booking-created', { detail: b }));

    const offerAccount = () => { if (result.guest) showSaveAccountOffer(b, !!result.account_exists); };
    if (result.payment_required && result.payment_method === 'manual') {
      openPaymentModal({ supabase, session, booking: b, amountDue: result.amount_due, paymentOption: result.payment_option, depositPercent: result.deposit_percent, onClose: offerAccount });
      confirmMsg.innerHTML = `Slot held for <strong>${escapeHtml(when)}</strong>. Send ${formatPeso(result.amount_due)} to one of our accounts and upload the receipt. The email we just sent has a link to your booking if you need it later (check spam if you don't see it).`;
    } else if (result.payment_required && result.checkout_url) {
      submitBtn.textContent = 'Opening payment…';
      location.href = result.checkout_url;
      return;
    } else {
      confirmMsg.innerHTML = `Request sent for <strong>${escapeHtml(when)}</strong>, total ${formatPeso(b.total_price)}. ${result.notice ? escapeHtml(result.notice) : 'We\'ll confirm by email shortly; check your spam folder if you don\'t see it. Bring your ID and pay at the studio.'}`;
    }
    confirmMsg.classList.remove('error');
    confirmMsg.style.display = 'block';
    resetForm();
    submitBtn.textContent = 'Send booking request';
    await refreshAuthUI();
    confirmMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!(result.payment_required && result.payment_method === 'manual')) offerAccount();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    confirmMsg.style.display = 'none';
    confirmMsg.classList.remove('error');
    clearFormErrors(form);

    const errors = collectErrors();
    if (errors.length) return showFieldErrors(errors);
    if (!termsEl.checked) {
      return openTermsModal({ requireAgreement: true, onAgree: () => { termsEl.checked = true; form.requestSubmit(); } });
    }
    if (!mainRoom) {
      confirmMsg.textContent = 'No room is open for booking right now. Please try again shortly.';
      confirmMsg.classList.add('error');
      confirmMsg.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      await placeBooking();
    } catch (err) {
      if (err.code === 'voucher') {
        setFieldError(voucherEl, err.message);
        voucherEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (err.code === 'id') {
        setFieldError(idNumberEl, err.message);
        payIdUpload.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (err.code === 'phone') {
        setFieldError(phoneEl, err.message);
      } else {
        confirmMsg.textContent = err.message;
        confirmMsg.classList.add('error');
        confirmMsg.style.display = 'block';
      }
      submitBtn.textContent = 'Send booking request';
    } finally {
      submitBtn.disabled = false;
    }
  });

  await loadRates();
  updateSummary();

  // "Book this" links from emails: ?date=YYYY-MM-DD&start=HH:MM&end=HH:MM#book
  const params = new URLSearchParams(location.search);
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')) {
    dateEl.value = params.get('date');
    if (/^\d{2}:\d{2}$/.test(params.get('start') || '')) startEl.value = params.get('start');
    if (/^\d{2}:\d{2}$/.test(params.get('end') || '')) endEl.value = params.get('end');
    [dateEl, startEl, endEl].forEach((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    setTimeout(() => document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' }), 300);
  }
}
