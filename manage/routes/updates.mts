import type { Request, Response } from "express";
import { fetchSandboxes, type LogFn } from "../sandbox.mjs";
import { updateSandbox, UPDATE_PHASES } from "../update/updater.mjs";

// ── SSE broadcast ──

const sseClients = new Set<Response>();

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

const currentPhases = new Map<string, string>();
const runningUpdates = new Map<string, AbortController>();
let updateAllAborted = false;

function makeSandboxLog(sandboxId: string): LogFn {
  return (msg: string) => broadcast("log", { sandboxId, message: msg, phase: currentPhases.get(sandboxId) || null });
}

// ── Route handlers ──

export function handleEvents(req: Request, res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

export async function handleListSandboxes(_req: Request, res: Response) {
  try {
    const entries = await fetchSandboxes();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export function handleUpdateOne(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  if (runningUpdates.has(sandboxId)) {
    res.status(409).json({ error: "Already updating" });
    return;
  }
  res.json({ started: true });

  const ac = new AbortController();
  runningUpdates.set(sandboxId, ac);
  broadcast("status", { sandboxId, status: "running" });
  updateSandbox(sandboxId, makeSandboxLog(sandboxId), {
    onStatus: (status) => broadcast("status", { sandboxId, status }),
    signal: ac.signal,
    onPhase: (phase, status) => {
      if (status === "running") currentPhases.set(sandboxId, phase);
      broadcast("phase", { sandboxId, phase, status });
    },
  })
    .catch((err: any) => {
      // Safety net: updater should broadcast a terminal status itself, but if it threw
      // past its own handlers we'd otherwise leave the UI stuck on "running".
      broadcast("log", { sandboxId, message: `✗ Update crashed: ${err?.message ?? err}`, phase: null });
      broadcast("status", { sandboxId, status: "error" });
    })
    .finally(() => { runningUpdates.delete(sandboxId); currentPhases.delete(sandboxId); });
}

export function handleStopOne(req: Request, res: Response) {
  const ac = runningUpdates.get(req.params.sandboxId as string);
  if (ac) ac.abort();
  res.json({ stopped: !!ac });
}

export function handleStopAll(_req: Request, res: Response) {
  updateAllAborted = true;
  for (const ac of runningUpdates.values()) ac.abort();
  res.json({ stopped: runningUpdates.size });
}

export function handleUpdateAll(req: Request, res: Response) {
  const requestedIds: string[] | null = Array.isArray(req.body?.sandboxIds)
    ? req.body.sandboxIds.filter((x: unknown): x is string => typeof x === "string")
    : null;
  res.json({ started: true });
  updateAllAborted = false;

  (async () => {
    try {
      let ids: string[];
      if (requestedIds && requestedIds.length > 0) {
        ids = requestedIds;
      } else {
        const entries = await fetchSandboxes();
        ids = entries.map((e) => e.sandboxId);
      }
      const queue = ids.filter((id) => !runningUpdates.has(id));
      const CONCURRENCY = 5;
      let idx = 0;

      async function next(): Promise<void> {
        if (updateAllAborted) return;
        const id = queue[idx++];
        if (!id) return;
        const ac = new AbortController();
        runningUpdates.set(id, ac);
        broadcast("status", { sandboxId: id, status: "running" });
        try {
          await updateSandbox(id, makeSandboxLog(id), {
            onStatus: (status) => broadcast("status", { sandboxId: id, status }),
            signal: ac.signal,
            onPhase: (phase, status) => {
              if (status === "running") currentPhases.set(id, phase);
              broadcast("phase", { sandboxId: id, phase, status });
            },
          });
        } catch (err: any) {
          // Safety net — see handleUpdateOne.
          broadcast("log", { sandboxId: id, message: `✗ Update crashed: ${err?.message ?? err}`, phase: null });
          broadcast("status", { sandboxId: id, status: "error" });
        } finally {
          runningUpdates.delete(id);
          currentPhases.delete(id);
        }
        return next();
      }

      await Promise.allSettled(Array.from({ length: CONCURRENCY }, () => next()));
    } catch (err: any) {
      broadcast("log", { sandboxId: "_global", message: `✗ ${err.message}` });
    }
  })();
}

export function handlePhases(_req: Request, res: Response) {
  res.json(UPDATE_PHASES);
}
