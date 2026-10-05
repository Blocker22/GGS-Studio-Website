import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, json, normalizeEmail } from "../_shared/guest.ts";
import { logAudit } from "../_shared/audit.ts";
import { notifyStaff, sendBookingEmail } from "../_shared/email.ts";
import {
  background,
  clientIp,
  digits,
  loadRules,
  priceAddons,
  rateLimited,
  resolveVoucher,
  type ServiceRow,
  UNIT_MS,
} from "../_shared/booking-core.ts";
import { sha256Hex, verifyToken } from "../_shared/links.ts";
import { recordReceipt, RECEIPT_BUCKET, sniffType } from "../_shared/receipts.ts";
import { describeConditions } from "../_shared/voucher.js";
import { hasProfanity } from "../_shared/profanity.js";

// Everything the public site asks for without signing in:
//   voucher.check     preview a code against a booking
//   subscribe / unsubscribe / resubscribe   the mailing list (consent only)
//   manage.get / manage.cancel / manage.receipt_url / manage.receipt
//                     the customer's booking page behind a signed link
//   feedback.get / feedback.submit          one-time review links
//   reviews           featured reviews for the home page
// Plus GET/POST ?unsubscribe=<token> for the one-click List-Unsubscribe header.
//
// Every action is rate limited per IP. Nothing here returns a customer's phone
// or email; the booking page shows only what the customer needs.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// deno-lint-ignore no-explicit-any
type Any = any;

async function unsubscribeByToken(admin: Any, token: unknown, resubscribe = false) {
  const email = await verifyToken(admin, "unsubscribe", token);
  if (!email) return { error: "That link isn't valid. Copy the whole link from the email, or reply and ask us to remove you." };
  const now = new Date().toISOString();
  if (resubscribe) {
    await admin.from("subscribers").upsert({ email, status: "subscribed", source: "footer", unsubscribed_at: null, consent_note: "Resubscribed from the unsubscribe page" }, { onConflict: "email" });
  } else {
    await admin.from("subscribers").update({ status: "unsubscribed", unsubscribed_at: now }).eq("email", email);
  }
  return { email, status: resubscribe ? "subscribed" : "unsubscribed" };
}

/** Effective status: confirmed bookings that have ended read as completed. */
function effectiveStatus(b: Any) {
  return b.status === "confirmed" && new Date(b.end_at).getTime() < Date.now() ? "completed" : b.status;
}

async function loadManaged(admin: Any, token: unknown) {
  const id = await verifyToken(admin, "manage", token);
  if (!id) return null;
  const { data } = await admin
    .from("bookings")
    .select("id, start_at, end_at, status, total_price, payment_option, payment_waived, voucher, guest_name, guest_phone, guest_email, customer_id, cancelled_at, rooms(name), booking_services(quantity, services(name, price_type, unit_label)), payments(id, amount, status, type, method, channel, reference_no, rejection_reason, refunded_amount)")
    .eq("id", id)
    .maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = adminClient();
  const ip = clientIp(req);
  const url = new URL(req.url);

  // One-click unsubscribe (RFC 8058): mail clients POST "List-Unsubscribe=One-Click"
  // to the URL in the header, with the token in the query string.
  const oneClick = url.searchParams.get("unsubscribe");
  if (oneClick) {
    const res = await unsubscribeByToken(admin, oneClick);
    return reply(res, res.error ? 400 : 200);
  }
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  let body: Any;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid JSON body." }, 400);
  }
  const action = String(body?.action ?? "");
  if (await rateLimited(admin, `public:${ip}`, 120, 60)) return reply({ error: "Too many requests. Please slow down." }, 429);

  switch (action) {
    // ------------------------------------------------------------ vouchers
    case "voucher.check": {
      if (await rateLimited(admin, `voucher:${ip}`, 30, 3600)) return reply({ error: "Too many code checks. Try again later." }, 429);
      const { code, start_at, end_at, service_ids, service_quantities, email, room_id } = body;
      const start = new Date(start_at);
      const end = new Date(end_at);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        return reply({ ok: false, error: "Pick your date and times first, then apply the code." });
      }
      const hours = (end.getTime() - start.getTime()) / UNIT_MS;
      let roomQuery = admin.from("rooms").select("id, hourly_rate").eq("is_active", true);
      roomQuery = typeof room_id === "string" ? roomQuery.eq("id", room_id) : roomQuery.order("created_at").limit(1);
      const { data: rooms } = await roomQuery;
      const room = rooms?.[0];
      if (!room) return reply({ ok: false, error: "Room not found." });
      const ids = Array.isArray(service_ids) ? service_ids : [];
      const { data: services } = ids.length
        ? await admin.from("services").select("id, name, price, price_type, slug, is_active, requires_service_id, unit_label").in("id", ids)
        : { data: [] };
      const addons = priceAddons((services ?? []) as ServiceRow[], service_quantities ?? {}, hours);
      const list = Math.ceil(Number(room.hourly_rate) * hours + addons.reduce((s, a) => s + a.price, 0));
      const res = await resolveVoucher(admin, code, {
        startIso: start.toISOString(), hours, list, baseRate: Number(room.hourly_rate), email: normalizeEmail(email),
      });
      if (!res) return reply({ ok: false, error: "Enter a code." });
      if ("error" in res) return reply({ ok: false, error: res.error });
      const { data: v } = await admin.from("vouchers").select("*").eq("code", res.snapshot.code).single();
      return reply({
        ok: true,
        code: res.snapshot.code,
        label: res.snapshot.label,
        description: v?.description ?? null,
        discount: res.discount,
        list,
        total: Math.max(0, list - res.discount),
        conditions: describeConditions(v ?? {}),
      });
    }

    // ------------------------------------------------------------ mailing list
    case "subscribe": {
      // Same answer whether or not the address was already on the list, and a
      // filled honeypot gets the same answer too.
      const ok = reply({ ok: true, message: "Thanks. You're on the list. Every email has a one-click unsubscribe link." });
      if (body.website) return ok;
      if (await rateLimited(admin, `subscribe:${ip}`, 10, 3600)) return reply({ error: "Too many tries. Please try again later." }, 429);
      const email = normalizeEmail(body.email);
      if (!email) return reply({ error: "Please enter a valid email address." }, 400);
      const { data: existing } = await admin.from("subscribers").select("id, status").eq("email", email).maybeSingle();
      if (!existing) {
        await admin.from("subscribers").insert({
          email,
          name: typeof body.name === "string" ? body.name.trim().slice(0, 120) || null : null,
          source: "footer",
          consent_note: "Signed up with the website footer form",
        });
      } else if (existing.status === "unsubscribed") {
        await admin.from("subscribers").update({ status: "subscribed", unsubscribed_at: null, subscribed_at: new Date().toISOString(), consent_note: "Signed up again with the website footer form" }).eq("id", existing.id);
      }
      return ok;
    }
    case "unsubscribe":
    case "resubscribe": {
      const res = await unsubscribeByToken(admin, body.t, action === "resubscribe");
      return reply(res, res.error ? 400 : 200);
    }

    // ------------------------------------------------------------ booking page
    case "manage.get": {
      const b = await loadManaged(admin, body.t);
      if (!b) return reply({ error: "This booking link isn't valid. Open the latest email from us, or contact the studio." }, 404);
      const rules = await loadRules(admin);
      const payments = (b.payments ?? []).filter((p: Any) => p.type !== "refund");
      const paid = payments.filter((p: Any) => ["succeeded", "partially_refunded"].includes(p.status)).reduce((s: number, p: Any) => s + Number(p.amount), 0);
      const open = payments.find((p: Any) => p.method === "manual" && ["pending", "submitted", "rejected"].includes(p.status));
      const status = effectiveStatus(b);
      const cutoffAt = new Date(new Date(b.start_at).getTime() - rules.cutoffHours * UNIT_MS);
      const methods = rules.methods.filter((m: Any) => m.kind === "online" && m.enabled !== false)
        .map((m: Any) => ({ id: m.id, name: m.name, account_name: m.account_name, account_number: m.account_number, qr_url: m.qr_url, steps: m.steps, needs_ref: m.needs_ref !== false, ref_hint: m.ref_hint }));
      return reply({
        booking: {
          ref: b.id.slice(0, 8).toUpperCase(),
          first_name: (b.guest_name || "").split(" ")[0] || null,
          start_at: b.start_at,
          end_at: b.end_at,
          status,
          room: b.rooms?.name ?? null,
          addons: (b.booking_services ?? []).map((bs: Any) => bs.services?.price_type === "unit" ? `${bs.services.name} (${bs.quantity} ${bs.services.unit_label || "unit"})` : bs.services?.name).filter(Boolean),
          total: Number(b.total_price),
          voucher: b.voucher ? { code: b.voucher.code, label: b.voucher.label, discount: b.voucher.discount } : null,
          payment: {
            option: b.payment_option,
            waived: b.payment_waived,
            paid,
            balance: Math.max(0, Number(b.total_price) - paid),
            open: open ? { amount: Number(open.amount), status: open.status, rejection_reason: open.rejection_reason, channel: open.channel } : null,
          },
          cancelled_at: b.cancelled_at,
        },
        can_cancel: ["pending", "confirmed"].includes(status) && Date.now() < cutoffAt.getTime(),
        cutoff_hours: rules.cutoffHours,
        cutoff_at: cutoffAt.toISOString(),
        verify_with: b.guest_phone && digits(b.guest_phone).length >= 4 ? "phone" : "email",
        methods,
      });
    }
    case "manage.cancel": {
      const b = await loadManaged(admin, body.t);
      if (!b) return reply({ error: "This booking link isn't valid." }, 404);
      if (await rateLimited(admin, `manage-ip:${ip}`, 10, 3600) || await rateLimited(admin, `manage-b:${b.id}`, 5, 3600)) {
        return reply({ error: "Too many attempts. Try again in an hour, or call the studio." }, 429);
      }
      const rules = await loadRules(admin);
      const status = effectiveStatus(b);
      if (!["pending", "confirmed"].includes(status)) return reply({ error: "This booking can't be cancelled online any more." }, 400);
      if (new Date(b.start_at).getTime() - Date.now() < rules.cutoffHours * UNIT_MS) {
        return reply({ error: `Online cancellation closes ${rules.cutoffHours} hours before the session. Please call the studio.` }, 400);
      }
      const proof = String(body.verify ?? "").trim();
      const phoneDigits = digits(b.guest_phone);
      const ok = phoneDigits.length >= 4
        ? digits(proof) === phoneDigits.slice(-4)
        : !!b.guest_email && proof.toLowerCase() === String(b.guest_email).toLowerCase();
      if (!ok) {
        return reply({ error: phoneDigits.length >= 4 ? "Those aren't the last 4 digits of the phone number on this booking." : "That isn't the email address on this booking." }, 403);
      }
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
      const { error } = await admin.from("bookings").update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "customer",
        cancellation_reason: reason,
      }).eq("id", b.id);
      if (error) return reply({ error: "Could not cancel the booking." }, 400);
      await logAudit(admin, { id: null, role: "public", label: b.guest_name ? `${b.guest_name} (booking link)` : "customer (booking link)" }, "booking.status", "booking", b.id, {
        summary: "Cancelled by the customer from their booking link",
        reason,
        changes: [{ field: "status", from: b.status, to: "cancelled" }],
      });
      background((async () => {
        await sendBookingEmail(admin, b.id, "cancelled_customer", { by: { id: null, name: "customer" } });
        await notifyStaff(admin, b.id, "staff_cancelled");
      })());
      return reply({ ok: true });
    }
    case "manage.receipt_url": {
      const b = await loadManaged(admin, body.t);
      if (!b) return reply({ error: "This booking link isn't valid." }, 404);
      if (await rateLimited(admin, `receipt:${ip}`, 20, 3600)) return reply({ error: "Too many uploads. Try again later." }, 429);
      const ext = String(body.ext ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      const path = `manage/${b.id}/${Date.now()}.${ext}`;
      const { data, error } = await admin.storage.from(RECEIPT_BUCKET).createSignedUploadUrl(path);
      if (error) return reply({ error: "Could not prepare the upload." }, 500);
      return reply({ path, token: data.token, signed_url: data.signedUrl });
    }
    case "manage.receipt": {
      const b = await loadManaged(admin, body.t);
      if (!b) return reply({ error: "This booking link isn't valid." }, 404);
      const path = String(body.path ?? "");
      if (!path.startsWith(`manage/${b.id}/`)) return reply({ error: "That upload doesn't belong to this booking." }, 403);
      const res = await recordReceipt(admin, b.id, { path, reference: String(body.reference_no ?? ""), channel: String(body.channel ?? "") });
      if (res.error) return reply({ error: res.error }, res.status ?? 400);
      return reply({ ok: true, status: res.payment.status });
    }

    // ------------------------------------------------------------ feedback
    case "feedback.get":
    case "feedback.submit": {
      const token = String(body.t ?? "");
      if (token.length < 20) return reply({ error: "This review link isn't valid." }, 404);
      const hash = await sha256Hex(token);
      const { data: b } = await admin.from("bookings")
        .select("id, guest_name, start_at, feedback_sent_at, customer_id, profiles!bookings_customer_id_fkey(full_name)")
        .eq("feedback_token_hash", hash).maybeSingle();
      if (!b) return reply({ error: "This review link isn't valid, or it was replaced by a newer one." }, 404);
      if (b.feedback_sent_at && Date.now() - new Date(b.feedback_sent_at).getTime() > 30 * 86400000) {
        return reply({ error: "This review link has expired. Thanks for thinking of us." }, 410);
      }
      const { data: existing } = await admin.from("feedback").select("id").eq("booking_id", b.id).maybeSingle();
      const name = (b as Any).profiles?.full_name || b.guest_name || "Guest";
      if (action === "feedback.get") {
        return reply({ name: name.split(" ")[0], date: b.start_at, done: !!existing });
      }
      if (existing) return reply({ error: "You already left a review for this session. Thank you." }, 409);
      if (await rateLimited(admin, `feedback:${ip}`, 10, 3600)) return reply({ error: "Too many tries. Please try again later." }, 429);

      const rating = Math.round(Number(body.rating));
      if (!(rating >= 1 && rating <= 5)) return reply({ error: "Pick a rating from 1 to 5 stars." }, 400);
      const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1500) : "";
      if (hasProfanity(comment)) return reply({ error: "Please reword your comment without strong language." }, 400);

      const photos: string[] = [];
      const files = Array.isArray(body.photos) ? body.photos.slice(0, 3) : [];
      for (const f of files) {
        const b64 = String(f?.content ?? "").replace(/^data:[^,]+,/, "");
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        } catch {
          return reply({ error: "One of the photos couldn't be read." }, 400);
        }
        if (bytes.length > 3 * 1024 * 1024) return reply({ error: "Each photo must be under 3 MB." }, 400);
        const type = sniffType(bytes.slice(0, 12));
        if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type)) return reply({ error: "Photos must be JPG, PNG or WebP." }, 400);
        const path = `${b.id}/${crypto.randomUUID()}.${type.split("/")[1].replace("jpeg", "jpg")}`;
        const { error } = await admin.storage.from("review-photos").upload(path, bytes, { contentType: type });
        if (error) return reply({ error: "Could not save a photo. Try again without it." }, 500);
        photos.push(path);
      }

      const parts = name.trim().split(/\s+/);
      const display = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
      const { data: row, error } = await admin.from("feedback").insert({
        booking_id: b.id,
        name,
        display_name: display,
        booking_date: new Date(b.start_at).toISOString().slice(0, 10),
        rating,
        comment: comment || null,
        photos,
      }).select("id").single();
      if (error) return reply({ error: "Could not save your review." }, 400);
      await logAudit(admin, { id: null, role: "public", label: display }, "feedback.create", "feedback", row.id, {
        summary: `${rating}-star review`,
        booking_id: b.id,
      });
      return reply({ ok: true });
    }

    case "reviews": {
      const { data } = await admin.from("feedback").select("id, display_name, rating, comment, photos, booking_date, featured_at").eq("featured", true).order("featured_at", { ascending: false }).limit(12);
      const { data: all } = await admin.from("feedback").select("rating");
      const reviews = await Promise.all((data ?? []).map(async (r: Any) => {
        const urls = r.photos?.length
          ? ((await admin.storage.from("review-photos").createSignedUrls(r.photos, 86400)).data ?? []).map((u: Any) => u.signedUrl).filter(Boolean)
          : [];
        return { id: r.id, name: r.display_name, rating: r.rating, comment: r.comment, date: r.booking_date, photos: urls };
      }));
      const ratings = (all ?? []).map((r: Any) => r.rating);
      return reply({
        reviews,
        count: ratings.length,
        average: ratings.length ? Math.round((ratings.reduce((s: number, n: number) => s + n, 0) / ratings.length) * 10) / 10 : null,
      });
    }

    default:
      return reply({ error: "Unknown action." }, 400);
  }
});
