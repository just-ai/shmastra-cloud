import { MastraClient, MastraClientError } from "@mastra/client-js";
import { db } from "./db";
import { connectToSandbox } from "./sandbox";
import { MASTRA_API_PREFIX } from "./mastra-constants";
import { RESPONSE_SNIPPET_MAX } from "./schedule-trim";
import { ScheduleValidationError } from "./schedule-errors";
import { validateWorkflowInputWithClient } from "./workflow-schema";

// Fire path orchestration in one place. Called directly by the WorkOS-auth'd
// manual-fire route and by the pg_cron-triggered /api/schedules/internal/fire
// route. Wakes the sandbox, creates a Mastra run, kicks it off, records the
// schedule_runs row. Poller takes it from there.

const FIRE_TIMEOUT_MS = 30_000;

type ScheduleRow = {
  id: string;
  user_id: string;
  workflow_id: string;
  body: Record<string, unknown> | null;
  enabled: boolean;
};

type FailureReason = {
  error: string;
  snippet?: string | null;
  statusCode?: number | null;
};

export type FireOutcome =
  | { kind: "disabled-or-missing" }
  | { kind: "no-sandbox" }
  | { kind: "wake-failed"; error: string }
  | { kind: "validation-failed"; error: string }
  | { kind: "create-run-failed"; error: string }
  | { kind: "start-failed"; error: string; runId: string }
  | { kind: "started"; runId: string };

async function recordRun(
  scheduleId: string,
  runId: string | null,
  pollUrl: string | null,
  traceUrl: string | null,
  durationMs: number,
  statusCode: number | null,
  snippet: string | null,
  failure: FailureReason | null,
) {
  const now = new Date().toISOString();
  const terminal = failure !== null;
  await db()
    .from("schedule_runs")
    .insert({
      schedule_id: scheduleId,
      workflow_run_id: runId,
      poll_url: pollUrl,
      trace_url: traceUrl,
      sent_at: now,
      completed_at: terminal ? now : null,
      duration_ms: durationMs,
      status_code: statusCode,
      error_message: failure?.error ?? null,
      response_snippet: snippet,
      workflow_status: terminal ? "failed" : "pending",
      workflow_error: terminal ? (failure?.error ?? null) : null,
    });
  await db()
    .from("schedules")
    .update({ last_run_at: now })
    .eq("id", scheduleId);
}

function trimSnippet(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > RESPONSE_SNIPPET_MAX ? text.slice(0, RESPONSE_SNIPPET_MAX) : text;
}

function failureFromError(err: unknown): {
  message: string;
  statusCode: number | null;
  snippet: string | null;
} {
  if (err instanceof MastraClientError) {
    const body =
      typeof err.body === "string"
        ? err.body
        : err.body !== undefined
          ? JSON.stringify(err.body)
          : null;
    return {
      message: `${err.status} ${err.statusText}`,
      statusCode: err.status,
      snippet: trimSnippet(body),
    };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    statusCode: null,
    snippet: null,
  };
}

export async function runScheduleFire(sid: string): Promise<FireOutcome> {
  const { data: scheduleData, error: scheduleErr } = await db()
    .from("schedules")
    .select("id, user_id, workflow_id, body, enabled")
    .eq("id", sid)
    .maybeSingle();
  if (scheduleErr) throw scheduleErr;
  const schedule = scheduleData as ScheduleRow | null;
  if (!schedule || !schedule.enabled) return { kind: "disabled-or-missing" };

  const { data: userData } = await db()
    .from("users")
    .select("id, virtual_key")
    .eq("id", schedule.user_id)
    .maybeSingle();
  const { data: sandboxData } = await db()
    .from("sandboxes")
    .select("sandbox_id, sandbox_host, status")
    .eq("user_id", schedule.user_id)
    .maybeSingle();

  const start = Date.now();

  if (!sandboxData?.sandbox_id || sandboxData.status !== "ready" || !userData?.virtual_key) {
    await recordRun(schedule.id, null, null, null, Date.now() - start, null, null, {
      error: "No active sandbox for user",
    });
    return { kind: "no-sandbox" };
  }

  const virtualKey = userData.virtual_key as string;

  let sandboxHost: string;
  try {
    const sandbox = await connectToSandbox(sandboxData.sandbox_id);
    sandboxHost = `https://${sandbox.getHost(4111)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordRun(schedule.id, null, null, null, Date.now() - start, null, null, {
      error: `Sandbox wake failed: ${msg}`,
    });
    return { kind: "wake-failed", error: msg };
  }

  const client = new MastraClient({
    baseUrl: sandboxHost,
    apiPrefix: MASTRA_API_PREFIX,
    headers: { Authorization: `Bearer ${virtualKey}` },
    retries: 0,
    abortSignal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
  });

  const workflow = client.getWorkflow(schedule.workflow_id);
  const inputData =
    (schedule.body as { inputData?: Record<string, unknown> } | null)?.inputData ?? {};
  const resourceId = (schedule.body as { resourceId?: string } | null)?.resourceId;

  // Pre-validate against the workflow's live inputSchema. Catches the case
  // where the user edited the workflow after creating this schedule: instead
  // of Mastra failing at /start with a raw Zod dump buried in
  // response_snippet, we surface the mismatch as workflow_error with a
  // precise "call update_schedule" instruction. list_runs sees it directly.
  try {
    await validateWorkflowInputWithClient(client, schedule.workflow_id, inputData, {
      kind: "fire-drift",
      scheduleId: schedule.id,
    });
  } catch (err) {
    if (err instanceof ScheduleValidationError) {
      await recordRun(schedule.id, null, null, null, Date.now() - start, null, null, {
        error: err.message,
      });
      return { kind: "validation-failed", error: err.message };
    }
    throw err;
  }

  let runId: string | null = null;
  let pollUrl: string | null = null;
  let traceUrl: string | null = null;
  try {
    const run = await workflow.createRun(resourceId ? { resourceId } : undefined);
    runId = run.runId;
    const wfPrefix = `${sandboxHost}${MASTRA_API_PREFIX}/workflows/${encodeURIComponent(schedule.workflow_id)}`;
    pollUrl = `${wfPrefix}/runs/${runId}`;
    // Baked at fire time so the SQL poller doesn't have to reconstruct paths
    // via regex. Mirror of the sandbox's /observability/traces endpoint shape.
    const traceMetadata = encodeURIComponent(JSON.stringify({ runId }));
    traceUrl = `${sandboxHost}${MASTRA_API_PREFIX}/observability/traces?metadata=${traceMetadata}&pagination[perPage]=1`;
    await run.start({ inputData });
    await recordRun(schedule.id, runId, pollUrl, traceUrl, Date.now() - start, 200, null, null);
    return { kind: "started", runId };
  } catch (err) {
    const f = failureFromError(err);
    await recordRun(
      schedule.id,
      runId,
      pollUrl,
      traceUrl,
      Date.now() - start,
      f.statusCode,
      f.snippet,
      { error: runId ? `start: ${f.message}` : `create-run: ${f.message}` },
    );
    return runId
      ? { kind: "start-failed", error: f.message, runId }
      : { kind: "create-run-failed", error: f.message };
  }
}
