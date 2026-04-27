import { createRequire } from "module";
import { execSync, execFileSync } from "child_process";
import { statSync, readFileSync, writeFileSync } from "fs";
import * as os from "os";

interface Pm2Bus {
  on(event: string, cb: (data: any) => void): void;
}

interface Pm2 {
  connect(cb: (err: Error | null) => void): void;
  describe(name: string, cb: (err: Error | null, list: any[]) => void): void;
  restart(name: string, cb: (err: Error | null) => void): void;
  delete(name: string, cb: (err: Error | null) => void): void;
  launchBus(cb: (err: Error | null, bus: Pm2Bus) => void): void;
}

const globalPath = execSync("npm root -g", { encoding: "utf-8" }).trim();
const _require = createRequire(globalPath + "/");
const pm2: Pm2 = _require("pm2");

const APP_NAME = "shmastra";
const APP_DIR = "/home/user/shmastra";
const MAX_ATTEMPTS = 3;

const HEAL_URL = `${process.env.CORS_ORIGIN}/api/sandbox/heal`;
const AUTH_TOKEN = process.env.MASTRA_AUTH_TOKEN;

interface Pm2ProcessInfo {
  pm2_env?: {
    status?: string;
    restart_time?: number;
  };
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function reportStatus(status: "healing" | "ready" | "broken", error?: string): Promise<void> {
  if (!HEAL_URL || !AUTH_TOKEN) return;
  try {
    await fetch(HEAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({ status, error }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to report status "${status}": ${message}`);
  }
}

function describeApp(): Promise<Pm2ProcessInfo | null> {
  return new Promise((resolve, reject) => {
    pm2.describe(APP_NAME, (err: Error | null, list: any[]) => {
      if (err) return reject(err);
      resolve((list[0] as Pm2ProcessInfo) ?? null);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const PM2_MODULE_CONF = `${process.env.HOME}/.pm2/module_conf.json`;

function fixPm2Config(): void {
  try {
    const raw = readFileSync(PM2_MODULE_CONF, "utf-8");
    JSON.parse(raw);
  } catch {
    log("Corrupted PM2 module_conf.json detected, resetting to {}");
    writeFileSync(PM2_MODULE_CONF, "{}", "utf-8");
  }
}

async function heal(): Promise<boolean> {
  log("Server crashed, starting heal...");
  await reportStatus("healing");

  const [
    { Agent },
    { Workspace, LocalFilesystem, LocalSandbox },
    { createTool },
    { z },
    { PrefillErrorHandler },
  ] = await Promise.all([
    import("@mastra/core/agent"),
    import("@mastra/core/workspace"),
    import("@mastra/core/tools"),
    import("zod"),
    import("@mastra/core/processors"),
  ]);

  const restartTool = createTool({
    id: "restart_shmastra",
    description:
      "Restart the shmastra dev server. Returns whether the server started successfully and healthy on port 4111. Use this after making code fixes.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        fixPm2Config();
        await new Promise<void>((resolve, reject) => {
          pm2.restart(APP_NAME, (err: Error | null) => (err ? reject(err) : resolve()));
        });
      } catch (err: any) {
        return { status: "error", message: `Restart failed: ${err.message}` };
      }

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await sleep(5_000);
        try {
          const res = await fetch("http://localhost:4111/health", { signal: AbortSignal.timeout(3_000) });
          if (res.ok) {
            return { status: "healthy", message: "Server is up and responding" };
          }
        } catch {}
      }

      try {
        const { execSync: exec } = await import("child_process");
        const tail = exec(`tail -20 ${APP_DIR}/.logs/shmastra.log`, { encoding: "utf-8", timeout: 5_000 });
        return { status: "error", message: "Server not healthy after 30s", log: tail.slice(-1000) };
      } catch {
        return { status: "error", message: "Server not healthy after 30s" };
      }
    },
  });

  const waitTool = createTool({
    id: "wait",
    description: "Wait for the specified number of seconds",
    inputSchema: z.object({
      seconds: z.number().min(1).max(120).describe("Number of seconds to wait"),
    }),
    execute: async ({ seconds }) => {
      await sleep(seconds * 1000);
      return { waited: seconds };
    },
  });

  const sandbox = new LocalSandbox({
    workingDirectory: APP_DIR,
    env: process.env,
    timeout: 120_000,
  });
  const filesystem = new LocalFilesystem({ basePath: APP_DIR });
  const workspace = new Workspace({ sandbox, filesystem });

  const agent = new Agent({
    workspace,
    tools: { restart_shmastra: restartTool, wait: waitTool },
    id: "healer",
    name: "healer",
    model: "anthropic/claude-sonnet-4-6",
    errorProcessors: [new PrefillErrorHandler()],
    instructions: `You are a self-healing agent for a Mastra dev server.
The project is at ${APP_DIR}. The dev server (pnpm dev) has crashed and PM2 restarts are exhausted.

Server log file (stdout + stderr combined):
- .logs/shmastra.log

Your job:
1. Read logs tail to understand what went wrong. You need only entries after the latest "Starting Mastra dev server" line in the log. Previous entries don't matter.
2. If the latest log entries show the server is running normally with no errors (e.g. "Ready in", successful requests, normal startup messages), do nothing and finish.
3. If the latest log entries show that server is starting but not ready yet - just wait for 10-15s and read logs again. If it's still starting - inspect and fix. Sometimes simple restarting helps.
4. Inspect relevant source files to find the root cause.
5. Fix the code — make minimal, targeted changes.
6. Use the restart_shmastra tool to restart the server — it will wait for the process to settle and return the actual status.
7. If the status is not "online", read the new logs and try a different fix.
8. Once the server is online, commit your changes: git add -A && git commit -m "<short description of what you fixed>"

Rules:
- If server responds normally on port 4111 - do nothing and finish immediatelly.
- NEVER ask questions or request clarification. Always take action.
- NEVER inspect healer.log - it's your own log file.
- Make minimal fixes only. Do not refactor or add features.
- If the error is in user code, fix it.
- Do not edit sources inside src/shmastra - it is internal framework.
- If the error is in dependencies (node_modules), try reinstalling: pnpm install
- If the error is a missing env var or config issue, check .env file
- Be concise in your reasoning.`,
  });

  try {
    let lastSummary = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      log(`Heal attempt ${attempt}/${MAX_ATTEMPTS}`);

      const prompt =
        attempt === 1
          ? "The dev server has crashed. Read the error log files, diagnose and fix the issue."
          : `The previous fix did not work:\n${lastSummary}\n\nRead the latest error logs and continue fixing the issue.`;

      try {
        const stream = await agent.stream(prompt, { maxSteps: 100 });
        let agentText = "";
        let textBuf = "";

        const flushText = () => {
          if (!textBuf) return;
          for (const line of textBuf.split("\n")) {
            const trimmed = line.trim();
            if (trimmed) console.log(`  ${trimmed}`);
          }
          textBuf = "";
        };

        for await (const part of stream.fullStream) {
          switch (part.type) {
            case "text-delta":
              textBuf += part.payload.text;
              agentText += part.payload.text;
              break;
            case "tool-call": {
              flushText();
              const name = (part.payload.toolName || "").replace("mastra_workspace_", "");
              const argsStr = JSON.stringify(part.payload.args);
              console.log(`> ${name}(${argsStr.length > 100 ? argsStr.slice(0, 100) + "…" : argsStr})`);
              break;
            }
            case "tool-result": {
              const name = (part.payload.toolName || "").replace("mastra_workspace_", "");
              const r = part.payload.result;
              const s = typeof r === "string" ? r : JSON.stringify(r);
              const first = s.split("\n")[0] || "";
              const maxLen = 120 - name.length;
              console.log(`→ ${name}: ${first.length > maxLen ? first.slice(0, maxLen) + "…" : first}`);
              break;
            }
            case "tool-error":
              flushText();
              console.log(`✗ tool error [${part.payload.toolName}]: ${part.payload.error}`);
              break;
            case "finish": {
              flushText();
              const reason = part.payload?.stepResult?.reason || "unknown";
              const usage = part.payload?.output?.usage;
              const tokens = usage ? ` ${usage.inputTokens}+${usage.outputTokens}t` : "";
              console.log(`✓ step done (${reason}${tokens})`);
              break;
            }
            case "abort":
              flushText();
              console.log(`⚠ stream aborted`);
              break;
            case "error":
              flushText();
              console.log(`✗ ${part.payload}`);
              break;
          }
        }
        flushText();

        if (await isServerHealthy()) {
          log("Server is back online. Heal successful. Restarting healer to free memory...");
          await reportStatus("ready");
          fixPm2Config();
          pm2.restart("healer", () => {});
          return true;
        }

        lastSummary = agentText.slice(-500) || "Agent produced no output";
        log("Agent finished but server not healthy, retrying...");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Agent error: ${message}`);
        lastSummary = message;
      }
    }

    log(`Failed to heal after ${MAX_ATTEMPTS} attempts. Stopping healer to avoid loops.`);
    await reportStatus("broken", lastSummary);
    pm2.delete("healer", (err) => {
      if (err) log(`Failed to stop healer: ${err.message}`);
      process.exit(0);
    });
    return false;
  } finally {
    try {
      await sandbox.destroy();
      log("Sandbox destroyed, orphan processes killed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Sandbox destroy failed: ${message}`);
    }
  }
}

const HEALTH_URL = "http://localhost:4111/health";
const HEALTH_POLL_MS = 20_000;  // check every 20s
const HEALTH_RETRY_MS = 10_000; // wait 10s before confirming failure

async function isServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

const LOG_FILE = `${APP_DIR}/.logs/shmastra.log`;
const BUNDLING_STUCK_MS = 20_000; // if log hasn't changed in 20s after "Bundling..."

function restartApp(): Promise<void> {
  fixPm2Config();
  return new Promise((resolve, reject) => {
    pm2.restart(APP_NAME, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

// Watch for stuck "Bundling..." — if log stops updating for 20s, restart
function watchBundlingStuck(busy: { value: boolean }): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  setInterval(() => {
    if (busy.value || timer) return;
    try {
      const content = readFileSync(LOG_FILE, "utf-8");
      const lastLine = content.trimEnd().split("\n").pop() || "";
      if (!lastLine.includes("Bundling")) return;

      const lastModified = statSync(LOG_FILE).mtimeMs;
      const stale = Date.now() - lastModified > 5_000; // log hasn't changed for 5s already
      if (!stale) return;

      log("Detected stuck 'Bundling...', waiting 20s to confirm...");
      timer = setTimeout(async () => {
        timer = null;
        if (busy.value) return;
        try {
          const newMtime = statSync(LOG_FILE).mtimeMs;
          if (newMtime > lastModified) {
            log("Log updated, Bundling resumed.");
            return;
          }
          log("Log still stale after 20s, restarting shmastra...");
          busy.value = true;
          await restartApp();
          log("Restarted shmastra after stuck Bundling, pausing checks for 30s...");
          await sleep(30_000);
          busy.value = false;
        } catch (err: any) {
          log(`Restart after stuck Bundling failed: ${err.message}`);
        }
      }, BUNDLING_STUCK_MS);
    } catch {}
  }, 10_000);

  log("Watching for stuck Bundling...");
}

function getPm2GodPid(): number | null {
  try {
    const pid = parseInt(readFileSync(`${process.env.HOME}/.pm2/pm2.pid`, "utf-8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function getAncestors(pid: number): Set<number> {
  const ancestors = new Set<number>();
  let p = pid;
  while (p > 1) {
    try {
      const ppid = parseInt(execSync(`ps -o ppid= -p ${p}`, { encoding: "utf-8" }).trim(), 10);
      if (!Number.isFinite(ppid) || ppid === p) break;
      ancestors.add(ppid);
      p = ppid;
    } catch {
      break;
    }
  }
  return ancestors;
}

function getPm2ManagedPids(): Set<number> {
  const pids = new Set<number>();
  const god = getPm2GodPid();
  if (god) pids.add(god);
  try {
    const out = execSync("pm2 jlist", { encoding: "utf-8", timeout: 5_000 });
    const list = JSON.parse(out) as Array<{ pid?: number; pm2_env?: { pid?: number } }>;
    for (const p of list) {
      if (typeof p.pid === "number" && p.pid > 0) pids.add(p.pid);
      if (typeof p.pm2_env?.pid === "number" && p.pm2_env.pid > 0) pids.add(p.pm2_env.pid);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`pm2 jlist failed: ${message}`);
  }
  return pids;
}

function killOrphanNodeProcesses(): void {
  const managed = getPm2ManagedPids();
  if (managed.size === 0) {
    log("No pm2-managed pids discovered, skipping orphan cleanup.");
    return;
  }
  let pids: number[] = [];
  try {
    pids = execSync(`pgrep -u "$(id -un)" node || true`, { encoding: "utf-8" })
      .trim()
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n !== process.pid && !managed.has(n));
  } catch {
    return;
  }
  let killed = 0;
  for (const pid of pids) {
    const ancestors = getAncestors(pid);
    let hasManagedAncestor = false;
    for (const m of managed) {
      if (ancestors.has(m)) {
        hasManagedAncestor = true;
        break;
      }
    }
    if (hasManagedAncestor) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {}
  }
  if (killed > 0) log(`Killed ${killed} orphan node process(es)`);
}

// ── Resource pressure watcher ──

const PRESSURE_CHECK_MS = 15_000;
const PRESSURE_SUSTAINED = 4; // 4 * 15s = 1 min of sustained pressure
const MEM_PCT_LIMIT = 0.9;
const LOAD_PER_CPU_LIMIT = 2.5;

function readCgroupMemoryPct(): number | null {
  try {
    const usage = parseInt(readFileSync("/sys/fs/cgroup/memory.current", "utf-8").trim(), 10);
    const limitStr = readFileSync("/sys/fs/cgroup/memory.max", "utf-8").trim();
    const limit = limitStr === "max" ? NaN : parseInt(limitStr, 10);
    if (Number.isFinite(usage) && Number.isFinite(limit) && limit > 0) return usage / limit;
  } catch {}
  try {
    const usage = parseInt(readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf-8").trim(), 10);
    const limit = parseInt(readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf-8").trim(), 10);
    if (Number.isFinite(usage) && Number.isFinite(limit) && limit > 0 && limit < 1e15) return usage / limit;
  } catch {}
  return null;
}

function readLoadPerCpu(): number {
  const [oneMin] = os.loadavg();
  const cpus = os.cpus().length || 1;
  return oneMin / cpus;
}

async function emergencyResourceHeal(): Promise<void> {
  log("Resource pressure sustained, emergency heal: killing orphans and restarting shmastra.");
  await reportStatus("healing");
  killOrphanNodeProcesses();
  try {
    fixPm2Config();
    await new Promise<void>((resolve, reject) => {
      pm2.restart(APP_NAME, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Emergency pm2 restart failed: ${message}`);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(5_000);
    if (await isServerHealthy()) {
      await reportStatus("ready");
      log("Emergency heal successful, server ready.");
      return;
    }
  }
  log("Server still unhealthy 60s after emergency heal.");
}

function watchResourcePressure(busy: { value: boolean }): void {
  let sustained = 0;
  setInterval(async () => {
    if (busy.value) {
      sustained = 0;
      return;
    }
    const memPct = readCgroupMemoryPct();
    const load = readLoadPerCpu();
    const memHigh = memPct !== null && memPct > MEM_PCT_LIMIT;
    const loadHigh = load > LOAD_PER_CPU_LIMIT;
    if (memHigh || loadHigh) {
      sustained++;
      const memStr = memPct !== null ? `${(memPct * 100).toFixed(0)}%` : "?";
      log(`Resource pressure ${sustained}/${PRESSURE_SUSTAINED}: mem=${memStr} load/cpu=${load.toFixed(2)}`);
      if (sustained >= PRESSURE_SUSTAINED) {
        sustained = 0;
        busy.value = true;
        try {
          await emergencyResourceHeal();
        } finally {
          busy.value = false;
        }
      }
    } else if (sustained > 0) {
      sustained = 0;
    }
  }, PRESSURE_CHECK_MS);
  log("Watching for resource pressure (memory/cpu)...");
}

// ── Hibernation wake watcher ──
// E2B pauses the sandbox after idle. On resume, Node keeps stale TCP sockets
// open (peer side is long dead) and the next fetch hangs indefinitely. We
// detect the wake by watching setInterval drift — if the gap between two
// ticks is much larger than expected, the process just unfroze — then kill
// every established TCP socket so Node is forced to reconnect.

const WAKE_CHECK_MS = 100;
const WAKE_GAP_THRESHOLD_MS = 15_000;

// Kill established TCP sockets, but preserve:
// - SSH (port 22) — E2B uses it to manage the sandbox
// - loopback (pm2 god ↔ workers, localhost:4111, envd, etc.)
// What gets killed: outbound HTTPS/HTTP to the gateway and any other
// remote peer connections that went stale during hibernation.
// Filter is passed as argv to avoid shell parsing the parentheses.
// ss accepts `!=` on ports but not on `dst` — negate the whole excluded group instead.
// SOCK_DESTROY needs CAP_NET_ADMIN, so we run ss via passwordless sudo.
const SS_KILL_ARGS = "-n ss --kill state established not ( dport = :22 or sport = :22 or dst = 127.0.0.0/8 or dst = [::1] )".split(" ");

function dropStaleConnections(): void {
  try {
    execFileSync("sudo", SS_KILL_ARGS, { timeout: 5_000, stdio: "pipe" });
    log("Dropped stale remote TCP sockets (ss --kill).");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ss --kill failed: ${message}`);
  }
}

function watchSandboxWake(busy: { value: boolean }): void {
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap < WAKE_GAP_THRESHOLD_MS) return;
    const seconds = Math.round(gap / 1000);
    log(`Sandbox wake detected (tick gap ${seconds}s).`);
    if (busy.value) {
      log("Busy — skipping connection drop.");
      return;
    }
    dropStaleConnections();
  }, WAKE_CHECK_MS);
  log("Watching for sandbox wake-up...");
}

async function reportReadyWhenHealthy(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isServerHealthy()) {
      await reportStatus("ready");
      log("Server healthy on startup, reported ready.");
      return;
    }
    await sleep(3_000);
  }
  log("Server did not become healthy within 120s on startup.");
}

killOrphanNodeProcesses();

// Connect to pm2 and start watchers
pm2.connect((err: Error | null) => {
  if (err) {
    log(`Failed to connect to pm2: ${err.message}`);
    process.exit(1);
  }

  log("Connected to pm2, watching for crashes...");

  void reportReadyWhenHealthy();

  const busy = { value: false };

  // ── Stuck Bundling watcher ──
  watchBundlingStuck(busy);

  // ── Resource pressure watcher ──
  watchResourcePressure(busy);

  // ── Hibernation wake watcher ──
  watchSandboxWake(busy);

  // ── Health check polling ──
  // If health fails twice with a 10s gap, and pm2 says process is online → heal
  setInterval(async () => {
    if (busy.value) return;
    if (await isServerHealthy()) return;

    // First failure — is pm2 process even online?
    const info = await describeApp();
    if (!info || info.pm2_env?.status !== "online") return; // pm2 will handle it

    log("Health check failed, retrying in 10s...");
    await sleep(HEALTH_RETRY_MS);

    if (busy.value) {
      log("Retry skipped: another handler is already healing/watching.");
      return;
    }
    if (await isServerHealthy()) {
      log("Health check recovered after retry, server is OK.");
      return;
    }

    log("Health check failed twice, server is down. Starting heal...");
    busy.value = true;
    try {
      await heal();
    } finally {
      busy.value = false;
    }
  }, HEALTH_POLL_MS);

  // ── PM2 bus — process exit events ──
  pm2.launchBus((err: Error | null, bus: Pm2Bus) => {
    if (err) {
      log(`Failed to launch bus: ${err.message}`);
      process.exit(1);
    }

    bus.on("process:event", async (data: { process?: { name?: string }; event?: string }) => {
      if (data.process?.name !== APP_NAME) return;
      if (data.event !== "exit") return;
      if (busy.value) return;

      busy.value = true;
      try {
        log(`pm2 reported exit of ${APP_NAME}, waiting up to 30s for pm2 to settle...`);
        // Poll until pm2 settles (online = recovered, errored/stopped = gave up)
        const POLL_INTERVAL = 2_000;
        const POLL_TIMEOUT = 30_000;
        const deadline = Date.now() + POLL_TIMEOUT;

        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL);
          const info = await describeApp();
          if (!info) {
            log("pm2 describe returned empty, process gone — giving up.");
            return;
          }
          const status = info.pm2_env?.status;
          if (status === "online") {
            log("pm2 recovered shmastra on its own, back online.");
            return;
          }
          if (status === "errored" || status === "stopped") break; // pm2 gave up
        }

        const info = await describeApp();
        if (!info) {
          log("pm2 describe returned empty after polling — giving up.");
          return;
        }
        const status = info.pm2_env?.status;
        if (status === "online" || status === "launching") {
          log(`pm2 settled with status=${status}, no heal needed.`);
          return;
        }

        // Server is errored/stopped — pm2 gave up
        await heal();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Heal error: ${message}`);
      } finally {
        busy.value = false;
      }
    });
  });
});
