import { Sandbox, CommandExitError } from "e2b";
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

// E2B's `envs` passed to Sandbox.create are client-scoped — a reconnected
// client (like the manage server) doesn't inherit them. But the PM2 daemon,
// spawned during initial sandbox boot, keeps them in its own environment.
// Pull them from /proc/$PM2_PID/environ so that commands like `pnpm dry-run`
// don't blow up on missing ANTHROPIC_API_KEY etc.
//
// The daemon's env also contains runtime internals (PM2 IPC fd, node channel,
// pm2 state) that MUST NOT leak into children — NODE_CHANNEL_FD in particular
// makes every spawned Node process try to speak IPC to a dead parent.
const ENV_DENY_PREFIXES = ["NODE_CHANNEL_", "PM2_"];
const ENV_DENY_EXACT = new Set(["SILENT", "_"]);

async function readDaemonEnvs(sandbox: SandboxInstance): Promise<Record<string, string>> {
  const res = await sandbox.commands.run(
    "cat /proc/$(cat $HOME/.pm2/pm2.pid)/environ 2>/dev/null | tr '\\0' '\\n'",
    { timeoutMs: 5_000, user: "user" },
  ).catch(() => null);
  if (!res || res.exitCode !== 0) return {};
  const out: Record<string, string> = {};
  for (const line of res.stdout.split("\n")) {
    if (!line) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i);
    if (ENV_DENY_EXACT.has(key)) continue;
    if (ENV_DENY_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] = line.slice(i + 1);
  }
  return out;
}

// Patch commands.run and files.* on a freshly connected sandbox so every call
// defaults to user:"user" (avoids root-owned files) and commands get the
// daemon envs merged in. Caller-supplied opts always win on conflict.
async function enrichSandbox(sandbox: SandboxInstance): Promise<void> {
  const envs = await readDaemonEnvs(sandbox);

  const origRun = sandbox.commands.run.bind(sandbox.commands);
  sandbox.commands.run = ((cmd: string, opts?: any) =>
    origRun(cmd, {
      user: "user",
      ...opts,
      envs: { ...envs, ...(opts?.envs || {}) },
    })) as any;

  // files.* methods take opts as the last arg. Default user:"user"; a plain
  // opts object in the caller's args wins on conflict.
  const files = sandbox.files as any;
  const isPlainOpts = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
  for (const method of ["list", "read", "write", "makeDir", "remove", "rename", "exists"]) {
    const orig = files[method]?.bind(files);
    if (!orig) continue;
    files[method] = (...args: any[]) => {
      const last = args[args.length - 1];
      if (isPlainOpts(last)) args[args.length - 1] = { user: "user", ...last };
      else args.push({ user: "user" });
      return orig(...args);
    };
  }
}

export async function connectSandbox(
  sandboxId: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<SandboxInstance> {
  const sandbox = await Sandbox.connect(sandboxId, { timeoutMs });
  await enrichSandbox(sandbox);
  return sandbox;
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
  // E2B's commands.run throws CommandExitError on non-zero exit by default —
  // catch it so throwOnError:false actually works and we can log stdout/stderr.
  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await sandbox.commands.run(cmd, { timeoutMs });
  } catch (err) {
    if (err instanceof CommandExitError) {
      result = { stdout: err.stdout, stderr: err.stderr, exitCode: err.exitCode };
    } else {
      throw err;
    }
  }
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
