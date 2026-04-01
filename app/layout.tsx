import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shmastra",
  description: "Vibe-code AI agents and workflows right inside Mastra Studio",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
