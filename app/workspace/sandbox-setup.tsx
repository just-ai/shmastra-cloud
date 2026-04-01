"use client";

import { useEffect, useState } from "react";

export function SandboxSetup({
  error: initialError,
  returnTo = "/studio",
}: {
  error?: string | null;
  returnTo?: string;
}) {
  const [status, setStatus] = useState(initialError ? "error" : "creating");
  const [errorMessage, setErrorMessage] = useState(initialError || "");

  useEffect(() => {
    if (status !== "creating") return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/sandbox/status", { cache: "no-store" });
        const data = await res.json();

        if (cancelled) return;

        if (data.status === "ready") {
          window.location.href = returnTo;
          return;
        }

        if (data.status === "error") {
          setStatus("error");
          setErrorMessage(data.errorMessage || "Unknown error");
          return;
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
  }, [returnTo, status]);

  async function handleRetry() {
    setStatus("creating");
    setErrorMessage("");
    await fetch("/api/sandbox/retry", { method: "POST" });
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Shmastra Cloud</h1>

        {status === "creating" && (
          <>
            <div style={styles.spinner} />
            <p style={styles.text}>Setting up your environment...</p>
            <p style={styles.subtext}>This may take up to a minute</p>
          </>
        )}

        {status === "error" && (
          <>
            <p style={styles.errorText}>
              Something went wrong: {errorMessage}
            </p>
            <button onClick={handleRetry} style={styles.button}>
              Retry
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: "#1e1e3a",
    borderRadius: "16px",
    padding: "48px",
    width: "100%",
    maxWidth: "420px",
    textAlign: "center" as const,
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: {
    color: "#fff",
    fontSize: "28px",
    fontWeight: 700,
    margin: "0 0 24px",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "3px solid rgba(255, 255, 255, 0.1)",
    borderTop: "3px solid #8b5cf6",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    margin: "0 auto 16px",
  },
  text: {
    color: "#fff",
    fontSize: "16px",
    margin: "0 0 8px",
  },
  subtext: {
    color: "#9e9ec0",
    fontSize: "13px",
    margin: 0,
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: "14px",
    margin: "0 0 16px",
  },
  button: {
    padding: "12px 24px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
