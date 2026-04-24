-- Schedules: user-owned cron jobs that fire Mastra workflows.
--
-- Firing is delegated to our Next.js app. pg_cron calls scheduler_trigger,
-- which reads public_url off the schedule row and POSTs to
-- <public_url>/api/schedules/internal/fire?sid=... (fire-and-forget). The
-- Next.js handler wakes the sandbox, creates a run, kicks it off via /start,
-- and inserts the schedule_runs row with status='pending'. The SQL poller
-- (scheduler_poll_active_runs, async via pg_net) takes over from there.
--
-- The sid is effectively the capability: it's a UUIDv4 (122 bits of
-- entropy) stored only in our DB and the user's UI/agent session. No
-- additional bearer token is needed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists schedules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  label             text not null,
  workflow_id       text not null,
  body              jsonb not null default '{}'::jsonb,
  cron_expression   text not null,
  timezone          text not null default 'UTC',
  cron_job_name     text not null unique,
  enabled           boolean not null default true,
  -- Snapshot of getAppUrl() at schedule creation time. scheduler_trigger
  -- uses this to POST to the fire endpoint. If the app moves domains,
  -- operator runs `update schedules set public_url = '<new>'`.
  public_url        text,
  last_run_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists schedules_user_enabled_idx
  on schedules (user_id, enabled);

create table if not exists schedule_runs (
  id                  uuid primary key default gen_random_uuid(),
  schedule_id         uuid not null references schedules(id) on delete cascade,
  sent_at             timestamptz not null default now(),
  completed_at        timestamptz,
  duration_ms         integer,
  status_code         integer,
  error_message       text,
  -- Raw HTTP response body (trimmed) from the dispatch POST. Useful when
  -- debugging 4xx/5xx from the sandbox — Mastra's error bodies often tell
  -- you exactly what went wrong.
  response_snippet    text,
  workflow_run_id     uuid,
  workflow_status     text,
  workflow_result     jsonb,
  workflow_error      text,
  -- OpenTelemetry trace id. Fetched via a second GET to `trace_url` once the
  -- run hits a terminal state. Capped at 2 attempts.
  trace_id            text,
  trace_request_id    bigint,
  trace_attempts      int not null default 0,
  -- `poll_url` and `trace_url` are baked in by the fire handler so SQL here
  -- never has to reconstruct Mastra API paths.
  poll_url            text,
  trace_url           text,
  poll_request_id     bigint,
  last_polled_at      timestamptz
);

create index if not exists schedule_runs_schedule_sent_idx
  on schedule_runs (schedule_id, sent_at desc);

create index if not exists schedule_runs_poll_idx
  on schedule_runs (schedule_id)
  where workflow_run_id is not null
    and workflow_status not in ('success','failed','canceled','bailed','tripwire');

-- ── Functions ─────────────────────────────────────────────────────────────

-- Fire one schedule: POST to the fire handler at the public_url stored on
-- the schedule row, fire-and-forget. The handler owns sandbox wake-up, run
-- creation, and DB writes.
create or replace function scheduler_trigger(sid uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_public_url text;
begin
  select public_url into v_public_url from schedules where id = sid;
  if v_public_url is null or v_public_url = '' then
    raise warning 'scheduler: public_url not set for schedule %', sid;
    return;
  end if;
  perform net.http_post(
    url := v_public_url || '/api/schedules/internal/fire?sid=' || sid::text,
    timeout_milliseconds := 3000
  );
end;
$$;

-- Upsert a pg_cron job for the given schedule. Unschedules any existing job
-- first; if the schedule is disabled, leaves it unscheduled.
create or replace function schedule_upsert_cron(sid uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_job_name text;
  v_cron     text;
  v_enabled  boolean;
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
    null;
  end;

  if not v_enabled then
    return;
  end if;

  perform cron.schedule(
    v_job_name,
    v_cron,
    format('select scheduler_trigger(%L::uuid)', sid)
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

-- Poll Mastra for workflow-run status. Three phases per tick:
--   (1) Merge landed /runs/:id poll responses, clear poll_request_id.
--   (2) Merge landed /observability/traces responses.
--   (3) Dispatch fresh GETs for non-terminal runs not in flight.
--   (4) Dispatch trace-id lookups for terminal runs without trace_id (<=2).
create or replace function scheduler_poll_active_runs()
returns void
language plpgsql
security definer
as $$
declare
  -- NB: don't name this `r` — plpgsql would then resolve `r.*` inside the
  -- merge subquery's `from net._http_response r` to this DECLAREd variable.
  dispatch_row record;
  v_vk text;
  v_headers jsonb;
  v_req_id bigint;
begin
  -- (1) Merge landed /runs/:id poll responses.
  update schedule_runs sr
  set
    workflow_status = coalesce(resp.status_text, sr.workflow_status),
    workflow_result = coalesce(resp.result_json, sr.workflow_result),
    workflow_error  = coalesce(resp.error_text, sr.workflow_error),
    poll_request_id = null,
    completed_at    = case when resp.terminal then coalesce(sr.completed_at, resp.created)
                           else sr.completed_at end
  from (
    select
      h.id as req_id,
      h.created,
      case when h.status_code = 200
             and h.content is not null
             and h.content::text ~ '^\s*\{'
           then (h.content::jsonb ->> 'status') end as status_text,
      case when h.status_code = 200
             and h.content is not null
             and h.content::text ~ '^\s*\{'
           then (h.content::jsonb -> 'result') end as result_json,
      case when h.status_code = 200
             and h.content is not null
             and h.content::text ~ '^\s*\{'
           then (h.content::jsonb ->> 'error') end as error_text,
      case when h.status_code = 200
             and h.content is not null
             and h.content::text ~ '^\s*\{'
           then (h.content::jsonb ->> 'status')
                in ('success','failed','canceled','bailed','tripwire') end as terminal
    from net._http_response h
    where h.created is not null
      and exists (
        select 1 from schedule_runs s2 where s2.poll_request_id = h.id
      )
  ) resp
  where sr.poll_request_id = resp.req_id;

  -- (2) Merge landed /observability/traces responses.
  update schedule_runs sr
  set
    trace_id         = coalesce(resp.trace_id, sr.trace_id),
    trace_request_id = null
  from (
    select
      h.id as req_id,
      case when h.status_code = 200
             and h.content is not null
             and h.content::text ~ '^\s*\{'
           then ((h.content::jsonb -> 'spans') -> 0 ->> 'traceId') end as trace_id
    from net._http_response h
    where h.created is not null
      and exists (
        select 1 from schedule_runs s2 where s2.trace_request_id = h.id
      )
  ) resp
  where sr.trace_request_id = resp.req_id;

  -- (3) Dispatch fresh workflow-status GETs for non-terminal runs.
  for dispatch_row in
    select sr.id as run_row_id, sr.poll_url, s.user_id
    from schedule_runs sr
    join schedules s on s.id = sr.schedule_id
    where sr.workflow_run_id is not null
      and sr.workflow_status not in ('success','failed','canceled','bailed','tripwire')
      and sr.poll_request_id is null
      and sr.poll_url is not null
  loop
    select virtual_key into v_vk from users where id = dispatch_row.user_id;
    v_headers := jsonb_build_object(
      'Authorization', 'Bearer ' || coalesce(v_vk, '')
    );
    select net.http_get(
      url := dispatch_row.poll_url,
      headers := v_headers,
      timeout_milliseconds := 15000
    ) into v_req_id;

    update schedule_runs
      set poll_request_id = v_req_id,
          last_polled_at = now()
      where id = dispatch_row.run_row_id;
  end loop;

  -- (4) Dispatch trace-id lookups for terminal runs that don't yet have one.
  for dispatch_row in
    select sr.id as run_row_id, sr.trace_url, s.user_id
    from schedule_runs sr
    join schedules s on s.id = sr.schedule_id
    where sr.workflow_run_id is not null
      and sr.workflow_status in ('success','failed','canceled','bailed','tripwire')
      and sr.trace_id is null
      and sr.trace_request_id is null
      and sr.trace_attempts < 2
      and sr.trace_url is not null
  loop
    select virtual_key into v_vk from users where id = dispatch_row.user_id;
    v_headers := jsonb_build_object(
      'Authorization', 'Bearer ' || coalesce(v_vk, '')
    );
    select net.http_get(
      url := dispatch_row.trace_url,
      headers := v_headers,
      timeout_milliseconds := 15000
    ) into v_req_id;

    update schedule_runs
      set trace_request_id = v_req_id,
          trace_attempts = trace_attempts + 1
      where id = dispatch_row.run_row_id;
  end loop;
end;
$$;

-- ── Cron jobs ─────────────────────────────────────────────────────────────

do $$ begin perform cron.unschedule('shmastra_scheduler_collect_results');  exception when others then null; end $$;
do $$ begin perform cron.unschedule('shmastra_scheduler_collect_and_start'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('shmastra_scheduler_poll_runs');         exception when others then null; end $$;

select cron.schedule(
  'shmastra_scheduler_poll_runs',
  '10 seconds',
  $$select scheduler_poll_active_runs()$$
);

do $$ begin perform cron.unschedule('shmastra_scheduler_prune_runs'); exception when others then null; end $$;
select cron.schedule(
  'shmastra_scheduler_prune_runs',
  '0 3 * * *',
  $$delete from schedule_runs where sent_at < now() - interval '30 days'$$
);
