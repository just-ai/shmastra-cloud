import { run } from "../../sandbox.mjs";
import { WORKTREE_DIR, type PhaseCtx } from "./shared.mjs";

// Dry-run the app, commit updated lockfile.
export async function buildPhase({ sandbox, log }: PhaseCtx): Promise<void> {
  await run(sandbox, `cd "${WORKTREE_DIR}" && (pnpm dry-run > /tmp/dry-run.log 2>&1; echo $? > /tmp/dry-run-exit)`, log, {
    timeoutMs: 180_000,
  });
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
    { throwOnError: false },
  );
}
