// Shared authority checks for a site where booking no longer requires an
// account.
//
// A caller reaches an Edge Function one of two ways:
//   * signed in — a real user JWT, same as before;
//   * as a guest — an anonymous browser presenting the device id and secret it
//     generated on first use (js/device.js) and has kept in localStorage since.
//
// The server stores only a SHA-256 of that secret, so the pair works like a
// password for one browser: enough to list, reschedule, or cancel the bookings
// that browser made, and nothing else. Ownership is always re-checked here
// against the row in the database — never taken from the request body.
//
// This file is deployed verbatim alongside each function that needs it; Edge
// Functions have no shared runtime, so a copy travels with each deploy.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 32+ base64url characters — js/device.js mints 32 random bytes.
const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Length-independent compare, so a wrong secret can't be narrowed down by
// timing one byte at a time.
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type DeviceResult =
  | { ok: true; deviceId: string }
  | { ok: false; error: string; status: number };

const NOT_SET_UP = "This browser isn't set up for guest bookings — reload the page and try again.";

/**
 * Checks a device id/secret pair against guest_devices.
 *
 * `register: true` (used only by create-booking) enrols a device the first time
 * it books. Everywhere else an unknown device is rejected, so a made-up id can
 * never be used to fish for someone else's bookings.
 */
export async function verifyDevice(
  admin: SupabaseClient,
  deviceId: unknown,
  deviceSecret: unknown,
  { register = false }: { register?: boolean } = {},
): Promise<DeviceResult> {
  if (typeof deviceId !== "string" || !UUID_RE.test(deviceId)) {
    return { ok: false, error: NOT_SET_UP, status: 400 };
  }
  if (typeof deviceSecret !== "string" || !SECRET_RE.test(deviceSecret)) {
    return { ok: false, error: NOT_SET_UP, status: 400 };
  }

  const hash = await sha256Hex(deviceSecret);
  const { data: row } = await admin
    .from("guest_devices")
    .select("id, secret_hash")
    .eq("id", deviceId)
    .maybeSingle();

  if (!row) {
    if (!register) {
      return {
        ok: false,
        error: "We don't recognise this browser. Sign in to see your bookings.",
        status: 401,
      };
    }
    const { error } = await admin.from("guest_devices").insert({ id: deviceId, secret_hash: hash });
    if (error) {
      // Almost certainly two tabs enrolling at once — settle it by re-reading
      // rather than failing a booking over a race.
      const { data: raced } = await admin
        .from("guest_devices")
        .select("secret_hash")
        .eq("id", deviceId)
        .maybeSingle();
      if (!raced || !sameHash(raced.secret_hash, hash)) {
        return { ok: false, error: "Could not register this browser.", status: 500 };
      }
    }
    return { ok: true, deviceId };
  }

  if (!sameHash(row.secret_hash, hash)) {
    return { ok: false, error: "We couldn't verify this browser. Sign in to see your bookings.", status: 401 };
  }

  await admin
    .from("guest_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", deviceId);

  return { ok: true, deviceId };
}

export type Caller = {
  userId: string | null;
  email: string | null;
  isStaff: boolean;
  deviceId: string | null;
};

/**
 * Works out who is calling. A valid user JWT wins; failing that, a verified
 * device makes this a guest caller. Returns a Response only when the request
 * carried neither.
 */
export async function resolveCaller(
  admin: SupabaseClient,
  req: Request,
  body: Record<string, unknown>,
  { registerDevice = false }: { registerDevice?: boolean } = {},
): Promise<{ caller: Caller } | { error: Response }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token) {
    // The anon key is also a JWT and arrives in this header on guest calls;
    // getUser simply rejects it, which is exactly the fall-through we want.
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data?.user) {
      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      // A signed-in customer may still pass their device along, so bookings
      // made on this browser before they registered stay reachable.
      let deviceId: string | null = null;
      if (body?.device_id && body?.device_secret) {
        const device = await verifyDevice(admin, body.device_id, body.device_secret, {
          register: registerDevice,
        });
        if (device.ok) deviceId = device.deviceId;
      }
      return {
        caller: {
          userId: data.user.id,
          email: data.user.email ?? null,
          isStaff: profile?.role === "staff" || profile?.role === "admin",
          deviceId,
        },
      };
    }
  }

  const device = await verifyDevice(admin, body?.device_id, body?.device_secret, {
    register: registerDevice,
  });
  if (!device.ok) return { error: json({ error: device.error }, device.status) };

  return { caller: { userId: null, email: null, isStaff: false, deviceId: device.deviceId } };
}

/** Ownership of a booking row, checked against the database rather than claimed. */
export function ownsBooking(
  booking: { customer_id: string | null; device_id: string | null },
  caller: Caller,
): boolean {
  if (caller.isStaff) return true;
  if (caller.userId && booking.customer_id === caller.userId) return true;
  // A device only speaks for bookings nobody has claimed yet. Once an account
  // owns a booking, managing it means signing in — otherwise an old shared
  // browser would keep control of a registered customer's sessions.
  if (caller.deviceId && !booking.customer_id && booking.device_id === caller.deviceId) return true;
  return false;
}

/**
 * The anti-fraud rule: an email that already has a login cannot be used to book
 * anonymously unless this browser has actually signed into that account before.
 * Returns null when the booking may proceed.
 */
export async function guestEmailBlocked(
  admin: SupabaseClient,
  email: string,
  deviceId: string,
): Promise<{ error: string; code: string } | null> {
  const { data: accountId } = await admin.rpc("account_id_for_email", { p_email: email });
  if (!accountId) return null;

  const { data: known } = await admin
    .from("guest_device_emails")
    .select("user_id")
    .eq("device_id", deviceId)
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (known?.user_id === accountId) return null;

  return {
    code: "account_exists",
    error:
      "That email already has a GGS Studio account. Sign in to book with it — " +
      "we ask for this so nobody can book in someone else's name.",
  };
}

/** Records that a device has booked under (or signed in as) an email. */
export async function linkDeviceEmail(
  admin: SupabaseClient,
  deviceId: string | null,
  email: string | null,
  userId: string | null = null,
): Promise<void> {
  if (!deviceId || !email) return;
  const row: Record<string, unknown> = { device_id: deviceId, email: email.toLowerCase() };
  if (userId) row.user_id = userId;
  await admin.from("guest_device_emails").upsert(row, { onConflict: "device_id,email" });
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
