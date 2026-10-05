import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  corsHeaders,
  json,
  linkDeviceEmail,
  normalizeEmail,
  resolveCaller,
} from "../_shared/guest.ts";
import { logAudit } from "../_shared/audit.ts";
import { notifyStaff, sendBookingEmail } from "../_shared/email.ts";
import {
  background,
  cleanPhone,
  clientIp,
  rateLimited,
  loadRules,
  loadSchedule,
  openBookingsFor,
  priceAddons,
  publicTimeProblem,
  resolveVoucher,
  type ServiceRow,
  serviceComboProblem,
  staffName,
  UNIT_MS,
} from "../_shared/booking-core.ts";
import { idType, maskIdNumber, validateIdNumber } from "../_shared/idcheck.js";

// Booking does not require an account. A visitor gives a name, email and phone
// and the slot is theirs; their browser keeps a device secret (see guest.ts)
// that lets them manage it, and every email carries a signed link to the
// booking page as well.
//
// Staff bookings (phone, walk-in) skip the public limits (past dates, lead
// time, opening hours, caps, ID) but never capacity: the no_double_booking
// exclusion constraint guards that for everyone, atomically.

const PAYMENT_OPTIONS = ["cash", "deposit", "full"];
const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const PAYMONGO_API = "https://api.paymongo.com/v1";

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
    id_check: bodyIdCheck,
    voucher_code,
    policy_accepted,
    newsletter_opt_in,
    return_url: bodyReturnUrl,
    // Staff-only
    status: bodyStatus,
    custom_total,
    payment_waived,
  } = body ?? {};

  if (typeof room_id !== "string") return json({ error: "room_id is required." }, 400);
  if (typeof start_at !== "string" || typeof end_at !== "string") {
    return json({ error: "start_at and end_at are required ISO timestamps." }, 400);
  }
  const start = new Date(start_at);
  const end = new Date(end_at);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return json({ error: "The end time must be after the start time." }, 400);
  }
  const hours = (end.getTime() - start.getTime()) / UNIT_MS;
  if (hours > 24) return json({ error: "A single booking can run at most 24 hours." }, 400);

  const rules = await loadRules(admin);
  // The booking form before this rework sent no phone, policy flag or ID
  // details (its terms box was required client-side). Until every browser has
  // the new page, those requests keep the old rules; v2 clients get the full set.
  const legacy = body?.v !== 2;

  // --- Who the booking is for --------------------------------------------
  let customerId: string | null = null;
  let guestName: string | null = null;
  let guestEmail: string | null = null;
  let guestPhone: string | null = cleanPhone(bodyGuestPhone);
  let deviceId: string | null = null;
  let hasAccount = false;

  if (isStaff) {
    guestName = typeof bodyGuestName === "string" && bodyGuestName.trim() ? bodyGuestName.trim().slice(0, 120) : null;
    customerId = guestName ? null : (typeof bodyCustomerId === "string" && bodyCustomerId ? bodyCustomerId : null);
    if (!customerId && !guestName) return json({ error: "Give the customer's name, or pick a registered customer." }, 400);
    guestEmail = normalizeEmail(bodyGuestEmail);
  } else {
    if (policy_accepted !== true && !legacy) {
      return json({ error: "Please accept the booking rules and terms to continue.", code: "policy" }, 400);
    }
    if (!guestPhone && !legacy) return json({ error: "Please give a mobile number we can reach you on.", code: "phone" }, 400);
    if (isGuest) {
      guestName = typeof bodyGuestName === "string" ? bodyGuestName.trim() : "";
      if (!guestName) return json({ error: "Please tell us your name." }, 400);
      if (guestName.length > 120) return json({ error: "That name is too long." }, 400);
      guestEmail = normalizeEmail(bodyGuestEmail);
      if (!guestEmail) return json({ error: "Please give a valid email address so we can confirm your booking." }, 400);
      deviceId = caller.deviceId;
      if (!deviceId) return json({ error: "This browser isn't set up for guest bookings." }, 400);
      // An email that already has an account books as a guest too; signing in
      // afterwards (the last step of the form) moves the booking into it.
      const { data: accountId } = await admin.rpc("account_id_for_email", { p_email: guestEmail });
      hasAccount = !!accountId;
    } else {
      customerId = caller.userId;
      guestEmail = caller.email;
      deviceId = caller.deviceId;
      if (typeof bodyGuestName === "string" && bodyGuestName.trim()) guestName = bodyGuestName.trim().slice(0, 120);
    }
  }

  // --- Room, schedule, public limits --------------------------------------
  const { data: room, error: roomErr } = await admin
    .from("rooms")
    .select("id, name, hourly_rate, is_active")
    .eq("id", room_id)
    .single();
  if (roomErr || !room || (!room.is_active && !isStaff)) {
    return json({ error: "Room not found or unavailable." }, 400);
  }

  if (!isStaff) {
    if (await rateLimited(admin, `book:${clientIp(req)}`, 5, 3600)) {
      return json({ error: "Too many booking requests from this connection. Please try again in an hour, or call the studio.", code: "rate" }, 429);
    }
    const schedule = await loadSchedule(admin, room.id);
    const problem = publicTimeProblem(schedule, rules, start_at, end_at);
    if (problem) return json({ error: problem, code: "time" }, 409);
    const open = await openBookingsFor(admin, { email: guestEmail, customerId });
    if (open >= rules.maxOpen) {
      return json({
        error: `You already have ${open} upcoming booking${open === 1 ? "" : "s"}. Please finish or cancel one before booking another, or call the studio.`,
        code: "limit",
      }, 409);
    }
  }

  // --- Payment route ------------------------------------------------------
  const methods = rules.methods;
  const cashOn = methods.some((m) => m.kind === "in_person" && m.enabled !== false);
  const onlineOn = methods.some((m) => m.kind === "online" && m.enabled !== false);
  let paymentOption: string = isStaff ? "cash" : (PAYMENT_OPTIONS.includes(bodyPaymentOption) ? bodyPaymentOption : "cash");
  if (!isStaff) {
    if (paymentOption === "cash" && !cashOn) return json({ error: "Paying at the studio isn't available right now. Please pay online." }, 400);
    if (paymentOption !== "cash" && !onlineOn) return json({ error: "Online payment isn't available right now. Please choose pay at the studio." }, 400);
  }

  // --- Identity check (pay at the studio) ---------------------------------
  let idImagePath: string | null = null;
  // deno-lint-ignore no-explicit-any
  let idCheck: any = null;
  if (paymentOption === "cash" && !isStaff && rules.requireIdForCash) {
    const type = idType(bodyIdCheck?.type);
    const check = validateIdNumber(bodyIdCheck?.type, bodyIdCheck?.number);
    if (!legacy) {
      if (!type) return json({ error: "Choose which ID you are using.", code: "id" }, 400);
      if (!check.ok) return json({ error: check.message, code: "id" }, 400);
    }

    if (typeof bodyIdImagePath !== "string" || !bodyIdImagePath.trim()) {
      return json({ error: "A photo of the front of your ID is required to pay at the studio.", code: "id" }, 400);
    }
    idImagePath = bodyIdImagePath.trim();
    const expectedPrefix = caller.userId ? `${caller.userId}/` : `guest/${deviceId}/`;
    if (!idImagePath.startsWith(expectedPrefix)) return json({ error: "That ID upload does not belong to you.", code: "id" }, 403);
    const slash = idImagePath.lastIndexOf("/");
    const { data: listed } = await admin.storage.from("customer-ids").list(idImagePath.slice(0, slash), { search: idImagePath.slice(slash + 1) });
    const file = listed?.find((f: { name: string }) => f.name === idImagePath!.slice(slash + 1));
    if (!file) return json({ error: "We could not find your uploaded ID. Please attach it again.", code: "id" }, 400);
    const size = Number(file.metadata?.size ?? 0);
    if (size > 2 * 1024 * 1024) return json({ error: "That ID photo is over 2 MB. Please attach a smaller one.", code: "id" }, 400);

    // Magic bytes: only real JPEG/PNG/WebP/GIF images are kept.
    const { data: blob } = await admin.storage.from("customer-ids").download(idImagePath);
    const head = blob ? new Uint8Array(await blob.slice(0, 12).arrayBuffer()) : new Uint8Array();
    const isJpeg = head[0] === 0xff && head[1] === 0xd8;
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
    const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[8] === 0x57 && head[9] === 0x45;
    if (!(isJpeg || isPng || isGif || isWebp)) {
      await admin.storage.from("customer-ids").remove([idImagePath]);
      return json({ error: "That file isn't a photo we can read. Please attach a JPG, PNG or WebP image.", code: "id" }, 400);
    }

    const read = bodyIdCheck?.read && typeof bodyIdCheck.read === "object" ? bodyIdCheck.read : {};
    idCheck = {
      type: type?.id ?? "unknown",
      label: type?.label ?? "ID photo (type not given)",
      number: type && check.ok ? maskIdNumber(check.normalised) : null,
      format_checked: !!type && check.ok && check.formatChecked,
      read: {
        type_guess: typeof read.typeGuess === "string" ? read.typeGuess.slice(0, 20) : null,
        number_found: read.numberFound === true ? true : read.numberFound === false ? false : null,
        name_found: read.nameFound === true ? true : read.nameFound === false ? false : null,
      },
      status: "pending",
      checked_by: null,
      checked_at: null,
      photo_deleted_at: null,
    };
  }

  // --- Services and price -------------------------------------------------
  const ids: string[] = Array.isArray(service_ids) ? service_ids.filter((x: unknown) => typeof x === "string") : [];
  const quantities: Record<string, unknown> = service_quantities && typeof service_quantities === "object" ? service_quantities : {};
  const { data: allServices, error: svcErr } = await admin
    .from("services")
    .select("id, name, price, price_type, slug, is_active, requires_service_id, unit_label");
  if (svcErr || !allServices) return json({ error: "Could not load services." }, 500);

  let services: ServiceRow[] = [];
  if (ids.length) {
    const unique = [...new Set(ids)];
    services = (allServices as ServiceRow[]).filter((s) => unique.includes(s.id));
    if (services.length !== unique.length) return json({ error: "One or more add-ons are invalid." }, 400);
    if (!isStaff && services.some((s) => !s.is_active)) return json({ error: "One or more add-ons are unavailable." }, 400);
  }
  const combo = serviceComboProblem(services, allServices as ServiceRow[]);
  if (combo) return json({ error: combo }, 400);

  const baseRate = Number(room.hourly_rate);
  const subtotal = baseRate * hours;
  const addons = priceAddons(services, quantities, hours);
  const list = Math.ceil(subtotal + addons.reduce((s, a) => s + a.price, 0));

  const voucher = await resolveVoucher(admin, voucher_code, {
    startIso: start_at, hours, list, baseRate, email: guestEmail, customerId,
  });
  if (voucher && "error" in voucher) return json({ error: voucher.error, code: "voucher" }, 400);

  let totalPrice = Math.max(0, list - (voucher?.discount ?? 0));
  let customTotal = false;
  if (isStaff && custom_total !== undefined && custom_total !== null && custom_total !== "") {
    const t = Number(custom_total);
    if (!Number.isFinite(t) || t < 0) return json({ error: "The total must be 0 or more." }, 400);
    totalPrice = Math.round(t);
    customTotal = true;
  }

  const status = isStaff ? (STATUSES.includes(bodyStatus) ? bodyStatus : "confirmed") : "pending";
  const actorName = isStaff ? await staffName(admin, caller.userId) : null;

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
      status,
      subtotal,
      total_price: totalPrice,
      custom_total: customTotal,
      rates: { hourly_rate: baseRate },
      voucher: voucher && "snapshot" in voucher ? voucher.snapshot : null,
      payment_option: paymentOption,
      payment_waived: isStaff && payment_waived === true,
      id_image_path: idImagePath,
      id_check: idCheck,
      notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 2000) : null,
      created_by: isStaff ? caller.userId : null,
      via: isStaff ? "staff" : "web",
      policy_accepted_at: isStaff ? null : new Date().toISOString(),
      newsletter_opt_in: newsletter_opt_in === true,
      cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
      cancelled_by: status === "cancelled" ? (actorName || "staff") : null,
    })
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === "23P01" || insertErr.message?.includes("no_double_booking")) {
      return json({ error: "That time slot was just taken. Please pick another.", code: "taken" }, 409);
    }
    if (insertErr.message?.includes("blocked slot")) {
      return json({ error: "That time overlaps a blocked period.", code: "taken" }, 409);
    }
    return json({ error: "Could not create the booking.", detail: insertErr.message }, 400);
  }

  if (addons.length) {
    await admin.from("booking_services").insert(addons.map((a) => ({
      booking_id: booking.id,
      service_id: a.service.id,
      quantity: a.qty,
      price_at_booking: a.price,
    })));
  }

  await linkDeviceEmail(admin, deviceId, guestEmail, caller.userId);

  // Consent-based mailing list: only with the explicit opt-in tick.
  if (newsletter_opt_in === true && guestEmail) {
    await admin.from("subscribers").upsert(
      { email: guestEmail.toLowerCase(), name: guestName, source: "booking", status: "subscribed", consent_note: "Ticked the opt-in on the booking form", unsubscribed_at: null },
      { onConflict: "email" },
    );
  }

  await logAudit(
    admin,
    {
      id: caller.userId,
      role: isStaff ? "staff" : isGuest ? "guest" : "customer",
      label: isStaff ? (actorName || caller.email || "staff") : guestName ? `${guestName} <${guestEmail ?? "no email"}>` : (guestEmail ?? "public"),
    },
    "booking.create",
    "booking",
    booking.id,
    { snapshot: booking, addons: addons.map((a) => ({ name: a.service.name, qty: a.qty, price: a.price })), guest: isGuest, via: booking.via },
  );

  // --- Emails, after the response ----------------------------------------
  const by = { id: caller.userId, name: actorName };
  if (isStaff) {
    if (status === "confirmed" && end.getTime() > Date.now() && guestEmail) {
      background(sendBookingEmail(admin, booking.id, "confirmed", { by }));
    }
  } else {
    background((async () => {
      await sendBookingEmail(admin, booking.id, "received", { by: { id: null, name: "system" } });
      await notifyStaff(admin, booking.id, "staff_new_booking", { note: booking.notes ? `Note from the customer: ${booking.notes}` : "" });
    })());
  }

  // A free booking is settled the moment it exists.
  if (totalPrice <= 0 || paymentOption === "cash") {
    return json({ booking, payment_required: false, payment_option: paymentOption, guest: isGuest, account_exists: hasAccount });
  }

  // --- Online payment ------------------------------------------------------
  // Live route: manual QR transfer. The customer sends the amount below to one
  // of the studio's accounts, then uploads the receipt through submit-receipt.
  // The PayMongo hosted checkout further down only runs when switched back on.
  const amountDue = paymentOption === "deposit" ? Math.ceil((totalPrice * rules.depositPercent) / 100) : totalPrice;
  const { data: pm } = await admin.from("app_settings").select("value").eq("key", "paymongo_enabled").maybeSingle();
  const paymongoKey = Deno.env.get("PAYMONGO_SECRET_KEY");

  async function fallbackToCash(notice: string) {
    await admin.from("bookings").update({ payment_option: "cash" }).eq("id", booking.id);
    return json({ booking, payment_required: false, payment_option: "cash", notice, guest: isGuest, account_exists: hasAccount });
  }

  if (pm?.value !== true || !paymongoKey) {
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
    if (payErr) return await fallbackToCash("We couldn't open an online payment. Your slot is held and payable at the studio.");
    return json({
      booking,
      payment_required: true,
      payment_method: "manual",
      payment_option: paymentOption,
      payment_id: payment.id,
      amount_due: amountDue,
      deposit_percent: rules.depositPercent,
      guest: isGuest, account_exists: hasAccount,
    });
  }

  if (amountDue * 100 < 100) return await fallbackToCash("That amount is below the online minimum. Please settle at the studio.");
  const baseUrl = typeof bodyReturnUrl === "string" && /^https?:\/\//.test(bodyReturnUrl)
    ? bodyReturnUrl.replace(/\/+$/, "") + "/"
    : (req.headers.get("origin") ?? "").replace(/\/+$/, "") + "/";
  try {
    const res = await fetch(PAYMONGO_API + "/checkout_sessions", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(paymongoKey + ":"), "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{ name: `${room.name} booking`, quantity: 1, amount: Math.round(amountDue * 100), currency: "PHP" }],
            payment_method_types: ["gcash", "card", "paymaya", "grab_pay"],
            description: "GGS Studio booking " + booking.id,
            reference_number: booking.id,
            send_email_receipt: true,
            success_url: baseUrl !== "/" ? baseUrl + "account?paid=1" : undefined,
            cancel_url: baseUrl !== "/" ? baseUrl + "account?cancelled=1" : undefined,
            metadata: { booking_id: booking.id, payment_option: paymentOption },
          },
        },
      }),
    });
    const checkout = await res.json();
    if (!res.ok) return await fallbackToCash("The payment provider rejected this checkout. Your slot is held and payable at the studio.");
    await admin.from("payments").insert({
      booking_id: booking.id,
      type: paymentOption === "deposit" ? "deposit" : "full",
      amount: amountDue,
      currency: "php",
      status: "pending",
      method: "paymongo",
      paymongo_checkout_session_id: checkout?.data?.id ?? null,
      paymongo_payment_intent_id: checkout?.data?.attributes?.payment_intent?.id ?? null,
    });
    return json({
      booking,
      payment_required: true,
      payment_method: "paymongo",
      payment_option: paymentOption,
      amount_due: amountDue,
      deposit_percent: rules.depositPercent,
      checkout_url: checkout?.data?.attributes?.checkout_url ?? null,
      guest: isGuest, account_exists: hasAccount,
    });
  } catch {
    return await fallbackToCash("We couldn't reach the payment provider. Your slot is held and payable at the studio.");
  }
});
