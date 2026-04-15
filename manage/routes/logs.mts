import type { ServerResponse } from "node:http";
import { json, jsonError, connectSandbox } from "./helpers.mjs";

export async function handleLogs(res: ServerResponse, sandboxId: string, lines: number, process: string) {
  try {
    const sandbox = await connectSandbox(sandboxId);

    const logDir = "/home/user/shmastra/.logs";
    const logFiles: Record<string, string> = {
      shmastra: `${logDir}/shmastra.log`,
      healer: `${logDir}/healer.log`,
    };

    const targets = process === "all" ? Object.keys(logFiles) : [process];
    const results: { process: string; lines: string[] }[] = [];

    for (const proc of targets) {
      const file = logFiles[proc];
      if (!file) continue;
      try {
        const result = await sandbox.commands.run(`tail -n ${lines} ${file} 2>/dev/null`, { timeoutMs: 10_000 });
        results.push({
          process: proc,
          lines: result.stdout ? result.stdout.split("\n").filter((l: string) => l) : [],
        });
      } catch {
        results.push({ process: proc, lines: [] });
      }
    }

    json(res, results);
  } catch (err: any) {
    jsonError(res, err);
  }
}
