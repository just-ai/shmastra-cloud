import { Sandbox } from "e2b";
import { config } from "dotenv";

config({ path: new URL("../../../../.env.local", import.meta.url).pathname });

const args = process.argv.slice(2);

if (args[0] === "--list") {
  const sandboxes = await Sandbox.list().nextItems();
  if (!sandboxes.length) {
    console.log("No sandboxes found.");
  } else {
    console.log(`Found ${sandboxes.length} sandbox(es):\n`);
    for (const s of sandboxes) {
      console.log(`  ${s.sandboxId}  [${s.state}]`);
    }
  }
  process.exit(0);
}

const sandboxId = args[0];
if (!sandboxId) {
  console.log("Usage:");
  console.log("  sandbox-cmd.mts <sandbox-id> <command>");
  console.log("  sandbox-cmd.mts <sandbox-id> procs|host|info|upload|download");
  console.log("  sandbox-cmd.mts --list");
  process.exit(1);
}

const timeoutFlag = args.indexOf("--timeout");
const cmdTimeout = timeoutFlag !== -1 ? parseInt(args[timeoutFlag + 1], 10) : 120_000;
const userFlag = args.indexOf("--user");
const cmdUser = userFlag !== -1 ? args[userFlag + 1] : "user";

console.log(`Connecting to sandbox ${sandboxId}...`);

const allSandboxes = await Sandbox.list().nextItems();
const entry = allSandboxes.find(s => s.sandboxId === sandboxId);
if (!entry) {
  console.error(`Sandbox ${sandboxId} not found. It may have been deleted or expired.`);
  process.exit(1);
}
if (entry.state === "paused") {
  console.log(`Sandbox is paused, resuming...`);
}

const sandbox = await Sandbox.connect(sandboxId, { timeoutMs: 60_000 });
console.log(`Connected. Host: ${sandbox.getHost(4111)}`);

const skipArgs = new Set<number>();
if (timeoutFlag !== -1) { skipArgs.add(timeoutFlag); skipArgs.add(timeoutFlag + 1); }
if (userFlag !== -1) { skipArgs.add(userFlag); skipArgs.add(userFlag + 1); }
const command = args.slice(1).filter((_, i) => !skipArgs.has(i + 1)).join(" ");

if (!command) {
  console.error("No command provided.");
  process.exit(1);
}

try {
  if (command === "procs") {
    const procs = await sandbox.commands.list();
    for (const p of procs) console.log(`PID ${p.pid}: ${p.cmd}`);
    if (!procs.length) console.log("(no processes)");
  } else if (command.startsWith("host")) {
    const port = parseInt(command.split(/\s+/)[1], 10) || 4111;
    console.log(sandbox.getHost(port));
  } else if (command === "info") {
    console.log(`Sandbox ID: ${sandbox.sandboxId}`);
    console.log(`Host (4111): ${sandbox.getHost(4111)}`);
  } else if (command.startsWith("upload ")) {
    const rest = command.slice(7).trim();
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) {
      console.log("Usage: upload <remote-path> <content>");
      process.exit(1);
    }
    const remotePath = rest.slice(0, spaceIdx);
    const content = rest.slice(spaceIdx + 1);
    await sandbox.files.write(remotePath, content);
    console.log(`Written to ${remotePath}`);
  } else if (command.startsWith("download ")) {
    const remotePath = command.slice(9).trim();
    const content = await sandbox.files.read(remotePath);
    console.log(content);
  } else {
    const result = await sandbox.commands.run(command, { timeoutMs: cmdTimeout, user: cmdUser });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }
} catch (err: any) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
