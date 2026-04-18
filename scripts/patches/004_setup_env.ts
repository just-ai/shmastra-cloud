import type { UpdateContext } from "@/manage/update/runner.mjs";

export default async function ({ sandbox, log, supabase }: UpdateContext) {
  // Refresh CORS_ORIGIN / MASTRA_AUTH_TOKEN on the PM2 daemon. ecosystem.config.cjs
  // reads envs from the daemon's /proc, so to update them we need a fresh daemon
  // whose parent shell has the new values in its environment.
  //
  // Flow: `pm2 kill` (stops old daemon with stale envs) → start.sh → pm2
  // startOrReload (spawns new daemon, inherits shell env with our overrides).
  const sandboxId = sandbox.sandboxId;
  const { data: sbData, error: sbErr } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandboxId)
    .maybeSingle();
  if (sbErr) throw sbErr;

  if (!sbData) {
    log("Sandbox not in DB — skipping env refresh");
    return;
  }

  const { data: userData, error: userErr } = await supabase
    .from("users")
    .select("virtual_key")
    .eq("id", sbData.user_id)
    .maybeSingle();
  if (userErr) throw userErr;
  const virtualKey = userData?.virtual_key;
  if (!virtualKey) throw new Error("User has no virtual_key");

  const appUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL}`;
  // Mirror the env set baked into lib/sandbox.ts::provisionSandbox so the
  // daemon has the same shape as a freshly created sandbox.
  const envs = {
    CORS_ORIGIN: appUrl,
    MASTRA_AUTH_TOKEN: virtualKey,
    OPENAI_BASE_URL: `${appUrl}/api/gateway/openai`,
    ANTHROPIC_BASE_URL: `${appUrl}/api/gateway/anthropic`,
    GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
    GOOGLE_GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
    GOOGLE_GENERATIVE_BASE_URL: `${appUrl}/api/gateway/gemini`,
    COMPOSIO_BASE_URL: `${appUrl}/api/gateway/composio`,
  };
  log(`Refreshing daemon envs: appUrl=${appUrl}, MASTRA_AUTH_TOKEN=${virtualKey.slice(0, 10)}...`);

  // commands.run goes through enrichSandbox, which merges daemon envs + our
  // overrides. Caller envs win, so these replace whatever the daemon had.
  await sandbox.commands.run("pm2 kill 2>/dev/null || true; /home/user/start.sh", {
    envs,
    timeoutMs: 60_000,
  });
}
