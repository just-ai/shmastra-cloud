---
name: e2b-sandbox
description: "Debug and inspect E2B sandboxes — check why a sandbox is broken, view logs, restart processes, inspect files, verify health. Use this skill when the user reports a problem with their sandbox, asks to check/fix/debug a sandbox, mentions a sandbox is not working, complains about errors in their workspace, or when you need to investigate sandbox state during any troubleshooting."
---

# E2B Sandbox Skill

Tool for debugging and inspecting E2B sandboxes.

## Script

```bash
# Run a command on a sandbox
npx tsx .claude/skills/e2b-sandbox/scripts/sandbox-cmd.mts <sandbox-id> "<command>"

# List all sandboxes with their state (running/paused)
npx tsx .claude/skills/e2b-sandbox/scripts/sandbox-cmd.mts --list

# Options
#   --user <name>     run as this user (default: user, use root for admin ops)
#   --timeout <ms>    command timeout (default: 120000)
```

Paused sandboxes are automatically resumed on connect.

E2B-specific subcommands (pass instead of a shell command):
- `procs` — list running processes (E2B process API)
- `host <port>` — get public hostname for a port (default: 4111)
- `info` — sandbox ID and host
- `upload <remote-path> <content>` — write file via E2B files API
- `download <remote-path>` — read file via E2B files API

## Debugging playbook

When investigating a broken sandbox, check in this order:

1. **Is it alive?** `--list` to see if it's running or paused
2. **PM2 status:** `npx pm2 list` — is the app process running?
3. **App health:** `curl -s http://localhost:4111/health`
4. **PM2 logs:** `npx pm2 logs shmastra --lines 50 --nostream`
5. **Healer logs:** `cat /home/user/shmastra/.logs/healer.log`
6. **Disk/memory:** `df -h && free -m`
7. **Env vars:** `cat /home/user/ecosystem.config.cjs` (check CORS_ORIGIN, MASTRA_AUTH_TOKEN, etc.)
8. **Git state:** `cd /home/user/shmastra && git status && git log --oneline -5`

## Sandbox layout

- `/home/user/shmastra/` — project root
- `/home/user/ecosystem.config.cjs` — PM2 config
- `/home/user/shmastra/.logs/healer.log` — healer output
- Dev server: port 4111
- PM2 is not in global PATH, always use `npx pm2`

## For complex operations

Write an inline TypeScript script when you need multi-step logic:

```typescript
import { Sandbox } from "e2b";
import { config } from "dotenv";
config({ path: ".env.local" });

const sandbox = await Sandbox.connect("SANDBOX_ID");
// ... your debugging logic
```
