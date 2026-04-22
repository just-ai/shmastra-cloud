import { run, AbortError } from "../../sandbox.mjs";
import { MAIN_DIR, type PhaseCtx } from "./shared.mjs";

const BACKUP_DIR = "$HOME/.backup";

// Back up the sandbox's local SQLite dbs (.storage is gitignored) and run
// `mastra migrate` against the new schema. On failure, restore the backup
// so the phase failure in updater.mts leaves the sandbox in a runnable state.
export async function migratePhase({ sandbox, log, signal }: PhaseCtx): Promise<void> {
  log("Backing up .storage → ~/.backup ...");
  await run(
    sandbox,
    `if [ -d "${MAIN_DIR}/.storage" ]; then rm -rf "${BACKUP_DIR}" && cp -r "${MAIN_DIR}/.storage" "${BACKUP_DIR}"; else echo "no .storage to back up"; fi`,
    log,
    { throwOnError: false, signal },
  );

  log("Running mastra migrate...");
  try {
    await run(sandbox, `cd "${MAIN_DIR}" && npx mastra migrate -y`, log, {
      timeoutMs: 180_000,
      signal,
    });
  } catch (err) {
    if (err instanceof AbortError) throw err;
    log("✗ Migration failed, restoring .storage from ~/.backup ...");
    await run(
      sandbox,
      `if [ -d "${BACKUP_DIR}" ]; then rm -rf "${MAIN_DIR}/.storage" && mv "${BACKUP_DIR}" "${MAIN_DIR}/.storage"; else echo "no backup to restore"; fi`,
      log,
      { throwOnError: false },
    );
    throw err;
  }

  await run(sandbox, `rm -rf "${BACKUP_DIR}"`, log, { throwOnError: false, signal });
}
