import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readdirSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Env profile system (Next.js-like priority) ──

/** Scan .env* files → derive profile names from filenames */
function scanProfiles(): string[] {
  const files = readdirSync(ROOT).filter((f) => /^\.env(\..+)?$/.test(f));
  const profiles = new Set<string>();
  for (const f of files) {
    if (f === ".env" || f === ".env.local" || f === ".env.example") continue;
    // .env.prod → "prod", .env.staging.local → "staging"
    const name = f.replace(/^\.env\./, "").replace(/\.local$/, "");
    if (name) profiles.add(name);
  }
  // "local" is always available (.env and/or .env.local)
  profiles.add("local");
  return [...profiles].sort();
}

/** File priority for a profile (highest → lowest).
 *  Profile-specific files override .env.local so switching actually changes the env. */
function envFilesForProfile(profile: string): string[] {
  if (profile === "local") return [".env.local", ".env"];
  return [
    `.env.${profile}.local`,
    `.env.${profile}`,
    `.env.local`,
    `.env`,
  ];
}

/** Track keys loaded by dotenv so we can cleanly remove them on switch */
let loadedKeys = new Set<string>();

function loadProfile(profile: string) {
  for (const k of loadedKeys) delete process.env[k];
  loadedKeys.clear();

  const files = envFilesForProfile(profile);
  const loaded: string[] = [];
  // Load lowest priority first with override, so highest priority wins
  for (const file of [...files].reverse()) {
    const fullPath = resolve(ROOT, file);
    if (existsSync(fullPath)) {
      const result = config({ path: fullPath, override: true });
      if (result.parsed) for (const k of Object.keys(result.parsed)) loadedKeys.add(k);
      loaded.push(file);
    }
  }
  return loaded.reverse(); // return highest priority first
}

export let currentProfile: string;
export let loadedFiles: string[] = [];
export const availableProfiles = scanProfiles();

const initialProfile = availableProfiles.includes("local") ? "local" : availableProfiles[0];
loadedFiles = loadProfile(initialProfile);
currentProfile = initialProfile;

console.log(`Env profile: ${currentProfile} (${loadedFiles.join(" > ")})`);

// ── Clients (re-created on profile switch) ──

function createClients() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    supabase: url && key ? createClient(url, key) : null,
    anthropic: new Anthropic(),
  };
}

let clients = createClients();

export let supabase = clients.supabase;
export let anthropic = clients.anthropic;

/** Switch to a different env profile at runtime */
export function switchProfile(profile: string): { profile: string; files: string[]; error?: string } {
  if (!availableProfiles.includes(profile)) {
    return { profile: currentProfile, files: loadedFiles, error: `Profile "${profile}" not available` };
  }
  loadedFiles = loadProfile(profile);
  currentProfile = profile;
  clients = createClients();
  supabase = clients.supabase;
  anthropic = clients.anthropic;

  console.log(`Switched to env profile: ${profile} (${loadedFiles.join(" > ")})`);
  return { profile, files: loadedFiles };
}
