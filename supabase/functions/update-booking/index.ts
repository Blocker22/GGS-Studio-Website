import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, normalizeEmail, ownsBooking, resolveCaller } from "../_shared/guest.ts";
import { logAudit } from "../_shared/audit.ts";
import { formatWhen, notifyStaff, sendBookingEmail } from "../_shared/email.ts";
import {
  background,
  cleanPhone,
  diff,
  loadRules,
  loadSchedule,
  priceAddons,
  publicTimeProblem,
  resolveVoucher,
  type ServiceRow,
  serviceComboProblem,
  staffName,
  UNIT_MS,
} from "../_shared/booking-core.ts";
import { computeDiscount } from "../_shared/voucher.js";

// Changes a booking. Staff may edit any field; the customer who owns it (signed
// in, or the browser that placed it) may only move it, and only within the
// public rules and the cutoff. Prices reprice against the snapshot stored on
// the booking, never today's list, so editing the price list never silently
// changes old bookings.

const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const AUDIT_FIELDS = [
  "start_at", "end_at", "room_id", "status", "notes", "guest_name", "guest_email", "guest_phone",
  "customer_id", "total_price", "custom_total", "voucher", "payment_waived", "payment_option",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = adminClient();

  // deno-lint-ignore no-explicit-any
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

  const { booking_id } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  const { data: existing } = await admin
    .from("bookings")
    .select("*, booking_services(service_id, quantity, price_at_booking, services(id, name, price, price_type, slug, is_active, requires_service_id, unit_label))")
    .eq("id", booking_id)
    .single();
  if (!existing) return json({ error: "Booking not found." }, 404);
  if (!ownsBooking(existing, caller)) return json({ error: "Not your booking." }, 403);

  const rules = await loadRules(admin);

  if (!isStaff) {
    const forbidden = ["status", "service_ids", "customer_id", "guest_name", "guest_email", "voucher_code", "custom_total", "payment_waived", "room_id", "notes"];
    if (forbidden.some(has)) return json({ error: "Only the studio can change that. Call or message us." }, 403);
    if (!["pending", "confirmed"].includes(existing.status)) return json({ error: "This booking can no longer be changed." }, 400);
    if (new Date(existing.start_at).getTime() - Date.now() < rules.cutoffHours * UNIT_MS) {
      return json({ error: `Changes must be made at least ${rules.cutoffHours} hours before the session. Please call the studio.` }, 400);
    }
  }

  const newRoomId = isStaff && typeof body.room_id === "string" ? body.room_id : existing.room_id;
  const newStart = typeof body.start_at === "string" ? body.start_at : existing.start_at;
  const newEnd = typeof body.end_at === "string" ? body.end_at : existing.end_at;
  const startMs = new Date(newStart).getTime();
  const endMs = new Date(newEnd).getTime();
  if (!(endMs > startMs)) return json({ error: "The end time must be after the start time." }, 400);
  const hours = (endMs - startMs) / UNIT_MS;
  const oldHours = (new Date(existing.end_at).getTime() - new Date(existing.start_at).getTime()) / UNIT_MS;
  const timeChanged = newStart !== existing.start_at || newEnd !== existing.end_at || newRoomId !== existing.room_id;

  if (!isStaff && timeChanged) {
    const schedule = await loadSchedule(admin, newRoomId);
    const problem = publicTimeProblem(schedule, rules, newStart, newEnd);
    if (problem) return json({ error: problem, code: "time" }, 409);
  }

  // --- Price ----------------------------------------------------------------
  let baseRate = Number(existing.rates?.hourly_rate ?? NaN);
  if (newRoomId !== existing.room_id || !Number.isFinite(baseRate)) {
    const { data: room } = await admin.from("rooms").select("hourly_rate").eq("id", newRoomId).single();
    if (!room) return json({ error: "Room not found." }, 400);
    baseRate = Number(room.hourly_rate);
  }
  const subtotal = baseRate * hours;

  // deno-lint-ignore no-explicit-any
  const kept = (existing.booking_services ?? []) as any[];
  let addonRows: Array<{ service_id: string; quantity: number; price_at_booking: number }> = [];
  let servicesChanged = false;

  // Reprices one existing line against its own snapshot.
  // deno-lint-ignore no-explicit-any
  const repriceKept = (bs: any, qty?: number) => {
    const type = bs.services?.price_type;
    const unitPrice = type === "hourly" ? Number(bs.price_at_booking) / (oldHours || 1)
      : type === "unit" ? Number(bs.price_at_booking) / (Number(bs.quantity) || 1)
      : Number(bs.price_at_booking);
    const q = qty ?? Number(bs.quantity) ?? 1;
    return { service_id: bs.service_id, quantity: q, price_at_booking: type === "hourly" ? unitPrice * hours : type === "unit" ? unitPrice * q : unitPrice };
  };

  if (isStaff && Array.isArray(body.service_ids)) {
    const ids: string[] = [...new Set(body.service_ids.filter((x: unknown) => typeof x === "string"))] as string[];
    const quantities = body.service_quantities && typeof body.service_quantities === "object" ? body.service_quantities : {};
    const { data: all } = await admin.from("services").select("id, name, price, price_type, slug, is_active, requires_service_id, unit_label");
    const selected = (all ?? []).filter((s: ServiceRow) => ids.includes(s.id)) as ServiceRow[];
    if (selected.length !== ids.length) return json({ error: "One or more add-ons are invalid." }, 400);
    const combo = serviceComboProblem(selected, (all ?? []) as ServiceRow[]);
    if (combo) return json({ error: combo }, 400);
    const keptById = new Map(kept.map((bs) => [bs.service_id, bs]));
    const fresh = priceAddons(selected.filter((s) => !keptById.has(s.id)), quantities, hours);
    addonRows = [
      ...selected.filter((s) => keptById.has(s.id)).map((s) => repriceKept(keptById.get(s.id), s.price_type === "unit" ? Math.max(1, Math.floor(Number(quantities[s.id] ?? keptById.get(s.id).quantity))) : 1)),
      ...fresh.map((a) => ({ service_id: a.service.id, quantity: a.qty, price_at_booking: a.price })),
    ];
    servicesChanged = true;
  } else {
    addonRows = kept.map((bs) => repriceKept(bs));
    servicesChanged = hours !== oldHours;
  }
  const list = Math.ceil(subtotal + addonRows.reduce((s, a) => s + a.price_at_booking, 0));

  // Voucher: unchanged code keeps its snapshot; cleared drops it; a new code
  // is re-validated, excluding this booking from the use counts.
  let voucher = existing.voucher ?? null;
  if (isStaff && has("voucher_code")) {
    const code = String(body.voucher_code ?? "").trim().toUpperCase();
    if (!code) voucher = null;
    else if (code !== existing.voucher?.code) {
      const res = await resolveVoucher(admin, code, {
        startIso: newStart, hours, list, baseRate,
        email: existing.guest_email, customerId: existing.customer_id, excludeId: existing.id,
      });
      if (res && "error" in res) return json({ error: res.error, code: "voucher" }, 400);
      voucher = res && "snapshot" in res ? res.snapshot : null;
    }
  }
  if (voucher) {
    voucher = { ...voucher, discount: computeDiscount(voucher, { list, units: hours, baseRate }) };
  }

  let customTotal = !!existing.custom_total;
  let totalPrice = Math.max(0, list - (voucher?.discount ?? 0));
  if (isStaff && has("custom_total")) {
    if (body.custom_total === null || body.custom_total === "") customTotal = false;
    else {
      const t = Number(body.custom_total);
      if (!Number.isFinite(t) || t < 0) return json({ error: "The total must be 0 or more." }, 400);
      customTotal = true;
      totalPrice = Math.round(t);
    }
  } else if (customTotal) {
    totalPrice = Number(existing.total_price);
  }

  // --- Patch ----------------------------------------------------------------
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = {
    room_id: newRoomId,
    start_at: newStart,
    end_at: newEnd,
    subtotal,
    total_price: totalPrice,
    custom_total: customTotal,
    voucher,
    rates: { hourly_rate: baseRate },
    updated_by: caller.userId,
  };
  const actorName = isStaff ? await staffName(admin, caller.userId) : null;

  if (isStaff) {
    if (has("notes")) patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    if (has("payment_waived")) patch.payment_waived = body.payment_waived === true;
    if (has("payment_option") && ["cash", "deposit", "full"].includes(body.payment_option)) patch.payment_option = body.payment_option;
    if (has("guest_phone")) patch.guest_phone = body.guest_phone ? cleanPhone(body.guest_phone) : null;
    if (has("guest_email")) patch.guest_email = body.guest_email ? normalizeEmail(body.guest_email) : null;
    if (has("status")) {
      if (!STATUSES.includes(body.status)) return json({ error: "Unknown status." }, 400);
      patch.status = body.status;
      if (body.status === "cancelled" && existing.status !== "cancelled") {
        patch.cancelled_at = new Date().toISOString();
        patch.cancelled_by = actorName || "staff";
      }
      if (body.status !== "cancelled" && existing.status === "cancelled") {
        patch.cancelled_at = null;
        patch.cancelled_by = null;
        patch.cancellation_reason = null;
      }
    }
    const guestName = typeof body.guest_name === "string" && body.guest_name.trim() ? body.guest_name.trim().slice(0, 120) : null;
    if (guestName) {
      patch.guest_name = guestName;
      if (has("customer_id") && !body.customer_id) patch.customer_id = null;
    } else if (typeof body.customer_id === "string" && body.customer_id) {
      const { data: target } = await admin.from("profiles").select("id").eq("id", body.customer_id).single();
      if (!target) return json({ error: "That customer does not exist." }, 400);
      patch.customer_id = body.customer_id;
      patch.guest_name = null;
    }
  }

  const { data: updated, error: updateErr } = await admin.from("bookings").update(patch).eq("id", booking_id).select().single();
  if (updateErr) {
    if (updateErr.code === "23P01" || updateErr.message?.includes("no_double_booking")) {
      return json({ error: existing.status === "cancelled" && patch.status && patch.status !== "cancelled"
        ? "Another booking now holds that time, so this one can't be revived as it is. Move it first."
        : "That time overlaps another booking.", code: "taken" }, 409);
    }
    if (updateErr.message?.includes("blocked slot")) return json({ error: "That time overlaps a blocked period." }, 409);
    return json({ error: "Could not update the booking.", detail: updateErr.message }, 400);
  }

  if (servicesChanged) {
    await admin.from("booking_services").delete().eq("booking_id", booking_id);
    if (addonRows.length) await admin.from("booking_services").insert(addonRows.map((r) => ({ ...r, booking_id })));
  }

  // --- Audit ----------------------------------------------------------------
  const changes = diff(existing, updated, AUDIT_FIELDS);
  if (servicesChanged && Array.isArray(body.service_ids)) {
    changes.push({ field: "add-ons", from: kept.map((k) => k.services?.name).filter(Boolean).join(", ") || "none", to: addonRows.length ? `${addonRows.length} add-on(s)` : "none" });
  }
  const onlyStatus = changes.length > 0 && changes.every((c) => ["status", "payment_waived"].includes(c.field));
  const actor = {
    id: caller.userId,
    role: isStaff ? "staff" : caller.userId ? "customer" : "guest",
    label: isStaff ? (actorName || caller.email || "staff") : existing.guest_name ? `${existing.guest_name} <${existing.guest_email ?? "no email"}>` : (caller.email ?? "customer"),
  };
  if (changes.length) {
    const sentence = onlyStatus
      ? changes.map((c) => c.field === "status" ? `Status ${c.from} to ${c.to}` : c.to ? "Payment waived" : "Payment no longer waived").join("; ")
      : null;
    await logAudit(admin, actor, onlyStatus ? "booking.status" : isStaff ? "booking.edit" : "booking.reschedule", "booking", booking_id, {
      summary: sentence,
      changes,
    });
  }

  // --- Emails ---------------------------------------------------------------
  const by = { id: caller.userId, name: actorName || (isStaff ? "staff" : "customer") };
  const becameConfirmed = updated.status === "confirmed" && existing.status !== "confirmed" && new Date(updated.end_at).getTime() > Date.now();
  const notify = body.notify !== false;
  if (becameConfirmed && notify) {
    background(sendBookingEmail(admin, booking_id, "confirmed", { by }));
  } else if (timeChanged && updated.status !== "cancelled" && notify) {
    background(sendBookingEmail(admin, booking_id, "rescheduled", {
      by,
      extra: { previous_when: `It was ${formatWhen(existing.start_at, existing.end_at)}. Here is the new time.` },
    }));
    if (!isStaff) background(notifyStaff(admin, booking_id, "staff_new_booking", { note: `Moved by the customer from ${formatWhen(existing.start_at, existing.end_at)}.` }));
  }

  return json({ booking: updated, changes });
});
