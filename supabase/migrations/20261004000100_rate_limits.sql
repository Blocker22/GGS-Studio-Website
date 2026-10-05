-- Per-key hit counters for the public Edge Functions (booking create, voucher
-- checks, subscribe, feedback, manage-link attempts). Service role only.
create table if not exists public.rate_limits (
  key text primary key,
  hits integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;

create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, hits, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
