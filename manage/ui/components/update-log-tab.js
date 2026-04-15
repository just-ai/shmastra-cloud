import { createElement as h } from "react";

export function UpdateLogTab({ logs, highlightPhase, hoveredPhase, setHoveredPhase, scrollRef, logContainerRef }) {
  return h("div", {
    ref: logContainerRef,
    style: { flex: 1, overflow: "auto", padding: "8px 0", background: "var(--bg-0)" },
  },
    logs.length === 0
      ? h("div", {
          className: "mono",
          style: { color: "var(--text-3)", fontSize: "11px", textAlign: "center", padding: "32px 0" },
        }, "~ no logs yet ~")
      : logs.map((entry, i) => {
          const hl = highlightPhase && entry.phase === highlightPhase;
          return h("div", {
            key: i, className: "mono",
            "data-phase": entry.phase || undefined,
            onMouseEnter: entry.phase ? () => setHoveredPhase(entry.phase) : undefined,
            onMouseLeave: () => setHoveredPhase(null),
            style: {
              fontSize: "11px", lineHeight: "18px", color: "var(--text-2)",
              whiteSpace: "pre-wrap", wordBreak: "break-all", padding: "0 12px",
              borderLeft: hl ? "2px solid var(--blue)" : "2px solid transparent",
              background: hl ? "rgba(59, 130, 246, 0.06)" : "transparent",
              transition: "background 0.15s, border-color 0.15s",
              ...(entry.message.startsWith("$") ? { color: "var(--text-1)", ...(hl ? {} : { borderLeftColor: "var(--text-3)" }) } : {}),
              ...(entry.message.startsWith("\u2713") ? { color: "var(--green)" } : {}),
              ...(entry.message.startsWith("\u2717") ? { color: "var(--red)" } : {}),
              ...(entry.message.startsWith("\u26A0") ? { color: "var(--yellow)" } : {}),
              ...(entry.message.startsWith("\uD83E\uDD16") ? { color: "var(--blue)" } : {}),
              ...(entry.message.startsWith("\uD83D\uDD27") ? { color: "var(--text-1)", ...(hl ? {} : { borderLeftColor: "var(--blue)" }) } : {}),
            },
          },
            h("span", {
              style: { color: "var(--text-3)", marginRight: "6px", fontSize: "10px", userSelect: "none" },
            }, entry.time.toLocaleTimeString("en-GB")),
            entry.message,
          );
        }),
    h("div", { ref: scrollRef }),
  );
}
