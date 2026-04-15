#!/usr/bin/env node

/**
 * Sandbox manager — CLI, web UI, and agent modes.
 *
 * Usage:
 *   npx tsx manage/index.mts <sandbox_id>        # update one sandbox
 *   npx tsx manage/index.mts                     # update all sandboxes
 *   npx tsx manage/index.mts --serve [port]      # start web UI (default 3737)
 *   npx tsx manage/index.mts --agent <sandbox_id> # interactive agent CLI
 *
 * Requires in .env.local: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2B_API_KEY, ANTHROPIC_API_KEY
 */

import { supabase } from "./env.mjs";
import { fetchSandboxes, type LogFn } from "./sandbox.mjs";
import { updateSandbox } from "./update/updater.mjs";

const args = process.argv.slice(2);

if (args[0] === "--serve") {
  if (!supabase) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }
  const port = parseInt(args[1] || "3737", 10);
  const { startServer } = await import("./server.mjs");
  startServer(port);
} else if (args[0] === "--agent") {
  const sandboxId = args[1];
  if (!sandboxId) {
    console.error("Usage: --agent <sandbox_id>");
    process.exit(1);
  }
  const { cliAgentMode } = await import("./agent/cli.mjs");
  await cliAgentMode(sandboxId);
} else if (args[0]) {
  // Update single sandbox
  const sandboxId = args[0];
  const log: LogFn = (msg) => console.log(`  ${msg}`);
  console.log(`Updating sandbox ${sandboxId}...`);
  const result = await updateSandbox(sandboxId, log);
  process.exit(result.status === "success" ? 0 : 1);
} else {
  // Update all sandboxes
  if (!supabase) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }
  console.log("Fetching sandboxes...");
  const entries = await fetchSandboxes();
  console.log(`Found ${entries.length} sandboxes.`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const { sandboxId, email } = entries[i];
    console.log(`\n=== [${i + 1}/${entries.length}] ${sandboxId} (${email}) ===`);
    const log: LogFn = (msg) => console.log(`  ${msg}`);
    const result = await updateSandbox(sandboxId, log);
    if (result.status === "success") succeeded++;
    else failed++;
  }

  console.log(`\nDone. Succeeded: ${succeeded}, Failed: ${failed}`);
}
