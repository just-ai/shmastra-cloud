-- Schedules: user-owned cron jobs that fire Mastra workflows.
--
-- POST goes to /workflows/:id/start-async with our own pregenerated runId
-- in the query. /start-async creates the run AND awaits execution on
-- Mastra's side, returning the full result in the body. scheduler_fire
-- polls net._http_response for up to 10s to catch that body right away;
-- long workflows keep running on the sandbox after we stop listening, and
-- scheduler_poll_active_runs settles their status later via GET
-- /workflows/:id/runs/:runId.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists schedules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  label             text not null,
  workflow_id       text not null,
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
  error_message       text,
  -- `poll_url` is baked in at fire time so SQL doesn't have to compose
  -- api-prefix paths later.
  workflow_run_id     uuid,
  workflow_status     text,
  workflow_result     jsonb,
  workflow_error      text,
  -- OpenTelemetry trace id for the workflow run. Fetched via a second
  -- GET to /observability/traces?metadata={runId} once the run hits a
  -- terminal state, because /runs/:runId doesn't expose it. Capped at
  -- MAX_TRACE_ATTEMPTS (see scheduler_poll_active_runs) so runs without a
  -- trace don't poll forever.
  trace_id            text,
  trace_request_id    bigint,
  trace_attempts      int not null default 0,
  last_polled_at      timestamptz,
  poll_url            text,
  poll_request_id     bigint
);

create index if not exists schedule_runs_schedule_sent_idx
  on schedule_runs (schedule_id, sent_at desc);

create index if not exists schedule_runs_poll_idx
  on schedule_runs (schedule_id)
  where workflow_run_id is not null
    and workflow_status not in ('success','failed','canceled','bailed','tripwire');

-- ── Functions ─────────────────────────────────────────────────────────────

-- Fire a single schedule: POST /workflows/:id/start-async with our
-- pregenerated runId, then return immediately with a `pending` row.
--
-- Mastra's /start-async awaits the workflow to completion before replying,
-- which for real workloads is almost always longer than any reasonable
-- budget we could hold here — so we don't wait for the body at all.
-- pg_net's short timeout just bounds how long its worker holds the TCP
-- connection; Mastra continues executing regardless of client disconnect.
-- scheduler_poll_active_runs resolves workflow_status later via GET
-- /workflows/:id/runs/:runId.
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
  v_run_id uuid;
  v_base text;
  v_poll_url text;
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

  v_run_id := gen_random_uuid();

  if v_host is null or v_host = '' then
    insert into schedule_runs (
      schedule_id, sent_at, completed_at,
      workflow_run_id, workflow_status, workflow_error, error_message
    )
    values (
      sid, now(), now(),
      v_run_id, 'failed', 'No active sandbox for user', 'No active sandbox for user'
    );
    update schedules set last_run_at = now() where id = sid;
    return;
  end if;

  if v_host like 'http%' then
    v_base := v_host;
  else
    v_base := 'https://' || v_host;
  end if;

  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || coalesce(v_vk, ''),
    'Content-Type', 'application/json'
  );

  v_url := v_base || v_path || '?runId=' || v_run_id;
  v_poll_url := v_base || regexp_replace(v_path, '/start-async$', '')
                || '/runs/' || v_run_id;

  -- Fire-and-forget. 5s is enough to establish TCP, send the POST, and
  -- confirm delivery; beyond that we don't care about the response — the
  -- poller will settle the run.
  select net.http_post(
    url := v_url,
    body := coalesce(v_body, '{}'::jsonb),
    headers := v_headers,
    timeout_milliseconds := 5000
  ) into v_req_id;

  insert into schedule_runs (
    schedule_id, pg_net_request_id, sent_at,
    workflow_run_id, poll_url, workflow_status
  )
  values (sid, v_req_id, now(), v_run_id, v_poll_url, 'pending');

  update schedules set last_run_at = now() where id = sid;
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

-- Poll Mastra for workflow-run status. Two-pass per tick:
--   (1) Merge any pg_net responses that arrived since last tick. For each
--       merged row, poll_request_id is always cleared (even on non-200 or
--       non-terminal) so the next tick can re-dispatch.
--   (2) Dispatch a fresh GET for every non-terminal run that isn't
--       currently in flight (poll_request_id is null). That's the
--       throttle: at most one GET in flight per run, no time-based
--       cooldown. Response cadence is therefore ~= tick interval.
create or replace function scheduler_poll_active_runs()
returns void
language plpgsql
security definer
as $$
declare
  -- NB: don't name this `r` — plpgsql would then resolve `r.*` inside the
  -- merge subquery's `from net._http_response r` to this DECLAREd variable
  -- (unassigned when the dispatch loop has no rows), producing an opaque
  -- "record \"r\" is not assigned yet" error.
  dispatch_row record;
  v_vk text;
  v_headers jsonb;
  v_req_id bigint;
  v_trace_url text;
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
      -- Guard the jsonb cast: only attempt when we're sure the content
      -- looks like a JSON object. Anything else (HTML 502 from a proxy,
      -- empty bodies, plain text) stays null and leaves the row
      -- untouched but still clears poll_request_id so we can retry.
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

  -- (2) Merge landed /observability/traces responses. Mastra returns
  -- {spans:[{traceId, ...}]}; we take the first span's traceId. Always
  -- clear trace_request_id so the next tick can retry if the trace
  -- hasn't been persisted yet (race between workflow terminal and span
  -- flush).
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

  -- (4) Dispatch trace-id lookups for terminal runs that don't yet have
  -- one. /api/mastra/observability/traces returns the root span for a
  -- given runId with traceId at top level. UUID characters are URL-safe,
  -- so no escaping is needed for the interpolated runId.
  --
  -- Capped at 2 attempts: if spans haven't been persisted by the time we
  -- ask twice (~20s after terminal), it's probably never coming, and
  -- endless polling on an unreachable trace wastes pg_net workers.
  for dispatch_row in
    select sr.id as run_row_id, sr.poll_url, sr.workflow_run_id, s.user_id
    from schedule_runs sr
    join schedules s on s.id = sr.schedule_id
    where sr.workflow_run_id is not null
      and sr.workflow_status in ('success','failed','canceled','bailed','tripwire')
      and sr.trace_id is null
      and sr.trace_request_id is null
      and sr.trace_attempts < 2
      and sr.poll_url is not null
  loop
    select virtual_key into v_vk from users where id = dispatch_row.user_id;
    v_headers := jsonb_build_object(
      'Authorization', 'Bearer ' || coalesce(v_vk, '')
    );
    -- Derive the observability endpoint from poll_url by swapping the
    -- workflow-specific suffix for the shared /observability/traces path.
    v_trace_url := regexp_replace(
      dispatch_row.poll_url,
      '/workflows/[^/]+/runs/[^/]+$',
      '/observability/traces'
    ) || '?metadata=%7B%22runId%22%3A%22'
      || dispatch_row.workflow_run_id
      || '%22%7D&pagination%5BperPage%5D=1';

    select net.http_get(
      url := v_trace_url,
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
-- Idempotent: pg_cron.schedule upserts by name, and we unschedule first so
-- reruns of this migration pick up updated SQL bodies.
--
-- Also unschedule legacy names (from earlier revisions) in case they're
-- still registered on existing databases.

do $$
begin
  perform cron.unschedule('shmastra_scheduler_collect_results');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('shmastra_scheduler_collect_and_start');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('shmastra_scheduler_poll_runs');
exception when others then null;
end $$;
-- '10 seconds' is the pg_cron 1.5+ sub-minute syntax.
select cron.schedule(
  'shmastra_scheduler_poll_runs',
  '10 seconds',
  $$select scheduler_poll_active_runs()$$
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
