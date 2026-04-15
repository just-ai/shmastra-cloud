import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, json, jsonError, connectSandbox } from "./helpers.mjs";

export async function handleFiles(
  req: IncomingMessage,
  res: ServerResponse,
  sandboxId: string,
  action: string,
  url: URL,
) {
  let sandbox;
  try {
    sandbox = await connectSandbox(sandboxId);
  } catch (err: any) {
    return jsonError(res, err);
  }

  const filePath = url.searchParams.get("path") || "/home/user";

  // List directory
  if (action === "list" && req.method === "GET") {
    try {
      const entries = await sandbox.files.list(filePath);
      const items = entries.map((e: any) => ({ name: e.name, type: e.type, path: e.path }));
      items.sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      json(res, items);
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }

  // Read file
  if (action === "read" && req.method === "GET") {
    try {
      const content = await sandbox.files.read(filePath);
      json(res, { path: filePath, content });
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }

  // Download file or directory (zip for dirs)
  if (action === "download" && req.method === "GET") {
    try {
      const isDir = url.searchParams.get("type") === "dir";
      const name = filePath.split("/").pop() || "file";

      if (isDir) {
        const tmpZip = `/tmp/${name}-${Date.now()}.zip`;
        const parent = filePath.split("/").slice(0, -1).join("/") || "/";
        await sandbox.commands.run(
          `cd ${JSON.stringify(parent)} && zip -r ${JSON.stringify(tmpZip)} ${JSON.stringify(name)}`,
          { timeoutMs: 120_000 },
        );
        const content = await sandbox.files.read(tmpZip, { format: "bytes" });
        sandbox.commands.run(`rm -f ${JSON.stringify(tmpZip)}`, { timeoutMs: 5_000 }).catch(() => {});
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${name}.zip"`,
        });
        res.end(Buffer.from(content));
      } else {
        const content = await sandbox.files.read(filePath, { format: "bytes" });
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name}"`,
        });
        res.end(Buffer.from(content));
      }
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }

  // Write file
  if (action === "write" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      await sandbox.files.write(body.path, body.content);
      json(res, { ok: true });
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }

  // Create directory
  if (action === "mkdir" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      await sandbox.files.makeDir(body.path);
      json(res, { ok: true });
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }

  // Delete file/dir
  if (action === "delete" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      await sandbox.files.remove(body.path);
      json(res, { ok: true });
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }

  // Rename
  if (action === "rename" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      await sandbox.files.rename(body.oldPath, body.newPath);
      json(res, { ok: true });
    } catch (err: any) {
      jsonError(res, err);
    }
    return;
  }
}
