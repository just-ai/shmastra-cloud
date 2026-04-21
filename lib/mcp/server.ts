import { ScheduleNotFoundError, ScheduleValidationError } from "../schedules";
import {
  ERROR,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type Tool,
  type Toolset,
} from "./types";

const PROTOCOL_VERSION = "2024-11-05";

export type McpServerOptions = {
  name: string;
  version: string;
  toolsets: Toolset[];
};

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

function collectTools(toolsets: Toolset[]): Tool[] {
  const seen = new Set<string>();
  const all: Tool[] = [];
  for (const ts of toolsets) {
    for (const t of ts.tools) {
      if (seen.has(t.name)) {
        throw new Error(`Duplicate MCP tool name across toolsets: ${t.name}`);
      }
      seen.add(t.name);
      all.push(t);
    }
  }
  return all;
}

export function createMcpServer(options: McpServerOptions) {
  const tools = collectTools(options.toolsets);
  const serverInfo = { name: options.name, version: options.version };

  async function handleMessage(
    userId: string,
    message: JsonRpcRequest,
  ): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;
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
          serverInfo,
        });

      case "notifications/initialized":
      case "initialized":
        return null;

      case "ping":
        return success(id, {});

      case "tools/list":
        return success(id, {
          tools: tools.map((t) => ({
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
        const tool = tools.find((t) => t.name === params.name);
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

  async function handlePayload(
    userId: string,
    payload: unknown,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
      const results = await Promise.all(
        payload.map((m) => handleMessage(userId, m as JsonRpcRequest)),
      );
      const filtered = results.filter((r): r is JsonRpcResponse => r !== null);
      return filtered.length > 0 ? filtered : null;
    }
    return handleMessage(userId, payload as JsonRpcRequest);
  }

  return { handleMessage, handlePayload };
}
