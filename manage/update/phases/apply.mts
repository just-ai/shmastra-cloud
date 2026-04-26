import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_BRANCH, skipIfUpToDate, type PhaseCtx } from "./shared.mjs";

// Fast-forward main and reinstall deps. PM2 is already down by the time we
// get here — migratePhase stopped it (so DuckDB could checkpoint cleanly
// before snapshot) and intentionally left it down so apply/patch/restart
// run in a single pm2-down window before restartPhase brings it back up on
// new code. Worktree cleanup is handled by updater.mts in `finally`.
export async function applyPhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  skipIfUpToDate(state);

  // Capture pre-update HEAD before the merge advances it. updater.mts reads
  // this in its catch block to roll MAIN_DIR back to its pre-update commit
  // (paired with reinstalling deps) if any phase from here on out fails.
  const headResult = await run(
    sandbox,
    `git -C "${MAIN_DIR}" rev-parse HEAD`,
    log,
    { signal },
  );
  state.preUpdateHead = headResult.stdout.trim();

  await run(sandbox, `git -C "${MAIN_DIR}" merge ${WORKTREE_BRANCH} --ff-only`, log, { signal });

  await run(sandbox, `cd "${MAIN_DIR}" && pnpm install`, log, {
    throwOnError: false,
    timeoutMs: 180_000,
    signal,
  });
}
