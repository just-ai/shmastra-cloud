import { fetchPhase } from "./fetch.mjs";
import { mergePhase } from "./merge.mjs";
import { installPhase } from "./install.mjs";
import { buildPhase } from "./build.mjs";
import { applyPhase } from "./apply.mjs";
import { migratePhase } from "./migrate.mjs";
import { patchPhase } from "./patch.mjs";
import { restartPhase } from "./restart.mjs";
import type { PhaseFn } from "./shared.mjs";

// Single source of truth for phase order + implementation. Edit here to add,
// remove, or reorder phases — the driver iterates over this array, and the
// UI-visible names are derived from it.
export const UPDATE_PIPELINE: ReadonlyArray<{ name: string; fn: PhaseFn }> = [
  { name: "fetch", fn: fetchPhase },
  { name: "merge", fn: mergePhase },
  { name: "install", fn: installPhase },
  { name: "migrate", fn: migratePhase },
  { name: "build", fn: buildPhase },
  { name: "apply", fn: applyPhase },
  { name: "patch", fn: patchPhase },
  { name: "restart", fn: restartPhase },
] as const;

export const UPDATE_PHASES = UPDATE_PIPELINE.map((p) => p.name) as unknown as ReadonlyArray<string>;
export type UpdatePhase = (typeof UPDATE_PIPELINE)[number]["name"];

export {
  SkipPhase,
  ensurePm2Running,
  cleanup,
  type PhaseStatus,
  type PhaseCtx,
  type PhaseFn,
  type UpdateState,
} from "./shared.mjs";
