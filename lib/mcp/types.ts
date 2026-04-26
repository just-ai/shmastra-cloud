export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export const ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export type ToolHandlerResult =
  | { ok: true; value: unknown }
  | { ok: false; userMessage: string };

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (userId: string, args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * A named bundle of tools that can be composed into the MCP server.
 * New capabilities (e.g. telemetry, deployment) would ship as additional
 * toolsets registered alongside the scheduler one.
 */
export type Toolset = {
  id: string;
  tools: Tool[];
};
