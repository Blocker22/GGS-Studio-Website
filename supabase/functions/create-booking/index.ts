import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  corsHeaders,
  guestEmailBlocked,
  json,
  linkDeviceEmail,
  normalizeEmail,
  resolveCaller,
} from "./guest.ts";
import { logAudit } from "./audit.ts";

// Booking does not require an account. A visitor gives a name and an email and
// the slot is theirs; their browser keeps a device secret (see guest.ts) that
// lets them manage the booking afterwards, and registering later with the same
// email pulls the whole history into the account.
//
// The one thing an anonymous caller may not do is book under an email that
// already has a login, unless this browser has signed into that account before.

const PAYMONGO_API = "https://api.paymongo.com/v1";
const PAYMENT_OPTIONS = ["cash", "deposit", "full"];

type ServiceRow = {
  id: string;
  name: string;
  price: number;
  price_type: string;
  slug: string;
  is_active: boolean;
  requires_service_id: string | null;
  unit_label: string | null;
};

// Only 'unit'-priced services take a quantity; anything else books as one.
// Clamped to a positive integer so a bad/missing client value can't zero out
// or invert the price.
function quantityFor(service: ServiceRow, quantities: Record<string, unknown>): number {
  if (service.price_type !== "unit") return 1;
  const raw = Math.floor(Number(quantities?.[service.id]));
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

// A service may name another as its prerequisite (services.requires_service_id),
// e.g. Mixing requires Recording — you can't mix a session we didn't track.
// The rule is data, edited in the admin panel, so nothing here names a specific
// service. Chains work for free: A->B->C is caught one link at a time, because
// every selected service is checked against its own prerequisite.
function validateServiceCombo(
  selected: ServiceRow[],
  nameById: Map<string, string>,
): string | null {
  const picked = new Set(selected.map((s) => s.id));
  for (const s of selected) {
    if (s.requires_service_id && !picked.has(s.requires_service_id)) {
      const required = nameById.get(s.requires_service_id) ?? "another service";
      return `${s.name} requires ${required} — add ${required} too, or remove ${s.name}.`;
    }
  }
  return null;
}

// PayMongo takes amounts in centavos.
function toCentavos(peso: number): number {
  return Math.round(peso * 100);
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

  // A first-time visitor's browser is enrolled here — this is the only function
  // that mints a device, so an unknown id can't be used to probe anywhere else.
  const resolved = await resolveCaller(admin, req, body ?? {}, { registerDevice: true });
  if ("error" in resolved) return resolved.error;
  const caller = resolved.caller;
  const isStaff = caller.isStaff;
  const isGuest = !caller.userId;

  const {
    room_id,
    start_at,
    end_at,
    service_ids,
    service_quantities,
    notes,
    customer_id: bodyCustomerId,
    guest_name: bodyGuestName,
    guest_email: bodyGuestEmail,
    guest_phone: bodyGuestPhone,
    payment_option: bodyPaymentOption,
    id_image_path: bodyIdImagePath,
    return_url: bodyReturnUrl,
  } = body ?? {};

  if (typeof room_id !== "string") return json({ error: "room_id is required." }, 400);
  if (typeof start_at !== "string" || typeof end_at !== "string") {
    return json({ error: "start_at and end_at are required ISO timestamps." }, 400);
  }
  const start = new Date(start_at);
  const end = new Date(end_at);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return json({ error: "end_at must be after start_at." }, 400);
  }
  if (!isStaff && start.getTime() < Date.now()) {
    return json({ error: "Cannot book a time in the past." }, 400);
  }
  const ids: string[] = Array.isArray(service_ids) ? service_ids : [];
  const quantities: Record<string, unknown> = (service_quantities && typeof service_quantities === "object")
    ? service_quantities
    : {};

  // --- Who the booking is for ---------------------------------------------
  // Three shapes: staff booking for a walk-in or another customer; a signed-in
  // customer booking for themselves; an anonymous visitor booking by name and
  // email, owned by their device until they claim it.
  let customerId: string | null = null;
  let guestName: string | null = null;
  let guestEmail: string | null = null;
  let guestPhone: string | null = null;
  let deviceId: string | null = null;

  if (isStaff) {
    guestName = typeof bodyGuestName === "string" && bodyGuestName.trim() ? bodyGuestName.trim() : null;
    customerId = guestName ? null : (typeof bodyCustomerId === "string" ? bodyCustomerId : caller.userId);
    if (!customerId && !guestName) return json({ error: "customer_id or guest_name is required." }, 400);
    guestEmail = normalizeEmail(bodyGuestEmail);
  } else if (isGuest) {
    guestName = typeof bodyGuestName === "string" ? bodyGuestName.trim() : "";
    if (!guestName) return json({ error: "Please tell us your name." }, 400);
    if (guestName.length > 120) return json({ error: "That name is too long." }, 400);
    guestEmail = normalizeEmail(bodyGuestEmail);
    if (!guestEmail) return json({ error: "Please give a valid email address so we can confirm your booking." }, 400);

    deviceId = caller.deviceId;
    if (!deviceId) return json({ error: "This browser isn't set up for guest bookings." }, 400);

    const blocked = await guestEmailBlocked(admin, guestEmail, deviceId);
    if (blocked) return json(blocked, 409);

    guestPhone = typeof bodyGuestPhone === "string" && bodyGuestPhone.trim()
      ? bodyGuestPhone.trim().slice(0, 40)
      : null;
  } else {
    customerId = caller.userId;
    guestEmail = caller.email;
    deviceId = caller.deviceId;
  }

  // Staff bookings are taken in person, so they always settle as cash.
  const paymentOption: string = isStaff
    ? "cash"
    : (PAYMENT_OPTIONS.includes(bodyPaymentOption) ? bodyPaymentOption : "cash");

  // A self-serve cash booking is only accepted with a photo of a valid ID, and
  // that has to be checked server-side — a client could otherwise skip it.
  // Signed-in customers upload under their user id; guests, who have none, use
  // guest/<device id>, and either way the path must match the caller we just
  // authenticated rather than whatever the body claims.
  let idImagePath: string | null = null;
  if (paymentOption === "cash" && !isStaff) {
    if (typeof bodyIdImagePath !== "string" || !bodyIdImagePath.trim()) {
      return json({ error: "A photo of a valid ID is required to pay in cash." }, 400);
    }
    idImagePath = bodyIdImagePath.trim();
    const expectedPrefix = caller.userId ? `${caller.userId}/` : `guest/${deviceId}/`;
    if (!idImagePath.startsWith(expectedPrefix)) {
      return json({ error: "That ID upload does not belong to you." }, 403);
    }
    const slash = idImagePath.lastIndexOf("/");
    const folder = idImagePath.slice(0, slash);
    const fileName = idImagePath.slice(slash + 1);
    const { data: listed } = await admin.storage.from("customer-ids").list(folder, { search: fileName });
    if (!listed || !listed.some((f) => f.name === fileName)) {
      return json({ error: "We could not find your uploaded ID. Please attach it again." }, 400);
    }
  }

  const { data: room, error: roomErr } = await admin
    .from("rooms")
    .select("id, name, hourly_rate, is_active")
    .eq("id", room_id)
    .single();
  if (roomErr || !room || (!room.is_active && !isStaff)) {
    return json({ error: "Room not found or unavailable." }, 400);
  }

  // The whole table rather than just the selected rows: the prerequisite check
  // has to name a service that was *not* selected, which is the whole point of
  // the message. It's a handful of rows.
  const { data: allServices, error: svcErr } = await admin
    .from("services")
    .select("id, name, price, price_type, slug, is_active, requires_service_id, unit_label");
  if (svcErr || !allServices) {
    return json({ error: "Could not load services.", detail: svcErr?.message ?? null }, 500);
  }
  const nameById = new Map<string, string>((allServices as ServiceRow[]).map((s) => [s.id, s.name]));

  let services: ServiceRow[] = [];
  if (ids.length > 0) {
    const uniqueIds = [...new Set(ids)];
    services = (allServices as ServiceRow[]).filter((s) => uniqueIds.includes(s.id));
    if (services.length !== uniqueIds.length) {
      return json({ error: "One or more services are invalid." }, 400);
    }
    if (!isStaff && services.some((s) => !s.is_active)) {
      return json({ error: "One or more services are unavailable." }, 400);
    }
  }

  const comboError = validateServiceCombo(services, nameById);
  if (comboError) return json({ error: comboError }, 400);

  const durationHours = (end.getTime() - start.getTime()) / 3600000;
  const subtotal = Number(room.hourly_rate) * durationHours;
  const addonsTotal = services.reduce((sum, s) => {
    if (s.price_type === "hourly") return sum + Number(s.price) * durationHours;
    if (s.price_type === "unit") return sum + Number(s.price) * quantityFor(s, quantities);
    return sum + Number(s.price);
  }, 0);
  const totalPrice = Math.ceil(subtotal + addonsTotal);

  const { data: booking, error: insertErr } = await admin
    .from("bookings")
    .insert({
      customer_id: customerId,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      device_id: deviceId,
      room_id,
      start_at,
      end_at,
      status: isStaff ? "confirmed" : "pending",
      subtotal,
      total_price: totalPrice,
      payment_option: paymentOption,
      id_image_path: idImagePath,
      notes: typeof notes === "string" ? notes : null,
      created_by: isStaff ? caller.userId : null,
    })
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === "23P01" || insertErr.message?.includes("no_double_booking")) {
      return json({ error: "That time slot is no longer available." }, 409);
    }
    if (insertErr.message?.includes("blocked slot")) {
      return json({ error: "That time overlaps a blocked/maintenance period." }, 409);
    }
    return json({ error: "Could not create booking.", detail: insertErr.message }, 400);
  }

  // Remember which address this browser books under, so the fraud check can
  // tell "my own laptop" from a stranger's the next time round.
  await linkDeviceEmail(admin, deviceId, guestEmail, caller.userId);

  await logAudit(
    admin,
    {
      id: caller.userId,
      role: isStaff ? "staff" : isGuest ? "guest" : "customer",
      label: guestName ? `${guestName} <${guestEmail ?? "no email"}>` : (guestEmail ?? caller.userId ?? "unknown"),
    },
    "booking.create",
    "booking",
    booking.id,
    {
      room_id,
      start_at,
      end_at,
      total_price: totalPrice,
      payment_option: paymentOption,
      guest: isGuest,
    },
  );

  if (services.length > 0) {
    const rows = services.map((s) => {
      const qty = quantityFor(s, quantities);
      const price = s.price_type === "hourly"
        ? Number(s.price) * durationHours
        : s.price_type === "unit"
        ? Number(s.price) * qty
        : Number(s.price);
      return {
        booking_id: booking.id,
        service_id: s.id,
        quantity: qty,
        price_at_booking: price,
      };
    });
    await admin.from("booking_services").insert(rows);
  }

  // Cash: nothing to charge now. Staff verify the ID and take the money on the day.
  if (paymentOption === "cash") {
    return json({ booking, payment_required: false, payment_option: "cash", guest: isGuest });
  }

  // --- Online payment ------------------------------------------------------
  // Two routes live here. The live one is the manual QR transfer: the customer
  // scans the studio's GCash/BPI/GoTyme QR, sends the amount below, then
  // uploads their receipt through submit-receipt for staff to verify.
  //
  // The PayMongo hosted checkout further down is kept intact and takes over
  // again the moment app_settings.paymongo_enabled is switched back on AND the
  // PAYMONGO_SECRET_KEY Edge Function secret is set.
  const { data: settingRows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["paymongo_enabled", "deposit_percent"]);
  const setting = (key: string) => settingRows?.find((s) => s.key === key)?.value;

  const depositPercent = Number(setting("deposit_percent") ?? 20);
  const amountDue = paymentOption === "deposit"
    ? Math.ceil((totalPrice * depositPercent) / 100)
    : totalPrice;

  const paymongoEnabled = setting("paymongo_enabled") === true;
  const paymongoKey = Deno.env.get("PAYMONGO_SECRET_KEY");

  // Fall back to cash rather than stranding the customer with an unpayable
  // booking, and say so plainly instead of implying the money went through.
  async function fallbackToCash(notice: string, detail: unknown = null) {
    await admin.from("bookings").update({ payment_option: "cash" }).eq("id", booking.id);
    return json({ booking, payment_required: false, payment_option: "cash", notice, detail, guest: isGuest });
  }

  if (!paymongoEnabled || !paymongoKey) {
    // Open an unpaid manual payment row. It stays 'pending' until the customer
    // uploads a receipt ('submitted') and staff approve it ('succeeded').
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        booking_id: booking.id,
        type: paymentOption === "deposit" ? "deposit" : "full",
        amount: amountDue,
        currency: "php",
        status: "pending",
        method: "manual",
      })
      .select()
      .single();

    if (payErr) {
      return await fallbackToCash(
        "We couldn't open an online payment for this booking — your slot is held and payable in cash.",
        payErr.message,
      );
    }

    return json({
      booking,
      payment_required: true,
      payment_method: "manual",
      payment_option: paymentOption,
      payment_id: payment.id,
      amount_due: amountDue,
      deposit_percent: depositPercent,
      guest: isGuest,
    });
  }

  // --- Legacy route: PayMongo hosted checkout ------------------------------
  // PayMongo's floor is 100 centavos; a checkout below that is rejected outright.
  if (toCentavos(amountDue) < 100) {
    return await fallbackToCash(
      "That amount is below the online-payment minimum — please settle in cash at the studio.",
    );
  }

  // bodyReturnUrl is the calling page's own directory (e.g.
  // "https://host/GGS-Studio-Website/"), not just an origin — a GitHub Pages
  // project site lives under a subpath, so origin alone would 404 on redirect.
  const baseUrl = typeof bodyReturnUrl === "string" && /^https?:\/\//.test(bodyReturnUrl)
    ? bodyReturnUrl.replace(/\/+$/, "") + "/"
    : (req.headers.get("origin") ?? "").replace(/\/+$/, "") + "/";

  const label = paymentOption === "deposit"
    ? room.name + " — " + depositPercent + "% downpayment"
    : room.name + " — full payment";

  const checkoutBody = {
    data: {
      attributes: {
        line_items: [
          { name: label, quantity: 1, amount: toCentavos(amountDue), currency: "PHP" },
        ],
        payment_method_types: ["gcash", "card", "paymaya", "grab_pay"],
        description: "GGS Studio booking " + booking.id,
        reference_number: booking.id,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        success_url: baseUrl !== "/" ? baseUrl + "account?paid=1" : undefined,
        cancel_url: baseUrl !== "/" ? baseUrl + "account?cancelled=1" : undefined,
        metadata: {
          booking_id: booking.id,
          payment_option: paymentOption,
        },
      },
    },
  };

  let checkoutRes: Response;
  let checkout: any;
  try {
    checkoutRes = await fetch(PAYMONGO_API + "/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(paymongoKey + ":"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(checkoutBody),
    });
    checkout = await checkoutRes.json();
  } catch (err) {
    return await fallbackToCash(
      "We couldn't reach the payment provider — your slot is held and payable in cash.",
      String(err),
    );
  }

  if (!checkoutRes.ok) {
    return await fallbackToCash(
      "The payment provider rejected this checkout — your slot is held and payable in cash.",
      checkout?.errors?.[0]?.detail ?? null,
    );
  }

  const sessionId = checkout?.data?.id ?? null;
  const checkoutUrl = checkout?.data?.attributes?.checkout_url ?? null;
  const paymentIntentId = checkout?.data?.attributes?.payment_intent?.id ?? null;

  await admin.from("payments").insert({
    booking_id: booking.id,
    type: paymentOption === "deposit" ? "deposit" : "full",
    amount: amountDue,
    currency: "php",
    status: "pending",
    method: "paymongo",
    paymongo_checkout_session_id: sessionId,
    paymongo_payment_intent_id: paymentIntentId,
  });

  return json({
    booking,
    payment_required: true,
    payment_method: "paymongo",
    payment_option: paymentOption,
    amount_due: amountDue,
    deposit_percent: depositPercent,
    checkout_url: checkoutUrl,
    guest: isGuest,
  });
});
