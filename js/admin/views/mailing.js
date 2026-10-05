// Marketing > Mailing list: consent-based only. People join from the website
// footer, the opt-in on the booking form, or staff adding someone who asked
// (with a consent tick the server enforces). Every email carries a personal
// one-click unsubscribe link.

import {
  api, btn, checkbox, clear, confirmDialog, createList, download, field, fmtDate, fmtDateTime, h, icon, input, openDialog,
  pageHead, pill, previewFrame, q, run, sb, storeGet, storeSet, textarea, toast,
} from '../core.js';
import { SUPABASE_URL } from '../../supabase-client.js';

const DRAFT_KEY = 'ggs-campaign-draft';

export async function render(root) {
  const supabase = await sb();
  let subscribers = [];
  let showUnsub = false;

  // ------------------------------------------------------------ composer
  const draft = storeGet(DRAFT_KEY, { subject: '', preheader: '', headline: '', body: '', button_label: '', button_url: '', image_url: '' });
  const subject = input({ value: draft.subject, placeholder: 'e.g. New: overnight sessions every Friday' });
  const preheader = input({ value: draft.preheader, placeholder: 'One line shown after the subject in the inbox' });
  const headline = input({ value: draft.headline, placeholder: 'Defaults to the subject' });
  const body = textarea({ value: draft.body, rows: 8, placeholder: 'Write it like a note to a regular. Blank lines start new paragraphs. **Bold** works.' });
  const buttonLabel = input({ value: draft.button_label, placeholder: 'e.g. Book a session' });
  const buttonUrl = input({ value: draft.button_url, placeholder: 'https://www.ggsstudio.site/#book' });
  const imgPreview = h('div', { class: 'row' });
  const imgFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  let imageUrl = draft.image_url;
  const frame = previewFrame('');
  frame.style.minHeight = '560px';
  const countLine = h('span', { class: 'muted' });

  const current = () => ({
    subject: subject.value.trim(), preheader: preheader.value.trim(), headline: headline.value.trim(), body: body.value,
    button_label: buttonLabel.value.trim(), button_url: buttonUrl.value.trim(), image_url: imageUrl || '',
  });
  let timer;
  const onEdit = () => {
    storeSet(DRAFT_KEY, current());
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const c = current();
      if (!c.subject || !c.body.trim()) { frame.srcdoc = '<p style="font-family:sans-serif;color:#888;padding:20px">Add a subject and a message to see the preview.</p>'; return; }
      try { frame.srcdoc = (await api('campaign.preview', { campaign: c })).html; } catch (e) { frame.srcdoc = `<p style="font-family:sans-serif;color:#c55;padding:20px">${e.message}</p>`; }
    }, 450);
  };
  [subject, preheader, headline, body, buttonLabel, buttonUrl].forEach((c) => c.addEventListener('input', onEdit));

  function drawImage() {
    clear(imgPreview);
    if (imageUrl) imgPreview.append(h('img', { class: 'thumb', src: imageUrl, alt: '' }), btn('Remove image', { size: 'sm', kind: 'ghost', onClick: () => { imageUrl = ''; drawImage(); onEdit(); } }));
    imgPreview.append(btn(imageUrl ? 'Replace' : 'Add an image', { size: 'sm', iconName: 'image', onClick: () => imgFile.click() }));
  }
  imgFile.addEventListener('change', async () => {
    const f = imgFile.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('Images must be under 5 MB.', 'warn');
    await run(null, async () => {
      const path = `campaigns/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, '-').toLowerCase()}`;
      const { error } = await supabase.storage.from('site-files').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
      if (error) throw error;
      imageUrl = `${SUPABASE_URL}/storage/v1/object/public/site-files/${path}`;
      drawImage();
      onEdit();
    }, { success: 'Image added.' }).catch(() => {});
  });
  drawImage();

  const testBtn = btn('Send me a test', { iconName: 'flask', onClick: (e) => run(e.currentTarget, () => api('campaign.test', { campaign: current() }), { success: (r) => `Test sent to ${r.to}.` }).catch(() => {}) });
  const sendBtn = btn('Send to everyone', { kind: 'primary', iconName: 'paper-plane-tilt', onClick: async (e) => {
    const n = subscribers.filter((s) => s.status === 'subscribed').length;
    if (!n) return toast('Nobody is subscribed yet.', 'warn');
    if (!(await confirmDialog({ title: `Send to ${n} subscriber${n === 1 ? '' : 's'}?`, message: `"${current().subject}"\n\nThis can't be undone. Sent from the promotions address with a one-click unsubscribe link.`, confirmLabel: `Send to ${n}` }))) return;
    const r = await run(e.currentTarget, () => api('campaign.send', { campaign: current() })).catch(() => null);
    if (!r) return;
    toast(r.failed ? `Sent to ${r.sent}, ${r.failed} failed.` : `Sent to ${r.sent}.`, r.failed ? 'warn' : 'ok');
    storeSet(DRAFT_KEY, {});
    [subject, preheader, headline, body, buttonLabel, buttonUrl].forEach((c) => { c.value = ''; });
    imageUrl = '';
    drawImage();
    onEdit();
    loadHistory();
  } });

  const composer = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'New email'), countLine),
    h('div', { class: 'panel-body split', style: 'align-items:start' },
      h('div', { class: 'stack' }, field('Subject', subject), field('Preview text', preheader), field('Headline', headline), field('Message', body),
        h('div', { class: 'grid grid-2' }, field('Button label', buttonLabel), field('Button link', buttonUrl)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Image'), imgPreview, imgFile, h('div', { class: 'hint' }, 'Uploaded here so it stays online. Outside image links are not allowed.')),
        h('p', { class: 'hint' }, 'Your draft is kept in this browser until you send it.'),
        h('div', { class: 'row' }, testBtn, sendBtn)),
      h('div', { class: 'stack' }, h('span', { class: 'label' }, 'Preview'), frame)));

  // ------------------------------------------------------------ subscribers
  const unsubToggle = checkbox('Show unsubscribed', false);
  unsubToggle.input.addEventListener('change', () => { showUnsub = unsubToggle.input.checked; list.setItems(visibleSubs()); });
  const list = createList({
    key: 'subscribers',
    searchPlaceholder: 'Search email or name',
    chips: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'footer', label: 'Website form', test: (s) => s.source === 'footer' },
      { id: 'booking', label: 'Booking form', test: (s) => s.source === 'booking' },
      { id: 'staff', label: 'Added by staff', test: (s) => s.source === 'staff' },
    ],
    sorts: [
      ['newest', 'Newest first', (a, b) => b.subscribed_at.localeCompare(a.subscribed_at)],
      ['oldest', 'Oldest first', (a, b) => a.subscribed_at.localeCompare(b.subscribed_at)],
      ['email', 'Email A to Z', (a, b) => a.email.localeCompare(b.email)],
    ],
    toolbarExtra: unsubToggle,
    search: (s) => `${s.email} ${s.name || ''}`,
    empty: { iconName: 'paper-plane-tilt', title: 'No subscribers yet', text: 'People join from the website footer or by ticking the box when they book.' },
    columns: [
      { label: 'Email', render: (s) => h('div', {}, h('div', { class: 'cell-title' }, s.email), s.name ? h('div', { class: 'cell-sub' }, s.name) : null) },
      { label: 'Joined from', render: (s) => ({ footer: 'Website form', booking: 'Booking form', staff: 'Added by staff', import: 'Import' })[s.source] || s.source },
      { label: 'Since', render: (s) => fmtDate(s.subscribed_at) },
      { label: 'Status', render: (s) => s.status === 'subscribed' ? pill('Subscribed', 'teal') : pill(`Unsubscribed ${s.unsubscribed_at ? fmtDate(s.unsubscribed_at) : ''}`, 'quiet') },
      { label: '', cls: 'num', render: (s) => btn('', { size: 'sm', kind: 'ghost', iconName: 'trash', aria: 'Remove', onClick: async () => {
        if (!(await confirmDialog({ title: `Remove ${s.email}?`, message: 'They are deleted from the list. If they only want fewer emails, let them unsubscribe instead.', confirmLabel: 'Remove', danger: true }))) return;
        await run(null, () => q(supabase.from('subscribers').delete().eq('id', s.id)), { success: 'Removed.' }).catch(() => {});
        reloadSubs();
      } }) },
    ],
    card: (s) => h('div', { class: 'card' }, h('div', { class: 'card-row' }, h('div', {}, h('div', { class: 'cell-title' }, s.email), h('div', { class: 'cell-sub' }, `${s.source} · ${fmtDate(s.subscribed_at)}`)), s.status === 'subscribed' ? pill('Subscribed', 'teal') : pill('Unsubscribed', 'quiet'))),
  });
  const visibleSubs = () => subscribers.filter((s) => showUnsub || s.status === 'subscribed');

  async function reloadSubs() {
    subscribers = await q(supabase.from('subscribers').select('*').order('subscribed_at', { ascending: false })) || [];
    const active = subscribers.filter((s) => s.status === 'subscribed').length;
    countLine.textContent = `${active} subscriber${active === 1 ? '' : 's'}`;
    sendBtn.lastChild.textContent = active ? `Send to ${active}` : 'Send to everyone';
    list.setItems(visibleSubs());
  }

  function addSubscriber() {
    const email = input({ type: 'email' });
    const name = input();
    const consent = checkbox('They asked to join the mailing list (in person, by message, or in writing).', false);
    const err = h('div', { class: 'field-error' });
    openDialog({
      title: 'Add a subscriber',
      size: 'narrow',
      body: h('div', { class: 'stack' }, field('Email', email), field('Name (optional)', name), consent, err),
      foot: (d) => [btn('Cancel', { onClick: () => d.close() }), btn('Add', { kind: 'primary', onClick: async (e) => {
        err.textContent = '';
        if (!consent.input.checked) { err.textContent = 'Only add people who asked to join.'; return; }
        try {
          await run(e.currentTarget, () => api('mailing.add', { email: email.value, name: name.value, consent: true }), { success: 'Added.' });
          d.close(); reloadSubs();
        } catch (ex) { err.textContent = ex.message; }
      } })],
    });
  }

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['email', 'name', 'source', 'status', 'subscribed_at', 'unsubscribed_at'], ...subscribers.map((s) => [s.email, s.name, s.source, s.status, s.subscribed_at, s.unsubscribed_at])];
    download(`ggs-subscribers-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(esc).join(',')).join('\n'), 'text/csv');
  };

  // ------------------------------------------------------------ history
  const history = h('div', { class: 'list' });
  async function loadHistory() {
    const rows = await q(supabase.from('campaigns').select('*').order('created_at', { ascending: false }).limit(50)) || [];
    clear(history);
    if (!rows.length) history.appendChild(h('p', { class: 'muted' }, 'No campaigns sent yet.'));
    rows.forEach((c) => history.appendChild(h('div', { class: 'list-item' }, icon('paper-plane-tilt'),
      h('div', { style: 'flex:1' }, h('div', { class: 'cell-title' }, c.subject), h('div', { class: 'cell-sub' }, `${c.sent_at ? fmtDateTime(c.sent_at) : 'Sending'} by ${c.sent_by_name || 'staff'}`)),
      h('div', { class: 'num' }, `${c.sent} of ${c.recipients}`, c.failed ? h('div', { class: 'cell-sub', style: 'color:var(--danger)' }, `${c.failed} failed`) : null))));
  }

  root.append(
    pageHead('Mailing list', 'News and offers for people who asked for them.', [btn('Add subscriber', { iconName: 'user-plus', onClick: addSubscriber }), btn('Export CSV', { iconName: 'download-simple', onClick: exportCsv })]),
    h('div', { class: 'stack' },
      composer,
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Subscribers')), h('div', { class: 'panel-body' }, list.el)),
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sent campaigns')), h('div', { class: 'panel-body' }, history))));
  await Promise.all([reloadSubs(), loadHistory()]);
  onEdit();
}
