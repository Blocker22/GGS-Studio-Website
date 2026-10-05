// Recording a customer's proof of an online transfer. Shared by submit-receipt
// (device or account callers) and public-api (the signed booking link), so
// both apply the same rules: the file exists, is a real image or PDF, the
// method is one the studio offers, and a replacement drops the old file.
// deno-lint-ignore-file no-explicit-any

export const RECEIPT_BUCKET = "payment-receipts";

/** Magic bytes: JPEG, PNG, GIF, WebP, HEIC/HEIF or PDF. */
export function sniffType(head: Uint8Array): string | null {
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  if (head[0] === 0x52 && head[1] === 0x49 && head[8] === 0x57 && head[9] === 0x45) return "image/webp";
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "image/heic";
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "application/pdf";
  return null;
}

export async function onlineMethods(admin: any): Promise<any[]> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "payment_methods").maybeSingle();
  return (data?.value ?? []).filter((m: any) => m.kind === "online");
}

export async function recordReceipt(
  admin: any,
  bookingId: string,
  input: { path: string; reference: string; channel: string },
): Promise<{ payment?: any; error?: string; status?: number }> {
  const methods = await onlineMethods(admin);
  const method = methods.find((m) => m.id === input.channel);
  if (!method) return { error: "Please choose which account you paid to.", status: 400 };
  const reference = (input.reference ?? "").trim();
  if (method.needs_ref !== false && !reference) return { error: "Please enter the reference number shown on your receipt.", status: 400 };
  if (reference.length > 64) return { error: "That reference number is too long.", status: 400 };

  const path = input.path.trim();
  const slash = path.lastIndexOf("/");
  const fileName = path.slice(slash + 1);
  const { data: listed } = await admin.storage.from(RECEIPT_BUCKET).list(path.slice(0, slash), { search: fileName });
  if (!listed?.some((f: any) => f.name === fileName)) {
    return { error: "We could not find your uploaded receipt. Please attach it again.", status: 400 };
  }
  const { data: blob } = await admin.storage.from(RECEIPT_BUCKET).download(path);
  const head = blob ? new Uint8Array(await blob.slice(0, 12).arrayBuffer()) : new Uint8Array();
  if (!sniffType(head)) {
    await admin.storage.from(RECEIPT_BUCKET).remove([path]);
    return { error: "That file isn't a screenshot or PDF we can read. Please attach the receipt again.", status: 400 };
  }

  const { data: booking } = await admin.from("bookings").select("id, status").eq("id", bookingId).single();
  if (!booking) return { error: "Booking not found.", status: 404 };
  if (booking.status === "cancelled") return { error: "That booking was cancelled, so there is nothing to pay.", status: 400 };

  const { data: payment } = await admin
    .from("payments")
    .select("id, status, receipt_path")
    .eq("booking_id", bookingId)
    .eq("method", "manual")
    .neq("type", "refund")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) return { error: "This booking has no online payment to settle.", status: 404 };
  if (payment.status === "succeeded") return { error: "This payment is already verified. Nothing more to send.", status: 400 };
  if (["refunded", "partially_refunded"].includes(payment.status)) return { error: "This payment was refunded. Please contact the studio.", status: 400 };

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("payments")
    .update({
      status: "submitted",
      receipt_path: path,
      reference_no: reference || null,
      channel: method.id,
      submitted_at: now,
      rejection_reason: null,
      updated_at: now,
    })
    .eq("id", payment.id)
    .select()
    .single();
  if (error) return { error: "Could not record your receipt.", status: 400 };

  if (payment.receipt_path && payment.receipt_path !== path) {
    await admin.storage.from(RECEIPT_BUCKET).remove([payment.receipt_path]);
  }
  return { payment: updated };
}
