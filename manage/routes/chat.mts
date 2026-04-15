import type { IncomingMessage, ServerResponse } from "node:http";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { streamMessage, destroySession } from "../agent/session.mjs";
import { readBody, json, jsonError, sseHeaders, sseWrite } from "./helpers.mjs";

export async function handleChat(req: IncomingMessage, res: ServerResponse, sandboxId: string) {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, { error: "Invalid JSON" }, 400);
  }

  const message = body?.message;
  if (!message || typeof message !== "string") {
    return json(res, { error: "message is required" }, 400);
  }

  sseHeaders(res);
  const write = (event: string, data: unknown) => sseWrite(res, event, data);

  try {
    const stream = await streamMessage(sandboxId, message);

    for await (const part of stream.fullStream) {
      switch (part.type) {
        case "text-delta":
          write("text", { text: part.payload.text });
          break;
        case "tool-call": {
          const { toolName, args } = part.payload;
          const a = args as Record<string, unknown>;
          let line: string;
          const { SANDBOX } = WORKSPACE_TOOLS;
          switch (toolName) {
            case SANDBOX.EXECUTE_COMMAND:
              line = `$ ${a.command}${a.cwd ? ` (in ${a.cwd})` : ""}`;
              break;
            case SANDBOX.GET_PROCESS_OUTPUT:
              line = `output pid=${a.pid}${a.tail ? ` tail=${a.tail}` : ""}`;
              break;
            case SANDBOX.KILL_PROCESS:
              line = `kill pid=${a.pid}`;
              break;
            default:
              line = `${toolName}(${JSON.stringify(a).slice(0, 100)})`;
          }
          write("tool-call", { tool: line });
          break;
        }
        case "tool-result":
          write("tool-result", { result: String(part.payload.result).slice(0, 500) });
          break;
        case "error":
          write("error", { error: String(part.payload) });
          break;
      }
    }

    write("done", {});
  } catch (err: any) {
    write("error", { error: err.message });
  }

  res.end();
}

export function handleDestroyChat(res: ServerResponse, sandboxId: string) {
  destroySession(sandboxId);
  json(res, { ok: true });
}
