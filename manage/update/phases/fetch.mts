import { run, checkAbort } from "../../sandbox.mjs";
import { MAIN_DIR, cleanup, type PhaseCtx } from "./shared.mjs";

// Configure git, clean worktree, pull origin/main, return commits behind origin.
export async function fetchPhase(ctx: PhaseCtx): Promise<number> {
  const { sandbox, log, signal } = ctx;

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

  await run(sandbox, `git -C "${MAIN_DIR}" fetch origin`, log, { throwOnError: false, signal });

  const behindResult = await run(
    sandbox,
    `git -C "${MAIN_DIR}" rev-list HEAD..origin/main --count`,
    log,
    { throwOnError: false, signal },
  );
  return parseInt(behindResult.stdout.trim(), 10);
}
