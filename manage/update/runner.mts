import { readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sandbox } from "e2b";
import { run as sharedRun } from "../sandbox.mjs";
import { resolveSandboxEnvContext, type SandboxEnvContext } from "./utils.mjs";

export type SandboxInstance = Awaited<ReturnType<typeof Sandbox.connect>>;

export type RunFn = (
  cmd: string,
  opts?: { timeoutMs?: number; throwOnError?: boolean },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type LogFn = (msg: string) => void;

export interface UpdateContext {
  sandbox: SandboxInstance;
  run: RunFn;
  log: LogFn;
  supabase: SupabaseClient;
  // User + sandbox DB rows + appUrl, resolved once before patches run.
  env: SandboxEnvContext;
  // Accumulate env vars to be applied once the restart phase runs, so patches
  // don't each do their own pm2 kill + start.sh.
  addEnvs: (envs: Record<string, string>) => void;
}

interface UpdateEntry {
  id: string;
  path: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATCHES_DIR = resolve(__dirname, "../../scripts/patches");

function makeRunFn(sandbox: SandboxInstance, log: LogFn, signal?: AbortSignal): RunFn {
  // Delegate to the shared run() helper so patch scripts get the same abort-
  // on-signal behavior as update phases.
  return (cmd, opts = {}) => sharedRun(sandbox, cmd, log, { ...opts, signal });
}

function listUpdates(): UpdateEntry[] {
  let files: string[];
  try {
    files = readdirSync(PATCHES_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .sort()
    .map((f) => ({
      id: basename(f, f.endsWith(".ts") ? ".ts" : ".js").replace(/_.*$/, ""),
      path: resolve(PATCHES_DIR, f),
    }));
}

function pendingUpdates(
  all: UpdateEntry[],
  currentVersion: string | null,
): UpdateEntry[] {
  if (!currentVersion) return all;
  return all.filter((u) => u.id > currentVersion);
}

async function setVersion(
  supabase: SupabaseClient,
  sandboxId: string,
  version: string,
) {
  const { error } = await supabase
    .from("sandboxes")
    .update({ version })
    .eq("sandbox_id", sandboxId);
  if (error) throw error;
}

async function getVersion(
  supabase: SupabaseClient,
  sandboxId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sandboxes")
    .select("version")
    .eq("sandbox_id", sandboxId)
    .maybeSingle();
  if (error) throw error;
  return data?.version ?? null;
}

export interface PatchesResult {
  applied: number;
  envs: Record<string, string>;
}

export async function runPatches(
  sandbox: SandboxInstance,
  sandboxId: string,
  supabase: SupabaseClient,
  log: LogFn,
  signal?: AbortSignal,
): Promise<PatchesResult> {
  const collectedEnvs: Record<string, string> = {};
  const all = listUpdates();
  if (all.length === 0) return { applied: 0, envs: collectedEnvs };

  const currentVersion = await getVersion(supabase, sandboxId);
  const pending = pendingUpdates(all, currentVersion);

  if (pending.length === 0) {
    return { applied: 0, envs: collectedEnvs };
  }

  log(`${pending.length} pending update(s): ${pending.map((u) => u.id).join(", ")}`);

  const env = await resolveSandboxEnvContext(sandbox, supabase);
  const run = makeRunFn(sandbox, log, signal);
  const ctx: UpdateContext = {
    sandbox,
    run,
    log,
    supabase,
    env,
    addEnvs: (envs) => Object.assign(collectedEnvs, envs),
  };
  let applied = 0;

  for (const update of pending) {
    if (signal?.aborted) break;

    log(`▶ Running ${update.id}...`);
    const mod = await import(update.path);
    await mod.default(ctx);
    await setVersion(supabase, sandboxId, update.id);
    log(`✓ ${update.id} applied.`);
    applied++;
  }

  return { applied, envs: collectedEnvs };
}
