import { run } from "../../sandbox.mjs";
import { WORKTREE_DIR, type PhaseCtx } from "./shared.mjs";

// pnpm install in worktree.
export async function installPhase({ sandbox, log, signal }: PhaseCtx): Promise<void> {
  await run(sandbox, `cd "${WORKTREE_DIR}" && pnpm install`, log, {
    throwOnError: true,
    timeoutMs: 180_000,
    signal,
  });
}
