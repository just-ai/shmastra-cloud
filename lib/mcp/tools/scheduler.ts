import {
  createWorkflowSchedule,
  deleteSchedule,
  getRun,
  getSchedule,
  listRuns,
  listSchedules,
  ScheduleValidationError,
  toRunDetail,
  toRunSummary,
  toScheduleSummary,
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
    description: "List the current user's schedules (summary).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (userId) => (await listSchedules(userId)).map(toScheduleSummary),
  },
  {
    name: "get_schedule",
    description: "Fetch a single schedule by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Schedule id (from list_schedules)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (userId, args) =>
      toScheduleSummary(await getSchedule(userId, requireString(args, "id"))),
  },
  {
    name: "create_workflow_schedule",
    description: "Schedule a Mastra workflow on cron. Fire-and-forget.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow id registered in mastra. Pattern: /^[A-Za-z0-9_.-]+$/.",
        },
        input_data: {
          type: "object",
          description: "Object passed as `inputData`; must match the workflow's input schema. Defaults to {}.",
          additionalProperties: true,
        },
        resource_id: { type: "string", description: "Optional resourceId override." },
        cron_expression: { type: "string", description: "5- or 6-field cron, UTC." },
        timezone: {
          type: "string",
          description: "IANA zone; pass the user's zone from context.",
        },
        label: {
          type: "string",
          description: "Short UI label in the user's language, 2–5 words.",
        },
        enabled: { type: "boolean", description: "Defaults true." },
      },
      required: ["workflow_id", "cron_expression", "timezone", "label", "input_data"],
      additionalProperties: false,
    },
    handler: async (userId, args) =>
      toScheduleSummary(
        await createWorkflowSchedule(
          userId,
          args as unknown as CreateWorkflowScheduleInput,
        ),
      ),
  },
  {
    name: "update_schedule",
    description: "Patch schedule fields. Pass `id` and any of the others.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Schedule id (from list_schedules)." },
        input_data: {
          type: "object",
          description: "Replace `inputData` object; must match the workflow's input schema.",
          additionalProperties: true,
        },
        resource_id: {
          type: "string",
          description: "Set `resourceId`; pass empty string to clear.",
        },
        cron_expression: { type: "string" },
        timezone: { type: "string" },
        label: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (userId, args) => {
      const { id, ...patch } = args as { id: string } & UpdateSchedulePatch;
      return toScheduleSummary(
        await updateSchedule(userId, requireString({ id }, "id"), patch),
      );
    },
  },
  {
    name: "delete_schedule",
    description: "Delete a schedule.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Schedule id (from list_schedules)." },
      },
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
    description: "List recent run summaries (newest first). Omits workflow_result and response_snippet — fetch with `get_run` if needed.",
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
      return (await listRuns(userId, id, limit)).map(toRunSummary);
    },
  },
  {
    name: "get_run",
    description: "Full payload of one run: workflow_result + response_snippet. Call only when you need the full result or failure body.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Run id (from list_runs)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (userId, args) =>
      toRunDetail(await getRun(userId, requireString(args, "id"))),
  },
];

export const schedulerToolset: Toolset = {
  id: "scheduler",
  tools,
};
