import {
  checkAbort,
  connectSandbox,
  run,
  AbortError,
  type SandboxInstance,
  type LogFn,
} from "../sandbox.mjs";
import {
  UPDATE_PIPELINE,
  SkipPhase,
  ensurePm2Running,
  cleanup,
  MAIN_DIR,
  type UpdatePhase,
  type PhaseCtx,
  type PhaseStatus,
} from "./phases/index.mjs";

export { UPDATE_PHASES, type UpdatePhase, type PhaseStatus } from "./phases/index.mjs";

export type UpdateStatus = "pending" | "running" | "success" | "error" | "stopped";

export interface UpdateResult {
  sandboxId: string;
  status: UpdateStatus;
  elapsed: number;
  error?: string;
}

export interface UpdateOptions {
  onStatus?: (status: UpdateStatus) => void;
  onPhase?: (phase: UpdatePhase, status: PhaseStatus) => void;
  signal?: AbortSignal;
}

export async function updateSandbox(
  sandboxId: string,
  log: LogFn,
  opts: UpdateOptions = {},
): Promise<UpdateResult> {
  const { onStatus = () => {}, onPhase = () => {}, signal } = opts;
  const startTime = Date.now();
  const elapsed = () => (Date.now() - startTime) / 1000;

  onStatus("running");

  let sandbox: SandboxInstance;
  try {
    sandbox = await connectSandbox(sandboxId, { timeoutMs: 10 * 60 * 1000 });
  } catch (err: any) {
    log(`✗ Failed to connect: ${err.message}`);
    onStatus("error");
    return { sandboxId, status: "error", elapsed: elapsed(), error: err.message };
  }

  const ctx: PhaseCtx = { sandbox, sandboxId, log, signal, state: {} };

  let currentPhase: UpdatePhase | null = null;
  try {
    for (const { name, fn } of UPDATE_PIPELINE) {
      checkAbort(ctx.signal);
      currentPhase = name as UpdatePhase;
      onPhase(currentPhase, "running");
      try {
        await fn(ctx);
        onPhase(currentPhase, "done");
      } catch (err: any) {
        if (err instanceof SkipPhase) {
          log(`↷ ${name} skipped${err.message ? `: ${err.message}` : ""}.`);
          onPhase(currentPhase, "skipped");
          continue;
        }
        throw err;
      }
    }

    const e = elapsed();
    log(`✓ Done in ${e.toFixed(1)}s.`);
    onStatus("success");
    return { sandboxId, status: "success", elapsed: e };
  } catch (err: any) {
    const stopped = err instanceof AbortError;
    if (stopped) {
      log("⏹ Update stopped.");
    } else {
      log(`✗ Error: ${err.message}`);
    }
    // Only flag the phase as errored on an actual error. On stop, leave the
    // phase in "running" and let the UI color by the overall "stopped" status.
    if (currentPhase && !stopped) onPhase(currentPhase, "error");
    // Roll MAIN_DIR back to its pre-update state so ensurePm2Running below
    // brings pm2 up on a consistent (old code, old schema, matching deps)
    // snapshot — not a half-applied update. Order matters:
    //   1. git reset to the captured pre-update HEAD — restores source +
    //      package.json + lockfile.
    //   2. swap .duckdb back from the pre-migration backup — undoes the
    //      destructive signal-table migration so old code can talk to old
    //      tables again.
    //   3. pnpm install on the rolled-back tree — re-pins node_modules to
    //      old package.json, in case applyPhase already ran a new install
    //      that left deps out of sync with the now-restored code.
    if (ctx.state.preUpdateHead) {
      try {
        log(`Rolling back MAIN_DIR to ${ctx.state.preUpdateHead.slice(0, 7)}...`);
        await run(
          sandbox,
          `git -C "${MAIN_DIR}" reset --hard ${ctx.state.preUpdateHead}`,
          log,
          { throwOnError: false },
        );
      } catch (resetErr: any) {
        log(`✗ git reset failed: ${resetErr.message}`);
      }
    }
    if (ctx.state.observabilityBackupDir) {
      try {
        log("Rolling back .duckdb to pre-migration state...");
        await run(
          sandbox,
          `rm -f ${MAIN_DIR}/.storage/*.duckdb* && cp -p ${ctx.state.observabilityBackupDir}/*.duckdb* ${MAIN_DIR}/.storage/`,
          log,
          { throwOnError: false },
        );
      } catch (restoreErr: any) {
        log(`✗ .duckdb rollback failed: ${restoreErr.message}`);
      }
    }
    if (ctx.state.preUpdateHead) {
      try {
        log("Reinstalling deps for rolled-back tree...");
        await run(
          sandbox,
          `cd "${MAIN_DIR}" && pnpm install`,
          log,
          { throwOnError: false, timeoutMs: 180_000 },
        );
      } catch (installErr: any) {
        log(`✗ Reinstall failed: ${installErr.message}`);
      }
    }
    // On error, also try to revive pm2 so the user isn't left with a dead
    // sandbox while we figure out what went wrong. Worktree cleanup happens
    // in `finally` regardless of success/failure.
    try {
      await ensurePm2Running(sandbox, log);
    } catch (cleanupErr: any) {
      log(`✗ Restart failed: ${cleanupErr.message}`);
    }
    const e = elapsed();
    const status: UpdateStatus = stopped ? "stopped" : "error";
    onStatus(status);
    return { sandboxId, status, elapsed: e, error: stopped ? undefined : err.message };
  } finally {
    // Always wipe the worktree at the end of the update, regardless of
    // outcome. Phases that need worktree access (migrate, restart-swap) run
    // before this block; once we get here their work is done. This was
    // previously the last step of applyPhase, but lifting it to `finally`
    // ensures a failed migrate or build doesn't leave a zombie worktree that
    // blocks the next update's `git worktree add`.
    try {
      await cleanup(sandbox, log);
    } catch (cleanupErr: any) {
      log(`✗ Worktree cleanup failed: ${cleanupErr.message}`);
    }
  }
}
