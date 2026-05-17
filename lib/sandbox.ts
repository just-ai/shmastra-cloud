import { Sandbox, type ProcessInfo } from "e2b";
import {
  claimSandboxRetry,
  createSandboxRecord,
  getSandbox,
  getUserById,
  markSandboxCreating,
  updateSandbox,
} from "./db";
import { getVirtualKey } from "./virtual-keys";
import { writeMcpConfig } from "./mcp-config";
import { writeSkills } from "./skill-injection";
import { MASTRA_API_PREFIX } from "./mastra-constants";
import { getAppUrl } from "./app-url";
import { ensureProjectForUser, markError as markProjectError } from "./projects";
import { buildProxyUrl, setupProjectRemote } from "./project-bootstrap";

const TEMPLATE = "shmastra";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const APP_PORT = 4111;
const PROBE_TIMEOUT_MS = 3000;
const READY_ENDPOINT = "/health";
const STARTUP_TIMEOUT_MS = 180 * 1000;
const STARTUP_POLL_INTERVAL_MS = 3000;
const RESUME_PROBE_ATTEMPTS = 3;
const RESUME_PROBE_INTERVAL_MS = 2000;

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

async function probeReadyWithRetry(host: string) {
  for (let attempt = 0; attempt < RESUME_PROBE_ATTEMPTS; attempt++) {
    if (await isSandboxReady(host)) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, RESUME_PROBE_INTERVAL_MS),
    );
  }

  return false;
}

async function ensureSandboxAppRunning(
  sandbox: Sandbox,
  options: { resumed?: boolean } = {},
) {
  const sandboxHost = getSandboxHost(sandbox);

  if (options.resumed && (await probeReadyWithRetry(sandboxHost))) {
    return sandboxHost;
  }

  const processes = await sandbox.commands.list();
  const appProcessRunning = processes.some(isAppProcessRunning);

  if (!appProcessRunning) {
    console.log(`Running sandbox [${sandbox.sandboxId}] ${sandboxHost}`);
    await sandbox.commands.run("/home/user/start.sh &", {
      background: false,
    });

    await waitForSandboxApp(sandboxHost);
    return sandboxHost;
  }

  await waitForSandboxApp(sandboxHost);
  return sandboxHost;
}

export interface ProvisionOptions {
  /**
   * Values for `.env` variables, keyed by name, collected from the restore
   * form. Written verbatim to /home/user/shmastra/.env before the project
   * remote merge, so the recovered app starts with its expected secrets.
   *
   * Never logged or persisted server-side. Lives in memory for the duration
   * of one provisionSandbox call and is discarded after the file write.
   */
  envValues?: Record<string, string>;
}

function buildDotenv(envValues: Record<string, string>): string {
  // Plain `KEY=value`, one per line. Values containing newlines or special
  // characters are minimally escaped — we wrap in double quotes and escape
  // backslashes / quotes / newlines so the standard dotenv parsers used by
  // both pnpm dev and node --env-file accept them.
  //
  // Blank values from the restore form are dropped entirely (no `KEY=""`
  // line). Writing an empty key would shadow whatever default the app may
  // have for that variable; leaving it absent lets the app fall back to
  // its own logic, which matches what a user who left the field blank
  // probably intended.
  const lines: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(envValues)) {
    const key = rawKey.trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    const value = rawValue ?? "";
    if (value === "") continue;
    const needsQuoting = /[\s"'\\#$`]/.test(value);
    if (!needsQuoting) {
      lines.push(`${key}=${value}`);
    } else {
      const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
      lines.push(`${key}="${escaped}"`);
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

async function provisionSandbox(userId: string, opts: ProvisionOptions = {}) {
  const appUrl = getAppUrl();

  try {
    const user = await getUserById(userId);
    if (!user) throw new Error(`User ${userId} not found`);
    const virtualKey = getVirtualKey(user);

    // Project repo lives outside the sandbox lifecycle: same user always
    // gets the same provider repo. Hard-fail on provider error — running
    // without persistent backup is worse than not running. When the
    // provider token is not configured at all, the feature is implicitly
    // off and the sandbox creates without sync.
    const syncEnabled = !!process.env.GITLAB_SERVICE_TOKEN;
    let projectExisted = false;
    let projectSetup: { token: string; proxyUrl: string } | null = null;
    if (syncEnabled) {
      if (!user.project_token) {
        throw new Error(
          `User ${userId} has no project_token — run supabase migration 003 first`,
        );
      }
      const { created } = await ensureProjectForUser(userId);
      projectExisted = !created;
      projectSetup = {
        token: user.project_token,
        proxyUrl: buildProxyUrl(appUrl, user.project_token),
      };
    }

    const sandbox = await Sandbox.create(TEMPLATE, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      lifecycle: {
        autoResume: true,
        onTimeout: "pause",
      },
      envs: {
        MASTRA_STUDIO_BASE_PATH: "/studio",
        MASTRA_API_PREFIX,
        MASTRA_AUTH_TOKEN: virtualKey,
        ...(projectSetup ? { PROJECT_TOKEN: projectSetup.token } : {}),
        CORS_ORIGIN: appUrl,
        USER_ID: userId,
        OPENAI_API_KEY: virtualKey,
        ANTHROPIC_API_KEY: virtualKey,
        GEMINI_API_KEY: virtualKey,
        GOOGLE_GEMINI_API_KEY: virtualKey,
        GOOGLE_GENERATIVE_AI_API_KEY: virtualKey,
        COMPOSIO_API_KEY: virtualKey,
        COMPOSIO_BASE_URL: `${appUrl}/api/gateway/composio`,
        OPENAI_BASE_URL: `${appUrl}/api/gateway/openai`,
        ANTHROPIC_BASE_URL: `${appUrl}/api/gateway/anthropic`,
        GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
        GOOGLE_BASE_URL: `${appUrl}/api/gateway/google`,
        GOOGLE_GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
        GOOGLE_GENERATIVE_BASE_URL: `${appUrl}/api/gateway/google`,
        GOOGLE_GENERATIVE_AI_BASE_URL: `${appUrl}/api/gateway/google`,
      },
    });

    // Read template version to skip already-applied patches
    let version: string | null = null;
    try {
      const v = await sandbox.files.read("/home/user/.template-version");
      version = v.trim() || null;
    } catch {}

    await updateSandbox(userId, {
      sandbox_id: sandbox.sandboxId,
      sandbox_host: getSandboxHost(sandbox),
      status: "creating",
      error_message: null,
      version,
    });

    const sandboxHost = await ensureSandboxAppRunning(sandbox);

    try {
      await writeMcpConfig(sandbox, appUrl, virtualKey);
    } catch (err) {
      console.error(`Failed to write MCP config for sandbox ${sandbox.sandboxId}:`, err);
    }

    try {
      await writeSkills(sandbox);
    } catch (err) {
      console.error(`Failed to write skills for sandbox ${sandbox.sandboxId}:`, err);
    }

    // Write user-supplied `.env` BEFORE the merge so the recovered app
    // starts with its expected secrets. Form values come from the restore
    // page (§7 of the implementation plan) and are held only in memory —
    // never logged, never persisted in Supabase. Values intentionally not
    // included in the surrounding console.log statements.
    if (opts.envValues && Object.keys(opts.envValues).length > 0) {
      const body = buildDotenv(opts.envValues);
      try {
        await sandbox.files.write("/home/user/shmastra/.env", body, {
          user: "user",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to write .env: ${message}`);
      }
    }

    // Sync is mandatory whenever the provider is configured: without the
    // project remote wired up and (if the user has prior work) restored,
    // "ready" would mean a sandbox silently diverging from the user's
    // saved state. Fail loudly instead.
    if (projectSetup) {
      try {
        await setupProjectRemote(sandbox, projectSetup.proxyUrl, projectExisted);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void markProjectError(userId, message).catch(() => {});
        throw new Error(`Project remote setup failed: ${message}`);
      }
    }

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

export async function ensureSandboxForUser(
  userId: string,
  opts: ProvisionOptions = {},
) {
  const sandbox = await getSandbox(userId);
  if (sandbox) {
    if (sandbox.status === "error") {
      const retryingSandbox = await claimSandboxRetry(userId);
      if (retryingSandbox) {
        void provisionSandbox(userId, opts);
        return retryingSandbox;
      }

      return (await getSandbox(userId)) ?? sandbox;
    }

    return sandbox;
  }

  const result = await createSandboxRecord(userId);
  if (result.created) {
    void provisionSandbox(userId, opts);
  }
  return result.sandbox;
}

export async function retrySandboxForUser(
  userId: string,
  opts: ProvisionOptions = {},
) {
  await markSandboxCreating(userId);
  await provisionSandbox(userId, opts);
}

export async function getSandboxForUser(userId: string) {
  return getSandbox(userId);
}

export async function connectToSandbox(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId);
  await ensureSandboxAppRunning(sandbox, { resumed: true });
  return sandbox;
}

export async function extendSandboxTimeout(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
  return sandbox;
}
