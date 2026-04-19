import { createElement as h, useEffect, useRef, useState } from "react";
import { dbStatusColor } from "./status-badge.js";
import { TabBar } from "./tab-bar.js";
import { PhaseBar } from "./phase-bar.js";
import { UpdateLogTab } from "./update-log-tab.js";
import { PM2LogsTab } from "./pm2-logs-tab.js";
import { ChatTab } from "./chat-tab.js";
import { FilesTab } from "./files-tab.js";
import { StatsTab } from "./stats-tab.js";
import { TraceTab } from "./trace-tab.js";

export function SlidePanel({
  selected, selectedEntry, panelWidth, setPanelWidth,
  currentTab, setTab,
  // Status
  getStatus, phases,
  // Update logs
  logs, logContainerRef,
  // Phase bar
  logPhaseSet, lastLogPhase, hoveredPhase, setHoveredPhase, activePhase, setActivePhase,
  // PM2 logs
  pm2Logs, pm2Process, setPm2Process, pm2Loading, pm2Auto, setPm2Auto, fetchPm2Logs, pm2LogRef,
  // Chat
  chatMessages, chatStreaming, chatInput, setChatInput, cmdMode, setCmdMode, sendChat, stopChat, expandedTools, setExpandedTools, inputRef,
  // Close
  onClose,
}) {
  const resizingRef = useRef(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!resizingRef.current) return;
      const w = Math.max(400, Math.min(window.innerWidth - 200, window.innerWidth - e.clientX));
      setPanelWidth(w);
    };
    const onMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const handle = document.querySelector("[data-resize-handle]");
        if (handle) handle.style.background = "transparent";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, []);

  // Auto-scroll on content change (skip if user is inspecting a phase)
  useEffect(() => {
    if (!activePhase && !hoveredPhase) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, chatMessages, currentTab]);

  const scrollToPhase = (p) => {
    if (logContainerRef.current) {
      const el = logContainerRef.current.querySelector(`[data-phase="${p}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const highlightPhase = activePhase || hoveredPhase;

  return h("div", {
    className: "panel-enter",
    style: {
      position: "fixed", top: 0, right: 0, width: panelWidth + "px", height: "100vh",
      background: "var(--bg-1)", borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    },
  },
    // Resize handle
    h("div", {
      onMouseDown: (e) => {
        e.preventDefault();
        resizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      },
      "data-resize-handle": true,
      style: {
        position: "absolute", top: 0, left: 0, width: "4px", height: "100%",
        cursor: "col-resize", zIndex: 10,
      },
      onMouseEnter: (e) => { e.currentTarget.style.background = "var(--blue)"; },
      onMouseLeave: (e) => { if (!resizingRef.current) e.currentTarget.style.background = "transparent"; },
    }),

    // Header
    h("div", {
      style: {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--border)", minHeight: "48px",
      },
    },
      h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
        h("span", { style: { fontSize: "13px", color: "var(--text-1)", fontWeight: 500 } },
          selectedEntry?.email || selected),
        (() => {
          const st = selectedEntry?.status;
          const color = dbStatusColor(st);
          const label = st || "unknown";
          return h("span", {
            style: {
              display: "inline-flex", alignItems: "center", gap: "5px",
              fontSize: "11px", color, fontFamily: "'JetBrains Mono', monospace",
            },
          },
            h("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: color, flexShrink: 0 } }),
            label,
          );
        })(),
      ),
      h("button", {
        onClick: onClose,
        style: {
          background: "none", border: "none", color: "var(--text-2)",
          cursor: "pointer", fontSize: "16px", padding: "4px", lineHeight: 1,
        },
        onMouseEnter: (e) => { e.target.style.color = "var(--text-0)"; },
        onMouseLeave: (e) => { e.target.style.color = "var(--text-2)"; },
      }, "\u2715"),
    ),

    // Tabs
    h(TabBar, { currentTab, setTab: (t) => setTab(t) }),

    // Phase bar (Update tab only)
    currentTab === "logs" && h(PhaseBar, {
      logPhaseSet, lastLogPhase, status: getStatus(selected),
      hoveredPhase, setHoveredPhase, activePhase, setActivePhase, scrollToPhase,
    }),

    // Update logs tab
    currentTab === "logs" && h(UpdateLogTab, {
      logs, status: getStatus(selected),
      highlightPhase, hoveredPhase, setHoveredPhase,
      scrollRef, logContainerRef,
    }),

    // PM2 logs tab
    currentTab === "pm2logs" && h(PM2LogsTab, {
      selected, pm2Logs, pm2Process, setPm2Process, pm2Loading, pm2Auto, setPm2Auto, fetchPm2Logs, pm2LogRef, scrollRef,
    }),

    // Files tab (always mounted, hidden when inactive to preserve state)
    h("div", {
      style: { flex: currentTab === "files" ? 1 : 0, display: currentTab === "files" ? "flex" : "none", flexDirection: "column", minHeight: 0 },
    }, h(FilesTab, { selected })),

    // Stats tab
    currentTab === "stats" && h(StatsTab, { sandboxId: selected }),

    // Trace tab (observability)
    currentTab === "trace" && h(TraceTab, { sandboxId: selected }),

    // Chat tab
    currentTab === "chat" && h(ChatTab, {
      selected, messages: chatMessages, streaming: chatStreaming[selected],
      chatInput, setChatInput, cmdMode, setCmdMode, sendChat, stopChat,
      expandedTools, setExpandedTools, inputRef, scrollRef,
    }),
  );
}
