import { readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sandbox } from "e2b";

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
}

interface UpdateEntry {
  id: string;
  path: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATCHES_DIR = resolve(__dirname, "../../scripts/patches");

function makeRunFn(sandbox: SandboxInstance, log: LogFn): RunFn {
  return async (cmd, { timeoutMs = 120_000, throwOnError = true } = {}) => {
    log(`$ ${cmd}`);
    const result = await sandbox.commands.run(cmd, { timeoutMs });
    if (result.stdout.trim()) log(`  stdout: ${result.stdout.trim()}`);
    if (result.stderr.trim()) log(`  stderr: ${result.stderr.trim()}`);
    if (result.exitCode !== 0 && throwOnError) {
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmd}`);
    }
    return result;
  };
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
    .single();
  if (error) throw error;
  return data?.version ?? null;
}

export async function runPatches(
  sandbox: SandboxInstance,
  sandboxId: string,
  supabase: SupabaseClient,
  log: LogFn,
  signal?: AbortSignal,
  onPhase?: () => void,
): Promise<number> {
  const all = listUpdates();
  if (all.length === 0) return 0;

  const currentVersion = await getVersion(supabase, sandboxId);
  const pending = pendingUpdates(all, currentVersion);

  if (pending.length === 0) {
    return 0;
  }

  onPhase?.();
  log(`${pending.length} pending update(s): ${pending.map((u) => u.id).join(", ")}`);

  const run = makeRunFn(sandbox, log);
  const ctx: UpdateContext = { sandbox, run, log, supabase };
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

  return applied;
}
