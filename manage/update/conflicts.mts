import { Agent } from "@mastra/core/agent";
import { Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { E2BSandbox } from "@mastra/e2b";
import { anthropic } from "../env.mjs";
import { run, type SandboxInstance, type LogFn } from "../sandbox.mjs";

async function getConflictedFiles(sandbox: SandboxInstance, workdir: string, log: LogFn) {
  const result = await run(sandbox, `git -C "${workdir}" diff --name-only --diff-filter=U`, log, {
    throwOnError: false,
  });
  return result.stdout.trim().split("\n").filter(Boolean);
}

async function readSandboxFile(sandbox: SandboxInstance, filePath: string) {
  const result = await sandbox.commands.run(`cat "${filePath}"`, { timeoutMs: 10_000, user: "user" });
  return result.stdout;
}

async function resolveConflictWithClaude(fileName: string, conflictedContent: string, log: LogFn) {
  log(`🤖 Asking Claude to resolve conflict in ${fileName}...`);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: `You are resolving a git merge conflict. The file below contains git conflict markers (<<<<<<< HEAD, =======, >>>>>>> ...).

Rules:
- Merge BOTH sides of each conflict. Do not drop changes from either side.
- For package.json: combine dependencies from both sides. If versions differ, use the newer version.
- Respond with a JSON object: {"contents": "<resolved file contents>"}

File: ${fileName}
\`\`\`
${conflictedContent}
\`\`\``,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            contents: { type: "string", description: "The full resolved file contents" },
          },
          required: ["contents"],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text.text);
    return parsed.contents ?? "";
  } catch (err: any) {
    throw new Error(`Failed to parse Claude response as JSON for ${fileName}: ${err.message}`);
  }
}

const SIMPLE_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json", ".npmrc", ".gitignore"]);
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json"]);

export function logAgentStream(log: LogFn) {
  let buffer = "";
  const flush = () => {
    if (buffer.length > 0) {
      log(buffer);
      buffer = "";
    }
  };
  const handle = (part: any) => {
    switch (part.type) {
      case "text-delta": {
        buffer += part.payload.text;
        const idx = buffer.lastIndexOf("\n");
        if (idx >= 0) {
          const complete = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          for (const line of complete.split("\n")) log(line);
        }
        break;
      }
      case "tool-call": {
        flush();
        const { toolName, args } = part.payload;
        const a = args as Record<string, unknown>;
        let line: string;
        const { SANDBOX } = WORKSPACE_TOOLS;
        switch (toolName) {
          case SANDBOX.EXECUTE_COMMAND:
            line = `$ ${a.command}${a.cwd ? ` (in ${a.cwd})` : ""}`;
            break;
          case SANDBOX.GET_PROCESS_OUTPUT:
            line = `output pid=${a.pid}${a.tail ? ` tail=${a.tail}` : ""}`;
            break;
          case SANDBOX.KILL_PROCESS:
            line = `kill pid=${a.pid}`;
            break;
          default:
            line = `${toolName}(${JSON.stringify(a).slice(0, 100)})`;
        }
        log(`> ${line}`);
        break;
      }
      case "tool-result":
        flush();
        log(`→ ${String(part.payload.result).slice(0, 200)}`);
        break;
      case "error":
        flush();
        log(`✗ Stream error: ${part.payload}`);
        break;
      default:
        flush();
        break;
    }
  };
  return { handle, flush };
}

async function resolveConflictsWithAgent(
  sandbox: SandboxInstance,
  workdir: string,
  sourceFiles: string[],
  log: LogFn,
) {
  log(`🤖 Starting Mastra agent to resolve ${sourceFiles.length} source file(s)...`);

  const e2bSandbox = new E2BSandbox({ id: "merge-resolver" });
  (e2bSandbox as any)._sandbox = sandbox;

  const workspace = new Workspace({ sandbox: e2bSandbox });
  await workspace.init();

  await run(sandbox, `cd "${workdir}" && pnpm install`, log, {
    throwOnError: false,
    timeoutMs: 180_000,
  });

  const agent = new Agent({
    workspace,
    id: "merge-resolver",
    name: "merge-resolver",
    model: "anthropic/claude-opus-4-6",
    instructions: `You are resolving git merge conflicts in a project.
Working directory: ${workdir}

Rules:
- Read each conflicted file, understand both sides of the conflict, and merge them.
- Preserve ALL functionality from both sides. Do not drop any code.
- After resolving each file, run: git -C "${workdir}" add <file>
- After resolving all files, run: cd "${workdir}" && pnpm dry-run
- If this fails (non-zero return code), read the errors, fix the code, and repeat until it succeeds.
- When dry-run returns zero code, run: git -C "${workdir}" add -A && git -C "${workdir}" commit -m "<describe what was resolved>"`,
  });

  const fileList = sourceFiles.join(", ");
  const stream = await agent.stream(
    `Resolve merge conflicts in these files: ${fileList}. The files are in ${workdir}.`,
  );

  const { handle, flush } = logAgentStream(log);
  for await (const part of stream.fullStream) {
    handle(part);
  }
  flush();

  await run(sandbox, `git -C "${workdir}" add -A`, log, { throwOnError: false });
  await run(
    sandbox,
    `git -C "${workdir}" diff --cached --quiet || git -C "${workdir}" commit -m "Auto-resolve merge conflicts"`,
    log,
    { throwOnError: false },
  );
}

export async function resolveConflicts(sandbox: SandboxInstance, workdir: string, log: LogFn) {
  const conflictedFiles = await getConflictedFiles(sandbox, workdir, log);
  if (conflictedFiles.length === 0) return false;

  log(`📝 Found ${conflictedFiles.length} conflicted file(s): ${conflictedFiles.join(", ")}`);

  const sourceFiles = [];

  for (const file of conflictedFiles) {
    const fullPath = `${workdir}/${file}`;

    if (LOCKFILES.has(file)) {
      log(`Removing ${file} (will be regenerated by pnpm install)`);
      await run(sandbox, `rm -f "${fullPath}"`, log, { throwOnError: false });
      await run(sandbox, `git -C "${workdir}" add "${file}"`, log, { throwOnError: false });
      continue;
    }

    if (SIMPLE_FILES.has(file)) {
      const conflictedContent = await readSandboxFile(sandbox, fullPath);
      const resolved = await resolveConflictWithClaude(file, conflictedContent, log);
      if (!resolved) {
        throw new Error(`Claude returned empty resolution for ${file}`);
      }
      await sandbox.files.write(fullPath, resolved, { user: "user" });
      await run(sandbox, `git -C "${workdir}" add "${file}"`, log, { throwOnError: false });
      log(`✓ Resolved ${file} (Claude API)`);
      continue;
    }

    sourceFiles.push(file);
  }

  if (sourceFiles.length > 0) {
    await resolveConflictsWithAgent(sandbox, workdir, sourceFiles, log);
  } else {
    await run(sandbox, `git -C "${workdir}" commit -m "Auto-resolve merge conflicts"`, log, {
      throwOnError: false,
    });
  }

  return true;
}
