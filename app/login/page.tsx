import { startSignIn } from "./actions";

export default function LoginPage() {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Shmastra Cloud</h1>
        <p style={styles.subtitle}>Continue to WorkOS to sign in with email</p>

        <form action={startSignIn} style={styles.form}>
          <button type="submit" style={styles.buttonLink}>
            Continue with Email
          </button>
        </form>

        <p style={styles.footnote}>
          Authentication happens on WorkOS&apos;s hosted AuthKit page, then you
          will be sent back to your workspace.
        </p>
      </div>
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
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: {
    color: "#fff",
    fontSize: "28px",
    fontWeight: 700,
    margin: "0 0 8px",
    textAlign: "center" as const,
  },
  subtitle: {
    color: "#9e9ec0",
    fontSize: "14px",
    margin: "0 0 32px",
    textAlign: "center" as const,
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
  },
  buttonLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "14px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    textDecoration: "none",
    cursor: "pointer",
  },
  footnote: {
    color: "#7f82ad",
    fontSize: "12px",
    margin: "16px 0 0",
    textAlign: "center" as const,
    lineHeight: 1.5,
  },
};
