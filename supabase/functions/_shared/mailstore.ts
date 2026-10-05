// The shared inbox's storage: threading and saving one message. Used by the
// sender (every customer email lands in Sent), the inbound webhook, and the
// dashboard's own replies. Never throws: mail that went out must not be
// reported as failed because the copy couldn't be filed.
// deno-lint-ignore-file no-explicit-any

export type MailRow = {
  mailbox: "booking" | "contact";
  direction: "in" | "out";
  from_addr?: string | null;
  from_name?: string | null;
  to_addrs?: string[];
  cc_addrs?: string[];
  to_label?: string | null;
  counterpart?: string | null;
  subject?: string | null;
  text_body?: string | null;
  html_body?: string | null;
  at?: string;
  read?: boolean;
  attachments?: unknown[];
  message_id?: string | null;
  in_reply_to?: string | null;
  references_hdr?: string | null;
  provider_id?: string | null;
  kind?: string | null;
  sent_by?: string | null;
  sent_by_name?: string | null;
  booking_id?: string | null;
  thread_id?: string | null;
};

/** "Re: Fwd: Booking  received" -> "booking received" */
export function subjectKey(subject: string | null | undefined): string {
  let s = String(subject ?? "").trim().toLowerCase();
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/^(re|fw|fwd|aw|sv)\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").slice(0, 200);
}

export function snippetOf(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/^>.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "$1\n")
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strips scripts, event handlers and meta refreshes, and caps the size. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']?refresh[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .slice(0, 400_000);
}

/** In-Reply-To/References first, then same counterpart + subject within 60 days. */
export async function findThread(admin: any, row: MailRow): Promise<string> {
  const ids = [row.in_reply_to, ...String(row.references_hdr ?? "").split(/\s+/)]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  if (ids.length) {
    const { data } = await admin.from("mail_messages").select("thread_id").in("message_id", ids).limit(1);
    if (data?.[0]?.thread_id) return data[0].thread_id;
  }
  const key = subjectKey(row.subject);
  if (row.counterpart && key) {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const { data } = await admin
      .from("mail_messages")
      .select("thread_id")
      .eq("counterpart", row.counterpart.toLowerCase())
      .eq("subject_key", key)
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(1);
    if (data?.[0]?.thread_id) return data[0].thread_id;
  }
  return crypto.randomUUID();
}

export async function storeMessage(admin: any, row: MailRow): Promise<{ id: string; thread_id: string } | null> {
  try {
    const counterpart = (row.counterpart ?? "").toLowerCase() || null;
    const text = row.text_body ?? (row.html_body ? htmlToText(row.html_body) : "");
    const threadId = row.thread_id || await findThread(admin, { ...row, counterpart });
    const { data, error } = await admin
      .from("mail_messages")
      .insert({
        ...row,
        thread_id: threadId,
        counterpart,
        subject_key: subjectKey(row.subject),
        text_body: text,
        html_body: cleanHtml(row.html_body),
        snippet: snippetOf(text),
        read: row.read ?? row.direction === "out",
      })
      .select("id, thread_id")
      .single();
    if (error) {
      // 23505 = this provider id was already filed (webhook and sync raced).
      if (error.code !== "23505") console.error("[mailstore] insert failed:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error("[mailstore] threw:", err);
    return null;
  }
}
