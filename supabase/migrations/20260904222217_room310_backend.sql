create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  role text not null default 'editor' check (role in ('admin', 'editor')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.games (
  id bigint generated always as identity primary key,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,69}$'),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  year smallint not null check (year between 1900 and 2100),
  thumbnail_path text check (thumbnail_path is null or thumbnail_path ~ '^[0-9]+/[A-Za-z0-9._-]+$'),
  bundle_path text check (bundle_path is null or bundle_path ~ '^[0-9]+/[A-Za-z0-9._-]+[.]zip$'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  host_type text not null default 'external' check (host_type in ('external', 'hosted')),
  external_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint games_host_fields_check check (
    (
      host_type = 'external'
      and external_url is not null
      and char_length(external_url) <= 2048
      and external_url ~* '^https?://[^[:space:]]+$'
      and external_url !~* '^https?://[^/]*@'
      and bundle_path is null
    )
    or
    (host_type = 'hosted' and external_url is null)
  ),
  constraint games_v05_publish_check check (status = 'draft' or host_type = 'external')
);

create index games_manager_order_idx on public.games (updated_at desc, id desc);
create index games_public_order_idx
  on public.games (year desc, created_at desc)
  where status = 'published' and host_type = 'external';
create index games_created_by_idx on public.games (created_by);
create index games_updated_by_idx on public.games (updated_by);

alter table public.profiles enable row level security;
alter table public.games enable row level security;

create or replace function private.is_game_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
        and approved = true
        and role in ('admin', 'editor')
    );
$$;

revoke all on function private.is_game_manager() from public, anon;
grant execute on function private.is_game_manager() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role, approved)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'Room310 user'), '@', 1)),
    case when lower(coalesce(new.email, '')) = 'jacob.bradford.aleo@gmail.com' then 'admin' else 'editor' end,
    lower(coalesce(new.email, '')) = 'jacob.bradford.aleo@gmail.com'
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger room310_auth_user_profile
  after insert or update of email on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.prepare_game_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := (select auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.prepare_game_write() from public, anon, authenticated;

create trigger room310_prepare_game_write
  before insert or update on public.games
  for each row execute function private.prepare_game_write();

grant usage on schema public to anon, authenticated;
grant select on public.games to anon, authenticated;
grant select on public.profiles to authenticated;
grant insert, update, delete on public.games to authenticated;
grant usage, select on sequence public.games_id_seq to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) is not null and id = (select auth.uid()));

create policy games_select_published
  on public.games
  for select
  to anon, authenticated
  using (status = 'published' and host_type = 'external');

create policy games_managers_select_all
  on public.games
  for select
  to authenticated
  using ((select private.is_game_manager()));

create policy games_managers_insert
  on public.games
  for insert
  to authenticated
  with check (
    (select private.is_game_manager())
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy games_managers_update
  on public.games
  for update
  to authenticated
  using ((select private.is_game_manager()))
  with check (
    (select private.is_game_manager())
    and updated_by = (select auth.uid())
  );

create policy games_managers_delete
  on public.games
  for delete
  to authenticated
  using ((select private.is_game_manager()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('game-thumbnails', 'game-thumbnails', false, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  ('game-bundles', 'game-bundles', false, 20971520, array['application/zip', 'application/x-zip-compressed'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

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
        and host_type = 'external'
    )
  );

create policy room310_manager_storage_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('game-thumbnails', 'game-bundles')
    and (select private.is_game_manager())
  );

create policy room310_manager_storage_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id in ('game-thumbnails', 'game-bundles')
    and (select private.is_game_manager())
  );

create policy room310_manager_storage_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id in ('game-thumbnails', 'game-bundles')
    and (select private.is_game_manager())
  )
  with check (
    bucket_id in ('game-thumbnails', 'game-bundles')
    and (select private.is_game_manager())
  );

create policy room310_manager_storage_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id in ('game-thumbnails', 'game-bundles')
    and (select private.is_game_manager())
  );
