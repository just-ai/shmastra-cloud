import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../../sandbox.mjs";
import { MAIN_DIR, ensurePm2Running, type PhaseCtx } from "./shared.mjs";

const BOOTSTRAP_FILES: Array<{ local: string; remote: string; executable?: boolean }> = [
  { local: "../../../scripts/sandbox/healer.mts", remote: "/home/user/healer.mts" },
  { local: "../../../scripts/sandbox/ecosystem.config.cjs", remote: "/home/user/ecosystem.config.cjs" },
  { local: "../../../scripts/sandbox/start.sh", remote: "/home/user/start.sh", executable: true },
];

// Upload latest sandbox-side bootstrap files, run Mastra DB migrations,
// then start shmastra + healer via pm2.
export async function restartPhase({ sandbox, log, signal, pendingEnvs }: PhaseCtx): Promise<void> {
  for (const { local, remote, executable } of BOOTSTRAP_FILES) {
    const localPath = fileURLToPath(new URL(local, import.meta.url));
    const content = readFileSync(localPath, "utf-8");
    log(`Uploading ${remote}...`);
    await sandbox.files.write(remote, content, { user: "user" });
    if (executable) {
      await run(sandbox, `chmod +x ${remote}`, log, { throwOnError: false, signal });
    }
  }

  // Back up .storage (SQLite dbs — not in git, so they need live migration)
  // and run `mastra migrate` against the new schema before relaunching pm2.
  log("Backing up .storage → ~/.backup ...");
  await run(
    sandbox,
    `if [ -d "${MAIN_DIR}/.storage" ]; then rm -rf "$HOME/.backup" && cp -r "${MAIN_DIR}/.storage" "$HOME/.backup"; else echo "no .storage to back up"; fi`,
    log,
    { throwOnError: false, signal },
  );

  log("Running mastra migrate...");
  await run(sandbox, `cd "${MAIN_DIR}" && npx mastra migrate -y`, log, {
    timeoutMs: 180_000,
    signal,
  });

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
