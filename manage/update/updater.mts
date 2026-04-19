import {
  checkAbort,
  connectSandbox,
  AbortError,
  type SandboxInstance,
  type LogFn,
} from "../sandbox.mjs";
import {
  fetchPhase,
  mergePhase,
  installPhase,
  buildPhase,
  applyPhase,
  patchPhase,
  restartPhase,
  ensurePm2Running,
  cleanup,
  type UpdatePhase,
  type PhaseCtx,
} from "./phases/index.mjs";

export { UPDATE_PHASES, type UpdatePhase } from "./phases/index.mjs";

export type UpdateStatus = "pending" | "running" | "success" | "error" | "stopped";

export interface UpdateResult {
  sandboxId: string;
  status: UpdateStatus;
  elapsed: number;
  error?: string;
}

async function runPhase<R>(
  ctx: PhaseCtx,
  phase: Exclude<UpdatePhase, "connect">,
  fn: (ctx: PhaseCtx) => Promise<R>,
): Promise<R> {
  checkAbort(ctx.signal);
  ctx.onPhase?.(phase);
  return fn(ctx);
}

export async function updateSandbox(
  sandboxId: string,
  log: LogFn,
  onStatus?: (status: UpdateStatus) => void,
  signal?: AbortSignal,
  onPhase?: (phase: UpdatePhase) => void,
): Promise<UpdateResult> {
  const startTime = Date.now();
  const elapsed = () => (Date.now() - startTime) / 1000;

  onStatus?.("running");
  onPhase?.("connect");

  let sandbox: SandboxInstance;
  try {
    sandbox = await connectSandbox(sandboxId, { timeoutMs: 10 * 60 * 1000 });
  } catch (err: any) {
    log(`✗ Failed to connect: ${err.message}`);
    onStatus?.("error");
    return { sandboxId, status: "error", elapsed: elapsed(), error: err.message };
  }

  const ctx: PhaseCtx = { sandbox, sandboxId, log, signal, onPhase };

  try {
    const behind = await runPhase(ctx, "fetch", fetchPhase);

    if (behind === 0) {
      log("Already up to date.");
      await runPhase(ctx, "patch", patchPhase);
      await runPhase(ctx, "restart", restartPhase);
      const e = elapsed();
      log(`✓ Done in ${e.toFixed(1)}s.`);
      onStatus?.("success");
      return { sandboxId, status: "success", elapsed: e };
    }

    await runPhase(ctx, "merge", mergePhase);
    await runPhase(ctx, "install", installPhase);
    await runPhase(ctx, "build", buildPhase);
    await runPhase(ctx, "apply", applyPhase);
    await runPhase(ctx, "patch", patchPhase);
    await runPhase(ctx, "restart", restartPhase);

    const e = elapsed();
    log(`✓ Updated in ${e.toFixed(1)}s.`);
    onStatus?.("success");
    return { sandboxId, status: "success", elapsed: e };
  } catch (err: any) {
    const stopped = err instanceof AbortError;
    if (stopped) {
      log("⏹ Update stopped.");
    } else {
      log(`✗ Error: ${err.message}`);
    }
    // Cleanup is best-effort — never let it mask the terminal status broadcast, or
    // the UI will be stuck on "running" forever.
    try {
      await cleanup(sandbox, log);
      await ensurePm2Running(sandbox, log);
    } catch (cleanupErr: any) {
      log(`✗ Cleanup/restart failed: ${cleanupErr.message}`);
    }
    const e = elapsed();
    const status: UpdateStatus = stopped ? "stopped" : "error";
    onStatus?.(status);
    return { sandboxId, status, elapsed: e, error: stopped ? undefined : err.message };
  }
}
