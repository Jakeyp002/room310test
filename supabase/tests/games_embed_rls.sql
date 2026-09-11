-- Run as the database owner. All fixture rows are rolled back; existing records are untouched.
begin;
do $$
begin
  if not has_table_privilege('anon', 'public.games', 'SELECT') then
    raise exception 'Anonymous users cannot read published games';
  end if;
  if has_table_privilege('anon', 'public.games', 'INSERT')
    or has_table_privilege('anon', 'public.games', 'UPDATE')
    or has_table_privilege('anon', 'public.games', 'DELETE')
    or has_table_privilege('anon', 'public.games', 'TRUNCATE')
    or has_table_privilege('anon', 'public.games', 'REFERENCES')
    or has_table_privilege('anon', 'public.games', 'TRIGGER') then
    raise exception 'Anonymous users have unnecessary game write privileges';
  end if;
  if not has_table_privilege('authenticated', 'public.games', 'SELECT')
    or not has_table_privilege('authenticated', 'public.games', 'INSERT')
    or not has_table_privilege('authenticated', 'public.games', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.games', 'DELETE') then
    raise exception 'Authenticated manager grants are incomplete';
  end if;
  if has_table_privilege('authenticated', 'public.games', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.games', 'REFERENCES')
    or has_table_privilege('authenticated', 'public.games', 'TRIGGER') then
    raise exception 'Authenticated users have unnecessary game table privileges';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'room310_public_bundle_read'
      and 'anon' = any(roles)
  ) then
    raise exception 'Published hosted bundle read policy is missing';
  end if;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from public.profiles where approved and role in ('admin', 'editor') limit 1), true);
select set_config('room310.test_manager', current_setting('request.jwt.claim.sub'), true);
select set_config(
  'room310.test_unapproved',
  coalesce((select id::text from public.profiles where not approved limit 1), gen_random_uuid()::text),
  true
);

set local role authenticated;
do $$
declare draft_id bigint; embed_id bigint; external_id bigint; hosted_id bigint;
begin
  if auth.uid() is null then raise exception 'Test requires an existing approved manager'; end if;

  insert into public.games (title, slug, description, year, host_type, embed_html)
  values ('Embed RLS draft', 'room310-v13-embed-rls-draft', 'Draft fixture', 2026, 'embed', '<canvas></canvas>')
  returning id into draft_id;

  insert into public.games (title, slug, description, year, status, host_type, embed_html)
  values ('Embed RLS published', 'room310-v13-embed-rls-published', 'Published fixture', 2026, 'published', 'embed', '<script>document.body.textContent="ready"</script>')
  returning id into embed_id;

  insert into public.games (title, slug, description, year, status, host_type, external_url)
  values ('External RLS published', 'room310-v13-external-rls-published', 'Compatibility fixture', 2026, 'published', 'external', 'https://example.com/play')
  returning id into external_id;

  insert into public.games (title, slug, description, year, status, host_type, bundle_path)
  values ('Hosted RLS published', 'room310-v15-hosted-rls-published', 'Hosted fixture', 2026, 'published', 'hosted', '999999/game-fixture.zip')
  returning id into hosted_id;

  update public.games set embed_html = '<canvas id="edited"></canvas>' where id = embed_id;
  if (select embed_html from public.games where id = embed_id) <> '<canvas id="edited"></canvas>' then
    raise exception 'Manager embed edit failed';
  end if;
  if (select count(*) from public.games where id in (draft_id, embed_id, external_id, hosted_id) and created_by = auth.uid() and updated_by = auth.uid()) <> 4 then
    raise exception 'Manager create or audit fields failed';
  end if;

  perform set_config('room310.test_game_draft', draft_id::text, true);
  perform set_config('room310.test_game_embed', embed_id::text, true);
  perform set_config('room310.test_game_external', external_id::text, true);
  perform set_config('room310.test_game_hosted', hosted_id::text, true);
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare changed integer;
begin
  if (select count(*) from public.games where id in (
    current_setting('room310.test_game_draft')::bigint,
    current_setting('room310.test_game_embed')::bigint,
    current_setting('room310.test_game_external')::bigint,
    current_setting('room310.test_game_hosted')::bigint
  )) <> 3 then raise exception 'Anonymous draft isolation or published compatibility failed'; end if;
  if (select host_type from public.games where id = current_setting('room310.test_game_embed')::bigint) <> 'embed' then
    raise exception 'Published embedded game is not readable';
  end if;
  if (select host_type from public.games where id = current_setting('room310.test_game_hosted')::bigint) <> 'hosted' then
    raise exception 'Published hosted game is not readable';
  end if;
  begin
    update public.games set title = 'Anonymous edit' where id = current_setting('room310.test_game_embed')::bigint;
    raise exception 'Anonymous update was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('room310.test_unapproved'), true);
do $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Test requires an existing unapproved account'; end if;
  if (select count(*) from public.games where id in (
    current_setting('room310.test_game_draft')::bigint,
    current_setting('room310.test_game_embed')::bigint,
    current_setting('room310.test_game_external')::bigint,
    current_setting('room310.test_game_hosted')::bigint
  )) <> 3 then raise exception 'Unapproved account can read drafts'; end if;

  update public.games set embed_html = '<p>Unauthorized edit</p>' where id = current_setting('room310.test_game_embed')::bigint;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Unapproved account can edit games'; end if;

  begin
    insert into public.games (title, slug, description, year, host_type, embed_html)
    values ('Unauthorized embed', 'room310-v13-embed-rls-unauthorized', 'Unauthorized fixture', 2026, 'embed', '<p>bad</p>');
    raise exception 'Unapproved game insert was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('room310.test_manager'), true);
do $$
begin
  begin
    insert into public.games (title, slug, description, year, status, host_type)
    values ('Hosted without ZIP', 'room310-v15-hosted-without-zip', 'Invalid fixture', 2026, 'published', 'hosted');
    raise exception 'Hosted game published without a ZIP';
  exception when check_violation then null;
  end;
  begin
    insert into public.games (title, slug, description, year, host_type, embed_html, external_url)
    values ('Mixed sources', 'room310-v13-mixed-source-invalid', 'Invalid fixture', 2026, 'embed', '<p>game</p>', 'https://example.com');
    raise exception 'Mixed game sources were accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
select 'Embedded games RLS tests passed; all fixture records rolled back' as result;
