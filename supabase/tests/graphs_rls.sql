-- Run as the database owner. All fixture rows are rolled back; existing records are untouched.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where approved and role = 'admin' limit 1), true);
select set_config('room310.test_manager', current_setting('request.jwt.claim.sub'), true);
select set_config('room310.test_unapproved', (select id::text from public.profiles where not approved limit 1), true);
set local role authenticated;
do $$
declare draft_id bigint; published_id bigint;
begin
  if auth.uid() is null then raise exception 'Test requires an existing approved administrator'; end if;
  insert into public.graphs (title,slug,year,desmos_url) values ('RLS test draft','room310-v08-rls-test-draft',2026,'https://www.desmos.com/calculator/fmxds1uvhe') returning id into draft_id;
  insert into public.graphs (title,slug,year,desmos_url) values ('RLS test published','room310-v08-rls-test-published',2026,'https://www.desmos.com/calculator/fmxds1uvhe') returning id into published_id;
  update public.graphs set thumbnail_path = id || '/test.png' where id in (draft_id,published_id);
  update public.graphs set status = 'published' where id = published_id;
  insert into storage.objects (bucket_id,name) values ('graph-thumbnails',draft_id || '/test.png'),('graph-thumbnails',published_id || '/test.png');
  perform set_config('room310.test_draft',draft_id::text,true);
  perform set_config('room310.test_published',published_id::text,true);
  if (select count(*) from public.graphs where id in (draft_id,published_id) and created_by = auth.uid() and updated_by = auth.uid()) <> 2 then raise exception 'Manager create/audit failed'; end if;
  if (select count(*) from storage.objects where bucket_id='graph-thumbnails' and name in (draft_id || '/test.png',published_id || '/test.png')) <> 2 then raise exception 'Manager storage access failed'; end if;
  begin
    insert into public.graphs (title,slug,year,desmos_url,status) values ('No cover','room310-v08-rls-no-cover',2026,'https://www.desmos.com/calculator/fmxds1uvhe','published');
    raise exception 'Published graph without cover was accepted';
  exception when check_violation then null;
  end;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  if (select count(*) from public.graphs where id in (current_setting('room310.test_draft')::bigint,current_setting('room310.test_published')::bigint)) <> 1 then raise exception 'Anonymous draft isolation failed'; end if;
  if (select count(*) from storage.objects where bucket_id='graph-thumbnails' and name in (current_setting('room310.test_draft') || '/test.png',current_setting('room310.test_published') || '/test.png')) <> 1 then raise exception 'Anonymous cover isolation failed'; end if;
  begin
    delete from public.graphs where id = current_setting('room310.test_published')::bigint;
    raise exception 'Anonymous write was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('room310.test_unapproved'),true);
do $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Test requires an existing unapproved account'; end if;
  if (select count(*) from public.graphs where id in (current_setting('room310.test_draft')::bigint,current_setting('room310.test_published')::bigint)) <> 1 then raise exception 'Unapproved account can read drafts'; end if;
  update public.graphs set title = 'Unauthorized change' where id = current_setting('room310.test_published')::bigint;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Unapproved account can edit graphs'; end if;
  delete from public.graphs where id = current_setting('room310.test_published')::bigint;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Unapproved account can delete graphs'; end if;
  begin
    insert into public.graphs (title,slug,year,desmos_url) values ('Unauthorized','room310-v08-rls-unapproved',2026,'https://www.desmos.com/calculator/fmxds1uvhe');
    raise exception 'Unapproved graph insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id,name) values ('graph-thumbnails','0/unauthorized.png');
    raise exception 'Unapproved thumbnail upload was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub',current_setting('room310.test_manager'),true);
do $$
declare changed integer;
begin
  update public.graphs set status='draft' where id=current_setting('room310.test_published')::bigint;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Manager unpublish failed'; end if;
  delete from public.graphs where id=current_setting('room310.test_draft')::bigint;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Manager delete failed'; end if;
end $$;
rollback;
select 'Graphs RLS tests passed; all fixture records rolled back' as result;
