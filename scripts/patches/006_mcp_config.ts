import type { UpdateContext } from "@/manage/update/runner.mjs";
import { resolveSandboxEnvContext } from "@/manage/update/utils.mjs";
import { writeMcpConfig } from "@/lib/mcp-config";

export default async function (ctx: UpdateContext) {
  const env = await resolveSandboxEnvContext(ctx);
  if (!env) {
    ctx.log("Sandbox not in DB — skipping MCP config write");
    return;
  }
  ctx.log(`Writing MCP config (appUrl=${env.appUrl})`);
  await writeMcpConfig(ctx.sandbox, env.appUrl, env.user.virtual_key!);
}
