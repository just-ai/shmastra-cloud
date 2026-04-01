import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { EmailCodeSignInShell } from "./components/email-code-sign-in-shell";

export default async function Home() {
  const { user } = await withAuth();

  if (user) {
    redirect("/workspace");
  }

  return (
    <main className="screen-grid relative flex min-h-screen flex-col overflow-hidden px-6 py-5">
      <header className="flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-2">
          <span className="status-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <a target="_blank" href="https://github.com/just-ai/shmastra">Fork on Githib</a>
        </span>
        <span></span>
      </header>

      <div className="flex flex-1 items-center justify-center py-6">
        <section className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(320px,420px)] md:items-center lg:gap-14">
          <div className="flex flex-col items-start text-left">
            <h1 className="text-[32px] font-semibold tracking-[-0.07em] text-[var(--accent)] sm:text-[40px] lg:text-[48px]">
              Shmastra Cloud
            </h1>

            <p className="shimmer-text mt-5 max-w-2xl text-balance text-sm leading-7 sm:text-base">
              Vibe-code any AI agents and workflows right in the web: describe what you need in chat, Shmastra wires tools and
              integrations, skipping the usual IDE, boilerplate, and setup overhead.
            </p>
          </div>

          <div className="w-full md:justify-self-end">
            <EmailCodeSignInShell />
          </div>
        </section>
      </div>

      <footer className="flex justify-center text-[10px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
        created in 2026 by <a href="https://just-ai.com" target="_blank" className="ml-1">Just AI</a>
      </footer>
    </main>
  );
}
