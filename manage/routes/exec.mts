import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, json, sseHeaders, sseWrite, connectSandbox } from "./helpers.mjs";

export async function handleExec(req: IncomingMessage, res: ServerResponse, sandboxId: string) {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, { error: "Invalid JSON" }, 400);
  }

  const command = body?.command;
  if (!command || typeof command !== "string") {
    return json(res, { error: "command is required" }, 400);
  }

  sseHeaders(res);
  const write = (event: string, data: unknown) => sseWrite(res, event, data);

  try {
    const sandbox = await connectSandbox(sandboxId);
    const result = await sandbox.commands.run(command, { timeoutMs: 120_000 });
    if (result.stdout) write("stdout", { text: result.stdout });
    if (result.stderr) write("stderr", { text: result.stderr });
    write("exit", { code: result.exitCode });
  } catch (err: any) {
    write("error", { error: err.message });
  }

  res.end();
}
