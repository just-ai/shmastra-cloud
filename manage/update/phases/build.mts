import { run } from "../../sandbox.mjs";
import { WORKTREE_DIR, skipIfUpToDate, type PhaseCtx } from "./shared.mjs";

// Port for the dry-run boot. Anything other than 4111 — pm2 is still serving
// the user with the old code on 4111 until restartPhase, so dry-run would
// otherwise hit EADDRINUSE. dry-run forwards --port to its mastra-dev probe.
const DRY_RUN_PORT = 4222;

// Dry-run the app, commit updated lockfile.
export async function buildPhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  skipIfUpToDate(state);
  await run(
    sandbox,
    `cd "${WORKTREE_DIR}" && (pnpm dry-run --port=${DRY_RUN_PORT} > /tmp/dry-run.log 2>&1; echo $? > /tmp/dry-run-exit)`,
    log,
    { timeoutMs: 180_000, signal },
  );
  const dryRunLog = await sandbox.files.read("/tmp/dry-run.log", { user: "user" }).catch(() => "");
  if (dryRunLog.trim()) log(dryRunLog.trim());
  const dryRunExit = (await sandbox.files.read("/tmp/dry-run-exit", { user: "user" }).catch(() => "1")).trim();
  if (dryRunExit !== "0") {
    throw new Error(`dry-run failed (exit ${dryRunExit})`);
  }

  await run(
    sandbox,
    `git -C "${WORKTREE_DIR}" add -A && git -C "${WORKTREE_DIR}" diff --cached --quiet || git -C "${WORKTREE_DIR}" commit -m "Update lockfile after merge"`,
    log,
    { throwOnError: false, signal },
  );
}
