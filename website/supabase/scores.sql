-- Leaderboards for the games on creatro.in/play/ (website/play/play.js, website/auth.ts).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- One row per person per game: their best. The website never touches the tables directly; it can only
-- call the functions below. submit_score keeps a score only when it beats your own best and is within a
-- believable range for that game. leaderboard returns the top 10 and your own place. Names are a
-- first name and an initial ("Kartik M.") until a player picks their own with set_name; emails are
-- never stored here or shown.

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

-- A name a player chose for the boards (set_name). Without one, it's their first name and an initial.
create table if not exists public.players (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 16),
  updated_at timestamptz not null default now()
);
-- A chosen name belongs to one player: "Ashu", "ashu" and "ASHU" are the same name.
create unique index if not exists players_name_unique on public.players (lower(name));
alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;

-- The name a player shows on the boards: the one they chose, or "First L." from their Google account.
-- A "First L." that someone else has chosen as their name gets a number ("Ashu M. 2"), so a chosen
-- name is only ever on one player.
create or replace function public.shown_name(uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chosen text;
  base text;
  k int := 1;
begin
  select p.name into chosen from public.players p where p.user_id = uid;
  if chosen is not null then return chosen; end if;
  select coalesce(nullif(split_part(trim(x.n), ' ', 1), ''), 'Player')
         || coalesce(' ' || nullif(upper(left(split_part(trim(x.n), ' ', 2), 1)), '') || '.', '')
    into base
    from (select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') as n
          from auth.users u where u.id = uid) x;
  base := coalesce(base, 'Player');
  while exists (select 1 from public.players p
                where lower(p.name) = lower(base || case when k = 1 then '' else ' ' || k end) and p.user_id <> uid) loop
    k := k + 1;
  end loop;
  return base || case when k = 1 then '' else ' ' || k end;
end;
$$;

-- Your name on the boards.
create or replace function public.my_name()
returns text
language sql
stable
security definer
set search_path = public
as $$ select case when auth.uid() is null then null else public.shown_name(auth.uid()) end; $$;

-- Choose your name: 2 to 16 letters, numbers, spaces, dots, dashes or underscores, and not a name
-- another player has chosen or already shows on a board. It changes on every board at once. Returns
-- the name as saved.
create or replace function public.set_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if char_length(clean) < 2 or char_length(clean) > 16 then raise exception 'Use 2 to 16 characters.'; end if;
  if clean !~ '^[A-Za-z0-9 ._-]+$' then raise exception 'Use letters, numbers, spaces, dots, dashes or underscores.'; end if;
  if exists (select 1 from public.players p where lower(p.name) = lower(clean) and p.user_id <> uid)
     or exists (select 1 from public.scores s where lower(s.name) = lower(clean) and s.user_id <> uid) then
    raise exception 'That name is taken. Try another.';
  end if;
  begin
    insert into public.players (user_id, name) values (uid, clean)
    on conflict (user_id) do update set name = excluded.name, updated_at = now();
  exception when unique_violation then
    raise exception 'That name is taken. Try another.';
  end;
  update public.scores set name = clean where user_id = uid;
  return clean;
end;
$$;

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

  shown := public.shown_name(uid);

  insert into public.scores (user_id, game, best, name) values (uid, p_game, p_score, shown)
  on conflict (user_id, game) do update
    set best = greatest(public.scores.best, excluded.best),
        name = excluded.name,
        updated_at = case when excluded.best > public.scores.best then now() else public.scores.updated_at end;

  select best into result from public.scores where user_id = uid and game = p_game;
  return result;
end;
$$;

-- The top 10 for a game, plus your own row when you're further down, and how many play it. Ties go to
-- whoever got there first.
drop function if exists public.leaderboard(text);
create or replace function public.leaderboard(p_game text)
returns table (rank bigint, name text, best integer, me boolean, players bigint)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select rank() over (order by s.best desc, s.updated_at asc) as rank, s.name, s.best, s.user_id = auth.uid() as me,
      count(*) over () as players
    from public.scores s where s.game = p_game
  )
  select r.rank, r.name, r.best, r.me, r.players from ranked r where r.rank <= 10 or r.me order by r.rank;
$$;

revoke all on function public.shown_name(uuid) from public, anon, authenticated;
revoke all on function public.my_name() from public, anon;
revoke all on function public.set_name(text) from public, anon;
grant execute on function public.my_name() to authenticated;
grant execute on function public.set_name(text) to authenticated;
revoke all on function public.submit_score(text, integer) from public, anon;
revoke all on function public.leaderboard(text) from public, anon;
grant execute on function public.submit_score(text, integer) to authenticated;
grant execute on function public.leaderboard(text) to authenticated;
