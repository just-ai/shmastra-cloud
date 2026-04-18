import type { Request, Response } from "express";
import { Sandbox } from "e2b";
import { connectSandbox } from "./helpers.mjs";

interface Pm2Proc {
  name: string;
  pid: number;
  pm_id: number;
  monit: { cpu: number; memory: number };
  pm2_env: {
    status: string;
    pm_uptime: number;
    restart_time: number;
    unstable_restarts: number;
  };
}

// Previous /proc/net/dev totals per sandbox, for computing rate.
const netPrev = new Map<string, { rx: number; tx: number; t: number }>();

async function runSilent(sandbox: any, cmd: string, timeoutMs = 5_000): Promise<string> {
  try {
    const r = await sandbox.commands.run(cmd, { timeoutMs, user: "user" });
    return r.stdout || "";
  } catch {
    return "";
  }
}

function parseNetTotals(netDev: string): { rx: number; tx: number } {
  let rx = 0, tx = 0;
  for (const line of netDev.split("\n")) {
    const m = line.match(/^\s*(\w+):\s+(\d+)(?:\s+\S+){7}\s+(\d+)/);
    if (!m) continue;
    if (m[1] === "lo") continue;
    rx += Number(m[2]);
    tx += Number(m[3]);
  }
  return { rx, tx };
}

export async function handleStats(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  try {
    const sandbox = await connectSandbox(sandboxId);

    // Gather everything in parallel.
    const [metrics, info, pm2Raw, procUptime, loadavg, netDev, healthStart] = await Promise.all([
      Sandbox.getMetrics(sandboxId).catch(() => [] as any[]),
      Sandbox.getInfo(sandboxId).catch(() => null as any),
      runSilent(sandbox, "pm2 jlist 2>/dev/null"),
      runSilent(sandbox, "cat /proc/uptime"),
      runSilent(sandbox, "cat /proc/loadavg"),
      runSilent(sandbox, "cat /proc/net/dev"),
      (async () => {
        const t0 = Date.now();
        try {
          const r = await sandbox.commands.run(
            "curl -sf -m 3 -o /dev/null -w '%{http_code}' http://localhost:4111/health",
            { timeoutMs: 5_000, user: "user" },
          );
          const code = Number((r.stdout || "").trim());
          return { ok: code >= 200 && code < 400, latencyMs: Date.now() - t0, status: code };
        } catch {
          return { ok: false, latencyMs: Date.now() - t0, status: 0 };
        }
      })(),
    ]);

    const latest = metrics.length ? metrics[metrics.length - 1] : null;
    let processes: Pm2Proc[] = [];
    try { processes = JSON.parse(pm2Raw); } catch {}

    // Load average
    const load = loadavg.trim().split(/\s+/).slice(0, 3).map(Number);

    // Host uptime (seconds) from /proc/uptime; sandbox uptime from info.startedAt
    const hostUptimeSec = Number((procUptime.trim().split(/\s+/)[0] || 0));
    const sandboxUptimeMs = info?.startedAt ? Date.now() - new Date(info.startedAt).getTime() : null;

    // Network rate (bytes/sec)
    const now = Date.now();
    const totals = parseNetTotals(netDev);
    const prev = netPrev.get(sandboxId);
    netPrev.set(sandboxId, { rx: totals.rx, tx: totals.tx, t: now });
    let netRate: { rxBytesPerSec: number; txBytesPerSec: number } | null = null;
    if (prev) {
      const dt = Math.max(0.001, (now - prev.t) / 1000);
      netRate = {
        rxBytesPerSec: Math.max(0, (totals.rx - prev.rx) / dt),
        txBytesPerSec: Math.max(0, (totals.tx - prev.tx) / dt),
      };
    }

    res.json({
      timestamp: now,
      system: latest ? {
        cpuPct: latest.cpuUsedPct,
        cpuCount: latest.cpuCount,
        memUsed: latest.memUsed,
        memTotal: latest.memTotal,
        diskUsed: latest.diskUsed,
        diskTotal: latest.diskTotal,
        load,
        hostUptimeSec,
        sandboxUptimeMs,
      } : { load, hostUptimeSec, sandboxUptimeMs },
      health: healthStart,
      network: netRate,
      processes: processes.map((p) => ({
        name: p.name,
        pid: p.pid,
        status: p.pm2_env?.status,
        cpu: p.monit?.cpu ?? 0,
        memory: p.monit?.memory ?? 0,
        uptime: p.pm2_env?.pm_uptime,
        restarts: p.pm2_env?.restart_time ?? 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ── Lazy sections ──

const KEY_DIRS = [
  { label: ".storage", path: "/home/user/shmastra/.storage" },
  { label: "workdir",  path: "/home/user/workdir" },
  { label: ".logs",    path: "/home/user/shmastra/.logs" },
  { label: "node_modules", path: "/home/user/shmastra/node_modules" },
];

export async function handleStatsDirs(req: Request, res: Response) {
  try {
    const sandbox = await connectSandbox(req.params.sandboxId as string);
    const items = await Promise.all(KEY_DIRS.map(async ({ label, path }) => {
      const out = await runSilent(sandbox, `du -sb ${JSON.stringify(path)} 2>/dev/null | awk '{print $1}'`, 15_000);
      const size = Number(out.trim()) || 0;
      return { label, path, size };
    }));
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleStatsErrors(req: Request, res: Response) {
  try {
    const sandbox = await connectSandbox(req.params.sandboxId as string);
    const minutes = Math.min(Number(req.query.minutes) || 5, 60);
    // Use tail+grep on last N lines — approx last few minutes of activity.
    const tailLines = 500;
    const [shmastra, healer] = await Promise.all([
      runSilent(sandbox, `tail -n ${tailLines} /home/user/shmastra/.logs/shmastra.log 2>/dev/null | grep -cEi '(^|\\s)(error|fatal|err!|exception)(\\s|:|$)' || true`),
      runSilent(sandbox, `tail -n ${tailLines} /home/user/shmastra/.logs/healer.log 2>/dev/null | grep -cE '(✗|fatal|Error:)' || true`),
    ]);
    res.json({
      window: { tailLines, approxMinutes: minutes },
      shmastra: Number(shmastra.trim()) || 0,
      healer: Number(healer.trim()) || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleStatsFds(req: Request, res: Response) {
  try {
    const sandbox = await connectSandbox(req.params.sandboxId as string);
    // Per-pm2-process FD count + total TCP connections.
    const jlist = await runSilent(sandbox, "pm2 jlist 2>/dev/null");
    let procs: Pm2Proc[] = [];
    try { procs = JSON.parse(jlist); } catch {}

    const fds = await Promise.all(procs.map(async (p) => {
      if (!p.pid) return { name: p.name, fd: 0 };
      const out = await runSilent(sandbox, `ls /proc/${p.pid}/fd 2>/dev/null | wc -l`);
      return { name: p.name, fd: Number(out.trim()) || 0 };
    }));

    const tcpOut = await runSilent(sandbox, "ss -tn 2>/dev/null | tail -n +2 | wc -l");
    const tcpEstablished = Number(tcpOut.trim()) || 0;

    res.json({ processes: fds, tcpEstablished });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
