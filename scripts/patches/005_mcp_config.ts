import type { UpdateContext } from "@/manage/update/runner.mjs";
import { writeMcpConfig } from "@/lib/mcp-config";

export default async function ({ sandbox, log, supabase }: UpdateContext) {
  const sandboxId = sandbox.sandboxId;

  const { data: sbData, error: sbErr } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandboxId)
    .maybeSingle();
  if (sbErr) throw sbErr;

  if (!sbData) {
    log("Sandbox not in DB — skipping MCP config write");
    return;
  }

  const { data: userData, error: userErr } = await supabase
    .from("users")
    .select("virtual_key")
    .eq("id", sbData.user_id)
    .maybeSingle();
  if (userErr) throw userErr;

  const virtualKey = userData?.virtual_key;
  if (!virtualKey) throw new Error("User has no virtual_key");

  const domain =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  const appUrl = `${protocol}://${domain}`;

  log(`Writing MCP scheduler config to /home/user/.mastracode/mcp.json (appUrl=${appUrl})`);
  await writeMcpConfig(sandbox, appUrl, virtualKey);
}
