import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, ownsBooking, resolveCaller } from "./guest.ts";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingUpdatedEmail,
  loadBookingEmail,
  sendEmail,
} from "./email.ts";
import { logAudit } from "./audit.ts";

// Reschedules a booking for whoever owns it — a signed-in customer, studio
// staff, or the anonymous browser that placed it (device handshake in guest.ts).
// Everything a customer is *not* allowed to change is refused below, and a
// guest is held to exactly the same rules as a signed-in customer.

function validateServiceCombo(services: { slug: string }[]): string | null {
  const slugs = services.map((s) => s.slug);
  if (slugs.includes("mixing") && !slugs.includes("recording")) {
    return "Mixing requires a recording session — add the Recording service too.";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const resolved = await resolveCaller(admin, req, body ?? {});
  if ("error" in resolved) return resolved.error;
  const caller = resolved.caller;
  const isStaff = caller.isStaff;

  const {
    booking_id,
    start_at,
    end_at,
    room_id,
    service_ids,
    notes,
    status,
    customer_id: bodyCustomerId,
    guest_name: bodyGuestName,
  } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);

  const { data: existing, error: fetchErr } = await admin
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();
  if (fetchErr || !existing) return json({ error: "Booking not found." }, 404);
  if (!ownsBooking(existing, caller)) return json({ error: "Not your booking." }, 403);

  const { data: cutoffSetting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "reschedule_cutoff_hours")
    .single();
  const cutoffHours = Number(cutoffSetting?.value ?? 24);
  const cutoffMs = cutoffHours * 3600000;

  if (!isStaff) {
    if (!["pending", "confirmed"].includes(existing.status)) {
      return json({ error: "This booking can no longer be changed." }, 400);
    }
    if (new Date(existing.start_at).getTime() - Date.now() < cutoffMs) {
      return json({ error: `Changes must be made at least ${cutoffHours} hours in advance.` }, 400);
    }
    if (status) return json({ error: "Customers cannot change booking status directly." }, 403);
    if (service_ids) return json({ error: "Customers cannot change services on an existing booking." }, 403);
    if (bodyCustomerId !== undefined || bodyGuestName !== undefined) {
      return json({ error: "Customers cannot reassign a booking to someone else." }, 403);
    }
    // A customer moving their own booking must not land it in the past.
    if (typeof start_at === "string" && new Date(start_at).getTime() < Date.now()) {
      return json({ error: "Cannot move a booking into the past." }, 400);
    }
  }

  const newRoomId = typeof room_id === "string" ? room_id : existing.room_id;
  const newStart = typeof start_at === "string" ? start_at : existing.start_at;
  const newEnd = typeof end_at === "string" ? end_at : existing.end_at;

  if (new Date(newEnd) <= new Date(newStart)) {
    return json({ error: "end_at must be after start_at." }, 400);
  }

  const durationHours = (new Date(newEnd).getTime() - new Date(newStart).getTime()) / 3600000;
  const { data: room } = await admin.from("rooms").select("hourly_rate").eq("id", newRoomId).single();
  if (!room) return json({ error: "Room not found." }, 400);
  const subtotal = Number(room.hourly_rate) * durationHours;

  let addonsTotal: number;
  let newServiceRows: { id: string; price: number; price_type: string; slug: string }[] | null = null;

  if (Array.isArray(service_ids)) {
    if (service_ids.length > 0) {
      const { data: svcRows, error: svcErr } = await admin
        .from("services")
        .select("id, price, price_type, slug")
        .in("id", service_ids);
      if (svcErr || !svcRows || svcRows.length !== service_ids.length) {
        return json({ error: "One or more services are invalid." }, 400);
      }
      newServiceRows = svcRows;
    } else {
      newServiceRows = [];
    }
    const comboError = validateServiceCombo(newServiceRows);
    if (comboError) return json({ error: comboError }, 400);
    addonsTotal = newServiceRows.reduce(
      (sum, s) => sum + (s.price_type === "hourly" ? Number(s.price) * durationHours : Number(s.price)),
      0,
    );
  } else {
    const { data: existingSvcRows } = await admin
      .from("booking_services")
      .select("price_at_booking")
      .eq("booking_id", booking_id);
    addonsTotal = (existingSvcRows ?? []).reduce((s, r) => s + Number(r.price_at_booking), 0);
  }

  const updatePayload: Record<string, unknown> = {
    room_id: newRoomId,
    start_at: newStart,
    end_at: newEnd,
    subtotal,
    total_price: Math.ceil(subtotal + addonsTotal),
  };
  if (typeof notes === "string") updatePayload.notes = notes;
  if (isStaff && typeof status === "string") updatePayload.status = status;

  // Staff may move a booking to a different customer, or to an off-system
  // walk-in by name. The two are mutually exclusive: the bookings_has_customer
  // check requires exactly one of them to be set.
  if (isStaff) {
    const guestName = typeof bodyGuestName === "string" && bodyGuestName.trim() ? bodyGuestName.trim() : null;
    if (guestName) {
      updatePayload.guest_name = guestName;
      updatePayload.customer_id = null;
    } else if (typeof bodyCustomerId === "string" && bodyCustomerId) {
      const { data: target } = await admin.from("profiles").select("id").eq("id", bodyCustomerId).single();
      if (!target) return json({ error: "That customer does not exist." }, 400);
      updatePayload.customer_id = bodyCustomerId;
      updatePayload.guest_name = null;
    }
  }

  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update(updatePayload)
    .eq("id", booking_id)
    .select()
    .single();

  if (updateErr) {
    if (updateErr.code === "23P01" || updateErr.message?.includes("no_double_booking")) {
      return json({ error: "That time slot is no longer available." }, 409);
    }
    if (updateErr.message?.includes("blocked slot")) {
      return json({ error: "That time overlaps a blocked/maintenance period." }, 409);
    }
    return json({ error: "Could not update booking.", detail: updateErr.message }, 400);
  }

  if (newServiceRows !== null) {
    await admin.from("booking_services").delete().eq("booking_id", booking_id);
    if (newServiceRows.length > 0) {
      const rows = newServiceRows.map((s) => ({
        booking_id,
        service_id: s.id,
        price_at_booking: s.price_type === "hourly" ? Number(s.price) * durationHours : Number(s.price),
      }));
      await admin.from("booking_services").insert(rows);
    }
  }

  await logAudit(
    admin,
    {
      id: caller.userId,
      role: isStaff ? "staff" : caller.userId ? "customer" : "guest",
      label: existing.guest_name
        ? `${existing.guest_name} <${existing.guest_email ?? "no email"}>`
        : (caller.email ?? existing.guest_email ?? caller.userId ?? "unknown"),
    },
    isStaff ? "booking.update" : "booking.reschedule",
    "booking",
    booking_id,
    {
      from: { start_at: existing.start_at, end_at: existing.end_at, room_id: existing.room_id, status: existing.status },
      to: { start_at: newStart, end_at: newEnd, room_id: newRoomId, status: updatePayload.status ?? existing.status },
    },
  );

  // Which mail this is depends on what actually changed: a status flip to
  // confirmed or cancelled says that, anything else reads as a reschedule.
  const newStatus = (updatePayload.status as string | undefined) ?? existing.status;
  const mail = await loadBookingEmail(admin, booking_id);
  if (mail) {
    const moved = newStart !== existing.start_at || newEnd !== existing.end_at;
    const { subject, html } = newStatus === "cancelled" && existing.status !== "cancelled"
      ? bookingCancelledEmail(mail.to, mail.booking, { byStudio: isStaff })
      : newStatus === "confirmed" && existing.status !== "confirmed"
      ? bookingConfirmedEmail(mail.to, mail.booking)
      : bookingUpdatedEmail(mail.to, mail.booking, { startAt: existing.start_at, endAt: existing.end_at });
    // A staff edit that changed nothing the customer can see isn't worth a mail.
    if (moved || newStatus !== existing.status || !isStaff) {
      await sendEmail(mail.to, subject, html);
    }
  }

  return json({ booking: updated });
});
