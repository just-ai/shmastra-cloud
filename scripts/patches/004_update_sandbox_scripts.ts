import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { UpdateContext } from "@/manage/runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SANDBOX_DIR = resolve(__dirname, "../sandbox");

export default async function ({ sandbox, run, log }: UpdateContext) {
  // Upload updated ecosystem config (merged log files)
  const ecosystemContent = readFileSync(resolve(SANDBOX_DIR, "ecosystem.config.cjs"), "utf-8");
  await sandbox.files.write("/home/user/ecosystem.config.cjs", ecosystemContent);
  log("Updated ecosystem.config.cjs");

  // Upload updated start.sh
  const startContent = readFileSync(resolve(SANDBOX_DIR, "start.sh"), "utf-8");
  await sandbox.files.write("/home/user/start.sh", startContent);
  await run("chmod +x /home/user/start.sh");
  log("Updated start.sh");

  // Upload updated healer.mts
  const healerContent = readFileSync(resolve(SANDBOX_DIR, "healer.mts"), "utf-8");
  await sandbox.files.write("/home/user/healer.mts", healerContent);
  log("Updated healer.mts");

  // Clean up old separate log files
  await run("rm -f /home/user/shmastra/.logs/shmastra-out.log /home/user/shmastra/.logs/shmastra-error.log /home/user/shmastra/.logs/healer-out.log /home/user/shmastra/.logs/healer-error.log", { throwOnError: false });
  log("Removed old split log files");

  // Restart pm2 cleanly (delete all first to avoid duplicates)
  await run("pm2 delete all 2>/dev/null || true", { throwOnError: false });
  await run("pm2 start /home/user/ecosystem.config.cjs");
  log("Restarted pm2 with merged log config");
}
