import { run, type SandboxInstance, type LogFn } from "../../sandbox.mjs";

export const MAIN_DIR = "/home/user/shmastra";
export const WORKTREE_DIR = "/home/user/merge";
export const WORKTREE_BRANCH = "merge-main";

export const UPDATE_PHASES = ["connect", "fetch", "merge", "install", "build", "apply", "patch", "restart"] as const;
export type UpdatePhase = (typeof UPDATE_PHASES)[number];

export interface PhaseCtx {
  sandbox: SandboxInstance;
  sandboxId: string;
  log: LogFn;
  signal?: AbortSignal;
  onPhase?: (phase: UpdatePhase) => void;
  // Envs collected by patches during the `patch` phase, applied by `restart`.
  pendingEnvs?: Record<string, string>;
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
