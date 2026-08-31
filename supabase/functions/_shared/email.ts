// Transactional email for the Edge Functions, sent through Resend.
//
// Every send is best-effort: a booking that succeeded must not be reported as
// failed because an email bounced, so nothing here throws — failures are
// printed to the function's own logs and swallowed. Callers can `await` these
// without wrapping them.
//
// Two secrets, set in Supabase (Project Settings > Edge Functions > Secrets):
//   RESEND_API_KEY  — required; without it every send is skipped, logged, and
//                     the surrounding operation carries on unaffected.
//   EMAIL_FROM      — optional; "GGS Studio <bookings@yourdomain.com>". The
//                     default only works for addresses Resend already lets you
//                     send to, so set this to a verified domain before relying
//                     on customer mail arriving.
//   EMAIL_BCC       — optional; a studio address copied on every customer mail.
//
// This file is deployed verbatim alongside each function that calls it, the
// same way audit.ts and guest.ts are — Edge Functions have no shared runtime.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "GGS Studio <onboarding@resend.dev>";

const BRAND = {
  ink: "#0d1214",
  panel: "#141b1e",
  cream: "#f6f1e6",
  gold: "#ffd558",
  line: "#26312f",
  muted: "#9aa5a3",
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
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Manila time, spelled out — the studio and every customer are in PH. */
export function formatWhen(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Manila" };
  const day = start.toLocaleDateString("en-PH", { ...opts, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString("en-PH", { ...opts, hour: "numeric", minute: "2-digit" });
  return `${day} · ${time(start)} – ${time(end)}`;
}

export const peso = (amount: unknown) =>
  "₱" + Number(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });

const PAYMENT_OPTION_LABEL: Record<string, string> = {
  cash: "Cash at the studio",
  deposit: "Downpayment (online)",
  full: "Full payment (online)",
};

/** The rows shared by every booking mail: when, where, what, how much. */
function bookingRows(booking: BookingEmailData): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["When", formatWhen(booking.startAt, booking.endAt)],
  ];
  if (booking.roomName) rows.push(["Room", booking.roomName]);
  if (booking.services?.length) rows.push(["Add-ons", booking.services.join(", ")]);
  if (booking.totalPrice != null) rows.push(["Total", peso(booking.totalPrice)]);
  if (booking.paymentOption) {
    rows.push(["Payment", PAYMENT_OPTION_LABEL[booking.paymentOption] ?? booking.paymentOption]);
  }
  rows.push(["Reference", booking.id.slice(0, 8).toUpperCase()]);
  return rows;
}

function table(rows: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:18px 0;">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:7px 0;color:${BRAND.muted};font-size:13px;width:34%;vertical-align:top;">${escapeHtml(k)}</td>
      <td style="padding:7px 0;color:${BRAND.cream};font-size:14px;">${escapeHtml(v)}</td>
    </tr>`).join("")}
  </table>`;
}

/** The studio's dark card wrapper, inlined — email clients strip <style>. */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:${BRAND.ink};font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:6px;">
      <tr><td style="padding:22px 26px;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.gold};">GGS Studio</div>
        <h1 style="margin:10px 0 0;font-size:20px;color:${BRAND.cream};font-weight:600;">${escapeHtml(title)}</h1>
        <div style="margin-top:14px;color:${BRAND.cream};font-size:14px;line-height:1.6;">${bodyHtml}</div>
        <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid ${BRAND.line};color:${BRAND.muted};font-size:12px;line-height:1.6;">
          Questions? Just reply to this email and we'll pick it up.
        </p>
      </td></tr>
    </table>
  </body></html>`;
}

/** Plain-text fallback: tags stripped, blocks turned into line breaks. */
function toText(html: string): string {
  return html
    .replace(/<\/(p|div|tr|h1|h2)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Sends one email. Returns true only when Resend accepted it; a missing key,
 * a missing recipient or an API error all resolve false without throwing.
 */
export async function sendEmail(
  to: Recipient,
  subject: string,
  html: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const address = (to?.email ?? "").trim();
  if (!address) return false;
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY is not set — skipped "${subject}" to ${address}`);
    return false;
  }

  const bcc = Deno.env.get("EMAIL_BCC")?.trim();
  const body: Record<string, unknown> = {
    from: Deno.env.get("EMAIL_FROM")?.trim() || DEFAULT_FROM,
    to: [to.name ? `${to.name.replace(/[<>",]/g, "")} <${address}>` : address],
    subject,
    html,
    text: toText(html),
  };
  if (bcc) body.bcc = [bcc];

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[email] Resend rejected "${subject}" (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] send threw for "${subject}":`, err);
    return false;
  }
}

const hi = (to: Recipient) => `<p style="margin:0 0 12px;">Hi ${escapeHtml(to.name?.split(" ")[0] || "there")},</p>`;

/**
 * Everything a booking mail needs, in one round-trip: who to write to and what
 * the session actually is. Guests carry their own name and address on the
 * booking row; a registered customer's address lives in auth, not in profiles.
 * Returns `to.email = null` when there's nobody to write to (an anonymised or
 * walk-in booking), which sendEmail treats as a no-op.
 */
export async function loadBookingEmail(
  // deno-lint-ignore no-explicit-any
  admin: any,
  bookingId: string,
): Promise<{ to: Recipient; booking: BookingEmailData } | null> {
  const { data: row } = await admin
    .from("bookings")
    .select("id, start_at, end_at, total_price, payment_option, status, customer_id, guest_name, guest_email, rooms(name), booking_services(services(name))")
    .eq("id", bookingId)
    .single();
  if (!row) return null;

  let email: string | null = row.guest_email ?? null;
  let name: string | null = row.guest_name ?? null;
  if (row.customer_id) {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", row.customer_id)
      .single();
    if (profile?.full_name) name = profile.full_name;
    try {
      const { data: user } = await admin.auth.admin.getUserById(row.customer_id);
      if (user?.user?.email) email = user.user.email;
    } catch (err) {
      console.error("[email] could not resolve customer address:", err);
    }
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
      // deno-lint-ignore no-explicit-any
      services: (row.booking_services ?? []).map((bs: any) => bs.services?.name).filter(Boolean),
    },
  };
}

// ---------- The individual mails ----------

/** Booked. What happens next depends on how they chose to pay. */
export function bookingCreatedEmail(to: Recipient, booking: BookingEmailData, opts: {
  amountDue?: number | null;
  confirmed?: boolean;
} = {}) {
  const next = opts.confirmed
    ? "<p style=\"margin:0 0 12px;\">This booking is confirmed — see you at the studio.</p>"
    : booking.paymentOption === "cash"
    ? "<p style=\"margin:0 0 12px;\">We'll review it and confirm by email shortly. Nothing to pay now — settle in cash at the studio.</p>"
    : `<p style="margin:0 0 12px;">We'll confirm it once your ${
      opts.amountDue != null ? `payment of ${peso(opts.amountDue)}` : "payment"
    } comes through. If you haven't sent your receipt yet, upload it from your account page.</p>`;
  return {
    subject: `Booking received — ${formatWhen(booking.startAt, booking.endAt)}`,
    html: layout("We've got your booking", `${hi(to)}${next}${table(bookingRows(booking))}`),
  };
}

/** Staff confirmed a pending booking. */
export function bookingConfirmedEmail(to: Recipient, booking: BookingEmailData) {
  return {
    subject: `Booking confirmed — ${formatWhen(booking.startAt, booking.endAt)}`,
    html: layout("Your booking is confirmed", `${hi(to)}
      <p style="margin:0 0 12px;">You're all set. Here are the details we have:</p>
      ${table(bookingRows(booking))}`),
  };
}

/** Moved to a different slot, or otherwise edited. */
export function bookingUpdatedEmail(to: Recipient, booking: BookingEmailData, previous?: { startAt: string; endAt: string }) {
  const wasMoved = previous && (previous.startAt !== booking.startAt || previous.endAt !== booking.endAt);
  return {
    subject: wasMoved
      ? `Booking moved to ${formatWhen(booking.startAt, booking.endAt)}`
      : "Your booking was updated",
    html: layout(wasMoved ? "Your booking has moved" : "Your booking was updated", `${hi(to)}
      ${wasMoved
        ? `<p style="margin:0 0 12px;">Your session was rescheduled from <strong>${escapeHtml(formatWhen(previous!.startAt, previous!.endAt))}</strong> to the slot below.</p>`
        : "<p style=\"margin:0 0 12px;\">The details of your session have changed:</p>"}
      ${table(bookingRows(booking))}
      <p style="margin:0;color:${BRAND.muted};font-size:13px;">Didn't expect this change? Reply to this email and we'll sort it out.</p>`),
  };
}

/** Cancelled — by the customer or by the studio. */
export function bookingCancelledEmail(to: Recipient, booking: BookingEmailData, opts: { byStudio?: boolean; reason?: string | null } = {}) {
  return {
    subject: `Booking cancelled — ${formatWhen(booking.startAt, booking.endAt)}`,
    html: layout("Your booking is cancelled", `${hi(to)}
      <p style="margin:0 0 12px;">${opts.byStudio
        ? "We've had to cancel this session."
        : "This session has been cancelled as requested."}</p>
      ${opts.reason ? `<p style="margin:0 0 12px;color:${BRAND.muted};">Reason: ${escapeHtml(opts.reason)}</p>` : ""}
      ${table(bookingRows(booking))}
      <p style="margin:0;">Anything already paid will be refunded to the account it came from. Book again any time.</p>`),
  };
}

/** Money received — the receipt. */
export function paymentReceiptEmail(to: Recipient, booking: BookingEmailData, payment: {
  amount: number | string;
  method?: string | null;
  type?: string | null;
  reference?: string | null;
  balance?: number | null;
}) {
  const rows: Array<[string, string]> = [
    ["Amount paid", peso(payment.amount)],
    ["Method", payment.method === "cash" ? "Cash at the studio" : payment.method === "manual" ? "QR transfer" : (payment.method ?? "—")],
    ["Covers", payment.type === "deposit" ? "Downpayment" : "Full payment"],
  ];
  if (payment.reference) rows.push(["Reference no.", payment.reference]);
  if (payment.balance != null) {
    rows.push(["Remaining balance", payment.balance > 0 ? peso(payment.balance) : "None — paid in full"]);
  }
  return {
    subject: `Payment received — ${peso(payment.amount)}`,
    html: layout("Thanks — payment received", `${hi(to)}
      <p style="margin:0 0 12px;">We've recorded your payment. This email is your receipt.</p>
      ${table(rows)}
      <p style="margin:0 0 6px;color:${BRAND.muted};font-size:13px;">For this session:</p>
      ${table(bookingRows(booking))}`),
  };
}

/** A QR receipt that didn't check out. */
export function paymentRejectedEmail(to: Recipient, booking: BookingEmailData, reason: string | null) {
  return {
    subject: "We couldn't verify your payment receipt",
    html: layout("Your receipt needs another look", `${hi(to)}
      <p style="margin:0 0 12px;">We weren't able to verify the receipt you uploaded for this session, so it hasn't been recorded as paid yet.</p>
      ${reason ? `<p style="margin:0 0 12px;color:${BRAND.muted};">What we found: ${escapeHtml(reason)}</p>` : ""}
      ${table(bookingRows(booking))}
      <p style="margin:0;">You can upload a new receipt from your account page, or reply here and we'll help.</p>`),
  };
}

/** Refunded, in whole or in part. */
export function refundEmail(to: Recipient, booking: BookingEmailData, amount: number | string) {
  return {
    subject: `Refund issued — ${peso(amount)}`,
    html: layout("Your refund is on its way", `${hi(to)}
      <p style="margin:0 0 12px;">We've issued a refund of <strong>${escapeHtml(peso(amount))}</strong> for this session. Depending on your bank or e-wallet it can take a few working days to land.</p>
      ${table(bookingRows(booking))}`),
  };
}

/** The account itself is gone. */
export function accountDeletedEmail(to: Recipient) {
  return {
    subject: "Your GGS Studio account has been deleted",
    html: layout("Your account is deleted", `${hi(to)}
      <p style="margin:0 0 12px;">Your GGS Studio account and its personal details have been removed, and any upcoming bookings under it were cancelled.</p>
      <p style="margin:0;">Records we're required to keep for accounting (past sessions and payments) stay on file without your account attached. You're welcome back any time — booking doesn't even need an account.</p>`),
  };
}
