-- Leaderboards for the games on creatro.in/play/ (website/play/play.js, website/auth.ts).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- One row per person per game: their best. The website never touches the table directly; it can only
-- call two functions. submit_score keeps a score only when it beats your own best and is within a
-- believable range for that game. leaderboard returns the top 10 and your own place. Names are a
-- first name and an initial ("Kartik M."); emails are never stored here or shown.

create table if not exists public.scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  game text not null check (game in ('climb', 'keep', 'fly', 'snake', 'dodge', 'seq', 'catch')),
  best integer not null check (best >= 0),
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);

create index if not exists scores_board on public.scores (game, best desc, updated_at);

alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;

-- Save a score. Returns your best for that game.
create or replace function public.submit_score(p_game text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cap integer;
  full_name text;
  shown text;
  result integer;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  -- Above these, a score is not believable for the game (the game itself caps nothing).
  cap := case p_game
    when 'climb' then 100000 when 'keep' then 5000 when 'fly' then 20000 when 'snake' then 3000
    when 'dodge' then 200000 when 'seq' then 500 when 'catch' then 3000 else null end;
  if cap is null then raise exception 'Unknown game.'; end if;
  if p_score is null or p_score < 0 or p_score > cap then raise exception 'Score out of range.'; end if;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') into full_name
  from auth.users u where u.id = uid;
  shown := coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), 'Player')
    || coalesce(' ' || nullif(upper(left(split_part(trim(full_name), ' ', 2), 1)), '') || '.', '');

  insert into public.scores (user_id, game, best, name) values (uid, p_game, p_score, shown)
  on conflict (user_id, game) do update
    set best = greatest(public.scores.best, excluded.best),
        name = excluded.name,
        updated_at = case when excluded.best > public.scores.best then now() else public.scores.updated_at end;

  select best into result from public.scores where user_id = uid and game = p_game;
  return result;
end;
$$;

-- The top 10 for a game, plus your own row when you're further down. Ties go to whoever got there first.
create or replace function public.leaderboard(p_game text)
returns table (rank bigint, name text, best integer, me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select rank() over (order by s.best desc, s.updated_at asc) as rank, s.name, s.best, s.user_id = auth.uid() as me
    from public.scores s where s.game = p_game
  )
  select r.rank, r.name, r.best, r.me from ranked r where r.rank <= 10 or r.me order by r.rank;
$$;

revoke all on function public.submit_score(text, integer) from public, anon;
revoke all on function public.leaderboard(text) from public, anon;
grant execute on function public.submit_score(text, integer) to authenticated;
grant execute on function public.leaderboard(text) to authenticated;
