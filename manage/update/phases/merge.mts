import { run, checkAbort } from "../../sandbox.mjs";
import { resolveConflicts } from "../conflicts.mjs";
import { MAIN_DIR, WORKTREE_DIR, WORKTREE_BRANCH, updateBranch, type PhaseCtx } from "./shared.mjs";

// Add worktree, merge origin/<branch>, resolve conflicts if any.
export async function mergePhase({ sandbox, log, signal }: PhaseCtx): Promise<void> {
  const branch = updateBranch();
  log(`Merging origin/${branch}...`);

  await run(
    sandbox,
    `git -C "${MAIN_DIR}" worktree add -b ${WORKTREE_BRANCH} "${WORKTREE_DIR}" HEAD`,
    log,
    { signal },
  );

  await run(sandbox, `cp "${MAIN_DIR}/.env" "${WORKTREE_DIR}/.env" 2>/dev/null || true`, log, { throwOnError: false, signal });

  const mergeResult = await run(
    sandbox,
    `git -C "${WORKTREE_DIR}" merge origin/${branch} --no-edit 2>&1 || true`,
    log,
    { throwOnError: false, signal },
  );
  const mergeOutput = mergeResult.stdout + mergeResult.stderr;

  if (mergeOutput.includes("CONFLICT") || mergeOutput.includes("fix conflicts")) {
    log("⚠ Merge conflicts, resolving...");
    checkAbort(signal);
    await resolveConflicts(sandbox, WORKTREE_DIR, log);
  }
}
