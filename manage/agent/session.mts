import { Agent } from "@mastra/core/agent";
import { Workspace } from "@mastra/core/workspace";
import { E2BSandbox } from "@mastra/e2b";
import { connectSandbox, type SandboxInstance } from "../sandbox.mjs";
import {Memory} from "@mastra/memory";
import {LibSQLStore} from "@mastra/libsql";
import {PrefillErrorHandler} from "@mastra/core/processors";

const AGENT_INSTRUCTIONS = `You are a sandbox management agent for the Shmastra platform.
You have full access to the sandbox filesystem and can execute commands.
The project is at /home/user/shmastra.

You can help with:
- Running commands, checking logs, inspecting processes
- Reading and editing files
- Debugging issues with the dev server or build
- Managing PM2 processes
- Checking disk usage, memory, running processes
- Any other sandbox administration tasks

To request Mastra REST API use "http://localhost:4111{MASTRA_API_PREFIX env}/{path}" with Authorization Bearer {MASTRA_AUTH_TOKEN env}

Mastra project is hosted in /home/user/shmastra.
Mastra database is in /home/user/shmastra/.storage/mastra.db (sqlite3)

Be concise in your responses. When running commands, show the output.`;

export interface AgentSession {
  sandboxId: string;
  agent: Agent;
  workspace: Workspace;
  sandbox: SandboxInstance;
  lastMessageAt: Date;
}

const sessions = new Map<string, AgentSession>();

export async function getOrCreateSession(sandboxId: string): Promise<AgentSession> {
  const existing = sessions.get(sandboxId);
  if (existing) {
    existing.lastMessageAt = new Date();
    return existing;
  }

  const sandbox = await connectSandbox(sandboxId, { timeoutMs: 10 * 60 * 1000 });

  const e2bSandbox = new E2BSandbox({ id: sandboxId });
  (e2bSandbox as any)._sandbox = sandbox;

  const workspace = new Workspace({ sandbox: e2bSandbox });
  await workspace.init();

  const agent = new Agent({
    workspace,
    id: `manage-${sandboxId}`,
    name: `manage-${sandboxId}`,
    model: "anthropic/claude-sonnet-4-6",
    instructions: AGENT_INSTRUCTIONS,
    errorProcessors: [new PrefillErrorHandler()],
    memory: new Memory({
      options: {
        lastMessages: 50,
      },
      storage: new LibSQLStore({
        id: `store-${sandboxId}`,
        url: ":memory:",
      })
    }),
  });

  const session: AgentSession = {
    sandboxId,
    agent,
    workspace,
    sandbox,
    lastMessageAt: new Date(),
  };

  sessions.set(sandboxId, session);
  return session;
}

export async function streamMessage(sandboxId: string, message: string) {
  const session = await getOrCreateSession(sandboxId);
  return session.agent.stream(message, {
    maxSteps: 100,
    memory: {
      thread: sandboxId,
      resource: sandboxId,
    }
  });
}

export function destroySession(sandboxId: string) {
  sessions.delete(sandboxId);
}

export function destroyAllSessions() {
  sessions.clear();
}

// Cleanup idle sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastMessageAt.getTime() > 30 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();
