import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/bookings', label: 'Bookings' },
  { to: '/customers', label: 'Customers' },
  { to: '/rooms', label: 'Rooms & Services' },
  { to: '/availability', label: 'Availability' },
  { to: '/payments', label: 'Payments' },
  { to: '/staff', label: 'Staff' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { profile, signOut } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-line bg-panel px-5 py-8 flex flex-col">
        <div className="flex items-center gap-3 mb-10 px-2">
          <img src="/assets/Logo_NoBG.png" alt="GGS Studio" className="w-9 h-9 object-contain" />
          <div>
            <div className="text-sm font-semibold tracking-wide">GGS Studio</div>
            <div className="text-[0.65rem] uppercase tracking-widest text-gold">Admin</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-2.5 rounded text-sm transition-colors ${
                  isActive ? 'bg-gold text-ink font-semibold' : 'text-cream/80 hover:bg-panel2'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line pt-4 mt-4">
          <div className="text-xs text-cream/60 mb-2 truncate">{profile?.full_name || 'Staff'}</div>
          <button onClick={signOut} className="btn-ghost text-xs w-full">
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 px-10 py-8 overflow-x-auto">
        <Outlet />
      </main>
    </div>
  );
}
