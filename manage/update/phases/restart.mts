import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../../sandbox.mjs";
import { ensurePm2Running, type PhaseCtx } from "./shared.mjs";

const BOOTSTRAP_FILES: Array<{ local: string; remote: string; executable?: boolean }> = [
  { local: "../../../scripts/sandbox/healer.mts", remote: "/home/user/healer.mts" },
  { local: "../../../scripts/sandbox/ecosystem.config.cjs", remote: "/home/user/ecosystem.config.cjs" },
  { local: "../../../scripts/sandbox/start.sh", remote: "/home/user/start.sh", executable: true },
];

// Upload latest sandbox-side bootstrap files, then start shmastra + healer
// via pm2. pm2 has been down since migratePhase — apply and patch ran while
// it was off — so this is the single bring-up on new code at the end of the
// pipeline.
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
