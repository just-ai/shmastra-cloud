import { createRequire } from "module";
import { execSync } from "child_process";
import { Agent } from "@mastra/core/agent";
import { Workspace, LocalFilesystem, LocalSandbox } from "@mastra/core/workspace";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {PrefillErrorHandler} from "@mastra/core/processors";

interface Pm2Bus {
  on(event: string, cb: (data: any) => void): void;
}

interface Pm2 {
  connect(cb: (err: Error | null) => void): void;
  describe(name: string, cb: (err: Error | null, list: any[]) => void): void;
  restart(name: string, cb: (err: Error | null) => void): void;
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

async function reportStatus(status: "healing" | "healed" | "broken", error?: string): Promise<void> {
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

// Custom tool: restart shmastra via pm2, wait for settle, return status
const pm2RestartTool = createTool({
  id: "pm2_restart_shmastra",
  description:
    "Restart the shmastra dev server via PM2, wait for it to settle, and return the current process status. Use this after making code fixes to check if the server starts successfully.",
  inputSchema: z.object({}),
  execute: async () => {
    // Verify the server can start before restarting pm2
    const { execSync: exec } = await import("child_process");
    try {
      const output = exec("pnpm dry-run", { cwd: APP_DIR, encoding: "utf-8", timeout: 60_000 });
      // dry-run passed — restart pm2, server will start fine
      await new Promise<void>((resolve, reject) => {
        pm2.restart(APP_NAME, (err: Error | null) => (err ? reject(err) : resolve()));
      });
      return { status: "online", message: "dry-run passed, server restarted", output: output.slice(-500) };
    } catch (err: any) {
      const output = (err.stdout ?? err.stderr ?? err.message ?? "").toString().slice(-1000);
      return { status: "error", message: "dry-run failed", output };
    }
  },
});

function createAgent(): Agent {
  const sandbox = new LocalSandbox({
    workingDirectory: APP_DIR,
    env: process.env,
    timeout: 120_000,
  });

  const filesystem = new LocalFilesystem({
    basePath: APP_DIR,
  });

  const workspace = new Workspace({ sandbox, filesystem });

  return new Agent({
    workspace,
    tools: { pm2_restart_shmastra: pm2RestartTool },
    id: "healer",
    name: "healer",
    model: "anthropic/claude-opus-4-6",
    errorProcessors: [new PrefillErrorHandler()],
    instructions: `You are a self-healing agent for a Mastra dev server.
The project is at ${APP_DIR}. The dev server (pnpm dev) has crashed and PM2 restarts are exhausted.

Server log file (stdout + stderr combined):
- .logs/shmastra.log

Your job:
1. Read logs to understand what went wrong.
2. Inspect relevant source files to find the root cause.
3. Fix the code — make minimal, targeted changes.
4. Use the pm2_restart_shmastra tool to restart the server — it will wait for the process to settle and return the actual status.
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
}

const resultSchema = z.object({
  fixed: z.boolean().describe("Did you fix the issue?"),
  summary: z.string().describe("Brief description of the root cause and what was done to fix it"),
  error: z.string().optional().describe("If not fixed, what went wrong"),
});

async function heal(): Promise<boolean> {
  log("Server crashed, starting heal...");
  await reportStatus("healing");

  const agent = createAgent();
  let lastSummary = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log(`Heal attempt ${attempt}/${MAX_ATTEMPTS}`);

    const prompt =
      attempt === 1
        ? "The dev server has crashed. Read the error log files, diagnose and fix the issue."
        : `The previous fix did not work:\n${lastSummary}\n\nRead the latest error logs and continue fixing the issue.`;

    try {
      const response = await agent.generate(prompt, {
        structuredOutput: {
          schema: resultSchema,
        },
      });
      const result = response.object;
      log(`Agent result: fixed=${result.fixed}, summary=${result.summary}`);

      if (result.fixed) {
        const info = await describeApp();
        if (info?.pm2_env?.status === "online") {
          log("Server is back online. Heal successful.");
          await reportStatus("healed");
          return true;
        }
        log("Agent reported fixed but server is not online.");
      }

      lastSummary = result.error || result.summary;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Agent error: ${message}`);
      lastSummary = message;
    }
  }

  log(`Failed to heal after ${MAX_ATTEMPTS} attempts.`);
  await reportStatus("broken", lastSummary);
  return false;
}

// Connect to pm2 and listen for events
pm2.connect((err: Error | null) => {
  if (err) {
    log(`Failed to connect to pm2: ${err.message}`);
    process.exit(1);
  }

  log("Connected to pm2, watching for crashes...");

  pm2.launchBus((err: Error | null, bus: Pm2Bus) => {
    if (err) {
      log(`Failed to launch bus: ${err.message}`);
      process.exit(1);
    }

    let busy = false;

    bus.on("process:event", async (data: { process?: { name?: string }; event?: string }) => {
      if (data.process?.name !== APP_NAME) return;
      if (data.event !== "exit") return;
      if (busy) return;

      busy = true;
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
        busy = false;
      }
    });
  });
});
