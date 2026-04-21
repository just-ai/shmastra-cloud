import type { Sandbox, User } from "@/lib/db";
import type { UpdateContext } from "./runner.mjs";

// What provisionSandbox has in scope when building the env set, rehydrated
// from the update-time state: user + sandbox DB rows, plus the cloud app's
// public URL (sourced from the daemon's CORS_ORIGIN, set at creation time).
export interface SandboxEnvContext {
  user: User;
  sandbox: Sandbox;
  appUrl: string;
}

// Exported for patches that need user/sandbox/appUrl for non-env side effects
// (writing config files, skill injection, etc.). For patches that only refresh
// daemon envs, use `addDaemonEnvs` below.
export async function resolveSandboxEnvContext(
  ctx: UpdateContext,
): Promise<SandboxEnvContext | null> {
  const { sandbox: e2b, supabase } = ctx;
  const { data: sbRow, error: sbErr } = await supabase
    .from("sandboxes")
    .select("*")
    .eq("sandbox_id", e2b.sandboxId)
    .maybeSingle<Sandbox>();
  if (sbErr) throw sbErr;
  if (!sbRow) return null;

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("*")
    .eq("id", sbRow.user_id)
    .single<User>();
  if (userErr) throw userErr;
  if (!user?.virtual_key) throw new Error("User has no virtual_key");

  const cors = await e2b.commands.run(
    'grep -z "^CORS_ORIGIN=" "/proc/$(cat $HOME/.pm2/pm2.pid)/environ" | tr -d "\\0"',
    { timeoutMs: 10_000 },
  );
  const appUrl = cors.stdout.replace(/^CORS_ORIGIN=/, "").trim();
  if (!appUrl) throw new Error("Daemon env missing CORS_ORIGIN");

  return { user, sandbox: sbRow, appUrl };
}

// Declare envs to be merged into the PM2 daemon. Actual pm2 restart happens
// once in the `restart` phase after all patches have declared their envs.
// Returns false if the sandbox has no DB row (nothing to do).
export async function addDaemonEnvs(
  ctx: UpdateContext,
  build: (env: SandboxEnvContext) => Record<string, string>,
): Promise<boolean> {
  const env = await resolveSandboxEnvContext(ctx);
  if (!env) {
    ctx.log("Sandbox not in DB — skipping env refresh");
    return false;
  }

  const additions = build(env);
  if (Object.keys(additions).length === 0) return true;
  ctx.log(`Queued ${Object.keys(additions).length} env(s): ${Object.keys(additions).join(", ")}`);
  ctx.addEnvs(additions);
  return true;
}
