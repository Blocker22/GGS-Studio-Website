import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

type Room = { id: string; name: string; description: string | null; hourly_rate: number; image_url: string | null; is_active: boolean };
type Service = { id: string; name: string; slug: string; price: number; price_type: string; is_active: boolean };

export default function Rooms() {
  const queryClient = useQueryClient();
  const { data: rooms } = useQuery({
    queryKey: ['rooms-admin'],
    queryFn: async () => ((await supabase.from('rooms').select('*').order('name')).data || []) as Room[],
  });
  const { data: services } = useQuery({
    queryKey: ['services-admin'],
    queryFn: async () => ((await supabase.from('services').select('*').order('name')).data || []) as Service[],
  });

  const [newRoom, setNewRoom] = useState({ name: '', description: '', hourly_rate: 350 });
  const [newService, setNewService] = useState({ name: '', price: 0, price_type: 'flat' });

  async function saveRoom(room: Room) {
    await supabase.from('rooms').update(room).eq('id', room.id);
    queryClient.invalidateQueries({ queryKey: ['rooms-admin'] });
  }
  async function addRoom() {
    if (!newRoom.name) return;
    await supabase.from('rooms').insert(newRoom);
    setNewRoom({ name: '', description: '', hourly_rate: 350 });
    queryClient.invalidateQueries({ queryKey: ['rooms-admin'] });
  }
  async function uploadImage(room: Room, file: File) {
    const ext = file.name.split('.').pop();
    const path = `${room.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('room-images').upload(path, file, { upsert: true });
    if (error) {
      alert(error.message);
      return;
    }
    const { data } = supabase.storage.from('room-images').getPublicUrl(path);
    await saveRoom({ ...room, image_url: data.publicUrl });
  }

  async function saveService(service: Service) {
    await supabase.from('services').update(service).eq('id', service.id);
    queryClient.invalidateQueries({ queryKey: ['services-admin'] });
  }
  async function addService() {
    if (!newService.name) return;
    const slug = newService.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await supabase.from('services').insert({ ...newService, slug });
    setNewService({ name: '', price: 0, price_type: 'flat' });
    queryClient.invalidateQueries({ queryKey: ['services-admin'] });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Rooms & Services</h1>

      <div className="label mb-3">Rooms</div>
      <div className="grid gap-4 mb-4">
        {(rooms || []).map((r) => (
          <div key={r.id} className="card p-5 flex gap-5 items-start">
            <div className="w-24 h-24 shrink-0 bg-panel2 rounded overflow-hidden flex items-center justify-center">
              {r.image_url ? (
                <img src={r.image_url} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-cream/30">No photo</span>
              )}
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Name</label>
                <input className="input w-full" defaultValue={r.name} onBlur={(e) => saveRoom({ ...r, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Hourly rate (₱)</label>
                <input
                  type="number"
                  className="input w-full"
                  defaultValue={r.hourly_rate}
                  onBlur={(e) => saveRoom({ ...r, hourly_rate: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <input
                  className="input w-full"
                  defaultValue={r.description || ''}
                  onBlur={(e) => saveRoom({ ...r, description: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-4 col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={r.is_active} onChange={(e) => saveRoom({ ...r, is_active: e.target.checked })} />
                  Active
                </label>
                <label className="text-xs text-gold cursor-pointer">
                  Upload photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadImage(r, e.target.files[0])}
                  />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card p-5 flex gap-3 items-end mb-10">
        <div className="flex-1">
          <label className="label">New room name</label>
          <input className="input w-full" value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Hourly rate</label>
          <input
            type="number"
            className="input w-32"
            value={newRoom.hourly_rate}
            onChange={(e) => setNewRoom({ ...newRoom, hourly_rate: Number(e.target.value) })}
          />
        </div>
        <button className="btn-gold" onClick={addRoom}>
          Add room
        </button>
      </div>

      <div className="label mb-3">Services / add-ons</div>
      <div className="card overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-line text-cream/50 text-xs uppercase">
              <th className="p-3">Name</th>
              <th className="p-3">Price</th>
              <th className="p-3">Type</th>
              <th className="p-3">Active</th>
            </tr>
          </thead>
          <tbody>
            {(services || []).map((s) => (
              <tr key={s.id} className="border-b border-line/50 last:border-0">
                <td className="p-3">
                  <input className="input" defaultValue={s.name} onBlur={(e) => saveService({ ...s, name: e.target.value })} />
                </td>
                <td className="p-3">
                  <input
                    type="number"
                    className="input w-28"
                    defaultValue={s.price}
                    onBlur={(e) => saveService({ ...s, price: Number(e.target.value) })}
                  />
                </td>
                <td className="p-3">
                  <select className="input" defaultValue={s.price_type} onChange={(e) => saveService({ ...s, price_type: e.target.value })}>
                    <option value="flat">Flat</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </td>
                <td className="p-3">
                  <input type="checkbox" checked={s.is_active} onChange={(e) => saveService({ ...s, is_active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card p-5 flex gap-3 items-end">
        <div className="flex-1">
          <label className="label">New service name</label>
          <input className="input w-full" value={newService.name} onChange={(e) => setNewService({ ...newService, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Price</label>
          <input
            type="number"
            className="input w-28"
            value={newService.price}
            onChange={(e) => setNewService({ ...newService, price: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={newService.price_type} onChange={(e) => setNewService({ ...newService, price_type: e.target.value })}>
            <option value="flat">Flat</option>
            <option value="hourly">Hourly</option>
          </select>
        </div>
        <button className="btn-gold" onClick={addService}>
          Add service
        </button>
      </div>
    </div>
  );
}
