import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, normalizeEmail } from "../_shared/guest.ts";
import { logAudit } from "../_shared/audit.ts";
import {
  appendEmailLog,
  bookingContext,
  bookingRows,
  type BookingEmailData,
  button,
  deliver,
  escapeHtml,
  formatWhen,
  INBOX_ENABLED,
  layout,
  loadBookingEmail,
  loadEmailSettings,
  MAILBOXES,
  paragraphs,
  peso,
  render,
  replyToFor,
  sendBookingEmail,
  table,
} from "../_shared/email.ts";
import { TEMPLATES } from "../_shared/email-templates.js";
import { checkWindow, hoursFor, localDate, localMs, normaliseRule, openWindow, blockedRanges, addDays, MAX_RULES, time12 } from "../_shared/schedule.js";
import { loadSchedule, voucherUses } from "../_shared/booking-core.ts";
import { randomToken, sha256Hex, SITE_URL, unsubscribeUrl } from "../_shared/links.ts";
import { storeMessage } from "../_shared/mailstore.ts";
import { ingestReceived, resendGet, resendKey } from "../_shared/inbound.ts";
import { normaliseCode } from "../_shared/voucher.js";

// The dashboard's server side: every staff action that needs the service role,
// sends mail, or must enforce a rule RLS can't express. Plain reads and simple
// edits (feedback flags, settings rows, voucher pause) go straight through
// Postgres with RLS instead.

// deno-lint-ignore no-explicit-any
type Any = any;
type Staff = { id: string; name: string; role: string; email: string | null };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN")?.trim() || "ggsstudio.site";

async function staffFromRequest(admin: Any, req: Request): Promise<Staff | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: p } = await admin.from("profiles").select("role, full_name").eq("id", data.user.id).single();
  if (!p || !["staff", "admin"].includes(p.role)) return null;
  return { id: data.user.id, name: p.full_name || data.user.email || "Staff", role: p.role, email: data.user.email ?? null };
}

const actorOf = (s: Staff) => ({ id: s.id, role: s.role, label: s.name });
const by = (s: Staff) => ({ id: s.id, name: s.name });

/** A believable booking for template previews and test sends. */
function sampleBooking(): BookingEmailData {
  const day = addDays(localDate(new Date()), 3);
  return {
    id: "57d52fbf-0000-4000-8000-000000000000",
    roomName: "Main Room",
    startAt: new Date(localMs(day, "14:00")).toISOString(),
    endAt: new Date(localMs(day, "16:00")).toISOString(),
    totalPrice: 900,
    paymentOption: "cash",
    status: "confirmed",
    services: ["Mixing (2 songs)"],
    phone: "0917 482 3316",
    email: "sample@example.com",
    voucher: null,
    paid: 0,
    amountDue: null,
    manageUrl: `${SITE_URL}/booking`,
  };
}

// ------------------------------------------------------------------ alternatives

/** Free windows of the same length, nearest to the original start first. */
async function findAlternatives(admin: Any, booking: Any) {
  const schedule = await loadSchedule(admin, booking.room_id);
  const length = new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime();
  const origin = new Date(booking.start_at).getTime();
  const from = new Date(Math.max(Date.now(), origin - 7 * 86400000));
  const to = new Date(origin + 21 * 86400000);
  const { data: busy } = await admin
    .from("bookings")
    .select("start_at, end_at")
    .eq("room_id", booking.room_id)
    .neq("status", "cancelled")
    .neq("id", booking.id)
    .lt("start_at", to.toISOString())
    .gt("end_at", from.toISOString());
  const taken = (busy ?? []).map((b: Any) => [new Date(b.start_at).getTime(), new Date(b.end_at).getTime()]);
  const candidates: Array<{ start: number; end: number; day: string }> = [];
  for (let d = localDate(from); d <= localDate(to); d = addDays(d, 1)) {
    const info = hoursFor(schedule, d);
    const win = openWindow(info);
    if (!win) continue;
    const blocks = blockedRanges(info);
    for (let s = win[0]; s + length <= win[1]; s += 30 * 60000) {
      const e = s + length;
      if (s <= Date.now()) continue;
      if (s < origin + length && e > origin) continue; // the slot being cancelled
      if (blocks.some(([a, b]) => s < b && e > a)) continue;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      candidates.push({ start: s, end: e, day: d });
    }
  }
  candidates.sort((a, b) => Math.abs(a.start - origin) - Math.abs(b.start - origin));
  const perDay = new Map<string, number>();
  const out: Array<{ start_at: string; end_at: string; label: string }> = [];
  for (const c of candidates) {
    if ((perDay.get(c.day) ?? 0) >= 2) continue;
    perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
    out.push({ start_at: new Date(c.start).toISOString(), end_at: new Date(c.end).toISOString(), label: formatWhen(new Date(c.start).toISOString(), new Date(c.end).toISOString()) });
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

function alternativesHtml(alts: Array<{ start_at: string; end_at: string }>): string {
  if (!alts.length) return "";
  const rows = alts.slice(0, 6).map((a) => {
    const date = localDate(new Date(a.start_at));
    const start = new Date(new Date(a.start_at).getTime() + 8 * 3600000).toISOString().slice(11, 16);
    const end = new Date(new Date(a.end_at).getTime() + 8 * 3600000).toISOString().slice(11, 16);
    const href = `${SITE_URL}/?date=${date}&start=${start}&end=${end}#book`;
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #253033;color:#eef3f2;font-size:14px;">${escapeHtml(formatWhen(a.start_at, a.end_at))}</td>
      <td style="padding:8px 0;border-bottom:1px solid #253033;text-align:right;"><a href="${escapeHtml(href)}" style="color:#ffd558;font-size:14px;font-weight:600;text-decoration:none;">Book this</a></td></tr>`;
  }).join("");
  return `<p style="margin:4px 0 8px;font-weight:600;">These times are still free:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;border-top:1px solid #253033;">${rows}</table>`;
}

// ------------------------------------------------------------------ schedule

async function affectedBookings(admin: Any) {
  const { data: rows } = await admin
    .from("bookings")
    .select("id, room_id, start_at, end_at, status, guest_name, guest_email, guest_phone, customer_id, schedule_notice_at, profiles!bookings_customer_id_fkey(full_name)")
    .in("status", ["pending", "confirmed"])
    .gt("start_at", new Date().toISOString())
    .order("start_at");
  const schedules = new Map<string, Any>();
  const out: Any[] = [];
  for (const b of rows ?? []) {
    if (!schedules.has(b.room_id)) schedules.set(b.room_id, await loadSchedule(admin, b.room_id));
    const problem = checkWindow(schedules.get(b.room_id), b.start_at, b.end_at, { publicView: false });
    if (!problem) continue;
    const info = hoursFor(schedules.get(b.room_id), localDate(new Date(b.start_at)));
    const why = info.note ? ` (${info.note})` : "";
    const changeNote = problem.code === "closed" || problem.code === "full"
      ? `We're closed on ${formatWhen(b.start_at, b.end_at).split(",").slice(0, 2).join(",")}${why}, so we can't host your session that day.`
      : problem.code === "hours"
      ? `We're only open ${time12(info.open)} to ${time12(info.close)} that day, so your session no longer fits our hours.`
      : `We can't host bookings from ${info.blocks.map((x: Any) => `${time12(x.from)} to ${time12(x.to)}`).join(", ")} that day${why}, which overlaps your session.`;
    out.push({
      id: b.id,
      name: b.profiles?.full_name || b.guest_name || "Customer",
      email: b.guest_email,
      phone: b.guest_phone,
      start_at: b.start_at,
      end_at: b.end_at,
      status: b.status,
      reason: problem.message,
      change_note: changeNote,
      notice_sent_at: b.schedule_notice_at,
    });
  }
  return out;
}

// ------------------------------------------------------------------ campaigns

function campaignHtml(c: Any, unsubscribe: string | null) {
  const img = c.image_url ? `<img src="${escapeHtml(c.image_url)}" alt="" width="484" style="display:block;width:100%;max-width:484px;height:auto;border-radius:10px;margin:0 0 18px;">` : "";
  return layout({
    headline: c.headline || c.subject,
    preheader: c.preheader || "",
    body: `${img}${paragraphs(c.body || "")}${button(c.button_label || "", c.button_url || null)}`,
    footer: "You get this because you joined the GGS Studio mailing list.",
    extraFooter: unsubscribe
      ? `<p style="margin:10px 0 0;color:#9aa7a5;font-size:12px;"><a href="${escapeHtml(unsubscribe)}" style="color:#9aa7a5;">Unsubscribe</a> with one click.</p>`
      : "",
  });
}

function validCampaign(c: Any): string | null {
  if (!c || typeof c !== "object") return "Missing campaign.";
  if (!String(c.subject ?? "").trim()) return "Add a subject line.";
  if (!String(c.body ?? "").trim()) return "Write the message.";
  if (c.image_url && !String(c.image_url).startsWith(`${SUPABASE_URL}/storage/v1/object/public/site-files/`)) {
    return "Upload the image here first; outside image links aren't allowed.";
  }
  if (c.button_url && !/^https?:\/\//.test(String(c.button_url))) return "The button link must start with https://";
  return null;
}

function oneClickUrl(token: string) {
  return `${SUPABASE_URL}/functions/v1/public-api?unsubscribe=${encodeURIComponent(token)}`;
}

// ------------------------------------------------------------------ handler

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = adminClient();
  const staff = await staffFromRequest(admin, req);
  if (!staff) return json({ error: "Your session has expired. Sign in again." }, 401);

  let body: Any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const action = String(body?.action ?? "");
  await loadEmailSettings(admin);

  switch (action) {
    // ------------------------------------------------------------ status
    case "status": {
      const { data: keyRow } = await admin.from("app_secrets").select("key").in("key", ["gemini_api_key", "GEMINI_API_KEY"]).limit(1);
      const { data: hook } = await admin.from("app_secrets").select("key").eq("key", "resend_webhook_secret").maybeSingle();
      return json({
        email_configured: !!resendKey(),
        inbox_enabled: INBOX_ENABLED,
        webhook_secret: !!(Deno.env.get("RESEND_WEBHOOK_SECRET") || hook),
        assistant_key_set: !!(Deno.env.get("GEMINI_API_KEY") || keyRow?.length),
        mail_domain: MAIL_DOMAIN,
        mailboxes: MAILBOXES,
        site_url: SITE_URL,
      });
    }

    // ------------------------------------------------------------ bookings
    case "booking.alternatives": {
      const { data: b } = await admin.from("bookings").select("id, room_id, start_at, end_at").eq("id", body.booking_id).single();
      if (!b) return json({ error: "Booking not found." }, 404);
      return json({ alternatives: await findAlternatives(admin, b) });
    }

    case "booking.cancel": {
      const { data: b } = await admin.from("bookings").select("*").eq("id", body.booking_id).single();
      if (!b) return json({ error: "Booking not found." }, 404);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
      const alts = (Array.isArray(body.alternatives) ? body.alternatives : []).slice(0, 6)
        .filter((a: Any) => a?.start_at && a?.end_at && new Date(a.end_at) > new Date(a.start_at));
      const emailOpts = {
        by: by(staff),
        extra: { reason_note: reason ? `Reason: ${reason}` : "", note },
        extraHtml: alternativesHtml(alts),
      };
      if (body.preview) {
        const p = await sendBookingEmail(admin, b.id, "cancelled_staff", { ...emailOpts, preview: true });
        return json({ subject: p.subject, html: p.html, to: p.to });
      }
      if (b.status === "cancelled") return json({ error: "This booking is already cancelled." }, 400);
      const { error } = await admin.from("bookings").update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: staff.name,
        cancellation_reason: reason || null,
        updated_by: staff.id,
      }).eq("id", b.id);
      if (error) return json({ error: "Could not cancel the booking." }, 400);
      await logAudit(admin, actorOf(staff), "booking.status", "booking", b.id, {
        summary: `Cancelled${reason ? `: ${reason}` : ""}`,
        changes: [{ field: "status", from: b.status, to: "cancelled" }],
        notified: body.notify !== false,
        alternatives: alts.length,
      });
      let emailError: string | null = null;
      if (body.notify !== false) {
        const res = await sendBookingEmail(admin, b.id, "cancelled_staff", emailOpts);
        if (!res.ok) emailError = res.error || "The email could not be sent.";
      }
      return json({ ok: true, email_error: emailError });
    }

    case "booking.email": {
      const type = String(body.type ?? "");
      const { data: b } = await admin.from("bookings").select("id").eq("id", body.booking_id).single();
      if (!b) return json({ error: "Booking not found." }, 404);
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1500) : "";
      let buttonUrl: string | undefined;
      // A thank-you by hand makes a fresh review link and retires the old one.
      if (type === "thank_you" && !body.preview) {
        const token = randomToken();
        await admin.from("bookings").update({ feedback_token_hash: await sha256Hex(token), feedback_sent_at: new Date().toISOString() }).eq("id", b.id);
        buttonUrl = `${SITE_URL}/feedback?t=${encodeURIComponent(token)}`;
      } else if (type === "thank_you") {
        buttonUrl = `${SITE_URL}/feedback`;
      }
      let res: Any;
      if (type === "custom") {
        const subject = String(body.subject ?? "").trim();
        const message = String(body.message ?? "").trim();
        if (!subject || !message) return json({ error: "Write a subject and a message." }, 400);
        const mail = await loadBookingEmail(admin, b.id);
        if (!mail) return json({ error: "Booking not found." }, 404);
        const ctx = bookingContext(mail.to, mail.booking);
        const fill = (s: string) => s.replace(/\{([a-z_]+)\}/g, (m, k) => (k in ctx ? ctx[k] : m));
        const html = layout({
          headline: fill(subject),
          body: paragraphs(fill(message)) + (body.include_details ? table(bookingRows(mail.booking)) : "") + button("View your booking", mail.booking.manageUrl),
          footer: `Sent by ${staff.name}, GGS Studio.`,
        });
        if (body.preview) return json({ subject: fill(subject), html, to: mail.to.email });
        if (!mail.to.email) return json({ error: "This booking has no email address." }, 400);
        const sent = await deliver(mail.to, fill(subject), html);
        if (!sent.ok) return json({ error: sent.error || "The email could not be sent." }, 502);
        await storeMessage(admin, { mailbox: "booking", direction: "out", from_addr: MAILBOXES.booking, from_name: "GGS Studio", to_addrs: [mail.to.email], counterpart: mail.to.email, subject: fill(subject), html_body: html, provider_id: sent.id ? `out:${sent.id}` : null, kind: "custom", sent_by: staff.id, sent_by_name: staff.name, booking_id: b.id });
        await appendEmailLog(admin, b.id, { type: "custom", subject: fill(subject), by: staff.name });
        res = { ok: true, subject: fill(subject) };
      } else {
        if (!["received", "confirmed", "thank_you", "schedule_change", "rescheduled", "payment_receipt"].includes(type)) {
          return json({ error: "Unknown email type." }, 400);
        }
        res = await sendBookingEmail(admin, b.id, type, {
          by: by(staff),
          preview: !!body.preview,
          buttonUrl,
          extra: { note, change_note: note || "" },
        });
        if (body.preview) return json({ subject: res.subject, html: res.html, to: res.to });
        if (!res.ok) return json({ error: res.error || "The email could not be sent." }, 502);
      }
      await logAudit(admin, actorOf(staff), "email.send", "booking", b.id, { summary: `Sent "${res.subject}"`, type });
      return json({ ok: true, subject: res.subject });
    }

    case "booking.id_check": {
      const status = String(body.status ?? "");
      if (!["verified", "rejected", "pending"].includes(status)) return json({ error: "Unknown status." }, 400);
      const { data: b } = await admin.from("bookings").select("id, id_check").eq("id", body.booking_id).single();
      if (!b?.id_check) return json({ error: "This booking has no ID on file." }, 404);
      const check = { ...b.id_check, status, checked_by: status === "pending" ? null : staff.name, checked_at: status === "pending" ? null : new Date().toISOString() };
      await admin.from("bookings").update({ id_check: check }).eq("id", b.id);
      await logAudit(admin, actorOf(staff), "booking.id", "booking", b.id, {
        summary: status === "verified" ? "ID looks right" : status === "rejected" ? "ID has a problem" : "ID check reset",
      });
      return json({ id_check: check });
    }

    case "booking.id_photo_delete": {
      const { data: b } = await admin.from("bookings").select("id, id_image_path, id_check").eq("id", body.booking_id).single();
      if (!b?.id_image_path) return json({ error: "There is no ID photo to delete." }, 404);
      await admin.storage.from("customer-ids").remove([b.id_image_path]);
      const check = b.id_check ? { ...b.id_check, photo_deleted_at: new Date().toISOString() } : null;
      await admin.from("bookings").update({ id_image_path: null, id_check: check }).eq("id", b.id);
      await logAudit(admin, actorOf(staff), "booking.id", "booking", b.id, { summary: "ID photo deleted by staff" });
      return json({ id_check: check });
    }

    // ------------------------------------------------------------ email templates
    case "emails.preview":
    case "emails.test": {
      const type = String(body.type ?? "");
      if (!(TEMPLATES as Any)[type]) return json({ error: "Unknown email type." }, 400);
      const saved = body.saved && typeof body.saved === "object" ? body.saved : {};
      const overrides = { ...(await loadEmailSettings(admin, true)).overrides, [type]: saved };
      const b = sampleBooking();
      const ctx = bookingContext({ email: "sample@example.com", name: "Bea Villanueva" }, b, {
        change_note: "We're closed on Sat, Oct 10 for a private event, so we can't host your session that day.",
        reason_note: "Reason: a burst pipe in the live room.",
        refund_note: "Anything you paid will be refunded to the account it came from.",
        amount: peso(450),
        balance_note: "Remaining balance: ₱450, due at the studio.",
        previous_when: "It was Friday, October 9, 2026, 2 PM to 4 PM. Here is the new time.",
        note: "",
      });
      const built = render(type, ctx, { booking: b, overrides, buttonUrl: `${SITE_URL}/booking` });
      if (action === "emails.preview") return json({ subject: built.subject, html: built.html });
      if (!staff.email) return json({ error: "Your account has no email address." }, 400);
      const res = await deliver({ email: staff.email, name: staff.name }, `[Test] ${built.subject}`, built.html, { bcc: false });
      return res.ok ? json({ ok: true, to: staff.email }) : json({ error: res.error }, 502);
    }

    // ------------------------------------------------------------ schedule
    case "schedule.save": {
      const roomId = String(body.room_id ?? "");
      const weekly = Array.isArray(body.weekly) ? body.weekly : null;
      const overridesIn = Array.isArray(body.overrides) ? body.overrides : null;
      if (overridesIn) {
        if (overridesIn.length > MAX_RULES) return json({ error: `Keep it under ${MAX_RULES} special dates.` }, 400);
        const clean: Any[] = [];
        for (const r of overridesIn) {
          const res = normaliseRule(r);
          if ("error" in res) return json({ error: `${res.error} (rule ${clean.length + 1})` }, 400);
          clean.push(res.rule);
        }
        const { data: before } = await admin.from("staff_settings").select("value").eq("key", "schedule").maybeSingle();
        await admin.from("staff_settings").upsert({ key: "schedule", value: { ...(before?.value ?? {}), overrides: clean }, updated_at: new Date().toISOString() });
      }
      if (weekly && roomId) {
        for (const w of weekly) {
          const dow = Number(w.dow);
          if (!(dow >= 0 && dow <= 6)) continue;
          const patch = { is_closed: !!w.closed, open_time: w.closed ? null : (w.open || null), close_time: w.closed ? null : (w.close || null) };
          const { data: row } = await admin.from("operating_hours").select("id").eq("room_id", roomId).eq("day_of_week", dow).maybeSingle();
          if (row) await admin.from("operating_hours").update(patch).eq("id", row.id);
          else await admin.from("operating_hours").insert({ room_id: roomId, day_of_week: dow, ...patch });
        }
      }
      await logAudit(admin, actorOf(staff), "schedule.edit", "schedule", roomId || null, {
        summary: `Saved the schedule${overridesIn ? ` (${overridesIn.length} special date rule${overridesIn.length === 1 ? "" : "s"})` : ""}`,
      });
      return json({ ok: true, conflicts: await affectedBookings(admin) });
    }
    case "schedule.affected":
      return json({ conflicts: await affectedBookings(admin) });
    case "schedule.notify": {
      const all = await affectedBookings(admin);
      const ids: string[] | null = Array.isArray(body.ids) ? body.ids : null;
      const targets = all.filter((a) => !ids || ids.includes(a.id));
      const out = { sent: 0, noEmail: 0, failed: 0 };
      for (const t of targets) {
        const res = await sendBookingEmail(admin, t.id, "schedule_change", {
          by: by(staff),
          extra: { change_note: t.change_note, note: typeof body.note === "string" ? body.note.slice(0, 1000) : "" },
        });
        if (res.ok) {
          out.sent++;
          await admin.from("bookings").update({ schedule_notice_at: new Date().toISOString() }).eq("id", t.id);
        } else if (/no email/i.test(res.error || "")) out.noEmail++;
        else out.failed++;
      }
      await logAudit(admin, actorOf(staff), "email.send", "schedule", null, { summary: `Schedule change emails: ${out.sent} sent, ${out.noEmail} without email, ${out.failed} failed` });
      return json(out);
    }

    // ------------------------------------------------------------ inbox
    case "mail.send": {
      const mailbox = body.mailbox === "contact" ? "contact" : "booking";
      const to = (Array.isArray(body.to) ? body.to : String(body.to ?? "").split(/[,;]/)).map((x: string) => normalizeEmail(x)).filter(Boolean) as string[];
      const cc = (Array.isArray(body.cc) ? body.cc : String(body.cc ?? "").split(/[,;]/)).map((x: string) => normalizeEmail(x)).filter(Boolean) as string[];
      if (!to.length) return json({ error: "Add at least one recipient." }, 400);
      if (cc.length > 10) return json({ error: "Up to 10 people in Cc." }, 400);
      const subject = String(body.subject ?? "").trim().slice(0, 300);
      const text = String(body.body ?? "").trim();
      if (!subject || !text) return json({ error: "Write a subject and a message." }, 400);
      const atts = Array.isArray(body.attachments) ? body.attachments : [];
      if (atts.length > 10) return json({ error: "Up to 10 attachments." }, 400);
      const totalBytes = atts.reduce((s: number, a: Any) => s + Math.floor(String(a?.content ?? "").length * 0.75), 0);
      if (totalBytes > 7 * 1024 * 1024) return json({ error: "Attachments are over 7 MB in total." }, 400);

      let original: Any = null;
      if (body.reply_to_id) {
        const { data } = await admin.from("mail_messages").select("*").eq("id", body.reply_to_id).maybeSingle();
        original = data;
      }
      const address = mailbox === "contact" ? MAILBOXES.contact : MAILBOXES.booking;
      const signature = `\n\n${staff.name}\nGGS Studio\n${address}`;
      const quoted = original
        ? `\n\nOn ${new Date(original.at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}, ${original.from_name || original.from_addr} wrote:\n${String(original.text_body ?? "").split("\n").slice(0, 60).map((l: string) => `> ${l}`).join("\n")}`
        : "";
      const plain = `${text}${signature}${quoted}`;
      const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1b1f20;">${paragraphs(`${text}${signature}`)}${
        quoted ? `<blockquote style="margin:12px 0 0;padding-left:12px;border-left:2px solid #ccc;color:#555;">${paragraphs(quoted.trim())}</blockquote>` : ""}</div>`;
      const references = original ? [original.references_hdr, original.message_id].filter(Boolean).join(" ") : null;
      const res = await deliver(to.map((e) => ({ email: e })), subject, html, {
        from: `GGS Studio <${address}>`,
        replyTo: INBOX_ENABLED ? address : replyToFor(mailbox),
        cc,
        bcc: false,
        text: plain,
        inReplyTo: original?.message_id ?? null,
        references,
        attachments: atts.map((a: Any) => ({ filename: String(a.filename).slice(0, 120), content: String(a.content).replace(/^data:[^,]+,/, ""), content_type: a.content_type })),
      });
      if (!res.ok) return json({ error: res.error || "The email could not be sent." }, 502);
      const stored = await storeMessage(admin, {
        mailbox,
        direction: "out",
        from_addr: address,
        from_name: `${staff.name} (GGS Studio)`,
        to_addrs: to,
        cc_addrs: cc,
        counterpart: original?.counterpart ?? to[0],
        subject,
        html_body: html,
        text_body: plain,
        thread_id: original?.thread_id ?? null,
        provider_id: res.id ? `out:${res.id}` : null,
        message_id: res.id ? `<${res.id}@resend.dev>` : null,
        in_reply_to: original?.message_id ?? null,
        references_hdr: references,
        kind: "reply",
        sent_by: staff.id,
        sent_by_name: staff.name,
        attachments: atts.map((a: Any) => ({ filename: a.filename, content_type: a.content_type })),
      });
      await logAudit(admin, actorOf(staff), "mail.send", "mail", stored?.id ?? null, { summary: `Sent "${subject}" to ${to.join(", ")}` });
      return json({ ok: true, thread_id: stored?.thread_id ?? null });
    }

    case "mail.sync": {
      if (!resendKey()) return json({ synced: 0, error: "Email is not configured." });
      try {
        const list = await resendGet("/emails/receiving?limit=50");
        let synced = 0;
        for (const e of list?.data ?? []) {
          const row = await ingestReceived(admin, e.id, { notify: false });
          if (row) synced++;
        }
        return json({ synced });
      } catch (err) {
        return json({ synced: 0, error: String((err as Error).message || err) });
      }
    }

    case "mail.attachment": {
      const { data: m } = await admin.from("mail_messages").select("provider_id, attachments").eq("id", body.message_id).single();
      if (!m?.provider_id?.startsWith("in:")) return json({ error: "Attachment not available." }, 404);
      try {
        const att = await resendGet(`/emails/receiving/${m.provider_id.slice(3)}/attachments/${encodeURIComponent(body.attachment_id)}`);
        return json({ url: att.download_url, filename: att.filename, content_type: att.content_type });
      } catch (err) {
        return json({ error: String((err as Error).message || err) }, 502);
      }
    }

    // ------------------------------------------------------------ mailing list
    case "mailing.add": {
      if (body.consent !== true) return json({ error: "Only add people who asked to join. Tick the consent box to confirm." }, 400);
      const email = normalizeEmail(body.email);
      if (!email) return json({ error: "Enter a valid email address." }, 400);
      const { error } = await admin.from("subscribers").upsert({
        email,
        name: typeof body.name === "string" ? body.name.trim().slice(0, 120) || null : null,
        source: "staff",
        status: "subscribed",
        unsubscribed_at: null,
        added_by: staff.id,
        consent_note: `Added by ${staff.name} with consent confirmed`,
      }, { onConflict: "email" });
      if (error) return json({ error: error.message }, 400);
      await logAudit(admin, actorOf(staff), "mailing.edit", "subscriber", email, { summary: `Added ${email} to the mailing list` });
      return json({ ok: true });
    }

    case "campaign.preview":
    case "campaign.test":
    case "campaign.send": {
      const c = body.campaign;
      const problem = validCampaign(c);
      if (problem) return json({ error: problem }, 400);
      if (action === "campaign.preview") return json({ html: campaignHtml(c, `${SITE_URL}/unsubscribe`) });
      const from = `GGS Studio <${MAILBOXES.promotions}>`;
      const replyTo = INBOX_ENABLED ? MAILBOXES.contact : replyToFor("contact");
      if (action === "campaign.test") {
        if (!staff.email) return json({ error: "Your account has no email address." }, 400);
        const res = await deliver({ email: staff.email, name: staff.name }, `[Test] ${c.subject}`, campaignHtml(c, `${SITE_URL}/unsubscribe`), { from, replyTo, bcc: false });
        return res.ok ? json({ ok: true, to: staff.email }) : json({ error: res.error }, 502);
      }
      const { data: busy } = await admin.from("campaigns").select("id").eq("status", "sending").gt("created_at", new Date(Date.now() - 30 * 60000).toISOString()).limit(1);
      if (busy?.length) return json({ error: "Another campaign is still sending. Wait for it to finish." }, 409);
      const { data: subs } = await admin.from("subscribers").select("email, name").eq("status", "subscribed");
      const list = subs ?? [];
      if (!list.length) return json({ error: "Nobody is subscribed yet." }, 400);
      const { data: row, error } = await admin.from("campaigns").insert({
        subject: c.subject, preheader: c.preheader || null, headline: c.headline || null, body: c.body,
        button_label: c.button_label || null, button_url: c.button_url || null, image_url: c.image_url || null,
        status: "sending", sent_by: staff.id, sent_by_name: staff.name, recipients: list.length,
      }).select("id").single();
      if (error) return json({ error: error.message }, 400);

      let sent = 0;
      let failed = 0;
      const key = resendKey();
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const payload = await Promise.all(chunk.map(async (s: Any) => {
          const unsub = await unsubscribeUrl(admin, s.email);
          const token = new URL(unsub).searchParams.get("t")!;
          return {
            from,
            to: [s.name ? `${String(s.name).replace(/[<>",]/g, "")} <${s.email}>` : s.email],
            subject: c.subject,
            html: campaignHtml(c, unsub),
            reply_to: replyTo,
            headers: { "List-Unsubscribe": `<${oneClickUrl(token)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          };
        }));
        try {
          const res = await fetch("https://api.resend.com/emails/batch", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `batch-campaign/${row.id}/${i}` },
            body: JSON.stringify(payload),
          });
          if (res.ok) sent += chunk.length;
          else {
            failed += chunk.length;
            console.error("[campaign] batch failed", res.status, await res.text());
          }
        } catch (err) {
          failed += chunk.length;
          console.error("[campaign] batch threw", err);
        }
      }
      await admin.from("campaigns").update({ status: failed && !sent ? "failed" : "sent", sent, failed, sent_at: new Date().toISOString() }).eq("id", row.id);
      await logAudit(admin, actorOf(staff), "mailing.send", "campaign", row.id, { summary: `Sent "${c.subject}" to ${sent} of ${list.length}` });
      return json({ ok: true, sent, failed, recipients: list.length });
    }

    // ------------------------------------------------------------ vouchers
    case "voucher.save": {
      const v = body.voucher ?? {};
      const code = normaliseCode(v.code);
      if (!/^[A-Z0-9-]{3,24}$/.test(code)) return json({ error: "Codes are 3 to 24 letters, digits or dashes." }, 400);
      if (!["percent", "amount", "free_units", "free"].includes(v.kind)) return json({ error: "Pick the kind of discount." }, 400);
      const value = Number(v.value ?? 0);
      if (v.kind !== "free" && !(value > 0)) return json({ error: "Enter the discount amount." }, 400);
      if (v.kind === "percent" && value > 100) return json({ error: "A percent discount can't exceed 100." }, 400);
      const row = {
        code,
        kind: v.kind,
        value: v.kind === "free" ? 0 : value,
        description: v.description ? String(v.description).slice(0, 300) : null,
        note: v.note ? String(v.note).slice(0, 500) : null,
        min_units: Math.max(0, Number(v.min_units) || 0),
        max_uses: Number(v.max_uses) > 0 ? Math.floor(Number(v.max_uses)) : null,
        per_customer: Number(v.per_customer) > 0 ? Math.floor(Number(v.per_customer)) : null,
        valid_from: v.valid_from || null,
        valid_until: v.valid_until || null,
        weekdays: Array.isArray(v.weekdays) && v.weekdays.length && v.weekdays.length < 7 ? v.weekdays.map(Number).filter((d: number) => d >= 0 && d <= 6) : null,
        active: v.active !== false,
      };
      if (row.valid_from && row.valid_until && row.valid_until < row.valid_from) return json({ error: "The end date is before the start date." }, 400);
      if (v.id) {
        const { data: old } = await admin.from("vouchers").select("code").eq("id", v.id).single();
        if (!old) return json({ error: "Voucher not found." }, 404);
        if (old.code !== code && (await voucherUses(admin, old.code)).total > 0) {
          return json({ error: "This code has been used, so it can't be renamed. Pause it and make a new one." }, 409);
        }
        const { data, error } = await admin.from("vouchers").update(row).eq("id", v.id).select().single();
        if (error) return json({ error: error.code === "23505" ? "That code already exists." : error.message }, 400);
        return json({ voucher: data });
      }
      const { data, error } = await admin.from("vouchers").insert({ ...row, created_by: staff.id }).select().single();
      if (error) return json({ error: error.code === "23505" ? "That code already exists." : error.message }, 400);
      return json({ voucher: data });
    }
    case "voucher.delete": {
      const { data: v } = await admin.from("vouchers").select("id, code").eq("id", body.id).single();
      if (!v) return json({ error: "Voucher not found." }, 404);
      if ((await voucherUses(admin, v.code)).total > 0) return json({ error: "This code has been used, so it can't be deleted. Pause it instead." }, 409);
      await admin.from("vouchers").delete().eq("id", v.id);
      return json({ ok: true });
    }
    case "voucher.usage": {
      const { data } = await admin.from("bookings").select("voucher").not("voucher", "is", null).neq("status", "cancelled");
      const usage: Record<string, { uses: number; discount: number }> = {};
      (data ?? []).forEach((r: Any) => {
        const code = r.voucher?.code;
        if (!code) return;
        usage[code] = usage[code] || { uses: 0, discount: 0 };
        usage[code].uses++;
        usage[code].discount += Number(r.voucher.discount || 0);
      });
      return json({ usage });
    }

    // ------------------------------------------------------------ customers
    case "customers.list": {
      const { data: profiles } = await admin.from("profiles").select("id, full_name, phone, role, created_at").eq("role", "customer");
      const users: Any[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        users.push(...(data?.users ?? []));
        if (!data?.users || data.users.length < 200) break;
      }
      const byId = new Map(users.map((u) => [u.id, u]));
      return json({
        customers: (profiles ?? []).map((p: Any) => {
          const u = byId.get(p.id);
          return { id: p.id, name: p.full_name, phone: p.phone, email: u?.email ?? null, verified: !!u?.email_confirmed_at, created_at: p.created_at, last_sign_in_at: u?.last_sign_in_at ?? null };
        }),
      });
    }

    // ------------------------------------------------------------ forwarding
    // Kept in app_secrets, not app_settings, because settings are public.
    case "forwarding.get": {
      const { data } = await admin.from("app_secrets").select("value").eq("key", "mail_forward_to").maybeSingle();
      return json({ to: String(data?.value ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
    }
    case "forwarding.set": {
      const list: string[] = (Array.isArray(body.to) ? body.to : []).map((x: unknown) => normalizeEmail(x)).filter(Boolean);
      if (list.length > 5) return json({ error: "Forward to five addresses at most." }, 400);
      if (list.some((e) => e.endsWith(`@${MAIL_DOMAIN}`))) return json({ error: `Forward to an outside address, not one at ${MAIL_DOMAIN}, or mail would loop.` }, 400);
      await admin.from("app_secrets").upsert({ key: "mail_forward_to", value: list.join(",") }, { onConflict: "key" });
      await loadEmailSettings(admin, true);
      await logAudit(admin, actorOf(staff), "settings.update", "app_settings", "mail_forward_to", { summary: `Forwarding set to ${list.join(", ") || "nobody"}` });
      return json({ ok: true });
    }

    // ------------------------------------------------------------ staff
    case "staff.create": {
      if (staff.role !== "admin") return json({ error: "Only admins can add staff." }, 403);
      const email = normalizeEmail(body.email);
      const name = String(body.name ?? "").trim().slice(0, 120);
      const role = body.role === "admin" ? "admin" : "staff";
      const password = String(body.password ?? "");
      if (!email || !name) return json({ error: "Give a name and an email." }, 400);
      if (password.length < 10) return json({ error: "The temporary password needs at least 10 characters." }, 400);
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
      let userId = created?.user?.id;
      if (error) {
        const { data: existingId } = await admin.rpc("account_id_for_email", { p_email: email });
        if (!existingId) return json({ error: error.message }, 400);
        userId = existingId;
      }
      await admin.from("profiles").upsert({ id: userId, full_name: name, role, must_change_password: !error }, { onConflict: "id" });
      await logAudit(admin, actorOf(staff), "admin.add", "profile", userId!, { summary: `Added ${name} <${email}> as ${role}` });
      return json({ ok: true, existing: !!error });
    }
    case "staff.role": {
      if (staff.role !== "admin") return json({ error: "Only admins can change roles." }, 403);
      if (body.user_id === staff.id) return json({ error: "You can't change your own role." }, 400);
      const role = ["staff", "admin"].includes(body.role) ? body.role : null;
      if (!role) return json({ error: "Unknown role." }, 400);
      await admin.from("profiles").update({ role }).eq("id", body.user_id);
      return json({ ok: true });
    }
    case "staff.remove": {
      if (staff.role !== "admin") return json({ error: "Only admins can remove staff." }, 403);
      if (body.user_id === staff.id) return json({ error: "You can't remove yourself." }, 400);
      const { data: p } = await admin.from("profiles").select("full_name").eq("id", body.user_id).single();
      await admin.from("profiles").update({ role: "customer", notify_bookings: false }).eq("id", body.user_id);
      await logAudit(admin, actorOf(staff), "admin.remove", "profile", body.user_id, { summary: `Removed ${p?.full_name || "a staff member"} from the team` });
      return json({ ok: true });
    }
    case "profile.test_email": {
      if (!staff.email) return json({ error: "Your account has no email address." }, 400);
      const b = sampleBooking();
      const ctx = bookingContext({ email: "sample@example.com", name: "Bea Villanueva" }, b, { note: "This is a test of booking alerts." });
      const built = render("staff_new_booking", ctx, { booking: b, buttonUrl: `${SITE_URL}/admin` });
      const res = await deliver({ email: staff.email, name: staff.name }, `[Test] ${built.subject}`, built.html, { bcc: false });
      return res.ok ? json({ ok: true, to: staff.email }) : json({ error: res.error }, 502);
    }

    default:
      return json({ error: "Unknown action." }, 400);
  }
});
