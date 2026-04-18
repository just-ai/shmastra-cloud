import { createElement as h } from "react";

export function Header({ search, setSearch, filtered, total, reloadSandboxes, anyRunning, stopAll, updateAll, envProfile, envProfiles, envFiles, envSwitching, switchEnv }) {
  return h("div", {
    style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" },
  },
    // ── Env profile switcher ──
    envProfile && h("select", {
      value: envProfile,
      disabled: envSwitching || !envProfiles || envProfiles.length <= 1,
      onChange: (e) => switchEnv(e.target.value),
      "data-tooltip-id": "tt", "data-tooltip-content": envFiles ? envFiles.join(" > ") : "",
      style: {
        background: "var(--bg-2)", color: "var(--text-1)",
        border: "1px solid var(--border)", borderRadius: "4px",
        padding: "3px 6px", fontSize: "12px", height: "24px",
        fontFamily: "'JetBrains Mono', monospace",
        cursor: envProfiles && envProfiles.length > 1 ? "pointer" : "default",
        outline: "none", flexShrink: 0,
        opacity: envSwitching ? 0.5 : 1,
      },
    },
      (envProfiles || []).map((p) => h("option", { key: p, value: p }, p)),
    ),
    h("input", {
      type: "text",
      placeholder: "Search by email or sandbox id...",
      value: search,
      onChange: (e) => setSearch(e.target.value),
      style: {
        flex: 1, padding: "3px 10px", borderRadius: "4px",
        border: "1px solid var(--border)", background: "var(--bg-2)",
        color: "var(--text-0)", fontSize: "12px", outline: "none",
        fontFamily: "'JetBrains Mono', monospace", height: "24px",
      },
    }),
    h("span", {
      style: {
        fontSize: "12px", color: "var(--text-2)",
        background: "var(--bg-2)", border: "1px solid var(--border)",
        padding: "3px 8px", borderRadius: "4px",
        fontFamily: "'JetBrains Mono', monospace",
        height: "24px", display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
      },
    }, filtered + " / " + total),
    h("button", {
      onClick: reloadSandboxes,
      "data-tooltip-id": "tt", "data-tooltip-content": "Reload sandboxes",
      style: {
        width: "24px", height: "24px", borderRadius: "4px",
        border: "1px solid var(--border)", background: "var(--bg-2)",
        color: "var(--text-1)", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s", padding: 0, fontSize: "14px",
      },
      onMouseEnter: (e) => { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--text-0)"; },
      onMouseLeave: (e) => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.color = "var(--text-1)"; },
    }, "\u21BB"),
    h("button", {
      onClick: anyRunning ? stopAll : updateAll,
      style: {
        padding: "3px 10px", borderRadius: "4px",
        border: `1px solid ${anyRunning ? "var(--red)" : "var(--border)"}`,
        background: anyRunning ? "var(--red-bg)" : "var(--bg-2)",
        color: anyRunning ? "var(--red)" : "var(--green)",
        cursor: "pointer", fontSize: "12px", fontWeight: 500,
        fontFamily: "'JetBrains Mono', monospace",
        transition: "all 0.15s", height: "24px", whiteSpace: "nowrap",
      },
      onMouseEnter: (e) => { e.target.style.background = anyRunning ? "rgba(239,68,68,0.2)" : "var(--bg-3)"; },
      onMouseLeave: (e) => { e.target.style.background = anyRunning ? "var(--red-bg)" : "var(--bg-2)"; },
    }, anyRunning ? "stop all" : "update all"),
  );
}
