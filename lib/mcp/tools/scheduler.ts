import {
  createWorkflowSchedule,
  deleteSchedule,
  getSchedule,
  listRuns,
  listSchedules,
  ScheduleValidationError,
  updateSchedule,
  type CreateWorkflowScheduleInput,
  type UpdateSchedulePatch,
} from "../../schedules";
import type { Tool, Toolset } from "../types";

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ScheduleValidationError(`${key} is required`);
  }
  return v;
}

const tools: Tool[] = [
  {
    name: "list_schedules",
    description:
      "List all schedules for the current user. Returns id, name, workflow_id, cron_expression, timezone, enabled, last_run_at.",
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
      "Schedule a Mastra workflow to run on cron. Provide `workflow_id` and optional `input_data`; the cloud composes the full URL, injects authentication, and polls the run until it completes. Runs are fire-and-forget — use `list_runs` to inspect status/result/error.",
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
    name: "update_schedule",
    description:
      "Update fields on a schedule. Pass `id` plus any of cron_expression, timezone, name, enabled, body.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
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
      "List recent executions of a schedule (most recent first). Each run has workflow_status, workflow_result, workflow_error, sent_at, duration_ms.",
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

export const schedulerToolset: Toolset = {
  id: "scheduler",
  tools,
};
