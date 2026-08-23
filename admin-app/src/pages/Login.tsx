import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { session, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
  }

  const accessDenied = !loading && session && profile && !['staff', 'admin'].includes(profile.role);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-8">
          <img src="/assets/Logo_NoBG.png" alt="GGS Studio" className="w-14 h-14 object-contain mb-3" />
          <h1 className="text-lg font-semibold">GGS Studio Admin</h1>
        </div>

        {accessDenied ? (
          <div className="text-sm text-center">
            <p className="text-[#e5876f] mb-4">This account doesn't have staff access.</p>
            <button className="btn-ghost w-full" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="label">Email</label>
              <input className="input w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input w-full"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-xs text-[#e5876f]">{error}</p>}
            <button className="btn-gold w-full mt-2" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
