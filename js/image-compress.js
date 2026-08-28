// Client-side downscale for the ID photo upload. The customer-ids storage
// bucket has a hard 2MB file_size_limit set on the Supabase project — a
// phone photo of an ID routinely blows past that, and the old behavior was
// to just reject the file and tell the customer to find a smaller one. This
// compresses it for them instead, so the limit is invisible in the common
// case.
export const MAX_ID_IMAGE_BYTES = 2 * 1024 * 1024;

// Tried largest-to-smallest so a photo that only needs a mild quality drop
// keeps its original resolution instead of always jumping to the smallest.
const MAX_DIMENSIONS = [2000, 1600, 1200, 1000, 800];
const QUALITIES = [0.85, 0.7, 0.55, 0.4];

function toJpegName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base || 'id'}.jpg`;
}

const DECODE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Returns the original File unchanged if it's already small enough, isn't an
// image, or can't be decoded in this browser (HEIC support is Safari-only —
// createImageBitmap rejects instead of throwing synchronously elsewhere for
// an unsupported format). The decode is also capped at a few seconds — a
// booking shouldn't be able to get stuck forever on "Compressing photo…" over
// one file, whatever the reason a particular device fails to decode it.
// Otherwise returns a re-encoded JPEG File, picking the largest
// resolution/quality combination that fits under the limit. If nothing gets
// small enough (rare for an ID photo), returns the smallest attempt made —
// closer to the limit is strictly better than not trying, and any remaining
// gap is still caught by the bucket's own limit with a clear upload error.
export async function compressImageIfNeeded(file, maxBytes = MAX_ID_IMAGE_BYTES) {
  if (!file || file.size <= maxBytes || !file.type.startsWith('image/')) return file;

  let bitmap;
  try {
    bitmap = await withTimeout(createImageBitmap(file), DECODE_TIMEOUT_MS);
  } catch {
    return file;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let smallest = null;

    for (const maxDim of MAX_DIMENSIONS) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of QUALITIES) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= maxBytes) {
          return new File([blob], toJpegName(file.name), { type: 'image/jpeg' });
        }
      }
    }
    return smallest ? new File([smallest], toJpegName(file.name), { type: 'image/jpeg' }) : file;
  } finally {
    bitmap.close?.();
  }
}
