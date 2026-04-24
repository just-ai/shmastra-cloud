---
name: shmastra-scheduler
description: "Read this before scheduling anything on cron. Explains the one rule (only workflows are scheduled) and how to wrap an agent or an HTTP call into a minimal workflow."
---

# Scheduling on cron

## The one rule

**Only workflows get scheduled.** There is no "schedule this agent" or "schedule this webhook". Wrap any agent call, HTTP call, or custom logic in a Mastra workflow first; its id becomes the schedule's `workflow_id`.

## Wrapping an agent — use `createAgentStep`

Don't hand-roll `createStep({ execute: () => agent.generate(...) })`. If the agent has observable memory, `generate` without a `thread` fails. Use the helper Shmastra exposes — it attaches a fresh thread/resource per run and disables observational memory, which is the correct shape for a scheduled one-shot.

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

Same pattern either way — wrap `fetch` in a step and pass the target URL through `inputData` so one workflow can serve many schedules. A "local custom route" is a Hono route the user registered in `src/mastra/routes.ts` at `http://localhost:4111/...`; an "external URL" is any other host.

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
