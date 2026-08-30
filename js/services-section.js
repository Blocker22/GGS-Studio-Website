// The public "Services & rates" cards.
//
// These used to be three hand-written blocks in index.html, so a service added
// in the admin panel never appeared here and an edited price silently drifted
// out of sync with what the booking form actually charged. Now the section is
// rendered from the same `rooms` / `services` rows the booking form prices
// against, which makes the admin panel the single place rates are edited.

import { getSupabase } from './supabase-client.js';

function peso(amount) {
  return '₱' + Math.round(amount).toLocaleString('en-PH');
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  (children || []).forEach((c) => c && node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

// "01", "02", … keeping the numbered look the hardcoded cards had.
function cardNumber(index) {
  return String(index + 1).padStart(2, '0');
}

function card({ index, title, description, price, requiresName }) {
  const parts = [
    el('span', { class: 'num mono' }, [cardNumber(index)]),
    el('h3', {}, [title]),
    el('p', {}, [description || '']),
  ];
  if (requiresName) {
    parts.push(el('span', { class: 'service-requires' }, [`Booked together with ${requiresName}`]));
  }
  parts.push(el('span', { class: 'price' }, [price]));
  // --i drives the reveal stagger in style.css, which can no longer assume
  // exactly three cards.
  return el('div', { class: 'service', style: `--i:${index}` }, parts);
}

export async function initServicesSection() {
  const grid = document.getElementById('servicesGrid');
  if (!grid) return;

  const supabase = await getSupabase();
  const [{ data: rooms }, { data: services }] = await Promise.all([
    supabase.from('rooms').select('*').eq('is_active', true).order('created_at').limit(1),
    supabase.from('services').select('*').eq('is_active', true),
  ]);

  const room = rooms?.[0] || null;
  const list = (services || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  const nameById = new Map(list.map((s) => [s.id, s.name]));

  const cards = [];
  // The room is the base rate every session pays, so it leads — it is not one
  // of the add-ons and is never listed among them.
  if (room) {
    cards.push({
      title: room.name,
      description: room.description || '',
      price: `${peso(room.hourly_rate)} / hr`,
    });
  }
  list.forEach((s) => {
    cards.push({
      title: s.name,
      description: s.description || '',
      price: s.price_type === 'hourly'
        ? `+ ${peso(s.price)} / hr`
        : s.price_type === 'unit'
        ? `+ ${peso(s.price)} / ${s.unit_label || 'unit'}`
        : `+ ${peso(s.price)} flat`,
      // Only name a prerequisite that is itself on offer — pointing at a
      // service nobody can see would read as a dead end.
      requiresName: s.requires_service_id ? nameById.get(s.requires_service_id) : null,
    });
  });

  grid.innerHTML = '';
  if (cards.length === 0) {
    grid.appendChild(el('p', { class: 'muted', style: 'padding:32px;' }, ['Rates are being updated — please check back shortly.']));
    return;
  }
  cards.forEach((c, i) => grid.appendChild(card({ ...c, index: i })));
}
