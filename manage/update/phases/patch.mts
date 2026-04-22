import { createRequire } from "node:module";
import { supabase } from "../../env.mjs";
import { runPatches } from "../runner.mjs";
import { resolveSandboxEnvContext } from "../utils.mjs";
import { SkipPhase, type PhaseCtx } from "./shared.mjs";

const require_ = createRequire(import.meta.url);
const { writeMcpConfig } = require_("@/lib/mcp-config") as typeof import("../../../lib/mcp-config");
const { writeSkills } = require_("@/lib/skill-injection") as typeof import("../../../lib/skill-injection");

// Sync cloud-managed artifacts (MCP config, bundled skills) to the sandbox on
// every update, then run any pending patch scripts. Collected envs are stashed
// on ctx.state so the restart phase applies them in one pm2 kill + start.sh
// cycle. Skipped only when there's no supabase client (dev with no DB).
export async function patchPhase(ctx: PhaseCtx): Promise<void> {
  if (!supabase) throw new SkipPhase("no supabase client");

  const env = await resolveSandboxEnvContext(ctx.sandbox, supabase);
  ctx.log(`Syncing MCP config and skills (appUrl=${env.appUrl})...`);
  await writeMcpConfig(ctx.sandbox, env.appUrl, env.user.virtual_key!);
  await writeSkills(ctx.sandbox);

  const { envs } = await runPatches(ctx.sandbox, ctx.sandboxId, supabase, ctx.log, ctx.signal);
  if (Object.keys(envs).length > 0) {
    ctx.state.pendingEnvs = { ...ctx.state.pendingEnvs, ...envs };
  }
}
