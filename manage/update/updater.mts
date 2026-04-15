import { Sandbox } from "e2b";
import { supabase } from "../env.mjs";
import {
  run,
  checkAbort,
  AbortError,
  type SandboxInstance,
  type LogFn,
} from "../sandbox.mjs";
import { resolveConflicts } from "./conflicts.mjs";
import { runPatches } from "./runner.mjs";

const MAIN_DIR = "/home/user/shmastra";
const WORKTREE_DIR = "/home/user/merge";
const WORKTREE_BRANCH = "merge-main";

async function ensurePm2Running(sandbox: SandboxInstance, log: LogFn) {
  // Delete all first to avoid duplicate processes
  await run(sandbox, "pm2 delete all 2>/dev/null || true", log, { throwOnError: false });
  await run(sandbox, "/home/user/start.sh", log, { throwOnError: false });
}

async function cleanup(sandbox: SandboxInstance, log: LogFn) {
  await run(sandbox, `rm -rf "${WORKTREE_DIR}"`, log, { throwOnError: false });
  await run(sandbox, `git -C "${MAIN_DIR}" worktree prune`, log, { throwOnError: false });
  await run(sandbox, `git -C "${MAIN_DIR}" branch -D ${WORKTREE_BRANCH} 2>/dev/null || true`, log, {
    throwOnError: false,
  });
}

export type UpdateStatus = "pending" | "running" | "success" | "error" | "stopped";

export interface UpdateResult {
  sandboxId: string;
  status: UpdateStatus;
  elapsed: number;
  error?: string;
}

export const UPDATE_PHASES = ["connect", "setup", "fetch", "merge", "install", "build", "apply", "patch", "restart"] as const;
export type UpdatePhase = (typeof UPDATE_PHASES)[number];

export async function updateSandbox(
  sandboxId: string,
  log: LogFn,
  onStatus?: (status: UpdateStatus) => void,
  signal?: AbortSignal,
  onPhase?: (phase: UpdatePhase) => void,
): Promise<UpdateResult> {
  const startTime = Date.now();
  const elapsed = () => (Date.now() - startTime) / 1000;

  onStatus?.("running");
  onPhase?.("connect");

  let sandbox: SandboxInstance;
  try {
    sandbox = await Sandbox.connect(sandboxId, { timeoutMs: 10 * 60 * 1000 });
  } catch (err: any) {
    log(`✗ Failed to connect: ${err.message}`);
    onStatus?.("error");
    return { sandboxId, status: "error", elapsed: elapsed(), error: err.message };
  }

  try {
    // ── setup ──
    onPhase?.("setup");

    await run(
      sandbox,
      `git -C "${MAIN_DIR}" config user.email "sandbox@shmastra.ai" && git -C "${MAIN_DIR}" config user.name "Shmastra Sandbox"`,
      log,
      { throwOnError: false },
    );

    checkAbort(signal);

    // ── fetch ──
    onPhase?.("fetch");

    await cleanup(sandbox, log);
    await run(sandbox, `git -C "${MAIN_DIR}" merge --abort 2>/dev/null || true`, log, {
      throwOnError: false,
    });

    await run(sandbox, `git -C "${MAIN_DIR}" add -A`, log, { throwOnError: false });
    await run(
      sandbox,
      `git -C "${MAIN_DIR}" diff --cached --quiet || git -C "${MAIN_DIR}" commit -m "Local changes"`,
      log,
      { throwOnError: false },
    );

    checkAbort(signal);

    await run(sandbox, `git -C "${MAIN_DIR}" fetch origin`, log, { throwOnError: false });

    const behindResult = await run(
      sandbox,
      `git -C "${MAIN_DIR}" rev-list HEAD..origin/main --count`,
      log,
      { throwOnError: false },
    );
    const behind = parseInt(behindResult.stdout.trim(), 10);
    if (behind === 0) {
      log("Already up to date.");
      if (supabase) {
        await runPatches(sandbox, sandboxId, supabase, log, signal, () => onPhase?.("patch"));
      }
      onPhase?.("restart");
      await ensurePm2Running(sandbox, log);
      const e = elapsed();
      log(`✓ Done in ${e.toFixed(1)}s.`);
      onStatus?.("success");
      return { sandboxId, status: "success", elapsed: e };
    }

    checkAbort(signal);

    // ── merge ──
    onPhase?.("merge");

    log(`${behind} commit(s) behind origin/main, updating...`);

    await run(
      sandbox,
      `git -C "${MAIN_DIR}" worktree add -b ${WORKTREE_BRANCH} "${WORKTREE_DIR}" HEAD`,
      log,
    );

    await run(sandbox, `cp "${MAIN_DIR}/.env" "${WORKTREE_DIR}/.env" 2>/dev/null || true`, log, { throwOnError: false });

    const mergeResult = await run(
      sandbox,
      `git -C "${WORKTREE_DIR}" merge origin/main --no-edit 2>&1 || true`,
      log,
      { throwOnError: false },
    );
    const mergeOutput = mergeResult.stdout + mergeResult.stderr;

    if (mergeOutput.includes("CONFLICT") || mergeOutput.includes("fix conflicts")) {
      log("⚠ Merge conflicts, resolving...");
      checkAbort(signal);
      await resolveConflicts(sandbox, WORKTREE_DIR, log);
    }

    checkAbort(signal);

    // ── install ──
    onPhase?.("install");

    await run(sandbox, `cd "${WORKTREE_DIR}" && pnpm install`, log, {
      throwOnError: true,
      timeoutMs: 180_000,
    });

    checkAbort(signal);

    // ── build ──
    onPhase?.("build");

    await run(sandbox, `cd "${WORKTREE_DIR}" && (pnpm dry-run > /tmp/dry-run.log 2>&1; echo $? > /tmp/dry-run-exit)`, log, {
      timeoutMs: 180_000,
    });
    const dryRunLog = await sandbox.files.read("/tmp/dry-run.log").catch(() => "");
    if (dryRunLog.trim()) log(dryRunLog.trim());
    const dryRunExit = (await sandbox.files.read("/tmp/dry-run-exit").catch(() => "1")).trim();
    if (dryRunExit !== "0") {
      throw new Error(`dry-run failed (exit ${dryRunExit})`);
    }

    checkAbort(signal);

    await run(
      sandbox,
      `git -C "${WORKTREE_DIR}" add -A && git -C "${WORKTREE_DIR}" diff --cached --quiet || git -C "${WORKTREE_DIR}" commit -m "Update lockfile after merge"`,
      log,
      { throwOnError: false },
    );

    // ── apply ──
    onPhase?.("apply");

    checkAbort(signal);

    await run(sandbox, "pm2 delete all 2>/dev/null || true", log, { throwOnError: false });
    await run(
      sandbox,
      "kill -9 $(pgrep -x node) $(pgrep -x pnpm) $(pgrep -x esbuild) 2>/dev/null || true",
      log,
      { throwOnError: false },
    );

    await run(sandbox, `git -C "${MAIN_DIR}" merge ${WORKTREE_BRANCH} --ff-only`, log);

    await run(sandbox, `cd "${MAIN_DIR}" && pnpm install`, log, {
      throwOnError: false,
      timeoutMs: 180_000,
    });

    await cleanup(sandbox, log);

    // ── patch ──
    if (supabase) {
      await runPatches(sandbox, sandboxId, supabase, log, signal, () => onPhase?.("patch"));
    }

    // ── restart ──
    onPhase?.("restart");

    await ensurePm2Running(sandbox, log);

    const e = elapsed();
    log(`✓ Updated in ${e.toFixed(1)}s.`);
    onStatus?.("success");
    return { sandboxId, status: "success", elapsed: e };
  } catch (err: any) {
    const stopped = err instanceof AbortError;
    if (stopped) {
      log("⏹ Update stopped.");
    } else {
      log(`✗ Error: ${err.message}`);
    }
    await cleanup(sandbox, log);
    await ensurePm2Running(sandbox, log);
    const e = elapsed();
    const status: UpdateStatus = stopped ? "stopped" : "error";
    onStatus?.(status);
    return { sandboxId, status, elapsed: e, error: stopped ? undefined : err.message };
  }
}
