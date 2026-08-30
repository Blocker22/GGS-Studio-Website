// This browser's identity for bookings made without an account.
//
// Booking asks for a name and an email, nothing else. To let the visitor come
// back and see, move, or cancel what they booked, the browser mints a random
// device id and a 32-byte secret the first time it books and keeps the pair in
// localStorage. The server only ever stores a SHA-256 of the secret, so the
// pair works like a password for this one browser (supabase/functions/_shared/
// guest.ts does the checking).
//
// That is also why an account is still worth having: the pair lives in one
// browser's storage. Clear it, or open the site on your phone, and the studio
// has no way to know it's you — which is exactly what signing in fixes, by
// claiming every booking made under the same email.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const DEVICE_KEY = 'ggs.device.v1';
const BOOKINGS_KEY = 'ggs.guestBookings.v1';

// Private-mode Safari and "block all cookies" throw on localStorage rather than
// returning null. A booking must still work there, so fall back to memory for
// the life of the tab instead of failing outright.
const memory = new Map();

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return raw;
  } catch { /* storage unavailable — fall through */ }
  return memory.get(key) ?? null;
}

function writeStore(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch { /* memory copy is all we get this session */ }
}

function clearStore(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch { /* nothing to do */ }
}

// 32 random bytes as base64url — the character set the server's SECRET_RE
// expects, and no padding to trip it up.
function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newDevice() {
  return { id: crypto.randomUUID(), secret: randomSecret() };
}

/**
 * This browser's device id and secret, created on first use. Never sent
 * anywhere but our own Edge Functions.
 */
export function getDevice() {
  const raw = readStore(DEVICE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.id && parsed?.secret) return parsed;
    } catch { /* corrupt entry — mint a fresh one below */ }
  }
  const device = newDevice();
  writeStore(DEVICE_KEY, JSON.stringify(device));
  return device;
}

/** The two fields every guest-capable Edge Function looks for in the body. */
export function deviceCredentials() {
  const device = getDevice();
  return { device_id: device.id, device_secret: device.secret };
}

// --- Local cache of what this browser booked -------------------------------
// The server is the source of truth; this is so the confirmation and the "your
// bookings" list can render instantly, and still say something useful if the
// network is down.

export function localGuestBookings() {
  const raw = readStore(BOOKINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberGuestBooking(booking) {
  if (!booking?.id) return;
  const kept = {
    id: booking.id,
    start_at: booking.start_at,
    end_at: booking.end_at,
    status: booking.status,
    total_price: booking.total_price,
    guest_name: booking.guest_name ?? null,
    guest_email: booking.guest_email ?? null,
  };
  const list = localGuestBookings().filter((b) => b.id !== kept.id);
  list.unshift(kept);
  writeStore(BOOKINGS_KEY, JSON.stringify(list.slice(0, 50)));
}

/**
 * Dropped once an account has claimed these bookings — from then on the
 * account is where they live, and a stale local copy would only go out of date.
 */
export function forgetGuestBookings() {
  clearStore(BOOKINGS_KEY);
}

/** The email this browser last booked under, used to prefill the form. */
export function lastGuestEmail() {
  return localGuestBookings().find((b) => b.guest_email)?.guest_email ?? null;
}

/** Likewise the name, so a repeat guest doesn't retype either field. */
export function lastGuestName() {
  return localGuestBookings().find((b) => b.guest_name)?.guest_name ?? null;
}

async function callFunction(name, body, accessToken = null) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
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

export { callFunction as callGuestFunction };

/**
 * The bookings this browser made anonymously, straight from the server.
 * Returns an empty list rather than throwing when the device has never booked.
 */
export async function fetchGuestBookings() {
  try {
    const data = await callFunction('guest-bookings', deviceCredentials());
    return { bookings: data.bookings ?? [], cutoffHours: Number(data.cutoff_hours ?? 24) };
  } catch (err) {
    // 401 just means this browser has no guest bookings on record — an empty
    // list, not a failure worth showing anyone.
    if (err.status === 401 || err.status === 400) return { bookings: [], cutoffHours: 24 };
    throw err;
  }
}

/**
 * Hands every booking made under this account's email over to the account.
 * Safe to call on every sign-in; it does nothing when there's nothing to claim.
 */
export async function claimGuestBookings(session) {
  if (!session?.access_token) return { claimed: 0 };
  try {
    const result = await callFunction('claim-guest-bookings', deviceCredentials(), session.access_token);
    if (result.claimed > 0) {
      forgetGuestBookings();
      window.dispatchEvent(new CustomEvent('ggs:bookings-claimed', { detail: result }));
    }
    return result;
  } catch (err) {
    // Claiming is a convenience layered on top of signing in — never let it
    // break the sign-in itself.
    console.error('[ggs] could not claim guest bookings:', err);
    return { claimed: 0, error: err.message };
  }
}
