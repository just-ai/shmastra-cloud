import { defineConfig } from "vite";
import { readFileSync, writeFileSync, cpSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import { MASTRA_API_PREFIX } from "../lib/mastra-constants";

// Load local overrides first, then fall back to .env defaults.
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

// Build-time defaults for MASTRA_* variables (same as next.config.ts env).
const mastraDefaults = {
  MASTRA_SERVER_HOST: "__SANDBOX_HOST__",
  MASTRA_SERVER_PORT: "443",
  MASTRA_SERVER_PROTOCOL: "https",
  MASTRA_API_PREFIX,
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
const schedulesButtonSrc = resolve(__dirname, "schedules-button.js");
const schedulesButtonDest = resolve(studioDest, "schedules-button.js");
const shmastraScriptTag =
  '<script src="/shmastra/public/script/shmastra.js"></script>';
const keepaliveScriptTag =
  '<script src="/studio/keepalive.js" defer></script>';
const logoutButtonScriptTag =
  '<script src="/studio/logout-button.js" defer></script>';
const schedulesButtonScriptTag =
  '<script src="/studio/schedules-button.js" defer></script>';

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
        cpSync(schedulesButtonSrc, schedulesButtonDest);

        // Replace %%PLACEHOLDER%% patterns in index.html
        const indexPath = resolve(studioDest, "index.html");
        if (existsSync(indexPath)) {
          let html = readFileSync(indexPath, "utf-8");

          // Replace all %%MASTRA_*%% placeholders with env values
          html = html.replace(/%%([A-Z_]+)%%/g, (match, key) => {
            return studioEnv[key] || "";
          });

          // Insert shmastra.js right after the first </script> so it runs
          // before Studio's module script (which makes authed requests).
          // NOTE: must happen BEFORE the auth-token injection below — otherwise
          // the auth-token's own </script> becomes the "first" one and shmastra.js
          // ends up sandwiched between auth-token and the original inline script.
          if (!html.includes(shmastraScriptTag)) {
            const firstScriptClose = "</script>";
            const firstScriptIdx = html.indexOf(firstScriptClose);
            if (firstScriptIdx !== -1) {
              const insertAt = firstScriptIdx + firstScriptClose.length;
              html =
                html.slice(0, insertAt) +
                `\n    ${shmastraScriptTag}` +
                html.slice(insertAt);
            } else if (html.includes("</head>")) {
              html = html.replace("</head>", `  ${shmastraScriptTag}\n</head>`);
            } else {
              html = `${html}\n${shmastraScriptTag}\n`;
            }
          }

          // Studio HTML has no %%MASTRA_AUTH_TOKEN%% placeholder — inject a
          // dedicated script that sets window.MASTRA_AUTH_TOKEN. Runtime value
          // (`__MASTRA_AUTH_TOKEN__`) is substituted per-user in app/studio/route.ts.
          // Must appear BEFORE the very first <script> tag so every inline/module
          // script in Studio's HTML sees window.MASTRA_AUTH_TOKEN already defined.
          const authTokenScriptTag =
            '<script>window.MASTRA_AUTH_TOKEN = "__MASTRA_AUTH_TOKEN__";</script>';
          if (!html.includes(authTokenScriptTag)) {
            const firstScriptIdx = html.indexOf("<script");
            if (firstScriptIdx !== -1) {
              html =
                html.slice(0, firstScriptIdx) +
                `${authTokenScriptTag}\n    ` +
                html.slice(firstScriptIdx);
            } else if (html.includes("</head>")) {
              html = html.replace("</head>", `  ${authTokenScriptTag}\n</head>`);
            } else {
              html = `${authTokenScriptTag}\n${html}`;
            }
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

          if (!html.includes(schedulesButtonScriptTag)) {
            html = html.includes("</body>")
              ? html.replace("</body>", `  ${schedulesButtonScriptTag}\n</body>`)
              : `${html}\n${schedulesButtonScriptTag}\n`;
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
