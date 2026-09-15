-- Run as the database owner. Fixture rows and Storage metadata are rolled back.
begin;

do $$
begin
  if not has_table_privilege('anon', 'public.game_collections', 'SELECT')
    or has_table_privilege('anon', 'public.game_collections', 'INSERT')
    or has_table_privilege('anon', 'public.game_collections', 'UPDATE')
    or has_table_privilege('anon', 'public.game_collections', 'DELETE') then
    raise exception 'Game collection privileges are not least-privilege';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'room310_public_standalone_read'
      and 'anon' = any(roles)
  ) then raise exception 'Published standalone Storage read policy is missing'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from public.profiles where approved and role in ('admin', 'editor') limit 1), true);
select set_config('room310.test_manager', current_setting('request.jwt.claim.sub'), true);
select set_config('room310.test_hash', repeat('a', 64), true);

set local role authenticated;
do $$
declare collection_id bigint; game_id bigint; external_id bigint; object_path text;
begin
  if auth.uid() is null then raise exception 'Test requires an approved manager'; end if;
  insert into public.game_collections (title, slug, description)
  values ('RLS pilot collection', 'room310-standalone-rls-collection', 'Draft collection fixture')
  returning id into collection_id;

  object_path := '999999/standalone-' || current_setting('room310.test_hash') || '.html';
  insert into public.games (
    title, slug, description, year, status, host_type, collection_id,
    standalone_html_path, source_sha256, source_bytes, standalone_reviewed_sha256
  ) values (
    'Standalone RLS game', 'room310-standalone-rls-game', 'Standalone fixture', 2026,
    'published', 'standalone', collection_id, object_path,
    current_setting('room310.test_hash'), 1024, current_setting('room310.test_hash')
  ) returning id into game_id;

  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('game-standalone', object_path, auth.uid(), auth.uid()::text, '{"mimetype":"text/html","size":1024}'::jsonb);

  insert into public.games (title, slug, description, year, status, host_type, external_url)
  values ('Old external collection', 'room310-old-external-rls', 'Rollback fixture', 2026, 'published', 'external', 'https://example.com/old-games')
  returning id into external_id;

  perform set_config('room310.test_collection', collection_id::text, true);
  perform set_config('room310.test_game', game_id::text, true);
  perform set_config('room310.test_object', object_path, true);
  perform set_config('room310.test_external', external_id::text, true);
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if exists (select 1 from public.game_collections where id = current_setting('room310.test_collection')::bigint) then
    raise exception 'Anonymous visitor can see a draft collection';
  end if;
  if exists (select 1 from public.games where id = current_setting('room310.test_game')::bigint) then
    raise exception 'Anonymous visitor can see a game inside a draft collection';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'game-standalone' and name = current_setting('room310.test_object')) then
    raise exception 'Anonymous visitor can read standalone HTML for a draft collection';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('room310.test_manager'), true);
select public.publish_game_collection(
  current_setting('room310.test_collection')::bigint,
  current_setting('room310.test_external')::bigint
);
do $$
begin
  if (select status from public.games where id = current_setting('room310.test_external')::bigint) <> 'draft' then
    raise exception 'Collection cutover did not retire the old external game';
  end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if not exists (select 1 from public.game_collections where id = current_setting('room310.test_collection')::bigint) then
    raise exception 'Published collection is not public';
  end if;
  if not exists (select 1 from public.games where id = current_setting('room310.test_game')::bigint) then
    raise exception 'Published standalone game is not public';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'game-standalone' and name = current_setting('room310.test_object')) then
    raise exception 'Published standalone HTML is not readable';
  end if;
  begin
    insert into public.game_collections (title, slug, description, created_by, updated_by)
    values ('Unauthorized collection', 'room310-unauthorized-collection', 'No access', gen_random_uuid(), gen_random_uuid());
    raise exception 'Anonymous collection write was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('room310.test_manager'), true);
do $$
begin
  begin
    insert into public.games (
      title, slug, description, year, status, host_type,
      standalone_html_path, source_sha256, source_bytes
    ) values (
      'Unreviewed standalone', 'room310-unreviewed-standalone', 'Must stay draft', 2026,
      'published', 'standalone', '999998/standalone-' || current_setting('room310.test_hash') || '.html',
      current_setting('room310.test_hash'), 512
    );
    raise exception 'Unreviewed standalone game was published';
  exception when check_violation then null;
  end;
end $$;

rollback;
select 'Standalone collection RLS tests passed; all fixtures rolled back' as result;
