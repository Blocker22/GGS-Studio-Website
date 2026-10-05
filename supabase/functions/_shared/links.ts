// Signed links that need nothing stored: <id>.<HMAC-SHA256(secret, purpose:id)>
// cut to 22 base64url characters. Purposes: 'manage' (the customer's booking
// page) and 'unsubscribe'. The secret lives in app_secrets (service role only)
// and is generated once by the admin_blueprint migration.
//
// One-time links (feedback) use random tokens whose sha256 is stored instead.
// deno-lint-ignore-file no-explicit-any

export const SITE_URL = (Deno.env.get("SITE_URL")?.trim() || "https://www.ggsstudio.site").replace(/\/+$/, "");

let secretPromise: Promise<string> | null = null;

async function linkSecret(admin: any): Promise<string> {
  const fromEnv = Deno.env.get("LINK_SECRET")?.trim();
  if (fromEnv) return fromEnv;
  if (!secretPromise) {
    secretPromise = admin.from("app_secrets").select("value").eq("key", "link_secret").single()
      .then(({ data }: any) => {
        if (!data?.value) throw new Error("link_secret is missing from app_secrets");
        return data.value as string;
      });
  }
  return await secretPromise!;
}

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))).slice(0, 22);
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(admin: any, purpose: string, id: string): Promise<string> {
  return `${id}.${await hmac(await linkSecret(admin), `${purpose}:${id}`)}`;
}

/** Returns the id the token speaks for, or null. */
export async function verifyToken(admin: any, purpose: string, token: unknown): Promise<string | null> {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(await linkSecret(admin), `${purpose}:${id}`);
  return sameString(sig, expected) ? id : null;
}

export async function manageUrl(admin: any, bookingId: string): Promise<string> {
  return `${SITE_URL}/booking?t=${encodeURIComponent(await signToken(admin, "manage", bookingId))}`;
}

export async function unsubscribeUrl(admin: any, email: string): Promise<string> {
  return `${SITE_URL}/unsubscribe?t=${encodeURIComponent(await signToken(admin, "unsubscribe", email.toLowerCase()))}`;
}

export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf.buffer);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
