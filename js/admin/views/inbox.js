// Messages > Inbox: a small shared mailbox for bookings@ and contact@, so staff
// reply as the studio without sharing a password. Received mail arrives by
// webhook; opening the inbox also syncs anything the webhook missed (at most
// once a minute). Thread and compose state live in the URL.

import {
  api, btn, clear, confirmDialog, field, fileToBase64, fmtDateTime, fmtRel, h, icon, input, openDialog, pageHead, previewFrame,
  q, run, sb, select, setParam, showMenu, state, storeGet, storeSet, textarea, toast, empty,
} from '../core.js';

const MAILBOXES = [['all', 'All mailboxes'], ['booking', 'Bookings'], ['contact', 'Contact']];
let lastSync = 0;

export async function render(root, params) {
  const supabase = await sb();
  let messages = [];
  let threads = [];
  let current = params.thread || null;
  let mailbox = storeGet('ggs-inbox-mailbox', 'all');
  let folder = 'all';
  let sort = 'newest';
  let query = '';

  const status = state.status || {};
  const banner = !status.inbox_enabled
    ? h('div', { class: 'banner warn' }, icon('warning'), h('div', {},
      h('strong', {}, 'Receiving is not switched on yet. '),
      `Mail you send from here goes out from ${status.mailboxes?.booking || 'bookings@'}, and replies currently land in the studio's own email address. To collect replies here: turn on receiving for ${status.mail_domain || 'your domain'} in Resend, add the MX record it gives you, then set INBOX_ENABLED=true for the Edge Functions.`))
    : null;

  const mailboxPick = select(MAILBOXES, mailbox);
  mailboxPick.addEventListener('change', () => { mailbox = mailboxPick.value; storeSet('ggs-inbox-mailbox', mailbox); draw(); });
  const folderSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Folder' },
    [['all', 'All mail'], ['inbox', 'Inbox'], ['sent', 'Sent']].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(folder === id), onclick: (e) => {
      folder = id;
      folderSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      draw();
    } }, label)));
  const searchIn = input({ type: 'search', placeholder: 'Search mail', 'aria-label': 'Search mail' });
  searchIn.addEventListener('input', () => { query = searchIn.value.trim().toLowerCase(); draw(); });
  const sortBtn = btn('Newest first', { iconName: 'sort-descending' });
  sortBtn.addEventListener('click', () => showMenu(sortBtn, [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['unread', 'Unread first']].map(([id, label]) => ({
    label, checked: sort === id, onClick: () => { sort = id; sortBtn.lastChild.textContent = label; draw(); },
  }))));
  const syncBtn = btn('Check now', { iconName: 'arrows-clockwise', onClick: (e) => sync(e.currentTarget, true) });

  const listPane = h('div', { class: 'threads' });
  const reader = h('div', { class: 'reader' });
  const pane = h('div', { class: 'panel inbox' }, listPane, reader);

  function buildThreads() {
    const map = new Map();
    messages.forEach((m) => {
      if (!map.has(m.thread_id)) map.set(m.thread_id, { id: m.thread_id, messages: [] });
      map.get(m.thread_id).messages.push(m);
    });
    threads = [...map.values()].map((t) => {
      t.messages.sort((a, b) => a.at.localeCompare(b.at));
      const last = t.messages[t.messages.length - 1];
      return {
        ...t,
        last,
        at: last.at,
        mailbox: last.mailbox,
        subject: t.messages[0].subject || '(no subject)',
        counterpart: t.messages.find((m) => m.direction === 'in')?.from_name || t.messages[0].counterpart,
        unread: t.messages.some((m) => m.direction === 'in' && !m.read),
        hasIn: t.messages.some((m) => m.direction === 'in'),
        hasOut: t.messages.some((m) => m.direction === 'out'),
        label: t.messages.find((m) => m.to_label)?.to_label || null,
      };
    }).slice(0, 400);
  }

  function visible() {
    let list = threads.filter((t) => mailbox === 'all' || t.mailbox === mailbox);
    if (folder === 'inbox') list = list.filter((t) => t.hasIn);
    if (folder === 'sent') list = list.filter((t) => t.hasOut);
    if (query) list = list.filter((t) => `${t.subject} ${t.counterpart} ${t.messages.map((m) => m.snippet).join(' ')}`.toLowerCase().includes(query));
    if (sort === 'oldest') list.sort((a, b) => a.at.localeCompare(b.at));
    else if (sort === 'unread') list.sort((a, b) => (b.unread - a.unread) || b.at.localeCompare(a.at));
    else list.sort((a, b) => b.at.localeCompare(a.at));
    return list;
  }

  function draw() {
    const list = visible();
    clear(listPane);
    if (!threads.length) listPane.appendChild(h('div', { style: 'padding:16px' }, empty({ iconName: 'tray', title: 'No mail yet', text: 'Emails the studio sends to customers are filed here as they go out, and replies will arrive here once receiving is on.' })));
    else if (!list.length) listPane.appendChild(h('p', { class: 'muted', style: 'padding:16px' }, 'Nothing matches.'));
    list.forEach((t) => listPane.appendChild(h('button', {
      type: 'button', class: `thread-item ${t.unread ? 'unread' : ''}`, 'aria-current': String(t.id === current), onclick: () => open(t.id),
    },
    h('div', { class: 'who' }, h('strong', {}, t.counterpart || 'Unknown'), h('span', { class: 'faint nowrap' }, fmtRel(t.at))),
    h('div', { class: 'subj' }, t.subject, t.messages.length > 1 ? h('span', { class: 'faint' }, ` (${t.messages.length})`) : null),
    h('div', { class: 'snip' }, `${t.last.direction === 'out' ? 'You: ' : ''}${t.last.snippet || ''}`),
    t.label ? h('div', { class: 'tags' }, h('span', { class: 'pill quiet' }, t.label)) : null)));
    drawReader();
  }

  function drawReader() {
    const t = threads.find((x) => x.id === current);
    pane.classList.toggle('reading', !!t);
    clear(reader);
    if (!t) {
      reader.appendChild(h('div', { style: 'padding:40px 20px' }, empty({ iconName: 'envelope-open', title: 'Pick a conversation', text: 'Or write a new email.' })));
      return;
    }
    reader.appendChild(h('div', { class: 'panel-head' },
      h('div', { class: 'row', style: 'gap:6px;min-width:0' },
        btn('', { kind: 'ghost', iconName: 'arrow-left', aria: 'Back to the list', onClick: () => { current = null; setParam('thread', null); draw(); } }),
        h('h2', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, t.subject)),
      h('div', { class: 'row', style: 'gap:6px' },
        btn('Reply', { kind: 'primary', iconName: 'arrow-bend-up-left', onClick: () => compose({ replyTo: t.messages.slice().reverse().find((m) => m.direction === 'in') || t.last }) }),
        btn('', { iconName: 'envelope-simple', aria: 'Mark unread', onClick: async () => {
          await q(supabase.from('mail_messages').update({ read: false }).eq('thread_id', t.id).eq('direction', 'in'));
          current = null; setParam('thread', null); await reload();
        } }),
        btn('', { kind: 'danger', iconName: 'trash', aria: 'Delete conversation', onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete this conversation?', message: 'It is removed from the dashboard for everyone. The customer keeps their copy.', confirmLabel: 'Delete', danger: true }))) return;
          await q(supabase.from('mail_messages').delete().eq('thread_id', t.id));
          current = null; setParam('thread', null); toast('Conversation deleted.'); await reload();
        } }))));
    t.messages.forEach((m) => {
      const atts = Array.isArray(m.attachments) ? m.attachments : [];
      reader.appendChild(h('article', { class: 'message' },
        h('div', { class: 'message-head' },
          h('div', {}, h('strong', {}, m.direction === 'out' ? (m.sent_by_name ? `${m.sent_by_name} (GGS Studio)` : 'GGS Studio') : (m.from_name || m.from_addr)),
            h('div', { class: 'cell-sub' }, m.direction === 'out' ? `to ${m.to_addrs.join(', ')}` : `${m.from_addr} to ${m.to_addrs.join(', ')}`, m.cc_addrs?.length ? `, cc ${m.cc_addrs.join(', ')}` : '')),
          h('span', { class: 'faint' }, fmtDateTime(m.at))),
        m.html_body ? previewFrame(m.html_body, '') : h('pre', {}, m.text_body || ''),
        atts.length ? h('div', { class: 'tags' }, atts.map((a) => h('button', { type: 'button', class: 'pill', onclick: async () => {
          if (!a.id) return toast('This attachment was sent from here and is not stored.', 'warn');
          try {
            const r = await api('mail.attachment', { message_id: m.id, attachment_id: a.id });
            window.open(r.url, '_blank', 'noopener');
          } catch (e) { toast(e.message, 'error'); }
        } }, icon('paperclip'), a.filename || 'attachment'))) : null));
    });
    reader.querySelectorAll('iframe').forEach((f) => { f.style.minHeight = '360px'; });
    // Opening marks the conversation read.
    if (t.unread) {
      supabase.from('mail_messages').update({ read: true }).eq('thread_id', t.id).eq('direction', 'in').then(() => {
        t.messages.forEach((m) => { m.read = true; });
        t.unread = false;
        window.dispatchEvent(new Event('ggs:badges'));
        listPane.querySelector('[aria-current="true"]')?.classList.remove('unread');
      });
    }
  }

  function open(id) {
    current = id;
    setParam('thread', id);
    draw();
  }

  function compose({ replyTo = null, to = '' } = {}) {
    const mb = select([['booking', `Bookings (${status.mailboxes?.booking || 'bookings@'})`], ['contact', `Contact (${status.mailboxes?.contact || 'contact@'})`]], replyTo?.mailbox || (mailbox === 'contact' ? 'contact' : 'booking'));
    const toIn = input({ value: replyTo ? replyTo.counterpart || replyTo.from_addr : to, placeholder: 'name@example.com' });
    const ccIn = input({ placeholder: 'Optional, up to 10, separated by commas' });
    const subj = input({ value: replyTo ? (/^re:/i.test(replyTo.subject || '') ? replyTo.subject : `Re: ${replyTo.subject || ''}`) : '' });
    const body = textarea({ rows: 10, placeholder: 'Your message. Your name and the studio address are added as a signature.' });
    const files = h('input', { type: 'file', multiple: true, class: 'input' });
    const err = h('div', { class: 'field-error' });
    setParam('compose', '1');
    openDialog({
      title: replyTo ? 'Reply' : 'New email',
      sub: replyTo ? `To ${replyTo.from_name || replyTo.counterpart}` : null,
      size: 'wide',
      body: h('div', { class: 'stack' }, h('div', { class: 'grid grid-2' }, field('From', mb), field('To', toIn)), field('Cc', ccIn), field('Subject', subj), field('Message', body),
        field('Attachments', files, { hint: 'Up to 10 files, 7 MB in total.' }), err),
      foot: (d) => [btn('Discard', { onClick: () => d.close() }), btn('Send', { kind: 'primary', iconName: 'paper-plane-tilt', onClick: async (e) => {
        err.textContent = '';
        const list = [...files.files];
        if (list.length > 10) { err.textContent = 'Up to 10 attachments.'; return; }
        if (list.reduce((s, f) => s + f.size, 0) > 7 * 1024 * 1024) { err.textContent = 'Attachments are over 7 MB in total.'; return; }
        try {
          const attachments = await Promise.all(list.map(async (f) => ({ filename: f.name, content_type: f.type || 'application/octet-stream', content: await fileToBase64(f) })));
          const out = await run(e.currentTarget, () => api('mail.send', { mailbox: mb.value, to: toIn.value, cc: ccIn.value, subject: subj.value, body: body.value, reply_to_id: replyTo?.id || null, attachments }), { success: 'Sent.' });
          d.close();
          await reload();
          if (out.thread_id) open(out.thread_id);
        } catch (ex) { err.textContent = ex.message; }
      } })],
      onClose: () => setParam('compose', null),
    });
    setTimeout(() => (replyTo ? body : toIn).focus(), 40);
  }

  async function reload() {
    messages = await q(supabase.from('mail_messages').select('id, thread_id, mailbox, direction, from_addr, from_name, to_addrs, cc_addrs, to_label, counterpart, subject, snippet, text_body, html_body, at, read, attachments, sent_by_name, booking_id').order('at', { ascending: false }).limit(1500)) || [];
    buildThreads();
    draw();
  }

  async function sync(button, manual = false) {
    if (!status.inbox_enabled && !manual) return;
    if (!manual && Date.now() - lastSync < 60000) return;
    lastSync = Date.now();
    await run(button, async () => {
      const r = await api('mail.sync');
      if (r.error && manual) toast(`Sync: ${r.error}`, 'warn');
      else if (manual) toast(r.synced ? `${r.synced} new message${r.synced === 1 ? '' : 's'}.` : 'Up to date.');
      if (r.synced) await reload();
    }).catch(() => {});
  }

  root.append(
    pageHead('Inbox', 'Customer emails and every message the studio has sent.', [btn('Write', { kind: 'primary', iconName: 'pencil-simple-line', onClick: () => compose() })]),
    banner || '',
    h('div', { class: 'toolbar' }, mailboxPick, folderSeg, h('div', { style: 'flex:1' }), syncBtn, sortBtn, h('div', { class: 'search' }, icon('magnifying-glass'), searchIn)),
    pane);
  await reload();
  sync(null);
  if (params.compose) compose({ to: params.to || '' });
  const timer = setInterval(() => { if (!document.hidden) { reload(); sync(null); } }, 60000);
  return {
    destroy() { clearInterval(timer); },
    onParams(p) { if (p.thread && p.thread !== current) open(p.thread); },
  };
}
