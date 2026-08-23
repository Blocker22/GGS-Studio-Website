import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, callFunction } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Staff() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data: staff } = useQuery({
    queryKey: ['staff-list'],
    queryFn: async () =>
      (await supabase.from('profiles').select('*').in('role', ['staff', 'admin']).order('full_name')).data || [],
  });

  const [form, setForm] = useState({ email: '', full_name: '', role: 'staff' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function invite() {
    setError('');
    setBusy(true);
    try {
      await callFunction('invite-staff', form);
      setForm({ email: '', full_name: '', role: 'staff' });
      queryClient.invalidateQueries({ queryKey: ['staff-list'] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, role: string) {
    await supabase.from('profiles').update({ role }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['staff-list'] });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Staff accounts</h1>

      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-line text-cream/50 text-xs uppercase">
              <th className="p-3">Name</th>
              <th className="p-3">Role</th>
              <th className="p-3">Since</th>
            </tr>
          </thead>
          <tbody>
            {(staff || []).map((s: any) => (
              <tr key={s.id} className="border-b border-line/50 last:border-0">
                <td className="p-3">{s.full_name || 'Unnamed'}</td>
                <td className="p-3">
                  {isAdmin ? (
                    <select className="input" value={s.role} onChange={(e) => changeRole(s.id, e.target.value)}>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="uppercase text-xs text-gold">{s.role}</span>
                  )}
                </td>
                <td className="p-3">{new Date(s.created_at).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="card p-5">
          <div className="label mb-3">Invite new staff member</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="label">Email</label>
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Full name</label>
              <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="btn-gold" disabled={busy} onClick={invite}>
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          {error && <p className="text-xs text-[#e5876f] mt-3">{error}</p>}
        </div>
      )}
    </div>
  );
}
