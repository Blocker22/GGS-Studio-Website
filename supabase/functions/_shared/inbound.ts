// Receiving: turning one Resend inbound email into an inbox message. Used by
// the signed webhook and by the dashboard's "check now" sync, which lists
// recent received mail and ingests anything the webhook missed. A unique
// provider id makes the two safe to race.
//
// Routing by the local part of the address it was sent to:
//   bookings@ / booking@   -> Bookings mailbox
//   contact@               -> Contact mailbox
//   promotions@            -> Contact, plus one auto-reply per sender per day
//                             pointing them to contact@
//   notify@ / noreply@     -> dropped
//   anything else          -> Contact, tagged "Sent to x@"
// deno-lint-ignore-file no-explicit-any

import { deliver, escapeHtml, forwardAddresses, layout, loadEmailSettings, MAILBOXES, NOTIFY_FROM, paragraphs } from "./email.ts";
import { htmlToText, storeMessage } from "./mailstore.ts";
import { SITE_URL } from "./links.ts";

const API = "https://api.resend.com";
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN")?.trim() || "ggsstudio.site";

export function resendKey(): string | null {
  return Deno.env.get("RESEND_API_KEY") ?? null;
}

export async function resendGet(path: string): Promise<any> {
  const key = resendKey();
  if (!key) throw new Error("RESEND_API_KEY is not set.");
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Resend ${res.status}`);
  return body;
}

/** "Ana Cruz <ana@x.com>" -> { name, email } */
export function parseAddress(raw: string | null | undefined): { name: string | null; email: string } {
  const s = String(raw ?? "").trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, "") || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: s.toLowerCase() };
}

function header(headers: any, name: string): string | null {
  if (!headers) return null;
  if (Array.isArray(headers)) {
    const h = headers.find((x: any) => String(x?.name ?? x?.key ?? "").toLowerCase() === name);
    return h ? String(h.value ?? "") : null;
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : null;
}

function route(to: string[]): { mailbox: "booking" | "contact" | null; label: string | null; promo: boolean } {
  const ours = to.map((a) => parseAddress(a).email).filter((e) => e.endsWith(`@${MAIL_DOMAIN}`) || e.endsWith(".resend.app"));
  const local = (ours[0] ?? to.map((a) => parseAddress(a).email)[0] ?? "").split("@")[0];
  if (["bookings", "booking"].includes(local)) return { mailbox: "booking", label: null, promo: false };
  if (local === "contact") return { mailbox: "contact", label: null, promo: false };
  if (local === "promotions") return { mailbox: "contact", label: "Sent to promotions@", promo: true };
  if (["notify", "noreply", "no-reply"].includes(local)) return { mailbox: null, label: null, promo: false };
  return { mailbox: "contact", label: local ? `Sent to ${local}@` : null, promo: false };
}

function isAutomated(from: string, headers: any): boolean {
  if (/(no-?reply|mailer-daemon|postmaster|bounce)/i.test(from)) return true;
  const auto = header(headers, "auto-submitted");
  if (auto && auto.toLowerCase() !== "no") return true;
  const prec = (header(headers, "precedence") ?? "").toLowerCase();
  if (["bulk", "list", "junk"].includes(prec)) return true;
  return !!(header(headers, "list-id") || header(headers, "list-unsubscribe"));
}

/**
 * Fetches, routes, threads and stores one received email. Returns the stored
 * row, or null when it was dropped or already filed.
 */
export async function ingestReceived(admin: any, emailId: string, opts: { notify?: boolean } = {}) {
  const providerId = `in:${emailId}`;
  const { data: existing } = await admin.from("mail_messages").select("id").eq("provider_id", providerId).maybeSingle();
  if (existing) return null;

  const email = await resendGet(`/emails/receiving/${emailId}`);
  const to: string[] = Array.isArray(email.to) ? email.to : [email.to].filter(Boolean);
  const r = route(to);
  if (!r.mailbox) return null;

  const from = parseAddress(email.from);
  const headers = email.headers ?? {};
  const html = email.html ?? null;
  const text = email.text ?? (html ? htmlToText(html) : "");
  const row = await storeMessage(admin, {
    mailbox: r.mailbox,
    direction: "in",
    from_addr: from.email,
    from_name: from.name,
    to_addrs: to.map((a) => parseAddress(a).email),
    cc_addrs: (email.cc ?? []).map((a: string) => parseAddress(a).email),
    to_label: r.label,
    counterpart: from.email,
    subject: email.subject ?? "(no subject)",
    html_body: html,
    text_body: text,
    at: email.created_at ?? new Date().toISOString(),
    read: false,
    attachments: (email.attachments ?? []).map((a: any) => ({
      id: a.id, filename: a.filename, content_type: a.content_type, size: a.size ?? null, content_id: a.content_id ?? null,
    })),
    message_id: email.message_id ?? header(headers, "message-id"),
    in_reply_to: header(headers, "in-reply-to"),
    references_hdr: header(headers, "references"),
    provider_id: providerId,
    kind: "received",
  });
  if (!row) return null;

  // One auto-reply per sender per day for the promotions address, never to
  // automated or bulk mail.
  if (r.promo && !isAutomated(from.email, headers)) {
    const { data: allowed } = await admin.rpc("hit_rate_limit", { p_key: `autoreply:${from.email}`, p_max: 1, p_window_seconds: 86400 });
    if (allowed !== false) {
      await deliver({ email: from.email, name: from.name }, `Re: ${email.subject ?? "your message"}`, layout({
        headline: "Thanks for writing",
        body: paragraphs(`Hi${from.name ? ` ${from.name.split(" ")[0]}` : ""},\n\nThe promotions address only sends news. For questions or bookings, please write to ${MAILBOXES.contact} and we will get back to you.`),
        footer: "This is an automatic reply.",
      }), { from: `GGS Studio <${MAILBOXES.promotions}>`, replyTo: MAILBOXES.contact, bcc: false, headers: { "Auto-Submitted": "auto-replied" } });
    }
  }

  // Forward a copy to the studio's own mailbox (Contacts > Forward to), only
  // for fresh mail so a sync of old mail stays quiet. Replying in Gmail goes
  // straight to the sender; the button replies from the studio address.
  const fresh = Date.now() - new Date(email.created_at ?? Date.now()).getTime() < 3 * 3600000;
  if (opts.notify !== false && fresh) {
    const targets = forwardAddresses(await loadEmailSettings(admin));
    if (targets.length) {
      const link = `${SITE_URL}/admin#/inbox?thread=${row.thread_id}`;
      const box = r.mailbox === "booking" ? MAILBOXES.booking : MAILBOXES.contact;
      const files = (email.attachments ?? []).filter((a: any) => a.content_disposition !== "inline").length;
      const quoted = escapeHtml((text || "").slice(0, 20000)).replace(/\n/g, "<br>");
      const meta = [
        `**From:** ${from.name ? `${from.name} <${from.email}>` : from.email}`,
        `**To:** ${to.join(", ")}${r.label ? ` (${r.label})` : ""}`,
        `**Subject:** ${email.subject ?? "(no subject)"}`,
        ...(files ? [`**Attachments:** ${files}, open the dashboard to download`] : []),
      ].join("\n");
      await deliver(targets.map((e) => ({ email: e, name: "GGS Studio" })), `Fwd: ${email.subject ?? "(no subject)"}`, layout({
        headline: `New email to ${box}`,
        body: `${paragraphs(meta)}
          <div style="margin:0 0 18px;padding:14px 16px;border-left:2px solid #ffd558;background:#0e1113;color:#e9f0ef;font-size:14px;line-height:1.55;">${quoted || "<em>No text in this email.</em>"}</div>
          <p style="margin:0 0 14px;"><a href="${escapeHtml(link)}" style="color:#ffd558;">Reply from ${escapeHtml(box)} in the dashboard</a></p>`,
        footer: "Forwarded from the GGS Studio inbox. Replying here answers the sender from this address instead.",
      }), { from: NOTIFY_FROM, bcc: false, replyTo: from.email });
    }
  }
  return row;
}
