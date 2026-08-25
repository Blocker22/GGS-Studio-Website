// Inline, per-field validation shared by the booking form and the sign-in page.
//
// The forms carry `novalidate`, so the browser's own bubbles never fire and
// every problem is reported the same way: the offending control turns red and
// a short reason appears directly under it, rather than one generic line at
// the bottom of the card that leaves you hunting for which box it meant.
// Every error clears itself the moment that field is edited.

// The control's visual row. `.field` covers ordinary inputs/selects; the ID
// upload and the terms checkbox live in their own wrappers.
const CONTAINER = '.field, .pay-id-upload, .terms-block';

function containerOf(el) {
  return el && el.closest ? el.closest(CONTAINER) : null;
}

// The name field on /login sits inside a collapsing grid row, and only its
// `.collapse-inner` child is clipped — a message appended to the row itself
// would hang outside the animation, so it goes in the inner wrapper.
function messageHost(box) {
  return box.querySelector(':scope > .collapse-inner') || box;
}

export function setFieldError(el, message) {
  const box = containerOf(el);
  if (!box) return;
  box.classList.add('invalid');
  el.setAttribute('aria-invalid', 'true');

  const host = messageHost(box);
  let msg = host.querySelector(':scope > .field-error');
  if (!msg) {
    msg = document.createElement('p');
    msg.className = 'field-error';
    host.appendChild(msg);
  }
  msg.textContent = message;

  // Bind once per control: the listeners live as long as the page does.
  if (!el.dataset.errWatch) {
    el.dataset.errWatch = '1';
    const clear = () => clearFieldError(el);
    el.addEventListener('input', clear);
    el.addEventListener('change', clear);
  }
}

export function clearFieldError(el) {
  const box = containerOf(el);
  if (!box) return;
  box.classList.remove('invalid');
  el.removeAttribute('aria-invalid');
  const msg = messageHost(box).querySelector(':scope > .field-error');
  if (msg) msg.remove();
}

export function clearFormErrors(root) {
  root.querySelectorAll('.invalid').forEach((b) => b.classList.remove('invalid'));
  root.querySelectorAll('.field-error').forEach((m) => m.remove());
  root.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}

// Paints every problem at once — one pass through the form rather than fixing
// one field, resubmitting, and being told about the next — then puts the
// caret in the first one.
export function showFieldErrors(errors) {
  errors.forEach(([el, message]) => setFieldError(el, message));
  const first = errors[0] && errors[0][0];
  if (!first) return;
  const box = containerOf(first);
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (typeof first.focus === 'function') first.focus({ preventScroll: true });
}

export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((value || '').trim());
