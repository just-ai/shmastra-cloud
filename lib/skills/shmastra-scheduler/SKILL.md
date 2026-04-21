---
name: shmastra-scheduler
description: "Schedule Mastra workflows to run on cron via Shmastra Cloud's MCP tools. Use whenever the user wants something to run periodically — a daily agent, an hourly webhook, a nightly report. Covers the strict rule that schedules ONLY run workflows (not agents or raw endpoints directly), how to wrap an existing agent or a webhook in a minimal workflow, and how to call the `shmastra-scheduler` MCP tools (create_workflow_schedule, list_schedules, list_runs, update_schedule, delete_schedule)."
---

# Scheduling workflows on cron

Shmastra Cloud gives this sandbox a set of MCP tools under the `shmastra-scheduler` server that manage cron schedules. Schedules are fired by Supabase `pg_cron` and hit this sandbox over HTTPS — no daemon is needed inside the sandbox.

## The one rule

**Only workflows get scheduled.** There is no "schedule this agent" or "schedule this webhook". If the user wants to run anything on cron, the target must first exist as a Mastra workflow that takes a single `inputData` object and produces a result. Wrap any agent call, fetch call, or custom logic in a workflow step.

Rationale: workflows give us a run id, a pollable status, typed input/output, retry/telemetry hooks — everything needed for a reliable fire-and-forget scheduler. Raw agent/webhook calls don't.

## When the user asks for a schedule

1. **Identify what they actually want to run.** Three cases in order of frequency:
   - An existing agent (`"every morning have the support agent summarize new tickets"`) → wrap in workflow.
   - An external webhook or API call (`"ping our health endpoint every 5 minutes"`) → wrap in workflow.
   - An existing workflow → just schedule it.

2. **Make sure a workflow exists.** If not, create one (see "Wrapping patterns" below). The workflow's id becomes the schedule's `workflow_id`.

3. **Call `create_workflow_schedule`** with `workflow_id`, `cron_expression`, `timezone`, and any `input_data`.

4. **Confirm success.** Show the user the schedule id, the cron expression in plain English, and how to see runs.

## Wrapping patterns

### Wrapping an agent

```ts
// src/mastra/workflows/daily-summary.ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { mastra } from "../index"; // or wherever you export mastra

const runAgent = createStep({
  id: "run-support-summary",
  inputSchema: z.object({
    since: z.string().describe("ISO timestamp — only consider tickets after this"),
  }).optional(),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData }) => {
    const agent = mastra.getAgent("supportAgent");
    const res = await agent.generate([
      { role: "user", content: `Summarize new support tickets since ${inputData?.since ?? "yesterday"}.` },
    ]);
    return { text: res.text };
  },
});

export const dailySummaryWorkflow = createWorkflow({
  id: "dailySummary",
  inputSchema: runAgent.inputSchema,
  outputSchema: runAgent.outputSchema,
})
  .then(runAgent)
  .commit();
```

Register the workflow on the `mastra` instance so it shows up at `/api/mastra/workflows/dailySummary/...`. Always verify the exact registration pattern against the **mastra** skill — APIs shift between versions.

### Wrapping a webhook / external call

```ts
// src/mastra/workflows/ping-health.ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

const callEndpoint = createStep({
  id: "call-endpoint",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ status: z.number(), body: z.string() }),
  execute: async ({ inputData }) => {
    const res = await fetch(inputData.url, { method: "GET" });
    return { status: res.status, body: (await res.text()).slice(0, 2048) };
  },
});

export const pingHealthWorkflow = createWorkflow({
  id: "pingHealth",
  inputSchema: callEndpoint.inputSchema,
  outputSchema: callEndpoint.outputSchema,
})
  .then(callEndpoint)
  .commit();
```

For anything more complex (multi-step, conditional, parallel), read the **mastra** skill first — don't guess workflow APIs.

## MCP tool reference (`shmastra-scheduler`)

### `create_workflow_schedule` — primary tool

Use this 95% of the time.

```json
{
  "workflow_id": "dailySummary",
  "input_data": { "since": "2026-04-20T00:00:00Z" },
  "cron_expression": "0 9 * * *",
  "timezone": "Europe/Moscow",
  "name": "Daily support summary"
}
```

- `workflow_id` — must match the id registered in `mastra` (not a filename). Characters: `A-Z a-z 0-9 _ . -`.
- `input_data` — any JSON-serializable value. Becomes `inputData` in the workflow.
- `cron_expression` — 5- or 6-field cron, **evaluated in UTC**. Convert user times before passing. Examples: `"0 9 * * *"` = 09:00 UTC every day; `"*/15 * * * *"` = every 15 min.
- `timezone` — IANA zone; informational only for now (cloud logs it so the UI can display it). If the user mentioned a local time, ask them for their zone OR default to `"UTC"` and note that in your reply.
- `name` — optional display label.
- `enabled` — defaults `true`. Pass `false` to create paused.

Returns the created schedule row (has `id`, `kind: "workflow"`, etc.).

### `create_schedule` — escape hatch

Generic POST-to-path scheduler. **Don't use this for workflows.** Only use when the user explicitly needs to hit a non-workflow endpoint (a custom Hono route they added, a third-party webhook, etc.). Prefer wrapping that endpoint in a workflow and using `create_workflow_schedule`.

### `list_schedules`

No arguments. Returns all schedules for this user, newest first. Each row has `id`, `name`, `kind`, `workflow_id`, `cron_expression`, `timezone`, `enabled`, `last_run_at`.

### `get_schedule({ id })`

Fetch a single schedule.

### `update_schedule({ id, ...patch })`

Patch any of `cron_expression`, `timezone`, `name`, `enabled`, `body`. To pause: `{ id, enabled: false }`. To resume: `{ id, enabled: true }`.

### `delete_schedule({ id })`

Removes the schedule and its cron job.

### `list_runs({ schedule_id, limit? })`

Recent executions, newest first. For workflow schedules each row has:
- `workflow_run_id` — the Mastra run id (stable across polls).
- `workflow_status` — `pending` → `running` → `success` / `failed` / `terminated`. `pending` means the HTTP kick-off happened; the poller will transition it within ~1 min.
- `workflow_result` — the workflow's output (only present on success).
- `workflow_error` — error text (only on failure).
- `sent_at`, `duration_ms`, `last_polled_at` — timing.

## Common tasks

### "Run my agent every morning at 9"

1. Ask the user for their timezone if not implied.
2. Confirm which agent (list them if ambiguous).
3. Check if a wrapping workflow exists; if not, create one using the pattern above and register it.
4. Convert `09:00 <tz>` → UTC cron.
5. Call `create_workflow_schedule`.

### "Show me what's scheduled"

Call `list_schedules`. Render as a table with `name`, cron in plain English, next run, enabled/paused.

### "Pause that daily job"

Find it via `list_schedules`, call `update_schedule({ id, enabled: false })`.

### "Why didn't my schedule run last night?"

Call `list_runs({ schedule_id })`. Look at the most recent rows:
- No row where one was expected → cron didn't fire (sandbox was paused at the time, or cron_expression was wrong).
- `workflow_status: "pending"` older than a few minutes → poller hasn't caught up; or the workflow is genuinely long-running.
- `workflow_status: "failed"` → show `workflow_error`.
- `error_message` set before any HTTP call → user had no active sandbox at tick time.

## Things that are NOT your problem

- **Auth.** The cloud injects `Authorization: Bearer <virtualKey>` at fire time; never put keys in `body` or `input_data`.
- **URL composition.** Never pass a full URL — the cloud composes `/api/mastra/workflows/<id>/start-async` from `workflow_id`.
- **Timezone conversion for pg_cron.** Cron runs in UTC; you convert once when creating the schedule. The `timezone` field is metadata.
- **Polling.** Fire-and-forget is built-in. You don't have to call `list_runs` in a loop — the cloud polls Mastra until the run reaches a terminal state.
