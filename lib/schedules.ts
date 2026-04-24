import { db } from "./db";
import { getAppUrl } from "./app-url";
import { ERROR_DISPLAY_MAX } from "./schedule-trim";
import { runScheduleFire } from "./schedule-fire";
import {
  ScheduleNotFoundError,
  ScheduleValidationError,
} from "./schedule-errors";
import { validateWorkflowInput } from "./workflow-schema";

// Re-export so existing consumers (route handlers, mcp-server) keep importing
// error classes from here — the canonical definition lives in ./schedule-errors
// to break the schedules ↔ workflow-schema cycle.
export { ScheduleNotFoundError, ScheduleValidationError } from "./schedule-errors";

export type Schedule = {
  id: string;
  user_id: string;
  label: string;
  workflow_id: string;
  body: unknown;
  cron_expression: string;
  timezone: string;
  cron_job_name: string;
  enabled: boolean;
  public_url: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleRun = {
  id: string;
  schedule_id: string;
  sent_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  response_snippet: string | null;
  workflow_run_id: string | null;
  workflow_status: string | null;
  workflow_result: unknown;
  workflow_error: string | null;
  trace_id: string | null;
  trace_url: string | null;
  last_polled_at: string | null;
};

// Trimmed shapes for the MCP surface. We never ship full payloads to agents —
// `workflow_result` can be arbitrarily large and `response_snippet` holds the
// raw HTTP body. Agents get a summary; full data is reachable via the web UI
// or trace_id.
export type ScheduleSummary = {
  id: string;
  label: string;
  workflow_id: string;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleRunSummary = {
  id: string;
  workflow_run_id: string | null;
  workflow_status: string | null;
  workflow_error: string | null;
  trace_id: string | null;
  sent_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status_code: number | null;
  error_message: string | null;
};

function trimError(text: string | null): string | null {
  if (!text) return null;
  return text.length > ERROR_DISPLAY_MAX
    ? text.slice(0, ERROR_DISPLAY_MAX) + "…"
    : text;
}

export function toScheduleSummary(s: Schedule): ScheduleSummary {
  return {
    id: s.id,
    label: s.label,
    workflow_id: s.workflow_id,
    cron_expression: s.cron_expression,
    timezone: s.timezone,
    enabled: s.enabled,
    last_run_at: s.last_run_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

// Full payload for an explicit "give me everything about this run" MCP tool.
// Drops only poller plumbing; keeps workflow_result and response_snippet
// so agents that really need them can fetch them on demand.
export type ScheduleRunDetail = ScheduleRunSummary & {
  schedule_id: string;
  workflow_result: unknown;
  response_snippet: string | null;
};

export function toRunDetail(r: ScheduleRun): ScheduleRunDetail {
  return {
    ...toRunSummary(r),
    schedule_id: r.schedule_id,
    workflow_result: r.workflow_result,
    response_snippet: r.response_snippet,
  };
}

export function toRunSummary(r: ScheduleRun): ScheduleRunSummary {
  return {
    id: r.id,
    workflow_run_id: r.workflow_run_id,
    workflow_status: r.workflow_status,
    workflow_error: trimError(r.workflow_error),
    trace_id: r.trace_id,
    sent_at: r.sent_at,
    completed_at: r.completed_at,
    duration_ms: r.duration_ms,
    status_code: r.status_code,
    error_message: trimError(r.error_message),
  };
}

export type CreateWorkflowScheduleInput = {
  workflow_id: string;
  input_data?: unknown;
  resource_id?: string;
  cron_expression: string;
  timezone?: string;
  label: string;
  enabled?: boolean;
};

export type UpdateSchedulePatch = {
  input_data?: unknown;
  // Empty string clears the existing resourceId; omit to leave as-is.
  resource_id?: string;
  cron_expression?: string;
  timezone?: string;
  label?: string;
  enabled?: boolean;
};

const CRON_FIELD = /^(\*|[-,/\w*]+)$/;

function validateCron(expr: unknown): string {
  if (typeof expr !== "string") {
    throw new ScheduleValidationError("cron_expression is required");
  }
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new ScheduleValidationError(
      "cron_expression must have 5 or 6 whitespace-separated fields",
    );
  }
  for (const part of parts) {
    if (!CRON_FIELD.test(part)) {
      throw new ScheduleValidationError(
        `cron_expression field ${JSON.stringify(part)} is invalid`,
      );
    }
  }
  return trimmed;
}

function validateLabel(label: unknown): string {
  if (typeof label !== "string") {
    throw new ScheduleValidationError("label is required");
  }
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new ScheduleValidationError("label must be non-empty");
  }
  if (trimmed.length > 200) {
    throw new ScheduleValidationError("label is too long (max 200 chars)");
  }
  return trimmed;
}

function validateTimezone(tz: unknown): string {
  const value = typeof tz === "string" && tz.length > 0 ? tz : "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new ScheduleValidationError(`timezone ${JSON.stringify(value)} is not a valid IANA zone`);
  }
  return value;
}

const WORKFLOW_ID_RE = /^[A-Za-z0-9_.-]+$/;

function validateWorkflowId(workflowId: unknown): string {
  if (typeof workflowId !== "string" || workflowId.length === 0) {
    throw new ScheduleValidationError("workflow_id is required");
  }
  if (workflowId.length > 256 || !WORKFLOW_ID_RE.test(workflowId)) {
    throw new ScheduleValidationError(
      "workflow_id must match /^[A-Za-z0-9_.-]+$/ and be ≤256 chars",
    );
  }
  return workflowId;
}

function cronJobName(id: string): string {
  return `schedule_${id}`;
}

export async function listSchedules(userId: string): Promise<Schedule[]> {
  const { data, error } = await db()
    .from("schedules")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Schedule[];
}

export async function getSchedule(userId: string, id: string): Promise<Schedule> {
  const { data, error } = await db()
    .from("schedules")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ScheduleNotFoundError(id);
  return data as Schedule;
}

export async function createWorkflowSchedule(
  userId: string,
  input: CreateWorkflowScheduleInput,
): Promise<Schedule> {
  const workflow_id = validateWorkflowId(input.workflow_id);
  const cron_expression = validateCron(input.cron_expression);
  const timezone = validateTimezone(input.timezone);

  // Validate input_data against the workflow's live inputSchema before we
  // write anything. Catches both "{}" vs required fields and unknown workflow
  // ids; ScheduleValidationError carries an agent-readable retry message.
  const inputData = input.input_data ?? {};
  await validateWorkflowInput(userId, workflow_id, inputData, { kind: "create" });

  // Mastra's /start always requires an `inputData` field (Zod-validated),
  // even when the workflow takes no input — default to {} so callers that omit
  // `input_data` don't hit "expected object, received undefined".
  const body: Record<string, unknown> = {
    inputData,
  };
  if (typeof input.resource_id === "string" && input.resource_id.length > 0) {
    body.resourceId = input.resource_id;
  }
  const id = crypto.randomUUID();
  const { data, error } = await db()
    .from("schedules")
    .insert({
      id,
      user_id: userId,
      label: validateLabel(input.label),
      workflow_id,
      body,
      cron_expression,
      timezone,
      cron_job_name: cronJobName(id),
      enabled: input.enabled ?? true,
      public_url: getAppUrl(),
    })
    .select()
    .single();
  if (error) throw error;

  await syncCron(id);
  return data as Schedule;
}

export async function updateSchedule(
  userId: string,
  id: string,
  patch: UpdateSchedulePatch,
): Promise<Schedule> {
  const existing = await getSchedule(userId, id); // existence + ownership check

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.cron_expression !== undefined)
    updates.cron_expression = validateCron(patch.cron_expression);
  if (patch.timezone !== undefined) updates.timezone = validateTimezone(patch.timezone);
  if (patch.label !== undefined) updates.label = validateLabel(patch.label);
  if (patch.enabled !== undefined) updates.enabled = Boolean(patch.enabled);
  if (patch.input_data !== undefined || patch.resource_id !== undefined) {
    // Only validate when the agent actually supplies new input_data — an
    // update that only tweaks resource_id/cron shouldn't wake the sandbox.
    if (patch.input_data !== undefined) {
      await validateWorkflowInput(
        userId,
        existing.workflow_id,
        patch.input_data,
        { kind: "update", scheduleId: id },
      );
    }

    const current = (existing.body as Record<string, unknown> | null) ?? {};
    const nextBody: Record<string, unknown> = { ...current };
    if (patch.input_data !== undefined) {
      nextBody.inputData = patch.input_data;
    }
    if (patch.resource_id !== undefined) {
      if (typeof patch.resource_id === "string" && patch.resource_id.length > 0) {
        nextBody.resourceId = patch.resource_id;
      } else {
        delete nextBody.resourceId;
      }
    }
    updates.body = nextBody;
  }

  const { data, error } = await db()
    .from("schedules")
    .update(updates)
    .eq("user_id", userId)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  await syncCron(id);
  return data as Schedule;
}

export async function deleteSchedule(userId: string, id: string): Promise<void> {
  await getSchedule(userId, id);
  await callRemoveCron(id);
  const { error } = await db()
    .from("schedules")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

export async function listRuns(
  userId: string,
  scheduleId: string,
  limit = 50,
): Promise<ScheduleRun[]> {
  await getSchedule(userId, scheduleId);
  const { data, error } = await db()
    .from("schedule_runs")
    .select("*")
    .eq("schedule_id", scheduleId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ScheduleRun[];
}

// Fetch a single run with its parent schedule (for ownership check). Used
// when an agent explicitly asks for the full payload — the full row carries
// workflow_result / response_snippet which list_runs deliberately strips.
export async function getRun(
  userId: string,
  runId: string,
): Promise<ScheduleRun> {
  const { data, error } = await db()
    .from("schedule_runs")
    .select("*, schedule:schedules!inner(user_id)")
    .eq("id", runId)
    .single();
  if (error) throw new ScheduleNotFoundError("Run not found");
  const row = data as ScheduleRun & { schedule: { user_id: string } };
  if (row.schedule.user_id !== userId) {
    throw new ScheduleNotFoundError("Run not found");
  }
  // Drop the join payload before returning.
  const { schedule: _, ...run } = row;
  return run as ScheduleRun;
}

export async function fireSchedule(userId: string, id: string): Promise<void> {
  await getSchedule(userId, id); // ownership check
  // Call the fire logic in-process; the internal HTTP route is just an
  // adapter for pg_cron. No reason to self-HTTP for user-initiated fires.
  await runScheduleFire(id);
}

async function syncCron(id: string): Promise<void> {
  const { error } = await db().rpc("schedule_upsert_cron", { sid: id });
  if (error) throw error;
}

async function callRemoveCron(id: string): Promise<void> {
  const { error } = await db().rpc("schedule_remove_cron", { sid: id });
  if (error) throw error;
}
