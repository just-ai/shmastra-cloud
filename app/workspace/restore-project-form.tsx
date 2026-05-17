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
      <section className="flex w-full max-w-3xl flex-col items-center text-center">
        <div className="w-full max-w-2xl text-left">
          <div className="flex items-center gap-3">
            <span className="status-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_16px_rgba(135,247,166,0.7)]" />
            <div className="shimmer-text text-[10px] uppercase tracking-[0.34em] text-transparent">
              restoring shmastra workspace
            </div>
          </div>

          <h1 className="mt-8 max-w-2xl text-2xl font-medium leading-10 tracking-[-0.06em] text-[var(--text-primary)] sm:text-[32px]">
            Hand back the secrets your project needs to start
          </h1>
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            values are sent straight to your new sandbox — nothing is stored on our side
          </p>

          <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-5">
            {envKeys.map((key) => (
              <label key={key} className="flex flex-col gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
                  {key}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={values[key] ?? ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="rounded-md border border-[var(--panel-border)] bg-black/30 px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-primary)] outline-none transition focus:border-[var(--panel-border-strong)] focus:bg-black/40"
                />
              </label>
            ))}

            {error && (
              <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--panel-border)] bg-black/30 px-3 py-2 font-mono text-[12px] leading-5 text-[var(--text-tertiary)]">
                {error}
              </pre>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={`mt-2 self-start rounded-md border border-[var(--panel-border-strong)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition hover:bg-[color-mix(in_srgb,var(--accent)_24%,transparent)] disabled:cursor-not-allowed ${submitting ? "shimmer-text" : "text-[var(--accent)]"}`}
            >
              {submitting ? "restoring…" : "restore"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
