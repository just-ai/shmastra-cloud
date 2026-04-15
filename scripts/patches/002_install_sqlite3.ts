import type { UpdateContext } from "@/manage/runner.mjs";

export default async function ({ run, log }: UpdateContext) {
  log("Installing sqlite3...");
  await run("sudo apt-get update && sudo apt-get install -y sqlite3", { timeoutMs: 120_000 });
  const { stdout } = await run("sqlite3 --version");
  log(`sqlite3 installed: ${stdout.trim()}`);
}
