import type { NextConfig } from "next";
import { MASTRA_API_PREFIX } from "./lib/mastra-constants";

const nextConfig: NextConfig = {
  ...(process.env.VERCEL_URL && { allowedDevOrigins: [process.env.VERCEL_URL] }),
  outputFileTracingIncludes: {
    // lib/sandbox.ts reads the scheduler skill from disk when provisioning.
    // Trace the file so Vercel ships it with the serverless bundle.
    // lib/project-bootstrap.ts spawns `manage/resolve-merge.mts` via tsx
    // on merge conflict — include the manage sources, the script entry,
    // the tsx binary, and tsconfig.json so the child process can resolve
    // path aliases (`@/lib/...`) when loading transitive imports from
    // `lib/projects/repo.ts` and friends. Without tsconfig in the trace
    // the child silently fails to resolve `@/lib/db`.
    "/**": [
      "./lib/skills/**/*.md",
      "./manage/**/*.mts",
      "./manage/**/*.mjs",
      "./node_modules/tsx/**",
      "./node_modules/.bin/tsx",
      "./tsconfig.json",
    ],
  },
  env: {
    MASTRA_API_PREFIX,
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
