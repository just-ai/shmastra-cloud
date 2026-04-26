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
  behind?: number;
  pendingEnvs?: Record<string, string>;
  // Set by migratePhase to true iff a real observability migration ran and
  // staged DBs were left in WORKTREE_DIR/.storage. restartPhase reads this to
  // decide whether to do the swap into MAIN_DIR/.storage.
  observabilityMigrated?: boolean;
}

export interface PhaseCtx {
  sandbox: SandboxInstance;
  sandboxId: string;
  log: LogFn;
  signal?: AbortSignal;
  state: UpdateState;
}

export type PhaseFn = (ctx: PhaseCtx) => Promise<void>;

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
