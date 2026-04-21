import { db } from "./db";
import { MASTRA_API_PREFIX } from "./mastra-constants";

export type ScheduleKind = "raw" | "workflow";

export type Schedule = {
  id: string;
  user_id: string;
  name: string | null;
  path: string;
  body: unknown;
  cron_expression: string;
  timezone: string;
  cron_job_name: string;
  enabled: boolean;
  kind: ScheduleKind;
  workflow_id: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleRun = {
  id: string;
  schedule_id: string;
  pg_net_request_id: number | null;
  sent_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status_code: number | null;
  response_snippet: string | null;
  error_message: string | null;
  workflow_run_id: string | null;
  workflow_status: string | null;
  workflow_result: unknown;
  workflow_error: string | null;
  last_polled_at: string | null;
};

export type CreateScheduleInput = {
  path: string;
  body?: unknown;
  cron_expression: string;
  timezone?: string;
  name?: string | null;
  enabled?: boolean;
};

export type UpdateSchedulePatch = Partial<
  Pick<
    CreateScheduleInput,
    "path" | "body" | "cron_expression" | "timezone" | "name" | "enabled"
  >
>;

export type CreateWorkflowScheduleInput = {
  workflow_id: string;
  input_data?: unknown;
  resource_id?: string;
  cron_expression: string;
  timezone?: string;
  name?: string | null;
  enabled?: boolean;
};

const CRON_FIELD = /^(\*|[-,/\w*]+)$/;

function validatePath(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new ScheduleValidationError("path must be a string starting with '/'");
  }
  if (path.length > 2048) {
    throw new ScheduleValidationError("path is too long");
  }
  return path;
}

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

function validateTimezone(tz: unknown): string {
  const value = typeof tz === "string" && tz.length > 0 ? tz : "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new ScheduleValidationError(`timezone ${JSON.stringify(value)} is not a valid IANA zone`);
  }
  return value;
}

function validateBody(body: unknown): unknown {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object") {
    throw new ScheduleValidationError("body must be a JSON object");
  }
  return body;
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

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(id: string) {
    super(`Schedule ${id} not found`);
    this.name = "ScheduleNotFoundError";
  }
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

export async function createSchedule(
  userId: string,
  input: CreateScheduleInput,
): Promise<Schedule> {
  return insertSchedule(userId, {
    path: validatePath(input.path),
    body: validateBody(input.body),
    cron_expression: validateCron(input.cron_expression),
    timezone: validateTimezone(input.timezone),
    name: typeof input.name === "string" ? input.name : null,
    enabled: input.enabled ?? true,
    kind: "raw",
    workflow_id: null,
  });
}

export async function createWorkflowSchedule(
  userId: string,
  input: CreateWorkflowScheduleInput,
): Promise<Schedule> {
  const workflow_id = validateWorkflowId(input.workflow_id);
  const cron_expression = validateCron(input.cron_expression);
  const timezone = validateTimezone(input.timezone);
  const body: Record<string, unknown> = {};
  if (input.input_data !== undefined) body.inputData = input.input_data;
  if (typeof input.resource_id === "string" && input.resource_id.length > 0) {
    body.resourceId = input.resource_id;
  }
  const path = `${MASTRA_API_PREFIX}/workflows/${encodeURIComponent(workflow_id)}/start-async`;
  return insertSchedule(userId, {
    path,
    body,
    cron_expression,
    timezone,
    name: typeof input.name === "string" ? input.name : null,
    enabled: input.enabled ?? true,
    kind: "workflow",
    workflow_id,
  });
}

async function insertSchedule(
  userId: string,
  row: {
    path: string;
    body: unknown;
    cron_expression: string;
    timezone: string;
    name: string | null;
    enabled: boolean;
    kind: ScheduleKind;
    workflow_id: string | null;
  },
): Promise<Schedule> {
  const id = crypto.randomUUID();
  const { data, error } = await db()
    .from("schedules")
    .insert({
      id,
      user_id: userId,
      ...row,
      cron_job_name: cronJobName(id),
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
  await getSchedule(userId, id); // existence + ownership check

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.path !== undefined) updates.path = validatePath(patch.path);
  if (patch.cron_expression !== undefined)
    updates.cron_expression = validateCron(patch.cron_expression);
  if (patch.timezone !== undefined) updates.timezone = validateTimezone(patch.timezone);
  if (patch.body !== undefined) updates.body = validateBody(patch.body);
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.enabled !== undefined) updates.enabled = Boolean(patch.enabled);

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

async function syncCron(id: string): Promise<void> {
  const { error } = await db().rpc("schedule_upsert_cron", { sid: id });
  if (error) throw error;
}

async function callRemoveCron(id: string): Promise<void> {
  const { error } = await db().rpc("schedule_remove_cron", { sid: id });
  if (error) throw error;
}
