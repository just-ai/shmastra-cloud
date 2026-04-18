import type { Request, Response } from "express";
import { connectSandbox } from "./helpers.mjs";

function userForPath(path: string): string {
  return path.startsWith("/home/user") ? "user" : "root";
}

async function getSandboxOrError(sandboxId: string, res: Response) {
  try {
    return await connectSandbox(sandboxId);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return null;
  }
}

export async function handleFilesList(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  const filePath = (req.query.path as string) || "/home/user";
  try {
    const entries = await sandbox.files.list(filePath, { user: userForPath(filePath) });
    const items = entries.map((e: any) => ({ name: e.name, type: e.type, path: e.path }));
    items.sort((a: any, b: any) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleFilesRead(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  const filePath = (req.query.path as string) || "/home/user";
  try {
    const content = await sandbox.files.read(filePath, { user: userForPath(filePath) });
    res.json({ path: filePath, content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleFilesDownload(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  const filePath = (req.query.path as string) || "/home/user";
  try {
    const isDir = req.query.type === "dir";
    const name = filePath.split("/").pop() || "file";

    if (isDir) {
      const tmpArchive = `/tmp/${name}-${Date.now()}.tar.gz`;
      const parent = filePath.split("/").slice(0, -1).join("/") || "/";
      const user = userForPath(filePath);
      await sandbox.commands.run(
        `tar -czf ${JSON.stringify(tmpArchive)} -C ${JSON.stringify(parent)} ${JSON.stringify(name)}`,
        { timeoutMs: 120_000, user },
      );
      const content = await sandbox.files.read(tmpArchive, { format: "bytes", user });
      sandbox.commands.run(`rm -f ${JSON.stringify(tmpArchive)}`, { timeoutMs: 5_000, user }).catch(() => {});
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${name}.tar.gz"`,
      });
      res.end(Buffer.from(content));
    } else {
      const content = await sandbox.files.read(filePath, { format: "bytes", user: userForPath(filePath) });
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
      });
      res.end(Buffer.from(content));
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleFilesWrite(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  try {
    await sandbox.files.write(req.body.path, req.body.content, { user: userForPath(req.body.path) });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleFilesMkdir(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  try {
    await sandbox.files.makeDir(req.body.path, { user: userForPath(req.body.path) });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleFilesDelete(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  try {
    await sandbox.files.remove(req.body.path, { user: userForPath(req.body.path) });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleFilesRename(req: Request, res: Response) {
  const sandbox = await getSandboxOrError(req.params.sandboxId as string, res);
  if (!sandbox) return;
  try {
    await sandbox.files.rename(req.body.oldPath, req.body.newPath, { user: userForPath(req.body.oldPath) });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
