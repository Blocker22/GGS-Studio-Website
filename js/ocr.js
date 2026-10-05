// On-device text reading for receipts and ID photos. Tesseract.js is only
// downloaded the first time someone actually asks for a reading, and the
// image never leaves the browser for this: the results are advisory hints
// (prefill a reference number, flag a name that isn't on the ID), never proof.

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;
let workerPromise = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the text reader.'));
      document.head.appendChild(s);
    });
  }
  return loading;
}

async function worker() {
  await loadScript();
  if (!workerPromise) workerPromise = window.Tesseract.createWorker('eng');
  return workerPromise;
}

/** Reads the text in an image (File, Blob, data URL or http URL). */
export async function readImage(source) {
  const w = await worker();
  const { data } = await w.recognize(source);
  return data?.text || '';
}

/** The likeliest transfer reference number in a receipt's text. */
export function guessReference(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const labelled = /(?:ref(?:erence)?\.?\s*(?:no\.?|number|#)?|transaction\s*(?:id|no\.?))\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{5,30})/i.exec(flat);
  if (labelled) return labelled[1].replace(/\s+/g, '').replace(/-+$/, '');
  const long = flat.match(/\b\d{10,16}\b/);
  return long ? long[0] : null;
}

/** Peso amounts printed on a receipt. */
export function amountsIn(text) {
  return [...String(text || '').matchAll(/(?:PHP|₱|P)\s?([\d,]+(?:\.\d{2})?)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
}
