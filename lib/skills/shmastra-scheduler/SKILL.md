---
name: shmastra-scheduler
description: "How to schedule workflows, agents and custom URLs to run on cron. Read this skill before creating schedule whenever the user wants something to run periodically or poll some API."
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

3. **Create the schedule** (see "Creating a schedule" below).

4. **Confirm in the user's own language.** Describe the cron in natural language ("every day at 09:00 Moscow time"), mention the `label`, and tell them they can pause it or see history. Don't surface schedule ids or internal identifiers.

## Creating a schedule

Call `shmastra_cloud_create_workflow_schedule` with:

- **`workflow_id`** — the id the workflow is registered with on the `mastra` instance. Must match `/^[A-Za-z0-9_.-]+$/`.
- **`cron_expression`** — 5- or 6-field cron, **UTC**. Convert the user's local time to UTC once, at creation time.
- **`timezone`** — the user's IANA zone (e.g. `"Europe/Moscow"`). Stored for display only; does *not* affect firing.
- **`label`** — 2–5 words in the user's language; how they recognize and reference the schedule later. Required.
- **`input_data`** — object matching the workflow's `inputSchema` (see "input_data" below). Required.
- **`resource_id`** — optional; rarely needed.
- **`enabled`** — optional, defaults `true`.

Example: schedule the `dailySummary` workflow every weekday at 09:00 Moscow time for a user in `Europe/Moscow`:

```json
{
  "workflow_id": "dailySummary",
  "cron_expression": "0 6 * * 1-5",
  "timezone": "Europe/Moscow",
  "label": "Weekday morning digest",
  "input_data": { "since": "yesterday" }
}
```

Note `0 6` UTC = `09:00` Moscow (UTC+3).

## input_data

**`input_data` is an object, never a bare string/number/array.** It's passed verbatim to the workflow as `inputData`.

**The server validates `input_data` against the workflow's `inputSchema` before creating or updating the schedule.** If it doesn't match, the tool call fails with an error that lists every violation and prints the expected schema. Read the error, fix `input_data`, and call the tool again — this is a retryable, user-visible signal, not a system failure. Don't invent or hallucinate the fix: the error body contains the exact schema you need to satisfy.

Before scheduling, read the workflow's `inputSchema` in the source to map the user's intent into the right keys. If the user already supplied concrete values ("summarize tickets since yesterday"), put them under the schema's property names. If the schema is empty / all-optional, pass `{}`.

Examples of `input_data` for different workflows:

- `z.object({ url: z.string().url() })` → `{ "url": "https://example.com/health" }`
- `z.object({})` (no input) → `{}`
- `z.object({ since: z.string().optional() })` → `{}` (uses default) or `{ "since": "1d" }`

If the user wants *one* workflow to run on many targets (e.g. pinging several URLs on different crons), create *multiple* schedules with different `input_data` — don't invent a list field in the workflow.

Updating `input_data` later: call `shmastra_cloud_update_schedule` with the new object; it replaces `inputData` entirely (no merge) and is re-validated against the workflow's current schema.

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

## Conventions

- **Cron is UTC.** Convert the user's time to UTC once, at schedule creation. Always pass their IANA `timezone` so the UI can display it back in the user's zone.
- **`label` is how humans find it.** 2–5 words in the user's language. To resolve references like "pause the daily digest", call `shmastra_cloud_list_schedules` and match on `label` or `workflow_id`.
- **Status flow.** `pending` → `running` → terminal (`success`, `failed`, `canceled`, `bailed`, `tripwire`). `pending` on a just-fired run usually settles within ~1 min.
- **Use `shmastra_cloud_list_runs` for history.** It returns trimmed summaries. Only call `shmastra_cloud_get_run` when you need the full `workflow_result` or raw response body to diagnose a failure — payloads can be large.

## Diagnosing failed runs

When `list_runs` shows `workflow_status: "failed"`, the `workflow_error` field is shaped to tell you exactly what to do:

- **Starts with `The scheduled input_data no longer matches …`** — the workflow's `inputSchema` was changed after this schedule was created. The message lists every mismatch and embeds the new schema. Call `shmastra_cloud_update_schedule({ id, input_data: <corrected> })`. **Do not create a new schedule** — the existing one is still wired correctly, only its stored input drifted.
- **Starts with `Workflow "…" was registered when this schedule was created but isn't anymore`** — the target workflow was removed, renamed, or un-exported from `src/mastra`. Either restore it or call `shmastra_cloud_delete_schedule({ id })`.
- **Any other `workflow_error`** — show it to the user. If the user asks for more detail, call `shmastra_cloud_get_run({ id })` for the full `workflow_result` / `response_snippet`.

All of these are retryable through the tools — they are not system failures and don't need to be reported to the user as "the scheduler is broken".

## Things that are NOT your problem

- **Auth.** The cloud injects the Authorization header at fire time; never put keys in `body` or `input_data`.
- **URL composition.** You only pass `workflow_id` — the cloud handles the rest.
- **Polling.** Fire-and-forget is built-in. The cloud keeps `workflow_status` fresh until the run reaches a terminal state.
