/**
 * Build E2B sandbox template for the Shmastra server using the SDK Template builder.
 *
 * Run: npm run template:build
 * Requires: E2B_API_KEY in .env.local (or environment)
 */

import {config} from "dotenv";
import {dirname, resolve} from "path";
import {fileURLToPath} from "url";
import {readdirSync} from "fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// Auto-detect latest patch version from scripts/patches/
const patchesDir = resolve(scriptDir, "patches");
const latestPatch = readdirSync(patchesDir)
    .filter(f => /^\d{3}_/.test(f))
    .sort()
    .pop()
    ?.match(/^(\d{3})/)?.[1] || "000";
const homeDir = "/home/user";
const workDir = `${homeDir}/workdir`;
const appDir = `${homeDir}/shmastra`;
const startScriptPath = `${homeDir}/start.sh`;
const cacheBuster = Math.random().toString(36).slice(2);

config({path: resolve(scriptDir, "../.env.local")});

import {Template, defaultBuildLogger} from "e2b";

const sandboxDir = resolve(scriptDir, "sandbox");

const template = Template({fileContextPath: sandboxDir})
    .fromNodeImage("22")
    .aptInstall(["curl", "git", "python3", "python3-pip", "sqlite3"])
    .runCmd("pip3 install --break-system-packages 'markitdown[all]'", {user: "root"})
    .runCmd("npm install -g pnpm", {user: "root"})
    .runCmd("npm install -g pm2", {user: "root"})
    .runCmd("pm2 install pm2-logrotate", {user: "root"})
    .copy("ecosystem.config.cjs", `${homeDir}/ecosystem.config.cjs`)
    .copy("healer.mts", `${homeDir}/healer.mts`)
    .copy("start.sh", startScriptPath)
    .runCmd(`chmod +x ${startScriptPath}`)
    .makeDir(appDir)
    .setWorkdir(appDir)
    .runCmd(`echo "cache:${cacheBuster}"`)
    .gitClone("https://github.com/just-ai/shmastra", appDir)
    .setEnvs({ SHMASTRA_WORKDIR_HOME: workDir })
    .runCmd(`pnpm install`)
    .runCmd(`pnpm run install-browsers`)
    .runCmd(`pnpm run init-workdir`)
    .runCmd(`echo "${latestPatch}" > ${homeDir}/.template-version`);

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
