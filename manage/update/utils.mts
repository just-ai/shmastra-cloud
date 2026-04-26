import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sandbox, User } from "@/lib/db";
import type { UpdateContext, SandboxInstance } from "./runner.mjs";

const { getAppUrl } = createRequire(import.meta.url)("@/lib/app-url") as typeof import("@/lib/app-url");

// Rehydrates what provisionSandbox had in scope when building the env set:
// the user + sandbox DB rows plus the cloud app's public URL. Resolved once
// at the top of the patch phase and stashed on UpdateContext.env, so patches
// read it synchronously and we don't re-query per patch.
export interface SandboxEnvContext {
  user: User;
  sandbox: Sandbox;
  appUrl: string;
}

export async function resolveSandboxEnvContext(
  sandbox: SandboxInstance,
  supabase: SupabaseClient,
): Promise<SandboxEnvContext> {
  const { data: sbRow, error: sbErr } = await supabase
    .from("sandboxes")
    .select("*")
    .eq("sandbox_id", sandbox.sandboxId)
    .maybeSingle<Sandbox>();
  if (sbErr) throw sbErr;
  if (!sbRow) throw new Error("Sandbox not found");

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("*")
    .eq("id", sbRow.user_id)
    .single<User>();
  if (userErr) throw userErr;
  if (!user?.virtual_key) throw new Error("User has no virtual_key");

  return { user, sandbox: sbRow, appUrl: getAppUrl() };
}

// Declare envs to be merged into the PM2 daemon. Actual pm2 restart happens
// once in the `restart` phase after all patches have declared their envs.
export function addDaemonEnvs(
  ctx: UpdateContext,
  build: (env: SandboxEnvContext) => Record<string, string>,
): void {
  const additions = build(ctx.env);
  if (Object.keys(additions).length === 0) return;
  ctx.log(`Queued ${Object.keys(additions).length} env(s): ${Object.keys(additions).join(", ")}`);
  ctx.addEnvs(additions);
}
