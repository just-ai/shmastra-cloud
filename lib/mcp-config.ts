import type { Sandbox } from "e2b";

export const MCP_CONFIG_PATH = "/home/user/.mastracode/mcp.json";
// Key in mcp.json; must match MCP_SERVER_NAME in lib/mcp/index.ts.
export const MCP_SERVER_KEY = "shmastra-cloud";
// Legacy key written by earlier versions; strip on write so it doesn't linger.
const LEGACY_SERVER_KEYS = ["shmastra-scheduler"];

type McpServerEntry = {
  type: string;
  url: string;
  headers?: Record<string, string>;
};

type McpConfig = {
  mcpServers?: Record<string, McpServerEntry>;
};

function buildEntry(appUrl: string, virtualKey: string): McpServerEntry {
  return {
    type: "http",
    url: `${appUrl.replace(/\/+$/, "")}/api/mcp`,
    headers: { Authorization: `Bearer ${virtualKey}` },
  };
}

/**
 * Write (or merge) the shmastra-scheduler MCP entry into ~/.mastracode/mcp.json
 * inside the sandbox. Preserves any other entries the user added.
 */
export async function writeMcpConfig(
  sandbox: Sandbox,
  appUrl: string,
  virtualKey: string,
): Promise<void> {
  let existing: McpConfig = {};
  try {
    const raw = await sandbox.files.read(MCP_CONFIG_PATH);
    if (raw && raw.trim()) {
      existing = JSON.parse(raw) as McpConfig;
    }
  } catch {
    // File (or parent dir) doesn't exist yet — fall through to write.
  }

  const existingServers = { ...(existing.mcpServers ?? {}) };
  for (const legacy of LEGACY_SERVER_KEYS) delete existingServers[legacy];

  const merged: McpConfig = {
    ...existing,
    mcpServers: {
      ...existingServers,
      [MCP_SERVER_KEY]: buildEntry(appUrl, virtualKey),
    },
  };

  await sandbox.files.write(MCP_CONFIG_PATH, JSON.stringify(merged, null, 2));
}
