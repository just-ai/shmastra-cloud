import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { MastraClient, MastraClientError } from "@mastra/client-js";
import { db } from "./db";
import { connectToSandbox } from "./sandbox";
import { MASTRA_API_PREFIX } from "./mastra-constants";
import { ScheduleValidationError } from "./schedule-errors";

// Validate agent-supplied input_data against a Mastra workflow's live
// inputSchema. Runs in three places:
//   1. createWorkflowSchedule       — before inserting a new schedule row.
//   2. updateSchedule               — only when input_data is being patched.
//   3. runScheduleFire (pre-create) — before Mastra's createRun, catches drift
//      between schedule creation and fire time.
//
// Error messages are shaped to be directly actionable by the calling LLM
// agent: we tell it which tool to call next with the right args, so it
// doesn't loop on the wrong remedy (e.g., re-creating a schedule instead
// of updating the one that drifted).

const MAX_SCHEMA_RENDER = 2000;

const ajv = new Ajv({
  strict: false,
  allErrors: true,
});

const compiled = new WeakMap<object, ValidateFunction>();
function compileFor(schema: Record<string, unknown>): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached) return cached;
  const v = ajv.compile(schema);
  compiled.set(schema, v);
  return v;
}

// Context for what the agent should do next when validation fails. Each kind
// renders a different "remediation" footer on the error message.
export type RetryHint =
  | { kind: "create" }
  | { kind: "update"; scheduleId: string }
  | { kind: "fire-drift"; scheduleId: string };

function renderSchema(schema: Record<string, unknown>): string {
  const json = JSON.stringify(schema, null, 2);
  return json.length > MAX_SCHEMA_RENDER
    ? json.slice(0, MAX_SCHEMA_RENDER) + "\n… (truncated)"
    : json;
}

function formatAjvError(e: ErrorObject): string {
  const loc = e.instancePath || "(root)";
  if (e.keyword === "required") {
    const prop = (e.params as { missingProperty?: string }).missingProperty;
    return `missing required property "${prop}" at ${loc}`;
  }
  if (e.keyword === "type") {
    const expected = (e.params as { type?: string }).type;
    return `${loc} should be ${expected}`;
  }
  if (e.keyword === "additionalProperties") {
    const prop = (e.params as { additionalProperty?: string }).additionalProperty;
    return `${loc} has unexpected property "${prop}"`;
  }
  return `${loc} ${e.message ?? "is invalid"}`;
}

function workflowNotFoundMessage(workflowId: string, retry: RetryHint): string {
  if (retry.kind === "create") {
    return [
      `Workflow "${workflowId}" is not registered on your sandbox.`,
      `Register it in src/mastra (export it from the mastra instance), then call create_workflow_schedule again with the same workflow_id.`,
    ].join(" ");
  }
  // update / fire-drift: the schedule exists but its target workflow is gone.
  return [
    `Workflow "${workflowId}" was registered when this schedule was created but isn't anymore (renamed, deleted, or un-exported from src/mastra).`,
    `Either restore the workflow in code, or remove this schedule via delete_schedule({ id: "${retry.scheduleId}" }).`,
    `Don't retry this operation until one of those is done.`,
  ].join(" ");
}

function schemaMismatchMessage(
  workflowId: string,
  issues: string[],
  schema: Record<string, unknown>,
  retry: RetryHint,
): string {
  const header =
    retry.kind === "fire-drift"
      ? `The scheduled input_data no longer matches workflow "${workflowId}" inputSchema (the workflow was changed after this schedule was created):`
      : `input_data doesn't match workflow "${workflowId}" inputSchema:`;

  const footer = (() => {
    if (retry.kind === "create") {
      return "Call create_workflow_schedule again with a corrected input_data that satisfies this schema.";
    }
    if (retry.kind === "update") {
      return `Call update_schedule({ id: "${retry.scheduleId}", input_data: <corrected> }) with an input_data that satisfies this schema.`;
    }
    // fire-drift
    return [
      `Call update_schedule({ id: "${retry.scheduleId}", input_data: <corrected> }) to bring this schedule back in sync.`,
      `Don't create a new schedule — the existing one is still registered.`,
    ].join(" ");
  })();

  return [
    header,
    ...issues.map((s) => `  • ${s}`),
    "",
    "Expected schema (JSON Schema):",
    renderSchema(schema),
    "",
    footer,
  ].join("\n");
}

// Fetch the workflow's inputSchema via an existing MastraClient. Returns null
// when the workflow has no declared schema (valid Mastra state — accept any
// input_data in that case). Converts 404 into a context-aware
// ScheduleValidationError.
async function fetchInputSchemaViaClient(
  client: MastraClient,
  workflowId: string,
  retry: RetryHint,
): Promise<Record<string, unknown> | null> {
  try {
    const schema = await client.getWorkflow(workflowId).getSchema();
    return schema.inputSchema;
  } catch (err) {
    if (err instanceof MastraClientError && err.status === 404) {
      throw new ScheduleValidationError(workflowNotFoundMessage(workflowId, retry));
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScheduleValidationError(
      `Failed to read inputSchema of workflow "${workflowId}" from sandbox: ${msg}`,
    );
  }
}

function runValidation(
  inputData: unknown,
  schema: Record<string, unknown> | null,
  workflowId: string,
  retry: RetryHint,
): void {
  if (!schema) return;
  const validate = compileFor(schema);
  if (validate(inputData)) return;
  const issues = (validate.errors ?? []).map(formatAjvError);
  throw new ScheduleValidationError(
    schemaMismatchMessage(workflowId, issues, schema, retry),
  );
}

/**
 * Validate `inputData` using an existing MastraClient (no DB/sandbox resolve).
 * Used by the fire path, which has already woken the sandbox and built a client
 * for its `createRun` call — no reason to resolve everything a second time.
 *
 * Throws `ScheduleValidationError` with an agent-readable remediation footer
 * derived from `retry`.
 */
export async function validateWorkflowInputWithClient(
  client: MastraClient,
  workflowId: string,
  inputData: unknown,
  retry: RetryHint,
): Promise<void> {
  const schema = await fetchInputSchemaViaClient(client, workflowId, retry);
  runValidation(inputData, schema, workflowId, retry);
}

/**
 * Validate `inputData` by resolving the user's sandbox from Supabase and
 * constructing a MastraClient. Used by create/update paths, where there's
 * no client in scope yet.
 *
 * Intentionally does NOT auto-wake a paused sandbox — if the caller is a
 * user creating a schedule, they just came from Studio and their sandbox is
 * almost certainly warm. A paused sandbox returns a clear "start it first"
 * error instead of silently eating 2-3s of E2B resume latency.
 */
export async function validateWorkflowInput(
  userId: string,
  workflowId: string,
  inputData: unknown,
  retry: RetryHint,
): Promise<void> {
  const [{ data: userRow }, { data: sandboxRow }] = await Promise.all([
    db().from("users").select("virtual_key").eq("id", userId).maybeSingle(),
    db()
      .from("sandboxes")
      .select("sandbox_id, status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!sandboxRow?.sandbox_id || !userRow?.virtual_key) {
    throw new ScheduleValidationError(
      "Sandbox is not ready",
    );
  }

  let sandboxHost: string;
  try {
    const sandbox = await connectToSandbox(sandboxRow.sandbox_id);
    sandboxHost = `https://${sandbox.getHost(4111)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScheduleValidationError(`Could not reach your sandbox: ${msg}`);
  }

  const client = new MastraClient({
    baseUrl: sandboxHost,
    apiPrefix: MASTRA_API_PREFIX,
    headers: { Authorization: `Bearer ${userRow.virtual_key}` },
    retries: 0,
  });

  await validateWorkflowInputWithClient(client, workflowId, inputData, retry);
}
