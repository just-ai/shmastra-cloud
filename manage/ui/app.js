import { createElement as h, useState, useEffect, useRef, useCallback } from "react";
import { API, parseSSE } from "./utils.js";
import { Header } from "./components/header.js";
import { SandboxTable } from "./components/sandbox-table.js";
import { SlidePanel } from "./components/slide-panel.js";

export function App() {
  const [sandboxes, setSandboxes] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [phases, setPhases] = useState({});
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

  // PM2 logs state
  const [pm2Logs, setPm2Logs] = useState({});
  const [pm2Process, setPm2Process] = useState("all");
  const [pm2Loading, setPm2Loading] = useState(false);
  const [pm2Auto, setPm2Auto] = useState(false);
  const pm2IntervalRef = useRef(null);
  const pm2LogRef = useRef(null);

  // ── Data fetching ──

  useEffect(() => {
    fetch(`${API}/api/sandboxes`)
      .then((r) => r.json())
      .then((entries) => { setSandboxes(entries); setLoading(false); })
      .catch(() => setLoading(false));
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
      const { sandboxId, phase } = JSON.parse(e.data);
      setPhases((prev) => ({ ...prev, [sandboxId]: phase }));
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
    fetch(`${API}/api/sandboxes`)
      .then((r) => r.json())
      .then((entries) => setSandboxes(entries))
      .catch(() => {});
  }, []);

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
  const lastLogPhase = selectedLogs.length ? [...selectedLogs].reverse().find(l => l.phase)?.phase : null;

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
      logPhaseSet, lastLogPhase, hoveredPhase, setHoveredPhase, activePhase, setActivePhase,
      pm2Logs, pm2Process, setPm2Process, pm2Loading, pm2Auto, setPm2Auto, fetchPm2Logs, pm2LogRef,
      chatMessages: selectedChat, chatStreaming, chatInput, setChatInput, cmdMode, setCmdMode, sendChat, stopChat, expandedTools, setExpandedTools, inputRef,
      onClose: () => setSelected(null),
    }),
  );
}
