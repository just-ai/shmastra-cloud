import { NextRequest, NextResponse } from "next/server";
import { MastraClient, MastraClientError } from "@mastra/client-js";
import { db } from "@/lib/db";
import { connectToSandbox } from "@/lib/sandbox";
import { MASTRA_API_PREFIX } from "@/lib/mastra-constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const SNIPPET_MAX = 2000;
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

async function recordRun(
  scheduleId: string,
  runId: string | null,
  pollUrl: string | null,
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
      sent_at: now,
      completed_at: terminal ? now : null,
      duration_ms: durationMs,
      status_code: statusCode,
      error_message: failure?.error ?? null,
      response_snippet: snippet,
      workflow_status: terminal ? "failed" : "pending",
      workflow_error: terminal ? failure?.error ?? null : null,
    });
  await db()
    .from("schedules")
    .update({ last_run_at: now })
    .eq("id", scheduleId);
}

function trimSnippet(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) : text;
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

export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid");
  if (!sid) {
    return NextResponse.json({ error: "sid required" }, { status: 400 });
  }

  const { data: scheduleData, error: scheduleErr } = await db()
    .from("schedules")
    .select("id, user_id, workflow_id, body, enabled")
    .eq("id", sid)
    .maybeSingle();
  if (scheduleErr) {
    console.error("fire: schedule lookup failed", scheduleErr);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  const schedule = scheduleData as ScheduleRow | null;
  if (!schedule || !schedule.enabled) {
    return NextResponse.json({ ok: true, skipped: "disabled-or-missing" });
  }

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
    await recordRun(schedule.id, null, null, Date.now() - start, null, null, {
      error: "No active sandbox for user",
    });
    return NextResponse.json({ ok: true, error: "no sandbox" });
  }

  const virtualKey = userData.virtual_key as string;

  let sandboxHost: string;
  try {
    // Wakes sandbox (auto-resume) and blocks until Mastra is ready on :4111.
    const sandbox = await connectToSandbox(sandboxData.sandbox_id);
    sandboxHost = `https://${sandbox.getHost(4111)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordRun(schedule.id, null, null, Date.now() - start, null, null, {
      error: `Sandbox wake failed: ${msg}`,
    });
    return NextResponse.json({ ok: true, error: "wake failed" });
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
    (schedule.body as { inputData?: Record<string, unknown> } | null)
      ?.inputData ?? {};

  const resourceId = (schedule.body as { resourceId?: string } | null)
    ?.resourceId;

  // Two-step: createRun allocates the runId, run.start kicks execution off
  // and returns fast (no awaiting completion like startAsync does).
  let runId: string | null = null;
  let pollUrl: string | null = null;
  try {
    const run = await workflow.createRun(
      resourceId ? { resourceId } : undefined,
    );
    runId = run.runId;
    pollUrl = `${sandboxHost}${MASTRA_API_PREFIX}/workflows/${encodeURIComponent(schedule.workflow_id)}/runs/${runId}`;
    await run.start({ inputData });
    await recordRun(schedule.id, runId, pollUrl, Date.now() - start, 200, null, null);
    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    const f = failureFromError(err);
    await recordRun(
      schedule.id,
      runId,
      pollUrl,
      Date.now() - start,
      f.statusCode,
      f.snippet,
      { error: runId ? `start: ${f.message}` : `create-run: ${f.message}` },
    );
    return NextResponse.json({ ok: true, error: runId ? "start failed" : "create-run failed" });
  }
}
