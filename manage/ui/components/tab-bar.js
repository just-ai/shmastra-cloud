import { createElement as h } from "react";

function tabBtn(id, label, active, onClick) {
  return h("button", {
    key: id,
    onClick,
    style: {
      padding: "4px 12px", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
      background: active ? "var(--bg-3)" : "transparent",
      color: active ? "var(--text-0)" : "var(--text-2)",
      border: "1px solid " + (active ? "var(--border-light)" : "transparent"),
      borderRadius: "4px", cursor: "pointer", fontWeight: active ? 500 : 400,
    },
  }, label);
}

export function TabBar({ currentTab, setTab }) {
  return h("div", {
    style: {
      display: "flex", gap: "4px", padding: "8px 16px",
      borderBottom: "1px solid var(--border)",
    },
  },
    tabBtn("chat", "Chat", currentTab === "chat", () => setTab("chat")),
    tabBtn("pm2logs", "Logs", currentTab === "pm2logs", () => setTab("pm2logs")),
    tabBtn("logs", "Update", currentTab === "logs", () => setTab("logs")),
    tabBtn("files", "Files", currentTab === "files", () => setTab("files")),
  );
}
