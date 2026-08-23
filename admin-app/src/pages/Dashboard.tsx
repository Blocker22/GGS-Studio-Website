import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { supabase } from '../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  pending: '#d7ae5c',
  confirmed: '#2fb8b0',
  completed: '#8aa',
  cancelled: '#e5876f',
  no_show: '#7a6431',
};

function formatPeso(n: number) {
  return '₱' + Math.round(n).toLocaleString('en-PH');
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const { data: bookings } = await supabase.from('bookings').select('id, status, total_price, start_at, created_at');
      const { data: monthPayments } = await supabase
        .from('payments')
        .select('amount, status, created_at')
        .eq('status', 'succeeded')
        .gte('created_at', startOfMonth);
      const { data: today } = await supabase
        .from('bookings')
        .select('id, start_at, status, rooms(name)')
        .gte('start_at', startOfDay)
        .lt('start_at', endOfDay)
        .neq('status', 'cancelled')
        .order('start_at');

      const byStatus: Record<string, number> = {};
      (bookings || []).forEach((b) => {
        byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      });

      const revenueThisMonth = (monthPayments || []).reduce((s, p) => s + Number(p.amount), 0);

      const byDay: Record<string, number> = {};
      (bookings || [])
        .filter((b) => b.status !== 'cancelled')
        .forEach((b) => {
          const d = new Date(b.start_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
          byDay[d] = (byDay[d] || 0) + Number(b.total_price);
        });

      return {
        total: bookings?.length || 0,
        byStatus,
        revenueThisMonth,
        today: today || [],
        revenueByDay: Object.entries(byDay)
          .slice(-14)
          .map(([date, revenue]) => ({ date, revenue })),
      };
    },
  });

  if (isLoading || !data) return <div className="text-cream/60">Loading…</div>;

  const statusData = Object.entries(data.byStatus).map(([name, value]) => ({ name, value }));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-8">Dashboard</h1>

      <div className="grid grid-cols-4 gap-5 mb-8">
        <div className="card p-5">
          <div className="label mb-1">Total bookings</div>
          <div className="text-2xl font-bold">{data.total}</div>
        </div>
        <div className="card p-5">
          <div className="label mb-1">Pending approval</div>
          <div className="text-2xl font-bold text-gold">{data.byStatus.pending || 0}</div>
        </div>
        <div className="card p-5">
          <div className="label mb-1">Today's sessions</div>
          <div className="text-2xl font-bold">{data.today.length}</div>
        </div>
        <div className="card p-5">
          <div className="label mb-1">Revenue this month</div>
          <div className="text-2xl font-bold text-teal">{formatPeso(data.revenueThisMonth)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-8">
        <div className="card p-5">
          <div className="label mb-4">Bookings by status</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#888'} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#0a0d10', border: '1px solid rgba(238,244,244,0.12)' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <div className="label mb-4">Revenue trend (recent booking days)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.revenueByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(238,244,244,0.08)" />
              <XAxis dataKey="date" tick={{ fill: '#eef4f4', fontSize: 11 }} />
              <YAxis tick={{ fill: '#eef4f4', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#0a0d10', border: '1px solid rgba(238,244,244,0.12)' }} />
              <Bar dataKey="revenue" fill="#d7ae5c" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-5">
        <div className="label mb-4">Today's schedule</div>
        {data.today.length === 0 ? (
          <p className="text-sm text-cream/50">Nothing booked today.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.today.map((b: any) => (
              <div key={b.id} className="flex justify-between text-sm border-b border-line/50 py-2 last:border-0">
                <span>{new Date(b.start_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="text-cream/70">{b.rooms?.name}</span>
                <span className="text-gold uppercase text-xs">{b.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
