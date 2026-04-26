import { run, type SandboxInstance, type LogFn } from "../../sandbox.mjs";

export const MAIN_DIR = "/home/user/shmastra";
export const WORKTREE_DIR = "/home/user/merge";
export const WORKTREE_BRANCH = "merge-main";

// Remote branch to pull updates from. Override via SANDBOX_UPDATE_BRANCH in .env*.
export function updateBranch(): string {
  const raw = (process.env.SANDBOX_UPDATE_BRANCH || "main").trim();
  // Guard against shell injection — branch names should be shell-safe.
  if (!/^[A-Za-z0-9._\/-]+$/.test(raw)) {
    throw new Error(`Invalid SANDBOX_UPDATE_BRANCH: ${raw}`);
  }
  return raw;
}

export type PhaseStatus = "running" | "done" | "skipped" | "error";

// Thrown by a phase when it decides it has nothing to do. The driver treats
// this as a non-error transition to the next phase and reports it to the UI.
export class SkipPhase extends Error {
  constructor(reason?: string) {
    super(reason ?? "phase skipped");
    this.name = "SkipPhase";
  }
}

// Shared state passed between phases. Each phase writes what later phases
// depend on (and earlier phases shouldn't need to know about).
export interface UpdateState {
  // True iff fetchPhase saw HEAD already at origin/<branch>. Most phases
  // short-circuit via skipIfUpToDate() when this is set; patch and restart
  // run regardless because they sync cloud-managed artifacts (MCP config,
  // skills, bootstrap files) that may have changed in the cloud independent
  // of the user's repo.
  upToDate?: boolean;
  pendingEnvs?: Record<string, string>;
  // Path to a worktree-side backup of MAIN_DIR/.storage/*.duckdb* taken
  // immediately before migratePhase swapped a migrated DB set into MAIN_DIR.
  // Set only when a real migration actually ran. updater.mts reads this in
  // its catch block: if a later phase (apply/patch/restart) fails, we
  // restore the pre-migration .duckdb files so pm2 doesn't come back up
  // with new schema + old code (the schema change is destructive — signal
  // tables are recreated, not just altered — so leaving it in place after
  // a failed update breaks the running app).
  observabilityBackupDir?: string;
  // MAIN_DIR's HEAD captured at the start of applyPhase, just before the
  // ff-only merge. Set only when apply has actually started. updater.mts
  // reads this in its catch block: if apply (or any later phase) fails
  // after the merge advanced HEAD, we `git reset --hard` and reinstall to
  // bring MAIN_DIR back to the pre-update commit + matching node_modules.
  // Symmetric to observabilityBackupDir for the .duckdb files.
  preUpdateHead?: string;
}

export interface PhaseCtx {
  sandbox: SandboxInstance;
  sandboxId: string;
  log: LogFn;
  signal?: AbortSignal;
  state: UpdateState;
}

export type PhaseFn = (ctx: PhaseCtx) => Promise<void>;

// Common guard: most code-update phases (merge, install, build, apply,
// migrate) have nothing to do when the sandbox is already on the latest
// commit. Throwing SkipPhase here lets the driver report it as a clean skip
// in the UI instead of a no-op success.
export function skipIfUpToDate(state: UpdateState): void {
  if (state.upToDate) throw new SkipPhase("already up to date");
}

export async function ensurePm2Running(sandbox: SandboxInstance, log: LogFn, signal?: AbortSignal) {
  // Delete all first to avoid duplicate processes
  await run(sandbox, "pm2 delete all 2>/dev/null || true", log, { throwOnError: false, signal });
  await run(sandbox, "/home/user/start.sh", log, { throwOnError: false, signal });
}

export async function cleanup(sandbox: SandboxInstance, log: LogFn, signal?: AbortSignal) {
  await run(sandbox, `rm -rf "${WORKTREE_DIR}"`, log, { throwOnError: false, signal });
  await run(sandbox, `git -C "${MAIN_DIR}" worktree prune`, log, { throwOnError: false, signal });
  await run(sandbox, `git -C "${MAIN_DIR}" branch -D ${WORKTREE_BRANCH} 2>/dev/null || true`, log, {
    throwOnError: false,
    signal,
  });
}
