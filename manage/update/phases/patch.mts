import { supabase } from "../../env.mjs";
import { runPatches } from "../runner.mjs";
import { type PhaseCtx } from "./shared.mjs";

// Run pending path scripts. Collected envs are stashed on ctx so the restart
// phase applies them in one pm2 kill + start.sh cycle.
export async function patchPhase(ctx: PhaseCtx): Promise<void> {
  if (!supabase) return;
  const { applied, envs } = await runPatches(
    ctx.sandbox,
    ctx.sandboxId,
    supabase,
    ctx.log,
    ctx.signal,
    () => ctx.onPhase?.("patch"),
  );
  if (applied > 0 && Object.keys(envs).length > 0) {
    ctx.pendingEnvs = { ...ctx.pendingEnvs, ...envs };
  }
}
