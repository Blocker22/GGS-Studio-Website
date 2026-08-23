import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { supabase, callFunction } from '../lib/supabase';

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-gold border-golddim',
  confirmed: 'text-teal border-teal',
  completed: 'text-cream/60 border-line',
  cancelled: 'text-[#e5876f] border-[#7a4331]',
  no_show: 'text-cream/40 border-line',
};

type Booking = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  total_price: number;
  notes: string | null;
  rooms: { id: string; name: string } | null;
  profiles: { id: string; full_name: string | null } | null;
  booking_services: { services: { name: string } }[];
};

export default function Bookings() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [statusFilter, setStatusFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const { data: rooms } = useQuery({
    queryKey: ['rooms-all'],
    queryFn: async () => (await supabase.from('rooms').select('id, name').order('name')).data || [],
  });

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, rooms(id, name), profiles!bookings_customer_id_fkey(id, full_name), booking_services(services(name))')
        .order('start_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Booking[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('bookings-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const filtered = useMemo(() => {
    return (bookings || []).filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (roomFilter && b.rooms?.id !== roomFilter) return false;
      if (dateFrom && new Date(b.start_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(b.start_at) > new Date(dateTo + 'T23:59:59')) return false;
      if (search && !(b.profiles?.full_name || '').toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [bookings, statusFilter, roomFilter, dateFrom, dateTo, search]);

  async function setStatus(id: string, status: string) {
    try {
      await callFunction('update-booking', { booking_id: id, status });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function cancelBooking(id: string) {
    const reason = prompt('Cancellation reason (optional):') || undefined;
    try {
      await callFunction('cancel-booking', { booking_id: id, reason });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    } catch (err: any) {
      alert(err.message);
    }
  }

  const events = (bookings || [])
    .filter((b) => b.status !== 'cancelled')
    .map((b) => ({
      id: b.id,
      title: `${b.rooms?.name || 'Room'} — ${b.profiles?.full_name || 'Customer'}`,
      start: b.start_at,
      end: b.end_at,
      color: b.status === 'pending' ? '#d7ae5c' : '#2fb8b0',
    }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Bookings</h1>
        <div className="flex gap-3">
          <div className="flex gap-1 card p-1">
            <button
              className={`px-3 py-1.5 text-xs rounded ${view === 'list' ? 'bg-gold text-ink' : 'text-cream/70'}`}
              onClick={() => setView('list')}
            >
              List
            </button>
            <button
              className={`px-3 py-1.5 text-xs rounded ${view === 'calendar' ? 'bg-gold text-ink' : 'text-cream/70'}`}
              onClick={() => setView('calendar')}
            >
              Calendar
            </button>
          </div>
          <Link to="/bookings/new" className="btn-gold text-sm">
            + New booking
          </Link>
        </div>
      </div>

      <div className="card p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Customer</label>
          <input className="input" placeholder="Search name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label">Room</label>
          <select className="input" value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="">All rooms</option>
            {(rooms || []).map((r: any) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-cream/60">Loading…</p>
      ) : view === 'calendar' ? (
        <div className="card p-4 fc-dark">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            events={events}
            height="auto"
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-line text-cream/50 text-xs uppercase tracking-wide">
                <th className="p-3">When</th>
                <th className="p-3">Room</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Add-ons</th>
                <th className="p-3">Total</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-b border-line/50 last:border-0">
                  <td className="p-3 whitespace-nowrap">
                    {new Date(b.start_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="p-3">{b.rooms?.name}</td>
                  <td className="p-3">{b.profiles?.full_name || '—'}</td>
                  <td className="p-3 text-cream/60">{b.booking_services.map((bs) => bs.services?.name).join(', ') || '—'}</td>
                  <td className="p-3">₱{Math.round(b.total_price).toLocaleString('en-PH')}</td>
                  <td className="p-3">
                    <span className={`text-xs uppercase border px-2 py-0.5 rounded-full ${STATUS_STYLE[b.status]}`}>
                      {b.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2 flex-wrap">
                      {b.status === 'pending' && (
                        <>
                          <button className="btn-ghost text-xs px-2 py-1" onClick={() => setStatus(b.id, 'confirmed')}>
                            Approve
                          </button>
                          <button className="btn-ghost text-xs px-2 py-1" onClick={() => cancelBooking(b.id)}>
                            Reject
                          </button>
                        </>
                      )}
                      {b.status === 'confirmed' && (
                        <>
                          <button className="btn-ghost text-xs px-2 py-1" onClick={() => setStatus(b.id, 'completed')}>
                            Completed
                          </button>
                          <button className="btn-ghost text-xs px-2 py-1" onClick={() => setStatus(b.id, 'no_show')}>
                            No-show
                          </button>
                          <button className="btn-ghost text-xs px-2 py-1" onClick={() => cancelBooking(b.id)}>
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-cream/50">
                    No bookings match these filters.
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
