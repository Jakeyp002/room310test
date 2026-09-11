alter table public.games
  add column embed_html text;

alter table public.games
  drop constraint games_host_type_check,
  drop constraint games_host_fields_check,
  drop constraint games_v05_publish_check;

alter table public.games
  add constraint games_host_type_check
    check (host_type in ('external', 'embed', 'hosted')),
  add constraint games_source_fields_check check (
    (
      host_type = 'external'
      and external_url is not null
      and char_length(external_url) <= 2048
      and external_url ~* '^https?://[^[:space:]]+$'
      and external_url !~* '^https?://[^/]*@'
      and embed_html is null
      and bundle_path is null
    )
    or
    (
      host_type = 'embed'
      and external_url is null
      and bundle_path is null
      and embed_html is not null
      and char_length(embed_html) between 1 and 500000
      and embed_html ~ '[^[:space:]]'
      and octet_length(embed_html) <= 524288
    )
    or
    (
      host_type = 'hosted'
      and external_url is null
      and embed_html is null
    )
  ),
  add constraint games_publishable_source_check
    check (status = 'draft' or host_type in ('external', 'embed'));

drop index games_public_order_idx;
create index games_public_order_idx
  on public.games (year desc, created_at desc)
  where status = 'published' and host_type in ('external', 'embed');

drop policy games_anon_select_published on public.games;
drop policy games_authenticated_select_allowed on public.games;

create policy games_anon_select_published
  on public.games
  for select
  to anon
  using (status = 'published' and host_type in ('external', 'embed'));

create policy games_authenticated_select_allowed
  on public.games
  for select
  to authenticated
  using (
    (status = 'published' and host_type in ('external', 'embed'))
    or (select private.is_game_manager())
  );

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
        and host_type in ('external', 'embed')
    )
  );
