import { createElement as h } from "react";
import { renderParts } from "./chat-parts.js";

export function ChatTab({ selected, messages, streaming, chatInput, setChatInput, cmdMode, setCmdMode, sendChat, stopChat, expandedTools, setExpandedTools, inputRef, scrollRef }) {
  return h("div", {
    style: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-0)", minHeight: 0 },
  },
    // Messages
    h("div", { style: { flex: 1, overflow: "auto", padding: "8px 0", minHeight: 0 } },
      messages.length === 0
        ? h("div", {
            className: "mono",
            style: { color: "var(--text-3)", fontSize: "11px", textAlign: "center", padding: "32px 0" },
          }, "~ type a message to start ~")
        : messages.map((msg, i) => {
            const roleStyles = {
              user: { color: "var(--green)", borderLeft: "2px solid var(--green-dim)", marginTop: i > 0 ? "8px" : 0 },
              command: { color: "var(--text-0)", borderLeft: "2px solid var(--text-3)", marginTop: i > 0 ? "8px" : 0, background: "var(--bg-2)", borderRadius: "0 4px 4px 0", padding: "4px 12px" },
              output: { color: "var(--text-2)", borderLeft: "2px solid var(--border-light)", padding: "4px 12px" },
              assistant: { color: "var(--text-1)", borderLeft: "2px solid transparent" },
            };
            return h("div", {
              key: i, className: "mono",
              style: {
                fontSize: "11px", lineHeight: "18px", padding: "4px 12px",
                ...(roleStyles[msg.role] || roleStyles.assistant),
              },
            },
              msg.role === "user"
                ? h("span", null, "> ", msg.parts[0]?.text || "")
                : msg.role === "command"
                  ? h("span", null, "$ ", msg.parts[0]?.text || "")
                  : renderParts(msg.parts, `${selected}-${i}`, expandedTools, setExpandedTools),
            );
          }),
      streaming && h("div", {
        className: "mono animate-pulse",
        style: { fontSize: "11px", color: "var(--text-3)", padding: "4px 12px" },
      }, "\u2588"),
      h("div", { ref: scrollRef }),
    ),

    // Input
    h("div", {
      style: {
        padding: "8px 12px", borderTop: "1px solid var(--border)",
        display: "flex", gap: "6px", alignItems: "center",
      },
    },
      h("button", {
        onClick: () => setCmdMode((m) => !m),
        "data-tooltip-id": "tt", "data-tooltip-content": cmdMode ? "Command mode (click for agent)" : "Agent mode (click for command)",
        style: {
          width: "28px", height: "28px", borderRadius: "4px",
          border: "1px solid " + (cmdMode ? "var(--text-3)" : "var(--border)"),
          background: cmdMode ? "var(--bg-3)" : "transparent",
          color: cmdMode ? "var(--text-0)" : "var(--text-2)",
          cursor: "pointer", fontSize: "14px",
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, transition: "all 0.15s",
        },
      }, cmdMode ? "$" : ">"),
      h("input", {
        ref: inputRef,
        type: "text",
        placeholder: cmdMode ? "Enter command..." : "Type a message (!cmd for bash)...",
        value: chatInput,
        onChange: (e) => setChatInput(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && !e.shiftKey && chatInput.trim()) {
            e.preventDefault();
            const msg = chatInput;
            setChatInput("");
            sendChat(selected, msg);
          }
        },
        disabled: streaming,
        style: {
          flex: 1, padding: "6px 10px", borderRadius: "4px",
          border: "1px solid var(--border)", background: "var(--bg-2)",
          color: "var(--text-0)", fontSize: "12px", outline: "none",
          fontFamily: "'JetBrains Mono', monospace",
          opacity: streaming ? 0.5 : 1,
        },
      }),
      streaming
        ? h("button", {
            onClick: () => stopChat(selected),
            style: {
              padding: "6px 14px", borderRadius: "4px",
              border: "1px solid var(--red)", background: "var(--red-bg)",
              color: "var(--red)", cursor: "pointer",
              fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
              transition: "all 0.15s",
            },
          }, "stop")
        : h("button", {
            onClick: () => {
              if (chatInput.trim()) {
                const msg = chatInput;
                setChatInput("");
                sendChat(selected, msg);
              }
            },
            disabled: !chatInput.trim(),
            style: {
              padding: "6px 14px", borderRadius: "4px",
              border: "1px solid var(--border)", background: "var(--bg-2)",
              color: chatInput.trim() ? "var(--green)" : "var(--text-3)",
              cursor: chatInput.trim() ? "pointer" : "default",
              fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
              transition: "all 0.15s",
            },
          }, "send"),
    ),
  );
}
