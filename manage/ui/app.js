import { createElement as h, useState, useEffect, useRef, useCallback } from "react";
import { Tooltip } from "react-tooltip";
import { API, parseSSE } from "./utils.js";
import { Header } from "./components/header.js";
import { SandboxTable } from "./components/sandbox-table.js";
import { SlidePanel } from "./components/slide-panel.js";

export function App() {
  const [sandboxes, setSandboxes] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [phases, setPhases] = useState({});
  // Per-sandbox map of phase name → PhaseStatus ("running" | "done" | "skipped" | "error").
  // Drives the phase bar coloring independently of log content.
  const [phaseStates, setPhaseStates] = useState({});
  const [logs, setLogs] = useState({});
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Chat state
  const [tab, setTab] = useState({});
  const [chatMessages, setChatMessages] = useState({});
  const [chatStreaming, setChatStreaming] = useState({});
  const [chatInput, setChatInput] = useState("");
  const [cmdMode, setCmdMode] = useState(false);
  const [expandedTools, setExpandedTools] = useState({});
  const chatAbortRef = useRef({});
  const [panelWidth, setPanelWidth] = useState(680);
  const inputRef = useRef(null);
  const [hoveredPhase, setHoveredPhase] = useState(null);
  const [activePhase, setActivePhase] = useState(null);
  const logContainerRef = useRef(null);

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const addToast = useCallback((message, type = "error") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  // Env profile state
  const [envProfile, setEnvProfile] = useState(null);
  const [envProfiles, setEnvProfiles] = useState([]);
  const [envFiles, setEnvFiles] = useState([]);
  const [envSwitching, setEnvSwitching] = useState(false);

  // PM2 logs state
  const [pm2Logs, setPm2Logs] = useState({});
  const [pm2Process, setPm2Process] = useState("shmastra");
  const [pm2Loading, setPm2Loading] = useState(false);
  const [pm2Auto, setPm2Auto] = useState(false);
  const pm2IntervalRef = useRef(null);
  const pm2LogRef = useRef(null);

  // ── Data fetching ──

  useEffect(() => {
    fetch(`${API}/api/sandboxes`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((entries) => { if (Array.isArray(entries)) setSandboxes(entries); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`${API}/api/env`)
      .then((r) => r.json())
      .then(({ profile, profiles, files }) => { setEnvProfile(profile); setEnvProfiles(profiles); setEnvFiles(files); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const es = new EventSource(`${API}/api/events`);
    es.addEventListener("log", (e) => {
      const { sandboxId, message, phase } = JSON.parse(e.data);
      setLogs((prev) => ({
        ...prev,
        [sandboxId]: [...(prev[sandboxId] || []), { time: new Date(), message, phase: phase || null }],
      }));
    });
    es.addEventListener("status", (e) => {
      const { sandboxId, status } = JSON.parse(e.data);
      setStatuses((prev) => ({ ...prev, [sandboxId]: status }));
    });
    es.addEventListener("phase", (e) => {
      const { sandboxId, phase, status } = JSON.parse(e.data);
      setPhaseStates((prev) => ({
        ...prev,
        [sandboxId]: { ...(prev[sandboxId] || {}), [phase]: status },
      }));
      if (status === "running") {
        setPhases((prev) => ({ ...prev, [sandboxId]: phase }));
      }
    });
    return () => es.close();
  }, []);

  // ── Focus & reset on selection change ──

  useEffect(() => {
    if (selected && getTab(selected) === "chat") {
      inputRef.current?.focus();
    }
  }, [selected, tab]);

  useEffect(() => { setActivePhase(null); setHoveredPhase(null); }, [selected]);

  // Keep the selected sandbox alive while the panel is open
  useEffect(() => {
    if (!selected) return;
    const ping = () => fetch(`${API}/api/keepalive/${selected}`, { method: "POST" }).catch(() => {});
    ping();
    const interval = setInterval(ping, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selected]);

  useEffect(() => {
    if (selected && getTab(selected) === "chat" && !chatStreaming[selected]) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [chatStreaming, selected]);

  // ── PM2 logs ──

  const fetchPm2Logs = useCallback((sandboxId, proc) => {
    if (!sandboxId) return;
    setPm2Loading(true);
    fetch(`${API}/api/logs/${sandboxId}?lines=300&process=${proc || pm2Process}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPm2Logs((prev) => ({ ...prev, [sandboxId]: data }));
      })
      .catch(() => {})
      .finally(() => setPm2Loading(false));
  }, [pm2Process]);

  useEffect(() => {
    if (pm2IntervalRef.current) { clearInterval(pm2IntervalRef.current); pm2IntervalRef.current = null; }
    if (pm2Auto && selected && getTab(selected) === "pm2logs") {
      fetchPm2Logs(selected);
      pm2IntervalRef.current = setInterval(() => fetchPm2Logs(selected), 5000);
    }
    return () => { if (pm2IntervalRef.current) { clearInterval(pm2IntervalRef.current); pm2IntervalRef.current = null; } };
  }, [pm2Auto, selected, tab, pm2Process]);

  useEffect(() => {
    if (selected && getTab(selected) === "pm2logs" && !pm2Logs[selected]) {
      fetchPm2Logs(selected);
    }
  }, [selected, tab]);

  useEffect(() => {
    if (pm2LogRef.current) {
      pm2LogRef.current.scrollTop = pm2LogRef.current.scrollHeight;
    }
  }, [pm2Logs, selected]);

  // ── Helpers ──

  const getTab = (id) => tab[id] || "chat";
  const getStatus = (id) => statuses[id] || "pending";

  // ── Actions ──

  const updateOne = useCallback((id) => {
    setLogs((prev) => ({ ...prev, [id]: [] }));
    setPhaseStates((prev) => ({ ...prev, [id]: {} }));
    fetch(`${API}/api/update/${id}`, { method: "POST" });
  }, []);

  const stopOne = useCallback((id) => {
    fetch(`${API}/api/stop/${id}`, { method: "POST" });
  }, []);

  const updateAll = useCallback(() => {
    fetch(`${API}/api/update-all`, { method: "POST" });
  }, []);

  const stopAll = useCallback(() => {
    fetch(`${API}/api/stop-all`, { method: "POST" });
  }, []);

  const reloadSandboxes = useCallback(() => {
    return fetch(`${API}/api/sandboxes`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((entries) => { if (Array.isArray(entries)) setSandboxes(entries); })
      .catch(() => {});
  }, []);

  const switchEnv = useCallback(async (profile) => {
    const prev = envProfile;
    setEnvSwitching(true);
    try {
      const r = await fetch(`${API}/api/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = await r.json();
      if (data.error) { addToast(data.error); return; }
      setEnvProfile(data.profile);
      setEnvFiles(data.files);
      // Verify sandboxes load with new env
      const sr = await fetch(`${API}/api/sandboxes`);
      const body = await sr.json();
      if (!sr.ok) throw new Error(body.error || `HTTP ${sr.status}`);
      if (Array.isArray(body)) setSandboxes(body);
    } catch (err) {
      addToast(`Failed to switch to "${profile}": ${err.message}. Reverted to "${prev}".`);
      // Revert
      const rr = await fetch(`${API}/api/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: prev }),
      }).catch(() => null);
      if (rr) {
        const d = await rr.json();
        setEnvProfile(d.profile);
        setEnvFiles(d.files);
      }
    } finally {
      setEnvSwitching(false);
    }
  }, [envProfile]);

  const stopChat = useCallback((sandboxId) => {
    const ac = chatAbortRef.current[sandboxId];
    if (ac) { ac.abort(); delete chatAbortRef.current[sandboxId]; }
  }, []);

  // ── Command execution ──

  const execCommand = useCallback(async (sandboxId, command) => {
    if (!command.trim() || chatStreaming[sandboxId]) return;

    setChatMessages((prev) => ({
      ...prev,
      [sandboxId]: [...(prev[sandboxId] || []), { role: "command", parts: [{ type: "text", text: command }], time: new Date() }],
    }));
    setChatStreaming((prev) => ({ ...prev, [sandboxId]: true }));
    const ac = new AbortController();
    chatAbortRef.current[sandboxId] = ac;

    try {
      const res = await fetch(`${API}/api/exec/${sandboxId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
        signal: ac.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const outputParts = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lastComplete = buffer.lastIndexOf("\n\n");
        if (lastComplete === -1) continue;
        const complete = buffer.slice(0, lastComplete + 2);
        buffer = buffer.slice(lastComplete + 2);
        const events = parseSSE(complete);

        for (const ev of events) {
          if (ev.event === "stdout") outputParts.push({ type: "stdout", text: ev.data.text });
          else if (ev.event === "stderr") outputParts.push({ type: "stderr", text: ev.data.text });
          else if (ev.event === "exit" && ev.data.code !== 0) outputParts.push({ type: "exit", code: ev.data.code });
          else if (ev.event === "error") outputParts.push({ type: "error", error: ev.data.error });

          setChatMessages((prev) => {
            const msgs = [...(prev[sandboxId] || [])];
            const last = msgs[msgs.length - 1];
            if (last?.role === "output") {
              msgs[msgs.length - 1] = { ...last, parts: [...outputParts] };
            } else {
              msgs.push({ role: "output", parts: [...outputParts], time: new Date() });
            }
            return { ...prev, [sandboxId]: msgs };
          });
        }
      }
    } catch (err) {
      setChatMessages((prev) => {
        const msgs = [...(prev[sandboxId] || [])];
        msgs.push({ role: "output", parts: [{ type: "error", error: err.message }], time: new Date() });
        return { ...prev, [sandboxId]: msgs };
      });
    }

    delete chatAbortRef.current[sandboxId];
    setChatStreaming((prev) => ({ ...prev, [sandboxId]: false }));
  }, [chatStreaming]);

  // ── Chat send ──

  const sendChat = useCallback(async (sandboxId, message) => {
    if (!message.trim() || chatStreaming[sandboxId]) return;

    if (message.startsWith("!") || cmdMode) {
      const cmd = message.startsWith("!") ? message.slice(1).trim() : message.trim();
      if (cmd) await execCommand(sandboxId, cmd);
      return;
    }

    setChatMessages((prev) => ({
      ...prev,
      [sandboxId]: [...(prev[sandboxId] || []), { role: "user", parts: [{ type: "text", text: message }], time: new Date() }],
    }));
    setChatStreaming((prev) => ({ ...prev, [sandboxId]: true }));

    const ac = new AbortController();
    chatAbortRef.current[sandboxId] = ac;

    const assistantParts = [];
    let currentText = "";

    const flush = () => {
      const snapshot = [...assistantParts];
      if (currentText) snapshot.push({ type: "text", text: currentText });
      setChatMessages((prev) => {
        const msgs = [...(prev[sandboxId] || [])];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") {
          msgs[msgs.length - 1] = { ...last, parts: snapshot };
        } else {
          msgs.push({ role: "assistant", parts: snapshot, time: new Date() });
        }
        return { ...prev, [sandboxId]: msgs };
      });
    };

    try {
      const res = await fetch(`${API}/api/chat/${sandboxId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: ac.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lastComplete = buffer.lastIndexOf("\n\n");
        if (lastComplete === -1) continue;
        const complete = buffer.slice(0, lastComplete + 2);
        buffer = buffer.slice(lastComplete + 2);
        const events = parseSSE(complete);

        for (const ev of events) {
          switch (ev.event) {
            case "text":
              currentText += ev.data.text;
              flush();
              break;
            case "tool-call":
              if (currentText) {
                assistantParts.push({ type: "text", text: currentText });
                currentText = "";
              }
              assistantParts.push({ type: "tool-call", tool: ev.data.tool });
              flush();
              break;
            case "tool-result":
              assistantParts.push({ type: "tool-result", result: ev.data.result });
              flush();
              break;
            case "error":
              assistantParts.push({ type: "error", error: ev.data.error });
              flush();
              break;
          }
        }
      }

      if (currentText) {
        assistantParts.push({ type: "text", text: currentText });
        currentText = "";
        flush();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        assistantParts.push({ type: "error", error: err.message });
        flush();
      }
    }

    delete chatAbortRef.current[sandboxId];
    setChatStreaming((prev) => ({ ...prev, [sandboxId]: false }));
  }, [chatStreaming, cmdMode]);

  // ── Derived state ──

  const anyRunning = Object.values(statuses).some((s) => s === "running");
  const filtered = sandboxes.filter(({ sandboxId, email }) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return sandboxId.toLowerCase().includes(q) || email.toLowerCase().includes(q);
  }).sort((a, b) => {
    const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
    const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
    return tb - ta;
  });

  const selectedEntry = sandboxes.find((s) => s.sandboxId === selected);
  const selectedLogs = selected ? logs[selected] || [] : [];
  const selectedChat = selected ? chatMessages[selected] || [] : [];
  const currentTab = selected ? getTab(selected) : "chat";
  const logPhaseSet = new Set(selectedLogs.map(l => l.phase).filter(Boolean));
  const selectedPhaseStates = selected ? phaseStates[selected] || {} : {};

  // ── Render ──

  return h("div", { style: { display: "flex", height: "100vh" } },
    h("div", {
      style: {
        flex: 1, overflow: "auto",
        marginRight: selected ? panelWidth + "px" : "0",
        transition: "margin-right 0.15s ease",
      },
    },
      h("div", { style: { maxWidth: "960px", margin: "0 auto", padding: "32px 24px" } },
        h(Header, {
          search, setSearch,
          filtered: filtered.length, total: sandboxes.length,
          reloadSandboxes, anyRunning, stopAll, updateAll,
          envProfile, envProfiles, envFiles, envSwitching, switchEnv,
        }),
        h(SandboxTable, {
          filtered, selected, setSelected, statuses, phases, getStatus, updateOne, stopOne, setTab, loading,
        }),
      ),
    ),

    selected && h(SlidePanel, {
      selected, selectedEntry, panelWidth, setPanelWidth,
      currentTab, setTab: (t) => setTab((prev) => ({ ...prev, [selected]: t })),
      getStatus, phases,
      logs: selectedLogs, logContainerRef,
      logPhaseSet, phaseStates: selectedPhaseStates, hoveredPhase, setHoveredPhase, activePhase, setActivePhase,
      pm2Logs, pm2Process, setPm2Process, pm2Loading, pm2Auto, setPm2Auto, fetchPm2Logs, pm2LogRef,
      chatMessages: selectedChat, chatStreaming, chatInput, setChatInput, cmdMode, setCmdMode, sendChat, stopChat, expandedTools, setExpandedTools, inputRef,
      onClose: () => setSelected(null),
    }),

    h(Tooltip, {
      id: "tt",
      style: {
        background: "var(--bg-3)", color: "var(--text-0)",
        fontSize: "11px", padding: "4px 8px", borderRadius: "4px",
        fontFamily: "'JetBrains Mono', monospace",
        zIndex: 1000, maxWidth: "320px",
      },
      opacity: 1,
      delayShow: 300,
    }),

    // ── Toasts ──
    toasts.length > 0 && h("div", {
      style: {
        position: "fixed", bottom: "16px", right: "16px", zIndex: 2000,
        display: "flex", flexDirection: "column", gap: "8px",
        maxWidth: "400px",
      },
    },
      toasts.map((t) => h("div", {
        key: t.id,
        onClick: () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
        style: {
          background: t.type === "error" ? "var(--red-bg)" : "var(--bg-3)",
          border: `1px solid ${t.type === "error" ? "var(--red)" : "var(--border)"}`,
          color: t.type === "error" ? "var(--red)" : "var(--text-0)",
          padding: "8px 12px", borderRadius: "6px",
          fontSize: "12px", lineHeight: "1.4",
          fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer",
          animation: "toastIn 0.15s ease-out",
        },
      }, t.message)),
    ),
  );
}
