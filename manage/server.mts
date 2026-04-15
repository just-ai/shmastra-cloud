import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { handleEvents, handleListSandboxes, handleUpdateOne, handleStopOne, handleStopAll, handleUpdateAll, handlePhases } from "./routes/updates.mjs";
import { handleChat, handleDestroyChat } from "./routes/chat.mjs";
import { handleExec } from "./routes/exec.mjs";
import { handleLogs } from "./routes/logs.mjs";
import { handleFiles } from "./routes/files.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const { pathname } = url;
  const method = req.method!;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── SSE events ──
  if (pathname === "/api/events" && method === "GET") {
    return handleEvents(res, (cb) => req.on("close", cb));
  }

  // ── Sandboxes ──
  if (pathname === "/api/sandboxes" && method === "GET") return handleListSandboxes(res);
  if (pathname === "/api/update-all" && method === "POST") return handleUpdateAll(res);
  if (pathname === "/api/stop-all" && method === "POST") return handleStopAll(res);
  if (pathname === "/api/phases" && method === "GET") return handlePhases(res);

  // ── Per-sandbox routes ──
  const updateMatch = pathname.match(/^\/api\/update\/(.+)$/);
  if (updateMatch && method === "POST") return handleUpdateOne(res, updateMatch[1]);

  const stopMatch = pathname.match(/^\/api\/stop\/(.+)$/);
  if (stopMatch && method === "POST") return handleStopOne(res, stopMatch[1]);

  const chatMatch = pathname.match(/^\/api\/chat\/(.+)$/);
  if (chatMatch && method === "POST") return handleChat(req, res, chatMatch[1]);
  if (chatMatch && method === "DELETE") return handleDestroyChat(res, chatMatch[1]);

  const execMatch = pathname.match(/^\/api\/exec\/(.+)$/);
  if (execMatch && method === "POST") return handleExec(req, res, execMatch[1]);

  const logsMatch = pathname.match(/^\/api\/logs\/(.+)$/);
  if (logsMatch && method === "GET") {
    const lines = Math.min(Number(url.searchParams.get("lines")) || 200, 2000);
    const process = url.searchParams.get("process") || "all";
    return handleLogs(res, logsMatch[1], lines, process);
  }

  const filesMatch = pathname.match(/^\/api\/files\/([^/]+)(?:\/(.+))?$/);
  if (filesMatch) return handleFiles(req, res, filesMatch[1], filesMatch[2] || "list", url);

  // ── Static files ──
  if (pathname === "/" && method === "GET") {
    try {
      const html = readFileSync(resolve(__dirname, "ui/manage.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404); res.end("manage.html not found");
    }
    return;
  }

  const staticMatch = pathname.match(/^\/(manage\.css|ui\/.+\.js)$/);
  if (staticMatch && method === "GET") {
    const ext = staticMatch[1].endsWith(".css") ? ".css" : ".js";
    const filePath = staticMatch[1] === "manage.css" ? "ui/manage.css" : staticMatch[1];
    try {
      const content = readFileSync(resolve(__dirname, filePath), "utf-8");
      res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] });
      res.end(content);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

export function startServer(port: number) {
  const server = createServer(handleRequest);
  server.listen(port, () => {
    console.log(`Sandbox manager: http://localhost:${port}`);
  });
}
