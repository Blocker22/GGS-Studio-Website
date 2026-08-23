// Shared Supabase client config for the public site.
// The anon key is safe to expose publicly — access is enforced entirely by
// Postgres Row Level Security policies on the Supabase project.
export const SUPABASE_URL = 'https://poxgdnisortpetxqirwg.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBveGdkbmlzb3J0cGV0eHFpcndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NTI3MDAsImV4cCI6MjEwMzAyODcwMH0.9Bknym2gX1FitLwMsghtuHQFduJek0M7f5430fC2HeI';

export async function getSupabase() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
