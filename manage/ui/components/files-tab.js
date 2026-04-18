import { createElement as h, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { API } from "../utils.js";

// ── highlight.js setup (lazy) ──
let _hljs = null;
async function getHljs() {
  if (_hljs) return _hljs;
  const [{ default: hljs }, js, ts, json, css, xml, bash, md, yaml, sql, py] = await Promise.all([
    import("highlight.js/core"),
    import("highlight.js/lib/languages/javascript"),
    import("highlight.js/lib/languages/typescript"),
    import("highlight.js/lib/languages/json"),
    import("highlight.js/lib/languages/css"),
    import("highlight.js/lib/languages/xml"),
    import("highlight.js/lib/languages/bash"),
    import("highlight.js/lib/languages/markdown"),
    import("highlight.js/lib/languages/yaml"),
    import("highlight.js/lib/languages/sql"),
    import("highlight.js/lib/languages/python"),
  ]);
  hljs.registerLanguage("javascript", js.default);
  hljs.registerLanguage("typescript", ts.default);
  hljs.registerLanguage("json", json.default);
  hljs.registerLanguage("css", css.default);
  hljs.registerLanguage("xml", xml.default);
  hljs.registerLanguage("bash", bash.default);
  hljs.registerLanguage("markdown", md.default);
  hljs.registerLanguage("yaml", yaml.default);
  hljs.registerLanguage("sql", sql.default);
  hljs.registerLanguage("python", py.default);
  _hljs = hljs;
  return hljs;
}

const EXT_LANG = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", tsx: "typescript",
  json: "json", css: "css", html: "xml", xml: "xml", svg: "xml",
  sh: "bash", bash: "bash", zsh: "bash",
  md: "markdown", yaml: "yaml", yml: "yaml",
  sql: "sql", py: "python",
};

const EXT_COLORS = {
  js: "var(--yellow)", ts: "var(--blue)", mts: "var(--blue)", tsx: "var(--blue)", jsx: "var(--yellow)",
  json: "var(--green)", css: "var(--blue)", html: "var(--red)", md: "var(--text-1)",
  sh: "var(--green)", log: "var(--text-2)", cjs: "var(--yellow)", mjs: "var(--yellow)",
};

const ICON = { dir: "\uD83D\uDCC1", file: "\uD83D\uDCC4", back: "\u2190", refresh: "\u21BB", download: "\u2B73", home: "\u2302" };

function getExt(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isBinary(name) {
  const bin = ["png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "zip", "tar", "gz", "pdf", "mp3", "mp4", "webp", "avif", "bmp", "so", "o", "pyc"];
  return bin.includes(getExt(name));
}

function btn(props, ...children) {
  return h("button", {
    ...props,
    style: {
      height: "24px", borderRadius: "4px",
      border: "1px solid var(--border)", background: "transparent",
      color: "var(--text-1)", cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "0 6px", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
      flexShrink: 0, gap: "4px", whiteSpace: "nowrap",
      ...props.style,
    },
    onMouseEnter: (e) => { e.currentTarget.style.background = "var(--bg-3)"; },
    onMouseLeave: (e) => { e.currentTarget.style.background = "transparent"; },
  }, ...children);
}

export function FilesTab({ selected }) {
  const [cwd, setCwd] = useState("/home/user");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // File viewer/editor
  const [viewFile, setViewFile] = useState(null); // { path, content, loading }
  const [highlighted, setHighlighted] = useState(""); // highlighted HTML
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Inline actions
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // path to confirm
  const fileInputRef = useRef(null);
  const newFolderRef = useRef(null);
  const editorRef = useRef(null);

  // ── API helpers ──

  const loadDir = useCallback((path) => {
    setLoading(true);
    setError(null);
    fetch(`${API}/api/files/${selected}/list?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setEntries([]); }
        else { setEntries(data); setCwd(path); }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selected]);

  const loadFile = useCallback((path) => {
    if (isBinary(path)) {
      setViewFile({ path, content: "(binary file)", loading: false });
      setHighlighted("");
      setEditing(false);
      return;
    }
    setViewFile({ path, content: "", loading: true });
    setHighlighted("");
    setEditing(false);
    fetch(`${API}/api/files/${selected}/read?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (data.error) {
          setViewFile({ path, content: "Error: " + data.error, loading: false });
        } else {
          setViewFile({ path, content: data.content, loading: false });
          // Highlight
          const ext = getExt(path);
          const lang = EXT_LANG[ext];
          try {
            const hljs = await getHljs();
            const result = lang
              ? hljs.highlight(data.content, { language: lang })
              : hljs.highlightAuto(data.content);
            setHighlighted(result.value);
          } catch {
            setHighlighted("");
          }
        }
      })
      .catch((e) => setViewFile({ path, content: "Error: " + e.message, loading: false }));
  }, [selected]);

  const saveFile = useCallback(async () => {
    if (!viewFile) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/files/${selected}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: viewFile.path, content: editContent }),
      });
      setViewFile({ ...viewFile, content: editContent });
      setEditing(false);
      // Re-highlight
      const ext = getExt(viewFile.path);
      const lang = EXT_LANG[ext];
      try {
        const hljs = await getHljs();
        const result = lang
          ? hljs.highlight(editContent, { language: lang })
          : hljs.highlightAuto(editContent);
        setHighlighted(result.value);
      } catch {
        setHighlighted("");
      }
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }, [selected, viewFile, editContent]);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const path = cwd === "/" ? `/${name}` : `${cwd}/${name}`;
    try {
      await fetch(`${API}/api/files/${selected}/mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      setShowNewFolder(false);
      setNewFolderName("");
      loadDir(cwd);
    } catch (e) {
      setError(e.message);
    }
  }, [selected, cwd, newFolderName, loadDir]);

  const deleteItem = useCallback(async (path) => {
    try {
      await fetch(`${API}/api/files/${selected}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      setConfirmDelete(null);
      if (viewFile?.path === path) setViewFile(null);
      loadDir(cwd);
    } catch (e) {
      setError(e.message);
    }
  }, [selected, cwd, viewFile, loadDir]);

  const uploadFiles = useCallback(async (fileList) => {
    for (const file of fileList) {
      const text = await file.text();
      const path = cwd === "/" ? `/${file.name}` : `${cwd}/${file.name}`;
      await fetch(`${API}/api/files/${selected}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: text }),
      });
    }
    loadDir(cwd);
  }, [selected, cwd, loadDir]);

  const downloadFile = (path, isDir) => {
    const url = `${API}/api/files/${selected}/download?path=${encodeURIComponent(path)}${isDir ? "&type=dir" : ""}`;
    window.open(url, "_blank");
  };

  // ── Effects ──

  useEffect(() => { loadDir(cwd); }, [selected]);

  useEffect(() => {
    if (showNewFolder) newFolderRef.current?.focus();
  }, [showNewFolder]);

  // ── Navigation ──

  const navigate = (entry) => {
    if (entry.type === "dir") {
      loadDir(entry.path);
      setViewFile(null);
      setEditing(false);
    } else {
      loadFile(entry.path);
    }
  };

  const goUp = () => {
    const parent = cwd.split("/").slice(0, -1).join("/") || "/";
    loadDir(parent);
    setViewFile(null);
  };

  const goHome = () => { loadDir("/home/user"); setViewFile(null); };

  const startEdit = () => {
    setEditContent(viewFile.content);
    setEditing(true);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  // ── Breadcrumb ──

  const pathParts = cwd.split("/").filter(Boolean);

  // ── Render ──

  return h("div", {
    style: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-0)", minHeight: 0 },
  },
    // ── Toolbar ──
    h("div", {
      style: {
        display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px",
        borderBottom: "1px solid var(--border)", minHeight: "36px",
      },
    },
      btn({ onClick: goHome, "data-tooltip-id": "tt", "data-tooltip-content": "/home/user" }, ICON.home),
      btn({ onClick: goUp, disabled: cwd === "/", "data-tooltip-id": "tt", "data-tooltip-content": "Go up", style: cwd === "/" ? { color: "var(--text-3)", cursor: "default" } : {} }, ICON.back),
      // Breadcrumb
      h("div", {
        className: "mono",
        style: { flex: 1, fontSize: "11px", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      },
        h("span", {
          style: { cursor: "pointer", color: "var(--text-1)" },
          onClick: () => { loadDir("/"); setViewFile(null); },
        }, "/"),
        ...pathParts.map((part, i) => {
          const path = "/" + pathParts.slice(0, i + 1).join("/");
          const isLast = i === pathParts.length - 1;
          return [
            h("span", { key: `s${i}`, style: { color: "var(--text-3)", margin: "0 2px" } }, "/"),
            h("span", {
              key: `p${i}`,
              style: { cursor: isLast ? "default" : "pointer", color: isLast ? "var(--text-0)" : "var(--text-1)" },
              onClick: isLast ? undefined : () => { loadDir(path); setViewFile(null); },
            }, part),
          ];
        }).flat(),
      ),
      btn({ onClick: () => setShowNewFolder(true), "data-tooltip-id": "tt", "data-tooltip-content": "New folder" }, "+\uD83D\uDCC1"),
      btn({ onClick: () => fileInputRef.current?.click(), "data-tooltip-id": "tt", "data-tooltip-content": "Upload file" }, "\u2191"),
      btn({ onClick: () => loadDir(cwd), "data-tooltip-id": "tt", "data-tooltip-content": "Refresh" }, ICON.refresh),
      h("input", {
        ref: fileInputRef, type: "file", multiple: true,
        style: { display: "none" },
        onChange: (e) => { if (e.target.files.length) { uploadFiles(e.target.files); e.target.value = ""; } },
      }),
    ),

    // ── New folder inline input ──
    showNewFolder && h("div", {
      style: {
        display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
        borderBottom: "1px solid var(--border)", background: "var(--bg-1)",
      },
    },
      h("span", { style: { fontSize: "12px" } }, ICON.dir),
      h("input", {
        ref: newFolderRef,
        type: "text", placeholder: "folder name",
        value: newFolderName,
        onChange: (e) => setNewFolderName(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") createFolder();
          if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
        },
        style: {
          flex: 1, padding: "2px 8px", borderRadius: "4px",
          border: "1px solid var(--border)", background: "var(--bg-2)",
          color: "var(--text-0)", fontSize: "12px", outline: "none",
          fontFamily: "'JetBrains Mono', monospace",
        },
      }),
      btn({ onClick: createFolder, style: { color: "var(--green)" } }, "create"),
      btn({ onClick: () => { setShowNewFolder(false); setNewFolderName(""); } }, "\u2715"),
    ),

    // ── Content area ──
    h("div", { style: { flex: 1, display: "flex", minHeight: 0 } },

      // ── File list ──
      h("div", {
        style: {
          width: viewFile ? "40%" : "100%",
          overflow: "auto", borderRight: viewFile ? "1px solid var(--border)" : "none",
          transition: "width 0.15s",
        },
      },
        loading
          ? h("div", { className: "mono", style: { color: "var(--text-3)", fontSize: "11px", padding: "24px", textAlign: "center" } }, "Loading...")
          : error
            ? h("div", { className: "mono", style: { color: "var(--red)", fontSize: "11px", padding: "24px", textAlign: "center" } }, error)
            : entries.length === 0
              ? h("div", { className: "mono", style: { color: "var(--text-3)", fontSize: "11px", padding: "24px", textAlign: "center" } }, "~ empty ~")
              : entries.map((entry) => {
                  const ext = getExt(entry.name);
                  const isDir = entry.type === "dir";
                  const isSelected = viewFile?.path === entry.path;
                  const isDeleting = confirmDelete === entry.path;
                  const color = isDir ? "var(--text-1)" : (EXT_COLORS[ext] || "var(--text-2)");

                  if (isDeleting) {
                    return h("div", {
                      key: entry.path,
                      style: {
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "4px 12px", background: "var(--red-bg)", borderLeft: "2px solid var(--red)",
                      },
                    },
                      h("span", { className: "mono", style: { flex: 1, fontSize: "11px", color: "var(--red)" } },
                        "Delete " + entry.name + "?"),
                      btn({ onClick: () => deleteItem(entry.path), style: { color: "var(--red)", borderColor: "var(--red)" } }, "yes"),
                      btn({ onClick: () => setConfirmDelete(null) }, "no"),
                    );
                  }

                  return h("div", {
                    key: entry.path,
                    onClick: () => navigate(entry),
                    style: {
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "4px 12px", cursor: "pointer",
                      background: isSelected ? "var(--bg-2)" : "transparent",
                      borderLeft: isSelected ? "2px solid var(--blue)" : "2px solid transparent",
                    },
                    onMouseEnter: (e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-2)"; },
                    onMouseLeave: (e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; },
                  },
                    h("span", { style: { fontSize: "12px", flexShrink: 0, width: "16px", textAlign: "center" } },
                      isDir ? ICON.dir : ICON.file),
                    h("span", {
                      className: "mono",
                      style: { fontSize: "11px", color, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                    }, entry.name),
                    // Delete button
                    h("span", {
                      onClick: (e) => { e.stopPropagation(); setConfirmDelete(entry.path); },
                      style: {
                        fontSize: "11px", color: "var(--text-3)", cursor: "pointer",
                        opacity: 0, transition: "opacity 0.15s", padding: "0 2px",
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.color = "var(--red)"; },
                      onMouseLeave: (e) => { e.currentTarget.style.color = "var(--text-3)"; },
                      className: "file-action",
                      "data-tooltip-id": "tt", "data-tooltip-content": "Delete",
                    }, "\u2715"),
                    // Download button
                    h("span", {
                      onClick: (e) => { e.stopPropagation(); downloadFile(entry.path, isDir); },
                      style: {
                        fontSize: "11px", color: "var(--text-3)", cursor: "pointer",
                        opacity: 0, transition: "opacity 0.15s", padding: "0 2px",
                      },
                      className: "file-action",
                      "data-tooltip-id": "tt", "data-tooltip-content": "Download",
                    }, ICON.download),
                  );
                }),
      ),

      // ── File viewer / editor ──
      viewFile && h("div", {
        style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
      },
        // Viewer header
        h("div", {
          style: {
            display: "flex", alignItems: "center", gap: "6px",
            padding: "4px 12px", borderBottom: "1px solid var(--border)",
            background: "var(--bg-1)",
          },
        },
          h("span", {
            className: "mono",
            style: { flex: 1, fontSize: "11px", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
          }, viewFile.path.split("/").pop()),
          // Edit / Save / Cancel
          !viewFile.loading && !isBinary(viewFile.path) && (
            editing
              ? [
                  btn({ key: "save", onClick: saveFile, disabled: saving, style: { color: "var(--green)", borderColor: "var(--green-dim)" } },
                    saving ? "saving..." : "save"),
                  btn({ key: "cancel", onClick: () => setEditing(false) }, "cancel"),
                ]
              : btn({ onClick: startEdit }, "edit")
          ),
          btn({ onClick: () => downloadFile(viewFile.path, false), "data-tooltip-id": "tt", "data-tooltip-content": "Download" }, ICON.download),
          btn({ onClick: () => { setViewFile(null); setEditing(false); }, "data-tooltip-id": "tt", "data-tooltip-content": "Close", style: { fontSize: "14px", padding: "0 4px" } }, "\u2715"),
        ),
        // File content
        h("div", {
          style: { flex: 1, overflow: "auto", padding: 0 },
        },
          viewFile.loading
            ? h("div", { className: "mono", style: { color: "var(--text-3)", fontSize: "11px", padding: "12px" } }, "Loading...")
            : editing
              ? h("textarea", {
                  ref: editorRef,
                  value: editContent,
                  onChange: (e) => setEditContent(e.target.value),
                  spellCheck: false,
                  style: {
                    width: "100%", height: "100%", resize: "none",
                    padding: "8px 12px", margin: 0, border: "none",
                    background: "var(--bg-0)", color: "var(--text-0)",
                    fontSize: "12px", lineHeight: "20px",
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: "none", tabSize: 2,
                  },
                  onKeyDown: (e) => {
                    // Tab support
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const ta = e.target;
                      const start = ta.selectionStart;
                      const end = ta.selectionEnd;
                      setEditContent(editContent.substring(0, start) + "  " + editContent.substring(end));
                      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
                    }
                    // Ctrl+S to save
                    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                      e.preventDefault();
                      saveFile();
                    }
                  },
                })
              : highlighted
                ? h("pre", {
                    className: "hljs",
                    style: {
                      margin: 0, padding: "8px 12px",
                      fontSize: "12px", lineHeight: "20px",
                      fontFamily: "'JetBrains Mono', monospace",
                      background: "transparent", overflow: "visible",
                      whiteSpace: "pre-wrap", wordBreak: "break-all",
                    },
                    dangerouslySetInnerHTML: { __html: highlighted },
                  })
                : h("pre", {
                    className: "mono",
                    style: {
                      margin: 0, padding: "8px 12px",
                      fontSize: "12px", lineHeight: "20px",
                      color: "var(--text-2)",
                      whiteSpace: "pre-wrap", wordBreak: "break-all",
                    },
                  }, viewFile.content),
        ),
      ),
    ),
  );
}
