import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.VERCEL_URL && { allowedDevOrigins: [process.env.VERCEL_URL] }),
  env: {
    MASTRA_API_PREFIX: "/api/mastra",
    MASTRA_STUDIO_BASE_PATH: "/studio",
    MASTRA_AUTO_DETECT_URL: "true",
    MASTRA_TELEMETRY_DISABLED: "true",
    MASTRA_HIDE_CLOUD_CTA: "true",
    MASTRA_TEMPLATES: "false",
    MASTRA_CLOUD_API_ENDPOINT: "",
    MASTRA_EXPERIMENTAL_FEATURES: "false",
    MASTRA_REQUEST_CONTEXT_PRESETS: "",
  },
  rewrites: async () => [
    {
      source: "/studio/:path((?!_next|assets|favicon).*)",
      destination: "/studio",
      has: [
        {
          type: "header",
          key: "accept",
          value: ".*text/html.*",
        },
      ],
    },
  ],
};

export default nextConfig;
