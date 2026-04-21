-- Workflow-aware fire-and-forget scheduling.
--
-- `kind = 'workflow'` schedules go through Mastra's `/workflows/:id/start-async`
-- with a pregenerated runId. scheduler_fire records the runId immediately;
-- scheduler_poll_active_runs later polls GET /workflows/:id/runs/:runId until the
-- run reaches a terminal status. The full poll URL is baked into schedule_runs
-- at fire time so SQL never has to compose api-prefix paths itself.

alter table schedules
  add column if not exists kind text not null default 'raw',
  add column if not exists workflow_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_kind_check'
  ) then
    alter table schedules
      add constraint schedules_kind_check check (kind in ('raw','workflow'));
  end if;
end $$;

alter table schedule_runs
  add column if not exists workflow_run_id uuid,
  add column if not exists workflow_status text,
  add column if not exists workflow_result jsonb,
  add column if not exists workflow_error text,
  add column if not exists last_polled_at timestamptz,
  add column if not exists poll_url text,
  add column if not exists poll_request_id bigint;

create index if not exists schedule_runs_poll_idx
  on schedule_runs (schedule_id)
  where workflow_run_id is not null
    and workflow_status is distinct from 'success'
    and workflow_status is distinct from 'failed'
    and workflow_status is distinct from 'terminated';

-- Replace scheduler_fire: adds workflow-kind branch that pregenerates runId and
-- stores the full poll URL. Non-workflow schedules behave exactly as before.
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
  v_kind text;
  v_workflow_id text;
  v_run_id uuid;
  v_base text;
  v_poll_url text;
begin
  select s.path, s.body, s.kind, s.workflow_id, sb.sandbox_host, u.virtual_key
    into v_path, v_body, v_kind, v_workflow_id, v_host, v_vk
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

  if v_host like 'http%' then
    v_base := v_host;
  else
    v_base := 'https://' || v_host;
  end if;

  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || coalesce(v_vk, ''),
    'Content-Type', 'application/json'
  );

  if v_kind = 'workflow' then
    v_run_id := gen_random_uuid();
    -- start-async?runId=<uuid> — atomic createRun + start inside the handler.
    v_url := v_base || v_path || '?runId=' || v_run_id;
    -- Poll endpoint sits on the same api prefix as the start path; derive it by
    -- dropping the trailing '/start-async' segment and appending /runs/<id>.
    v_poll_url := v_base || regexp_replace(v_path, '/start-async$', '')
                  || '/runs/' || v_run_id;

    select net.http_post(
      url := v_url,
      body := coalesce(v_body, '{}'::jsonb),
      headers := v_headers,
      timeout_milliseconds := 30000
    ) into v_req_id;

    insert into schedule_runs (
      schedule_id, pg_net_request_id, sent_at,
      workflow_run_id, workflow_status, poll_url
    )
    values (sid, v_req_id, now(), v_run_id, 'pending', v_poll_url);
  else
    v_url := v_base || v_path;
    select net.http_post(
      url := v_url,
      body := coalesce(v_body, '{}'::jsonb),
      headers := v_headers,
      timeout_milliseconds := 30000
    ) into v_req_id;

    insert into schedule_runs (schedule_id, pg_net_request_id, sent_at)
    values (sid, v_req_id, now());
  end if;

  update schedules set last_run_at = now() where id = sid;
end;
$$;

-- Poll Mastra for workflow-run status. Two-pass: (1) issue GET for runs whose
-- status is still in-flight and haven't been polled in the last 30s; (2) merge
-- any responses that have arrived via pg_net.
create or replace function scheduler_poll_active_runs()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  v_vk text;
  v_headers jsonb;
  v_req_id bigint;
begin
  -- (1) Dispatch new GETs for pending runs.
  for r in
    select sr.id as run_row_id, sr.poll_url, s.user_id
    from schedule_runs sr
    join schedules s on s.id = sr.schedule_id
    where sr.workflow_run_id is not null
      and sr.workflow_status is distinct from 'success'
      and sr.workflow_status is distinct from 'failed'
      and sr.workflow_status is distinct from 'terminated'
      and (sr.last_polled_at is null or sr.last_polled_at < now() - interval '30 seconds')
      and sr.poll_request_id is null
      and sr.poll_url is not null
  loop
    select virtual_key into v_vk from users where id = r.user_id;
    v_headers := jsonb_build_object(
      'Authorization', 'Bearer ' || coalesce(v_vk, '')
    );
    select net.http_get(
      url := r.poll_url,
      headers := v_headers,
      timeout_milliseconds := 15000
    ) into v_req_id;

    update schedule_runs
      set poll_request_id = v_req_id,
          last_polled_at = now()
      where id = r.run_row_id;
  end loop;

  -- (2) Merge any responses that have landed.
  update schedule_runs sr
  set
    workflow_status = coalesce(resp.status_text, sr.workflow_status),
    workflow_result = coalesce(resp.result_json, sr.workflow_result),
    workflow_error  = coalesce(resp.error_text, sr.workflow_error),
    poll_request_id = case when resp.terminal then null else sr.poll_request_id end,
    completed_at    = case when resp.terminal then coalesce(sr.completed_at, resp.created)
                           else sr.completed_at end
  from (
    select
      r.id as req_id,
      r.created,
      (r.content::jsonb ->> 'status') as status_text,
      (r.content::jsonb -> 'result')  as result_json,
      (r.content::jsonb ->> 'error')  as error_text,
      (r.content::jsonb ->> 'status') in ('success','failed','terminated') as terminal
    from net._http_response r
    where r.status_code = 200
      and r.content is not null
  ) resp
  where sr.poll_request_id = resp.req_id;
end;
$$;

-- Register poller (every minute, idempotent).
do $$
begin
  perform cron.unschedule('shmastra_scheduler_poll_runs');
exception when others then null;
end $$;
select cron.schedule(
  'shmastra_scheduler_poll_runs',
  '* * * * *',
  $$select scheduler_poll_active_runs()$$
);
