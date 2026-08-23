import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export default function Customers() {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () =>
      (await supabase.from('profiles').select('id, full_name, phone, role, created_at').eq('role', 'customer').order('full_name'))
        .data || [],
  });

  const { data: history } = useQuery({
    queryKey: ['customer-history', selected],
    enabled: !!selected,
    queryFn: async () =>
      (
        await supabase
          .from('bookings')
          .select('id, start_at, status, total_price, rooms(name)')
          .eq('customer_id', selected)
          .order('start_at', { ascending: false })
      ).data || [],
  });

  const filtered = (customers || []).filter((c: any) => (c.full_name || '').toLowerCase().includes(search.toLowerCase()));
  const selectedCustomer = customers?.find((c: any) => c.id === selected);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Customers</h1>
      <div className="grid grid-cols-[1fr_1.2fr] gap-6">
        <div className="card">
          <div className="p-4 border-b border-line">
            <input className="input w-full" placeholder="Search customers…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {filtered.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-line/50 last:border-0 hover:bg-panel2 ${
                  selected === c.id ? 'bg-panel2' : ''
                }`}
              >
                <div className="text-sm">{c.full_name || 'Unnamed'}</div>
                <div className="text-xs text-cream/40">{c.phone || 'No phone on file'}</div>
              </button>
            ))}
            {filtered.length === 0 && <p className="p-4 text-sm text-cream/50">No customers found.</p>}
          </div>
        </div>

        <div className="card p-6">
          {!selectedCustomer ? (
            <p className="text-sm text-cream/50">Select a customer to view their history.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-1">{selectedCustomer.full_name || 'Unnamed'}</h2>
              <p className="text-xs text-cream/50 mb-6">
                {selectedCustomer.phone || 'No phone'} · Customer since{' '}
                {new Date(selectedCustomer.created_at).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}
              </p>
              <div className="label mb-3">Booking history</div>
              <div className="flex flex-col gap-2">
                {(history || []).map((b: any) => (
                  <div key={b.id} className="flex justify-between text-sm border-b border-line/50 pb-2">
                    <span>{new Date(b.start_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span className="text-cream/60">{b.rooms?.name}</span>
                    <span className="text-gold text-xs uppercase">{b.status}</span>
                    <span>₱{Math.round(b.total_price).toLocaleString('en-PH')}</span>
                  </div>
                ))}
                {(history || []).length === 0 && <p className="text-sm text-cream/50">No bookings yet.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
