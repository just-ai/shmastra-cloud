import { createInterface } from "readline";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { streamMessage, destroySession, getOrCreateSession } from "./session.mjs";

export async function cliAgentMode(sandboxId: string) {
  console.log(`Connecting to sandbox ${sandboxId}...`);

  const session = await getOrCreateSession(sandboxId);
  console.log(`Connected. Type messages, !command for bash, Ctrl+C to exit.\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => rl.question("> ", handleLine);

  async function handleLine(line: string) {
    const message = line.trim();
    if (!message) {
      prompt();
      return;
    }

    // ! prefix = direct bash command
    if (message.startsWith("!")) {
      const cmd = message.slice(1).trim();
      if (!cmd) { prompt(); return; }
      try {
        console.log(`$ ${cmd}`);
        const result = await session.sandbox.commands.run(cmd, { timeoutMs: 120_000 });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.exitCode !== 0) console.log(`exit: ${result.exitCode}`);
      } catch (err: any) {
        console.error(`✗ ${err.message}`);
      }
      prompt();
      return;
    }

    try {
      const stream = await streamMessage(sandboxId, message);

      for await (const part of stream.fullStream) {
        switch (part.type) {
          case "text-delta":
            process.stdout.write(part.payload.text);
            break;
          case "tool-call": {
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
            console.log(`\n${line}`);
            break;
          }
          case "tool-result":
            console.log(`→ ${String(part.payload.result).slice(0, 500)}`);
            break;
          case "error":
            console.error(`✗ Stream error: ${part.payload}`);
            break;
        }
      }

      console.log(); // newline after response
    } catch (err: any) {
      console.error(`✗ Error: ${err.message}`);
    }

    prompt();
  }

  process.on("SIGINT", () => {
    console.log("\nDisconnecting...");
    destroySession(sandboxId);
    process.exit(0);
  });

  prompt();
}
