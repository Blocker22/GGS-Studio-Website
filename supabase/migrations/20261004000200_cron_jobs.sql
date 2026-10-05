-- Background jobs: every 10 minutes pg_net calls the `cron` Edge Function with
-- the shared secret from app_secrets (review requests, ID photo retention,
-- rate-limit cleanup). The secret is read at run time, never stored here.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ggs-background-jobs',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://poxgdnisortpetxqirwg.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
