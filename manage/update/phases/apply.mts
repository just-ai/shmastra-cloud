import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_BRANCH, SkipPhase, type PhaseCtx } from "./shared.mjs";

// Stop app, fast-forward main, reinstall deps. Worktree cleanup is handled by
// updater.mts in `finally`, so the worktree stays available to the restart
// phase (which copies migrated .duckdb files out of WORKTREE_DIR/.storage
// before bringing pm2 back up).
export async function applyPhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  if (state.behind === 0) throw new SkipPhase("already up to date");
  await run(sandbox, "pm2 delete all 2>/dev/null || true", log, { throwOnError: false, signal });
  await run(
    sandbox,
    "kill -9 $(pgrep -x node) $(pgrep -x pnpm) $(pgrep -x esbuild) 2>/dev/null || true",
    log,
    { throwOnError: false, signal },
  );

  await run(sandbox, `git -C "${MAIN_DIR}" merge ${WORKTREE_BRANCH} --ff-only`, log, { signal });

  await run(sandbox, `cd "${MAIN_DIR}" && pnpm install`, log, {
    throwOnError: false,
    timeoutMs: 180_000,
    signal,
  });
}
