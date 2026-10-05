-- Admin dashboard blueprint: everything the reworked dashboard needs on top of
-- the original booking schema. Applied through the Supabase MCP; kept here so
-- the schema change is reviewable alongside the code that depends on it.

-- ---------------------------------------------------------------- profiles
alter table public.profiles
  add column if not exists notify_bookings boolean not null default false,
  add column if not exists avatar_url text,
  add column if not exists must_change_password boolean not null default false;

-- ---------------------------------------------------------------- bookings
alter table public.bookings
  add column if not exists rates jsonb,
  add column if not exists custom_total boolean not null default false,
  add column if not exists voucher jsonb,
  add column if not exists email_log jsonb not null default '[]'::jsonb,
  add column if not exists cancelled_by text,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists via text,
  add column if not exists policy_accepted_at timestamptz,
  add column if not exists id_check jsonb,
  add column if not exists payment_waived boolean not null default false,
  add column if not exists feedback_token_hash text,
  add column if not exists feedback_sent_at timestamptz,
  add column if not exists schedule_notice_at timestamptz,
  add column if not exists newsletter_opt_in boolean not null default false;

comment on column public.bookings.rates is 'Price snapshot at booking time: { hourly_rate }. Edits reprice against this, never today''s list.';
comment on column public.bookings.voucher is 'Voucher snapshot: { code, kind, value, label, discount }.';
comment on column public.bookings.id_check is 'Identity check for pay-in-person bookings: { type, label, number (last 4 only), format_checked, read, status, checked_by, checked_at, photo_deleted_at }.';

create index if not exists bookings_voucher_code_idx on public.bookings (upper(voucher->>'code')) where voucher is not null;
create unique index if not exists bookings_feedback_token_idx on public.bookings (feedback_token_hash) where feedback_token_hash is not null;
create index if not exists bookings_start_idx on public.bookings (start_at);

-- Existing rows get a price snapshot from the current room rate so edits keep
-- behaving the way they did when the booking was made.
update public.bookings b
   set rates = jsonb_build_object('hourly_rate', r.hourly_rate)
  from public.rooms r
 where r.id = b.room_id and b.rates is null;

-- ---------------------------------------------------------------- vouchers
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{3,24}$'),
  kind text not null check (kind in ('percent', 'amount', 'free_units', 'free')),
  value numeric not null default 0 check (value >= 0),
  description text,
  note text,
  min_units numeric not null default 0,
  max_uses integer check (max_uses is null or max_uses > 0),
  per_customer integer check (per_customer is null or per_customer > 0),
  valid_from date,
  valid_until date,
  weekdays smallint[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.vouchers enable row level security;
create policy vouchers_staff_all on public.vouchers for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
create trigger vouchers_set_updated_at before update on public.vouchers
  for each row execute function public.set_updated_at();
create trigger audit_vouchers after insert or update or delete on public.vouchers
  for each row execute function public.audit_log_generic_trigger();

-- ---------------------------------------------------------------- feedback
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete set null,
  name text not null,
  display_name text not null,
  booking_date date,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  photos text[] not null default '{}',
  featured boolean not null default false,
  featured_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create policy feedback_staff_all on public.feedback for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
create trigger audit_feedback after update or delete on public.feedback
  for each row execute function public.audit_log_generic_trigger();

-- ---------------------------------------------------------------- mailing list
create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text,
  source text not null default 'footer' check (source in ('footer', 'booking', 'staff', 'import')),
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed')),
  consent_note text,
  added_by uuid references public.profiles(id) on delete set null,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);
alter table public.subscribers enable row level security;
-- Reads and deletes only. New addresses go through the admin-api so the
-- consent rule can be enforced; RLS alone can't check a checkbox.
create policy subscribers_staff_select on public.subscribers for select using ((select public.is_staff()));
create policy subscribers_staff_delete on public.subscribers for delete using ((select public.is_staff()));

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  preheader text,
  headline text,
  body text,
  button_label text,
  button_url text,
  image_url text,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_by_name text,
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
create policy campaigns_staff_select on public.campaigns for select using ((select public.is_staff()));

-- ---------------------------------------------------------------- shared inbox
create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  mailbox text not null check (mailbox in ('booking', 'contact')),
  direction text not null check (direction in ('in', 'out')),
  from_addr text,
  from_name text,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  to_label text,
  counterpart text,
  subject text,
  subject_key text,
  text_body text,
  html_body text,
  snippet text,
  at timestamptz not null default now(),
  read boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  message_id text,
  in_reply_to text,
  references_hdr text,
  provider_id text unique,
  kind text,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_by_name text,
  booking_id uuid references public.bookings(id) on delete set null
);
create index if not exists mail_thread_idx on public.mail_messages (thread_id, at);
create index if not exists mail_at_idx on public.mail_messages (at desc);
create index if not exists mail_counterpart_idx on public.mail_messages (counterpart, subject_key);
create index if not exists mail_message_id_idx on public.mail_messages (message_id);
alter table public.mail_messages enable row level security;
create policy mail_staff_select on public.mail_messages for select using ((select public.is_staff()));
create policy mail_staff_update on public.mail_messages for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy mail_staff_delete on public.mail_messages for delete using ((select public.is_staff()));

-- ---------------------------------------------------------------- private settings
-- app_settings is world-readable (the booking form needs the deposit %), so
-- anything with a private note (schedule rules shown as "booked") lives here.
create table if not exists public.staff_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.staff_settings enable row level security;
create policy staff_settings_all on public.staff_settings for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
create trigger audit_staff_settings after insert or update or delete on public.staff_settings
  for each row execute function public.audit_log_generic_trigger();

insert into public.staff_settings (key, value) values ('schedule', '{"overrides": []}'::jsonb)
  on conflict (key) do nothing;

insert into public.app_settings (key, value) values
  ('booking_rules', '{"max_days_ahead": 90, "max_open_per_customer": 3, "min_lead_minutes": 60, "feedback_enabled": true, "feedback_delay_hours": 3, "id_retention_days": 30, "require_id_for_cash": true}'::jsonb),
  ('contacts', '{"email": "ggs.studio2026@gmail.com", "address": "Manson Trading, Looc, Lapu-Lapu City, Cebu", "map_url": "https://maps.google.com/?q=Manson+Trading,+Looc,+Lapu-Lapu+City,+Cebu", "facebook": "https://www.facebook.com/profile.php?id=61589919255165", "people": [{"name": "GGS Studio", "phone": "+63 976 350 6301", "email": "ggs.studio2026@gmail.com"}]}'::jsonb),
  ('payment_methods', '[
    {"id": "cash", "kind": "in_person", "name": "Cash at the studio", "enabled": true, "detail": "Nothing to pay now. Bring a valid ID; a school or student ID works.", "note": "Pay on the day, before the session starts."},
    {"id": "gcash", "kind": "online", "name": "GCash", "enabled": true, "account_name": "Garvey Gene Sanjorjo", "account_number": "", "qr_url": "assets/payment_qr/GGS_Gcash_QR.png", "steps": "Open GCash and scan the QR.\nSend exactly **{total}**.\nScreenshot the receipt and upload it below.", "needs_receipt": true, "needs_ref": true, "ref_hint": "13-digit Ref No. on the receipt"},
    {"id": "gotyme", "kind": "online", "name": "GoTyme", "enabled": true, "account_name": "Garvey Gene Sanjorjo", "account_number": "", "qr_url": "assets/payment_qr/GGS_GoTyme_QR.png", "steps": "Scan the QR in the GoTyme app.\nSend exactly **{total}**.\nUpload the receipt below.", "needs_receipt": true, "needs_ref": true, "ref_hint": "Reference number on the receipt"},
    {"id": "bpi", "kind": "online", "name": "BPI", "enabled": true, "account_name": "Garvey Gene Sanjorjo", "account_number": "", "qr_url": "assets/payment_qr/GGS_BPI_QR.png", "steps": "Scan the QR with BPI or any InstaPay app.\nSend exactly **{total}**.\nUpload the receipt below.", "needs_receipt": true, "needs_ref": true, "ref_hint": "Reference number on the receipt"}
  ]'::jsonb),
  ('email_templates', '{}'::jsonb),
  ('assistant', '{"enabled": true, "model": "gemini-3.6-flash"}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- secrets
insert into public.app_secrets (key, value) values
  ('link_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- RPCs
-- Weekly hours for a room plus the special-date rules, with the private note
-- stripped from anything shown to the public as "booked".
create or replace function public.public_schedule(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dow', h.day_of_week,
        'closed', h.is_closed or h.open_time is null,
        'open', to_char(h.open_time, 'HH24:MI'),
        'close', to_char(h.close_time, 'HH24:MI')) order by h.day_of_week)
      from public.operating_hours h where h.room_id = p_room_id), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(case when r->>'show' = 'booked' then r - 'note' else r end)
      from public.staff_settings s, jsonb_array_elements(s.value->'overrides') r
      where s.key = 'schedule'), '[]'::jsonb)
  );
$$;
grant execute on function public.public_schedule(uuid) to anon, authenticated;

-- Team list with login emails, which live in auth.users and are otherwise
-- out of reach of the browser.
create or replace function public.staff_list()
returns table (id uuid, full_name text, role text, email text, notify_bookings boolean, avatar_url text, created_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.id, p.full_name, p.role, u.email::text, p.notify_bookings, p.avatar_url, p.created_at, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
   where p.role in ('staff', 'admin') and public.is_staff()
   order by p.full_name nulls last;
$$;
revoke execute on function public.staff_list() from anon, public;
grant execute on function public.staff_list() to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site-files', 'site-files', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('review-photos', 'review-photos', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy site_files_public_read on storage.objects for select using (bucket_id = 'site-files');
create policy site_files_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'site-files' and (select public.is_staff()));
create policy site_files_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'site-files' and (select public.is_staff()));
create policy site_files_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site-files' and (select public.is_staff()));
create policy review_photos_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'review-photos' and (select public.is_staff()));
create policy review_photos_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and (select public.is_staff()));
