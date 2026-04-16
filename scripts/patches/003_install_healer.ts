import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { UpdateContext } from "@/manage/update/runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SANDBOX_DIR = resolve(__dirname, "../sandbox");

export default async function ({ sandbox, run, log }: UpdateContext) {
  // Upload healer script
  const healerContent = readFileSync(resolve(SANDBOX_DIR, "healer.mts"), "utf-8");
  await sandbox.files.write("/home/user/healer.mts", healerContent);
  log("Uploaded healer.mts");

  // Upload updated ecosystem config
  const ecosystemContent = readFileSync(resolve(SANDBOX_DIR, "ecosystem.config.cjs"), "utf-8");
  await sandbox.files.write("/home/user/ecosystem.config.cjs", ecosystemContent);
  log("Updated ecosystem.config.cjs");

  // Symlink node_modules so healer.mts can resolve @mastra/* imports
  await run("ln -sf /home/user/shmastra/node_modules /home/user/node_modules");
  log("Symlinked node_modules");

  // Restart pm2 to pick up new config
  await run("pm2 delete all 2>/dev/null || true", { throwOnError: false });
  await run("pm2 start /home/user/ecosystem.config.cjs");
  log("Restarted pm2 with healer process");
}
