// Shared helpers for /apps/* HTML routes: fetch the rendered HTML from the
// owner's sandbox, then mutate it before serving from cloud.com.
//
// Mastra's appIndexHandler already injects:
//   <script>window.MASTRA_API_PREFIX=…;window.MASTRA_AUTH_TOKEN=…;</script>
//   <script src="/shmastra/public/script/shmastra.js"></script>
// We post-process that HTML to:
//   1. Insert a <base href="<sandbox>/apps/<name>/"> so all relative AND
//      root-relative URLs (scripts, /api/*, fetch) target the sandbox origin
//      directly — the browser never re-routes them through cloud.com.
//   2. Optionally swap the embedded MASTRA_AUTH_TOKEN value (guest flow uses
//      a session token instead of the owner virtual key).
//   3. Optionally append an owner-only share-overlay script.

export interface MastraFetchResult {
  ok: boolean;
  status: number;
  html?: string;
}

export async function fetchAppHtml(
  sandboxHost: string,
  appName: string,
  ownerVirtualKey: string,
): Promise<MastraFetchResult> {
  // New canonical path is /apps/<appName>; the sandbox-side handler is added
  // alongside the existing /shmastra/apps/<appName> alias in this same change.
  const url = `${sandboxHost}/apps/${encodeURIComponent(appName)}`;
  const res = await fetch(url, {
    headers: { "x-mastra-auth-token": ownerVirtualKey },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, html: await res.text() };
}

export function injectBaseTag(html: string, baseHref: string): string {
  const tag = `<base href="${escapeAttr(baseHref)}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  // No <head> — prepend tag at top of document.
  return tag + html;
}

export function replaceAuthToken(html: string, newToken: string): string {
  // Mastra's inject is:
  //   window.MASTRA_AUTH_TOKEN="<owner-vk>";
  // The owner VK is also serialized via JSON.stringify, so the value is
  // a double-quoted string. We swap the literal.
  return html.replace(
    /window\.MASTRA_AUTH_TOKEN\s*=\s*"[^"]*"/,
    `window.MASTRA_AUTH_TOKEN=${JSON.stringify(newToken)}`,
  );
}

export function appendToHead(html: string, snippet: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${snippet}</head>`);
  }
  return html + snippet;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
