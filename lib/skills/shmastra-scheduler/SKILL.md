---
name: shmastra-scheduler
description: "Schedule Mastra workflows to run on cron via the `shmastra-cloud` MCP tools. Use whenever the user wants something to run periodically — every morning, every hour, once a week. Covers the rule that only workflows are scheduled (never agents or raw endpoints), how to wrap an agent or an HTTP call in a minimal workflow using `createAgentStep`, and how to use the scheduler tools (`create_workflow_schedule`, `list_schedules`, `list_runs`, `update_schedule`, `delete_schedule`, `get_schedule`)."
---

# Scheduling workflows on cron

## The one rule

**Only workflows get scheduled.** There is no "schedule this agent" or "schedule this webhook". If the user wants to run anything on cron, the target must first exist as a Mastra workflow. Wrap any agent call, HTTP call, or custom logic in a workflow.

Rationale: workflows give a run id, a pollable status, typed input/output, retry/telemetry hooks — everything needed for reliable scheduled execution. Raw agent/endpoint calls don't.

## When the user asks for a schedule

1. **Identify what they want to run.**
   - Existing agent (`"every morning have the support agent summarize new tickets"`) → wrap in workflow.
   - HTTP call — either a custom route registered in `src/mastra/routes.ts` or an external URL (`"ping our health endpoint every 5 minutes"`) → wrap in workflow.
   - Existing workflow → just schedule it.

2. **Make sure the workflow exists.** If not, create one (see "Wrapping patterns" below). The workflow's id becomes the schedule's `workflow_id`.

3. **Call `create_workflow_schedule`** with `workflow_id`, `cron_expression`, and any `input_data`.

4. **Confirm success to the user.** Reply in the user's own language. Describe the cron expression in natural language ("every day at 09:00 Moscow time"), mention the schedule's `name`, and tell them they can pause it with "pause the X schedule" or see history with "show runs of X". Don't surface the schedule id or internal identifiers.

## Wrapping patterns

### Wrapping an agent — use `createAgentStep`

Don't hand-roll a step that calls `agent.generate(...)`: if the agent has observable memory, generate without a thread fails. Use the `createAgentStep` helper that Shmastra exposes — it attaches a fresh thread/resource per run and disables observational memory, which is the correct behaviour for a scheduled one-shot.

```ts
// src/mastra/workflows/daily-summary.ts
import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { createAgentStep } from "../shmastra";
import { supportAgent } from "../agents/support";

const step = createAgentStep(supportAgent, {
  inputSchema: z.object({ since: z.string().optional() }),
});

export const dailySummaryWorkflow = createWorkflow({
  id: "dailySummary",
  inputSchema: step.inputSchema,
  outputSchema: step.outputSchema,
})
  .then(step)
  .commit();
```

Register the workflow on the `mastra` instance (follow the **mastra** skill for the exact registration pattern — APIs shift between versions).

### Wrapping an HTTP call (local custom route or external URL)

Both cases are the same: wrap a `fetch` in a step. A "local custom route" means something the user registered in `src/mastra/routes.ts` that's reachable from inside the sandbox at `http://localhost:4111/...`; an "external URL" is any other host the user wants to hit. Pass the URL as `inputData` so one workflow can be reused for many targets.

```ts
// src/mastra/workflows/ping.ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

const call = createStep({
  id: "call",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ status: z.number(), body: z.string() }),
  execute: async ({ inputData }) => {
    const res = await fetch(inputData.url, { method: "GET" });
    return { status: res.status, body: (await res.text()).slice(0, 2048) };
  },
});

export const pingWorkflow = createWorkflow({
  id: "ping",
  inputSchema: call.inputSchema,
  outputSchema: call.outputSchema,
})
  .then(call)
  .commit();
```

For anything more complex (multi-step, conditional, parallel), read the **mastra** skill first — don't guess workflow APIs.

## MCP tool reference (`shmastra-cloud` server)

### `create_workflow_schedule`

```json
{
  "workflow_id": "dailySummary",
  "input_data": { "since": "2026-04-20T00:00:00Z" },
  "cron_expression": "0 6 * * *",
  "timezone": "Europe/Moscow",
  "name": "Daily support summary"
}
```

- `workflow_id` — must match the id registered in `mastra` (not a filename). Characters: `A-Z a-z 0-9 _ . -`.
- `input_data` — any JSON-serialisable value. Becomes `inputData` in the workflow.
- `cron_expression` — 5- or 6-field cron, **evaluated in UTC**. The user's current time and timezone are already available to you in context — convert their request to a UTC cron yourself. Examples: `"0 6 * * *"` = 06:00 UTC every day; `"*/15 * * * *"` = every 15 min.
- `timezone` — IANA zone, informational; use the user's zone from your context so the UI can display the schedule correctly.
- `name` — display label. Always set one so the user can refer to the schedule later by name.
- `enabled` — defaults `true`. Pass `false` to create paused.

### `list_schedules`

No arguments. Returns all schedules for this user, newest first. Each row has `id`, `name`, `workflow_id`, `cron_expression`, `timezone`, `enabled`, `last_run_at`.

### `get_schedule({ id })`

Fetch a single schedule.

### `update_schedule({ id, ...patch })`

Patch any of `cron_expression`, `timezone`, `name`, `enabled`, `body`. To pause: `{ id, enabled: false }`. To resume: `{ id, enabled: true }`.

### `delete_schedule({ id })`

Removes the schedule and stops its cron job.

### `list_runs({ schedule_id, limit? })`

Recent executions, newest first. Each run has:

- `workflow_run_id` — the Mastra run id (stable across polls).
- `workflow_status` — `pending` → `running` → `success` / `failed` / `terminated`. `pending` means the kick-off happened; the status settles within ~1 min.
- `workflow_result` — the workflow's output (on success).
- `workflow_error` — error text (on failure).
- `sent_at`, `duration_ms`, `last_polled_at` — timing.

## Common tasks

### "Run my agent every morning at 9"

1. Pick the agent (list them if ambiguous).
2. If a wrapping workflow doesn't exist, create one with `createAgentStep` as shown above and register it.
3. Convert `09:00` in the user's timezone (available to you in context) to a UTC cron expression.
4. Call `create_workflow_schedule` with a descriptive `name`.
5. Confirm in the user's language.

### "Show me what's scheduled"

Call `list_schedules`. Render as a table with `name`, cron in natural language, next run in the user's timezone, enabled/paused.

### "Pause that daily job"

Find it via `list_schedules` by name, call `update_schedule({ id, enabled: false })`.

### "Why didn't my schedule run last night?"

Call `list_runs({ schedule_id })`. Look at the most recent rows:

- No row where one was expected → the sandbox was paused at that moment, or `cron_expression` was wrong.
- `workflow_status: "pending"` older than a few minutes → status hasn't settled yet, or the workflow is genuinely long-running.
- `workflow_status: "failed"` → show `workflow_error`.
- `error_message` set before any HTTP call → the user had no active sandbox at tick time.

## Things that are NOT your problem

- **Auth.** The cloud injects the Authorization header at fire time; never put keys in `body` or `input_data`.
- **URL composition.** You only pass `workflow_id` — the cloud handles the rest.
- **Timezone conversion for pg_cron.** Cron runs in UTC; you convert once when creating the schedule, using the user's timezone from your context.
- **Polling.** Fire-and-forget is built-in. You don't have to poll `list_runs` yourself — the cloud keeps `workflow_status` fresh until the run reaches a terminal state.
