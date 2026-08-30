import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, linkDeviceEmail, verifyDevice } from "./guest.ts";

// Pulls every booking made anonymously under this account's email address into
// the account. Called right after a sign-in or a registration, so "register to
// keep track of your bookings" actually delivers the history — including
// sessions booked on a different device, which is the whole point of an account.
//
// The email is taken from the verified JWT, never from the request body, and
// must be confirmed: an unconfirmed address would let anyone register as
// somebody@example.com and walk off with their bookings.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not authenticated." }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Not authenticated." }, 401);
  const user = userData.user;

  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "This account has no email address." }, 400);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Whatever else happens, mark this browser as one that has signed into this
  // account — that is what makes it a "recognised device" for guest booking.
  let deviceId: string | null = null;
  if (body?.device_id && body?.device_secret) {
    const device = await verifyDevice(admin, body.device_id, body.device_secret);
    if (device.ok) deviceId = device.deviceId;
  }
  await linkDeviceEmail(admin, deviceId, email, user.id);

  if (!user.email_confirmed_at) {
    return json({
      claimed: 0,
      pending_confirmation: true,
      message: "Confirm your email address and we'll link your earlier bookings to this account.",
    });
  }

  // bookings.customer_id points at profiles, so make sure the row exists before
  // reassigning anything to it — the sign-up trigger normally creates it, but a
  // claim must not fail on a foreign key if it didn't.
  await admin
    .from("profiles")
    .upsert(
      { id: user.id, full_name: user.user_metadata?.full_name ?? null },
      { onConflict: "id", ignoreDuplicates: true },
    );

  const { data: claimed, error } = await admin
    .from("bookings")
    .update({ customer_id: user.id })
    .is("customer_id", null)
    // eq, not ilike: guest_email is always stored lowercased, and an address
    // containing "_" would be a wildcard to LIKE.
    .eq("guest_email", email)
    .select("id, start_at");

  if (error) return json({ error: "Could not link your earlier bookings.", detail: error.message }, 500);

  return json({ claimed: claimed?.length ?? 0, bookings: claimed ?? [] });
});
