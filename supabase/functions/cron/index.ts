import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient } from "../_shared/guest.ts";
import { logAudit } from "../_shared/audit.ts";
import { sendBookingEmail } from "../_shared/email.ts";
import { loadRules } from "../_shared/booking-core.ts";
import { randomToken, sha256Hex, SITE_URL } from "../_shared/links.ts";

// Background jobs, called every 10 minutes by pg_cron (see the cron_jobs
// migration) with the shared secret from app_secrets. Each job is idempotent:
// rows are marked before anything is sent, so a retry never doubles up.
//
//   feedback   completed sessions that ended at least N hours ago (but under
//              48 hours, so switching it on doesn't email every past
//              customer) get a thank-you with a one-time review link
//   id-photos  ID photos are deleted N days after the session
//   cleanup    stale rate-limit counters

// deno-lint-ignore no-explicit-any
type Any = any;

async function feedbackJob(admin: Any, rules: Any) {
  if (!rules.feedbackEnabled) return { feedback: "disabled" };
  const now = Date.now();
  const latestEnd = new Date(now - rules.feedbackDelayHours * 3600000).toISOString();
  const earliestEnd = new Date(now - 48 * 3600000).toISOString();
  const { data: rows } = await admin
    .from("bookings")
    .select("id, guest_email, customer_id")
    .in("status", ["confirmed", "completed"])
    .is("feedback_sent_at", null)
    .lte("end_at", latestEnd)
    .gte("end_at", earliestEnd)
    .limit(20);
  let sent = 0;
  for (const b of rows ?? []) {
    if (!b.guest_email && !b.customer_id) continue;
    const token = randomToken();
    // Mark first: a crash after this point loses one email, never sends two.
    const { data: claimed } = await admin
      .from("bookings")
      .update({ feedback_token_hash: await sha256Hex(token), feedback_sent_at: new Date().toISOString() })
      .eq("id", b.id)
      .is("feedback_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const res = await sendBookingEmail(admin, b.id, "thank_you", {
      by: { id: null, name: "system" },
      buttonUrl: `${SITE_URL}/feedback?t=${encodeURIComponent(token)}`,
    });
    if (res.ok) sent++;
  }
  return { feedback: sent };
}

async function idPhotoJob(admin: Any, rules: Any) {
  const cutoff = new Date(Date.now() - rules.idRetentionDays * 86400000).toISOString();
  const { data: rows } = await admin
    .from("bookings")
    .select("id, id_image_path, id_check")
    .not("id_image_path", "is", null)
    .lt("start_at", cutoff)
    .limit(50);
  let removed = 0;
  for (const b of rows ?? []) {
    const { error } = await admin.storage.from("customer-ids").remove([b.id_image_path]);
    if (error) continue;
    const check = b.id_check ? { ...b.id_check, photo_deleted_at: new Date().toISOString() } : null;
    await admin.from("bookings").update({ id_image_path: null, id_check: check }).eq("id", b.id);
    await logAudit(admin, { id: null, role: "system", label: "Retention job" }, "booking.id", "booking", b.id, {
      summary: `ID photo deleted after ${rules.idRetentionDays} days`,
    });
    removed++;
  }
  return { id_photos_removed: removed };
}

Deno.serve(async (req: Request) => {
  const admin = adminClient();
  const given = req.headers.get("x-cron-secret") ?? "";
  const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "cron_secret").single();
  if (!secret?.value || given !== secret.value) return new Response("Forbidden", { status: 403 });

  const rules = await loadRules(admin);
  const out: Record<string, unknown> = {};
  try { Object.assign(out, await feedbackJob(admin, rules)); } catch (e) { out.feedback_error = String(e); }
  try { Object.assign(out, await idPhotoJob(admin, rules)); } catch (e) { out.id_error = String(e); }
  try {
    await admin.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400000).toISOString());
  } catch { /* ignore */ }
  console.log("[cron]", JSON.stringify(out));
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
