import { Sandbox } from "e2b";
import { supabase } from "./env.mjs";

export type SandboxInstance = Awaited<ReturnType<typeof Sandbox.connect>>;
export type LogFn = (msg: string) => void;

export interface SandboxEntry {
  sandboxId: string;
  email: string;
  status: string;
  state: "running" | "paused" | "unknown";
  createdAt: string | null;
  lastActiveAt: string | null;
  version: string | null;
}

export class AbortError extends Error {
  constructor() {
    super("Update stopped");
    this.name = "AbortError";
  }
}

export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortError();
}

export async function fetchSandboxes(): Promise<SandboxEntry[]> {
  if (!supabase) throw new Error("Supabase not configured");

  // Fetch DB data and E2B states in parallel
  const [dbResult, e2bSandboxes] = await Promise.all([
    supabase
      .from("sandboxes")
      .select("sandbox_id, status, created_at, last_extended_at, version, user:users(email)")
      .not("sandbox_id", "is", null),
    Sandbox.list().nextItems().catch(() => [] as any[]),
  ]);

  if (dbResult.error) throw dbResult.error;

  const stateMap = new Map<string, "running" | "paused">();
  for (const s of (e2bSandboxes || [])) {
    stateMap.set(s.sandboxId, s.state as "running" | "paused");
  }

  return dbResult.data
    .filter((row: any) => row.sandbox_id)
    .map((row: any) => ({
      sandboxId: row.sandbox_id,
      email: row.user?.email || "",
      status: row.status || "unknown",
      state: stateMap.get(row.sandbox_id) || "unknown" as const,
      createdAt: row.created_at,
      lastActiveAt: row.last_extended_at,
      version: row.version,
    }));
}

export async function run(
  sandbox: SandboxInstance,
  cmd: string,
  log: LogFn,
  {
    timeoutMs = 120_000,
    throwOnError = true,
    signal,
  }: { timeoutMs?: number; throwOnError?: boolean; signal?: AbortSignal } = {},
) {
  checkAbort(signal);
  log(`$ ${cmd}`);
  const result = await sandbox.commands.run(cmd, { timeoutMs });
  if (result.stdout.trim()) log(`  stdout: ${result.stdout.trim()}`);
  if (result.stderr.trim()) log(`  stderr: ${result.stderr.trim()}`);
  if (result.exitCode !== 0) {
    log(`  ⚠ exit code: ${result.exitCode}`);
    if (throwOnError) {
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmd}`);
    }
  }
  return result;
}
