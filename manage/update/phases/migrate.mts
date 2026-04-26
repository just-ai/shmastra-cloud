import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_DIR, skipIfUpToDate, type PhaseCtx } from "./shared.mjs";

// Migration runs against COPIES of the .duckdb files staged in the worktree:
//   - Worktree has fresh node_modules from installPhase (correct @mastra/duckdb).
//   - Original .duckdb files in MAIN_DIR/.storage stay untouched on failure.
//   - On success, restartPhase copies the migrated files back to MAIN_DIR.
//   - On failure, throw → updater catches → cleanup() in finally wipes the
//     worktree → MAIN_DIR is untouched → user retries the update.
//
// PM2 is killed *before* the snapshot. DuckDB writes go through a WAL file;
// while pm2 has the .duckdb open, recent writes live only in the WAL and a
// raw `cp *.duckdb` would silently miss them — the staged copy then looks
// like an empty DB and the migration script reports "no signal tables, no
// migration needed", but the live file in MAIN_DIR still contains legacy
// schema and the post-update server start fails with "MIGRATION REQUIRED".
// Killing pm2 lets DuckDB checkpoint cleanly, then we glob `*.duckdb*` to
// pick up any leftover .wal/.tmp companions as a defense-in-depth measure.
//
// applyPhase no longer kills pm2 itself — once we're inside migrate, pm2
// stays down for the rest of the update and restartPhase brings it back up.
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

  log("Stopping pm2 so DuckDB can flush its WAL before snapshot...");
  await run(sandbox, "pm2 delete all 2>/dev/null || true", log, { throwOnError: false, signal });
  await run(
    sandbox,
    "kill -9 $(pgrep -x node) $(pgrep -x pnpm) $(pgrep -x esbuild) 2>/dev/null || true",
    log,
    { throwOnError: false, signal },
  );

  log("Snapshotting .storage/*.duckdb (incl. WAL/tmp companions) to worktree...");
  await run(
    sandbox,
    `mkdir -p ${STAGE_DIR} && (cp -p ${MAIN_DIR}/.storage/*.duckdb* ${STAGE_DIR}/ 2>/dev/null || true)`,
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
