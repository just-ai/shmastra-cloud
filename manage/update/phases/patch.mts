import { supabase } from "../../env.mjs";
import { runPatches } from "../runner.mjs";
import { type PhaseCtx } from "./shared.mjs";

// Run pending migration scripts.
export async function patchPhase({ sandbox, sandboxId, log, signal, onPhase }: PhaseCtx): Promise<void> {
  if (!supabase) return;
  await runPatches(sandbox, sandboxId, supabase, log, signal, () => onPhase?.("patch"));
}
