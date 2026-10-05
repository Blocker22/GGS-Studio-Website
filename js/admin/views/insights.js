// Reports > Insights. Rules kept exact:
//   usage counts COMPLETED bookings (confirmed + ended reads as completed);
//   revenue counts only completed AND paid; unpaid and waived are separate;
//   revenue splits into room and add-ons, scaled by the same ratio when a
//   voucher or hand-set total applies; occupancy = hours used / (hours open
//   minus hours blocked) over the range; daily series are gap-filled.

import {
  clear, customerName, digits, effectiveStatus, h, hours, hrs, icon, loadCatalog, pageHead, paidAmount, peso, q, sb, state,
  storeGet, storeSet,
} from '../core.js';
import { BOOKING_SELECT } from './booking-dialogs.js';
import { addDays, bookableMinutes, DOW_NAMES, hoursFor, localDate, localMs, todayLocal } from '../../../supabase/functions/_shared/schedule.js';

const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'All time']];

export async function render(root) {
  await loadCatalog();
  const supabase = await sb();
  let days = storeGet('ggs-insights-range', 30);
  const [all, hoursRows, setting] = await Promise.all([
    q(supabase.from('bookings').select(BOOKING_SELECT).limit(10000)),
    q(supabase.from('operating_hours').select('*')),
    q(supabase.from('staff_settings').select('value').eq('key', 'schedule').maybeSingle()),
  ]);
  const room = state.rooms.find((r) => r.is_active) || state.rooms[0];
  const schedule = {
    weekly: (hoursRows || []).filter((x) => x.room_id === room?.id).map((x) => ({ dow: x.day_of_week, closed: x.is_closed || !x.open_time, open: x.open_time?.slice(0, 5), close: x.close_time?.slice(0, 5) })),
    overrides: setting?.value?.overrides || [],
  };

  const body = h('div', { class: 'stack' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Range' }, RANGES.map(([d, label]) => h('button', { type: 'button', 'aria-pressed': String(d === days), onclick: (e) => {
    days = d; storeSet('ggs-insights-range', d);
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    draw();
  } }, label)));
  const tip = h('div', { class: 'chart-tip', hidden: true });
  document.body.appendChild(tip);

  function draw() {
    const today = todayLocal();
    const from = days ? addDays(today, -(days - 1)) : (all.map((b) => localDate(b.start_at)).sort()[0] || today);
    const inRange = all.filter((b) => { const d = localDate(b.start_at); return d >= from && d <= today; });
    const completed = inRange.filter((b) => effectiveStatus(b) === 'completed');
    const cancelled = inRange.filter((b) => b.status === 'cancelled');
    const paidDone = completed.filter((b) => !b.payment_waived);
    const revenueOf = (b) => Math.min(paidAmount(b), Number(b.total_price));
    const split = (b) => {
      const rev = revenueOf(b);
      const addonList = (b.booking_services || []).reduce((s, x) => s + Number(x.price_at_booking || 0), 0);
      const list = (Number(b.rates?.hourly_rate) || 0) * hours(b) + addonList;
      const ratio = list > 0 ? rev / list : 0;
      const addons = Math.min(rev, addonList * ratio);
      return { base: rev - addons, addons };
    };
    const revenue = paidDone.reduce((s, b) => s + revenueOf(b), 0);
    const unpaid = paidDone.filter((b) => paidAmount(b) < Number(b.total_price));
    const waived = completed.filter((b) => b.payment_waived);
    const usedHours = completed.reduce((s, b) => s + hours(b), 0);
    let openMin = 0;
    for (let d = from; d <= today; d = addDays(d, 1)) openMin += bookableMinutes(hoursFor(schedule, d));
    const occupancy = openMin ? (usedHours * 60) / openMin : 0;
    const online = paidDone.reduce((s, b) => s + (b.payments || []).filter((p) => p.method !== 'cash' && ['succeeded', 'partially_refunded'].includes(p.status)).reduce((x, p) => x + Number(p.amount), 0), 0);
    const ident = (b) => b.customer_id || (b.guest_email || '').toLowerCase() || digits(b.guest_phone) || customerName(b).toLowerCase();
    const counts = new Map();
    completed.forEach((b) => counts.set(ident(b), (counts.get(ident(b)) || 0) + 1));
    const repeat = [...counts.values()].filter((n) => n > 1).length;
    const upcoming = all.filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.start_at) > new Date());

    const tile = (label, value, sub, iconName) => h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, icon(iconName), label), h('span', { class: 'tile-value' }, value), sub ? h('span', { class: 'tile-sub' }, sub) : null);
    const tiles = h('div', { class: 'tiles' },
      tile('Revenue', peso(revenue), `Completed and paid · ${revenue ? Math.round((online / revenue) * 100) : 0}% online`, 'coins'),
      tile('Sessions', completed.length, `${cancelled.length} cancelled (${inRange.length ? Math.round((cancelled.length / inRange.length) * 100) : 0}%)`, 'calendar-check'),
      tile('Hours booked', hrs(usedHours), `Avg ${completed.length ? hrs(usedHours / completed.length) : '0 hrs'} per session`, 'clock'),
      tile('Occupancy', `${Math.round(occupancy * 100)}%`, 'Of open hours, minus hours off', 'gauge'),
      tile('Average session', peso(completed.length ? revenue / Math.max(1, paidDone.length) : 0), 'Paid value per session', 'receipt'),
      tile('Customers', counts.size, `${repeat} came back more than once`, 'users'),
      tile('Unpaid', peso(unpaid.reduce((s, b) => s + Number(b.total_price) - paidAmount(b), 0)), `${unpaid.length} completed session${unpaid.length === 1 ? '' : 's'}, ${waived.length} waived`, 'warning-circle'),
      tile('Coming up', upcoming.length, `${peso(upcoming.reduce((s, b) => s + Number(b.total_price), 0))} booked`, 'calendar-plus'));

    // Daily (or monthly for all time) revenue, gap-filled, room vs add-ons.
    const byMonth = !days || days > 120;
    const buckets = new Map();
    if (days) for (let d = from; d <= today; d = addDays(d, 1)) buckets.set(byMonth ? d.slice(0, 7) : d, { base: 0, addons: 0 });
    paidDone.forEach((b) => {
      const k = byMonth ? localDate(b.start_at).slice(0, 7) : localDate(b.start_at);
      if (!buckets.has(k)) buckets.set(k, { base: 0, addons: 0 });
      const sp = split(b);
      buckets.get(k).base += sp.base;
      buckets.get(k).addons += sp.addons;
    });
    const series = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // Add-on attach rates, busiest hours and weekdays (completed sessions).
    const attach = state.services.map((s) => [s.name, completed.filter((b) => (b.booking_services || []).some((x) => x.service_id === s.id)).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const hourUse = Array(24).fill(0);
    const dowUse = Array(7).fill(0);
    completed.forEach((b) => {
      for (let t = new Date(b.start_at).getTime(); t < new Date(b.end_at).getTime(); t += 3600000) {
        const local = new Date(t + 8 * 3600000);
        hourUse[local.getUTCHours()] += 1;
      }
      dowUse[new Date(localMs(localDate(b.start_at), '12:00')).getUTCDay()] += hours(b);
    });

    clear(body).append(
      tiles,
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, `Revenue by ${byMonth ? 'month' : 'day'}`),
        h('div', { class: 'legend', style: 'margin:0' }, h('span', {}, h('i', { style: 'background:var(--chart-1)' }), 'Room'), h('span', {}, h('i', { style: 'background:var(--chart-2)' }), 'Add-ons'))),
      h('div', { class: 'panel-body' }, series.some(([, v]) => v.base + v.addons > 0) ? revenueChart(series, byMonth) : h('p', { class: 'muted' }, 'No paid, completed sessions in this range yet.'),
        tableView(series, byMonth))),
      h('div', { class: 'grid grid-3' },
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Add-ons booked')), h('div', { class: 'panel-body' }, attach.length
          ? attach.map(([n, c]) => h('div', { class: 'hbar' }, h('span', {}, n), h('span', { class: 'bar' }, h('span', { style: `width:${(c / completed.length) * 100}%` })), h('span', { class: 'faint' }, `${Math.round((c / completed.length) * 100)}%`)))
          : h('p', { class: 'muted' }, 'No add-ons in this range.'))),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Busiest hours')), h('div', { class: 'panel-body' }, bars(hourUse.map((v, i) => [`${((i + 11) % 12) + 1}${i < 12 ? 'a' : 'p'}`, v]).filter(([, v], i) => v > 0 || (i >= 8 && i <= 22)), 'hour-sessions'))),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Busiest weekdays')), h('div', { class: 'panel-body' }, bars(dowUse.map((v, i) => [DOW_NAMES[i].slice(0, 3), v]), 'hours')))));
  }

  function showTip(e, html) {
    tip.replaceChildren(...html);
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  function revenueChart(series, byMonth) {
    const W = 860; const H = 240; const L = 52; const R = 8; const T = 10; const B = 26;
    const max = Math.max(...series.map(([, v]) => v.base + v.addons), 1);
    const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
    const pw = W - L - R; const ph = H - T - B;
    const slot = pw / series.length;
    const bw = Math.max(2, Math.min(28, slot * 0.7));
    const y = (v) => T + ph - (v / nice) * ph;
    const ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); return n; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Revenue chart, room and add-ons stacked' });
    [0, 0.5, 1].forEach((f) => {
      svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(nice * f), y2: y(nice * f), class: 'grid-line' }));
      const t = el('text', { x: L - 8, y: y(nice * f) + 4, 'text-anchor': 'end' });
      t.textContent = nice * f >= 1000 ? `₱${(nice * f / 1000).toFixed(nice * f >= 10000 ? 0 : 1)}k` : `₱${nice * f}`;
      svg.appendChild(t);
    });
    const every = Math.ceil(series.length / 10);
    series.forEach(([k, v], i) => {
      const cx = L + slot * i + slot / 2;
      const x = cx - bw / 2;
      const baseTop = y(v.base);
      if (v.base > 0) svg.appendChild(el('rect', { x, y: baseTop, width: bw, height: Math.max(0, T + ph - baseTop), rx: 3, fill: 'var(--chart-1)' }));
      if (v.addons > 0) {
        const top = y(v.base + v.addons);
        // 2px surface gap between stacked segments.
        svg.appendChild(el('rect', { x, y: top, width: bw, height: Math.max(0, baseTop - top - (v.base > 0 ? 2 : 0)), rx: 3, fill: 'var(--chart-2)' }));
      }
      if (i % every === 0) {
        const t = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle' });
        t.textContent = byMonth ? new Date(`${k}-01T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }) : new Date(`${k}T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        svg.appendChild(t);
      }
      const hit = el('rect', { x: L + slot * i, y: T, width: slot, height: ph, class: 'hit' });
      const label = byMonth ? new Date(`${k}-01T12:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : new Date(`${k}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
      hit.addEventListener('mousemove', (e) => showTip(e, [
        h('div', { style: 'font-weight:600;margin-bottom:4px' }, label),
        h('div', { class: 'tip-row' }, h('span', {}, h('i', { style: 'background:var(--chart-1)' }), ' Room'), h('span', {}, peso(v.base))),
        h('div', { class: 'tip-row' }, h('span', {}, h('i', { style: 'background:var(--chart-2)' }), ' Add-ons'), h('span', {}, peso(v.addons))),
        h('div', { class: 'tip-row', style: 'border-top:1px solid var(--line);margin-top:4px;padding-top:4px' }, h('span', {}, 'Total'), h('strong', {}, peso(v.base + v.addons)))]));
      hit.addEventListener('mouseleave', hideTip);
      svg.appendChild(hit);
    });
    return svg;
  }

  function tableView(series, byMonth) {
    const rows = series.filter(([, v]) => v.base + v.addons > 0);
    if (!rows.length) return null;
    return h('details', { class: 'more', style: 'margin-top:10px' }, h('summary', {}, 'Show as a table'),
      h('div', { class: 'table-wrap', style: 'margin-top:8px;max-height:280px' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, byMonth ? 'Month' : 'Day'), h('th', { class: 'num' }, 'Room'), h('th', { class: 'num' }, 'Add-ons'), h('th', { class: 'num' }, 'Total'))),
        h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, peso(v.base)), h('td', { class: 'num' }, peso(v.addons)), h('td', { class: 'num' }, peso(v.base + v.addons))))))));
  }

  function bars(data, unit) {
    const max = Math.max(...data.map(([, v]) => v), 0);
    if (!max) return h('p', { class: 'muted' }, 'No completed sessions in this range.');
    return h('div', {}, data.map(([label, v]) => {
      const row = h('div', { class: 'hbar' }, h('span', {}, label), h('span', { class: 'bar' }, h('span', { style: `width:${(v / max) * 100}%` })), h('span', { class: 'faint' }, unit === 'hours' ? hrs(v) : String(v)));
      row.title = `${label}: ${unit === 'hours' ? hrs(v) : `${v} session-hour${v === 1 ? '' : 's'}`}`;
      return row;
    }));
  }

  root.append(pageHead('Insights', 'Usage counts completed sessions. Revenue counts only sessions that were completed and paid.', [seg]), body);
  draw();
  return () => tip.remove();
}
