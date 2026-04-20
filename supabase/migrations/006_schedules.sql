-- Schedules: user-owned cron jobs that POST to their sandbox.
-- Extensions live in pg_catalog-friendly schemas on Supabase.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists schedules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  name              text,
  path              text not null,
  body              jsonb not null default '{}'::jsonb,
  cron_expression   text not null,
  timezone          text not null default 'UTC',
  cron_job_name     text not null unique,
  enabled           boolean not null default true,
  last_run_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint schedules_path_starts_with_slash check (path like '/%')
);

create index if not exists schedules_user_enabled_idx
  on schedules (user_id, enabled);

create table if not exists schedule_runs (
  id                  uuid primary key default gen_random_uuid(),
  schedule_id         uuid not null references schedules(id) on delete cascade,
  pg_net_request_id   bigint,
  sent_at             timestamptz not null default now(),
  completed_at        timestamptz,
  duration_ms         integer,
  status_code         integer,
  response_snippet    text,
  error_message       text
);

create index if not exists schedule_runs_schedule_sent_idx
  on schedule_runs (schedule_id, sent_at desc);

-- Fire a single schedule: resolve host + virtual_key from related rows,
-- POST to the sandbox, record an in-flight run. Authorization header is
-- composed here so neither the UI nor the MCP server ever handles raw vks.
create or replace function scheduler_fire(sid uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_path text;
  v_body jsonb;
  v_host text;
  v_vk text;
  v_url text;
  v_req_id bigint;
  v_headers jsonb;
begin
  select s.path, s.body, sb.sandbox_host, u.virtual_key
    into v_path, v_body, v_host, v_vk
  from schedules s
    join users u on u.id = s.user_id
    left join sandboxes sb on sb.user_id = u.id and sb.status = 'ready'
  where s.id = sid and s.enabled = true;

  if not found then
    return;
  end if;

  if v_host is null or v_host = '' then
    insert into schedule_runs (schedule_id, sent_at, completed_at, error_message)
    values (sid, now(), now(), 'No active sandbox for user');
    update schedules set last_run_at = now() where id = sid;
    return;
  end if;

  -- sandbox_host is stored with scheme in some rows and bare host in others.
  if v_host like 'http%' then
    v_url := v_host || v_path;
  else
    v_url := 'https://' || v_host || v_path;
  end if;

  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || coalesce(v_vk, ''),
    'Content-Type', 'application/json'
  );

  select net.http_post(
    url := v_url,
    body := coalesce(v_body, '{}'::jsonb),
    headers := v_headers,
    timeout_milliseconds := 30000
  ) into v_req_id;

  insert into schedule_runs (schedule_id, pg_net_request_id, sent_at)
  values (sid, v_req_id, now());

  update schedules set last_run_at = now() where id = sid;
end;
$$;

-- Upsert a cron job for the given schedule. Unschedules any existing job with
-- the same name first; if the schedule is disabled, just unschedules.
create or replace function schedule_upsert_cron(sid uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_job_name text;
  v_cron text;
  v_enabled boolean;
begin
  select cron_job_name, cron_expression, enabled
    into v_job_name, v_cron, v_enabled
  from schedules
  where id = sid;

  if not found then
    return;
  end if;

  begin
    perform cron.unschedule(v_job_name);
  exception when others then
    -- job may not exist yet
    null;
  end;

  if not v_enabled then
    return;
  end if;

  perform cron.schedule(
    v_job_name,
    v_cron,
    format('select scheduler_fire(%L::uuid)', sid)
  );
end;
$$;

-- Remove the cron job for a given schedule (no-op if it doesn't exist).
create or replace function schedule_remove_cron(sid uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_job_name text;
begin
  select cron_job_name into v_job_name from schedules where id = sid;
  if v_job_name is null then
    return;
  end if;
  begin
    perform cron.unschedule(v_job_name);
  exception when others then
    null;
  end;
end;
$$;

-- Collect pg_net responses and merge them into schedule_runs. Runs every minute.
create or replace function scheduler_collect_results()
returns void
language plpgsql
security definer
as $$
begin
  update schedule_runs sr
  set
    status_code = r.status_code,
    response_snippet = left(coalesce(r.content::text, ''), 8192),
    duration_ms = greatest(0, extract(epoch from (r.created - sr.sent_at)) * 1000)::int,
    completed_at = r.created,
    error_message = case when r.status_code is null then r.error_msg else sr.error_message end
  from net._http_response r
  where r.id = sr.pg_net_request_id
    and sr.pg_net_request_id is not null
    and sr.completed_at is null
    and r.created is not null;
end;
$$;

-- Housekeeping: prune schedule_runs older than 30 days, and poll for responses.
-- These are idempotent: pg_cron.schedule upserts by name.
do $$
begin
  perform cron.unschedule('shmastra_scheduler_collect_results');
exception when others then null;
end $$;
select cron.schedule(
  'shmastra_scheduler_collect_results',
  '* * * * *',
  $$select scheduler_collect_results()$$
);

do $$
begin
  perform cron.unschedule('shmastra_scheduler_prune_runs');
exception when others then null;
end $$;
select cron.schedule(
  'shmastra_scheduler_prune_runs',
  '0 3 * * *',
  $$delete from schedule_runs where sent_at < now() - interval '30 days'$$
);
