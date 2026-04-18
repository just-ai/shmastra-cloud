import { createElement as h } from "react";

// ── Log line highlighter ──

const RULES = [
  // Errors
  { re: /\b(ERROR|Error|error|FATAL|fatal|ERR!)\b/g, color: "var(--red)" },
  { re: /\b(WARN|warn|Warning|warning)\b/g, color: "var(--yellow)" },
  // Stack traces
  { re: /^\s+at .+/g, color: "var(--red)", dim: true },
  // Timestamps: ISO, common log formats
  { re: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.Z+:-]*/g, color: "var(--text-3)" },
  { re: /\b\d{2}:\d{2}:\d{2}\b/g, color: "var(--text-3)" },
  // URLs
  { re: /https?:\/\/[^\s)]+/g, color: "var(--blue)" },
  // File paths with line numbers
  { re: /[\w./:-]+\.[a-z]{1,4}:\d+(?::\d+)?/g, color: "var(--text-1)" },
  // HTTP methods + status codes
  { re: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g, color: "var(--blue)" },
  { re: /\b[2]\d{2}\b/g, color: "var(--green)" },
  { re: /\b[45]\d{2}\b/g, color: "var(--red)" },
  // Strings in quotes
  { re: /"[^"]{1,80}"/g, color: "var(--green)" },
  { re: /'[^']{1,80}'/g, color: "var(--green)" },
];

// Healer-specific line styles.
// If `prefix` is set, only the prefix is colored; the rest uses `color` (dimmed).
// Otherwise the whole line uses `color` + `bg`.
const HEALER_LINE_STYLES = [
  { re: /^> /,    color: "var(--text-1)", bg: null,               prefix: { len: 1, color: "var(--green)" } }, // tool call
  { re: /^→ /,    color: "var(--text-1)", bg: null,               prefix: { len: 1, color: "var(--blue)" } },  // tool result
  { re: /^✓ /,    color: "var(--green)",  bg: "var(--green-bg)" },                                              // finish
  { re: /^✗ /,    color: "var(--red)",    bg: "var(--red-bg)" },                                                // error
  { re: /^⚠ /,    color: "var(--yellow)", bg: "var(--yellow-bg)" },                                             // abort
  { re: /^  \S/,  color: "var(--text-0)", bg: null },                                                           // agent text
];

function healerRule(text) {
  return HEALER_LINE_STYLES.find((r) => r.re.test(text)) || null;
}

function highlightLine(text) {
  const h_rule = healerRule(text);
  if (h_rule) {
    if (h_rule.prefix) {
      return [
        h("span", { key: "p", style: { color: h_rule.prefix.color } }, text.slice(0, h_rule.prefix.len)),
        text.slice(h_rule.prefix.len),
      ];
    }
    return text;
  }

  // Build a list of colored spans by finding all rule matches
  const spans = []; // { start, end, color }

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, color: rule.color, dim: rule.dim });
    }
  }

  if (spans.length === 0) return text;

  // Sort by start, dedupe overlaps (first match wins)
  spans.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of spans) {
    if (merged.length && s.start < merged[merged.length - 1].end) continue;
    merged.push(s);
  }

  const parts = [];
  let pos = 0;
  for (const s of merged) {
    if (s.start > pos) parts.push(text.slice(pos, s.start));
    parts.push(h("span", {
      key: pos + "-" + s.start,
      style: { color: s.color, ...(s.dim ? { opacity: 0.7 } : {}) },
    }, text.slice(s.start, s.end)));
    pos = s.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

function lineStyle(text) {
  const rule = healerRule(text);
  if (rule) return { color: rule.color, bg: rule.bg };
  if (/\b(ERROR|Error|error|FATAL|fatal|ERR!)\b/.test(text)) return { color: "var(--red)", bg: "var(--red-bg)" };
  if (/^\s+at /.test(text)) return { color: "var(--red)", bg: null };
  return { color: null, bg: null };
}

export function PM2LogsTab({ selected, pm2Logs, pm2Process, setPm2Process, pm2Loading, pm2Auto, setPm2Auto, fetchPm2Logs, pm2LogRef, scrollRef }) {
  const allLines = pm2Logs[selected] || null;

  return h("div", {
    style: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-0)", minHeight: 0 },
  },
    // Toolbar
    h("div", {
      style: {
        display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
      },
    },
      ...["shmastra", "healer"].map((proc) =>
        h("button", {
          key: proc,
          onClick: () => { setPm2Process(proc); fetchPm2Logs(selected, proc); },
          style: {
            padding: "2px 8px", fontSize: "11px", borderRadius: "4px",
            fontFamily: "'JetBrains Mono', monospace",
            background: pm2Process === proc ? "var(--bg-3)" : "transparent",
            color: pm2Process === proc ? "var(--text-0)" : "var(--text-2)",
            border: "1px solid " + (pm2Process === proc ? "var(--border-light)" : "transparent"),
            cursor: "pointer",
          },
        }, proc),
      ),
      h("div", { style: { flex: 1 } }),
      h("button", {
        onClick: () => setPm2Auto((a) => !a),
        "data-tooltip-id": "tt", "data-tooltip-content": pm2Auto ? "Stop auto-refresh" : "Auto-refresh every 5s",
        style: {
          padding: "2px 8px", fontSize: "11px", borderRadius: "4px",
          fontFamily: "'JetBrains Mono', monospace",
          background: pm2Auto ? "var(--green-bg)" : "transparent",
          color: pm2Auto ? "var(--green)" : "var(--text-2)",
          border: "1px solid " + (pm2Auto ? "var(--green-dim)" : "transparent"),
          cursor: "pointer",
        },
      }, pm2Auto ? "auto \u25CF" : "auto"),
      h("button", {
        onClick: () => fetchPm2Logs(selected),
        disabled: pm2Loading,
        style: {
          width: "24px", height: "24px", borderRadius: "4px",
          border: "1px solid var(--border)", background: "var(--bg-2)",
          color: pm2Loading ? "var(--text-3)" : "var(--text-1)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: 0, fontSize: "14px",
        },
        onMouseEnter: (e) => { e.currentTarget.style.background = "var(--bg-3)"; },
        onMouseLeave: (e) => { e.currentTarget.style.background = "var(--bg-2)"; },
      }, "\u21BB"),
    ),
    // Log lines
    h("div", {
      ref: pm2LogRef,
      style: { flex: 1, overflow: "auto", padding: "8px 0" },
    },
      !allLines
        ? h("div", {
            className: "mono",
            style: { color: "var(--text-3)", fontSize: "11px", textAlign: "center", padding: "32px 0" },
          }, pm2Loading ? "Loading..." : "~ no logs ~")
        : allLines.length === 0
          ? h("div", {
              className: "mono",
              style: { color: "var(--text-3)", fontSize: "11px", textAlign: "center", padding: "32px 0" },
            }, "~ no logs ~")
          : allLines.map((entry, i) => {
              const ls = lineStyle(entry.text);
              return h("div", {
                key: i, className: "mono",
                style: {
                  fontSize: "11px", lineHeight: "18px", padding: "0 12px",
                  color: ls.color || "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-all",
                  ...(ls.bg ? { background: ls.bg } : {}),
                },
              }, highlightLine(entry.text));
            }),
      h("div", { ref: scrollRef }),
    ),
  );
}
