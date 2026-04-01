import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
