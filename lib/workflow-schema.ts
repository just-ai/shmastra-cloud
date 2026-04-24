import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { MastraClient, MastraClientError } from "@mastra/client-js";
import { db } from "./db";
import { connectToSandbox } from "./sandbox";
import { MASTRA_API_PREFIX } from "./mastra-constants";
import { ScheduleValidationError } from "./schedule-errors";

// Fetch the Mastra workflow's inputSchema (JSON Schema) from the user's
// sandbox and validate agent-supplied input_data against it before writing
// anything to the schedules table. Catches the common "{}" mistake and
// dead workflow_ids early, with a message the agent can act on.
//
// Intentional trade-offs (see Фаза 10 in the plan):
//   - No sandbox auto-wake here. If the sandbox is paused, creating a
//     schedule must block on a human action rather than silently eat 2-3s
//     of latency per create/update. At fire time it's the opposite.
//   - No schema caching. Schedule writes are rare; caching would either
//     go stale immediately after a workflow edit or need invalidation plumbing.
//   - Ajv is instantiated once at module load; compiled schemas cached by
//     source-object identity (see `compileFor`).

const MAX_SCHEMA_RENDER = 2000;

const ajv = new Ajv({
  strict: false,
  allErrors: true,
  // The MCP surface passes plain objects through JSON-RPC, so no coercion —
  // if the agent sent a string where a number was expected, flag it.
});

// Cache compiled validators by schema identity. `getSchema()` allocates a
// fresh object each call, so this is effectively per-call; still worth it if
// the same module reuses a schema reference.
const compiled = new WeakMap<object, ValidateFunction>();
function compileFor(schema: Record<string, unknown>): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached) return cached;
  const v = ajv.compile(schema);
  compiled.set(schema, v);
  return v;
}

/**
 * Resolve the sandbox for a user and ask Mastra for the workflow's schema.
 * Returns `null` when the workflow has no declared inputSchema (valid Mastra
 * state — accept any input_data in that case).
 *
 * Throws `ScheduleValidationError` with an actionable, agent-readable message
 * if: the sandbox isn't ready, the workflow id doesn't exist, or the sandbox
 * call fails for another reason.
 */
export async function fetchWorkflowInputSchema(
  userId: string,
  workflowId: string,
): Promise<Record<string, unknown> | null> {
  const [{ data: userRow }, { data: sandboxRow }] = await Promise.all([
    db().from("users").select("virtual_key").eq("id", userId).maybeSingle(),
    db()
      .from("sandboxes")
      .select("sandbox_id, status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!sandboxRow?.sandbox_id || sandboxRow.status !== "ready" || !userRow?.virtual_key) {
    throw new ScheduleValidationError(
      "To validate input_data your sandbox must be running. Start it from /workspace and retry.",
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

  try {
    const schema = await client.getWorkflow(workflowId).getSchema();
    return schema.inputSchema;
  } catch (err) {
    if (err instanceof MastraClientError && err.status === 404) {
      throw new ScheduleValidationError(
        `Workflow "${workflowId}" is not registered on your sandbox. Check the id you passed to createWorkflow({ id: ... }) and make sure the workflow is exported from src/mastra.`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScheduleValidationError(
      `Failed to read inputSchema of workflow "${workflowId}" from sandbox: ${msg}`,
    );
  }
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

/**
 * Throw `ScheduleValidationError` if `inputData` doesn't satisfy `inputSchema`.
 * No-op when `inputSchema` is null (workflow declared no schema).
 *
 * Error message is shaped to be directly actionable by an LLM agent: lists
 * every violation, embeds the expected schema, and ends with an explicit
 * retry instruction so the agent knows this isn't a system failure.
 */
export function validateInputData(
  inputData: unknown,
  inputSchema: Record<string, unknown> | null,
  workflowId: string,
): void {
  if (!inputSchema) return;

  const validate = compileFor(inputSchema);
  if (validate(inputData)) return;

  const issues = (validate.errors ?? []).map(formatAjvError);
  const schemaJson = JSON.stringify(inputSchema, null, 2);
  const schemaRendered =
    schemaJson.length > MAX_SCHEMA_RENDER
      ? schemaJson.slice(0, MAX_SCHEMA_RENDER) + "\n… (truncated)"
      : schemaJson;

  const lines = [
    `input_data doesn't match workflow "${workflowId}" inputSchema:`,
    ...issues.map((s) => `  • ${s}`),
    "",
    "Expected schema (JSON Schema):",
    schemaRendered,
    "",
    "Call the tool again with a corrected input_data that satisfies this schema.",
  ];
  throw new ScheduleValidationError(lines.join("\n"));
}
