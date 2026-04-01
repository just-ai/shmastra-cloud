/**
 * Build E2B sandbox template for the Shmastra server using the SDK Template builder.
 *
 * Run: npm run template:build
 * Requires: E2B_API_KEY in .env.local (or environment)
 */

import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const homeDir = "/home/user";
const appDir = `${homeDir}/shmastra`;
const startScriptPath = `${homeDir}/start.sh`;
const cacheBuster = Math.random().toString(36).slice(2);

config({ path: resolve(scriptDir, "../.env.local") });

import { Template, defaultBuildLogger } from "e2b";

const template = Template({ fileContextPath: scriptDir })
  .fromNodeImage("22")
  .aptInstall(["curl", "git", "python3", "python3-pip"])
  .runCmd("pip3 install --break-system-packages 'markitdown[all]'", { user: "root" })
  .runCmd("npm install -g pnpm", { user: "root" })
  .runCmd("npx -y playwright@latest install --with-deps chromium", { user: "root" })
  .makeDir(appDir)
  .runCmd(`echo "cache:${cacheBuster}"`)
  .gitClone("https://github.com/just-ai/shmastra", appDir)
  .runCmd(`cd ${appDir} && pnpm install && pnpm run init-workdir`)
  .copy("start.sh", startScriptPath)
  .runCmd(`chmod +x ${startScriptPath}`)
  .setWorkdir(appDir);

async function main() {
  console.log("Building E2B template 'shmastra'...");
  console.log("This may take several minutes.\n");

  const buildInfo = await Template.build(template, "shmastra", {
    onBuildLogs: defaultBuildLogger(),
    cpuCount: 4,
    memoryMB: 4096,
  });

  console.log("\nTemplate built successfully!");
  console.log(`  Name:        ${buildInfo.name}`);
  console.log(`  Template ID: ${buildInfo.templateId}`);
  console.log(`  Build ID:    ${buildInfo.buildId}`);
}

main().catch((err) => {
  console.error("Template build failed:", err);
  process.exit(1);
});
