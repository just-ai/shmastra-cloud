"use client";

import { useEffect, useState } from "react";

const SHMASTRA_CAPABILITIES = [
  "Vibe-code agents and workflows right inside Mastra Studio.",
  "Discover tools, MCP servers, and integrations without leaving the chat flow.",
  "Iterate on prompts, tools, and multi-agent behavior without local setup.",
  "Stay in the browser while Shmastra prepares the workspace around your ideas.",
];

const HEALING_MESSAGES = [
  "Your workspace hit a snag — Shmastra is patching things up.",
  "Restarting the Mastra runtime and verifying it comes back clean.",
  "Inspecting recent edits and clearing whatever wedged the process.",
  "Hang tight — studio reopens automatically once the sandbox is healthy.",
];

type Mode = "creating" | "healing" | "error";

type ServerStatus =
  | "creating"
  | "healing"
  | "ready"
  | "error"
  | "broken"
  | "no_user";

function modeFor(status: ServerStatus): Mode {
  if (status === "healing") return "healing";
  if (status === "error" || status === "broken") return "error";
  return "creating";
}

export function SandboxSetup({
  error: initialError,
  returnTo = "/studio",
  initialStatus,
}: {
  error?: string | null;
  returnTo?: string;
  initialStatus?: ServerStatus;
}) {
  const initialMode: Mode = initialError
    ? "error"
    : initialStatus
      ? modeFor(initialStatus)
      : "creating";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [errorMessage, setErrorMessage] = useState(initialError || "");
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (mode === "error") return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/sandbox/status", { cache: "no-store" });
        const data = (await res.json()) as {
          status: ServerStatus;
          errorMessage?: string;
        };

        if (cancelled) return;

        if (data.status === "ready") {
          window.location.href = returnTo;
          return;
        }

        if (data.status === "error" || data.status === "broken") {
          setMode("error");
          setErrorMessage(data.errorMessage || "");
          return;
        }

        const nextMode = modeFor(data.status);
        if (nextMode !== mode) {
          setMode(nextMode);
          setMessageIndex(0);
        }
      } catch {
        if (cancelled) return;
        // Ignore fetch errors and retry after the current attempt settles.
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, 2000);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [returnTo, mode]);

  useEffect(() => {
    if (mode === "error") return;

    const intervalId = window.setInterval(() => {
      const total =
        mode === "healing"
          ? HEALING_MESSAGES.length
          : SHMASTRA_CAPABILITIES.length;
      setMessageIndex((current) => (current + 1) % total);
    }, 4200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [mode]);

  const isHealing = mode === "healing";
  const messages = isHealing ? HEALING_MESSAGES : SHMASTRA_CAPABILITIES;
  const headlineLabel = isHealing
    ? "healing shmastra workspace"
    : "preparing shmastra workspace";
  const footerLabel = isHealing
    ? "studio reopens automatically once the sandbox is healthy"
    : "studio opens automatically when everything is ready";
  const dotColor = isHealing
    ? "bg-[#ffb86b] shadow-[0_0_16px_rgba(255,184,107,0.7)]"
    : "bg-[var(--accent)] shadow-[0_0_16px_rgba(135,247,166,0.7)]";

  return (
    <main className="screen-grid flex min-h-screen items-center justify-center px-6 py-10">
      <section className="flex w-full max-w-3xl flex-col items-center text-center">
        {mode !== "error" && (
          <div className="w-full max-w-2xl text-left">
            <div className="flex items-center gap-3">
              <span className={`status-dot h-1.5 w-1.5 rounded-full ${dotColor}`} />
              <div className="shimmer-text text-[10px] uppercase tracking-[0.34em] text-transparent">
                {headlineLabel}
              </div>
            </div>
            <p className="mt-8 max-w-2xl text-2xl font-medium leading-10 tracking-[-0.06em] text-[var(--text-primary)] transition duration-700 sm:text-[32px]">
              {messages[messageIndex % messages.length]}
            </p>
            <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              {footerLabel}
            </p>
          </div>
        )}

        {mode === "error" && (
          <div className="w-full max-w-2xl text-left">
            <div className="flex items-center gap-3">
              <span className="status-dot h-1.5 w-1.5 rounded-full bg-[#ff8f8f] shadow-[0_0_16px_rgba(255,143,143,0.7)]" />
              <div className="shimmer-text text-[10px] uppercase tracking-[0.34em] text-transparent">
                workspace unavailable
              </div>
            </div>
            <p className="mt-8 max-w-2xl text-2xl font-medium leading-10 tracking-[-0.06em] text-[var(--text-primary)] sm:text-[32px]">
              Please reach out to an administrator to fix this issue
            </p>
            {errorMessage && (
              <pre className="mt-6 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--panel-border)] bg-black/30 px-3 py-2 font-mono text-[12px] leading-5 text-[var(--text-tertiary)]">
                {errorMessage}
              </pre>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
