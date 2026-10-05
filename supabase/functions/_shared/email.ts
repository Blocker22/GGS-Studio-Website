// Transactional email for the Edge Functions, sent through Resend.
//
// Every send is best-effort: a booking that succeeded must not be reported as
// failed because an email bounced, so nothing here throws. Failures are logged
// and swallowed; callers can `await` without wrapping.
//
// Wording comes from email-templates.js, overridden per field by whatever
// staff saved in app_settings.email_templates. The design is fixed here.
//
// Secrets (Project Settings > Edge Functions > Secrets):
//   RESEND_API_KEY      required; without it every send is skipped and logged
//   EMAIL_FROM          "GGS Studio <bookings@ggsstudio.site>"
//   MAIL_DOMAIN         default ggsstudio.site (contact@ and promotions@ live here)
//   INBOX_ENABLED       receiving is on for MAIL_DOMAIN, so replies land in the
//                       shared inbox. Set to "false" to send replies to the
//                       studio's contact email instead.
//   STAFF_NOTIFY_EMAIL  optional; overrides the forwarding addresses in
//                       Contacts for booking alerts and inbox copies
//   EMAIL_BCC           optional; copies the studio on every customer email
//   SITE_URL / LOGO_URL optional overrides
// deno-lint-ignore-file no-explicit-any

import { TEMPLATES, fillPlaceholders, templateFields } from "./email-templates.js";
import { manageUrl, SITE_URL } from "./links.ts";
import { htmlToText, storeMessage } from "./mailstore.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN")?.trim() || "ggsstudio.site";
const DEFAULT_FROM = `GGS Studio <bookings@${MAIL_DOMAIN}>`;
export const INBOX_ENABLED = Deno.env.get("INBOX_ENABLED")?.trim() !== "false";
export const NOTIFY_FROM = `GGS Studio <notify@${MAIL_DOMAIN}>`;
const LOGO_URL = Deno.env.get("LOGO_URL")?.trim() || `${SITE_URL}/assets/Logo_NoBG.png`;
export const TZ = "Asia/Manila";

export const BRAND = {
  ink: "#020304",
  panel: "#0a0c0e",
  cream: "#eef3f2",
  gold: "#ffd558",
  teal: "#4dffdb",
  line: "#253033",
  muted: "#9aa7a5",
};

export const MAILBOXES = {
  booking: `bookings@${MAIL_DOMAIN}`,
  contact: `contact@${MAIL_DOMAIN}`,
  promotions: `promotions@${MAIL_DOMAIN}`,
};

export type Recipient = { email: string | null | undefined; name?: string | null };

export type BookingEmailData = {
  id: string;
  roomName?: string | null;
  startAt: string;
  endAt: string;
  totalPrice?: number | string | null;
  paymentOption?: string | null;
  status?: string | null;
  services?: string[];
  phone?: string | null;
  email?: string | null;
  voucher?: { code?: string; label?: string; discount?: number } | null;
  paid?: number;
  amountDue?: number | null;
  waived?: boolean;
  manageUrl?: string | null;
  notes?: string | null;
};

export const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const peso = (amount: unknown) =>
  "₱" + Number(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(":00", "");

/** Manila time, spelled out: "Saturday, October 10, 2026, 2 PM to 4 PM". */
export function formatWhen(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const day = start.toLocaleDateString("en-PH", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `${day}, ${fmtTime(start)} to ${fmtTime(new Date(endAt))}`;
}

// ---------------------------------------------------------------- settings cache

type Cache = { overrides: Record<string, Record<string, string>>; contacts: any; rules: any; methods: any[]; forward: string[] };
let cache: Cache | null = null;
let cacheAt = 0;

/** Template overrides and studio contacts, cached for a minute per instance. */
export async function loadEmailSettings(admin: any, force = false): Promise<Cache> {
  if (cache && !force && Date.now() - cacheAt < 60_000) return cache;
  const { data } = await admin.from("app_settings").select("key, value")
    .in("key", ["email_templates", "contacts", "booking_rules", "payment_methods"]);
  const get = (k: string) => data?.find((r: any) => r.key === k)?.value;
  const { data: fwd } = await admin.from("app_secrets").select("value").eq("key", "mail_forward_to").maybeSingle();
  cache = {
    overrides: get("email_templates") || {},
    contacts: get("contacts") || {},
    rules: get("booking_rules") || {},
    methods: get("payment_methods") || [],
    forward: String(fwd?.value ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
  cacheAt = Date.now();
  return cache;
}

function studioPhone(c: Cache | null): string {
  return c?.contacts?.people?.find((p: any) => p?.phone)?.phone || "";
}

function studioEmail(c: Cache | null): string {
  return c?.contacts?.email || "";
}

/**
 * Outside addresses that get booking alerts and a copy of received mail
 * (Contacts > Forward to, stored in app_secrets.mail_forward_to). Our own domain is skipped so mail never loops
 * back into the inbox.
 */
export function forwardAddresses(c: Cache | null = cache): string[] {
  const env = Deno.env.get("STAFF_NOTIFY_EMAIL")?.trim();
  const list: string[] = env ? env.split(",") : c?.forward ?? [];
  const out = list.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.endsWith(`@${MAIL_DOMAIN}`));
  if (!out.length && c?.contacts?.email && !String(c.contacts.email).toLowerCase().endsWith(`@${MAIL_DOMAIN}`)) out.push(String(c.contacts.email).toLowerCase());
  return [...new Set(out)];
}

/** Where a reply should land: the inbox when receiving is on, the studio's own email otherwise. */
export function replyToFor(mailbox: "booking" | "contact" = "booking"): string | undefined {
  if (INBOX_ENABLED) return mailbox === "contact" ? MAILBOXES.contact : MAILBOXES.booking;
  return studioEmail(cache) || undefined;
}

// ---------------------------------------------------------------- rendering

/** Escaped text -> paragraphs; **bold** and single line breaks survive. */
export function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const html = escapeHtml(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px;">${html}</p>`;
    })
    .join("");
}

function checklistHtml(text: string): string {
  const items = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 16px;">${items.map((i) => `
    <tr><td style="width:18px;vertical-align:top;padding:4px 0;color:${BRAND.teal};font-size:14px;">&#10003;</td>
    <td style="padding:4px 0;color:${BRAND.cream};font-size:14px;line-height:1.5;">${escapeHtml(i).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</td></tr>`).join("")}
  </table>`;
}

export function table(rows: Array<[string, string]>): string {
  if (!rows.length) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 18px;border-top:1px solid ${BRAND.line};">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:9px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};font-size:13px;width:34%;vertical-align:top;">${escapeHtml(k)}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.cream};font-size:14px;">${escapeHtml(v)}</td>
    </tr>`).join("")}
  </table>`;
}

export function button(label: string, url: string | null | undefined): string {
  if (!label || !url) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td style="background:${BRAND.gold};border-radius:2px;">
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;color:#14110a;font-weight:600;font-size:14px;text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

/** The studio's dark card, inlined (email clients strip <style>). */
export function layout(opts: { headline: string; preheader?: string; body: string; footer?: string; extraFooter?: string }): string {
  return `<!doctype html><html><head><meta name="color-scheme" content="dark"><meta charset="utf-8"></head>
  <body style="margin:0;padding:24px 12px;background:${BRAND.ink};font-family:Helvetica,Arial,sans-serif;">
    <span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden;">${escapeHtml(opts.preheader || "")}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:540px;margin:0 auto;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:2px;">
      <tr><td style="padding:26px 28px;">
        <img src="${LOGO_URL}" alt="GGS Studio" width="120" style="display:block;width:120px;max-width:50%;height:auto;border:0;">
        <h1 style="margin:18px 0 0;font-size:22px;line-height:1.25;color:${BRAND.cream};font-weight:600;">${escapeHtml(opts.headline)}</h1>
        <div style="margin-top:16px;color:${BRAND.cream};font-size:15px;line-height:1.6;">${opts.body}</div>
        ${opts.footer ? `<p style="margin:8px 0 0;padding-top:16px;border-top:1px solid ${BRAND.line};color:${BRAND.muted};font-size:12px;line-height:1.6;">${escapeHtml(opts.footer)}</p>` : ""}
        ${opts.extraFooter || ""}
      </td></tr>
    </table>
  </body></html>`;
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Cash at the studio",
  deposit: "Downpayment online",
  full: "Paid in full online",
};

export function bookingRows(b: BookingEmailData): Array<[string, string]> {
  const rows: Array<[string, string]> = [["When", formatWhen(b.startAt, b.endAt)]];
  if (b.roomName) rows.push(["Room", b.roomName]);
  if (b.services?.length) rows.push(["Add-ons", b.services.join(", ")]);
  if (b.voucher?.code) rows.push(["Voucher", `${b.voucher.code}${b.voucher.discount ? ` (-${peso(b.voucher.discount)})` : ""}`]);
  if (b.totalPrice != null) rows.push(["Total", peso(b.totalPrice)]);
  if (b.paymentOption) rows.push(["Payment", PAYMENT_LABEL[b.paymentOption] ?? b.paymentOption]);
  rows.push(["Reference", b.id.slice(0, 8).toUpperCase()]);
  return rows;
}

function paymentNote(b: BookingEmailData): string {
  const total = Number(b.totalPrice ?? 0);
  const paid = Number(b.paid ?? 0);
  if (b.waived) return "There is nothing to pay for this session.";
  if (total <= 0) return "This session is free.";
  if (paid >= total) return "It is paid in full. Thank you.";
  if (paid > 0) return `We have ${peso(paid)} so far. The balance of ${peso(total - paid)} is due at the studio.`;
  if (b.paymentOption === "cash") return "Nothing to pay now. Pay in cash at the studio, and bring the ID you booked with.";
  const due = b.amountDue != null ? peso(b.amountDue) : "your payment";
  return `We will confirm once we have checked ${due}. If you have not uploaded your receipt yet, you can do it from your booking page.`;
}

/** Placeholder values for one booking. `extra` adds or overrides any of them. */
export function bookingContext(to: Recipient, b: BookingEmailData, extra: Record<string, unknown> = {}): Record<string, string> {
  const start = new Date(b.startAt);
  const firstName = (to?.name || "").trim().split(/\s+/)[0] || "there";
  const paid = Number(b.paid ?? 0);
  const ctx: Record<string, string> = {
    first_name: firstName,
    name: (to?.name || "").trim() || "Guest",
    email: to?.email || b.email || "",
    phone: b.phone || "not given",
    date: start.toLocaleDateString("en-PH", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    date_short: start.toLocaleDateString("en-PH", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }),
    time: `${fmtTime(start)} to ${fmtTime(new Date(b.endAt))}`,
    room: b.roomName || "",
    total: peso(b.totalPrice),
    ref: b.id.slice(0, 8).toUpperCase(),
    voucher: b.voucher?.code || "",
    studio_phone: studioPhone(cache),
    studio_email: studioEmail(cache),
    site: SITE_URL.replace(/^https?:\/\//, ""),
    payment_note: paymentNote(b),
    addons_note: b.services?.length ? `Add-ons booked: ${b.services.join(", ")}.` : "",
    change_note: "",
    reason_note: "",
    refund_note: paid > 0 ? "Anything you paid will be refunded to the account it came from." : "",
    amount: "",
    balance_note: "",
    previous_when: "",
    note: "",
  };
  Object.entries(extra).forEach(([k, v]) => {
    if (v != null) ctx[k] = String(v);
  });
  return ctx;
}

export type Built = { subject: string; html: string; text: string; type: string };

/**
 * Renders one template. `overrides` lets the dashboard preview unsaved
 * wording; otherwise the cached saved wording is used. `buttonUrl` defaults to
 * the booking page. `extraHtml` is placed after the message (alternatives).
 */
export function render(
  type: string,
  ctx: Record<string, string>,
  opts: { booking?: BookingEmailData | null; overrides?: Record<string, Record<string, string>>; buttonUrl?: string | null; extraHtml?: string } = {},
): Built {
  const meta = (TEMPLATES as any)[type];
  const f = templateFields(type, opts.overrides ?? cache?.overrides ?? {}) as Record<string, string>;
  const fill = (s: string) => fillPlaceholders(s, ctx);
  const body = [
    paragraphs(fill(f.body || "")),
    opts.extraHtml || "",
    meta?.details && opts.booking ? table(bookingRows(opts.booking)) : "",
    checklistHtml(fill(f.checklist || "")),
    button(fill(f.button || ""), opts.buttonUrl ?? opts.booking?.manageUrl ?? null),
  ].join("");
  const html = layout({ headline: fill(f.headline || ""), preheader: fill(f.preheader || ""), body, footer: fill(f.footer || "") });
  return { subject: fill(f.subject || "GGS Studio"), html, text: htmlToText(html), type };
}

// ---------------------------------------------------------------- sending

export type SendOpts = {
  from?: string;
  replyTo?: string;
  cc?: string[];
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
  bcc?: boolean;
  text?: string;
  inReplyTo?: string | null;
  references?: string | null;
  idempotencyKey?: string;
};

/** Core send. Returns { ok, id, error } and never throws. */
export async function deliver(
  to: Recipient | Recipient[],
  subject: string,
  html: string,
  opts: SendOpts = {},
): Promise<{ ok: boolean; id?: string; error?: string; skipped?: boolean }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const list = (Array.isArray(to) ? to : [to])
    .map((r) => ({ email: (r?.email ?? "").trim(), name: r?.name }))
    .filter((r) => r.email);
  if (!list.length) return { ok: false, error: "No recipient." };
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY is not set, skipped "${subject}"`);
    return { ok: false, skipped: true, error: "Email is not configured (RESEND_API_KEY missing)." };
  }

  const fmt = (r: { email: string; name?: string | null }) =>
    r.name ? `${r.name.replace(/[<>",]/g, "")} <${r.email}>` : r.email;
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references) headers["References"] = opts.references;

  const body: Record<string, unknown> = {
    from: opts.from || Deno.env.get("EMAIL_FROM")?.trim() || DEFAULT_FROM,
    to: list.map(fmt),
    subject,
    html,
    text: opts.text ?? htmlToText(html),
  };
  const replyTo = opts.replyTo ?? replyToFor("booking");
  if (replyTo) body.reply_to = replyTo;
  if (opts.cc?.length) body.cc = opts.cc;
  const bcc = Deno.env.get("EMAIL_BCC")?.trim();
  if (bcc && opts.bcc !== false) body.bcc = [bcc];
  if (Object.keys(headers).length) body.headers = headers;
  if (opts.attachments?.length) body.attachments = opts.attachments;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[email] Resend rejected "${subject}" (${res.status}):`, JSON.stringify(out));
      return { ok: false, error: out?.message || `Resend error ${res.status}` };
    }
    return { ok: true, id: out?.id };
  } catch (err) {
    console.error(`[email] send threw for "${subject}":`, err);
    return { ok: false, error: String(err) };
  }
}

/** Backwards-compatible boolean send. */
export async function sendEmail(to: Recipient, subject: string, html: string, opts: SendOpts = {}): Promise<boolean> {
  return (await deliver(to, subject, html, opts)).ok;
}

/**
 * Everything a booking mail needs: who to write to and what the session is.
 * Returns `to.email = null` when there's nobody to write to.
 */
export async function loadBookingEmail(admin: any, bookingId: string): Promise<{ to: Recipient; booking: BookingEmailData } | null> {
  await loadEmailSettings(admin);
  const { data: row } = await admin
    .from("bookings")
    .select("id, start_at, end_at, total_price, payment_option, status, customer_id, guest_name, guest_email, guest_phone, voucher, payment_waived, notes, rooms(name), booking_services(quantity, services(name, price_type, unit_label)), payments(amount, status, type)")
    .eq("id", bookingId)
    .single();
  if (!row) return null;

  let email: string | null = row.guest_email ?? null;
  let name: string | null = row.guest_name ?? null;
  let phone: string | null = row.guest_phone ?? null;
  if (row.customer_id) {
    const { data: profile } = await admin.from("profiles").select("full_name, phone").eq("id", row.customer_id).single();
    if (profile?.full_name && !row.guest_name) name = profile.full_name;
    if (!phone && profile?.phone) phone = profile.phone;
    try {
      const { data: user } = await admin.auth.admin.getUserById(row.customer_id);
      if (user?.user?.email) email = user.user.email;
    } catch (err) {
      console.error("[email] could not resolve customer address:", err);
    }
  }

  const payments = (row.payments ?? []) as any[];
  const paid = payments
    .filter((p) => p.type !== "refund" && ["succeeded", "partially_refunded"].includes(p.status))
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const pending = payments.find((p) => p.type !== "refund" && ["pending", "submitted"].includes(p.status));

  let manage: string | null = null;
  try {
    manage = await manageUrl(admin, row.id);
  } catch (err) {
    console.error("[email] could not sign the booking link:", err);
  }

  return {
    to: { email, name },
    booking: {
      id: row.id,
      roomName: row.rooms?.name ?? null,
      startAt: row.start_at,
      endAt: row.end_at,
      totalPrice: row.total_price,
      paymentOption: row.payment_option,
      status: row.status,
      phone,
      email,
      voucher: row.voucher ?? null,
      paid,
      amountDue: pending ? Number(pending.amount) : null,
      waived: !!row.payment_waived,
      manageUrl: manage,
      notes: row.notes ?? null,
      services: (row.booking_services ?? [])
        .map((bs: any) => bs.services?.name
          ? (bs.services.price_type === "unit" ? `${bs.services.name} (${bs.quantity} ${bs.services.unit_label || "unit"})` : bs.services.name)
          : null)
        .filter(Boolean),
    },
  };
}

/**
 * Renders and sends a booking email, files a copy in the inbox's Sent folder,
 * and appends it to the booking's email log. Returns what happened.
 */
export async function sendBookingEmail(
  admin: any,
  bookingId: string,
  type: string,
  opts: {
    extra?: Record<string, unknown>;
    by?: { id?: string | null; name?: string | null };
    buttonUrl?: string | null;
    extraHtml?: string;
    subject?: string;
    preview?: boolean;
    mail?: { to: Recipient; booking: BookingEmailData } | null;
  } = {},
): Promise<{ ok: boolean; subject?: string; html?: string; to?: string | null; error?: string; skipped?: boolean }> {
  const mail = opts.mail ?? await loadBookingEmail(admin, bookingId);
  if (!mail) return { ok: false, error: "Booking not found." };
  const ctx = bookingContext(mail.to, mail.booking, opts.extra || {});
  const built = render(type, ctx, { booking: mail.booking, buttonUrl: opts.buttonUrl, extraHtml: opts.extraHtml });
  if (opts.subject) built.subject = opts.subject;
  if (opts.preview) return { ok: true, subject: built.subject, html: built.html, to: mail.to.email ?? null };
  if (!mail.to.email) return { ok: false, error: "This booking has no email address.", subject: built.subject };

  const res = await deliver(mail.to, built.subject, built.html, { text: built.text });
  if (res.ok) {
    await storeMessage(admin, {
      mailbox: "booking",
      direction: "out",
      from_addr: MAILBOXES.booking,
      from_name: "GGS Studio",
      to_addrs: [mail.to.email],
      counterpart: mail.to.email,
      subject: built.subject,
      html_body: built.html,
      text_body: built.text,
      provider_id: res.id ? `out:${res.id}` : null,
      kind: type,
      sent_by: opts.by?.id ?? null,
      sent_by_name: opts.by?.name ?? null,
      booking_id: bookingId,
    });
    await appendEmailLog(admin, bookingId, { type, subject: built.subject, by: opts.by?.name || "system" });
  }
  return { ok: res.ok, subject: built.subject, to: mail.to.email, error: res.error, skipped: res.skipped };
}

export async function appendEmailLog(admin: any, bookingId: string, entry: { type: string; subject: string; by: string }) {
  try {
    const { data } = await admin.from("bookings").select("email_log").eq("id", bookingId).single();
    const log = Array.isArray(data?.email_log) ? data.email_log : [];
    log.push({ ...entry, at: new Date().toISOString() });
    await admin.from("bookings").update({ email_log: log.slice(-50) }).eq("id", bookingId);
  } catch (err) {
    console.error("[email] could not append email log:", err);
  }
}

/**
 * Staff notifications: the business address plus every staff member with
 * booking alerts on, de-duplicated, in ONE email. Not filed in the inbox.
 */
export async function notifyStaff(admin: any, bookingId: string, type: "staff_new_booking" | "staff_cancelled", extra: Record<string, unknown> = {}) {
  try {
    const mail = await loadBookingEmail(admin, bookingId);
    if (!mail) return;
    const recipients = new Map<string, Recipient>();
    const add = (email?: string | null, name?: string | null) => {
      const e = (email ?? "").trim();
      if (e && !recipients.has(e.toLowerCase())) recipients.set(e.toLowerCase(), { email: e, name });
    };
    await loadEmailSettings(admin);
    for (const e of forwardAddresses()) add(e, "GGS Studio");
    const { data: staff } = await admin.from("profiles").select("id, full_name").in("role", ["staff", "admin"]).eq("notify_bookings", true);
    for (const s of staff ?? []) {
      try {
        const { data } = await admin.auth.admin.getUserById(s.id);
        add(data?.user?.email, s.full_name);
      } catch { /* skip */ }
    }
    if (!recipients.size) return;
    const ctx = bookingContext(mail.to, mail.booking, extra);
    const built = render(type, ctx, { booking: mail.booking, buttonUrl: `${SITE_URL}/admin#/bookings?b=${bookingId}` });
    await deliver([...recipients.values()], built.subject, built.html, { bcc: false, from: NOTIFY_FROM, replyTo: mail.to.email || undefined });
  } catch (err) {
    console.error("[email] staff notification failed:", err);
  }
}

// ---------------------------------------------------------------- legacy builders
// Kept so older call sites keep compiling; each now renders through templates.

function legacy(type: string, to: Recipient, booking: BookingEmailData, extra: Record<string, unknown> = {}) {
  const built = render(type, bookingContext(to, booking, extra), { booking });
  return { subject: built.subject, html: built.html };
}

export function bookingCreatedEmail(to: Recipient, booking: BookingEmailData, opts: { amountDue?: number | null; confirmed?: boolean } = {}) {
  if (opts.amountDue != null) booking.amountDue = opts.amountDue;
  return legacy(opts.confirmed ? "confirmed" : "received", to, booking);
}

export function bookingConfirmedEmail(to: Recipient, booking: BookingEmailData) {
  return legacy("confirmed", to, booking);
}

export function bookingUpdatedEmail(to: Recipient, booking: BookingEmailData, previous?: { startAt: string; endAt: string }) {
  const moved = previous && (previous.startAt !== booking.startAt || previous.endAt !== booking.endAt);
  return legacy("rescheduled", to, booking, {
    previous_when: moved ? `It was ${formatWhen(previous!.startAt, previous!.endAt)}; here is the new time.` : "Here is what we have now.",
  });
}

export function bookingCancelledEmail(to: Recipient, booking: BookingEmailData, opts: { byStudio?: boolean; reason?: string | null } = {}) {
  return legacy(opts.byStudio ? "cancelled_staff" : "cancelled_customer", to, booking, {
    reason_note: opts.reason ? `Reason: ${opts.reason}` : "",
  });
}

export function paymentReceiptEmail(to: Recipient, booking: BookingEmailData, payment: { amount: number | string; balance?: number | null }) {
  return legacy("payment_receipt", to, booking, {
    amount: peso(payment.amount),
    balance_note: payment.balance != null
      ? (payment.balance > 0 ? `Remaining balance: ${peso(payment.balance)}, due at the studio.` : "Nothing left to pay.")
      : "",
  });
}

export function paymentRejectedEmail(to: Recipient, booking: BookingEmailData, reason: string | null) {
  return legacy("payment_rejected", to, booking, { reason_note: reason ? `What we found: ${reason}` : "" });
}

export function refundEmail(to: Recipient, booking: BookingEmailData, amount: number | string) {
  return legacy("refund", to, booking, { amount: peso(amount) });
}

/** The account itself is gone. Not templated: it carries legal wording. */
export function accountDeletedEmail(to: Recipient) {
  const first = (to.name || "").split(" ")[0] || "there";
  return {
    subject: "Your GGS Studio account has been deleted",
    html: layout({
      headline: "Your account is deleted",
      body: paragraphs(`Hi ${first},\n\nYour GGS Studio account and its personal details have been removed, and any upcoming bookings under it were cancelled.\n\nRecords we are required to keep for accounting (past sessions and payments) stay on file without your account attached. You are welcome back any time, and booking does not need an account.`),
      footer: "Questions? Reply to this email.",
    }),
  };
}
