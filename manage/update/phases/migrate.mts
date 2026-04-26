import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_DIR, skipIfUpToDate, type PhaseCtx } from "./shared.mjs";

// Migration runs against COPIES of the .duckdb files staged in the worktree:
//   - Worktree has fresh node_modules from installPhase (correct @mastra/duckdb).
//   - Original .duckdb files in MAIN_DIR/.storage stay untouched on failure.
//   - On success, restartPhase copies the migrated files back to MAIN_DIR
//     between pm2-stop and pm2-start (atomic swap window).
//   - On failure, throw → updater catches → cleanup() in finally wipes the
//     worktree → MAIN_DIR is untouched → user retries the update.
//
// The migration script itself lives in scripts/sandbox/migration.mts and is
// uploaded into the worktree just-in-time (same pattern as healer.mts).

const SCRIPT_LOCAL = fileURLToPath(
  new URL("../../../scripts/sandbox/migration.mts", import.meta.url),
);
const SCRIPT_REMOTE = `${WORKTREE_DIR}/migration.mts`;
const STAGE_DIR = `${WORKTREE_DIR}/.storage`;

export async function migratePhase({ sandbox, log, signal, state }: PhaseCtx): Promise<void> {
  skipIfUpToDate(state);

  const scriptContent = readFileSync(SCRIPT_LOCAL, "utf-8");
  await sandbox.files.write(SCRIPT_REMOTE, scriptContent, { user: "user" });

  log("Snapshotting .storage/*.duckdb to worktree...");
  await run(
    sandbox,
    `mkdir -p ${STAGE_DIR} && (cp -p ${MAIN_DIR}/.storage/*.duckdb ${STAGE_DIR}/ 2>/dev/null || true)`,
    log,
    { signal },
  );

  log("Running observability migration in worktree...");
  const result = await run(
    sandbox,
    `cd ${WORKTREE_DIR} && node --experimental-strip-types migration.mts ${STAGE_DIR}`,
    log,
    { timeoutMs: 120_000, throwOnError: false, signal },
  );

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Observability migration failed: ${detail}`);
  }

  let outcome: { migrated: boolean; files?: any[]; reason?: string };
  try {
    outcome = JSON.parse(result.stdout.trim());
  } catch (err: any) {
    throw new Error(`Migration script produced invalid JSON: ${err.message}\n${result.stdout}`);
  }

  if (outcome.migrated) {
    const migratedFiles = (outcome.files ?? [])
      .filter((f: any) => f.migrated)
      .map((f: any) => f.file)
      .join(", ");
    log(`✓ Migration applied — staged DBs (${migratedFiles}) will be swapped in restart phase`);
    state.observabilityMigrated = true;
  } else {
    log(`✓ Migration not needed (${outcome.reason ?? "all files already migrated"})`);
    // No flag set — restartPhase skips the swap and the stale staging dir
    // dies along with the worktree in updater's `finally` cleanup.
  }
}
