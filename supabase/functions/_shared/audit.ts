// Explicit audit-log writes for Edge Functions.
//
// These functions run as the service role, which bypasses RLS entirely —
// including the database triggers in the create_audit_log migration, which
// deliberately skip anything not done by a real user's own authenticated
// request (auth.role() = 'authenticated'). That split exists so every
// mutation is logged exactly once: direct staff edits through RLS are
// caught automatically by the triggers, and everything that goes through an
// Edge Function (which has richer context — a guest's device, the price at
// booking time, a staff-typed rejection reason) logs itself here instead.
//
// This file is deployed verbatim alongside each function that calls it, the
// same way guest.ts is — Edge Functions have no shared runtime.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type AuditActor = {
  id: string | null;
  role: string; // 'admin' | 'staff' | 'customer' | 'guest'
  label: string;
};

/**
 * Records one audit-log entry. Never throws — a logging failure must not take
 * down the operation it was describing, so any error here is swallowed after
 * being printed to the function's own logs for later investigation.
 */
export async function logAudit(
  admin: SupabaseClient,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actor.id,
      actor_role: actor.role,
      actor_label: actor.label,
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail,
    });
    if (error) console.error(`[audit] insert failed for ${action}:`, error.message);
  } catch (err) {
    console.error(`[audit] insert threw for ${action}:`, err);
  }
}
