import Link from "next/link";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";

export default async function Home() {
  const { user } = await withAuth();

  if (user) {
    redirect("/workspace");
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.hero}>
          <div style={styles.badge}>Shmastra Cloud</div>
          <h1 style={styles.title}>
            Build Mastra agents from a clean, shared cloud workspace.
          </h1>
          <p style={styles.subtitle}>
            Spin up your sandbox, open Studio, and work from a hosted environment
            without local setup. Sign in with your Just AI email when you are
            ready.
          </p>

          <div style={styles.actions}>
            <Link href="/login" style={styles.primaryButton}>
              Authorize by Email
            </Link>
          </div>

          <div style={styles.featureGrid}>
            <div style={styles.featureCard}>
              <div style={styles.featureTitle}>Hosted sandbox</div>
              <p style={styles.featureText}>
                Your Mastra environment runs in E2B and resumes automatically
                when you come back.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureTitle}>Studio-first workflow</div>
              <p style={styles.featureText}>
                Use a polished browser-based flow instead of dropping straight
                into an auth redirect.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureTitle}>Key-safe proxying</div>
              <p style={styles.featureText}>
                Provider keys stay on the app side while the sandbox uses
                virtual credentials.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(99, 102, 241, 0.18), transparent 30%), linear-gradient(180deg, #09090f 0%, #111325 55%, #161833 100%)",
    color: "#fff",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  shell: {
    width: "100%",
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "56px 24px 80px",
  },
  hero: {
    maxWidth: "860px",
    margin: "0 auto",
    textAlign: "center" as const,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#c7d2fe",
    fontSize: "13px",
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  title: {
    fontSize: "clamp(42px, 7vw, 76px)",
    lineHeight: 1.02,
    fontWeight: 800,
    letterSpacing: "-0.04em",
    margin: "24px 0 18px",
  },
  subtitle: {
    maxWidth: "720px",
    margin: "0 auto",
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: "18px",
    lineHeight: 1.7,
  },
  actions: {
    display: "flex",
    justifyContent: "center",
    marginTop: "32px",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "15px 22px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 700,
    textDecoration: "none",
    boxShadow: "0 18px 50px rgba(99, 102, 241, 0.28)",
  },
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "18px",
    marginTop: "72px",
  },
  featureCard: {
    padding: "22px",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    backdropFilter: "blur(16px)",
    textAlign: "left" as const,
  },
  featureTitle: {
    fontSize: "16px",
    fontWeight: 700,
    marginBottom: "10px",
  },
  featureText: {
    margin: 0,
    color: "rgba(255, 255, 255, 0.68)",
    fontSize: "14px",
    lineHeight: 1.6,
  },
};
