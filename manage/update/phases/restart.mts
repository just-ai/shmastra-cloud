import { ensurePm2Running, type PhaseCtx } from "./shared.mjs";

// Start shmastra + healer via pm2.
export async function restartPhase({ sandbox, log }: PhaseCtx): Promise<void> {
  await ensurePm2Running(sandbox, log);
}
