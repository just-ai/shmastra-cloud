"use client";

import { useState, type FormEvent } from "react";
import { SandboxSetup } from "./sandbox-setup";

interface Props {
  envKeys: string[];
  returnTo: string;
}

// Form shown when the user is being restored onto a fresh sandbox and the
// previous sandbox left a manifest of `.env` keys behind. Values are sent
// to /api/sandbox/provision once and never persisted client-side after the
// component unmounts (the SandboxSetup view replaces this one).
export function RestoreProjectForm({ envKeys, returnTo }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(envKeys.map((k) => [k, ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envValues: values }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error((detail as { error?: string }).error || `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
    }
  };

  if (submitted) {
    return <SandboxSetup returnTo={returnTo} initialStatus="creating" />;
  }

  return (
    <main className="screen-grid flex min-h-screen items-center justify-center px-6 py-10">
      <section className="flex w-full max-w-2xl flex-col">
        <div className="flex items-center gap-3">
          <span className="status-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_16px_rgba(135,247,166,0.7)]" />
          <div className="shimmer-text text-[10px] uppercase tracking-[0.34em] text-transparent">
            restoring shmastra workspace
          </div>
        </div>
        <h1 className="mt-8 text-2xl font-medium leading-10 tracking-[-0.06em] text-[var(--text-primary)] sm:text-[32px]">
          Restore your project
        </h1>
        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
          Your previous workspace stored these secrets in <code className="text-[var(--text-primary)]">.env</code>.
          Provide them again to bring the project back online. Values are sent
          straight to your new sandbox and never stored on our side.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          {envKeys.map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                {key}
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={values[key] ?? ""}
                onChange={(e) => handleChange(key, e.target.value)}
                className="rounded-md border border-[var(--panel-border)] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          ))}

          {error && (
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--panel-border)] bg-black/30 px-3 py-2 font-mono text-[12px] leading-5 text-[#ff8f8f]">
              {error}
            </pre>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-md border border-[var(--panel-border)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-50"
          >
            {submitting ? "restoring…" : "restore project"}
          </button>
        </form>
      </section>
    </main>
  );
}
