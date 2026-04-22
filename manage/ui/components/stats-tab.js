import { createElement as h, useEffect, useRef, useState } from "react";
import { API } from "../utils.js";

const POLL_MS = 2000;
const LAZY_POLL_MS = 10000;
const HISTORY = 60;

function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function fmtRate(n) {
  return n == null ? "—" : `${fmtBytes(n)}/s`;
}

function fmtPct(n) {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

function fmtSeconds(s) {
  if (!s && s !== 0) return "—";
  const sec = Math.floor(s);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return `${hrs}h ${m % 60}m`;
  const d = Math.floor(hrs / 24);
  return `${d}d ${hrs % 24}h`;
}

function fmtUptime(startMs) {
  if (!startMs) return "—";
  return fmtSeconds((Date.now() - startMs) / 1000);
}

// SVG sparkline
function Sparkline({ values, max, color = "var(--blue)", height = 40 }) {
  if (!values || values.length < 2) {
    return h("div", { style: { height: height + "px", color: "var(--text-3)", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center" } }, "collecting...");
  }
  const w = 100;
  const yMax = max || Math.max(1, ...values.map((v) => v.v));
  const step = w / (HISTORY - 1);
  const points = values.map((p, i) => {
    const x = (HISTORY - values.length + i) * step;
    const y = height - (p.v / yMax) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const areaPoints = `${(HISTORY - values.length) * step},${height} ${points} ${w},${height}`;
  return h("svg", {
    viewBox: `0 0 ${w} ${height}`,
    preserveAspectRatio: "none",
    style: { width: "100%", height: height + "px", display: "block" },
  },
    h("polyline", { points: areaPoints, fill: color, fillOpacity: 0.15, stroke: "none" }),
    h("polyline", { points, fill: "none", stroke: color, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" }),
  );
}

function Card({ label, value, sub, series, max, color }) {
  return h("div", {
    style: {
      background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
      padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px", minHeight: "100px",
    },
  },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
      h("span", { style: { fontSize: "11px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "'JetBrains Mono', monospace" } }, label),
      h("span", { style: { fontSize: "10px", color: "var(--text-3)", fontFamily: "'JetBrains Mono', monospace" } }, sub || ""),
    ),
    h("div", { style: { fontSize: "20px", fontWeight: 500, color: "var(--text-0)", fontFamily: "'JetBrains Mono', monospace" } }, value),
    series !== undefined
      ? h(Sparkline, { values: series || [], max, color })
      : h("div", { style: { height: "40px" } }),
  );
}

// Collapsible section with lazy polling when open
function LazySection({ title, open, onToggle, children }) {
  return h("div", {
    style: {
      background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
      marginBottom: "10px", overflow: "hidden",
    },
  },
    h("button", {
      onClick: onToggle,
      style: {
        width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: "var(--text-1)",
        fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px",
        cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
      },
    },
      h("span", null, title),
      h("span", { style: { color: "var(--text-3)", fontSize: "10px" } }, open ? "▾" : "▸"),
    ),
    open && h("div", { style: { padding: "0 14px 14px 14px" } }, children),
  );
}

function useLazyPoll(url, open) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!open) { setData(null); setErr(null); return; }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || "failed");
        setData(json); setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    };
    run();
    const t = setInterval(run, LAZY_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [url, open]);
  return { data, err };
}

export function StatsTab({ sandboxId }) {
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState(null);
  const cpuRef = useRef([]);
  const memRef = useRef([]);
  const diskRef = useRef([]);
  const loadRef = useRef([]);
  const rxRef = useRef([]);
  const txRef = useRef([]);
  const healthRef = useRef([]);
  const procRefs = useRef({});
  const [, tick] = useState(0);

  // Lazy sections state
  const [openDirs, setOpenDirs] = useState(false);
  const [openErrors, setOpenErrors] = useState(false);
  const [openFds, setOpenFds] = useState(false);
  const [openMastra, setOpenMastra] = useState(false);

  const dirs = useLazyPoll(`${API}/api/stats/${sandboxId}/dirs`, openDirs);
  const errors = useLazyPoll(`${API}/api/stats/${sandboxId}/errors`, openErrors);
  const fds = useLazyPoll(`${API}/api/stats/${sandboxId}/fds`, openFds);
  const mastra = useLazyPoll(`${API}/api/stats/${sandboxId}/mastra`, openMastra);

  useEffect(() => {
    let cancelled = false;
    cpuRef.current = []; memRef.current = []; diskRef.current = [];
    loadRef.current = []; rxRef.current = []; txRef.current = []; healthRef.current = [];
    procRefs.current = {};

    const push = (ref, t, v) => { ref.current = [...ref.current.slice(-(HISTORY - 1)), { t, v }]; };

    const fetchStats = async () => {
      try {
        const res = await fetch(`${API}/api/stats/${sandboxId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "stats failed");
        const t = data.timestamp;

        if (data.system) {
          if (data.system.cpuPct != null) push(cpuRef, t, data.system.cpuPct);
          if (data.system.memUsed != null) push(memRef, t, data.system.memUsed);
          if (data.system.diskUsed != null) push(diskRef, t, data.system.diskUsed);
          if (data.system.load?.[0] != null) push(loadRef, t, data.system.load[0]);
        }
        if (data.network) {
          push(rxRef, t, data.network.rxBytesPerSec);
          push(txRef, t, data.network.txBytesPerSec);
        }
        if (data.health) push(healthRef, t, data.health.latencyMs);

        for (const p of data.processes || []) {
          const s = procRefs.current[p.name] || { cpu: [], mem: [] };
          s.cpu = [...s.cpu.slice(-(HISTORY - 1)), { t, v: p.cpu }];
          s.mem = [...s.mem.slice(-(HISTORY - 1)), { t, v: p.memory }];
          procRefs.current[p.name] = s;
        }

        setLatest(data);
        setError(null);
        tick((x) => x + 1);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };

    fetchStats();
    const timer = setInterval(fetchStats, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sandboxId]);

  const sys = latest?.system;
  const health = latest?.health;
  const net = latest?.network;
  const procs = latest?.processes || [];
  const procColors = { shmastra: "var(--blue)", healer: "var(--green)" };
  const statusColor = (s) => s === "online" ? "var(--green)" : s === "stopped" ? "var(--yellow)" : "var(--red)";

  return h("div", { style: { flex: 1, overflow: "auto", padding: "16px", background: "var(--bg-0)" } },
    error && h("div", {
      style: {
        color: "var(--red)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace",
        padding: "6px 10px", background: "var(--red-bg)", borderRadius: "4px", marginBottom: "12px",
      },
    }, `✗ ${error}`),

    // Row 1: CPU / Memory / Disk
    h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "10px" },
    },
      h(Card, {
        label: "CPU", value: fmtPct(sys?.cpuPct),
        sub: sys?.cpuCount ? `${sys.cpuCount} core${sys.cpuCount === 1 ? "" : "s"}` : "",
        series: cpuRef.current, max: 100, color: "var(--blue)",
      }),
      h(Card, {
        label: "Memory", value: sys?.memTotal ? `${fmtBytes(sys.memUsed)} / ${fmtBytes(sys.memTotal)}` : "—",
        sub: sys?.memTotal ? fmtPct((sys.memUsed / sys.memTotal) * 100) : "",
        series: memRef.current, max: sys?.memTotal, color: "var(--green)",
      }),
      h(Card, {
        label: "Disk", value: sys?.diskTotal ? `${fmtBytes(sys.diskUsed)} / ${fmtBytes(sys.diskTotal)}` : "—",
        sub: sys?.diskTotal ? fmtPct((sys.diskUsed / sys.diskTotal) * 100) : "",
        series: diskRef.current, max: sys?.diskTotal, color: "var(--yellow)",
      }),
    ),

    // Row 2: Load / Health / Network / Uptime
    h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "16px" },
    },
      h(Card, {
        label: "Load", value: sys?.load ? sys.load.map((x) => x.toFixed(2)).join(" ") : "—",
        sub: "1/5/15",
        series: loadRef.current, max: Math.max(1, sys?.cpuCount || 1) * 2, color: "var(--blue)",
      }),
      h(Card, {
        label: "Health", value: health ? (health.ok ? `${health.latencyMs} ms` : "down") : "—",
        sub: health ? `HTTP ${health.status || "—"}` : "",
        series: healthRef.current, max: 2000, color: health?.ok === false ? "var(--red)" : "var(--green)",
      }),
      h(Card, {
        label: "Network", value: net ? `${fmtRate(net.rxBytesPerSec)} ↓` : "—",
        sub: net ? `${fmtRate(net.txBytesPerSec)} ↑` : "",
        series: rxRef.current, color: "var(--blue)",
      }),
      h(Card, {
        label: "Uptime", value: fmtUptime(sys?.sandboxUptimeMs ? Date.now() - sys.sandboxUptimeMs : null),
        sub: sys?.hostUptimeSec ? `host ${fmtSeconds(sys.hostUptimeSec)}` : "",
      }),
    ),

    // Processes
    h("div", { style: { marginBottom: "10px", fontSize: "11px", color: "var(--text-2)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px" } }, "Processes"),
    procs.length === 0
      ? h("div", { style: { color: "var(--text-3)", fontSize: "11px", padding: "24px 0", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" } }, "~ no processes ~")
      : h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" } },
          procs.map((p) => {
            const s = procRefs.current[p.name] || { cpu: [], mem: [] };
            const color = procColors[p.name] || "var(--text-1)";
            return h("div", {
              key: p.name,
              style: {
                background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
                padding: "10px 12px",
              },
            },
              h("div", {
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
              },
                h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
                  h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: statusColor(p.status) } }),
                  h("span", { style: { fontSize: "13px", color: "var(--text-0)", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 } }, p.name),
                  h("span", { style: { fontSize: "10px", color: "var(--text-3)", fontFamily: "'JetBrains Mono', monospace" } }, p.status),
                ),
                h("div", { style: { fontSize: "10px", color: "var(--text-3)", fontFamily: "'JetBrains Mono', monospace", display: "flex", gap: "12px" } },
                  p.pid ? h("span", null, `pid ${p.pid}`) : null,
                  h("span", null, `up ${fmtUptime(p.uptime)}`),
                  h("span", null, `↻ ${p.restarts}`),
                ),
              ),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
                h("div", null,
                  h("div", { style: { fontSize: "10px", color: "var(--text-2)", marginBottom: "2px", fontFamily: "'JetBrains Mono', monospace" } }, `CPU ${fmtPct(p.cpu)}`),
                  h(Sparkline, { values: s.cpu, max: 100, color, height: 28 }),
                ),
                h("div", null,
                  h("div", { style: { fontSize: "10px", color: "var(--text-2)", marginBottom: "2px", fontFamily: "'JetBrains Mono', monospace" } }, `MEM ${fmtBytes(p.memory)}`),
                  h(Sparkline, { values: s.mem, max: sys?.memTotal, color, height: 28 }),
                ),
              ),
            );
          }),
        ),

    // Lazy: Disk directories
    h(LazySection, {
      title: "Disk usage by directory", open: openDirs, onToggle: () => setOpenDirs((x) => !x),
    },
      dirs.err ? h("div", { style: { color: "var(--red)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, `✗ ${dirs.err}`)
      : !dirs.data ? h("div", { style: { color: "var(--text-3)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, "loading...")
      : h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          dirs.data.map((d) => h("div", {
            key: d.path,
            style: { display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-1)", fontFamily: "'JetBrains Mono', monospace" },
          },
            h("span", null, d.label),
            h("span", { style: { color: "var(--text-0)" } }, fmtBytes(d.size)),
          )),
        ),
    ),

    // Lazy: Log error counts
    h(LazySection, {
      title: "Log errors (last 500 lines)", open: openErrors, onToggle: () => setOpenErrors((x) => !x),
    },
      errors.err ? h("div", { style: { color: "var(--red)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, `✗ ${errors.err}`)
      : !errors.data ? h("div", { style: { color: "var(--text-3)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, "loading...")
      : h("div", { style: { display: "flex", gap: "16px", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace" } },
          h("div", null,
            h("span", { style: { color: "var(--text-2)" } }, "shmastra: "),
            h("span", { style: { color: errors.data.shmastra > 0 ? "var(--red)" : "var(--green)", fontWeight: 500 } }, errors.data.shmastra),
          ),
          h("div", null,
            h("span", { style: { color: "var(--text-2)" } }, "healer: "),
            h("span", { style: { color: errors.data.healer > 0 ? "var(--red)" : "var(--green)", fontWeight: 500 } }, errors.data.healer),
          ),
        ),
    ),

    // Lazy: Mastra API (agents, workflows, tools)
    h(LazySection, {
      title: "Mastra API", open: openMastra, onToggle: () => setOpenMastra((x) => !x),
    },
      mastra.err ? h("div", { style: { color: "var(--red)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, `✗ ${mastra.err}`)
      : !mastra.data ? h("div", { style: { color: "var(--text-3)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, "loading...")
      : h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } },
          // Counts row
          h("div", { style: { display: "flex", gap: "16px" } },
            h("div", null,
              h("span", { style: { color: "var(--text-2)" } }, "Agents: "),
              h("span", { style: { color: "var(--text-0)", fontWeight: 500 } }, mastra.data.agents.count),
            ),
            h("div", null,
              h("span", { style: { color: "var(--text-2)" } }, "Workflows: "),
              h("span", { style: { color: "var(--text-0)", fontWeight: 500 } }, mastra.data.workflows.count),
            ),
            h("div", null,
              h("span", { style: { color: "var(--text-2)" } }, "Tools: "),
              h("span", { style: { color: "var(--text-0)", fontWeight: 500 } }, mastra.data.tools.count),
            ),
          ),
          // Agent list
          mastra.data.agents.items.length > 0 && h("div", null,
            h("div", { style: { color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", fontSize: "10px", marginBottom: "4px" } }, "Agents"),
            mastra.data.agents.items.map((a) => h("div", {
              key: a.id,
              style: { display: "flex", justifyContent: "space-between", color: "var(--text-1)", padding: "2px 0" },
            },
              h("span", null, a.name),
              h("span", { style: { color: "var(--text-3)" } }, a.model || "—"),
            )),
          ),
          // Workflow list
          mastra.data.workflows.items.length > 0 && h("div", null,
            h("div", { style: { color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", fontSize: "10px", marginBottom: "4px" } }, "Workflows"),
            mastra.data.workflows.items.map((w) => h("div", {
              key: w.id,
              style: { display: "flex", justifyContent: "space-between", color: "var(--text-1)", padding: "2px 0" },
            },
              h("span", null, w.name),
              h("span", { style: { color: "var(--text-3)" } }, w.steps != null ? `${w.steps} step${w.steps === 1 ? "" : "s"}` : ""),
            )),
          ),
          // Tools list
          mastra.data.tools.items.length > 0 && h("div", null,
            h("div", { style: { color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", fontSize: "10px", marginBottom: "4px" } }, "Tools"),
            mastra.data.tools.items.map((t) => h("div", {
              key: t.id,
              style: { color: "var(--text-1)", padding: "2px 0" },
            }, t.id)),
          ),
        ),
    ),

    // Lazy: File descriptors & connections
    h(LazySection, {
      title: "File descriptors & TCP", open: openFds, onToggle: () => setOpenFds((x) => !x),
    },
      fds.err ? h("div", { style: { color: "var(--red)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, `✗ ${fds.err}`)
      : !fds.data ? h("div", { style: { color: "var(--text-3)", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } }, "loading...")
      : h("div", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" } },
          fds.data.processes.map((p) => h("div", {
            key: p.name,
            style: { display: "flex", justifyContent: "space-between", color: "var(--text-1)" },
          },
            h("span", null, p.name + " FDs"),
            h("span", { style: { color: "var(--text-0)" } }, p.fd),
          )),
          h("div", {
            style: { display: "flex", justifyContent: "space-between", color: "var(--text-1)", marginTop: "4px", paddingTop: "4px", borderTop: "1px solid var(--border)" },
          },
            h("span", null, "TCP established"),
            h("span", { style: { color: "var(--text-0)" } }, fds.data.tcpEstablished),
          ),
        ),
    ),
  );
}
