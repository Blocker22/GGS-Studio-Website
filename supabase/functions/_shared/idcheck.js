// Philippine ID number checks, shared by the booking form (live feedback) and
// create-booking (the check that counts). Same file in both places, so the
// browser can never accept a number the server will refuse.
//
// These are FORMAT checks only. The issuing agencies publish no checksums, so a
// number that passes here is shaped right, not proven real. Types with no
// published format accept 4-30 letters and digits and say "no number check".

const STRIP = /[\s.-]/g;

export const ID_TYPES = [
  { id: 'philsys', label: 'PhilSys National ID', pattern: /^\d{16}$/, hint: '16 digits, e.g. 1234-5678-9012-3456', words: ['philsys', 'pambansang', 'national id', 'philippine identification'] },
  { id: 'drivers', label: "Driver's license (LTO)", pattern: /^[A-Z]\d{10}$/, hint: 'Letter + 10 digits, e.g. N01-23-456789', words: ['driver', 'license', 'lto', 'land transportation'] },
  { id: 'passport', label: 'Passport', pattern: /^([A-Z]{2}\d{7}|[A-Z]\d{7}[A-Z])$/, hint: 'e.g. P1234567A or EC1234567', words: ['passport', 'pasaporte'] },
  { id: 'umid', label: 'UMID', pattern: /^\d{12}$/, hint: '12-digit CRN, e.g. 0111-1234567-8', words: ['umid', 'unified multi-purpose', 'crn'] },
  { id: 'sss', label: 'SSS ID', pattern: /^\d{10}$/, hint: '10 digits, e.g. 34-1234567-8', words: ['social security', 'sss'] },
  { id: 'tin', label: 'TIN ID', pattern: /^\d{9}(\d{3}|\d{5})?$/, hint: '9 to 14 digits, e.g. 123-456-789-000', words: ['tin', 'taxpayer', 'bureau of internal revenue', 'bir'] },
  { id: 'prc', label: 'PRC ID', pattern: /^\d{7}$/, hint: '7-digit registration number', words: ['professional regulation', 'prc'] },
  { id: 'philhealth', label: 'PhilHealth ID', pattern: /^\d{12}$/, hint: '12 digits, e.g. 12-345678901-2', words: ['philhealth'] },
  { id: 'pagibig', label: 'Pag-IBIG ID', pattern: /^\d{12}$/, hint: '12 digits, e.g. 1234-5678-9012', words: ['pag-ibig', 'pagibig', 'hdmf'] },
  { id: 'postal', label: 'Postal ID', pattern: null, hint: 'As printed on the card', words: ['postal', 'phlpost'] },
  { id: 'voters', label: "Voter's ID", pattern: null, hint: 'As printed on the card', words: ['comelec', 'voter'] },
  { id: 'senior', label: 'Senior citizen ID', pattern: null, hint: 'As printed on the card', words: ['senior citizen', 'osca'] },
  { id: 'pwd', label: 'PWD ID', pattern: null, hint: 'As printed on the card', words: ['pwd', 'persons with disability'] },
  { id: 'school', label: 'School or student ID', pattern: null, hint: 'Student number as printed', words: ['university', 'college', 'school', 'student'] },
  { id: 'other', label: 'Other government ID', pattern: null, hint: 'As printed on the card', words: [] },
];

export function idType(id) {
  return ID_TYPES.find((t) => t.id === id) || null;
}

export function normaliseIdNumber(value) {
  return String(value ?? '').toUpperCase().replace(STRIP, '');
}

/**
 * { ok, formatChecked, normalised, message }. `formatChecked` is false for
 * types with no published format: those pass on shape alone.
 */
export function validateIdNumber(typeId, value) {
  const type = idType(typeId);
  const normalised = normaliseIdNumber(value);
  if (!type) return { ok: false, formatChecked: false, normalised, message: 'Choose which ID you are using.' };
  if (!normalised) return { ok: false, formatChecked: false, normalised, message: 'Enter the ID number.' };
  if (type.pattern) {
    const ok = type.pattern.test(normalised);
    return {
      ok,
      formatChecked: true,
      normalised,
      message: ok ? '' : `That doesn't look like a ${type.label} number. ${type.hint}.`,
    };
  }
  const ok = /^[A-Z0-9]{4,30}$/.test(normalised);
  return { ok, formatChecked: false, normalised, message: ok ? '' : 'Use 4 to 30 letters and digits, as printed on the card.' };
}

/** Only the last four characters are ever stored. */
export function maskIdNumber(value) {
  const n = normaliseIdNumber(value);
  return n ? `•••• ${n.slice(-4)}` : '';
}

/** Best guess of the card type from words OCR found on the photo. */
export function guessIdType(text) {
  const t = String(text || '').toLowerCase();
  let best = null;
  let hits = 0;
  ID_TYPES.forEach((type) => {
    const n = type.words.filter((w) => t.includes(w)).length;
    if (n > hits) { best = type.id; hits = n; }
  });
  return best;
}
