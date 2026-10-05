// Paying online: the customer picks one of the studio's accounts (set in the
// dashboard under Payment methods), sends the exact amount, and uploads the
// receipt for staff to check by hand.
//
// Receipts go straight into the private payment-receipts bucket. The payment
// row is only ever changed by an Edge Function (submit-receipt for account or
// device callers; public-api for the signed booking link, which passes its own
// `submit`). The receipt is read on this device to prefill the reference
// number; the image never leaves the browser for that.
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { deviceCredentials, getDevice } from './device.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const RECEIPT_BUCKET = 'payment-receipts';
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export function formatPeso(amount) {
  return '₱' + Math.round(Number(amount) || 0).toLocaleString('en-PH');
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let methodsPromise = null;
/** Online methods switched on in the dashboard. */
export function loadOnlineMethods() {
  if (!methodsPromise) {
    methodsPromise = getSupabase()
      .then((sb) => sb.from('app_settings').select('value').eq('key', 'payment_methods').maybeSingle())
      .then(({ data }) => (data?.value || []).filter((m) => m.kind === 'online' && m.enabled !== false));
  }
  return methodsPromise;
}

async function callFunction(name, session, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ ...deviceCredentials(), ...body }),
  });
  const data = await res.json().catch(() => ({}));
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
        <div class="pay-qr-due"><span>Amount to send</span><strong data-pay-due>—</strong></div>
        <p class="pay-qr-lead" data-pay-lead></p>
        <div class="pay-qr-tabs" data-pay-tabs role="tablist" aria-label="Pay with"></div>
        <div class="pay-qr-figure">
          <img data-pay-qr alt="" width="240" height="240">
          <p class="pay-qr-account" data-pay-account></p>
        </div>
        <ol class="pay-qr-steps" data-pay-steps></ol>
        <h4>Send us the receipt</h4>
        <p class="field-hint pay-qr-hint">Your slot stays on hold until we've checked the receipt against the account. You'll get an email when it clears.</p>
        <form class="pay-qr-form" data-pay-form novalidate>
          <div class="field">
            <label for="payQrFile">Screenshot or PDF of the receipt</label>
            <input id="payQrFile" data-pay-file type="file" accept="image/png, image/jpeg, image/webp, image/heic, application/pdf">
            <p class="field-hint" data-pay-file-hint>Max 5 MB. The amount, reference number and date must be readable.</p>
          </div>
          <div class="field" data-pay-ref-field>
            <label for="payQrRef">Reference number</label>
            <input id="payQrRef" data-pay-ref maxlength="64" autocomplete="off" spellcheck="false">
            <p class="field-hint" data-pay-ref-hint></p>
          </div>
          <button type="submit" class="btn-primary" data-pay-submit>Submit receipt</button>
        </form>
        <div class="confirm-msg" data-pay-msg role="status"></div>
        <button type="button" class="btn-primary" data-pay-done hidden>Done</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    const after = modal._onClose;
    modal._onClose = null;
    after?.();
  };
  modal._close = close;
  modal.querySelector('[data-pay-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
  return modal;
}

function renderSteps(text, total, method) {
  return String(text || '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((line) => `<li>${escapeHtml(line.replace(/\{total\}/g, formatPeso(total)).replace(/\{account_name\}/g, method.account_name || ''))
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`)
    .join('');
}

/**
 * Opens the payment modal for one booking.
 * opts: { supabase, session, booking, amountDue, paymentOption, depositPercent,
 *         retryReason, onSubmitted, onClose, submit?: async ({ file, reference, channel }) => result }
 */
export async function openPaymentModal({ supabase, session, booking, amountDue, paymentOption, depositPercent, retryReason, onSubmitted, onClose, submit }) {
  const modal = buildModal();
  modal._onClose = onClose || null;
  const doneBtn = modal.querySelector('[data-pay-done]');
  doneBtn.hidden = true;
  doneBtn.onclick = () => modal._close();
  const methods = await loadOnlineMethods();
  const tabs = modal.querySelector('[data-pay-tabs]');
  const img = modal.querySelector('[data-pay-qr]');
  const account = modal.querySelector('[data-pay-account]');
  const steps = modal.querySelector('[data-pay-steps]');
  const refField = modal.querySelector('[data-pay-ref-field]');
  const refHint = modal.querySelector('[data-pay-ref-hint]');
  let current = methods[0];

  function select(method, btn) {
    current = method;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    img.hidden = !method.qr_url;
    if (method.qr_url) { img.src = method.qr_url; img.alt = `${method.name} QR code for GGS Studio`; }
    account.textContent = [method.name, method.account_name, method.account_number].filter(Boolean).join(' · ');
    steps.innerHTML = renderSteps(method.steps, amountDue, method);
    refField.hidden = method.needs_ref === false;
    refHint.textContent = method.ref_hint || '';
  }
  tabs.innerHTML = '';
  if (!methods.length) {
    account.textContent = 'Online payment is not available right now. Please pay at the studio, or contact us.';
    img.hidden = true;
  }
  methods.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = m.name;
    b.addEventListener('click', () => select(m, b));
    tabs.appendChild(b);
    if (i === 0) select(m, b);
  });

  modal.querySelector('[data-pay-due]').textContent = formatPeso(amountDue);
  modal.querySelector('[data-pay-lead]').textContent = paymentOption === 'deposit'
    ? `This ${depositPercent || 20}% downpayment holds your slot. The balance is paid at the studio on the day.`
    : 'This settles the whole session. Nothing left to pay on the day.';

  const form = modal.querySelector('[data-pay-form]');
  const refEl = modal.querySelector('[data-pay-ref]');
  const fileEl = modal.querySelector('[data-pay-file]');
  const fileHint = modal.querySelector('[data-pay-file-hint]');
  const submitBtn = modal.querySelector('[data-pay-submit]');
  const msg = modal.querySelector('[data-pay-msg]');
  form.hidden = !methods.length;
  form.reset();
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit receipt';
  msg.className = 'confirm-msg';
  msg.style.display = retryReason ? 'block' : 'none';
  if (retryReason) { msg.textContent = `Your last receipt was turned down: ${retryReason}`; msg.classList.add('error'); }

  // Read the receipt on this device to fill in the reference number.
  fileEl.onchange = async () => {
    const file = fileEl.files?.[0];
    if (!file || !file.type.startsWith('image/') || refEl.value.trim()) return;
    fileHint.textContent = 'Reading the receipt to fill in the reference number…';
    try {
      const { readImage, guessReference, amountsIn } = await import('./ocr.js');
      const text = await readImage(file);
      const refGuess = guessReference(text);
      const amounts = amountsIn(text);
      if (refGuess && !refEl.value.trim()) refEl.value = refGuess;
      const amountOk = amounts.some((a) => Math.abs(a - Number(amountDue)) < 1);
      fileHint.textContent = `${refGuess ? 'We filled in the reference number from the receipt. Check it.' : "We couldn't spot a reference number; type it in."}${amounts.length && !amountOk ? ` The receipt seems to show ${formatPeso(amounts[0])}, not ${formatPeso(amountDue)}.` : ''}`;
    } catch {
      fileHint.textContent = 'Max 5 MB. The amount, reference number and date must be readable.';
    }
  };

  const showError = (text) => { msg.textContent = text; msg.classList.add('error'); msg.style.display = 'block'; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    msg.classList.remove('error');
    msg.style.display = 'none';
    const file = fileEl.files?.[0];
    if (!file) return showError('Please attach a photo or PDF of your receipt.');
    if (file.size > MAX_RECEIPT_BYTES) return showError('That file is over 5 MB. Please attach a smaller screenshot.');
    if (current?.needs_ref !== false && !refEl.value.trim()) return showError('Please enter the reference number from your receipt.');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading…';
    try {
      let result;
      if (submit) {
        result = await submit({ file, reference: refEl.value.trim(), channel: current.id });
      } else {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const folder = session?.user?.id || `guest/${getDevice().id}`;
        const path = `${folder}/${booking.id}-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw new Error(`Could not upload your receipt: ${error.message}`);
        submitBtn.textContent = 'Sending…';
        result = await callFunction('submit-receipt', session, { booking_id: booking.id, receipt_path: path, reference_no: refEl.value.trim(), channel: current.id });
      }
      form.hidden = true;
      msg.textContent = "Receipt received. We'll check it shortly and email you when it clears.";
      msg.style.display = 'block';
      doneBtn.hidden = false;
      doneBtn.focus();
      onSubmitted?.(result?.payment || result);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit receipt';
    }
  };

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
