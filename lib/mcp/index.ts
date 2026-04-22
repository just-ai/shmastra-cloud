import { createMcpServer } from "./server";
import { schedulerToolset } from "./tools/scheduler";

export const MCP_SERVER_NAME = "shmastra_cloud";

const server = createMcpServer({
  name: MCP_SERVER_NAME,
  version: "0.1.0",
  // New capabilities ship as additional toolsets — just add them here.
  toolsets: [schedulerToolset],
});

export const handleMcpPayload = server.handlePayload;
