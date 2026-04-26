import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_DIR, ensurePm2Running, type PhaseCtx } from "./shared.mjs";

const BOOTSTRAP_FILES: Array<{ local: string; remote: string; executable?: boolean }> = [
  { local: "../../../scripts/sandbox/healer.mts", remote: "/home/user/healer.mts" },
  { local: "../../../scripts/sandbox/ecosystem.config.cjs", remote: "/home/user/ecosystem.config.cjs" },
  { local: "../../../scripts/sandbox/start.sh", remote: "/home/user/start.sh", executable: true },
];

const STAGE_DIR = `${WORKTREE_DIR}/.storage`;

// Upload latest sandbox-side bootstrap files, swap any migrated .duckdb files
// from the worktree staging dir into MAIN_DIR (atomic window between pm2-stop
// in applyPhase and pm2-start here), then start shmastra + healer via pm2.
export async function restartPhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  const pendingEnvs = state.pendingEnvs;
  for (const { local, remote, executable } of BOOTSTRAP_FILES) {
    const localPath = fileURLToPath(new URL(local, import.meta.url));
    const content = readFileSync(localPath, "utf-8");
    log(`Uploading ${remote}...`);
    await sandbox.files.write(remote, content, { user: "user" });
    if (executable) {
      await run(sandbox, `chmod +x ${remote}`, log, { throwOnError: false, signal });
    }
  }

  // Swap migrated observability DBs back into MAIN_DIR. migratePhase leaves
  // staged copies in WORKTREE/.storage iff a migration ran; otherwise it
  // removes the dir so we know "no files to swap" by file existence alone.
  const stagedCheck = await run(
    sandbox,
    `ls ${STAGE_DIR}/*.duckdb 2>/dev/null | head -1`,
    log,
    { throwOnError: false, signal },
  );
  if (stagedCheck.stdout.trim()) {
    log("Swapping migrated observability DBs into MAIN_DIR/.storage...");
    await run(
      sandbox,
      `mkdir -p ${MAIN_DIR}/.storage && cp -p ${STAGE_DIR}/*.duckdb ${MAIN_DIR}/.storage/`,
      log,
      { signal },
    );
  }

  const additions = pendingEnvs ?? {};
  if (Object.keys(additions).length === 0) {
    await ensurePm2Running(sandbox, log, signal);
    return;
  }

  // enrichSandbox already merges the (filtered) daemon env into every
  // commands.run, so passing just the additions is enough — they'll layer on
  // top of the existing env when the new daemon is spawned by start.sh.
  log(`Applying ${Object.keys(additions).length} new env(s): ${Object.keys(additions).join(", ")}`);
  await run(sandbox, "pm2 kill 2>/dev/null || true; /home/user/start.sh", log, {
    envs: additions,
    timeoutMs: 120_000,
    signal,
  });
}
