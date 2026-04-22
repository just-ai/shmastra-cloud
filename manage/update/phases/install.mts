import { run } from "../../sandbox.mjs";
import { WORKTREE_DIR, SkipPhase, type PhaseCtx } from "./shared.mjs";

// pnpm install in worktree.
export async function installPhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  if (state.behind === 0) throw new SkipPhase("already up to date");
  await run(sandbox, `cd "${WORKTREE_DIR}" && pnpm install`, log, {
    throwOnError: true,
    timeoutMs: 180_000,
    signal,
  });
}
