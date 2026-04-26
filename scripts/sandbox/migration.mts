// Run observability migrations on every .duckdb file in <storage-dir>.
//
// Mastra's `mastra migrate` CLI bundles the entire user project just to call
// `observabilityStore.migrateSpans()` on the configured DuckDB store — that
// bundle+spawn dance is ~30s per update and dominates the migrate phase.
// This script does the same call directly against each .duckdb file in a
// directory, using the public DuckDBStore API exported from the package, and
// completes in a few seconds.
//
// Output: single JSON line on stdout with shape
//   { migrated: boolean, files: [{ file, migrated, message?, reason? }, ...] }
// Exit codes: 0 on success (regardless of whether any migration ran), 2 on
// unexpected failure (caller should abort the update).
//
// Run with: node --experimental-strip-types migration.mts <storage-dir>

import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error(JSON.stringify({ error: "usage: node migration.mts <storage-dir>" }));
  process.exit(2);
}

let DuckDBStore: any;
try {
  ({ DuckDBStore } = await import("@mastra/duckdb"));
} catch {
  // No @mastra/duckdb installed in node_modules. Means the user's project
  // doesn't ship DuckDB observability — nothing to migrate.
  console.log(JSON.stringify({ migrated: false, reason: "no @mastra/duckdb installed" }));
  process.exit(0);
}

let entries: string[];
try {
  entries = readdirSync(dir).filter((f) => f.endsWith(".duckdb"));
} catch (err: any) {
  console.error(JSON.stringify({ error: `cannot list ${dir}: ${err.message}` }));
  process.exit(2);
}

if (entries.length === 0) {
  console.log(JSON.stringify({ migrated: false, reason: "no .duckdb files in dir" }));
  process.exit(0);
}

const files: Array<{ file: string; migrated: boolean; message?: string; reason?: string }> = [];
let anyMigrated = false;

for (const file of entries) {
  const path = join(dir, file);
  let store: any;
  try {
    store = new DuckDBStore({ path });
    const obs = await store.getStore("observability");
    if (typeof obs.migrateSpans !== "function") {
      files.push({ file, migrated: false, reason: "no migrateSpans method on store" });
      continue;
    }
    // NB: do NOT call obs.init() here — in @mastra/duckdb >=1.2.0 init()
    // throws "MIGRATION REQUIRED" before doing anything when legacy signal
    // tables exist, which is precisely the case migrateSpans() is meant to
    // fix. Calling migrateSpans() directly is what `mastra migrate` does
    // too. After migration the running app's startup init() will create
    // any missing tables via CREATE TABLE IF NOT EXISTS.
    const r = await obs.migrateSpans();
    const migrated = !r.alreadyMigrated;
    files.push({ file, migrated, message: r.message });
    if (migrated) anyMigrated = true;
    // Force a CHECKPOINT so all WAL contents (both pre-existing user data
    // replayed from the source WAL and our migration's own writes) are
    // flushed into the .duckdb base file. Without this, close() leaves a
    // .wal next to .duckdb, and the caller copies only *.duckdb back to
    // MAIN_DIR — losing every row that lived only in the WAL (in practice
    // most/all of the user's traces and spans, since DuckDB doesn't
    // auto-checkpoint on graceful close).
    //
    // NB: `obs.db` is an undocumented field on ObservabilityStorageDuckDB
    // (the underlying DuckDBConnection). It's not part of the package's
    // public types — if Mastra makes it private or renames in a future
    // version, switch to opening a fresh DuckDBConnection at the same
    // `path` here just for the CHECKPOINT and close it before
    // `store.close()` below.
    await obs.db.execute("CHECKPOINT");
  } catch (err: any) {
    console.error(JSON.stringify({ error: `${file}: ${err.message}` }));
    process.exit(2);
  } finally {
    try { await store?.close?.(); } catch {}
  }
}

console.log(JSON.stringify({ migrated: anyMigrated, files }));
process.exit(0);
