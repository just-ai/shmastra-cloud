---
name: shmastra-scheduler
description: "How to schedule workflows, agents and custom logic or HTTP API calls to run on cron. Read this skill for ANY user interaction related to scheduling, cron, or periodic execution including: creating a new schedule, viewing, listing, pausing, editing, or deleting existing schedules"
---

# Scheduling on cron

## The one rule

**Only workflows get scheduled.** 
Wrap any agent call, HTTP call, or custom logic in a Mastra workflow first; its id becomes the schedule's `workflow_id`.

## Wrapping an agent — use `createAgentStep`

Don't hand-roll `createStep({ execute: () => agent.generate(...) })`. 
If the agent has observable memory, `generate` without a `thread` fails. 
Use the helper Shmastra exposes — it attaches a fresh thread/resource per run and disables observational memory, which is the correct shape for a scheduled one-shot.

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

Register the workflow on the `mastra` instance — follow the **mastra** skill for the current registration API.

## Wrapping an HTTP call (local custom route or external URL)

Same pattern either way — wrap `fetch` in a step and pass the target URL through `inputData` so one workflow can serve many schedules. 
A "local custom route" is a Hono route the user registered in `src/mastra/routes.ts`.

```ts
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
}).then(call).commit();
```

For multi-step / conditional / parallel workflows, read the **mastra** skill first.

## Gotchas

- **Cron is UTC.** Convert the user's local time once, at creation. Pass their IANA `timezone` so the UI can display it back correctly.
- **`input_data` is an object**, never a bare string/array/number. Match the workflow's `inputSchema`. If the schema is all-optional, `{}` is fine.
- **Use `label` (user's language) to refer to schedules**, not ids. When the user says "pause the daily digest", match on `label` via `list_schedules`.
- **Failure messages are self-contained.** If a tool call or a run fails, the error text tells you which tool to call next with which args — follow it. Don't invent remedies; don't create a new schedule when the error says "update".

Auth, URL composition, and polling are handled by the cloud — you only pass `workflow_id` + `input_data`.

## Apply code changes before scheduling

`create_workflow_schedule` / `update_schedule` validate `input_data` against the workflow's `inputSchema` fetched from the **running** Mastra server. 
If you just edited workflow code, the server still has the old schema — your schedule call will validate against it.

`apply_changes` is asynchronous: it returns immediately, but the actual restart happens only after you end the current turn. 
Calling a schedule tool in the same turn after `apply_changes` will hit the old server.

**Right flow:**

1. Edit the workflow code.
2. Call `apply_changes` with `notify: true` — this queues the restart and asks the runtime to re-invoke you once it's done.
3. **End the turn.** Tell the user the changes are being applied and that you'll create the schedule once the server is back.
4. When you're re-invoked with the apply-completed notification, call `create_workflow_schedule` / `update_schedule`.

If you skip apply (or try to schedule before the next turn), validation runs against the old schema and either fails or — worse — silently passes against the stale shape.
