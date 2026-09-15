create table public.game_collections (
  id bigint generated always as identity primary key,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,69}$'),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict
);

create index game_collections_public_order_idx
  on public.game_collections (created_at desc, id desc)
  where status = 'published';
create index game_collections_manager_order_idx
  on public.game_collections (updated_at desc, id desc);
create index game_collections_created_by_idx on public.game_collections (created_by);
create index game_collections_updated_by_idx on public.game_collections (updated_by);

alter table public.game_collections enable row level security;
revoke all on table public.game_collections from anon, authenticated;
grant select on table public.game_collections to anon, authenticated;
grant insert, update, delete on table public.game_collections to authenticated;
grant usage, select on sequence public.game_collections_id_seq to authenticated;

create policy game_collections_anon_read
  on public.game_collections
  for select
  to anon
  using (status = 'published');

create policy game_collections_authenticated_read
  on public.game_collections
  for select
  to authenticated
  using (status = 'published' or (select private.is_game_manager()));

create policy game_collections_manager_insert
  on public.game_collections
  for insert
  to authenticated
  with check (
    (select private.is_game_manager())
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy game_collections_manager_update
  on public.game_collections
  for update
  to authenticated
  using ((select private.is_game_manager()))
  with check (
    (select private.is_game_manager())
    and updated_by = (select auth.uid())
  );

create policy game_collections_manager_delete
  on public.game_collections
  for delete
  to authenticated
  using ((select private.is_game_manager()));

-- Seed the Room310 collection as a draft. The existing Google Sites game remains
-- published until the original game files have been reviewed and imported.
do $$
declare
  manager_id uuid;
begin
  select coalesce(
    (select created_by from public.games where id = 55),
    (select id from public.profiles where approved and role in ('admin', 'editor') order by created_at limit 1)
  ) into manager_id;

  if manager_id is not null then
    insert into public.game_collections (
      title, slug, description, status, created_by, updated_by
    )
    values (
      '100+ Games',
      '100-games',
      'A searchable collection of browser games hosted directly for Room310.',
      'draft',
      manager_id,
      manager_id
    )
    on conflict (slug) do nothing;
  end if;
end $$;

create trigger room310_prepare_game_collection_write
  before insert or update on public.game_collections
  for each row execute function private.prepare_game_write();

alter table public.games
  add column collection_id bigint references public.game_collections (id) on delete set null,
  add column standalone_html_path text,
  add column source_sha256 text,
  add column source_bytes integer,
  add column standalone_reviewed_sha256 text;

create index games_collection_id_idx on public.games (collection_id);
create index games_standalone_path_idx
  on public.games (standalone_html_path)
  where standalone_html_path is not null;

alter table public.games
  drop constraint games_host_type_check,
  drop constraint games_source_fields_check,
  drop constraint games_publishable_source_check;

alter table public.games
  add constraint games_host_type_check
    check (host_type in ('external', 'embed', 'hosted', 'standalone')),
  add constraint games_source_fields_check check (
    (
      host_type = 'external'
      and external_url is not null
      and char_length(external_url) <= 2048
      and external_url ~* '^https?://[^[:space:]]+$'
      and external_url !~* '^https?://[^/]*@'
      and embed_html is null
      and bundle_path is null
      and standalone_html_path is null
      and source_sha256 is null
      and source_bytes is null
      and standalone_reviewed_sha256 is null
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
      and standalone_html_path is null
      and source_sha256 is null
      and source_bytes is null
      and standalone_reviewed_sha256 is null
    )
    or
    (
      host_type = 'hosted'
      and external_url is null
      and embed_html is null
      and standalone_html_path is null
      and source_sha256 is null
      and source_bytes is null
      and standalone_reviewed_sha256 is null
    )
    or
    (
      host_type = 'standalone'
      and external_url is null
      and embed_html is null
      and bundle_path is null
      and (
        (
          standalone_html_path is null
          and source_sha256 is null
          and source_bytes is null
          and standalone_reviewed_sha256 is null
        )
        or
        (
          standalone_html_path ~ '^[0-9]+/standalone-[a-f0-9]{64}[.]html$'
          and source_sha256 ~ '^[a-f0-9]{64}$'
          and source_bytes between 1 and 31457280
          and (
            standalone_reviewed_sha256 is null
            or standalone_reviewed_sha256 ~ '^[a-f0-9]{64}$'
          )
        )
      )
    )
  ),
  add constraint games_publishable_source_check check (
    status = 'draft'
    or host_type in ('external', 'embed')
    or (host_type = 'hosted' and bundle_path is not null)
    or (
      host_type = 'standalone'
      and standalone_html_path is not null
      and standalone_reviewed_sha256 = source_sha256
    )
  );

create or replace function public.publish_game_collection(
  collection_to_publish bigint,
  external_game_to_retire bigint default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_game_manager()) then
    raise insufficient_privilege using message = 'Approved Room310 manager access is required.';
  end if;
  if not exists (
    select 1 from public.games
    where collection_id = collection_to_publish
      and status = 'published'
  ) then
    raise check_violation using message = 'Publish at least one reviewed game before publishing its collection.';
  end if;

  update public.game_collections
  set status = 'published'
  where id = collection_to_publish;
  if not found then raise no_data_found using message = 'Game collection not found.'; end if;

  if external_game_to_retire is not null then
    update public.games
    set status = 'draft'
    where id = external_game_to_retire
      and host_type = 'external';
  end if;
end;
$$;

revoke all on function public.publish_game_collection(bigint, bigint) from public, anon, authenticated;
grant execute on function public.publish_game_collection(bigint, bigint) to authenticated;

drop policy games_anon_select_published on public.games;
drop policy games_authenticated_select_allowed on public.games;

create policy games_anon_select_published
  on public.games
  for select
  to anon
  using (
    status = 'published'
    and (
      collection_id is null
      or exists (
        select 1
        from public.game_collections
        where id = games.collection_id
          and status = 'published'
      )
    )
  );

create policy games_authenticated_select_allowed
  on public.games
  for select
  to authenticated
  using (
    (
      status = 'published'
      and (
        collection_id is null
        or exists (
          select 1
          from public.game_collections
          where id = games.collection_id
            and status = 'published'
        )
      )
    )
    or (select private.is_game_manager())
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-standalone', 'game-standalone', false, 31457280, array['text/html'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

create policy room310_public_standalone_read
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'game-standalone'
    and exists (
      select 1
      from public.games
      where standalone_html_path = storage.objects.name
        and status = 'published'
        and host_type = 'standalone'
        and (
          collection_id is null
          or exists (
            select 1
            from public.game_collections
            where id = games.collection_id
              and status = 'published'
          )
        )
    )
  );

drop policy room310_manager_storage_read on storage.objects;
drop policy room310_manager_storage_insert on storage.objects;
drop policy room310_manager_storage_update on storage.objects;
drop policy room310_manager_storage_delete on storage.objects;

create policy room310_manager_storage_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('game-thumbnails', 'game-bundles', 'game-standalone')
    and (select private.is_game_manager())
  );

create policy room310_manager_storage_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id in ('game-thumbnails', 'game-bundles', 'game-standalone')
    and (select private.is_game_manager())
  );

create policy room310_manager_storage_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id in ('game-thumbnails', 'game-bundles', 'game-standalone')
    and (select private.is_game_manager())
  )
  with check (
    bucket_id in ('game-thumbnails', 'game-bundles', 'game-standalone')
    and (select private.is_game_manager())
  );

create policy room310_manager_storage_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id in ('game-thumbnails', 'game-bundles', 'game-standalone')
    and (select private.is_game_manager())
  );

comment on table public.game_collections is
  'Room310 catalog collections. Draft collections also hide their published member games from public RLS.';
comment on column public.games.standalone_reviewed_sha256 is
  'Publishing acknowledgement bound to the exact reviewed standalone HTML hash.';
