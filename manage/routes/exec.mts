import type { Request, Response } from "express";
import { sseHeaders, sseWrite, connectSandbox } from "./helpers.mjs";

export async function handleExec(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  const command = req.body?.command;
  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command is required" });
    return;
  }

  sseHeaders(res);
  const write = (event: string, data: unknown) => sseWrite(res, event, data);

  try {
    const sandbox = await connectSandbox(sandboxId);
    const result = await sandbox.commands.run(command, { timeoutMs: 120_000, user: "user" });
    if (result.stdout) write("stdout", { text: result.stdout });
    if (result.stderr) write("stderr", { text: result.stderr });
    write("exit", { code: result.exitCode });
  } catch (err: any) {
    write("error", { error: err.message });
  }

  res.end();
}
