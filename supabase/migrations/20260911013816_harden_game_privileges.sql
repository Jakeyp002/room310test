-- Supabase projects can inherit broad default grants for exposed schemas.
-- Keep anonymous visitors read-only and let RLS authorize manager writes.
revoke all on table public.games from anon, authenticated;
grant select on table public.games to anon, authenticated;
grant insert, update, delete on table public.games to authenticated;

revoke all on sequence public.games_id_seq from anon, authenticated;
grant usage, select on sequence public.games_id_seq to authenticated;
