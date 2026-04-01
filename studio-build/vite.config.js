import { defineConfig } from "vite";
import { readFileSync, writeFileSync, cpSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

// Load local overrides first, then fall back to .env defaults.
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const studioEnv = { ...process.env };

const studioSrc = resolve(__dirname, "../node_modules/mastra/dist/studio");
const studioDest = resolve(__dirname, "../public/studio");
const keepaliveSrc = resolve(__dirname, "keepalive.js");
const keepaliveDest = resolve(studioDest, "keepalive.js");
const shmastraScriptTag =
  '<script src="/shmastra/public/script/shmastra.js"></script>';
const keepaliveScriptTag =
  '<script src="/studio/keepalive.js" defer></script>';

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

        // Replace %%PLACEHOLDER%% patterns in index.html
        const indexPath = resolve(studioDest, "index.html");
        if (existsSync(indexPath)) {
          let html = readFileSync(indexPath, "utf-8");

          // Replace all %%MASTRA_*%% placeholders with env values
          html = html.replace(/%%([A-Z_]+)%%/g, (match, key) => {
            return studioEnv[key] || "";
          });

          if (!html.includes(shmastraScriptTag)) {
            html = html.includes("</body>")
              ? html.replace("</body>", `  ${shmastraScriptTag}\n</body>`)
              : `${html}\n${shmastraScriptTag}\n`;
          }

          if (!html.includes(keepaliveScriptTag)) {
            html = html.includes("</body>")
              ? html.replace("</body>", `  ${keepaliveScriptTag}\n</body>`)
              : `${html}\n${keepaliveScriptTag}\n`;
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
