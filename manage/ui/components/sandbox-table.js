import { createElement as h } from "react";
import { timeAgo } from "../utils.js";
import { badge, dbStatusColor } from "./status-badge.js";

export function SandboxTable({ filtered, selected, setSelected, statuses, phases, getStatus, updateOne, stopOne, setTab, loading }) {
  if (loading) {
    return h("div", { style: { color: "var(--text-2)", textAlign: "center", padding: "48px 0" } }, "Loading...");
  }

  return h("div", {
    style: {
      background: "var(--bg-1)", borderRadius: "8px",
      border: "1px solid var(--border)", overflow: "hidden",
    },
  },
    h("table", { style: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" } },
      h("thead", null,
        h("tr", {
          style: {
            borderBottom: "1px solid var(--border)",
            fontSize: "12px", color: "var(--text-2)",
            fontFamily: "'JetBrains Mono', monospace",
            textTransform: "uppercase", letterSpacing: "0.5px",
          },
        },
          h("th", { style: { textAlign: "left", padding: "10px 16px", fontWeight: 500, width: "35%", whiteSpace: "nowrap", overflow: "hidden" } }, "Sandbox"),
          h("th", { style: { textAlign: "left", padding: "10px 16px", fontWeight: 500, width: "30%", whiteSpace: "nowrap", overflow: "hidden" } }, "Owner"),
          h("th", { style: { textAlign: "left", padding: "10px 16px", fontWeight: 500, width: "15%", whiteSpace: "nowrap", overflow: "hidden" } }, "Active"),
          h("th", { style: { textAlign: "right", padding: "10px 16px", fontWeight: 500, width: "20%", whiteSpace: "nowrap", overflow: "hidden" } }, ""),
        ),
      ),
      h("tbody", null,
        filtered.map((entry) => {
          const { sandboxId: id, email, status: dbStatus, lastActiveAt, version } = entry;
          const stateColor = dbStatusColor(dbStatus);
          return h("tr", {
            key: id,
            onClick: () => setSelected(selected === id ? null : id),
            style: {
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              background: selected === id ? "var(--bg-2)" : "transparent",
              transition: "background 0.1s",
            },
            onMouseEnter: (e) => { if (selected !== id) e.currentTarget.style.background = "var(--bg-2)"; },
            onMouseLeave: (e) => { if (selected !== id) e.currentTarget.style.background = "transparent"; },
          },
            h("td", {
              className: "mono",
              style: { padding: "12px 16px", fontSize: "12px", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              "data-tooltip-id": "tt", "data-tooltip-content": id,
            },
              h("span", {
                "data-tooltip-id": "tt", "data-tooltip-content": dbStatus || "unknown",
                style: { display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: stateColor, flexShrink: 0, marginRight: "8px", verticalAlign: "middle" },
              }),
              id,
              version ? h("span", { style: { color: "var(--text-3)", marginLeft: "8px" } }, "v" + version) : null,
            ),
            h("td", {
              style: { padding: "12px 16px", fontSize: "13px", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              "data-tooltip-id": "tt", "data-tooltip-content": email,
            }, email),
            h("td", {
              className: "mono",
              style: { padding: "12px 16px", fontSize: "11px", color: "var(--text-2)", overflow: "hidden", whiteSpace: "nowrap" },
              "data-tooltip-id": "tt", "data-tooltip-content": lastActiveAt ? new Date(lastActiveAt).toLocaleString() : "",
            }, timeAgo(lastActiveAt)),
            h("td", { style: { padding: "12px 16px", textAlign: "right", display: "flex", gap: "6px", justifyContent: "flex-end", alignItems: "center" } },
              statuses[id] ? badge(getStatus(id), phases[id]) : null,
              getStatus(id) === "running"
                ? h("button", {
                    onClick: (e) => { e.stopPropagation(); stopOne(id); },
                    style: {
                      padding: "4px 12px", borderRadius: "4px",
                      border: "1px solid var(--red)", background: "var(--red-bg)",
                      color: "var(--red)", cursor: "pointer",
                      fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
                      transition: "all 0.15s",
                    },
                    onMouseEnter: (e) => { e.target.style.background = "rgba(239,68,68,0.2)"; },
                    onMouseLeave: (e) => { e.target.style.background = "var(--red-bg)"; },
                  }, "stop")
                : h("button", {
                    onClick: (e) => { e.stopPropagation(); updateOne(id); setSelected(id); setTab((prev) => ({ ...prev, [id]: "logs" })); },
                    style: {
                      padding: "4px 12px", borderRadius: "4px",
                      border: "1px solid var(--border)", background: "transparent",
                      color: "var(--text-1)", cursor: "pointer",
                      fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
                      transition: "all 0.15s",
                    },
                    onMouseEnter: (e) => { e.target.style.background = "var(--bg-3)"; },
                    onMouseLeave: (e) => { e.target.style.background = "transparent"; },
                  }, "update"),
            ),
          );
        }),
      ),
    ),
  );
}
