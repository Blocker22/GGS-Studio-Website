// Booking rules shared by every function that creates or changes a booking:
// the schedule, pricing with snapshots, vouchers, public limits, and the
// field-level diff the audit log records.
// deno-lint-ignore-file no-explicit-any

import { checkWindow, localDate, todayLocal, addDays } from "./schedule.js";
import { computeDiscount, normaliseCode, voucherLabel, voucherProblem } from "./voucher.js";

export const UNIT_MS = 3600000;

/** Run work after the response is sent, without the runtime killing it. */
export function background(p: Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e) => console.error("[background]", e)));
  else p.catch((e) => console.error("[background]", e));
}

export async function loadSchedule(admin: any, roomId: string) {
  const [{ data: hours }, { data: setting }] = await Promise.all([
    admin.from("operating_hours").select("day_of_week, open_time, close_time, is_closed").eq("room_id", roomId),
    admin.from("staff_settings").select("value").eq("key", "schedule").maybeSingle(),
  ]);
  return {
    weekly: (hours ?? []).map((h: any) => ({
      dow: h.day_of_week,
      closed: h.is_closed || !h.open_time || !h.close_time,
      open: h.open_time ? String(h.open_time).slice(0, 5) : null,
      close: h.close_time ? String(h.close_time).slice(0, 5) : null,
    })),
    overrides: setting?.value?.overrides ?? [],
  };
}

export async function loadRules(admin: any) {
  const { data } = await admin.from("app_settings").select("key, value").in("key", ["booking_rules", "payment_methods", "deposit_percent", "reschedule_cutoff_hours"]);
  const get = (k: string) => data?.find((r: any) => r.key === k)?.value;
  const rules = get("booking_rules") || {};
  return {
    maxDaysAhead: Number(rules.max_days_ahead ?? 90),
    maxOpen: Number(rules.max_open_per_customer ?? 3),
    minLeadMinutes: Number(rules.min_lead_minutes ?? 60),
    requireIdForCash: rules.require_id_for_cash !== false,
    idRetentionDays: Number(rules.id_retention_days ?? 30),
    feedbackEnabled: rules.feedback_enabled !== false,
    feedbackDelayHours: Number(rules.feedback_delay_hours ?? 3),
    methods: (get("payment_methods") || []) as any[],
    depositPercent: Number(get("deposit_percent") ?? 20),
    cutoffHours: Number(get("reschedule_cutoff_hours") ?? 24),
  };
}

/**
 * Public limits (staff skip all of these, but never capacity): not in the
 * past, enough lead time, within the booking window, inside the schedule.
 */
export function publicTimeProblem(schedule: any, rules: any, startIso: string, endIso: string): string | null {
  const start = new Date(startIso).getTime();
  if (start < Date.now()) return "That time has already passed.";
  if (start < Date.now() + rules.minLeadMinutes * 60000) {
    return `Please book at least ${rules.minLeadMinutes >= 60 ? `${Math.round(rules.minLeadMinutes / 60)} hour${rules.minLeadMinutes >= 120 ? "s" : ""}` : `${rules.minLeadMinutes} minutes`} ahead.`;
  }
  if (localDate(new Date(start)) > addDays(todayLocal(), rules.maxDaysAhead)) {
    return `We take bookings up to ${rules.maxDaysAhead} days ahead.`;
  }
  const clash = checkWindow(schedule, startIso, endIso, { publicView: true });
  return clash ? clash.message : null;
}

export type ServiceRow = {
  id: string;
  name: string;
  price: number;
  price_type: string;
  slug: string;
  is_active: boolean;
  requires_service_id: string | null;
  unit_label: string | null;
};

export function quantityFor(service: ServiceRow, quantities: Record<string, unknown>): number {
  if (service.price_type !== "unit") return 1;
  const raw = Math.floor(Number(quantities?.[service.id]));
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 99) : 1;
}

export function serviceComboProblem(selected: ServiceRow[], all: ServiceRow[]): string | null {
  const picked = new Set(selected.map((s) => s.id));
  const nameById = new Map(all.map((s) => [s.id, s.name]));
  for (const s of selected) {
    if (s.requires_service_id && !picked.has(s.requires_service_id)) {
      const required = nameById.get(s.requires_service_id) ?? "another service";
      return `${s.name} requires ${required}. Add ${required} too, or remove ${s.name}.`;
    }
  }
  return null;
}

/** Add-on lines with the price snapshot each booking stores. */
export function priceAddons(services: ServiceRow[], quantities: Record<string, unknown>, hours: number) {
  return services.map((s) => {
    const qty = quantityFor(s, quantities);
    const price = s.price_type === "hourly" ? Number(s.price) * hours : s.price_type === "unit" ? Number(s.price) * qty : Number(s.price);
    return { service: s, qty, price };
  });
}

/** Non-cancelled bookings carrying this code (optionally excluding one). */
export async function voucherUses(admin: any, code: string, opts: { excludeId?: string | null; email?: string | null; customerId?: string | null } = {}) {
  let q = admin.from("bookings").select("id, guest_email, customer_id").neq("status", "cancelled").filter("voucher->>code", "eq", code);
  if (opts.excludeId) q = q.neq("id", opts.excludeId);
  const { data } = await q;
  const rows = data ?? [];
  const email = (opts.email ?? "").toLowerCase();
  const mine = rows.filter((r: any) =>
    (email && (r.guest_email ?? "").toLowerCase() === email) || (opts.customerId && r.customer_id === opts.customerId)
  ).length;
  return { total: rows.length, mine };
}

/**
 * Validates a voucher code for a booking and returns the snapshot to store, or
 * an error a customer can read. Checked against the booking's start date.
 */
export async function resolveVoucher(
  admin: any,
  rawCode: unknown,
  ctx: { startIso: string; hours: number; list: number; baseRate: number; email?: string | null; customerId?: string | null; excludeId?: string | null },
): Promise<{ snapshot: any; discount: number } | { error: string } | null> {
  const code = normaliseCode(rawCode);
  if (!code) return null;
  const { data: v } = await admin.from("vouchers").select("*").eq("code", code).maybeSingle();
  if (!v) return { error: "We don't recognise that voucher code." };
  const uses = await voucherUses(admin, code, { excludeId: ctx.excludeId, email: ctx.email, customerId: ctx.customerId });
  const problem = voucherProblem(v, { date: localDate(new Date(ctx.startIso)), units: ctx.hours, uses: uses.total, customerUses: uses.mine });
  if (problem) return { error: problem };
  const discount = computeDiscount(v, { list: ctx.list, units: ctx.hours, baseRate: ctx.baseRate });
  return {
    discount,
    snapshot: { code, kind: v.kind, value: Number(v.value), label: voucherLabel(v), discount, voucher_id: v.id },
  };
}

/** Field-level changes for the audit log: [{ field, from, to }]. */
export function diff(before: Record<string, any>, after: Record<string, any>, fields: string[]) {
  const out: Array<{ field: string; from: unknown; to: unknown }> = [];
  fields.forEach((f) => {
    const a = before?.[f] ?? null;
    const b = after?.[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: f, from: a, to: b });
  });
  return out;
}

export function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Plausible phone: 7 to 15 digits, optional leading +. Returns the cleaned value or null. */
export function cleanPhone(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/[^\d+\s()-]/g, "").slice(0, 24);
  const d = digits(s);
  return d.length >= 7 && d.length <= 15 ? s : null;
}

/** Bookings a customer still has coming up (pending or confirmed). */
export async function openBookingsFor(admin: any, who: { email?: string | null; customerId?: string | null }) {
  const now = new Date().toISOString();
  const filters: string[] = [];
  if (who.email) filters.push(`guest_email.ilike.${who.email.replace(/[,()]/g, "")}`);
  if (who.customerId) filters.push(`customer_id.eq.${who.customerId}`);
  if (!filters.length) return 0;
  const { count } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "confirmed"])
    .gt("end_at", now)
    .or(filters.join(","));
  return count ?? 0;
}

export function actorLabel(caller: { isStaff: boolean; userId: string | null; email: string | null }, booking?: any, staffName?: string | null) {
  if (caller.isStaff) return staffName || caller.email || "staff";
  if (booking?.guest_name) return `${booking.guest_name} <${booking.guest_email ?? "no email"}>`;
  return caller.email ?? booking?.guest_email ?? caller.userId ?? "public";
}

export async function staffName(admin: any, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? null;
}

/** The caller's IP as the edge sees it. */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** True when this hit is over the limit. Fails open if the counter is unavailable. */
export async function rateLimited(admin: any, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("hit_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) {
    console.error("[rate-limit]", error.message);
    return false;
  }
  return data === false;
}
