export default function UnavailablePage() {
  return (
    <main className="screen-grid flex min-h-screen items-center justify-center px-6 py-10">
      <section className="flex w-full max-w-3xl flex-col items-center text-center">
        <div className="w-full max-w-2xl text-left">
          <div className="flex items-center gap-3">
            <span className="status-dot h-1.5 w-1.5 rounded-full bg-[#ff8f8f] shadow-[0_0_16px_rgba(255,143,143,0.7)]" />
            <div className="shimmer-text text-[10px] uppercase tracking-[0.34em] text-transparent">
              app not found
            </div>
          </div>
          <p className="mt-8 max-w-2xl text-2xl font-medium leading-10 tracking-[-0.06em] text-[var(--text-primary)] sm:text-[32px]">
            This shared app link doesn&apos;t exist.
          </p>
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            double-check the URL or ask the owner for a new one
          </p>
        </div>
      </section>
    </main>
  );
}
