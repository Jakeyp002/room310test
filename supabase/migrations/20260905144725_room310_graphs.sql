create table public.graphs (
  id bigint generated always as identity primary key,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,69}$'),
  description text not null default '' check (char_length(description) <= 500),
  year smallint not null check (year between 1900 and 2100),
  desmos_url text not null check (desmos_url ~ '^https://www[.]desmos[.]com/calculator/[a-zA-Z0-9_-]{6,80}$'),
  thumbnail_path text check (thumbnail_path is null or thumbnail_path ~ '^[0-9]+/[A-Za-z0-9._-]+$'),
  thumbnail_source text not null default 'automatic' check (thumbnail_source in ('automatic', 'custom')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint graphs_published_cover check (status <> 'published' or thumbnail_path is not null)
);

create index graphs_public_order_idx on public.graphs (year desc, created_at desc) where status = 'published';
create index graphs_manager_order_idx on public.graphs (updated_at desc, id desc);
create index graphs_thumbnail_idx on public.graphs (thumbnail_path) where thumbnail_path is not null;
create index graphs_created_by_idx on public.graphs (created_by);
create index graphs_updated_by_idx on public.graphs (updated_by);

alter table public.graphs enable row level security;
revoke all on public.graphs from anon, authenticated;
grant select on public.graphs to anon, authenticated;
grant insert, update, delete on public.graphs to authenticated;
grant usage, select on sequence public.graphs_id_seq to authenticated;

-- Reuse the existing audit trigger and approval check used by the Games editor.
create trigger room310_prepare_graph_write before insert or update on public.graphs
  for each row execute function private.prepare_game_write();

create policy graphs_anon_read on public.graphs for select to anon using (status = 'published');
create policy graphs_authenticated_read on public.graphs for select to authenticated
  using (status = 'published' or (select private.is_game_manager()));
create policy graphs_manager_insert on public.graphs for insert to authenticated
  with check ((select private.is_game_manager()) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy graphs_manager_update on public.graphs for update to authenticated
  using ((select private.is_game_manager())) with check ((select private.is_game_manager()) and updated_by = (select auth.uid()));
create policy graphs_manager_delete on public.graphs for delete to authenticated using ((select private.is_game_manager()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('graph-thumbnails', 'graph-thumbnails', false, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

create policy graphs_thumbnail_anon_read on storage.objects for select to anon
  using (bucket_id = 'graph-thumbnails' and exists (select 1 from public.graphs where thumbnail_path = storage.objects.name and status = 'published'));
create policy graphs_thumbnail_authenticated_read on storage.objects for select to authenticated
  using (bucket_id = 'graph-thumbnails' and ((select private.is_game_manager()) or exists (select 1 from public.graphs where thumbnail_path = storage.objects.name and status = 'published')));
create policy graphs_thumbnail_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'graph-thumbnails' and (select private.is_game_manager()));
create policy graphs_thumbnail_update on storage.objects for update to authenticated
  using (bucket_id = 'graph-thumbnails' and (select private.is_game_manager()))
  with check (bucket_id = 'graph-thumbnails' and (select private.is_game_manager()));
create policy graphs_thumbnail_delete on storage.objects for delete to authenticated
  using (bucket_id = 'graph-thumbnails' and (select private.is_game_manager()));
