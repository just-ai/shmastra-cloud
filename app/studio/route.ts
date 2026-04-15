import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId, getSandbox } from "@/lib/db";

const htmlPath = join(process.cwd(), "public", "studio", "index.html");

export async function GET() {
  let sandboxHost = "";
  let virtualKey = "";

  try {
    const session = await withAuth({ ensureSignedIn: true });
    const user = await getUserByWorkosId(session.user.id);

    if (user) {
      const sandbox = await getSandbox(user.id);
      if (sandbox?.sandbox_host) {
        sandboxHost = sandbox.sandbox_host.replace(/^https?:\/\//, "");
      }
      virtualKey = user.virtual_key ?? "";
    }
  } catch {
    // Fall through with empty host — middleware handles auth redirect
  }

  const html = await readFile(htmlPath, "utf-8");
  const injected = html
    .replace("__SANDBOX_HOST__", sandboxHost)
    .replace("__MASTRA_AUTH_TOKEN__", virtualKey);

  return new Response(injected, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
