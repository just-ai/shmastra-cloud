import { createElement as h, useEffect, useState, useCallback, useRef } from "react";
import { API } from "../utils.js";

const AUTO_POLL_MS = 5000;

function ReloadButton({ onClick, loading, title }) {
  return h("button", {
    onClick,
    disabled: loading,
    "data-tooltip-id": "tt",
    "data-tooltip-content": title || "Reload",
    style: {
      width: "24px", height: "24px", borderRadius: "4px",
      border: "1px solid var(--border)", background: "var(--bg-2)",
      color: loading ? "var(--text-3)" : "var(--text-1)", cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: 0, fontSize: "14px", flexShrink: 0,
    },
    onMouseEnter: (e) => { if (!loading) e.currentTarget.style.background = "var(--bg-3)"; },
    onMouseLeave: (e) => { e.currentTarget.style.background = "var(--bg-2)"; },
  }, "↻");
}

function AutoButton({ auto, setAuto }) {
  return h("button", {
    onClick: () => setAuto((a) => !a),
    "data-tooltip-id": "tt",
    "data-tooltip-content": auto ? "Stop auto-refresh" : `Auto-refresh every ${AUTO_POLL_MS / 1000}s`,
    style: {
      padding: "2px 8px", fontSize: "11px", borderRadius: "4px",
      fontFamily: "'JetBrains Mono', monospace",
      background: auto ? "var(--green-bg)" : "transparent",
      color: auto ? "var(--green)" : "var(--text-2)",
      border: "1px solid " + (auto ? "var(--green-dim)" : "transparent"),
      cursor: "pointer", flexShrink: 0,
    },
  }, auto ? "auto ●" : "auto");
}

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function statusBadge(run) {
  const raw = run.workflow_status || (run.error_message ? "error" : "pending");
  const s = String(raw).toLowerCase();
  let cls, label = String(raw);
  if (s === "success" || s === "completed") { cls = "success"; label = "success"; }
  else if (s === "error" || s === "failed" || s === "canceled" || s === "bailed" || s === "tripwire") { cls = "error"; label = s; }
  else if (s === "running")                 { cls = "running"; label = "running"; }
  else if (s === "pending")                 { cls = "pending"; label = "pending"; }
  else                                       { cls = "warn";    label = s || "unknown"; }
  const palette = {
    success: { color: "var(--green)" },
    error:   { color: "var(--red)" },
    running: { color: "var(--blue)" },
    warn:    { color: "var(--yellow)" },
    pending: { color: "var(--text-3)" },
  }[cls];
  return h("span", {
    "data-tooltip-id": "tt",
    "data-tooltip-content": label,
    style: {
      display: "inline-block", width: "8px", height: "8px",
      borderRadius: "50%", background: palette.color, flexShrink: 0,
    },
  });
}

function RunRow({ run }) {
  const [open, setOpen] = useState(false);
  const duration = run.duration_ms != null ? ` · ${run.duration_ms}ms` : "";
  const meta = fmtDate(run.sent_at) + duration;

  const detailBits = [];
  if (run.error_message) {
    detailBits.push(h("div", {
      key: "err",
      style: {
        color: "var(--red)", fontSize: "11px", padding: "6px 8px",
        background: "var(--red-bg)", border: "1px solid rgba(239,68,68,0.2)",
        borderRadius: "4px", marginTop: "6px", fontFamily: "'JetBrains Mono', monospace",
        whiteSpace: "pre-wrap",
      },
    }, run.error_message));
  }
  if (run.workflow_error) {
    detailBits.push(h("div", {
      key: "werr",
      style: {
        color: "var(--red)", fontSize: "11px", padding: "6px 8px",
        background: "var(--red-bg)", border: "1px solid rgba(239,68,68,0.2)",
        borderRadius: "4px", marginTop: "6px", fontFamily: "'JetBrains Mono', monospace",
        whiteSpace: "pre-wrap",
      },
    }, run.workflow_error));
  }
  if (run.workflow_result !== null && run.workflow_result !== undefined) {
    detailBits.push(h("pre", {
      key: "result",
      style: {
        background: "var(--bg-0)", border: "1px solid var(--border)", borderRadius: "4px",
        padding: "6px 8px", marginTop: "6px", fontSize: "10px",
        fontFamily: "'JetBrains Mono', monospace", maxHeight: "200px", overflow: "auto",
        color: "var(--text-1)", whiteSpace: "pre-wrap",
      },
    }, JSON.stringify(run.workflow_result, null, 2)));
  }
  if (run.workflow_run_id) {
    detailBits.push(h("div", {
      key: "rid",
      style: { marginTop: "4px", color: "var(--text-3)", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" },
    }, `run id: ${run.workflow_run_id}`));
  }
  if (!detailBits.length) {
    detailBits.push(h("div", {
      key: "empty",
      style: { marginTop: "6px", color: "var(--text-3)", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" },
    }, "No details available."));
  }

  return h("div", {
    style: {
      background: "var(--bg-0)", border: "1px solid var(--border)",
      borderRadius: "4px", padding: "6px 8px", marginBottom: "4px",
    },
  },
    h("div", {
      onClick: () => setOpen((x) => !x),
      style: {
        display: "flex", alignItems: "center", gap: "8px", minWidth: 0,
        cursor: "pointer", userSelect: "none",
      },
    },
      statusBadge(run),
      h("span", {
        style: {
          flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono', monospace",
          fontSize: "10px", color: "var(--text-2)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
      }, meta),
      h("span", {
        style: {
          width: "10px", height: "10px", color: "var(--text-3)", flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 160ms ease",
        },
      }, h("svg", {
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2,
        strokeLinecap: "round", strokeLinejoin: "round",
        style: { width: "10px", height: "10px" },
      }, h("path", { d: "M9 18l6-6-6-6" }))),
    ),
    open && h("div", { style: { paddingTop: "2px" } }, ...detailBits),
  );
}

function ScheduleCard({ sandboxId, schedule, auto }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState(null);
  const [runsErr, setRunsErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setRunsErr(null);
    try {
      const res = await fetch(`${API}/api/tasks/${sandboxId}/${schedule.id}/runs?limit=50`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      setRuns(json.runs || []);
    } catch (err) {
      setRunsErr(err.message);
    } finally {
      setLoading(false);
    }
  }, [sandboxId, schedule.id]);

  useEffect(() => {
    if (open && runs === null && !loading) loadRuns();
  }, [open, runs, loading, loadRuns]);

  // Auto-refresh runs when the card is open and parent auto is on.
  useEffect(() => {
    if (!open || !auto) return;
    const t = setInterval(loadRuns, AUTO_POLL_MS);
    return () => clearInterval(t);
  }, [open, auto, loadRuns]);

  const meta = fmtDate(schedule.last_run_at);

  return h("div", {
    style: {
      background: "var(--bg-1)", border: "1px solid var(--border)",
      borderRadius: "6px", marginBottom: "8px", overflow: "hidden",
    },
  },
    h("div", {
      onClick: () => setOpen((x) => !x),
      style: {
        padding: "8px 10px", display: "flex", alignItems: "center", gap: "8px",
        cursor: "pointer", userSelect: "none",
      },
    },
      h("div", { style: { flex: 1, minWidth: 0 } },
        h("div", {
          style: {
            fontSize: "12px", fontWeight: 500, color: "var(--text-0)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          },
        }, schedule.label || `workflow: ${schedule.workflow_id}`),
        h("div", {
          style: {
            fontSize: "10px", color: "var(--text-3)", marginTop: "2px",
            fontFamily: "'JetBrains Mono', monospace",
          },
        }, meta),
      ),
      h("span", {
        style: {
          display: "inline-flex", alignItems: "center", gap: "4px",
          padding: "1px 7px 1px 6px", borderRadius: "9999px",
          fontSize: "10px", fontWeight: 500, fontFamily: "'JetBrains Mono', monospace",
          background: schedule.enabled ? "var(--green-bg)" : "var(--bg-3)",
          color: schedule.enabled ? "var(--green)" : "var(--text-2)",
          flexShrink: 0,
        },
      },
        h("span", {
          style: {
            width: "5px", height: "5px", borderRadius: "50%",
            background: schedule.enabled ? "var(--green)" : "var(--text-3)",
          },
        }),
        schedule.enabled ? "enabled" : "paused",
      ),
      h("span", {
        style: {
          width: "10px", height: "10px", color: "var(--text-3)", flexShrink: 0,
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 160ms ease",
        },
      }, h("svg", {
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2,
        strokeLinecap: "round", strokeLinejoin: "round",
        style: { width: "10px", height: "10px" },
      }, h("path", { d: "M9 18l6-6-6-6" }))),
    ),
    open && h("div", {
      style: { padding: "0 10px 8px 10px", borderTop: "1px solid var(--border)" },
    },
      h("div", {
        style: {
          padding: "8px 0", fontSize: "10px", color: "var(--text-2)",
          fontFamily: "'JetBrains Mono', monospace",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        },
      },
        h("span", null,
          schedule.cron_expression + " · " + schedule.timezone,
        ),
        h(ReloadButton, {
          loading,
          title: "Reload runs",
          onClick: (e) => { e.stopPropagation(); loadRuns(); },
        }),
      ),
      runsErr && h("div", {
        style: {
          color: "var(--red)", fontSize: "11px", padding: "4px 0",
          fontFamily: "'JetBrains Mono', monospace",
        },
      }, `✗ ${runsErr}`),
      loading && runs === null && h("div", {
        style: { fontSize: "10px", color: "var(--text-3)", padding: "8px 0", textAlign: "center" },
      }, "loading..."),
      runs && runs.length === 0 && h("div", {
        style: { fontSize: "10px", color: "var(--text-3)", padding: "8px 0", textAlign: "center" },
      }, "No runs yet."),
      runs && runs.length > 0 && runs.map((r) => h(RunRow, { key: r.id, run: r })),
    ),
  );
}

export function TasksTab({ sandboxId }) {
  const [schedules, setSchedules] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);
  const loadRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/api/tasks/${sandboxId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      setSchedules(json.schedules || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [sandboxId]);

  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => loadRef.current && loadRef.current(), AUTO_POLL_MS);
    return () => clearInterval(t);
  }, [auto]);

  return h("div", { style: { flex: 1, overflow: "auto", padding: "12px 16px", background: "var(--bg-0)" } },
    h("div", {
      style: {
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "6px", marginBottom: "10px",
      },
    },
      h("span", {
        style: {
          fontSize: "11px", color: "var(--text-2)", textTransform: "uppercase",
          letterSpacing: "0.5px", fontFamily: "'JetBrains Mono', monospace",
        },
      }, schedules ? `${schedules.length} task${schedules.length === 1 ? "" : "s"}` : "Tasks"),
      h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
        h(AutoButton, { auto, setAuto }),
        h(ReloadButton, { onClick: load, loading, title: "Reload tasks" }),
      ),
    ),
    err && h("div", {
      style: {
        color: "var(--red)", fontSize: "11px", padding: "6px 10px",
        background: "var(--red-bg)", borderRadius: "4px", marginBottom: "8px",
        fontFamily: "'JetBrains Mono', monospace",
      },
    }, `✗ ${err}`),
    !schedules && loading && h("div", {
      style: { color: "var(--text-3)", fontSize: "11px", padding: "24px 0", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" },
    }, "loading..."),
    schedules && schedules.length === 0 && h("div", {
      style: { color: "var(--text-3)", fontSize: "11px", padding: "24px 0", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" },
    }, "~ no tasks ~"),
    schedules && schedules.map((s) => h(ScheduleCard, { key: s.id, sandboxId, schedule: s, auto })),
  );
}
