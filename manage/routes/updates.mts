import type { ServerResponse } from "node:http";
import { fetchSandboxes, type LogFn } from "../sandbox.mjs";
import { updateSandbox, UPDATE_PHASES } from "../update/updater.mjs";
import { json } from "./helpers.mjs";

// ── SSE broadcast ──

type SSEClient = ServerResponse;
const sseClients = new Set<SSEClient>();

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

const currentPhases = new Map<string, string>();
const runningUpdates = new Map<string, AbortController>();

function makeSandboxLog(sandboxId: string): LogFn {
  return (msg: string) => broadcast("log", { sandboxId, message: msg, phase: currentPhases.get(sandboxId) || null });
}

// ── Route handlers ──

export function handleEvents(res: ServerResponse, onClose: () => void) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":\n\n");
  sseClients.add(res);
  onClose(() => sseClients.delete(res));
}

export async function handleListSandboxes(res: ServerResponse) {
  try {
    const entries = await fetchSandboxes();
    json(res, entries);
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}

export function handleUpdateOne(res: ServerResponse, sandboxId: string) {
  if (runningUpdates.has(sandboxId)) {
    json(res, { error: "Already updating" }, 409);
    return;
  }
  json(res, { started: true });

  const ac = new AbortController();
  runningUpdates.set(sandboxId, ac);
  broadcast("status", { sandboxId, status: "running" });
  updateSandbox(
    sandboxId,
    makeSandboxLog(sandboxId),
    (status) => broadcast("status", { sandboxId, status }),
    ac.signal,
    (phase) => { currentPhases.set(sandboxId, phase); broadcast("phase", { sandboxId, phase }); },
  ).finally(() => { runningUpdates.delete(sandboxId); currentPhases.delete(sandboxId); });
}

export function handleStopOne(res: ServerResponse, sandboxId: string) {
  const ac = runningUpdates.get(sandboxId);
  if (ac) ac.abort();
  json(res, { stopped: !!ac });
}

export function handleStopAll(res: ServerResponse) {
  for (const ac of runningUpdates.values()) ac.abort();
  json(res, { stopped: runningUpdates.size });
}

export function handleUpdateAll(res: ServerResponse) {
  json(res, { started: true });

  (async () => {
    try {
      const entries = await fetchSandboxes();
      const queue = entries.filter(({ sandboxId: id }) => !runningUpdates.has(id));
      const CONCURRENCY = 5;
      let idx = 0;

      async function next(): Promise<void> {
        const entry = queue[idx++];
        if (!entry) return;
        const { sandboxId: id } = entry;
        const ac = new AbortController();
        runningUpdates.set(id, ac);
        broadcast("status", { sandboxId: id, status: "running" });
        try {
          await updateSandbox(
            id,
            makeSandboxLog(id),
            (status) => broadcast("status", { sandboxId: id, status }),
            ac.signal,
            (phase) => { currentPhases.set(id, phase); broadcast("phase", { sandboxId: id, phase }); },
          );
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

export function handlePhases(res: ServerResponse) {
  json(res, UPDATE_PHASES);
}
