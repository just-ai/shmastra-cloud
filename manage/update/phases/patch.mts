import { supabase } from "../../env.mjs";
import { runPatches } from "../runner.mjs";
import { SkipPhase, type PhaseCtx } from "./shared.mjs";

// Run pending patch scripts. Collected envs are stashed on ctx.state so the
// restart phase applies them in one pm2 kill + start.sh cycle. Skips when
// there's no supabase client or no pending patches.
export async function patchPhase(ctx: PhaseCtx): Promise<void> {
  if (!supabase) throw new SkipPhase("no supabase client");
  const { applied, envs } = await runPatches(
    ctx.sandbox,
    ctx.sandboxId,
    supabase,
    ctx.log,
    ctx.signal,
  );
  if (applied === 0) throw new SkipPhase("no pending patches");
  if (Object.keys(envs).length > 0) {
    ctx.state.pendingEnvs = { ...ctx.state.pendingEnvs, ...envs };
  }
}
