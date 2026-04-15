import { createElement as h } from "react";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(text) {
  return h("div", {
    className: "md-content",
    dangerouslySetInnerHTML: { __html: marked.parse(text || "") },
  });
}

export function renderParts(parts, msgKey, expandedTools, setExpandedTools) {
  const elements = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    switch (p.type) {
      case "text":
        elements.push(h("div", { key: i }, renderMarkdown(p.text)));
        break;
      case "tool-call": {
        const hasResult = parts[i + 1]?.type === "tool-result";
        const toolKey = `${msgKey}-${i}`;
        const expanded = expandedTools[toolKey];
        elements.push(h("div", {
          key: i,
          onClick: hasResult ? () => setExpandedTools((prev) => ({ ...prev, [toolKey]: !prev[toolKey] })) : undefined,
          style: {
            color: "var(--blue)", borderLeft: "2px solid var(--blue)", paddingLeft: "8px", margin: "2px 0",
            cursor: hasResult ? "pointer" : "default", userSelect: "none",
          },
        },
          hasResult ? h("span", { style: { fontSize: "10px", marginRight: "4px", display: "inline-block", transition: "transform 0.1s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" } }, "\u25B6") : null,
          p.tool,
        ));
        if (hasResult) {
          i++;
          if (expanded) {
            elements.push(h("div", {
              key: i,
              style: { color: "var(--text-2)", borderLeft: "2px solid var(--border-light)", paddingLeft: "8px", margin: "0 0 2px 0", fontSize: "11px", whiteSpace: "pre-wrap", wordBreak: "break-all" },
            }, "\u2192 " + parts[i].result));
          }
        }
        break;
      }
      case "tool-result":
        elements.push(h("div", {
          key: i,
          style: { color: "var(--text-2)", borderLeft: "2px solid var(--border-light)", paddingLeft: "8px", margin: "2px 0", fontSize: "11px", whiteSpace: "pre-wrap" },
        }, "\u2192 " + p.result));
        break;
      case "stdout":
        elements.push(h("pre", {
          key: i,
          style: { color: "var(--text-1)", fontSize: "11px", lineHeight: "16px", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" },
        }, p.text));
        break;
      case "stderr":
        elements.push(h("pre", {
          key: i,
          style: { color: "var(--yellow)", fontSize: "11px", lineHeight: "16px", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" },
        }, p.text));
        break;
      case "exit":
        elements.push(h("div", {
          key: i,
          style: { color: "var(--red)", fontSize: "11px" },
        }, `exit: ${p.code}`));
        break;
      case "error":
        elements.push(h("div", { key: i, style: { color: "var(--red)" } }, "\u2717 " + p.error));
        break;
    }
  }
  return elements;
}
