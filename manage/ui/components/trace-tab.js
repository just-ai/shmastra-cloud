import { createElement as h, useEffect, useRef, useState, useCallback } from "react";
import { API } from "../utils.js";

const HISTORY = 30;

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtMs(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.floor(m / 60);
  return `${hrs}h ${m % 60}m ago`;
}

// Horizontal bar (percentage of max)
function Bar({ value, max, color = "var(--blue)" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return h("div", {
    style: { width: "100%", height: "6px", background: "var(--bg-0)", borderRadius: "3px", overflow: "hidden" },
  },
    h("div", {
      style: { width: `${pct}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.3s" },
    }),
  );
}

function Card({ label, value, sub, color = "var(--text-0)" }) {
  return h("div", {
    style: {
      background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
      padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px",
    },
  },
    h("div", { style: { fontSize: "10px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "'JetBrains Mono', monospace" } }, label),
    h("div", { style: { fontSize: "20px", fontWeight: 500, color, fontFamily: "'JetBrains Mono', monospace" } }, value),
    sub && h("div", { style: { fontSize: "10px", color: "var(--text-3)", fontFamily: "'JetBrains Mono', monospace" } }, sub),
  );
}

// Mini timeline: dots for recent runs
function Timeline({ recent }) {
  if (!recent || recent.length === 0) return null;
  const w = 100;
  const h2 = 24;
  const now = Date.now();
  const oldest = recent.length > 1 ? new Date(recent[recent.length - 1].time).getTime() : now - 3600_000;
  const span = Math.max(1, now - oldest);
  const dots = recent.map((r, i) => {
    const t = r.time ? new Date(r.time).getTime() : now;
    const x = ((t - oldest) / span) * w;
    const color = r.status === "error" ? "var(--red)" : r.status === "running" ? "var(--yellow)" : "var(--green)";
    return h("circle", { key: i, cx: x.toFixed(1), cy: h2 / 2, r: 3, fill: color, fillOpacity: 0.8 });
  });
  return h("svg", {
    viewBox: `0 0 ${w} ${h2}`,
    preserveAspectRatio: "none",
    style: { width: "100%", height: h2 + "px", display: "block" },
  }, ...dots);
}

// Stacked bar for token distribution
function TokenBar({ items, field, maxTotal }) {
  const colors = ["var(--blue)", "var(--green)", "var(--yellow)", "var(--red)", "var(--text-2)"];
  const total = items.reduce((s, x) => s + (x[field] || 0), 0);
  const barMax = maxTotal || total;
  if (barMax === 0) return h("div", { style: { height: "8px" } });
  return h("div", {
    style: { display: "flex", width: "100%", height: "8px", borderRadius: "4px", overflow: "hidden", background: "var(--bg-0)" },
  },
    ...items.map((item, i) => {
      const pct = (item[field] / barMax) * 100;
      if (pct < 0.5) return null;
      return h("div", {
        key: i,
        style: { width: `${pct}%`, height: "100%", background: colors[i % colors.length] },
        title: `${item.name}: ${item[field].toLocaleString()}`,
      });
    }),
  );
}

function Skeleton({ width = "100%", height = "12px", style = {} }) {
  return h("div", { className: "skeleton", style: { width, height, ...style } });
}

function SkeletonCard() {
  return h("div", {
    style: { background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px" },
  },
    h(Skeleton, { width: "50%", height: "8px" }),
    h(Skeleton, { width: "60%", height: "20px" }),
  );
}

function SkeletonTable({ rows = 5 }) {
  return h("div", {
    style: { background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" },
  },
    h(Skeleton, { width: "30%", height: "8px" }),
    ...Array.from({ length: rows }, (_, i) =>
      h("div", { key: i, style: { display: "flex", gap: "12px", alignItems: "center" } },
        h(Skeleton, { width: "60px", height: "11px" }),
        h(Skeleton, { width: "90px", height: "11px" }),
        h(Skeleton, { width: "70px", height: "11px" }),
        h("div", { style: { flex: 1 } }),
        h(Skeleton, { width: "40px", height: "11px" }),
        h(Skeleton, { width: "40px", height: "11px" }),
        h(Skeleton, { width: "50px", height: "11px" }),
      ),
    ),
  );
}

export function TraceTab({ sandboxId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [hours, setHours] = useState(24);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setDetailsLoaded(false);
    setError(null);
    try {
      const res = await fetch(`${API}/api/stats/${sandboxId}/observability?hours=${hours}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) throw new Error(json.error || "failed");
      setData(json);
      setLoading(false);

      // Fetch trace details in parallel for token/model data
      const traces = json.recent || [];
      const BATCH = 5;
      for (let i = 0; i < traces.length; i += BATCH) {
        const batch = traces.slice(i, i + BATCH);
        const details = await Promise.all(
          batch.map((t) =>
            fetch(`${API}/api/stats/${sandboxId}/observability/${t.traceId}`)
              .then((r) => r.ok ? r.json() : null)
              .catch(() => null),
          ),
        );
        if (!mountedRef.current) return;
        setData((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, recent: [...prev.recent] };
          const byAgent = new Map();
          const byModel = new Map();
          let totalInput = 0, totalOutput = 0;
          for (const d of details) {
            if (!d) continue;
            const idx = updated.recent.findIndex((r) => r.traceId === d.traceId);
            if (idx >= 0) {
              updated.recent[idx] = { ...updated.recent[idx], model: d.model, input: d.input, output: d.output };
            }
          }
          for (const r of updated.recent) {
            totalInput += r.input || 0;
            totalOutput += r.output || 0;
            if (r.agent) {
              const a = byAgent.get(r.agent) || { runs: 0, input: 0, output: 0, latencyMs: 0, latencyCount: 0 };
              a.runs++; a.input += r.input || 0; a.output += r.output || 0;
              if (r.latencyMs != null) { a.latencyMs += r.latencyMs; a.latencyCount++; }
              byAgent.set(r.agent, a);
            }
            if (r.model) {
              const m = byModel.get(r.model) || { runs: 0, input: 0, output: 0 };
              m.runs++; m.input += r.input || 0; m.output += r.output || 0;
              byModel.set(r.model, m);
            }
          }
          updated.totals = { ...updated.totals, inputTokens: totalInput, outputTokens: totalOutput };
          updated.byAgent = Array.from(byAgent.entries())
            .map(([name, v]) => ({ name, runs: v.runs, inputTokens: v.input, outputTokens: v.output, avgLatencyMs: v.latencyCount ? v.latencyMs / v.latencyCount : null }))
            .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
          updated.byModel = Array.from(byModel.entries())
            .map(([name, v]) => ({ name, runs: v.runs, inputTokens: v.input, outputTokens: v.output }))
            .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
          return updated;
        });
      }
      if (mountedRef.current) setDetailsLoaded(true);
    } catch (e) {
      if (mountedRef.current) setError(e.message);
    } finally {
      if (mountedRef.current) { setLoading(false); setDetailsLoaded(true); }
    }
  }, [sandboxId, hours]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  const mono = { fontFamily: "'JetBrains Mono', monospace" };
  const totals = data?.totals;
  const byAgent = data?.byAgent || [];
  const byModel = data?.byModel || [];
  const recent = data?.recent || [];
  const maxAgentTokens = Math.max(1, ...byAgent.map((a) => a.inputTokens + a.outputTokens));
  const maxModelTokens = Math.max(1, ...byModel.map((m) => m.inputTokens + m.outputTokens));

  return h("div", { style: { flex: 1, overflow: "auto", padding: "16px", background: "var(--bg-0)" } },

    // Toolbar
    h("div", {
      style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" },
    },
      h("select", {
        value: hours,
        onChange: (e) => setHours(Number(e.target.value)),
        style: {
          ...mono, fontSize: "11px", padding: "4px 8px", background: "var(--bg-1)",
          color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer",
        },
      },
        h("option", { value: 1 }, "1h"),
        h("option", { value: 6 }, "6h"),
        h("option", { value: 24 }, "24h"),
        h("option", { value: 72 }, "3d"),
        h("option", { value: 168 }, "7d"),
      ),
      h("button", {
        onClick: fetchData,
        disabled: loading,
        style: {
          ...mono, fontSize: "11px", padding: "4px 10px", background: "var(--bg-1)",
          color: loading ? "var(--text-3)" : "var(--text-1)", border: "1px solid var(--border)",
          borderRadius: "4px", cursor: loading ? "default" : "pointer",
        },
      }, loading ? "loading..." : "↻ refresh"),
      h("div", { style: { flex: 1 } }),
      data?.window && h("span", {
        style: { ...mono, fontSize: "10px", color: "var(--text-3)" },
      }, `${new Date(data.window.start).toLocaleTimeString()} — ${new Date(data.window.end).toLocaleTimeString()}`),
    ),

    // Initial skeleton
    loading && !data && h("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } },
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" } },
        h(SkeletonCard), h(SkeletonCard), h(SkeletonCard), h(SkeletonCard),
      ),
      h("div", { style: { background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px", padding: "12px 14px" } },
        h(Skeleton, { width: "30%", height: "8px", style: { marginBottom: "8px" } }),
        h(Skeleton, { width: "100%", height: "24px" }),
      ),
      h(SkeletonTable, { rows: 6 }),
    ),

    // Error
    error && h("div", {
      style: {
        color: "var(--red)", fontSize: "11px", ...mono,
        padding: "6px 10px", background: "var(--red-bg)", borderRadius: "4px", marginBottom: "12px",
      },
    }, `✗ ${error}`),

    // No data state
    !error && data && totals?.runs === 0 && h("div", {
      style: {
        color: "var(--text-3)", fontSize: "12px", ...mono, textAlign: "center",
        padding: "48px 0",
      },
    }, `~ no traces in the last ${hours}h ~`),

    // Summary cards
    totals && totals.runs > 0 && h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "12px" },
    },
      h(Card, { label: "Runs", value: fmtNum(totals.runs) }),
      h(Card, {
        label: "Errors", value: fmtNum(totals.errors),
        color: totals.errors > 0 ? "var(--red)" : "var(--green)",
      }),
      h(Card, { label: "Input tokens", value: fmtNum(totals.inputTokens) }),
      h(Card, { label: "Output tokens", value: fmtNum(totals.outputTokens) }),
    ),

    // Timeline
    totals && totals.runs > 0 && h("div", {
      style: {
        background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
        padding: "10px 14px", marginBottom: "12px",
      },
    },
      h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" } }, "Activity timeline"),
      h(Timeline, { recent }),
      h("div", { style: { display: "flex", justifyContent: "space-between", ...mono, fontSize: "9px", color: "var(--text-3)", marginTop: "4px" } },
        h("span", null, recent.length > 0 ? timeAgo(recent[recent.length - 1].time) : ""),
        h("span", null, "now"),
      ),
    ),

    // By Agent
    byAgent.length > 0 && h("div", {
      style: {
        background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
        padding: "12px 14px", marginBottom: "12px",
      },
    },
      h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" } }, "By agent"),
      h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
        ...byAgent.map((a) => h("div", { key: a.name },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" } },
            h("span", { style: { ...mono, fontSize: "12px", color: "var(--text-0)", fontWeight: 500 } }, a.name),
            h("div", { style: { display: "flex", gap: "12px", ...mono, fontSize: "10px", color: "var(--text-2)" } },
              h("span", null, `${a.runs} runs`),
              h("span", null, `${fmtNum(a.inputTokens)} in`),
              h("span", null, `${fmtNum(a.outputTokens)} out`),
              h("span", null, fmtMs(a.avgLatencyMs)),
            ),
          ),
          h(Bar, { value: a.inputTokens + a.outputTokens, max: maxAgentTokens, color: "var(--blue)" }),
        )),
      ),
    ),

    // By Model
    byModel.length > 0 && h("div", {
      style: {
        background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
        padding: "12px 14px", marginBottom: "12px",
      },
    },
      h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" } }, "By model"),
      h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
        ...byModel.map((m) => h("div", { key: m.name },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" } },
            h("span", { style: { ...mono, fontSize: "12px", color: "var(--text-0)", fontWeight: 500 } }, m.name),
            h("div", { style: { display: "flex", gap: "12px", ...mono, fontSize: "10px", color: "var(--text-2)" } },
              h("span", null, `${m.runs} runs`),
              h("span", null, `${fmtNum(m.inputTokens)} in`),
              h("span", null, `${fmtNum(m.outputTokens)} out`),
            ),
          ),
          h(Bar, { value: m.inputTokens + m.outputTokens, max: maxModelTokens, color: "var(--green)" }),
        )),
      ),
    ),

    // Token distribution
    (byAgent.length > 1 || byModel.length > 1) && h("div", {
      style: {
        background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
        padding: "12px 14px", marginBottom: "12px",
      },
    },
      h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" } }, "Token distribution"),
      byAgent.length > 1 && h("div", { style: { marginBottom: "8px" } },
        h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-3)", marginBottom: "3px" } }, "by agent (input)"),
        h(TokenBar, { items: byAgent, field: "inputTokens" }),
      ),
      byModel.length > 1 && h("div", null,
        h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-3)", marginBottom: "3px" } }, "by model (input)"),
        h(TokenBar, { items: byModel, field: "inputTokens" }),
      ),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" } },
        ...[...byAgent, ...byModel].map((item, i) => {
          const colors = ["var(--blue)", "var(--green)", "var(--yellow)", "var(--red)", "var(--text-2)"];
          return h("div", {
            key: item.name + i,
            style: { display: "flex", alignItems: "center", gap: "4px", ...mono, fontSize: "9px", color: "var(--text-3)" },
          },
            h("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: colors[i % colors.length] } }),
            item.name,
          );
        }),
      ),
    ),

    // Recent traces table
    recent.length > 0 && h("div", {
      style: {
        background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px",
        padding: "12px 14px",
      },
    },
      h("div", { style: { ...mono, fontSize: "10px", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" } }, "Recent runs"),
      h("table", { style: { width: "100%", borderCollapse: "collapse" } },
        h("thead", null,
          h("tr", { style: { ...mono, color: "var(--text-3)", fontSize: "10px", textAlign: "left" } },
            h("th", { style: { padding: "4px 6px", fontWeight: 400 } }, "time"),
            h("th", { style: { padding: "4px 6px", fontWeight: 400 } }, "agent"),
            h("th", { style: { padding: "4px 6px", fontWeight: 400 } }, "model"),
            h("th", { style: { padding: "4px 6px", fontWeight: 400, textAlign: "right" } }, "in"),
            h("th", { style: { padding: "4px 6px", fontWeight: 400, textAlign: "right" } }, "out"),
            h("th", { style: { padding: "4px 6px", fontWeight: 400, textAlign: "right" } }, "latency"),
            h("th", { style: { padding: "4px 6px", fontWeight: 400 } }, ""),
          ),
        ),
        h("tbody", null,
          ...recent.map((r) => {
            const pending = !detailsLoaded && !r.model && r.input === 0;
            return h("tr", {
              key: r.traceId,
              style: { ...mono, fontSize: "11px", color: "var(--text-1)" },
            },
              h("td", { style: { padding: "4px 6px", color: "var(--text-3)" } },
                r.time ? new Date(r.time).toLocaleTimeString() : "—"),
              h("td", { style: { padding: "4px 6px" } }, r.agent || "—"),
              h("td", { style: { padding: "4px 6px", color: "var(--text-2)" } },
                pending ? h(Skeleton, { width: "60px", height: "11px" }) : (r.model || "—")),
              h("td", { style: { padding: "4px 6px", textAlign: "right" } },
                pending ? h(Skeleton, { width: "36px", height: "11px", style: { marginLeft: "auto" } }) : fmtNum(r.input)),
              h("td", { style: { padding: "4px 6px", textAlign: "right" } },
                pending ? h(Skeleton, { width: "30px", height: "11px", style: { marginLeft: "auto" } }) : fmtNum(r.output)),
              h("td", { style: { padding: "4px 6px", textAlign: "right", color: "var(--text-2)" } }, fmtMs(r.latencyMs)),
              h("td", {
                style: {
                  padding: "4px 6px", fontSize: "10px",
                  color: r.status === "error" ? "var(--red)" : r.status === "running" ? "var(--yellow)" : "var(--green)",
                },
              }, r.status === "error" ? "✗" : r.status === "running" ? "●" : "✓"),
            );
          }),
        ),
      ),
    ),
  );
}
