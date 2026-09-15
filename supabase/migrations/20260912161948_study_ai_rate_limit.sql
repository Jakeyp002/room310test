create table private.study_ai_hourly_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count smallint not null default 1 check (request_count between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id, window_started_at)
);

alter table private.study_ai_hourly_usage enable row level security;

revoke all on table private.study_ai_hourly_usage from public, anon, authenticated;

create or replace function public.consume_study_ai_request()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requester uuid := (select auth.uid());
  current_window timestamptz := date_trunc('hour', statement_timestamp());
  accepted_count smallint;
begin
  if requester is null
    or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  then
    raise insufficient_privilege using message = 'A signed-in Room310 account is required.';
  end if;

  delete from private.study_ai_hourly_usage
  where user_id = requester
    and window_started_at < current_window - interval '24 hours';

  insert into private.study_ai_hourly_usage as usage (
    user_id,
    window_started_at,
    request_count,
    updated_at
  )
  values (requester, current_window, 1, statement_timestamp())
  on conflict (user_id, window_started_at) do update
    set request_count = usage.request_count + 1,
        updated_at = statement_timestamp()
    where usage.request_count < 30
  returning request_count into accepted_count;

  if accepted_count is null then
    return -1;
  end if;

  return 30 - accepted_count;
end;
$$;

revoke all on function public.consume_study_ai_request() from public, anon, authenticated;
grant execute on function public.consume_study_ai_request() to authenticated;

comment on table private.study_ai_hourly_usage is
  'Short-lived per-user counters for Study AI cost protection. No prompts or responses are stored.';
comment on function public.consume_study_ai_request() is
  'Atomically consumes one of an authenticated user''s 30 Study AI requests in the current UTC hour.';
