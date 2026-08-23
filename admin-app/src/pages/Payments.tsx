import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, callFunction } from '../lib/supabase';

export default function Payments() {
  const queryClient = useQueryClient();
  const { data: payments, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: async () =>
      (
        await supabase
          .from('payments')
          .select('*, bookings(id, start_at, rooms(name), profiles!bookings_customer_id_fkey(full_name))')
          .order('created_at', { ascending: false })
      ).data || [],
  });

  async function refund(paymentId: string) {
    const amountStr = prompt('Refund amount in ₱ (leave blank for full remaining amount):');
    if (amountStr === null) return;
    const amount = amountStr.trim() ? Number(amountStr) : undefined;
    try {
      await callFunction('admin-refund', { payment_id: paymentId, amount });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Payments</h1>
      {isLoading ? (
        <p className="text-cream/60">Loading…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-line text-cream/50 text-xs uppercase">
                <th className="p-3">Date</th>
                <th className="p-3">Booking</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Type</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Refunded</th>
                <th className="p-3">Status</th>
                <th className="p-3">Stripe ID</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(payments || []).map((p: any) => (
                <tr key={p.id} className="border-b border-line/50 last:border-0">
                  <td className="p-3 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString('en-PH')}</td>
                  <td className="p-3">{p.bookings?.rooms?.name}</td>
                  <td className="p-3">{p.bookings?.profiles?.full_name || '—'}</td>
                  <td className="p-3 uppercase text-xs">{p.type}</td>
                  <td className="p-3">₱{Math.round(p.amount).toLocaleString('en-PH')}</td>
                  <td className="p-3">₱{Math.round(p.refunded_amount).toLocaleString('en-PH')}</td>
                  <td className="p-3">
                    <span className="text-xs uppercase text-gold">{p.status}</span>
                  </td>
                  <td className="p-3 text-xs text-cream/40 max-w-[140px] truncate">{p.stripe_payment_intent_id || '—'}</td>
                  <td className="p-3">
                    {p.status === 'succeeded' || p.status === 'partially_refunded' ? (
                      <button className="btn-ghost text-xs px-2 py-1" onClick={() => refund(p.id)}>
                        Refund
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {(payments || []).length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-cream/50">
                    No payments yet — Stripe may still be disabled in Settings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
