// Manual QR payment: the customer scans one of the studio's payment QRs, sends
// the exact amount, and uploads their receipt for staff to verify by hand.
//
// Receipts never touch this file's storage — they go straight into the private
// `payment-receipts` bucket under the customer's own user id, and the payment
// row itself is only ever written by the submit-receipt Edge Function. RLS on
// the bucket restricts reads to the uploader plus studio staff.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const RECEIPT_BUCKET = 'payment-receipts';
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// The studio's own QRs, kept in one place so account details can be corrected
// here without touching the booking or account pages. `account` is optional —
// leave it blank and the line simply isn't shown.
export const PAYMENT_CHANNELS = [
  { key: 'gcash', label: 'GCash', qr: 'assets/payment_qr/GGS_Gcash_QR.png', account: 'Garvey Gene Sanjorjo' },
  { key: 'gotyme', label: 'GoTyme', qr: 'assets/payment_qr/GGS_GoTyme_QR.png', account: 'Garvey Gene Sanjorjo' },
  { key: 'bpi', label: 'BPI', qr: 'assets/payment_qr/GGS_BPI_QR.png', account: 'Garvey Gene Sanjorjo' },
];

export function formatPeso(amount) {
  return '₱' + Math.round(Number(amount) || 0).toLocaleString('en-PH');
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

function buildModal() {
  const existing = document.getElementById('payQrModal');
  if (existing) return existing;

  const modal = document.createElement('div');
  modal.id = 'payQrModal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal pay-qr-modal" role="dialog" aria-modal="true" aria-labelledby="payQrTitle">
      <button type="button" class="modal-close" data-pay-close aria-label="Close">&times;</button>
      <h3 id="payQrTitle">Complete your payment</h3>
      <div class="modal-body">
        <div class="pay-qr-due">
          <span>Amount to send</span>
          <strong data-pay-due>—</strong>
        </div>
        <p class="pay-qr-lead" data-pay-lead></p>

        <div class="pay-qr-tabs" data-pay-tabs role="tablist"></div>
        <div class="pay-qr-figure">
          <img data-pay-qr alt="" width="240" height="240">
          <p class="pay-qr-account" data-pay-account></p>
        </div>

        <h4>Send us the receipt</h4>
        <p class="field-hint pay-qr-hint">
          Your slot stays on hold until the studio checks the receipt against the account.
          You'll see it move to Confirmed on My Bookings once it clears.
        </p>
        <form class="pay-qr-form" data-pay-form>
          <div class="field">
            <label for="payQrRef">Reference number</label>
            <input id="payQrRef" data-pay-ref maxlength="64" autocomplete="off"
                   placeholder="The Ref. No. on your transfer receipt" required>
          </div>
          <div class="field">
            <label for="payQrFile">Screenshot or PDF of the receipt</label>
            <input id="payQrFile" data-pay-file type="file"
                   accept="image/png, image/jpeg, image/webp, image/heic, application/pdf" required>
            <p class="field-hint">Max 5MB. Make sure the amount, reference number, and date are readable.</p>
          </div>
          <button type="submit" class="btn-primary" data-pay-submit>Submit receipt</button>
          <div class="confirm-msg" data-pay-msg></div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => closeModal(modal);
  modal.querySelector('[data-pay-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  return modal;
}

function closeModal(modal) {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

function renderChannels(modal) {
  const tabs = modal.querySelector('[data-pay-tabs]');
  const img = modal.querySelector('[data-pay-qr]');
  const account = modal.querySelector('[data-pay-account]');
  tabs.innerHTML = '';

  const select = (channel, btn) => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    img.src = channel.qr;
    img.alt = `${channel.label} payment QR code for GGS Studio`;
    account.textContent = channel.account ? `${channel.label} — ${channel.account}` : `Scan with ${channel.label}`;
    modal.dataset.channel = channel.key;
  };

  PAYMENT_CHANNELS.forEach((channel, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.textContent = channel.label;
    btn.addEventListener('click', () => select(channel, btn));
    tabs.appendChild(btn);
    if (i === 0) select(channel, btn);
  });
}

// Uploads into the customer's own folder in the private receipts bucket and
// returns the stored path. The Edge Function re-checks both the folder and
// that the object actually exists before it touches the payment row.
async function uploadReceipt(supabase, userId, bookingId, file) {
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error('That file is over 5MB — please attach a smaller screenshot.');
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${userId}/${bookingId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`Could not upload your receipt: ${error.message}`);
  return path;
}

/**
 * Opens the QR payment modal for one booking.
 *
 * @param {object}   opts
 * @param {object}   opts.supabase       initialised Supabase client
 * @param {object}   opts.session        the signed-in session (for the Edge Function call)
 * @param {object}   opts.booking        the booking row — only `id` is required
 * @param {number}   opts.amountDue      pesos the customer has to send
 * @param {string}   opts.paymentOption  'deposit' | 'full'
 * @param {number}   [opts.depositPercent]
 * @param {string}   [opts.retryReason]  why a previous receipt was rejected
 * @param {Function} [opts.onSubmitted]  called with the updated payment row
 */
export function openPaymentModal({
  supabase,
  session,
  booking,
  amountDue,
  paymentOption,
  depositPercent,
  retryReason,
  onSubmitted,
}) {
  const modal = buildModal();
  renderChannels(modal);

  modal.querySelector('[data-pay-due]').textContent = formatPeso(amountDue);
  modal.querySelector('[data-pay-lead]').textContent = paymentOption === 'deposit'
    ? `This is the ${depositPercent || 20}% downpayment that holds your slot. The balance is settled at the studio on the day.`
    : 'This settles the whole session — nothing left to pay on the day.';

  const form = modal.querySelector('[data-pay-form]');
  const refEl = modal.querySelector('[data-pay-ref]');
  const fileEl = modal.querySelector('[data-pay-file]');
  const submitBtn = modal.querySelector('[data-pay-submit]');
  const msg = modal.querySelector('[data-pay-msg]');

  form.hidden = false;
  form.reset();
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit receipt';

  if (retryReason) {
    msg.textContent = `⚠ Your last receipt was turned down: ${retryReason}`;
    msg.classList.add('error');
    msg.style.display = 'block';
  } else {
    msg.textContent = '';
    msg.style.display = 'none';
    msg.classList.remove('error');
  }

  // Rebuilding the listener each time keeps this booking's ids in scope without
  // leaking the previous booking's handler onto the shared modal.
  const onSubmit = async (e) => {
    e.preventDefault();
    msg.classList.remove('error');
    msg.style.display = 'none';

    const file = fileEl.files?.[0];
    if (!file) {
      showError(msg, 'Please attach a photo or PDF of your receipt.');
      return;
    }
    if (!refEl.value.trim()) {
      showError(msg, 'Please enter the reference number from your receipt.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading…';
    try {
      const receiptPath = await uploadReceipt(supabase, session.user.id, booking.id, file);
      submitBtn.textContent = 'Sending…';
      const result = await callFunction('submit-receipt', session, {
        booking_id: booking.id,
        receipt_path: receiptPath,
        reference_no: refEl.value.trim(),
        channel: modal.dataset.channel,
      });

      form.hidden = true;
      msg.textContent = '✓ Receipt received. The studio will verify it shortly — watch My Bookings for the confirmation.';
      msg.classList.remove('error');
      msg.style.display = 'block';
      submitBtn.disabled = false;
      if (onSubmitted) onSubmitted(result.payment);
    } catch (err) {
      showError(msg, err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit receipt';
    }
  };

  form.onsubmit = onSubmit;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function showError(msg, text) {
  msg.textContent = `⚠ ${text}`;
  msg.classList.add('error');
  msg.style.display = 'block';
}

