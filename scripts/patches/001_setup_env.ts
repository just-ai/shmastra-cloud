import type { UpdateContext } from "@/manage/runner.mjs";

export default async function ({ sandbox, run, log, supabase }: UpdateContext) {
  const sandboxId = sandbox.sandboxId;

  const { data: sbData, error: sbErr } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandboxId)
    .single();
  if (sbErr) throw sbErr;

  const { data: userData, error: userErr } = await supabase
    .from("users")
    .select("virtual_key")
    .eq("id", sbData.user_id)
    .single();
  if (userErr) throw userErr;

  const virtualKey = userData.virtual_key;
  const corsOrigin = "https://shmastra.vercel.app";

  log(`Setting CORS_ORIGIN=${corsOrigin}, MASTRA_AUTH_TOKEN=${virtualKey.slice(0, 10)}...`);

  const content = await sandbox.files.read("/home/user/ecosystem.config.cjs");
  const config = new Function(content.replace("module.exports =", "return"))();
  Object.assign(config.apps[0].env, { CORS_ORIGIN: corsOrigin, MASTRA_AUTH_TOKEN: virtualKey });
  await sandbox.files.write(
    "/home/user/ecosystem.config.cjs",
    `module.exports = ${JSON.stringify(config, null, 2)};\n`,
  );

  log("Installing browsers...");
  await run("cd /home/user/shmastra && pnpm run install-browsers -- --force", { timeoutMs: 300_000 });
}
