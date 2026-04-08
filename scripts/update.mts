#!/usr/bin/env node

/**
 * Sandbox updater — CLI and web UI modes.
 *
 * Usage:
 *   npx tsx scripts/update.mts <sandbox_id>     # update one sandbox (CLI)
 *   npx tsx scripts/update.mts --serve [port]    # start web UI (default port 3737)
 *
 * Requires in .env.local: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2B_API_KEY, ANTHROPIC_API_KEY
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { Sandbox } from "e2b";
import Anthropic from "@anthropic-ai/sdk";
import { Agent } from "@mastra/core/agent";
import { Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { E2BSandbox } from "@mastra/e2b";

type SandboxInstance = Awaited<ReturnType<typeof Sandbox.connect>>;
type LogFn = (msg: string) => void;

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const key of ["E2B_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`${key} must be set in env or .env.local`);
    process.exit(1);
  }
}

const supabase =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const anthropic = new Anthropic();

// ── helpers ──────────────────────────────────────────────────────────────────

export interface SandboxEntry {
  sandboxId: string;
  email: string;
}

async function fetchSandboxes(): Promise<SandboxEntry[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("user_sandboxes")
    .select("sandbox_id, email")
    .not("sandbox_id", "is", null);
  if (error) throw error;
  return data
    .filter((row) => row.sandbox_id)
    .map((row) => ({ sandboxId: row.sandbox_id, email: row.email }));
}

class AbortError extends Error {
  constructor() { super("Update stopped"); this.name = "AbortError"; }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortError();
}

async function run(
  sandbox: SandboxInstance,
  cmd: string,
  log: LogFn,
  { timeoutMs = 120_000, throwOnError = true, signal }: { timeoutMs?: number; throwOnError?: boolean; signal?: AbortSignal } = {},
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

// ── conflict resolution ────────────────────────────────────────────────────

async function getConflictedFiles(sandbox: SandboxInstance, workdir: string, log: LogFn) {
  const result = await run(sandbox, `git -C "${workdir}" diff --name-only --diff-filter=U`, log, {
    throwOnError: false,
  });
  return result.stdout.trim().split("\n").filter(Boolean);
}

async function readSandboxFile(sandbox: SandboxInstance, filePath: string) {
  const result = await sandbox.commands.run(`cat "${filePath}"`, { timeoutMs: 10_000 });
  return result.stdout;
}

async function resolveConflictWithClaude(fileName: string, conflictedContent: string, log: LogFn) {
  log(`🤖 Asking Claude to resolve conflict in ${fileName}...`);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: `You are resolving a git merge conflict. The file below contains git conflict markers (<<<<<<< HEAD, =======, >>>>>>> ...).

Rules:
- Merge BOTH sides of each conflict. Do not drop changes from either side.
- For package.json: combine dependencies from both sides. If versions differ, use the newer version.
- Respond with a JSON object: {"contents": "<resolved file contents>"}

File: ${fileName}
\`\`\`
${conflictedContent}
\`\`\``,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            contents: { type: "string", description: "The full resolved file contents" },
          },
          required: ["contents"],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text.text);
    return parsed.contents ?? "";
  } catch (err: any) {
    throw new Error(`Failed to parse Claude response as JSON for ${fileName}: ${err.message}`);
  }
}

const SIMPLE_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json", ".npmrc"]);
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json"]);

async function resolveConflictsWithAgent(
  sandbox: SandboxInstance,
  workdir: string,
  sourceFiles: string[],
  log: LogFn,
) {
  log(`🤖 Starting Mastra agent to resolve ${sourceFiles.length} source file(s)...`);

  const e2bSandbox = new E2BSandbox({ id: "merge-resolver" });
  (e2bSandbox as any)._sandbox = sandbox;

  const workspace = new Workspace({ sandbox: e2bSandbox });
  await workspace.init();

  await run(sandbox, `cd "${workdir}" && pnpm install`, log, {
    throwOnError: false,
    timeoutMs: 180_000,
  });

  const agent = new Agent({
    workspace,
    id: "merge-resolver",
    name: "merge-resolver",
    model: "anthropic/claude-opus-4-6",
    instructions: `You are resolving git merge conflicts in a project.
Working directory: ${workdir}

Rules:
- Read each conflicted file, understand both sides of the conflict, and merge them.
- Preserve ALL functionality from both sides. Do not drop any code.
- After resolving each file, run: git -C "${workdir}" add <file>
- After resolving all files, run: cd "${workdir}" && pnpm build
- If the build fails, read the errors, fix the code, and rebuild until it succeeds.
- When the build passes, run: git -C "${workdir}" add -A && git -C "${workdir}" commit -m "<describe what was resolved>"`,
  });

  const fileList = sourceFiles.join(", ");
  const stream = await agent.stream(
    `Resolve merge conflicts in these files: ${fileList}. The files are in ${workdir}.`,
  );

  for await (const part of stream.fullStream) {
    switch (part.type) {
      case "text-delta":
        log(part.payload.text);
        break;
      case "tool-call": {
        const { toolName, args } = part.payload;
        const a = args as Record<string, unknown>;
        let line: string;
        const { SANDBOX } = WORKSPACE_TOOLS;
        switch (toolName) {
          case SANDBOX.EXECUTE_COMMAND:
            line = `$ ${a.command}${a.cwd ? ` (in ${a.cwd})` : ""}`;
            break;
          case SANDBOX.GET_PROCESS_OUTPUT:
            line = `output pid=${a.pid}${a.tail ? ` tail=${a.tail}` : ""}`;
            break;
          case SANDBOX.KILL_PROCESS:
            line = `kill pid=${a.pid}`;
            break;
          default:
            line = `${toolName}(${JSON.stringify(a).slice(0, 100)})`;
        }
        log(`🔧 ${line}`);
        break;
      }
      case "tool-result":
        log(`→ ${String(part.payload.result).slice(0, 200)}`);
        break;
      case "error":
        log(`✗ Stream error: ${part.payload}`);
        break;
    }
  }

  await run(sandbox, `git -C "${workdir}" add -A`, log, { throwOnError: false });
  await run(
    sandbox,
    `git -C "${workdir}" diff --cached --quiet || git -C "${workdir}" commit -m "Auto-resolve merge conflicts"`,
    log,
    { throwOnError: false },
  );
}

async function resolveConflicts(sandbox: SandboxInstance, workdir: string, log: LogFn) {
  const conflictedFiles = await getConflictedFiles(sandbox, workdir, log);
  if (conflictedFiles.length === 0) return false;

  log(`📝 Found ${conflictedFiles.length} conflicted file(s): ${conflictedFiles.join(", ")}`);

  const sourceFiles = [];

  for (const file of conflictedFiles) {
    const fullPath = `${workdir}/${file}`;

    if (LOCKFILES.has(file)) {
      log(`Removing ${file} (will be regenerated by pnpm install)`);
      await run(sandbox, `rm -f "${fullPath}"`, log, { throwOnError: false });
      await run(sandbox, `git -C "${workdir}" add "${file}"`, log, { throwOnError: false });
      continue;
    }

    if (SIMPLE_FILES.has(file)) {
      const conflictedContent = await readSandboxFile(sandbox, fullPath);
      const resolved = await resolveConflictWithClaude(file, conflictedContent, log);
      if (!resolved) {
        throw new Error(`Claude returned empty resolution for ${file}`);
      }
      await sandbox.files.write(fullPath, resolved);
      await run(sandbox, `git -C "${workdir}" add "${file}"`, log, { throwOnError: false });
      log(`✓ Resolved ${file} (Claude API)`);
      continue;
    }

    sourceFiles.push(file);
  }

  if (sourceFiles.length > 0) {
    await resolveConflictsWithAgent(sandbox, workdir, sourceFiles, log);
  } else {
    await run(sandbox, `git -C "${workdir}" commit -m "Auto-resolve merge conflicts"`, log, {
      throwOnError: false,
    });
  }

  return true;
}

// ── main update logic ───────────────────────────────────────────────────────

const MAIN_DIR = "/home/user/shmastra";
const WORKTREE_DIR = "/home/user/merge";
const WORKTREE_BRANCH = "merge-main";

async function ensurePm2Running(sandbox: SandboxInstance, log: LogFn) {
  const pm2Check = await run(sandbox, "pm2 pid shmastra 2>/dev/null || true", log, {
    throwOnError: false,
  });
  if (!pm2Check.stdout.trim() || pm2Check.stdout.trim() === "0") {
    await run(sandbox, "/home/user/start.sh &", log, { throwOnError: false });
  }
}

async function cleanup(sandbox: SandboxInstance, log: LogFn) {
  await run(sandbox, `rm -rf "${WORKTREE_DIR}"`, log, { throwOnError: false });
  await run(sandbox, `git -C "${MAIN_DIR}" worktree prune`, log, { throwOnError: false });
  await run(sandbox, `git -C "${MAIN_DIR}" branch -D ${WORKTREE_BRANCH} 2>/dev/null || true`, log, {
    throwOnError: false,
  });
}

export type UpdateStatus = "pending" | "running" | "success" | "error" | "stopped";

export interface UpdateResult {
  sandboxId: string;
  status: UpdateStatus;
  elapsed: number;
  error?: string;
}

export const UPDATE_PHASES = ["connect", "setup", "fetch", "merge", "install", "build", "apply", "restart"] as const;
export type UpdatePhase = typeof UPDATE_PHASES[number];

export async function updateSandbox(
  sandboxId: string,
  log: LogFn,
  onStatus?: (status: UpdateStatus) => void,
  signal?: AbortSignal,
  onPhase?: (phase: UpdatePhase) => void,
): Promise<UpdateResult> {
  const startTime = Date.now();
  const elapsed = () => (Date.now() - startTime) / 1000;

  onStatus?.("running");
  onPhase?.("connect");

  let sandbox: SandboxInstance;
  try {
    sandbox = await Sandbox.connect(sandboxId, { timeoutMs: 10 * 60 * 1000 });
  } catch (err: any) {
    log(`✗ Failed to connect: ${err.message}`);
    onStatus?.("error");
    return { sandboxId, status: "error", elapsed: elapsed(), error: err.message };
  }

  try {
    // ── setup ──
    onPhase?.("setup");

    await run(
      sandbox,
      `git -C "${MAIN_DIR}" config user.email "sandbox@shmastra.ai" && git -C "${MAIN_DIR}" config user.name "Shmastra Sandbox"`,
      log,
      { throwOnError: false },
    );

    checkAbort(signal);

    await run(sandbox, "which pm2 || npm install -g pm2", log, { throwOnError: false });
    await run(
      sandbox,
      "pm2 list 2>/dev/null | grep -q pm2-logrotate || pm2 install pm2-logrotate",
      log,
      { throwOnError: false },
    );

    const ecosystemContent = readFileSync(resolve(__dirname, "ecosystem.config.cjs"), "utf-8");
    await sandbox.files.write("/home/user/ecosystem.config.cjs", ecosystemContent);
    const startShContent = readFileSync(resolve(__dirname, "start.sh"), "utf-8");
    await sandbox.files.write("/home/user/start.sh", startShContent);
    await run(sandbox, "chmod +x /home/user/start.sh", log, { throwOnError: false });

    checkAbort(signal);

    // ── fetch ──
    onPhase?.("fetch");

    await cleanup(sandbox, log);
    await run(sandbox, `git -C "${MAIN_DIR}" merge --abort 2>/dev/null || true`, log, {
      throwOnError: false,
    });

    await run(sandbox, `git -C "${MAIN_DIR}" add -A`, log, { throwOnError: false });
    await run(
      sandbox,
      `git -C "${MAIN_DIR}" diff --cached --quiet || git -C "${MAIN_DIR}" commit -m "Local changes"`,
      log,
      { throwOnError: false },
    );

    checkAbort(signal);

    await run(sandbox, `git -C "${MAIN_DIR}" fetch origin`, log, { throwOnError: false });

    const behindResult = await run(
      sandbox,
      `git -C "${MAIN_DIR}" rev-list HEAD..origin/main --count`,
      log,
      { throwOnError: false },
    );
    const behind = parseInt(behindResult.stdout.trim(), 10);
    if (behind === 0) {
      log("Already up to date.");
      await ensurePm2Running(sandbox, log);
      const e = elapsed();
      log(`✓ Done in ${e.toFixed(1)}s.`);
      onStatus?.("success");
      return { sandboxId, status: "success", elapsed: e };
    }

    checkAbort(signal);

    // ── merge ──
    onPhase?.("merge");

    log(`${behind} commit(s) behind origin/main, updating...`);

    await run(
      sandbox,
      `git -C "${MAIN_DIR}" worktree add -b ${WORKTREE_BRANCH} "${WORKTREE_DIR}" HEAD`,
      log,
    );

    const mergeResult = await run(
      sandbox,
      `git -C "${WORKTREE_DIR}" merge origin/main --no-edit 2>&1 || true`,
      log,
      { throwOnError: false },
    );
    const mergeOutput = mergeResult.stdout + mergeResult.stderr;

    if (mergeOutput.includes("CONFLICT") || mergeOutput.includes("fix conflicts")) {
      log("⚠ Merge conflicts, resolving...");
      checkAbort(signal);
      await resolveConflicts(sandbox, WORKTREE_DIR, log);
    }

    checkAbort(signal);

    // ── install ──
    onPhase?.("install");

    await run(sandbox, `cd "${WORKTREE_DIR}" && pnpm install`, log, {
      throwOnError: true,
      timeoutMs: 180_000,
    });

    checkAbort(signal);

    // ── build ──
    onPhase?.("build");

    await run(sandbox, `cd "${WORKTREE_DIR}" && pnpm build`, log, {
      throwOnError: true,
      timeoutMs: 180_000,
    });

    checkAbort(signal);

    await run(
      sandbox,
      `git -C "${WORKTREE_DIR}" add -A && git -C "${WORKTREE_DIR}" diff --cached --quiet || git -C "${WORKTREE_DIR}" commit -m "Update lockfile after merge"`,
      log,
      { throwOnError: false },
    );

    // ── apply ──
    onPhase?.("apply");

    checkAbort(signal);

    await run(sandbox, "pm2 delete all 2>/dev/null || true", log, { throwOnError: false });
    await run(
      sandbox,
      "kill -9 $(pgrep -x node) $(pgrep -x pnpm) $(pgrep -x esbuild) 2>/dev/null || true",
      log,
      { throwOnError: false },
    );

    await run(sandbox, `git -C "${MAIN_DIR}" merge ${WORKTREE_BRANCH} --ff-only`, log);

    await run(sandbox, `cd "${MAIN_DIR}" && pnpm install`, log, {
      throwOnError: false,
      timeoutMs: 180_000,
    });

    await cleanup(sandbox, log);

    // ── restart ──
    onPhase?.("restart");

    await ensurePm2Running(sandbox, log);

    const e = elapsed();
    log(`✓ Updated in ${e.toFixed(1)}s.`);
    onStatus?.("success");
    return { sandboxId, status: "success", elapsed: e };
  } catch (err: any) {
    const stopped = err instanceof AbortError;
    if (stopped) {
      log("⏹ Update stopped.");
    } else {
      log(`✗ Error: ${err.message}`);
    }
    await cleanup(sandbox, log);
    await ensurePm2Running(sandbox, log);
    const e = elapsed();
    const status: UpdateStatus = stopped ? "stopped" : "error";
    onStatus?.(status);
    return { sandboxId, status, elapsed: e, error: stopped ? undefined : err.message };
  }
}

// ── SSE server mode ────────────────────────────────────────────────────────

type SSEClient = ServerResponse;
const sseClients = new Set<SSEClient>();

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function makeSandboxLog(sandboxId: string): LogFn {
  return (msg: string) => broadcast("log", { sandboxId, message: msg });
}

// Track running updates and their abort controllers
const runningUpdates = new Map<string, AbortController>();

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE endpoint
  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":\n\n"); // keepalive comment
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // List sandboxes
  if (url.pathname === "/api/sandboxes" && req.method === "GET") {
    try {
      const entries = await fetchSandboxes();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entries));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Update one sandbox
  const updateMatch = url.pathname.match(/^\/api\/update\/(.+)$/);
  if (updateMatch && req.method === "POST") {
    const sandboxId = updateMatch[1];
    if (runningUpdates.has(sandboxId)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Already updating" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: true }));

    const ac = new AbortController();
    runningUpdates.set(sandboxId, ac);
    broadcast("status", { sandboxId, status: "running" });
    updateSandbox(sandboxId, makeSandboxLog(sandboxId), (status) => {
      broadcast("status", { sandboxId, status });
    }, ac.signal, (phase) => {
      broadcast("phase", { sandboxId, phase });
    }).finally(() => runningUpdates.delete(sandboxId));
    return;
  }

  // Stop one sandbox
  const stopMatch = url.pathname.match(/^\/api\/stop\/(.+)$/);
  if (stopMatch && req.method === "POST") {
    const sandboxId = stopMatch[1];
    const ac = runningUpdates.get(sandboxId);
    if (ac) ac.abort();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ stopped: !!ac }));
    return;
  }

  // Stop all
  if (url.pathname === "/api/stop-all" && req.method === "POST") {
    for (const ac of runningUpdates.values()) ac.abort();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ stopped: runningUpdates.size }));
    return;
  }

  // Update all sandboxes
  if (url.pathname === "/api/update-all" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: true }));

    (async () => {
      try {
        const entries = await fetchSandboxes();
        const queue = entries.filter(({ sandboxId: id }) => !runningUpdates.has(id));
        const CONCURRENCY = 5;
        let idx = 0;

        async function next(): Promise<void> {
          const entry = queue[idx++];
          if (!entry) return;
          const { sandboxId: id } = entry;
          const ac = new AbortController();
          runningUpdates.set(id, ac);
          broadcast("status", { sandboxId: id, status: "running" });
          try {
            await updateSandbox(id, makeSandboxLog(id), (status) => {
              broadcast("status", { sandboxId: id, status });
            }, ac.signal, (phase) => {
              broadcast("phase", { sandboxId: id, phase });
            });
          } finally {
            runningUpdates.delete(id);
          }
          return next();
        }

        await Promise.allSettled(Array.from({ length: CONCURRENCY }, () => next()));
      } catch (err: any) {
        broadcast("log", { sandboxId: "_global", message: `✗ ${err.message}` });
      }
    })();
    return;
  }

  // Serve HTML
  if (url.pathname === "/" && req.method === "GET") {
    try {
      const html = readFileSync(resolve(__dirname, "update.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("update.html not found");
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

// ── CLI mode ───────────────────────────────────────────────────────────────

async function cliMode(sandboxId: string) {
  const log: LogFn = (msg) => console.log(`  ${msg}`);
  console.log(`Updating sandbox ${sandboxId}...`);
  const result = await updateSandbox(sandboxId, log);
  process.exit(result.status === "success" ? 0 : 1);
}

async function cliAllMode() {
  if (!supabase) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }
  console.log("Fetching sandboxes...");
  const entries = await fetchSandboxes();
  console.log(`Found ${entries.length} sandboxes.`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const { sandboxId, email } = entries[i];
    console.log(`\n=== [${i + 1}/${entries.length}] ${sandboxId} (${email}) ===`);
    const log: LogFn = (msg) => console.log(`  ${msg}`);
    const result = await updateSandbox(sandboxId, log);
    if (result.status === "success") succeeded++;
    else failed++;
  }

  console.log(`\nDone. Succeeded: ${succeeded}, Failed: ${failed}`);
}

// ── entry point ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === "--serve") {
  if (!supabase) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }
  const port = parseInt(args[1] || "3737", 10);
  const server = createServer(handleRequest);
  server.listen(port, () => {
    console.log(`Sandbox updater UI: http://localhost:${port}`);
  });
} else if (args[0]) {
  cliMode(args[0]).catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  cliAllMode().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
