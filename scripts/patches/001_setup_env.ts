import type { UpdateContext } from "@/manage/update/runner.mjs";

export default async function ({ run, log }: UpdateContext) {
  // Env setup (CORS_ORIGIN, MASTRA_AUTH_TOKEN) used to live in ecosystem.config.cjs
  // and was rewritten here. That step is obsolete — the config now reads envs
  // from the PM2 daemon's /proc at reload time, so we only need install-browsers.
  log("Installing browsers...");
  await run("cd /home/user/shmastra && pnpm run install-browsers -- --force", { timeoutMs: 300_000 });
}
