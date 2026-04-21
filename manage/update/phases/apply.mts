import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_BRANCH, cleanup, type PhaseCtx } from "./shared.mjs";

// Stop app, fast-forward main, reinstall deps, drop worktree.
export async function applyPhase({ sandbox, log, signal }: PhaseCtx): Promise<void> {
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

  await cleanup(sandbox, log, signal);
}
