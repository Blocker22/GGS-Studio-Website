// Messages > Email templates: change the wording of the automatic emails. The
// design around the words is fixed. Only fields that differ from the default
// are saved, so a later improvement to a default still reaches unchanged ones.

import {
  api, btn, clear, confirmDialog, copy, field, h, icon, input, pageHead, previewFrame, run, saveSetting, settings, textarea, toast,
} from '../core.js';
import { FIELDS, PLACEHOLDERS, TEMPLATES } from '../../../supabase/functions/_shared/email-templates.js';

export async function render(root) {
  let saved = (await settings(['email_templates'])).email_templates || {};
  let type = 'received';
  let draft = {};
  let dirty = false;

  const nav = h('div', { class: 'list' });
  const editor = h('div', { class: 'stack' });
  const frame = previewFrame('');
  frame.style.minHeight = '620px';
  const subjectLine = h('div', { class: 'hint' });
  const saveBtn = btn('Save wording', { kind: 'primary', iconName: 'floppy-disk', onClick: (e) => save(e.currentTarget) });
  const testBtn = btn('Send me a test', { iconName: 'paper-plane-tilt', onClick: (e) => run(e.currentTarget, () => api('emails.test', { type, saved: changedFields() }), { success: (r) => `Test sent to ${r.to}.` }).catch(() => {}) });

  function changedFields() {
    const defaults = TEMPLATES[type].defaults;
    return Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== defaults[k]));
  }

  function drawNav() {
    clear(nav);
    Object.entries(TEMPLATES).forEach(([id, t]) => {
      const changed = Object.keys(saved[id] || {}).length > 0;
      nav.appendChild(h('button', { type: 'button', class: 'nav-item', 'aria-current': id === type ? 'page' : null, onclick: async () => {
        if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', message: 'You changed this email but did not save it.', confirmLabel: 'Discard' }))) return;
        type = id; load();
      } }, icon(t.audience === 'staff' ? 'user-gear' : 'envelope-simple'), h('span', { class: 'label' }, t.label), changed ? h('span', { class: 'pill gold' }, 'Changed') : null));
    });
  }

  function load() {
    dirty = false;
    const t = TEMPLATES[type];
    draft = { ...t.defaults, ...(saved[type] || {}) };
    clear(editor);
    editor.append(
      h('div', {}, h('h2', { class: 'section-title' }, t.label), h('p', { class: 'muted' }, t.when)));
    Object.entries(FIELDS).forEach(([key, label]) => {
      const multi = ['body', 'checklist'].includes(key);
      const ctl = multi ? textarea({ value: draft[key] || '', rows: key === 'body' ? 7 : 4 }) : input({ value: draft[key] || '' });
      const isChanged = () => (saved[type] || {})[key] !== undefined;
      const reset = btn('Use default', { size: 'sm', kind: 'ghost', onClick: () => { ctl.value = t.defaults[key] || ''; ctl.dispatchEvent(new Event('input')); } });
      ctl.addEventListener('input', () => { draft[key] = ctl.value; dirty = true; schedulePreview(); });
      const f = field(label, ctl, { hint: key === 'button' ? 'Leave empty for no button.' : key === 'checklist' ? 'Leave empty for no checklist.' : null });
      f.querySelector('label').append(' ', isChanged() ? h('span', { class: 'pill gold' }, 'Changed') : '', ' ', reset);
      editor.appendChild(f);
    });
    editor.appendChild(h('div', { class: 'row' }, saveBtn, testBtn));
    drawNav();
    schedulePreview(0);
  }

  let timer;
  function schedulePreview(delay = 400) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const p = await api('emails.preview', { type, saved: changedFields() });
        frame.srcdoc = p.html;
        subjectLine.textContent = `Subject: ${p.subject}`;
      } catch (e) { subjectLine.textContent = e.message; }
    }, delay);
  }

  async function save(button) {
    const next = { ...saved };
    const changed = changedFields();
    if (Object.keys(changed).length) next[type] = changed;
    else delete next[type];
    await run(button, () => saveSetting('email_templates', next), { success: 'Saved. New emails use this wording.' });
    saved = next;
    dirty = false;
    load();
  }

  const placeholders = h('details', { class: 'more' }, h('summary', {}, 'Placeholders you can use'),
    h('div', { class: 'list', style: 'margin-top:8px' }, PLACEHOLDERS.map(([k, d]) => h('div', { class: 'list-item', style: 'padding:6px 0' },
      h('button', { type: 'button', class: 'code-tag', title: 'Copy', onclick: () => copy(`{${k}}`) }, `{${k}}`), h('span', { class: 'muted', style: 'font-size:0.86rem' }, d)))));

  root.append(
    pageHead('Email templates', 'Change what the automatic emails say. Use **double asterisks** for bold. Placeholders fill in per booking.'),
    h('div', { style: 'display:grid;grid-template-columns:240px minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start', class: 'tpl-grid' },
      h('div', { class: 'panel panel-pad' }, nav),
      h('div', { class: 'panel panel-pad stack' }, editor, placeholders),
      h('div', { class: 'stack', style: 'position:sticky;top:76px' }, h('span', { class: 'label' }, 'Live preview with a sample booking'), subjectLine, frame)));
  const mq = matchMedia('(max-width: 1200px)');
  const apply = () => { root.querySelector('.tpl-grid').style.gridTemplateColumns = mq.matches ? 'minmax(0,1fr)' : '240px minmax(0,1fr) minmax(0,1fr)'; };
  mq.addEventListener('change', apply);
  apply();
  load();
  const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  return () => { window.removeEventListener('beforeunload', warn); mq.removeEventListener('change', apply); if (dirty) toast('Unsaved template changes were discarded.', 'warn'); };
}
