import { createElement as h } from "react";

// DB status → color
export function dbStatusColor(status) {
  switch (status) {
    case "ready":    return "var(--green)";
    case "creating": return "var(--yellow)";
    case "healing":  return "var(--yellow)";
    case "broken":   return "var(--red)";
    case "error":    return "var(--red)";
    default:         return "var(--text-3)";
  }
}

export function badge(s, phase) {
  const styles = {
    pending:  { background: "var(--bg-3)", color: "var(--text-2)", dot: "var(--text-3)" },
    running:  { background: "var(--blue-bg)", color: "var(--blue)", dot: "var(--blue)" },
    success:  { background: "var(--green-bg)", color: "var(--green)", dot: "var(--green)" },
    error:    { background: "var(--red-bg)", color: "var(--red)", dot: "var(--red)" },
    stopped:  { background: "var(--yellow-bg)", color: "var(--yellow)", dot: "var(--yellow)" },
  }[s] || { background: "var(--bg-3)", color: "var(--text-2)", dot: "var(--text-3)" };
  const label = s === "running" && phase ? phase : s;
  return h("span", {
    style: {
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "2px 10px 2px 8px", borderRadius: "9999px",
      fontSize: "12px", fontWeight: 500, fontFamily: "'JetBrains Mono', monospace",
      background: styles.background, color: styles.color,
      minWidth: "84px", justifyContent: "center", boxSizing: "border-box",
    },
  },
    h("span", {
      className: s === "running" ? "animate-pulse" : "",
      style: { width: "6px", height: "6px", borderRadius: "50%", background: styles.dot, flexShrink: 0 },
    }),
    label,
  );
}
