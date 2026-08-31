import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accountDeletedEmail, sendEmail } from "./email.ts";
import { logAudit } from "./audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function peso(n: number): string {
  return "₱" + Math.round(n).toLocaleString("en-PH");
}

// Files a signed-in customer uploads are keyed under their own user id, in both
// private buckets — so erasing those is "empty these two folders". Anything
// booked before they had an account instead sits under guest/<device id>/, which
// no user folder covers, so those paths are collected off the rows themselves.
const USER_BUCKETS = ["customer-ids", "payment-receipts"];

async function emptyUserFolder(admin: any, bucket: string, userId: string) {
  const { data: files } = await admin.storage.from(bucket).list(userId);
  if (!files || files.length === 0) return;
  await admin.storage.from(bucket).remove(files.map((f: any) => `${userId}/${f.name}`));
}

async function removePaths(admin: any, bucket: string, paths: string[]) {
  const guestPaths = paths.filter((p) => typeof p === "string" && p.startsWith("guest/"));
  if (guestPaths.length === 0) return;
  await admin.storage.from(bucket).remove(guestPaths);
}

// Permanent deletion of a customer account, under the Data Privacy Act's right
// to erasure (RA 10173). Two callers, one rule set: a customer deleting their
// own account from the profile page, and staff deleting one from the admin
// customers tab.
//
// Bookings are anonymised, not destroyed. A past session is the studio's own
// financial record — what it earned, when the room was occupied — and BIR
// wants those kept. Stripping every trace of the person and leaving the booking
// as a walk-in erases them while the studio keeps its books. "Every trace" now
// includes the guest fields: a booking made before the account existed and
// claimed on sign-up still carries the email it was booked under.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated." }, 401);
  const caller = userData.user;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const { user_id, force } = body ?? {};

  // Default to self-deletion; a user_id is only honoured for staff.
  const targetId = typeof user_id === "string" && user_id ? user_id : caller.id;

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, full_name")
    .eq("id", caller.id)
    .single();
  const isStaff = ["staff", "admin"].includes(callerProfile?.role ?? "");

  if (targetId !== caller.id && !isStaff) {
    return json({ error: "You can only delete your own account." }, 403);
  }

  const { data: target } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", targetId)
    .single();
  if (!target) return json({ error: "Account not found." }, 404);

  // Staff/admin accounts are deliberately out of scope: removing one is a
  // permissions decision, not a privacy one, and belongs in the staff tab.
  if (target.role !== "customer") {
    return json({ error: "Only customer accounts can be deleted here. Change the role first, or remove them from the Staff tab." }, 400);
  }

  const { data: bookings } = await admin
    .from("bookings")
    .select("id, status, start_at, id_image_path")
    .eq("customer_id", targetId);
  const all = bookings ?? [];

  // A session still on the calendar is a live arrangement — the studio has a
  // room held and possibly money in hand. Cancel it first so both sides agree
  // it's over, rather than having it silently become an unattributable
  // walk-in. Staff can override; a customer is pointed at their own cancel
  // button, which is one page away.
  const upcoming = all.filter(
    (b) => ["pending", "confirmed"].includes(b.status) && new Date(b.start_at).getTime() > Date.now(),
  );

  const bookingIds = all.map((b) => b.id);

  const { data: payments } = bookingIds.length
    ? await admin
      .from("payments")
      .select("amount, refunded_amount, status, receipt_path")
      .in("booking_id", bookingIds)
    : { data: [] };
  const unrefunded = (payments ?? [])
    .filter((p) => ["succeeded", "partially_refunded"].includes(p.status))
    .reduce((sum, p) => sum + (Number(p.amount) - Number(p.refunded_amount)), 0);

  if ((upcoming.length > 0 || unrefunded > 0) && !force) {
    const reasons: string[] = [];
    if (upcoming.length > 0) {
      reasons.push(`${upcoming.length} upcoming session${upcoming.length > 1 ? "s" : ""} still booked`);
    }
    if (unrefunded > 0) reasons.push(`${peso(unrefunded)} paid and not refunded`);
    return json({
      error: `This account has ${reasons.join(" and ")}.`,
      upcoming_count: upcoming.length,
      unrefunded_amount: unrefunded,
      // Only staff are offered the override; the customer gets told to cancel.
      can_force: isStaff,
    }, 409);
  }

  // Anonymise first: bookings.customer_id is ON DELETE NO ACTION, so the auth
  // deletion below would otherwise be refused outright by the FK.
  if (all.length > 0) {
    const { error: anonErr } = await admin
      .from("bookings")
      .update({
        customer_id: null,
        guest_name: "Deleted account",
        // Booked before they registered: the address and phone number they gave
        // then are theirs too, and the device link would tie the record back to
        // a browser they still use.
        guest_email: null,
        guest_phone: null,
        device_id: null,
        // The ID photo is about to be erased from storage, so the pointer goes too.
        id_image_path: null,
      })
      .eq("customer_id", targetId);
    if (anonErr) {
      return json({ error: "Could not anonymise this account's bookings.", detail: anonErr.message }, 400);
    }
  }

  // Receipts hang off payments, which hang off bookings — those rows stay (the
  // studio's record of the money), but the customer's uploaded images go.
  for (const bucket of USER_BUCKETS) {
    try {
      await emptyUserFolder(admin, bucket, targetId);
    } catch {
      // A stuck file shouldn't block the erasure of the account itself.
    }
  }
  // Uploads from before the account existed live under guest/<device id>/, which
  // the folder sweep above cannot reach — remove those by path.
  try {
    await removePaths(admin, "customer-ids", all.map((b: any) => b.id_image_path));
    await removePaths(admin, "payment-receipts", (payments ?? []).map((p: any) => p.receipt_path));
  } catch {
    // Same reasoning: a stuck file must not strand the deletion.
  }
  if (bookingIds.length) {
    await admin.from("payments").update({ receipt_path: null }).in("booking_id", bookingIds);
  }

  // Any browser that had signed into this account stops being a "recognised
  // device" for its email — there is no account left for it to vouch for.
  await admin.from("guest_device_emails").delete().eq("user_id", targetId);

  // Logged before the deletion, not after: audit_log.actor_id references
  // auth.users, so once targetId (possibly the actor themselves, on a
  // self-delete) stops existing, an insert naming it as the actor would
  // violate that foreign key. The row this describes is the deletion itself,
  // so recording it right before it happens is correct either way.
  await logAudit(
    admin,
    {
      id: caller.id,
      role: isStaff ? (callerProfile?.role ?? "staff") : "customer",
      label: callerProfile?.full_name || caller.email || caller.id,
    },
    "account.delete",
    "profile",
    targetId,
    {
      subject_name: target.full_name,
      self: targetId === caller.id,
      bookings_anonymised: all.length,
      forced: Boolean(force) && (upcoming.length > 0 || unrefunded > 0),
    },
  );

  // The address has to be read while the auth user still exists — after the
  // deletion below there is nothing left to look it up from.
  let farewell: { email: string | null; name: string | null } | null = null;
  try {
    const { data: targetUser } = await admin.auth.admin.getUserById(targetId);
    if (targetUser?.user?.email) farewell = { email: targetUser.user.email, name: target.full_name ?? null };
  } catch (err) {
    console.error("[email] could not resolve the deleted account's address:", err);
  }

  // Cascades to public.profiles via profiles_id_fkey.
  const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
  if (delErr) return json({ error: "Could not delete the account.", detail: delErr.message }, 400);

  if (farewell) {
    const { subject, html } = accountDeletedEmail(farewell);
    await sendEmail(farewell, subject, html);
  }

  return json({
    deleted: true,
    user_id: targetId,
    bookings_anonymised: all.length,
    self: targetId === caller.id,
  });
});
