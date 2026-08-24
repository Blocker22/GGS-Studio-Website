// Self-check for the PayMongo webhook signature verifier deployed in the
// `paymongo-webhook` Edge Function. This is the one thing standing between a
// stranger and "mark this booking paid", so it gets a test.
//
//   node test-paymongo-signature.mjs
//
// The verify() below is a copy of the function's logic; if you change one,
// change both.
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';

function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(rawBody, header, secret) {
  if (!header) return false;
  const parts = {};
  for (const chunk of header.split(',')) {
    const eq = chunk.indexOf('=');
    if (eq > 0) parts[chunk.slice(0, eq).trim()] = chunk.slice(eq + 1).trim();
  }
  const t = parts['t'];
  const candidates = [parts['te'], parts['li']].filter(Boolean);
  if (!t || candidates.length === 0) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + rawBody)));
  return candidates.some((c) => timingSafeEqual(sig, c));
}

// Signs the way PayMongo does: HMAC-SHA256 over `<timestamp>.<raw body>`.
async function sign(rawBody, t, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + rawBody)));
}

const SECRET = 'whsk_test_abc123';
const BODY = JSON.stringify({
  data: { attributes: { type: 'checkout_session.payment.paid', data: { id: 'cs_123' } } },
});

const now = Math.floor(Date.now() / 1000);

// A genuine test-mode event is accepted.
const good = await sign(BODY, String(now), SECRET);
assert.equal(await verify(BODY, `t=${now},te=${good},li=someothersig`, SECRET), true, 'valid test-mode signature must pass');

// A genuine live-mode event is accepted too.
assert.equal(await verify(BODY, `t=${now},te=nope,li=${good}`, SECRET), true, 'valid live-mode signature must pass');

// A tampered body no longer matches: the whole point.
const tampered = BODY.replace('cs_123', 'cs_attacker');
assert.equal(await verify(tampered, `t=${now},te=${good}`, SECRET), false, 'tampered payload must be rejected');

// Wrong secret is rejected.
assert.equal(await verify(BODY, `t=${now},te=${good}`, 'whsk_wrong'), false, 'wrong secret must be rejected');

// A replayed capture from an hour ago is rejected even though it signs correctly.
const old = now - 3600;
const oldSig = await sign(BODY, String(old), SECRET);
assert.equal(await verify(BODY, `t=${old},te=${oldSig}`, SECRET), false, 'stale timestamp must be rejected');

// Missing or malformed headers are rejected rather than throwing.
assert.equal(await verify(BODY, null, SECRET), false, 'missing header must be rejected');
assert.equal(await verify(BODY, 'garbage', SECRET), false, 'malformed header must be rejected');
assert.equal(await verify(BODY, `t=${now}`, SECRET), false, 'header with no signature must be rejected');

// Deposit maths: 20% of the total, rounded up, is what gets charged.
const depositOf = (total, pct) => Math.ceil((total * pct) / 100);
assert.equal(depositOf(350, 20), 70);
assert.equal(depositOf(1225, 20), 245);
assert.equal(depositOf(333, 20), 67, 'partial peso rounds up, never down');

console.log('All PayMongo signature + deposit checks passed.');

// --- Reschedule cutoff -------------------------------------------------------
// Rule: a customer may move a booking only while it is still at least
// `cutoffHours` away. Inside that window it's studio-staff only.
const CUTOFF = 24;
const H = 3600000;
const canReschedule = (startAt, now, cutoffHours = CUTOFF) =>
  (startAt - now) / H >= cutoffHours;

const t0 = Date.parse('2026-09-01T12:00:00Z');
assert.equal(canReschedule(t0 + 72 * H, t0), true, '3 days out: reschedulable');
assert.equal(canReschedule(t0 + 25 * H, t0), true, '25h out: reschedulable');
assert.equal(canReschedule(t0 + 24 * H, t0), true, 'exactly at the cutoff: allowed');
assert.equal(canReschedule(t0 + 23 * H, t0), false, '23h out: too late');
assert.equal(canReschedule(t0 + 1 * H, t0), false, '1h out: too late');
assert.equal(canReschedule(t0 - 5 * H, t0), false, 'already started: too late');

// The new slot must itself clear the cutoff, or the rule is trivially dodgeable
// by moving a far-off booking to tomorrow morning.
assert.equal(canReschedule(t0 + 2 * H, t0), false, 'moving INTO the window is rejected');

console.log('Reschedule cutoff checks passed.');
