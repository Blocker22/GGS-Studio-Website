import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => (await supabase.from('app_settings').select('*')).data || [],
  });

  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [depositPercent, setDepositPercent] = useState(30);
  const [cutoffHours, setCutoffHours] = useState(24);

  useEffect(() => {
    if (!settings) return;
    const get = (key: string) => settings.find((s: any) => s.key === key)?.value;
    setStripeEnabled(get('stripe_enabled') === true);
    setDepositPercent(Number(get('deposit_percent') ?? 30));
    setCutoffHours(Number(get('reschedule_cutoff_hours') ?? 24));
  }, [settings]);

  async function save() {
    await Promise.all([
      supabase.from('app_settings').update({ value: stripeEnabled }).eq('key', 'stripe_enabled'),
      supabase.from('app_settings').update({ value: depositPercent }).eq('key', 'deposit_percent'),
      supabase.from('app_settings').update({ value: cutoffHours }).eq('key', 'reschedule_cutoff_hours'),
    ]);
    queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    alert('Settings saved.');
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>
      <div className="card p-6 flex flex-col gap-6">
        <div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={stripeEnabled} onChange={(e) => setStripeEnabled(e.target.checked)} />
            Enable Stripe payments
          </label>
          <p className="text-xs text-cream/40 mt-2">
            Requires <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> to be set as Edge Function secrets in the
            Supabase project. Leave off to run bookings without deposits/payments.
          </p>
        </div>
        <div>
          <label className="label">Deposit percentage</label>
          <input type="number" className="input w-32" value={depositPercent} onChange={(e) => setDepositPercent(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Reschedule / cancellation cutoff (hours)</label>
          <input type="number" className="input w-32" value={cutoffHours} onChange={(e) => setCutoffHours(Number(e.target.value))} />
          <p className="text-xs text-cream/40 mt-2">Customers can't reschedule or cancel within this window of their session start.</p>
        </div>
        <button className="btn-gold w-fit" onClick={save}>
          Save settings
        </button>
      </div>
    </div>
  );
}
