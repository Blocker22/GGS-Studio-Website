import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, verifyDevice } from "./guest.ts";

// Lists the bookings a browser made without an account.
//
// Guests have no session, so RLS gives them nothing — every read has to come
// through here, behind the device secret handshake. Only unclaimed bookings are
// returned: once someone registers and the booking belongs to an account,
// reading it means signing in.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const device = await verifyDevice(admin, body?.device_id, body?.device_secret);
  if (!device.ok) return json({ error: device.error }, device.status);

  const { data: bookings, error } = await admin
    .from("bookings")
    .select(
      "id, start_at, end_at, status, subtotal, total_price, notes, payment_option, " +
        "guest_name, guest_email, created_at, cancelled_at, room_id, " +
        "rooms(name), booking_services(quantity, price_at_booking, services(name, unit_label, price_type)), " +
        "payments(id, type, amount, status, method, reference_no, channel, rejection_reason)",
    )
    .eq("device_id", device.deviceId)
    .is("customer_id", null)
    .order("start_at", { ascending: false })
    .limit(100);

  if (error) return json({ error: "Could not load your bookings.", detail: error.message }, 500);

  const { data: cutoffSetting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "reschedule_cutoff_hours")
    .maybeSingle();

  return json({
    bookings: bookings ?? [],
    cutoff_hours: Number(cutoffSetting?.value ?? 24),
  });
});
