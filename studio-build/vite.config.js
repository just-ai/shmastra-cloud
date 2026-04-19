import { defineConfig } from "vite";
import { readFileSync, writeFileSync, cpSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

// Load local overrides first, then fall back to .env defaults.
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

// Build-time defaults for MASTRA_* variables (same as next.config.ts env)
const mastraDefaults = {
  MASTRA_SERVER_HOST: "__SANDBOX_HOST__",
  MASTRA_SERVER_PORT: "443",
  MASTRA_SERVER_PROTOCOL: "https",
  MASTRA_API_PREFIX: "/api/mastra",
  MASTRA_STUDIO_BASE_PATH: "/studio",
  MASTRA_AUTO_DETECT_URL: "false",
  MASTRA_TELEMETRY_DISABLED: "true",
  MASTRA_HIDE_CLOUD_CTA: "true",
  MASTRA_TEMPLATES: "false",
  MASTRA_CLOUD_API_ENDPOINT: "",
  MASTRA_EXPERIMENTAL_FEATURES: "false",
  MASTRA_THEME_TOGGLE: "true",
  MASTRA_REQUEST_CONTEXT_PRESETS: "",
};

const studioEnv = { ...mastraDefaults, ...process.env };

const studioSrc = resolve(__dirname, "../node_modules/mastra/dist/studio");
const studioDest = resolve(__dirname, "../public/studio");
const keepaliveSrc = resolve(__dirname, "keepalive.js");
const keepaliveDest = resolve(studioDest, "keepalive.js");
const logoutButtonSrc = resolve(__dirname, "logout-button.js");
const logoutButtonDest = resolve(studioDest, "logout-button.js");
const shmastraScriptTag =
  '<script src="/shmastra/public/script/shmastra.js"></script>';
const keepaliveScriptTag =
  '<script src="/studio/keepalive.js" defer></script>';
const logoutButtonScriptTag =
  '<script src="/studio/logout-button.js" defer></script>';

export default defineConfig({
  plugins: [
    {
      name: "copy-studio-assets",
      buildStart() {
        if (!existsSync(studioSrc)) {
          console.warn(
            `Warning: ${studioSrc} does not exist. Skipping studio copy.`,
          );
          return;
        }

        // Copy all studio assets to public/studio
        cpSync(studioSrc, studioDest, { recursive: true });
        cpSync(keepaliveSrc, keepaliveDest);
        cpSync(logoutButtonSrc, logoutButtonDest);

        // Replace %%PLACEHOLDER%% patterns in index.html
        const indexPath = resolve(studioDest, "index.html");
        if (existsSync(indexPath)) {
          let html = readFileSync(indexPath, "utf-8");

          // Replace all %%MASTRA_*%% placeholders with env values
          html = html.replace(/%%([A-Z_]+)%%/g, (match, key) => {
            return studioEnv[key] || "";
          });

          // Studio HTML has no %%MASTRA_AUTH_TOKEN%% placeholder — inject a
          // dedicated script that sets window.MASTRA_AUTH_TOKEN. Runtime value
          // (`__MASTRA_AUTH_TOKEN__`) is substituted per-user in app/studio/route.ts.
          // Must appear in <head> before shmastra.js, which reads the token to
          // patch fetch before Studio makes any requests.
          const authTokenScriptTag =
            '<script>window.MASTRA_AUTH_TOKEN = "__MASTRA_AUTH_TOKEN__";</script>';
          if (!html.includes(authTokenScriptTag)) {
            html = html.includes("</head>")
              ? html.replace("</head>", `  ${authTokenScriptTag}\n</head>`)
              : `${authTokenScriptTag}\n${html}`;
          }

          // Insert shmastra.js in <head> AFTER the auth-token script so
          // window.MASTRA_AUTH_TOKEN is defined by the time the auth-fetch
          // patch runs.
          if (!html.includes(shmastraScriptTag)) {
            html = html.includes("</head>")
              ? html.replace("</head>", `  ${shmastraScriptTag}\n</head>`)
              : `${html}\n${shmastraScriptTag}\n`;
          }

          if (!html.includes(keepaliveScriptTag)) {
            html = html.includes("</body>")
              ? html.replace("</body>", `  ${keepaliveScriptTag}\n</body>`)
              : `${html}\n${keepaliveScriptTag}\n`;
          }

          if (!html.includes(logoutButtonScriptTag)) {
            html = html.includes("</body>")
              ? html.replace("</body>", `  ${logoutButtonScriptTag}\n</body>`)
              : `${html}\n${logoutButtonScriptTag}\n`;
          }

          writeFileSync(indexPath, html);
          console.log("Studio assets copied and placeholders replaced.");
        }
      },
    },
  ],
  // We're only using this config for the plugin side-effect
  build: {
    // No actual build output needed — just the copy plugin
    lib: {
      entry: resolve(__dirname, "empty.js"),
      formats: ["es"],
    },
    outDir: resolve(__dirname, "../.studio-build-tmp"),
    emptyOutDir: true,
  },
});
