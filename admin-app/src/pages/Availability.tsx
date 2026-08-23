import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Availability() {
  const queryClient = useQueryClient();
  const [roomId, setRoomId] = useState('');

  const { data: rooms } = useQuery({
    queryKey: ['rooms-all'],
    queryFn: async () => (await supabase.from('rooms').select('id, name').order('name')).data || [],
  });

  const { data: hours } = useQuery({
    queryKey: ['operating-hours', roomId],
    enabled: !!roomId,
    queryFn: async () =>
      (await supabase.from('operating_hours').select('*').eq('room_id', roomId).order('day_of_week')).data || [],
  });

  const { data: blocks } = useQuery({
    queryKey: ['blocked-slots', roomId],
    enabled: !!roomId,
    queryFn: async () =>
      (await supabase.from('blocked_slots').select('*').eq('room_id', roomId).order('start_at')).data || [],
  });

  const [blockForm, setBlockForm] = useState({ start_at: '', end_at: '', reason: '' });

  async function saveHours(h: any) {
    await supabase.from('operating_hours').update(h).eq('id', h.id);
    queryClient.invalidateQueries({ queryKey: ['operating-hours', roomId] });
  }

  async function addBlock() {
    if (!blockForm.start_at || !blockForm.end_at) return;
    await supabase.from('blocked_slots').insert({
      room_id: roomId,
      start_at: blockForm.start_at,
      end_at: blockForm.end_at,
      reason: blockForm.reason || null,
    });
    setBlockForm({ start_at: '', end_at: '', reason: '' });
    queryClient.invalidateQueries({ queryKey: ['blocked-slots', roomId] });
  }

  async function removeBlock(id: string) {
    await supabase.from('blocked_slots').delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['blocked-slots', roomId] });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Availability</h1>

      <div className="mb-6 max-w-xs">
        <label className="label">Room</label>
        <select className="input w-full" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Select a room…</option>
          {(rooms || []).map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {roomId && (
        <>
          <div className="label mb-3">Operating hours</div>
          <div className="card p-5 mb-8">
            {(hours || []).map((h: any) => (
              <div key={h.id} className="grid grid-cols-[110px_1fr_1fr_100px] gap-4 items-center py-2 border-b border-line/50 last:border-0">
                <span className="text-sm">{DAYS[h.day_of_week]}</span>
                <input
                  type="time"
                  className="input"
                  defaultValue={h.open_time?.slice(0, 5) || ''}
                  disabled={h.is_closed}
                  onBlur={(e) => saveHours({ ...h, open_time: e.target.value })}
                />
                <input
                  type="time"
                  className="input"
                  defaultValue={h.close_time?.slice(0, 5) || ''}
                  disabled={h.is_closed}
                  onBlur={(e) => saveHours({ ...h, close_time: e.target.value })}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={h.is_closed} onChange={(e) => saveHours({ ...h, is_closed: e.target.checked })} />
                  Closed
                </label>
              </div>
            ))}
          </div>

          <div className="label mb-3">Blocked dates / times (maintenance, private events)</div>
          <div className="card p-5 mb-4">
            {(blocks || []).length === 0 && <p className="text-sm text-cream/50 mb-3">No blocks scheduled.</p>}
            {(blocks || []).map((b: any) => (
              <div key={b.id} className="flex items-center justify-between text-sm border-b border-line/50 py-2 last:border-0">
                <span>
                  {new Date(b.start_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} –{' '}
                  {new Date(b.end_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="text-cream/50">{b.reason}</span>
                <button className="btn-ghost text-xs px-2 py-1" onClick={() => removeBlock(b.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="card p-5 flex gap-3 items-end flex-wrap">
            <div>
              <label className="label">Start</label>
              <input
                type="datetime-local"
                className="input"
                value={blockForm.start_at}
                onChange={(e) => setBlockForm({ ...blockForm, start_at: e.target.value })}
              />
            </div>
            <div>
              <label className="label">End</label>
              <input
                type="datetime-local"
                className="input"
                value={blockForm.end_at}
                onChange={(e) => setBlockForm({ ...blockForm, end_at: e.target.value })}
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="label">Reason</label>
              <input
                className="input w-full"
                value={blockForm.reason}
                onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                placeholder="Maintenance, private event…"
              />
            </div>
            <button className="btn-gold" onClick={addBlock}>
              Add block
            </button>
          </div>
        </>
      )}
    </div>
  );
}
