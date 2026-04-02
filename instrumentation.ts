export async function register() {
  // Only run on the server (not edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { replenishPool } = await import("@/lib/sandbox");
    replenishPool().catch((err) => {
      console.error("Failed to replenish sandbox pool on startup:", err);
    });
  }
}
