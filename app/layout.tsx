import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shmastra Cloud",
  description: "Mastra Studio in the cloud",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
