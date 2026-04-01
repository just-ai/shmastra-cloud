"use client";

import { useEffect, useState } from "react";
import { EmailCodeSignIn } from "./email-code-sign-in";

function EmailCodeSignInPlaceholder() {
  return (
    <section className="mt-8 w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-6 py-7 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur md:mt-0">
      <div className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
        <span className="status-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        sign in to start
      </div>
      <div className="h-8 w-3/4 rounded bg-white/4" />
      <div className="mt-3 h-12 rounded bg-white/3" />
      <div className="mt-7 h-11 rounded bg-white/4" />
      <div className="mt-3 h-10 rounded bg-white/4" />
    </section>
  );
}

export function EmailCodeSignInShell() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <EmailCodeSignInPlaceholder />;
  }

  return <EmailCodeSignIn />;
}
