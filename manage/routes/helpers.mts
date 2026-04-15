import type { IncomingMessage, ServerResponse } from "node:http";
import { Sandbox } from "e2b";
import { getOrCreateSession } from "../agent/session.mjs";

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function jsonError(res: ServerResponse, err: any, status = 500) {
  json(res, { error: err.message ?? String(err) }, status);
}

export function sseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

export function sseWrite(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function connectSandbox(sandboxId: string) {
  try {
    const session = await getOrCreateSession(sandboxId);
    return session.sandbox;
  } catch {
    return Sandbox.connect(sandboxId, { timeoutMs: 60_000 });
  }
}
