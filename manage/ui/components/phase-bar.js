import { createElement as h } from "react";

export const PHASES = ["fetch", "merge", "install", "build", "apply", "migrate", "patch", "restart"];

// Map explicit phase state (from `phase` SSE events) to a bar color. A phase
// with no state entry hasn't been reached yet; a skipped phase is reached but
// muted so the user can see it was intentionally not run.
function phaseColor(phaseState, overallStatus) {
  if (!phaseState) return "var(--bg-3)";
  if (phaseState === "skipped") return "var(--text-3)";
  if (phaseState === "running") {
    if (overallStatus === "error") return "var(--red)";
    if (overallStatus === "stopped") return "var(--yellow)";
    return "var(--blue)";
  }
  if (phaseState === "error") return "var(--red)";
  return "var(--green)";
}

export function PhaseBar({ logPhaseSet, phaseStates, status, hoveredPhase, setHoveredPhase, activePhase, setActivePhase, scrollToPhase }) {
  const states = phaseStates || {};
  if (Object.keys(states).length === 0) return null;
  const highlightPhase = activePhase || hoveredPhase;

  return h("div", {
    style: { padding: "8px 16px", borderBottom: "1px solid var(--border)" },
  },
    h("div", { style: { display: "flex", gap: "2px" } },
      ...PHASES.map((p) => {
        const phaseState = states[p];
        const hasLogs = logPhaseSet.has(p);
        const clickable = hasLogs;
        const isRunning = phaseState === "running" && status === "running";
        const color = phaseColor(phaseState, status);
        return h("div", {
          key: p,
          style: {
            flex: 1, cursor: clickable ? "pointer" : "default",
            padding: "2px 0 4px",
            opacity: highlightPhase && highlightPhase !== p ? 0.4 : 1,
            transition: "opacity 0.2s",
          },
          onMouseEnter: clickable ? () => setHoveredPhase(p) : undefined,
          onMouseLeave: () => setHoveredPhase(null),
          onClick: clickable ? () => { setActivePhase(activePhase === p ? null : p); scrollToPhase(p); } : undefined,
        },
          h("div", {
            style: {
              height: "3px", borderRadius: "1.5px",
              background: color,
              transition: "all 0.2s",
              ...(isRunning ? { animation: "pulse 2s ease-in-out infinite" } : {}),
            },
          }),
          h("div", {
            className: "mono",
            style: {
              textAlign: "center", fontSize: "10px", marginTop: "4px",
              color: highlightPhase === p ? "var(--text-0)" : phaseState ? color : "var(--text-3)",
              fontWeight: highlightPhase === p ? 600 : 400,
              transition: "color 0.2s",
            },
          }, p),
        );
      }),
    ),
  );
}
