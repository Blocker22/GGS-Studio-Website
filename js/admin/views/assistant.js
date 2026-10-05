// Setup > Chat assistant: the helper on the public site. It answers from the
// live rates, hours, special dates, policies and contacts, and the server adds
// house rules that keep it to studio topics. It cannot book or take payment.

import { btn, field, h, icon, input, pageHead, run, saveSetting, select, settings, state, toggle } from '../core.js';

const MODELS = [
  ['gemini-3.6-flash', 'Gemini 3.6 Flash (recommended)'],
];

export async function render(root) {
  const a = (await settings(['assistant'])).assistant || {};
  const enabled = toggle('Show the assistant on the website', a.enabled !== false);
  const known = MODELS.some(([id]) => id === a.model);
  const model = select([...MODELS, ...(known || !a.model ? [] : [[a.model, `${a.model} (current)`]]), ['custom', 'Another model id…']], a.model || MODELS[0][0]);
  const custom = input({ placeholder: 'e.g. gemini-3.6-flash', value: known ? '' : a.model || '' });
  const customField = field('Model id', custom);
  const sync = () => { customField.hidden = model.value !== 'custom'; };
  model.addEventListener('change', sync);
  sync();
  const keySet = state.status?.assistant_key_set;

  root.append(
    pageHead('Chat assistant', 'Answers customer questions on the website from your live rates, hours and policies.'),
    h('div', { class: 'stack', style: 'max-width:640px' },
      h('div', { class: `banner ${keySet ? '' : 'warn'}` }, icon(keySet ? 'key' : 'warning'), h('div', {},
        keySet ? 'The AI key is set. It stays on the server and never reaches the browser.' : 'No AI key is set, so the assistant falls back to its built-in answers. Add the Google AI key to app_secrets (gemini_api_key) to switch on full answers.')),
      h('div', { class: 'panel panel-pad stack' },
        enabled,
        field('Model', model, { hint: 'Model names are never shown in the chat itself.' }),
        customField,
        h('div', {}, btn('Save', { kind: 'primary', iconName: 'floppy-disk', onClick: (e) => {
          const m = model.value === 'custom' ? custom.value.trim() : model.value;
          run(e.currentTarget, () => saveSetting('assistant', { enabled: enabled.input.checked, model: m || MODELS[0][0] }), { success: 'Saved.' }).catch(() => {});
        } }))),
      h('div', { class: 'panel panel-pad stack' },
        h('h2', { class: 'section-title' }, 'What it knows and does'),
        h('ul', { class: 'muted', style: 'padding-left:18px;display:flex;flex-direction:column;gap:6px' },
          h('li', {}, 'Rates and add-ons from Rooms & rates; hours and the next three weeks of special dates from Schedule.'),
          h('li', {}, 'Payment methods, the downpayment, the cancellation cutoff, and that booked time runs whether or not the customer arrives.'),
          h('li', {}, 'The contacts on the Contacts page, and a signed-in customer\'s own bookings.'),
          h('li', {}, 'It can open the booking form for a customer, but it never books, cancels or takes payment by itself.')))));
}
