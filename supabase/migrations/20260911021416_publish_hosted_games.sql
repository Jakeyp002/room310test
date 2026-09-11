alter table public.games
  drop constraint games_publishable_source_check;

alter table public.games
  add constraint games_publishable_source_check check (
    status = 'draft'
    or host_type in ('external', 'embed')
    or (host_type = 'hosted' and bundle_path is not null)
  );

drop index games_public_order_idx;
create index games_public_order_idx
  on public.games (year desc, created_at desc)
  where status = 'published';

drop policy games_anon_select_published on public.games;
drop policy games_authenticated_select_allowed on public.games;

create policy games_anon_select_published
  on public.games
  for select
  to anon
  using (status = 'published');

create policy games_authenticated_select_allowed
  on public.games
  for select
  to authenticated
  using (status = 'published' or (select private.is_game_manager()));

drop policy room310_public_thumbnail_read on storage.objects;
create policy room310_public_thumbnail_read
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'game-thumbnails'
    and exists (
      select 1
      from public.games
      where thumbnail_path = storage.objects.name
        and status = 'published'
    )
  );

create policy room310_public_bundle_read
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'game-bundles'
    and exists (
      select 1
      from public.games
      where bundle_path = storage.objects.name
        and status = 'published'
        and host_type = 'hosted'
    )
  );
