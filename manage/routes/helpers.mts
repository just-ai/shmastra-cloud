import type { Response } from "express";
import { getOrCreateSession } from "../agent/session.mjs";
import { connectSandbox as rawConnect } from "../sandbox.mjs";

export function sseHeaders(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

export function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function connectSandbox(sandboxId: string) {
  try {
    const session = await getOrCreateSession(sandboxId);
    return session.sandbox;
  } catch {
    return rawConnect(sandboxId);
  }
}
