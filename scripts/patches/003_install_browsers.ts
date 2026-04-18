import type { UpdateContext } from "@/manage/update/runner.mjs";

export default async function ({ run, log }: UpdateContext) {
  log("Installing browsers...");
  await run("cd /home/user/shmastra && pnpm run install-browsers -- --force", { timeoutMs: 300_000 });
}
