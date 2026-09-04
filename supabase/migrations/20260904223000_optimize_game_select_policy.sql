drop policy games_select_published on public.games;
drop policy games_managers_select_all on public.games;

create policy games_anon_select_published
  on public.games
  for select
  to anon
  using (status = 'published' and host_type = 'external');

create policy games_authenticated_select_allowed
  on public.games
  for select
  to authenticated
  using (
    (status = 'published' and host_type = 'external')
    or (select private.is_game_manager())
  );
