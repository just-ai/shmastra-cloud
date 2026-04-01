import { Sandbox, type ProcessInfo } from "e2b";
import {
  claimSandboxRetry,
  createSandboxRecord,
  getSandbox,
  markSandboxCreating,
  updateSandbox,
} from "./db";
import { getOrCreateVirtualKey } from "./virtual-keys";

const TEMPLATE = "shmastra";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const APP_PORT = 4111;
const PROBE_TIMEOUT_MS = 3000;
const READY_ENDPOINT = "/api/auth/me";
const STARTUP_TIMEOUT_MS = 180 * 1000;
const STARTUP_POLL_INTERVAL_MS = 3000;

function getSandboxHost(sandbox: Sandbox) {
  return `https://${sandbox.getHost(APP_PORT)}`;
}

export async function isSandboxReady(sandboxHost: string): Promise<boolean> {
  try {
    const response = await fetch(`${sandboxHost}${READY_ENDPOINT}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

function isAppProcessRunning(process: ProcessInfo) {
  const command = [process.cmd, ...process.args].join(" ");

  return (
    (command.includes("start.sh") ||
      command.includes("pnpm dev") ||
      command.includes("mastra dev"))
  );
}

function logSandboxOutput(
  sandboxId: string,
  stream: "stdout" | "stderr",
  data: string,
) {
  const message = data.trim();
  if (!message) {
    return;
  }

  const prefix = `[sandbox:${sandboxId}] ${stream}`;
  if (stream === "stderr") {
    console.error(`${prefix}: ${message}`);
    return;
  }

  console.log(`${prefix}: ${message}`);
}

async function waitForSandboxApp(host: string) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isSandboxReady(host)) {
      return;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, STARTUP_POLL_INTERVAL_MS),
    );
  }

  throw new Error("Timed out waiting for Mastra server to start");
}

async function ensureSandboxAppRunning(sandbox: Sandbox) {
  const sandboxHost = getSandboxHost(sandbox);

  if (await isSandboxReady(sandboxHost)) {
    return sandboxHost;
  }

  const processes = await sandbox.commands.list();
  const appProcessRunning = processes.some(isAppProcessRunning);

  if (!appProcessRunning) {
    console.log(`Updating sandbox [${sandbox.sandboxId}]`);
    await sandbox.commands.run(`git pull && pnpm install`);

    console.log(`Running sandbox [${sandbox.sandboxId}] ${sandboxHost}`);
    await sandbox.commands.run("pnpm dev >> /home/user/shmastra.log 2>&1 &", {
      background: false,
    });

    await waitForSandboxApp(sandboxHost);
    return sandboxHost;
  }

  await waitForSandboxApp(sandboxHost);
  return sandboxHost;
}

async function provisionSandbox(userId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  try {
    const virtualKey = await getOrCreateVirtualKey(userId);

    const sandbox = await Sandbox.create(TEMPLATE, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      lifecycle: {
        autoResume: true,
        onTimeout: "pause",
      },
      envs: {
        MASTRA_STUDIO_BASE_PATH: "/studio",
        MASTRA_API_PREFIX: "/api/mastra",
        USER_ID: userId,
        OPENAI_API_KEY: virtualKey,
        ANTHROPIC_API_KEY: virtualKey,
        GEMINI_API_KEY: virtualKey,
        COMPOSIO_API_KEY: virtualKey,
        COMPOSIO_BASE_URL: `${appUrl}/api/gateway/composio`,
        OPENAI_BASE_URL: `${appUrl}/api/gateway/openai`,
        ANTHROPIC_BASE_URL: `${appUrl}/api/gateway/anthropic`,
        GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
        GOOGLE_GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
        GOOGLE_GENERATIVE_BASE_URL: `${appUrl}/api/gateway/gemini`,
      },
    });

    await updateSandbox(userId, {
      sandbox_id: sandbox.sandboxId,
      sandbox_host: getSandboxHost(sandbox),
      status: "creating",
      error_message: null,
    });

    const sandboxHost = await ensureSandboxAppRunning(sandbox);

    await updateSandbox(userId, {
      sandbox_host: sandboxHost,
      status: "ready",
      error_message: null,
    });
  } catch (err) {
    console.error("Failed to create sandbox:", err);
    await updateSandbox(userId, {
      status: "error",
      error_message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function createSandboxForUser(userId: string) {
  const { created } = await createSandboxRecord(userId);
  if (created) {
    await provisionSandbox(userId);
  }
}

export async function ensureSandboxForUser(userId: string) {
  const sandbox = await getSandbox(userId);
  if (sandbox) {
    if (sandbox.status === "error") {
      const retryingSandbox = await claimSandboxRetry(userId);
      if (retryingSandbox) {
        void provisionSandbox(userId);
        return retryingSandbox;
      }

      return (await getSandbox(userId)) ?? sandbox;
    }

    return sandbox;
  }

  const result = await createSandboxRecord(userId);
  if (result.created) {
    void provisionSandbox(userId);
  }
  return result.sandbox;
}

export async function retrySandboxForUser(userId: string) {
  await markSandboxCreating(userId);
  await provisionSandbox(userId);
}

export async function getSandboxForUser(userId: string) {
  return getSandbox(userId);
}

export async function connectToSandbox(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId);
  await ensureSandboxAppRunning(sandbox);
  return sandbox;
}

export async function extendSandboxTimeout(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
  return sandbox;
}
