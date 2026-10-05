// Studio facts the social graphics print: address, phone numbers, website
// and the studio photos. Filled once by loadBrand() from Setup > Contacts and
// assets/slideshow/manifest.json, so a changed phone number shows up in the
// next graphic without touching this code.
//
// The renderer reads these synchronously while it lays a design out, so
// loadBrand() must have finished before the first paint.

import { sb } from '../core.js';

export const SITE_DOMAIN = 'ggsstudio.site';
export let ADDRESS = ['Manson Trading, Looc', 'Lapu-Lapu City, Cebu'];
let phones = [{ name: 'GGS Studio', phone: '+63 976 350 6301' }];

/** { key: { src, thumb, alt, orientation } } for the studio photos. */
export const PHOTOS = {};

export const phoneContacts = () => phones;
export const studioPhotoKeys = () => Object.keys(PHOTOS);

/** "+63 976 350 6301" and "09763506301" both print as "0976 350 6301". */
export function displayPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const local = d.startsWith('63') && d.length === 12 ? `0${d.slice(2)}` : d;
  return local.length === 11 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : String(raw || '');
}

let ready = null;
export function loadBrand() {
  if (!ready) {
    ready = (async () => {
      const [contacts, manifest] = await Promise.all([
        sb().then((s) => s.from('app_settings').select('value').eq('key', 'contacts').maybeSingle()).then((r) => r.data?.value).catch(() => null),
        fetch('assets/slideshow/manifest.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      if (contacts?.address) {
        // "Manson Trading, Looc, Lapu-Lapu City, Cebu" prints on two lines.
        const parts = contacts.address.split(',').map((x) => x.trim()).filter(Boolean);
        ADDRESS = parts.length > 2 ? [parts.slice(0, -2).join(', '), parts.slice(-2).join(', ')] : [contacts.address];
      }
      const people = (contacts?.people || []).filter((p) => p.phone);
      if (people.length) phones = people.slice(0, 2);
      manifest.forEach((p) => {
        PHOTOS[`photo${p.n}`] = {
          src: p.web,
          thumb: p.thumb,
          alt: `Studio photo ${p.n}`,
          orientation: p.h > p.w * 1.1 ? 'portrait' : 'landscape',
        };
      });
    })();
  }
  return ready;
}
