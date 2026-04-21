import type { UpdateContext } from "@/manage/update/runner.mjs";
import { writeMcpConfig } from "@/lib/mcp-config";

export default async function ({ sandbox, env, log }: UpdateContext) {
  log(`Writing MCP config (appUrl=${env.appUrl})`);
  await writeMcpConfig(sandbox, env.appUrl, env.user.virtual_key!);
}
