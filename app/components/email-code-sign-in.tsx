"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  requestMagicCode,
  verifyMagicCode,
} from "@/app/login/actions";
import type { EmailCodeActionState } from "@/app/login/actions";

const initialEmailCodeActionState: EmailCodeActionState = {
  email: "",
  step: "email",
};

function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function EmailCodeSignIn() {
  const [sendState, sendAction] = useActionState(
    requestMagicCode,
    initialEmailCodeActionState,
  );
  const [verifyState, verifyAction] = useActionState(
    verifyMagicCode,
    initialEmailCodeActionState,
  );
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [codeInputKey, setCodeInputKey] = useState(0);

  useEffect(() => {
    if (sendState.step === "code") {
      setEmail(sendState.email);
      setStep("code");
      setCodeInputKey((current) => current + 1);
    }
  }, [sendState.email, sendState.step]);

  const status = useMemo(() => {
    if (step === "email") {
      return {
        error: sendState.error,
        message: sendState.message,
      };
    }

    return {
      error: verifyState.error,
      message: verifyState.message || sendState.message,
    };
  }, [sendState.error, sendState.message, step, verifyState.error, verifyState.message]);

  return (
    <section className="mt-8 w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-6 py-7 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur md:mt-0">
      <div className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
        <span className="status-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        Sign in to start
      </div>

      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
        Enter your email and sign-in with one time code
      </p>

      {step === "email" ? (
        <form action={sendAction} className="mt-7 space-y-3">
          <div className="space-y-2">
            <label
              htmlFor="magic-auth-email"
              className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]"
            >
              Email
            </label>
            <input
              id="magic-auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="h-11 w-full rounded-md border border-[var(--panel-border-strong)] bg-black/20 px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
            />
          </div>

          {status.error ? (
            <p className="text-xs text-[#ff8a8a]">{status.error}</p>
          ) : null}

          <SubmitButton
            pendingLabel="Sending code..."
            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--panel-border-strong)] bg-white/4 px-4 text-xs font-medium tracking-[0.02em] text-white transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign in
          </SubmitButton>
        </form>
      ) : (
        <div className="mt-7 space-y-4">
          <div className="rounded-md border border-[var(--panel-border)] bg-black/10 px-3 py-2 text-xs text-[var(--text-secondary)]">
            Code sent to <span className="text-[var(--text-primary)]">{email}</span>
          </div>

          <form action={verifyAction} className="space-y-3">
            <input type="hidden" name="email" value={email} />
            <div className="space-y-2">
              <label
                htmlFor="magic-auth-code"
                className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]"
              >
                One-time code
              </label>
              <input
                key={codeInputKey}
                id="magic-auth-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                className="h-11 w-full rounded-md border border-[var(--panel-border-strong)] bg-black/20 px-3 text-sm tracking-[0.18em] text-[var(--text-primary)] outline-none transition placeholder:tracking-normal placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
              />
            </div>

            {status.error ? (
              <p className="text-xs text-[#ff8a8a]">{status.error}</p>
            ) : null}

            {status.message ? (
              <p className="text-xs text-[var(--text-secondary)]">
                {status.message}
              </p>
            ) : null}

            <SubmitButton
              pendingLabel="Signing in..."
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--panel-border-strong)] bg-white/4 px-4 text-xs font-medium tracking-[0.02em] text-white transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enter workspace
            </SubmitButton>
          </form>

          <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-tertiary)]">
            <form action={sendAction}>
              <input type="hidden" name="email" value={email} />
              <SubmitButton
                pendingLabel="Resending..."
                className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--panel-border)] bg-transparent px-3 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resend code
              </SubmitButton>
            </form>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCodeInputKey((current) => current + 1);
              }}
              className="text-[11px] text-[var(--text-tertiary)] transition hover:text-[var(--accent)]"
            >
              Use another email
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
