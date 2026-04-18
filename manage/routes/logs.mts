import type { Request, Response } from "express";
import { connectSandbox } from "./helpers.mjs";

const LOG_DIR = "/home/user/shmastra/.logs";
const LOG_FILES: Record<string, string> = {
  shmastra: `${LOG_DIR}/shmastra.log`,
  healer:   `${LOG_DIR}/healer.log`,
};

export async function handleLogs(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  const lines = Math.min(Number(req.query.lines) || 200, 2000);
  const processName = String(req.query.process || "shmastra");
  const file = LOG_FILES[processName];

  if (!file) {
    res.status(400).json({ error: `Unknown process: ${processName}` });
    return;
  }

  try {
    const sandbox = await connectSandbox(sandboxId);
    const result = await sandbox.commands.run(`tail -n ${lines} ${file} 2>/dev/null`, { timeoutMs: 10_000, user: "user" });
    const raw = result.stdout ? result.stdout.split("\n").filter((l: string) => l) : [];
    res.json(raw.map((text) => ({ process: processName, text })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
