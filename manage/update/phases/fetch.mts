import { run, checkAbort } from "../../sandbox.mjs";
import { MAIN_DIR, cleanup, updateBranch, type PhaseCtx } from "./shared.mjs";

// Configure git, clean worktree, pull origin/<branch>, stash the resulting
// commits-behind count on ctx.state so downstream phases can decide whether
// to run or skip.
export async function fetchPhase(ctx: PhaseCtx): Promise<void> {
  const { sandbox, log, signal, state } = ctx;
  const branch = updateBranch();

  // Defensive: we've seen a sandbox end up with core.bare=true while still
  // having an intact working tree (provenance unclear — possibly a manual
  // `git config` from inside the sandbox). In that state read-only ops
  // (`rev-parse`, `fetch`, `config`) keep working but anything touching the
  // worktree (`add`, `merge`, `status`, `reset --hard`) dies with
  // "this operation must be run in a work tree". Without this guard the
  // failure surfaces deep in applyPhase as a cryptic exit-128 after we've
  // already burned 30s+ on worktree-add / install / build, and even the
  // post-failure rollback's `git reset --hard` is a no-op. The working tree
  // is intact, so the fix is unambiguous — unset and proceed.
  const bareCheck = await run(
    sandbox,
    `git -C "${MAIN_DIR}" config --get core.bare 2>/dev/null || true`,
    log,
    { throwOnError: false, signal },
  );
  if (bareCheck.stdout.trim() === "true") {
    log("⚠ MAIN_DIR has core.bare=true with a working tree — unsetting.");
    await run(sandbox, `git -C "${MAIN_DIR}" config --unset core.bare`, log, {
      throwOnError: false,
      signal,
    });
  }

  await run(
    sandbox,
    `git -C "${MAIN_DIR}" config user.email "sandbox@shmastra.ai" && git -C "${MAIN_DIR}" config user.name "Shmastra Sandbox"`,
    log,
    { throwOnError: false, signal },
  );

  checkAbort(signal);

  await cleanup(sandbox, log, signal);
  await run(sandbox, `git -C "${MAIN_DIR}" merge --abort 2>/dev/null || true`, log, {
    throwOnError: false,
    signal,
  });

  await run(sandbox, `git -C "${MAIN_DIR}" add -A`, log, { throwOnError: false, signal });
  await run(
    sandbox,
    `git -C "${MAIN_DIR}" diff --cached --quiet || git -C "${MAIN_DIR}" commit -m "Local changes"`,
    log,
    { throwOnError: false, signal },
  );

  checkAbort(signal);

  await run(sandbox, `git -C "${MAIN_DIR}" fetch origin ${branch}`, log, { throwOnError: false, signal });

  const behindResult = await run(
    sandbox,
    `git -C "${MAIN_DIR}" rev-list HEAD..origin/${branch} --count`,
    log,
    { throwOnError: false, signal },
  );
  const behind = parseInt(behindResult.stdout.trim(), 10) || 0;
  state.upToDate = behind === 0;
  if (state.upToDate) {
    log("Already up to date.");
  } else {
    log(`${behind} new commit(s) on origin/${branch}.`);
  }
}
