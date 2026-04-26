import express from "express";
import { Sandbox } from "e2b";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { handleEvents, handleListSandboxes, handleUpdateOne, handleStopOne, handleStopAll, handleUpdateAll, handlePhases } from "./routes/updates.mjs";
import { handleChat, handleDestroyChat } from "./routes/chat.mjs";
import { handleExec } from "./routes/exec.mjs";
import { handleLogs } from "./routes/logs.mjs";
import { handleStats, handleStatsDirs, handleStatsErrors, handleStatsFds } from "./routes/stats.mjs";
import { handleMastraStats, handleObservability, handleTraceDetail } from "./routes/mastra-stats.mjs";
import { handleFilesList, handleFilesRead, handleFilesDownload, handleFilesWrite, handleFilesMkdir, handleFilesDelete, handleFilesRename } from "./routes/files.mjs";
import { handleListTasks, handleListTaskRuns } from "./routes/tasks.mjs";
import { currentProfile, availableProfiles, loadedFiles, switchProfile } from "./env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEEPALIVE_MS = 10 * 60 * 1000;

export function startServer(port: number) {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json({ limit: "10mb" }));

  // ── Sandboxes ──
  app.get("/api/events", handleEvents);
  app.get("/api/sandboxes", handleListSandboxes);
  app.get("/api/phases", handlePhases);
  app.post("/api/update-all", handleUpdateAll);
  app.post("/api/stop-all", handleStopAll);
  app.post("/api/update/:sandboxId", handleUpdateOne);
  app.post("/api/stop/:sandboxId", handleStopOne);

  // ── Chat ──
  app.post("/api/chat/:sandboxId", handleChat);
  app.delete("/api/chat/:sandboxId", handleDestroyChat);

  // ── Exec ──
  app.post("/api/exec/:sandboxId", handleExec);

  // ── Keepalive ──
  app.post("/api/keepalive/:sandboxId", async (req, res) => {
    try {
      await Sandbox.setTimeout(req.params.sandboxId, KEEPALIVE_MS);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Logs ──
  app.get("/api/logs/:sandboxId", handleLogs);

  // ── Stats ──
  app.get("/api/stats/:sandboxId", handleStats);
  app.get("/api/stats/:sandboxId/dirs", handleStatsDirs);
  app.get("/api/stats/:sandboxId/errors", handleStatsErrors);
  app.get("/api/stats/:sandboxId/fds", handleStatsFds);
  app.get("/api/stats/:sandboxId/mastra", handleMastraStats);
  app.get("/api/stats/:sandboxId/observability", handleObservability);
  app.get("/api/stats/:sandboxId/observability/:traceId", handleTraceDetail);

  // ── Files ──
  app.get("/api/files/:sandboxId/list", handleFilesList);
  app.get("/api/files/:sandboxId/read", handleFilesRead);
  app.get("/api/files/:sandboxId/download", handleFilesDownload);
  app.post("/api/files/:sandboxId/write", handleFilesWrite);
  app.post("/api/files/:sandboxId/mkdir", handleFilesMkdir);
  app.post("/api/files/:sandboxId/delete", handleFilesDelete);
  app.post("/api/files/:sandboxId/rename", handleFilesRename);

  // ── Tasks (schedules) ──
  app.get("/api/tasks/:sandboxId", handleListTasks);
  app.get("/api/tasks/:sandboxId/:scheduleId/runs", handleListTaskRuns);

  // ── Env profile ──
  app.get("/api/env", (_req, res) => {
    res.json({ profile: currentProfile, profiles: availableProfiles, files: loadedFiles });
  });
  app.post("/api/env", (req, res) => {
    const { profile } = req.body ?? {};
    const result = switchProfile(profile);
    res.status(result.error ? 400 : 200).json(result);
  });

  // ── Static files ──
  const uiDir = resolve(__dirname, "ui");
  app.get("/", (_req, res) => res.sendFile(resolve(uiDir, "manage.html")));
  app.get("/manage.css", (_req, res) => res.sendFile(resolve(uiDir, "manage.css")));
  app.use("/ui", express.static(uiDir));

  app.listen(port, () => {
    console.log(`Sandbox manager: http://localhost:${port}`);
  });
}
