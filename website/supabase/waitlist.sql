-- The early-access list: signing in on creatro.in with Google adds you here (website/auth.ts).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Each person can add only themselves and read only their own row. Nobody can list, change or
-- delete other people's rows from the website; you see everyone in Table Editor -> waitlist.

create table if not exists public.waitlist (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text,
  avatar_url text,
  joined_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

drop policy if exists "join the list as yourself" on public.waitlist;
create policy "join the list as yourself" on public.waitlist
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "see your own place" on public.waitlist;
create policy "see your own place" on public.waitlist
  for select to authenticated using ((select auth.uid()) = id);

grant select, insert on public.waitlist to authenticated;
revoke all on public.waitlist from anon;
