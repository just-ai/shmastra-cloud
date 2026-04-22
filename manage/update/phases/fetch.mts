import { run, checkAbort } from "../../sandbox.mjs";
import { MAIN_DIR, cleanup, updateBranch, type PhaseCtx } from "./shared.mjs";

// Configure git, clean worktree, pull origin/<branch>, stash the resulting
// commits-behind count on ctx.state so downstream phases can decide whether
// to run or skip.
export async function fetchPhase(ctx: PhaseCtx): Promise<void> {
  const { sandbox, log, signal, state } = ctx;
  const branch = updateBranch();

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
  state.behind = parseInt(behindResult.stdout.trim(), 10) || 0;
  if (state.behind === 0) {
    log("Already up to date.");
  } else {
    log(`${state.behind} new commit(s) on origin/${branch}.`);
  }
}
