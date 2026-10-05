// Small pieces of the public pages that read live settings: the footer's
// contact details (edited in the dashboard under Contacts), the mailing-list
// signup, and featured reviews (hidden until the studio features one).
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function publicApi(action, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/public-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

let contactsPromise = null;
export function loadContacts() {
  if (!contactsPromise) {
    contactsPromise = getSupabase()
      .then((sb) => sb.from('app_settings').select('value').eq('key', 'contacts').maybeSingle())
      .then(({ data }) => data?.value || null)
      .catch(() => null);
  }
  return contactsPromise;
}

/** Fills [data-contact] links from the saved contacts; the HTML holds a fallback. */
export async function applyContacts(root = document) {
  const c = await loadContacts();
  if (!c) return;
  const phone = c.people?.find((p) => p.phone)?.phone;
  const set = (key, href, text) => root.querySelectorAll(`[data-contact="${key}"]`).forEach((a) => {
    if (!text) { a.hidden = true; return; }
    a.hidden = false;
    a.href = href;
    const span = a.querySelector('span') || a;
    span.textContent = text;
  });
  set('email', `mailto:${c.email}`, c.email);
  set('phone', phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '', phone);
  set('address', c.map_url || `https://maps.google.com/?q=${encodeURIComponent(c.address || '')}`, c.address);
  set('facebook', c.facebook, c.facebook ? 'Facebook' : '');
  set('instagram', c.instagram, c.instagram ? 'Instagram' : '');
}

export function initFooter() {
  applyContacts();
  const form = document.getElementById('subscribeForm');
  if (!form) return;
  const msg = document.getElementById('subscribeMsg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('input[type="email"]');
    const button = form.querySelector('button');
    msg.classList.remove('error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) {
      msg.textContent = "That doesn't look like an email address.";
      msg.classList.add('error');
      email.focus();
      return;
    }
    button.disabled = true;
    try {
      const r = await publicApi('subscribe', { email: email.value.trim(), website: form.website?.value || '' });
      msg.textContent = r.message || "Thanks, you're on the list.";
      form.reset();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
    } finally {
      button.disabled = false;
    }
  });
}

export async function initReviews() {
  const section = document.getElementById('reviews');
  if (!section) return;
  let data;
  try { data = await publicApi('reviews'); } catch { return; }
  if (!data.reviews?.length) return;
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  document.getElementById('reviewSummary').innerHTML = data.average
    ? `<strong>${data.average.toFixed(1)}</strong><span>out of 5 from ${data.count} review${data.count === 1 ? '' : 's'}</span>`
    : '';
  document.getElementById('reviewGrid').innerHTML = data.reviews.map((r) => `
    <article class="review">
      <div class="stars" aria-label="${r.rating} out of 5 stars">${stars(r.rating)}</div>
      ${r.comment ? `<blockquote>${escapeHtml(r.comment)}</blockquote>` : ''}
      ${r.photos?.length ? `<div class="review-photos">${r.photos.map((u) => `<img src="${escapeHtml(u)}" alt="Photo from ${escapeHtml(r.name)}" loading="lazy">`).join('')}</div>` : ''}
      <div class="who">${escapeHtml(r.name)}${r.date ? `, session in ${new Date(`${r.date}T12:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}` : ''}</div>
    </article>`).join('');
  section.hidden = false;
}
