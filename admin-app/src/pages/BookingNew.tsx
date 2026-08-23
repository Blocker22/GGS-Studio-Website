import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase, callFunction } from '../lib/supabase';

export default function BookingNew() {
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('10:00');
  const [duration, setDuration] = useState(1);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ['customers-for-select'],
    queryFn: async () => (await supabase.from('profiles').select('id, full_name').order('full_name')).data || [],
  });
  const { data: rooms } = useQuery({
    queryKey: ['rooms-all'],
    queryFn: async () => (await supabase.from('rooms').select('id, name').eq('is_active', true).order('name')).data || [],
  });
  const { data: services } = useQuery({
    queryKey: ['services-all'],
    queryFn: async () => (await supabase.from('services').select('id, name').eq('is_active', true).order('name')).data || [],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!customerId || !roomId || !date) {
      setError('Please fill in customer, room and date.');
      return;
    }
    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(startAt.getTime() + duration * 3600000);
    setBusy(true);
    try {
      await callFunction('create-booking', {
        room_id: roomId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        service_ids: serviceIds,
        notes,
        customer_id: customerId,
      });
      navigate('/bookings');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold mb-6">New booking (walk-in / phone)</h1>
      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label">Customer</label>
          <select className="input w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {(customers || []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.id}
              </option>
            ))}
          </select>
          <p className="text-xs text-cream/40 mt-1">Customer must already have an account. Ask them to sign up on the public site first.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Room</label>
            <select className="input w-full" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Select room…</option>
              {(rooms || []).map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Duration (hours)</label>
            <input
              type="number"
              min={1}
              max={12}
              className="input w-full"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Start time</label>
            <input type="time" className="input w-full" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Add-ons</label>
          <div className="flex flex-col gap-2">
            {(services || []).map((s: any) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-xs text-[#e5876f]">{error}</p>}
        <button className="btn-gold mt-2" disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Create booking (confirmed)'}
        </button>
      </form>
    </div>
  );
}
