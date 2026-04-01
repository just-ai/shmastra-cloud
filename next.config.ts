import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
      source: "/studio",
      destination: "/studio/index.html",
    },
    {
      source: "/studio/:path((?!_next|assets|favicon).*)",
      destination: "/studio/index.html",
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
