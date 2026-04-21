import {
  createSchedule,
  createWorkflowSchedule,
  deleteSchedule,
  getSchedule,
  listRuns,
  listSchedules,
  ScheduleNotFoundError,
  ScheduleValidationError,
  updateSchedule,
  type CreateScheduleInput,
  type CreateWorkflowScheduleInput,
  type UpdateSchedulePatch,
} from "./schedules";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = {
  name: "shmastra-scheduler",
  version: "0.1.0",
};

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (userId: string, args: Record<string, unknown>) => Promise<unknown>;
};

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ScheduleValidationError(`${key} is required`);
  }
  return v;
}

const TOOLS: Tool[] = [
  {
    name: "list_schedules",
    description:
      "List all schedules for the current user. Returns id, name, path, cron_expression, timezone, enabled, last_run_at.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (userId) => listSchedules(userId),
  },
  {
    name: "get_schedule",
    description: "Fetch a single schedule by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Schedule UUID" } },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (userId, args) => getSchedule(userId, requireString(args, "id")),
  },
  {
    name: "create_workflow_schedule",
    description:
      "Schedule a Mastra workflow to run on cron. The cloud composes the workflow URL for you — you only provide the workflow id and its input. Runs are always fire-and-forget: the scheduler starts the run, records its run id, and polls until the workflow completes (see `list_runs` for status / result / error).",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description:
            "Workflow id as registered in Mastra (e.g. 'nightlyReport'). Must match /^[A-Za-z0-9_.-]+$/.",
        },
        input_data: {
          description:
            "Value passed as `inputData` to the workflow. Any JSON-serialisable value.",
        },
        resource_id: {
          type: "string",
          description: "Optional resourceId override for the workflow run.",
        },
        cron_expression: {
          type: "string",
          description: "5- or 6-field cron expression, UTC.",
        },
        timezone: {
          type: "string",
          description: "IANA timezone (e.g. 'America/New_York'). Defaults to 'UTC'.",
        },
        name: { type: "string", description: "Optional display name." },
        enabled: { type: "boolean", description: "Whether to fire (defaults to true)." },
      },
      required: ["workflow_id", "cron_expression"],
      additionalProperties: false,
    },
    handler: async (userId, args) =>
      createWorkflowSchedule(
        userId,
        args as unknown as CreateWorkflowScheduleInput,
      ),
  },
  {
    name: "create_schedule",
    description:
      "Escape hatch: create a schedule that POSTs to an arbitrary `path` on the user's sandbox. For workflows, prefer `create_workflow_schedule`. The Authorization header is injected server-side — do not pass secrets in the body. `cron_expression` is evaluated in UTC; `timezone` is informational metadata.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path on the sandbox, must start with '/'. Examples: '/api/agents/support/generate', '/api/workflows/nightly/start-async', '/api/my-hook'.",
        },
        body: { type: "object", description: "JSON body to POST." },
        cron_expression: {
          type: "string",
          description: "5- or 6-field cron expression, UTC.",
        },
        timezone: {
          type: "string",
          description: "IANA timezone (e.g. 'America/New_York'). Defaults to 'UTC'.",
        },
        name: { type: "string", description: "Optional display name." },
        enabled: { type: "boolean", description: "Whether to fire (defaults to true)." },
      },
      required: ["path", "cron_expression"],
      additionalProperties: false,
    },
    handler: async (userId, args) =>
      createSchedule(userId, args as unknown as CreateScheduleInput),
  },
  {
    name: "update_schedule",
    description:
      "Update fields on a schedule. Pass `id` plus any of path, body, cron_expression, timezone, name, enabled.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        path: { type: "string" },
        body: { type: "object" },
        cron_expression: { type: "string" },
        timezone: { type: "string" },
        name: { type: ["string", "null"] },
        enabled: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (userId, args) => {
      const { id, ...patch } = args as { id: string } & UpdateSchedulePatch;
      return updateSchedule(userId, requireString({ id }, "id"), patch);
    },
  },
  {
    name: "delete_schedule",
    description: "Delete a schedule and stop its cron job.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (userId, args) => {
      await deleteSchedule(userId, requireString(args, "id"));
      return { ok: true };
    },
  },
  {
    name: "list_runs",
    description:
      "List recent executions of a schedule (most recent first). Each run has status_code, duration_ms, response_snippet.",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
    handler: async (userId, args) => {
      const id = requireString(args, "schedule_id");
      const limit = typeof args.limit === "number" ? args.limit : 50;
      return listRuns(userId, id, limit);
    },
  },
];

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export async function handleMcpMessage(
  userId: string,
  message: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;

  // Notifications (no id) get no response.
  const isNotification = message.id === undefined || message.id === null;

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification
      ? null
      : errorResponse(id, ERROR.INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  switch (message.method) {
    case "initialize":
      return success(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "initialized":
      return null;

    case "ping":
      return success(id, {});

    case "tools/list":
      return success(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const params = (message.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) {
        return errorResponse(id, ERROR.METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
      }
      try {
        const result = await tool.handler(userId, params.arguments ?? {});
        return success(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        if (err instanceof ScheduleValidationError) {
          return success(id, {
            isError: true,
            content: [{ type: "text", text: `Validation error: ${err.message}` }],
          });
        }
        if (err instanceof ScheduleNotFoundError) {
          return success(id, {
            isError: true,
            content: [{ type: "text", text: err.message }],
          });
        }
        console.error(`MCP tool ${tool.name} failed`, err);
        return errorResponse(
          id,
          ERROR.INTERNAL,
          err instanceof Error ? err.message : "Tool execution failed",
        );
      }
    }

    default:
      if (isNotification) return null;
      return errorResponse(id, ERROR.METHOD_NOT_FOUND, `Unknown method: ${message.method}`);
  }
}

export async function handleMcpPayload(
  userId: string,
  payload: unknown,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    const results = await Promise.all(
      payload.map((m) => handleMcpMessage(userId, m as JsonRpcRequest)),
    );
    const filtered = results.filter((r): r is JsonRpcResponse => r !== null);
    return filtered.length > 0 ? filtered : null;
  }
  return handleMcpMessage(userId, payload as JsonRpcRequest);
}
