import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { UpdateContext } from "@/manage/update/runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SANDBOX_DIR = resolve(__dirname, "../sandbox");

export default async function ({ sandbox, run, log }: UpdateContext) {
  const healerContent = readFileSync(resolve(SANDBOX_DIR, "healer.mts"), "utf-8");
  await sandbox.files.write("/home/user/healer.mts", healerContent);
  log("Uploaded healer.mts");

  const ecosystemContent = readFileSync(resolve(SANDBOX_DIR, "ecosystem.config.cjs"), "utf-8");
  await sandbox.files.write("/home/user/ecosystem.config.cjs", ecosystemContent);
  log("Updated ecosystem.config.cjs");

  const startContent = readFileSync(resolve(SANDBOX_DIR, "start.sh"), "utf-8");
  await sandbox.files.write("/home/user/start.sh", startContent);
  await run("chmod +x /home/user/start.sh");
  log("Updated start.sh");

  // The new ecosystem config uses merged logs (merge_logs: true) instead of
  // separate out/err files. Remove the now-orphaned split files before restart.
  await run(
    "rm -f /home/user/shmastra/.logs/shmastra-out.log /home/user/shmastra/.logs/shmastra-error.log /home/user/shmastra/.logs/healer-out.log /home/user/shmastra/.logs/healer-error.log",
    { throwOnError: false },
  );
  log("Removed old split log files");
}
