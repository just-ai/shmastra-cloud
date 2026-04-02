"use client";

import { useEffect, useState } from "react";

const SHMASTRA_CAPABILITIES = [
  "Vibe-code agents and workflows right inside Mastra Studio.",
  "Discover tools, MCP servers, and integrations without leaving the chat flow.",
  "Iterate on prompts, tools, and multi-agent behavior without local setup.",
  "Stay in the browser while Shmastra prepares the workspace around your ideas.",
];

export function SandboxSetup({
  error: initialError,
  returnTo = "/studio",
}: {
  error?: string | null;
  returnTo?: string;
}) {
  const [status, setStatus] = useState(initialError ? "error" : "creating");
  const [errorMessage, setErrorMessage] = useState(initialError || "");
  const [capabilityIndex, setCapabilityIndex] = useState(0);

  useEffect(() => {
    if (status !== "creating") return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch("/api/sandbox/status", { cache: "no-store" });
        const data = await res.json();

        if (data.status === "ready") {
          clearInterval(intervalId);
          window.location.href = returnTo;
          return;
        }

        if (data.status === "error") {
          clearInterval(intervalId);
          setStatus("error");
          setErrorMessage(data.errorMessage || "Unknown error");
        }
      } catch {
        // Ignore fetch errors and retry on next interval.
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [returnTo, status]);

  useEffect(() => {
    if (status !== "creating") return;

    const intervalId = window.setInterval(() => {
      setCapabilityIndex((current) => (current + 1) % SHMASTRA_CAPABILITIES.length);
    }, 4200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status]);

  async function handleRetry() {
    setStatus("creating");
    setErrorMessage("");
    await fetch("/api/sandbox/retry", { method: "POST" });
  }

  return (
    <main className="screen-grid flex min-h-screen items-center justify-center px-6 py-10">
      <section className="flex w-full max-w-3xl flex-col items-center text-center">
        {status === "creating" && (
          <div className="w-full max-w-2xl text-left">
            <div className="flex items-center gap-3">
              <span className="status-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_16px_rgba(135,247,166,0.7)]" />
              <div className="shimmer-text text-[10px] uppercase tracking-[0.34em] text-transparent">
                preparing shmastra workspace
              </div>
            </div>
            <p className="mt-8 max-w-2xl text-2xl font-medium leading-10 tracking-[-0.06em] text-[var(--text-primary)] transition duration-700 sm:text-[32px]">
              {SHMASTRA_CAPABILITIES[capabilityIndex]}
            </p>
            <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              studio opens automatically when everything is ready
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-6 py-7 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#ff8f8f]">
              workspace error
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
              We could not prepare your Shmastra workspace yet: {errorMessage}
            </p>
            <button
              onClick={handleRetry}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-[var(--panel-border-strong)] bg-white/4 px-4 text-xs font-medium tracking-[0.02em] text-white transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Retry workspace launch
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
