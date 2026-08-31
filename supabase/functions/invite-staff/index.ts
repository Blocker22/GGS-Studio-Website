import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
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

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, full_name")
    .eq("id", userData.user.id)
    .single();
  if (callerProfile?.role !== "admin") return json({ error: "Admin access required." }, 403);
  const actor = {
    id: userData.user.id,
    role: callerProfile.role,
    label: callerProfile.full_name || userData.user.email || userData.user.id,
  };

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const { email, full_name, role } = body ?? {};
  if (typeof email !== "string" || !email.includes("@")) return json({ error: "A valid email is required." }, 400);
  const assignedRole = role === "admin" ? "admin" : "staff";

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: typeof full_name === "string" ? full_name : undefined },
  });
  if (inviteErr || !invited?.user) return json({ error: "Could not send invite.", detail: inviteErr?.message }, 400);

  await admin
    .from("profiles")
    .update({ role: assignedRole, full_name: typeof full_name === "string" ? full_name : null })
    .eq("id", invited.user.id);

  // The generic profiles-role trigger only fires for a direct authenticated
  // write; this update runs as the service role, so it's logged here instead —
  // with the one piece of context the trigger could never have had anyway,
  // the invited email address.
  await logAudit(admin, actor, "staff.invite", "profile", invited.user.id, {
    email,
    full_name: typeof full_name === "string" ? full_name : null,
    role: assignedRole,
  });

  return json({ user_id: invited.user.id, email, role: assignedRole });
});
