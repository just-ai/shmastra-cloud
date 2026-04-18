import type { Request, Response } from "express";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { streamMessage, destroySession } from "../agent/session.mjs";
import { sseHeaders, sseWrite } from "./helpers.mjs";

export async function handleChat(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  const message = req.body?.message;
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
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

export function handleDestroyChat(req: Request, res: Response) {
  destroySession(req.params.sandboxId as string);
  res.json({ ok: true });
}
