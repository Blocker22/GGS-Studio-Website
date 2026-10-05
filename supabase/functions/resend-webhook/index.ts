import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient } from "../_shared/guest.ts";
import { ingestReceived } from "../_shared/inbound.ts";

// Resend's webhook for received mail. Signed with Svix: HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>" with the base64 key after "whsec_".
// Anything unsigned, mis-signed or older than 5 minutes gets a 401. The
// payload carries metadata only; the body is fetched by id in ingestReceived.

async function verify(secret: string, id: string, ts: string, body: string, header: string): Promise<boolean> {
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...sig));
  return header.split(" ").some((part) => {
    const [, value] = part.split(",");
    if (!value || value.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const admin = adminClient();
  const body = await req.text();

  let secret = Deno.env.get("RESEND_WEBHOOK_SECRET")?.trim() ?? "";
  if (!secret) {
    const { data } = await admin.from("app_secrets").select("value").eq("key", "resend_webhook_secret").maybeSingle();
    secret = data?.value ?? "";
  }
  const ok = secret && await verify(
    secret,
    req.headers.get("svix-id") ?? "",
    req.headers.get("svix-timestamp") ?? "",
    body,
    req.headers.get("svix-signature") ?? "",
  );
  if (!ok) return new Response("Invalid signature", { status: 401 });

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (event?.type !== "email.received" || !event?.data?.email_id) return new Response("Ignored", { status: 200 });

  try {
    await ingestReceived(admin, event.data.email_id, { notify: true });
  } catch (err) {
    // A 500 makes Resend retry, which is what we want for a transient failure.
    console.error("[resend-webhook]", err);
    return new Response("Ingest failed", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});
