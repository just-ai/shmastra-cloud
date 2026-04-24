---
name: shmastra-scheduler
description: "Schedule workflows, agents and custom URLs to run on cron via the `shmastra_cloud` tools. Use whenever the user wants something to run periodically — every morning, every hour, once a week."
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

3. **Call `shmastra_cloud_create_workflow_schedule`.** Convert the user's time to a UTC cron; pass their IANA timezone so the UI can render it back in their zone.

4. **Confirm in the user's own language.** Describe the cron in natural language ("every day at 09:00 Moscow time"), mention the `label`, and tell them they can pause it or see history. Don't surface schedule ids or internal identifiers.

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

## Things that are NOT your problem

- **Auth.** The cloud injects the Authorization header at fire time; never put keys in `body` or `input_data`.
- **URL composition.** You only pass `workflow_id` — the cloud handles the rest.
- **Polling.** Fire-and-forget is built-in. The cloud keeps `workflow_status` fresh until the run reaches a terminal state.
