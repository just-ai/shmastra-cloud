#!/usr/bin/env node

// Stand-alone entry point for merge-conflict resolution. Spawned by
// `lib/project-bootstrap.ts` as a child process when a re-provision merge
// hits conflicts. We run as a separate `tsx` process so the heavy Mastra /
// Anthropic deps don't have to be bundled into Next.js routes.
//
// Usage: npx tsx manage/resolve-merge.mts <sandboxId> <workdir>
// Exit code 0 = resolved, non-zero = failed (stderr has details).

import "./env.mjs"; // loads dotenv before anything touches process.env
import { connectSandbox } from "./sandbox.mjs";
import { resolveConflicts } from "./update/conflicts.mjs";

const [sandboxId, workdir] = process.argv.slice(2);
if (!sandboxId || !workdir) {
  console.error("Usage: resolve-merge.mts <sandboxId> <workdir>");
  process.exit(2);
}

const log = (msg: string) => process.stderr.write(`${msg}\n`);

try {
  const sandbox = await connectSandbox(sandboxId);
  const resolved = await resolveConflicts(sandbox, workdir, log);
  if (!resolved) {
    log("No conflicts to resolve");
  }
  process.exit(0);
} catch (err) {
  log(`Resolver failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
