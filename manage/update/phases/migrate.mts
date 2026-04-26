import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../../sandbox.mjs";
import { MAIN_DIR, WORKTREE_DIR, skipIfUpToDate, type PhaseCtx } from "./shared.mjs";

// Migration runs AFTER build (the slow phase) so the user's app stays on old
// code with pm2 alive throughout the install/build window. Once build is
// green we stop pm2, snapshot .duckdb files, migrate the snapshot in the
// worktree (which has fresh new-version node_modules), and copy migrated
// files back into MAIN_DIR/.storage. pm2 stays down — apply, patch and
// restart all run in a single down-window before pm2 comes back up on new
// code in restartPhase.
//
// Why stop pm2 before snapshot: DuckDB writes go through a WAL file. While
// pm2 has the .duckdb open, recent writes live only in the WAL — a raw
// `cp *.duckdb` would silently miss them, the staged copy would look like
// an empty DB, and the migration would report "Migration not needed" while
// the live file in MAIN_DIR still contained legacy schema (post-update
// server start would then fail with "MIGRATION REQUIRED"). Stopping pm2
// lets DuckDB checkpoint cleanly; we also glob `*.duckdb*` to pick up any
// leftover .wal/.tmp companions as defense-in-depth.
//
// Why `rm -rf` the stage dir first: buildPhase ran `pnpm dry-run` in the
// worktree, which uses `./.storage` by default and may have left
// new-schema empty DBs there. We wipe before snapshotting so the migration
// input is exactly MAIN_DIR/.storage at this instant.
//
// The migration script itself lives in scripts/sandbox/migration.mts and is
// uploaded into the worktree just-in-time (same pattern as healer.mts).

const SCRIPT_LOCAL = fileURLToPath(
  new URL("../../../scripts/sandbox/migration.mts", import.meta.url),
);
const SCRIPT_REMOTE = `${WORKTREE_DIR}/migration.mts`;
const STAGE_DIR = `${WORKTREE_DIR}/.storage`;
// Pre-migration .duckdb snapshot — kept aside so updater.mts can roll back
// MAIN_DIR if a later phase (apply/patch/restart) fails after the migration
// already swapped new-schema DBs into place. Lives in worktree, so the
// updater's `finally` cleanup wipes it on success or after a successful
// restore. Only populated on `state.observabilityBackupDir` when an actual
// migration ran.
const BACKUP_DIR = `${WORKTREE_DIR}/.storage-backup`;

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
    `rm -rf ${STAGE_DIR} && mkdir -p ${STAGE_DIR} && (cp -p ${MAIN_DIR}/.storage/*.duckdb* ${STAGE_DIR}/ 2>/dev/null || true)`,
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

    // Capture the pre-migration .duckdb set BEFORE the swap. MAIN_DIR still
    // has the original (legacy-schema) files at this instant. We hand the
    // path to updater.mts via state so its catch block can roll back if a
    // later phase fails.
    log("Backing up pre-migration .duckdb set for rollback...");
    await run(
      sandbox,
      `mkdir -p ${BACKUP_DIR} && cp -p ${MAIN_DIR}/.storage/*.duckdb* ${BACKUP_DIR}/ 2>/dev/null || true`,
      log,
      { signal },
    );
    state.observabilityBackupDir = BACKUP_DIR;

    log(`Swapping migrated DBs (${migratedFiles}) into MAIN_DIR/.storage...`);
    // Wipe ALL .duckdb* files in MAIN_DIR before the copy and bring the
    // full STAGE_DIR set (including any .wal/.tmp companions) over:
    //   - MAIN_DIR's stale .wal/.tmp must go — pm2 was SIGKILLed, so any
    //     orphaned WAL there would replay on top of the migrated base file
    //     on restart and trip "MIGRATION REQUIRED" again.
    //   - STAGE_DIR's .wal acts as defense-in-depth in case migration's
    //     CHECKPOINT didn't fully fold every page into .duckdb. Copying
    //     the whole `*.duckdb*` set keeps MAIN_DIR byte-identical to the
    //     post-migration STAGE_DIR.
    await run(
      sandbox,
      `mkdir -p ${MAIN_DIR}/.storage && rm -f ${MAIN_DIR}/.storage/*.duckdb* && cp -p ${STAGE_DIR}/*.duckdb* ${MAIN_DIR}/.storage/`,
      log,
      { signal },
    );
    log("✓ Migration applied");
  } else {
    log(`✓ Migration not needed (${outcome.reason ?? "all files already migrated"})`);
  }
}
