import { createElement as h } from "react";

export const PHASES = ["fetch", "merge", "install", "build", "apply", "migrate", "patch", "restart"];

function phaseColor(p, logPhaseSet, lastLogPhase, status) {
  if (!logPhaseSet.has(p)) return "var(--bg-3)";
  if (p === lastLogPhase) {
    if (status === "running") return "var(--blue)";
    if (status === "error") return "var(--red)";
    if (status === "stopped") return "var(--yellow)";
  }
  return "var(--green)";
}

export function PhaseBar({ logPhaseSet, lastLogPhase, status, hoveredPhase, setHoveredPhase, activePhase, setActivePhase, scrollToPhase }) {
  if (logPhaseSet.size === 0) return null;
  const highlightPhase = activePhase || hoveredPhase;

  return h("div", {
    style: { padding: "8px 16px", borderBottom: "1px solid var(--border)" },
  },
    h("div", { style: { display: "flex", gap: "2px" } },
      ...PHASES.map((p) => {
        const has = logPhaseSet.has(p);
        const isLast = p === lastLogPhase && status === "running";
        const color = phaseColor(p, logPhaseSet, lastLogPhase, status);
        return h("div", {
          key: p,
          style: {
            flex: 1, cursor: has ? "pointer" : "default",
            padding: "2px 0 4px",
            opacity: highlightPhase && highlightPhase !== p ? 0.4 : 1,
            transition: "opacity 0.2s",
          },
          onMouseEnter: has ? () => setHoveredPhase(p) : undefined,
          onMouseLeave: () => setHoveredPhase(null),
          onClick: has ? () => { setActivePhase(activePhase === p ? null : p); scrollToPhase(p); } : undefined,
        },
          h("div", {
            style: {
              height: "3px", borderRadius: "1.5px",
              background: color,
              transition: "all 0.2s",
              ...(isLast ? { animation: "pulse 2s ease-in-out infinite" } : {}),
            },
          }),
          h("div", {
            className: "mono",
            style: {
              textAlign: "center", fontSize: "10px", marginTop: "4px",
              color: highlightPhase === p ? "var(--text-0)" : has ? color : "var(--text-3)",
              fontWeight: highlightPhase === p ? 600 : 400,
              transition: "color 0.2s",
            },
          }, p),
        );
      }),
    ),
  );
}
