import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://poxgdnisortpetxqirwg.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBveGdkbmlzb3J0cGV0eHFpcndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NTI3MDAsImV4cCI6MjEwMzAyODcwMH0.9Bknym2gX1FitLwMsghtuHQFduJek0M7f5430fC2HeI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export async function callFunction<T = any>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not authenticated.');
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed.');
  return json;
}
