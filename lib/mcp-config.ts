import type { Sandbox } from "e2b";
import { MCP_SERVER_NAME } from "./mcp";

export const MCP_CONFIG_PATH = "/home/user/.mastracode/mcp.json";

/**
 * Write the cloud-managed MCP config into ~/.mastracode/mcp.json inside the
 * sandbox. The file is fully owned by the cloud — we overwrite it on every
 * sync, which avoids stale/legacy keys and keeps behaviour predictable.
 */
export async function writeMcpConfig(
  sandbox: Sandbox,
  appUrl: string,
  virtualKey: string,
): Promise<void> {
  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "http",
        url: `${appUrl.replace(/\/+$/, "")}/api/mcp`,
        headers: { Authorization: `Bearer ${virtualKey}` },
      },
    },
  };
  await sandbox.files.write(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
}
