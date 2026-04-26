import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_BRANCH, skipIfUpToDate, type PhaseCtx } from "./shared.mjs";

// Fast-forward main and reinstall deps. PM2 is already down by the time we
// get here — migratePhase killed it so DuckDB could checkpoint cleanly
// before its snapshot. Worktree cleanup is handled by updater.mts in
// `finally`, so the worktree stays available to the restart phase (which
// copies migrated .duckdb files out of WORKTREE_DIR/.storage before bringing
// pm2 back up).
export async function applyPhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  skipIfUpToDate(state);

  await run(sandbox, `git -C "${MAIN_DIR}" merge ${WORKTREE_BRANCH} --ff-only`, log, { signal });

  await run(sandbox, `cd "${MAIN_DIR}" && pnpm install`, log, {
    throwOnError: false,
    timeoutMs: 180_000,
    signal,
  });
}
