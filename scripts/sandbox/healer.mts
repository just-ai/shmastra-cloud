import { createRequire } from "module";
import { execSync } from "child_process";
import { statSync, readFileSync, writeFileSync } from "fs";

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

let serverHealed = false;


async function heal(): Promise<boolean> {
  log("Server crashed, starting heal...");
  serverHealed = false;
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
            serverHealed = true;
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
1. Read logs tail to understand what went wrong.
2. If the latest log entries show the server is running normally with no errors (e.g. "Ready in", successful requests, normal startup messages), do nothing — just call restart_shmastra to confirm health and stop.
3. Inspect relevant source files to find the root cause.
4. Fix the code — make minimal, targeted changes.
4. Use the restart_shmastra tool to restart the server — it will wait for the process to settle and return the actual status.
5. If the status is not "online", read the new logs and try a different fix.
6. Once the server is online, commit your changes: git add -A && git commit -m "<short description of what you fixed>"

Rules:
- NEVER ask questions or request clarification. Always take action.
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

        if (serverHealed) {
          log("Server is back online. Heal successful. Restarting healer to free memory...");
          serverHealed = false;
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

// Connect to pm2 and start watchers
pm2.connect((err: Error | null) => {
  if (err) {
    log(`Failed to connect to pm2: ${err.message}`);
    process.exit(1);
  }

  log("Connected to pm2, watching for crashes...");

  const busy = { value: false };

  // ── Stuck Bundling watcher ──
  watchBundlingStuck(busy);

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

    if (busy.value) return;
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
        // Poll until pm2 settles (online = recovered, errored/stopped = gave up)
        const POLL_INTERVAL = 2_000;
        const POLL_TIMEOUT = 30_000;
        const deadline = Date.now() + POLL_TIMEOUT;

        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL);
          const info = await describeApp();
          if (!info) return;
          const status = info.pm2_env?.status;
          if (status === "online") return; // pm2 recovered on its own
          if (status === "errored" || status === "stopped") break; // pm2 gave up
        }

        const info = await describeApp();
        if (!info) return;
        const status = info.pm2_env?.status;
        if (status === "online" || status === "launching") return;

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
